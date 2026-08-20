'use client';

/**
 * Key lifecycle (Wave 2, corrected in Wave 3). The wallet signature → AES key
 * ceremony, held as a React context so any component can ask for the
 * (memory-only, non-extractable) CryptoKey.
 *
 * WHAT CHANGED AND WHY. This provider used to treat the key-check value as the
 * authority on what a correct key is. It isn't: the KCV is a self-issued token,
 * a fixed constant encrypted with whatever key the last signature produced and
 * verified against nothing. That inversion caused two failures.
 *
 *  - `unlock()` minted authority out of nothing. With no KCV present, ANY
 *    signature became the device's law — so on a smart-account or MPC wallet
 *    whose signatures are not deterministic, a fresh device's WRONG signature
 *    became the KCV, and from that moment the correct recovery key was rejected
 *    forever with "That recovery key doesn't match this journal."
 *  - `unlockWithRecoveryKey()` refused whenever there was no KCV to appeal to —
 *    exactly the fresh device / new profile / cleared-site-data case the
 *    recovery key exists for.
 *
 * The authority is now the user's own ciphertext. Every envelope is AES-GCM
 * bound to `lumen:v2:<keyVersion>:<typ>:<wallet>:<id>`, so one successful
 * authenticated decrypt proves the key, and a typo cannot forge it. The KCV is
 * demoted to a cache consulted only when there is no ciphertext to ask. Every
 * decision lives in lib/crypto/keyTrust.ts, where it can be tested.
 *
 * Rules this provider still enforces:
 *  - signing fires ONLY on an explicit user action (never on connect/load);
 *  - the key lives in a ref — refresh forgets it by design ("locked");
 *  - wallet switch → immediate lock; all storage is per-address;
 *  - recovery key = the 32 raw key bytes, NOT the signature.
 *
 * The signature is obtained via `signMessage` from `wagmi/actions` rather than
 * `useSignMessage`, so no mutation — and therefore no cached copy of the
 * signature or its derivation message — ever exists. See lib/crypto/cacheAudit.ts.
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
import { useAccount, useConfig } from 'wagmi';
import { signMessage } from 'wagmi/actions';

import { decryptBytes, encryptBytes } from '@/lib/crypto/encrypt';
import {
  bytesToHex,
  CURRENT_KEY_VERSION,
  deriveAesKey,
  deriveKeyMaterial,
  getKeyDerivationMessage,
  hexToBytes,
} from '@/lib/crypto/keys';
import {
  decideExport,
  decideUnlock,
  evidenceFrom,
  probeArtifacts,
  type KeyEvidence,
  type KeyTrust,
  type UnlockSource,
} from '@/lib/crypto/keyTrust';
import { refusalMessage, unlockNotice, type UnlockNotice } from '@/lib/crypto/unlockCopy';
import { getKcv, iterateCiphertext, putKcv } from '@/lib/storage/db';

const KCV_PLAINTEXT = 'lumen-kcv-v1';

export type MemoryKeyState = 'no-wallet' | 'locked' | 'unlocking' | 'unlocked' | 'mismatch';

export interface MemoryKeyContextValue {
  state: MemoryKeyState;
  /** Lowercase 0x address of the connected wallet, when there is one. */
  wallet: string | null;
  keyVersion: number;
  /** How well this device could check the live key. Null unless unlocked. */
  trust: KeyTrust | null;
  /** What to tell the user about an unproven key. Null when there is nothing
   *  worth saying. */
  notice: UnlockNotice | null;
  /** Explicit user action: sign → derive → check against real data → unlocked. */
  unlock(): Promise<void>;
  lock(): void;
  /** Re-signs and returns the 32-byte key material as hex, with how well it
   *  could be checked. Never stored. */
  exportRecoveryKey(): Promise<{ hex: string; trust: KeyTrust }>;
  /** Fallback unlock: import saved key material. Works on a fresh device. */
  unlockWithRecoveryKey(hex: string): Promise<void>;
  /**
   * The live key just performed an authenticated decrypt of real wallet-bound
   * ciphertext. Promotes trust to 'proven' and rewrites the KCV from proven
   * material. Idempotent; safe to call on every successful decrypt.
   *
   * This is what makes fresh-device recovery self-healing: enter recovery key →
   * 'asserted' → restore a snapshot → it decrypts → KCV written → every later
   * unlock behaves normally.
   */
  confirmKeyProven(): Promise<void>;
  getKey(): CryptoKey | null;
}

const MemoryKeyContext = createContext<MemoryKeyContextValue | null>(null);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 'ok' = key matches the stored check value; 'bad' = it doesn't; 'none' = no
 *  KCV exists yet. A cache, not an authority — see the header. */
async function verifyKcv(wallet: string, key: CryptoKey): Promise<'ok' | 'bad' | 'none'> {
  const existing = await getKcv(wallet);
  if (!existing) return 'none';
  try {
    const plain = await decryptBytes(key, existing, {
      typ: 'kcv',
      keyVersion: CURRENT_KEY_VERSION,
      aadId: wallet,
    });
    return decoder.decode(plain) === KCV_PLAINTEXT ? 'ok' : 'bad';
  } catch {
    return 'bad';
  }
}

async function createKcv(wallet: string, key: CryptoKey): Promise<void> {
  const envelope = await encryptBytes(
    key,
    encoder.encode(KCV_PLAINTEXT),
    'kcv',
    wallet,
    CURRENT_KEY_VERSION,
  );
  await putKcv(wallet, envelope);
}

