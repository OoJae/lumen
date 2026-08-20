'use client';

import { exportTrustNotice } from '@/lib/crypto/unlockCopy';
import type { KeyTrust } from '@/lib/crypto/keyTrust';
import { useEffect, useState } from 'react';

import type { JournalMemory } from '@/lib/hooks/useJournalMemory';
import { CloseIcon, KeyIcon } from './icons';

/**
 * Recovery-key export. Reveals the 32-byte key material (hex) — NOT the wallet
 * signature — after an explicit re-sign. Nothing is stored anywhere.
 */
export function RecoveryKeyModal({
  memory,
  onClose,
}: {
  memory: JournalMemory;
  onClose: () => void;
}) {
  const [hex, setHex] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** How well Lumen could check the exported key. Shown beside it — exporting
   *  an unchecked key is legitimate on a new journal, but the user must know. */
  const [trust, setTrust] = useState<KeyTrust | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      // Don't leave 32 bytes of key material in React state after the modal
      // closes; it is the one secret this component holds.
      setHex(null);
      setTrust(null);
    };
  }, [onClose]);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const exported = await memory.exportRecoveryKey();
      setHex(exported.hex);
      setTrust(exported.trust);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!hex) return;
    const blob = new globalThis.Blob(
      [
        `Lumen recovery key — keep this offline and private.\n\n${hex}\n\n` +
          'Anyone who has this key can read your entire journal. Lumen never sees it ' +
          'and cannot recover it for you.\n',
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lumen-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Recovery key"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-surface p-6 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent">
              <KeyIcon />
            </span>
            <p className="font-serif text-lg leading-tight text-ink">Your recovery key</p>
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

        <p className="rounded-xl border border-caution/40 bg-caution/5 p-3 text-sm leading-relaxed text-caution">
          This key decrypts your entire journal. Anyone who has it can read everything. Lumen
          never sees it, never stores it, and cannot recover it for you. If you lose access to
          your wallet <em>and</em> this key, your encrypted entries are unreadable forever — by
          everyone, including us.
        </p>

        {hex === null ? (
          <button
            type="button"
            onClick={() => void reveal()}
            disabled={busy}
            className="mt-4 w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-[#fffdf8] hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Check your wallet…' : 'Reveal — your wallet will ask you to sign'}
          </button>
        ) : (
          <>
            <code className="mt-4 block break-all rounded-xl border border-border bg-canvas/50 p-3 font-mono text-xs leading-relaxed text-ink">
              {hex}
            </code>
            {trust && (
              <p
                className={`mt-2 text-xs leading-relaxed ${
                  trust === 'proven' ? 'text-muted' : 'text-caution'
                }`}
              >
                {exportTrustNotice(trust)}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(hex).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  });
                }}
                className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted hover:border-accent/40 hover:text-ink"
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={download}
                className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted hover:border-accent/40 hover:text-ink"
              >
                Download .txt
              </button>
            </div>
          </>
        )}

        {error && <p className="mt-3 text-sm text-caution">{error}</p>}
      </div>
    </div>
  );
}
