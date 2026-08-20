'use client';

import { useEffect, useState } from 'react';

import { useModalFocus } from '@/lib/hooks/useModalFocus';
import { useConnectModal } from '@rainbow-me/rainbowkit';

import { getKeyDerivationMessage } from '@/lib/crypto/keys';
import type { JournalMemory } from '@/lib/hooks/useJournalMemory';
import { CloseIcon, KeyIcon, LockIcon, ShieldIcon, SparkIcon } from './icons';

/**
 * The "Save & own" conversion sheet. One signature is the entire ceremony —
 * this sheet explains exactly what that signature is (a key derivation) and
 * what it is not (a transaction), then adapts to the key state.
 */
export function OnboardingSheet({
  memory,
  onClose,
  onExportKey,
}: {
  memory: JournalMemory;
  onClose: () => void;
  onExportKey: () => void;
}) {
  const { openConnectModal } = useConnectModal();
  const [recoveryHex, setRecoveryHex] = useState('');
  const [restoreRoot, setRestoreRoot] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  const { keyState } = memory;

  const panelRef = useModalFocus<HTMLDivElement>();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Save and own your journal"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-surface p-6 shadow-2xl sm:rounded-3xl"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent">
              <ShieldIcon />
            </span>
            <p className="font-serif text-lg leading-tight text-ink">Own your memory</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        {keyState === 'no-wallet' && (
          <>
            <ol className="space-y-3 text-sm leading-relaxed text-muted">
              <Beat icon={<SparkIcon width={14} height={14} />}>
                <b className="font-medium text-ink">Write freely.</b> Reflections run inside a
                hardware enclave — tap the 🔒 badge on any reply for proof.
              </Beat>
              <Beat icon={<KeyIcon width={14} height={14} />}>
                <b className="font-medium text-ink">One signature derives your key.</b> It&apos;s
                free, it&apos;s not a transaction, and it never leaves this device. Everything you
                keep is encrypted with it before it goes anywhere.
              </Beat>
              <Beat icon={<LockIcon width={14} height={14} />}>
                <b className="font-medium text-ink">Save to 0G.</b> Your wallet — not Lumen —
                uploads the encrypted snapshot and owns it on-chain. Restore it anywhere with the
                same wallet.
              </Beat>
            </ol>
            <button
              type="button"
              onClick={() => openConnectModal?.()}
              className="mt-5 w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-[#fffdf8] hover:opacity-90"
            >
              Connect a wallet
            </button>
          </>
        )}

        {(keyState === 'locked' || keyState === 'unlocking') && (
          <>
            <p className="text-sm leading-relaxed text-muted">
              Your wallet will ask you to sign this message. Signing is free, is not a
              transaction, and derives the key that encrypts your journal — on this device only.
            </p>
            <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-border bg-canvas/50 p-3 text-xs leading-relaxed text-muted">
              {getKeyDerivationMessage()}
            </pre>
            <button
              type="button"
              onClick={() => void run('unlock', () => memory.unlock())}
              disabled={busy !== null || keyState === 'unlocking'}
              className="mt-4 w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-[#fffdf8] hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'unlock' || keyState === 'unlocking'
                ? 'Check your wallet…'
                : 'Sign to unlock'}
            </button>
            <RecoveryInput
              value={recoveryHex}
              onChange={setRecoveryHex}
              busy={busy === 'recover'}
              onSubmit={() =>
                void run('recover', () => memory.unlockWithRecoveryKey(recoveryHex))
              }
            />
          </>
        )}

        {keyState === 'mismatch' && (
          <>
            <p className="text-sm leading-relaxed text-caution">
              This wallet produced a different signature than when your journal was encrypted, so
              the derived key doesn&apos;t match. Nothing is lost — your entries are intact and
              decrypt with your recovery key.
            </p>
            <RecoveryInput
              value={recoveryHex}
              onChange={setRecoveryHex}
              busy={busy === 'recover'}
              alwaysOpen
              onSubmit={() =>
                void run('recover', () => memory.unlockWithRecoveryKey(recoveryHex))
              }
            />
          </>
        )}

        {keyState === 'unlocked' && (
          <>
            <p className="text-sm leading-relaxed text-muted">
              Unlocked. {memory.turns.length > 0 ? `${memory.turns.length} ${memory.turns.length === 1 ? 'entry is' : 'entries are'} encrypted on this device.` : 'Write an entry to begin.'}{' '}
              Use <b className="font-medium text-ink">Save to 0G</b> under the composer whenever
              you want your wallet to anchor the encrypted snapshot on 0G Storage.
            </p>
            <button
              type="button"
              onClick={onExportKey}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-4 py-2.5 text-sm font-medium text-accent hover:border-accent"
            >
              <KeyIcon width={14} height={14} />
              Export recovery key
            </button>
            <details className="mt-4 rounded-xl border border-border bg-canvas/40 p-3 text-sm text-muted">
              <summary className="cursor-pointer font-medium text-ink">
                Restore from a 0G root hash
              </summary>
              <p className="mt-2 text-xs leading-relaxed">
                Moving devices? Paste the root hash from your storage receipt. The snapshot is
                downloaded from 0G and decrypted here with your key.
              </p>
              <input
                value={restoreRoot}
                onChange={(e) => setRestoreRoot(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent/50"
              />
              <button
                type="button"
                disabled={busy !== null || !restoreRoot.trim().startsWith('0x')}
                onClick={() =>
                  void run('restore', async () => {
                    const result = await memory.restoreFromRoot(restoreRoot);
                    setRestored(result.restored);
                  })
                }
                className="mt-2 rounded-full border border-accent/40 px-3.5 py-1.5 text-xs font-medium text-accent hover:border-accent disabled:opacity-50"
              >
                {busy === 'restore' ? 'Restoring…' : 'Download & decrypt'}
              </button>
              {restored !== null && (
                <p className="mt-2 text-xs text-accent">
                  Restored {restored} {restored === 1 ? 'entry' : 'entries'} from 0G. ✓
                </p>
              )}
            </details>
          </>
        )}

        {error && <p className="mt-3 text-sm text-caution">{error}</p>}
      </div>
    </div>
  );
}

function Beat({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

function RecoveryInput({
  value,
  onChange,
  onSubmit,
  busy,
  alwaysOpen = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  alwaysOpen?: boolean;
}) {
  const body = (
    <>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="64 hex characters"
        spellCheck={false}
        className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent/50"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || value.trim().length < 64}
        className="mt-2 rounded-full border border-accent/40 px-3.5 py-1.5 text-xs font-medium text-accent hover:border-accent disabled:opacity-50"
      >
        {busy ? 'Unlocking…' : 'Unlock with recovery key'}
      </button>
    </>
  );
  if (alwaysOpen) {
    return <div className="mt-4 rounded-xl border border-border bg-canvas/40 p-3">{body}</div>;
  }
  return (
    <details className="mt-4 rounded-xl border border-border bg-canvas/40 p-3 text-sm text-muted">
      <summary className="cursor-pointer text-xs">Wallet unavailable? Use your recovery key</summary>
      {body}
    </details>
  );
}