/** Everything this device can prove about a candidate, in one place. */
async function gatherEvidence(wallet: string, candidate: CryptoKey): Promise<KeyEvidence> {
  const data = await probeArtifacts(candidate, iterateCiphertext(wallet), CURRENT_KEY_VERSION);
  // Only consult the KCV when the ciphertext had nothing to say.
  const kcv = data === 'no-data' ? await verifyKcv(wallet, candidate) : 'none';
  return evidenceFrom(data, kcv);
}

async function importRawKey(material: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', material as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export function MemoryKeyProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const config = useConfig();
  const wallet = address ? address.toLowerCase() : null;

  const keyRef = useRef<CryptoKey | null>(null);
  const [state, setState] = useState<MemoryKeyState>('no-wallet');
  const [trust, setTrust] = useState<KeyTrust | null>(null);
  const [notice, setNotice] = useState<UnlockNotice | null>(null);
  /** Whether this wallet has a snapshot pointer anywhere — shapes the copy. */
  const hasSnapshotRef = useRef(false);

  // Wallet switch or disconnect → drop the key immediately.
  useEffect(() => {
    keyRef.current = null;
    setTrust(null);
    setNotice(null);
    setState(wallet ? 'locked' : 'no-wallet');
  }, [wallet]);

  /** The one signing call in the app. No hook, so no mutation, so no cache. */
  const sign = useCallback(async (): Promise<string> => {
    return signMessage(config, { message: getKeyDerivationMessage(CURRENT_KEY_VERSION) });
  }, [config]);

  /** Both unlock paths share this body — the decision table is the only thing
   *  that differs, and it lives in keyTrust.ts. */
  const admit = useCallback(
    async (forWallet: string, candidate: CryptoKey, source: UnlockSource) => {
      const evidence = await gatherEvidence(forWallet, candidate);
      const decision = decideUnlock(source, evidence);

      if (!decision.admit) {
        keyRef.current = null;
        setTrust(null);
        setNotice(null);
        setState(decision.nextState);
        throw new Error(refusalMessage(decision.refusal));
      }

      if (decision.writeKcv) {
        await createKcv(forWallet, candidate).catch(() => {
          // A KCV is an optimisation. Failing to cache it must never cost the
          // user an unlock they have already earned.
        });
      }
      keyRef.current = candidate;
      setTrust(decision.trust);
      setNotice(
        unlockNotice({ trust: decision.trust, source, hasSnapshot: hasSnapshotRef.current }),
      );
      setState('unlocked');
    },
    [],
  );

  const unlock = useCallback(async () => {
    if (!wallet) throw new Error('Connect a wallet first');
    setState('unlocking');
    try {
      const candidate = await deriveAesKey(await sign());
      await admit(wallet, candidate, 'signature');
    } catch (err) {
      if (keyRef.current === null) {
        setState((s) => (s === 'mismatch' ? s : 'locked'));
      }
      throw err;
    }
  }, [wallet, sign, admit]);

  const unlockWithRecoveryKey = useCallback(
    async (hex: string) => {
      if (!wallet) throw new Error('Connect a wallet first');
      const material = hexToBytes(hex.trim());
      if (material.length !== 32) throw new Error('A recovery key is 64 hex characters (32 bytes)');
      setState('unlocking');
      try {
        await admit(wallet, await importRawKey(material), 'recovery');
      } catch (err) {
        // Never leave a wrong recovery key in `mismatch`: that state hides
        // "Sign to unlock", and a typo is not a wallet-determinism problem.
        if (keyRef.current === null) setState('locked');
        throw err;
      }
    },
    [wallet, admit],
  );

  const confirmKeyProven = useCallback(async () => {
    const key = keyRef.current;
    if (!key || !wallet) return;
    setTrust((prev) => (prev === 'proven' ? prev : 'proven'));
    setNotice(null);
    await createKcv(wallet, key).catch(() => {});
  }, [wallet]);

  const lock = useCallback(() => {
    keyRef.current = null;
    setTrust(null);
    setNotice(null);
    setState(wallet ? 'locked' : 'no-wallet');
  }, [wallet]);

  const exportRecoveryKey = useCallback(async () => {
    if (!wallet) throw new Error('Connect a wallet first');
    const material = await deriveKeyMaterial(await sign());
    const candidate = await importRawKey(material);
    const verdict = decideExport(await gatherEvidence(wallet, candidate));
    if (!verdict.allow) {
      // Exporting a refuted key would hand over something that cannot open the
      // journal, and let it overwrite a good backup. That is silent data loss.
      throw new Error(
        'The signature your wallet just produced does not match the key protecting ' +
          'this journal, so this export would NOT decrypt your data. Keep your ' +
          'existing recovery key — do not overwrite it.',
      );
    }
    return { hex: bytesToHex(material), trust: verdict.trust };
  }, [wallet, sign]);

  const getKey = useCallback(() => keyRef.current, []);

  /** Called by useJournalMemory once it knows whether a pointer exists. */
  const value = useMemo<MemoryKeyContextValue>(
    () => ({
      state,
      wallet,
      keyVersion: CURRENT_KEY_VERSION,
      trust,
      notice,
      unlock,
      lock,
      exportRecoveryKey,
      unlockWithRecoveryKey,
      confirmKeyProven,
      getKey,
    }),
    [
      state,
      wallet,
      trust,
      notice,
      unlock,
      lock,
      exportRecoveryKey,
      unlockWithRecoveryKey,
      confirmKeyProven,
      getKey,
    ],
  );

  return <MemoryKeyContext.Provider value={value}>{children}</MemoryKeyContext.Provider>;
}

export function useMemoryKey(): MemoryKeyContextValue {
  const ctx = useContext(MemoryKeyContext);
  if (!ctx) throw new Error('useMemoryKey must be used inside MemoryKeyProvider');
  return ctx;
}
