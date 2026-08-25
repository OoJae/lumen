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
  kcvPlaintext,
  probeArtifacts,
  readKcvPlaintext,
  type KcvProvenance,
  type KcvStatus,
  type KeyEvidence,
  type KeyTrust,
  type UnlockRefusal,
  type UnlockSource,
} from '@/lib/crypto/keyTrust';
import { refusalMessage, unlockNotice, type UnlockNotice } from '@/lib/crypto/unlockCopy';
import { getKcv, iterateCiphertext, putKcv } from '@/lib/storage/db';

// The KCV plaintext carries HOW it was written (`…:proven` / `…:bootstrap`).
// Both the writing and the reading live in keyTrust.ts, where they are tested —
// including the legacy bare-constant case, which is where getting it wrong
// would silently hand an unchecked key the word "proven".

export type MemoryKeyState = 'no-wallet' | 'locked' | 'unlocking' | 'unlocked' | 'mismatch';

export interface MemoryKeyContextValue {
  state: MemoryKeyState;
  /** Lowercase 0x address of the connected wallet, when there is one. */
  wallet: string | null;
  keyVersion: number;
  /** How well this device could check the live key. Null unless unlocked. */
  trust: KeyTrust | null;
  /** What to tell the user about an unproven key. Null when there is nothing
   *  worth saying. DERIVED, not snapshotted — see `reportSnapshot`. */
  notice: UnlockNotice | null;
  /**
   * Tell the provider whether this wallet has a journal somewhere other than
   * this device — a local pointer, or a root anchored on-chain.
   *
   * This exists because the answer usually arrives AFTER the unlock: the
   * companion's `latestMemoryRoot` is an async contract read, and the user can
   * unlock before it lands. So the notice is derived from this value rather
   * than captured when `admit()` runs, and it corrects itself the moment the
   * read resolves.
   *
   * The bug this replaces: a `hasSnapshotRef` that was read to choose the
   * notice, documented as "called by useJournalMemory", and written by nothing.
   * It was permanently false, so a user with an anchored journal opening Lumen
   * on a new device was told "This is a new journal on this device" and pointed
   * at the wrong next step — export a key, rather than restore before writing.
   * The pure `unlockNotice` was tested for both values, so the suite stayed
   * green; the defect was entirely in the wiring.
   */
  reportSnapshot(hasSnapshot: boolean): void;
  /**
   * Why the last unlock was refused, or null.
   *
   * `refusalMessage` has a branch for each, and one of them exists precisely to
   * avoid claiming "your data is intact" on a device that holds none — which is
   * what `signature-mismatch-kcv` always means. Both mismatch surfaces
   * hardcoded that claim anyway, so the sentence the copy module was written to
   * delete was the only one a user ever saw.
   */
  refusal: UnlockRefusal | null;
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

/**
 * Does the candidate match the stored check value, and what was that value
 * worth? A cache, not an authority — see the header.
 *
 * `ok-proven` means the KCV was written by a key that had decrypted real
 * ciphertext. `ok-bootstrap` means it was written by an unverified signature on
 * an empty device, so matching it proves only that the wallet signs
 * consistently. Conflating those two is what let this device call an unchecked
 * key "proven" on its second unlock.
 */
async function verifyKcv(wallet: string, key: CryptoKey): Promise<KcvStatus> {
  const existing = await getKcv(wallet);
  if (!existing) return 'none';
  try {
    const plain = await decryptBytes(key, existing, {
      typ: 'kcv',
      keyVersion: CURRENT_KEY_VERSION,
      aadId: wallet,
    });
    return readKcvPlaintext(decoder.decode(plain));
  } catch {
    return 'bad';
  }
}

async function createKcv(
  wallet: string,
  key: CryptoKey,
  provenance: KcvProvenance,
): Promise<void> {
  const envelope = await encryptBytes(
    key,
    encoder.encode(kcvPlaintext(provenance)),
    'kcv',
    wallet,
    CURRENT_KEY_VERSION,
  );
  await putKcv(wallet, envelope);
}

/** Everything this device can prove about a candidate, in one place. */
async function gatherEvidence(wallet: string, candidate: CryptoKey): Promise<KeyEvidence> {
  const data = await probeArtifacts(candidate, iterateCiphertext(wallet), CURRENT_KEY_VERSION);
  // The KCV is consulted ALWAYS, not only when the ciphertext is silent. It is
  // still not the authority — `evidenceFrom` lets data decide — but when data
  // refutes, the KCV's provenance marker is what distinguishes "this device
  // holds a real journal you cannot open" from "this device holds entries a
  // never-proven key wrote". Refusing a correct recovery key on the strength of
  // the second was a permanent lockout.
  const kcv = await verifyKcv(wallet, candidate);
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
  /**
   * The live wallet, readable from a callback that must never be re-created.
   *
   * `confirmKeyProven` used to close over the `wallet` variable, which made it
   * change identity on every connect. useJournalMemory calls it from inside
   * `hydrate` and `restoreFromRoot` — useCallbacks whose dependency arrays hold
   * only render-stable values — so both permanently ran the FIRST render's
   * copy, captured before any wallet existed, which returned immediately at
   * `if (!key || !wallet)`. The promotion never happened: a fresh-device
   * recovery unlock stayed `asserted` even after a snapshot decrypted, and the
   * UI kept telling the user to restore something they had just restored.
   */
  const walletRef = useRef<string | null>(null);
  walletRef.current = wallet;
  const [state, setState] = useState<MemoryKeyState>('no-wallet');
  const [trust, setTrust] = useState<KeyTrust | null>(null);
  /** Which path admitted the live key. Half of what the notice is derived from. */
  const [source, setSource] = useState<UnlockSource | null>(null);
  /** Whether this wallet has a journal somewhere else — the other half. */
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [refusal, setRefusal] = useState<UnlockRefusal | null>(null);

  // Wallet switch or disconnect → drop the key immediately.
  useEffect(() => {
    keyRef.current = null;
    setTrust(null);
    setSource(null);
    setRefusal(null);
    // Per-wallet, like everything else here: the previous wallet's journal says
    // nothing about this one's.
    setHasSnapshot(false);
    setState(wallet ? 'locked' : 'no-wallet');
  }, [wallet]);

  /**
   * The notice is DERIVED. It has to be: `hasSnapshot` usually resolves after
   * the unlock, and a notice captured at unlock time would keep giving the
   * wrong advice for the rest of the session.
   */
  const notice = useMemo(
    () => (trust && source ? unlockNotice({ trust, source, hasSnapshot }) : null),
    [trust, source, hasSnapshot],
  );

  /** The one signing call in the app. No hook, so no mutation, so no cache. */
  const sign = useCallback(async (): Promise<string> => {
    return signMessage(config, { message: getKeyDerivationMessage(CURRENT_KEY_VERSION) });
  }, [config]);

  /** Both unlock paths share this body — the decision table is the only thing
   *  that differs, and it lives in keyTrust.ts. */
  const admit = useCallback(
    async (forWallet: string, candidate: CryptoKey, source: UnlockSource) => {
      /**
       * The wallet can change WHILE this runs, and the window is not small: the
       * signature prompt is open for as long as the user takes, and account
       * switching is one click away in every wallet UI.
       *
       * Without this check the sequence was silent, permanent data loss.
       * `unlock()` captured wallet A, awaited the prompt, the user switched to B
       * (the effect above nulls the key and re-locks), and then this function
       * finished and installed A's KEY under B's session. Every entry written
       * afterwards was encrypted with A's key but AAD-bound to
       * `lumen:v2:<v>:turn:<B>:<id>` — so B could never decrypt it, and neither
       * could A, because the AAD names B. Nothing surfaced; the journal just
       * quietly became unreadable.
       */
      const stillCurrent = () => walletRef.current === forWallet;

      const evidence = await gatherEvidence(forWallet, candidate);
      if (!stillCurrent()) throw new Error('Wallet changed during unlock — nothing was unlocked.');
      const decision = decideUnlock(source, evidence);

      if (!decision.admit) {
        keyRef.current = null;
        setTrust(null);
        setSource(null);
        setRefusal(decision.refusal);
        setState(decision.nextState);
        throw new Error(refusalMessage(decision.refusal));
      }


      if (decision.writeKcv) {
        await createKcv(forWallet, candidate, decision.writeKcv).catch(() => {
          // A KCV is an optimisation. Failing to cache it must never cost the
          // user an unlock they have already earned.
        });
      }
      // Re-checked after the write too: createKcv is another await.
      if (!stillCurrent()) throw new Error('Wallet changed during unlock — nothing was unlocked.');
      keyRef.current = candidate;
      setTrust(decision.trust);
      setSource(source);
      setRefusal(null);
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

  // Deps are EMPTY on purpose — see walletRef. A cross-hook callback that
  // changes identity is a callback that gets captured stale.
  const confirmKeyProven = useCallback(async () => {
    const key = keyRef.current;
    const forWallet = walletRef.current;
    // A wallet switch nulls keyRef, so a confirm racing one no-ops here rather
    // than stamping the new wallet's KCV with the old wallet's key.
    if (!key || !forWallet) return;
    // `unlockNotice` returns null for a proven key, so the notice clears itself.
    setTrust((prev) => (prev === 'proven' ? prev : 'proven'));
    // Stamped `proven`: this key just opened real wallet-bound ciphertext, so a
    // later unlock on this device may rely on it. This is the ONLY place a
    // bootstrap KCV is promoted, and it takes an actual decrypt to get here.
    await createKcv(forWallet, key, 'proven').catch(() => {});
  }, []);

  const lock = useCallback(() => {
    keyRef.current = null;
    setTrust(null);
    setSource(null);
    setRefusal(null);
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

  /** Idempotent: React bails out of a state update to the same value. */
  const reportSnapshot = useCallback((has: boolean) => setHasSnapshot(has), []);

  const value = useMemo<MemoryKeyContextValue>(
    () => ({
      state,
      wallet,
      keyVersion: CURRENT_KEY_VERSION,
      trust,
      notice,
      refusal,
      unlock,
      lock,
      exportRecoveryKey,
      unlockWithRecoveryKey,
      confirmKeyProven,
      reportSnapshot,
      getKey,
    }),
    [
      state,
      wallet,
      trust,
      notice,
      refusal,
      unlock,
      lock,
      exportRecoveryKey,
      unlockWithRecoveryKey,
      confirmKeyProven,
      reportSnapshot,
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
