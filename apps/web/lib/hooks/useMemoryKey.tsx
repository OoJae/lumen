'use client';

/**
 * Key lifecycle (Wave 2). The wallet signature → AES key ceremony, held as a
 * React context so any component can ask for the (memory-only, non-extractable)
 * CryptoKey.
 *
 * Rules this provider enforces:
 *  - signMessage fires ONLY on an explicit user action (never on connect/load);
 *  - the key lives in a ref — refresh forgets it by design ("locked");
 *  - a key-check value (KCV) catches wallets whose signatures aren't
 *    deterministic (some smart accounts) with a clear "mismatch" state instead
 *    of silently decrypting garbage;
 *  - wallet switch → immediate lock; all storage is per-address, so histories
 *    can never mix;
 *  - recovery key = the 32 raw key bytes (NOT the signature — strictly less
 *    powerful), exported only on explicit request, never stored.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAccount, useSignMessage } from 'wagmi';

import { decryptBytes, encryptBytes } from '@/lib/crypto/encrypt';
import {
  CURRENT_KEY_VERSION,
  deriveAesKey,
  deriveKeyMaterial,
  getKeyDerivationMessage,
  hexToBytes,
} from '@/lib/crypto/keys';
import { getKcv, putKcv } from '@/lib/storage/db';

const KCV_PLAINTEXT = 'lumen-kcv-v1';

export type MemoryKeyState = 'no-wallet' | 'locked' | 'unlocking' | 'unlocked' | 'mismatch';

export interface MemoryKeyContextValue {
  state: MemoryKeyState;
  /** Lowercase 0x address of the connected wallet, when there is one. */
  wallet: string | null;
  keyVersion: number;
  /** Explicit user action: sign → derive → KCV-check → unlocked. */
  unlock(): Promise<void>;
  lock(): void;
  /** Re-signs and returns the 32-byte key material as hex. Never stored. */
  exportRecoveryKey(): Promise<string>;
  /** Fallback unlock for non-deterministic wallets: import saved key material. */
  unlockWithRecoveryKey(hex: string): Promise<void>;
  getKey(): CryptoKey | null;
}

const MemoryKeyContext = createContext<MemoryKeyContextValue | null>(null);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function checkOrCreateKcv(wallet: string, key: CryptoKey): Promise<boolean> {
  const existing = await getKcv(wallet);
  if (!existing) {
    const envelope = await encryptBytes(
      key,
      encoder.encode(KCV_PLAINTEXT),
      'kcv',
      wallet,
      CURRENT_KEY_VERSION,
    );
    await putKcv(wallet, envelope);
    return true;
  }
  try {
    const plain = await decryptBytes(key, existing, {
      typ: 'kcv',
      keyVersion: CURRENT_KEY_VERSION,
      aadId: wallet,
    });
    return decoder.decode(plain) === KCV_PLAINTEXT;
  } catch {
    return false;
  }
}

export function MemoryKeyProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const wallet = address ? address.toLowerCase() : null;

  const keyRef = useRef<CryptoKey | null>(null);
  const [state, setState] = useState<MemoryKeyState>('no-wallet');

  // Wallet switch or disconnect → drop the key immediately.
  useEffect(() => {
    keyRef.current = null;
    setState(wallet ? 'locked' : 'no-wallet');
  }, [wallet]);

  const finishUnlock = useCallback(
    async (candidate: CryptoKey, forWallet: string) => {
      const ok = await checkOrCreateKcv(forWallet, candidate);
      if (!ok) {
        keyRef.current = null;
        setState('mismatch');
        throw new Error(
          'This wallet signed differently than when your journal was encrypted. ' +
            'Unlock with your recovery key instead.',
        );
      }
      keyRef.current = candidate;
      setState('unlocked');
    },
    [],
  );

  const unlock = useCallback(async () => {
    if (!wallet) throw new Error('Connect a wallet first');
    setState('unlocking');
    try {
      const signature = await signMessageAsync({
        message: getKeyDerivationMessage(CURRENT_KEY_VERSION),
      });
      const candidate = await deriveAesKey(signature);
      await finishUnlock(candidate, wallet);
    } catch (err) {
      if (keyRef.current === null) {
        setState((s) => (s === 'mismatch' ? s : 'locked'));
      }
      throw err;
    }
  }, [wallet, signMessageAsync, finishUnlock]);

  const unlockWithRecoveryKey = useCallback(
    async (hex: string) => {
      if (!wallet) throw new Error('Connect a wallet first');
      const material = hexToBytes(hex.trim());
      if (material.length !== 32) throw new Error('A recovery key is 64 hex characters (32 bytes)');
      setState('unlocking');
      try {
        const candidate = await crypto.subtle.importKey(
          'raw',
          material as BufferSource,
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt'],
        );
        await finishUnlock(candidate, wallet);
      } catch (err) {
        if (keyRef.current === null) {
          setState((s) => (s === 'mismatch' ? s : 'locked'));
        }
        throw err;
      }
    },
    [wallet, finishUnlock],
  );

  const lock = useCallback(() => {
    keyRef.current = null;
    setState(wallet ? 'locked' : 'no-wallet');
  }, [wallet]);

  const exportRecoveryKey = useCallback(async () => {
    if (!wallet) throw new Error('Connect a wallet first');
    const signature = await signMessageAsync({
      message: getKeyDerivationMessage(CURRENT_KEY_VERSION),
    });
    const material = await deriveKeyMaterial(signature);
    let hex = '';
    for (const byte of material) hex += byte.toString(16).padStart(2, '0');
    return hex;
  }, [wallet, signMessageAsync]);

  const getKey = useCallback(() => keyRef.current, []);

  const value = useMemo<MemoryKeyContextValue>(
    () => ({
      state,
      wallet,
      keyVersion: CURRENT_KEY_VERSION,
      unlock,
      lock,
      exportRecoveryKey,
      unlockWithRecoveryKey,
      getKey,
    }),
    [state, wallet, unlock, lock, exportRecoveryKey, unlockWithRecoveryKey, getKey],
  );

  return <MemoryKeyContext.Provider value={value}>{children}</MemoryKeyContext.Provider>;
}

export function useMemoryKey(): MemoryKeyContextValue {
  const ctx = useContext(MemoryKeyContext);
  if (!ctx) throw new Error('useMemoryKey must be used inside MemoryKeyProvider');
  return ctx;
}
