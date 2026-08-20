/**
 * A standing check that the wallet signature never reaches a cache.
 *
 * `docs/privacy-model.md` makes a point of it: the exported recovery artifact is
 * the 32 bytes of key material, "*not* the signature — the signature is strictly
 * more powerful and never leaves the signing ceremony." The code was built
 * around that: `deriveAesKey` imports non-extractable, and the CryptoKey lives
 * only in a ref.
 *
 * But the signature was obtained through wagmi's `useSignMessage`, which is a
 * bare `useMutation` wrapper. TanStack Query v5 retains a settled mutation's
 * `data` — here the raw signature hex — and its `variables` in the MutationCache
 * for the default 5-minute gcTime. The QueryClient is a single app-wide
 * instance, so for five minutes after every unlock the PREIMAGE of the
 * encryption key sat in a globally reachable object, readable from React
 * DevTools, a browser extension with page access, or any injected script.
 *
 * The fix is to use `signMessage` from `wagmi/actions`, so the mutation never
 * exists. This module is the guard that keeps it that way: a dev-only
 * subscription that fails loudly the moment anyone reintroduces a signing hook,
 * in the same spirit as the chain guard's hard seam assertion.
 *
 * Pure and testable — it takes a plain reduction of the cache, not the cache.
 */
import { KEY_DERIVATION_MESSAGES } from './keys';

/** A settled mutation reduced to what an auditor needs. */
export interface CachedMutation {
  mutationKey?: readonly unknown[];
  data?: unknown;
  variables?: unknown;
}

export interface CacheLeak {
  where: 'mutationKey' | 'data' | 'variables';
  mutationKey: string;
  /** Printable, and never the leaked value itself. */
  detail: string;
}

/**
 * Shape-based rather than key-based, so it catches the preimage wherever it
 * surfaces — not only under a mutation key we happened to think of.
 *
 * 0x plus at least 130 hex characters: a 65-byte ECDSA signature is exactly
 * 130, and ERC-1271 / ERC-6492 smart-account signatures are longer. A
 * transaction hash is 0x + 64, so the length threshold is what distinguishes a
 * signature from the many harmless hashes in this app's caches.
 */
export function looksLikeSignature(value: unknown): boolean {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{130,}$/.test(value);
}

/** This app must never create a signing mutation at all. */
export function isSigningMutationKey(key: readonly unknown[] | undefined): boolean {
  const head = key?.[0];
  return head === 'signMessage' || head === 'signTypedData';
}

function containsDerivationMessage(value: unknown, depth = 0): boolean {
  if (depth > 3) return false;
  const messages = Object.values(KEY_DERIVATION_MESSAGES);
  if (typeof value === 'string') return messages.includes(value);
  if (Array.isArray(value)) return value.some((v) => containsDerivationMessage(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.values(value).some((v) => containsDerivationMessage(v, depth + 1));
  }
  return false;
}

/** Empty array = clean. */
export function auditMutationCache(entries: readonly CachedMutation[]): CacheLeak[] {
  const leaks: CacheLeak[] = [];
  for (const entry of entries) {
    const keyLabel = JSON.stringify(entry.mutationKey ?? null);

    if (isSigningMutationKey(entry.mutationKey)) {
      leaks.push({
        where: 'mutationKey',
        mutationKey: keyLabel,
        detail: 'a signing mutation exists — use signMessage from wagmi/actions instead of a hook',
      });
    }
    if (looksLikeSignature(entry.data)) {
      leaks.push({
        where: 'data',
        mutationKey: keyLabel,
        detail: 'a settled mutation is retaining something shaped like a signature',
      });
    }
    // The derivation message is public — it is rendered verbatim during
    // onboarding — but it is the other half of the preimage pair, and its
    // presence means a signing call went through the cache.
    if (containsDerivationMessage(entry.variables)) {
      leaks.push({
        where: 'variables',
        mutationKey: keyLabel,
        detail: 'a mutation is retaining the key-derivation message',
      });
    }
  }
  return leaks;
}

/** One printable line, or null when clean. Never includes the leaked value. */
export function leakReport(leaks: readonly CacheLeak[]): string | null {
  if (leaks.length === 0) return null;
  const lines = leaks.map((l) => `  • ${l.where} of ${l.mutationKey}: ${l.detail}`);
  return (
    'Lumen key-material audit FAILED — the wallet signature or its preimage is reachable from ' +
    `the query cache:\n${lines.join('\n')}\n` +
    'See lib/crypto/cacheAudit.ts. docs/privacy-model.md claims this cannot happen.'
  );
}
