'use client';

import { useEffect } from 'react';
import type { AttestationInfo } from '@lumen/shared';
import { SEALED_INFERENCE_URL } from '@lumen/shared';
import { statusPresentation } from '@/lib/0g/attestation';
import { ShieldIcon, CloseIcon } from './icons';

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className={`text-right text-sm text-ink ${mono ? 'break-all font-mono text-xs' : ''}`}>
        {value}
      </span>
    </div>
  );
}

export function AttestationViewer({
  attestation,
  onClose,
}: {
  attestation: AttestationInfo;
  onClose: () => void;
}) {
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

  const { label, tone } = statusPresentation(attestation.verificationStatus);
  const isDemo = attestation.verificationStatus === 'demo';
  const when = new Date(attestation.timestamp).toLocaleString();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Attestation details"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-surface p-6 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`grid h-9 w-9 place-items-center rounded-full ${
                isDemo ? 'bg-caution/10 text-caution' : 'bg-accent-soft text-accent'
              }`}
            >
              <ShieldIcon />
            </span>
            <div>
              <p className="font-serif text-lg leading-tight text-ink">{label}</p>
              <p className="text-xs text-muted">
                {tone === 'verified'
                  ? 'Processed inside a hardware enclave'
                  : 'Mock response — no live enclave'}
              </p>
            </div>
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

        <div className="rounded-xl border border-border bg-canvas/50 px-4 py-1">
          <Field label="Trust mode" value={attestation.trustMode} />
          <Field label="TEE (CPU)" value={attestation.teeType} />
          <Field label="GPU" value={attestation.teeHardware} />
          <Field label="Model" value={attestation.model} />
          <Field label="Time" value={when} />
          {attestation.proofReference ? (
            <Field label="Proof ref (ZG-Res-Key)" value={attestation.proofReference.chatId} mono />
          ) : null}
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted">{attestation.note}</p>

        {!isDemo && (
          <div className="mt-4 rounded-xl border border-border bg-canvas/40 p-3 text-xs leading-relaxed text-muted">
            <p className="mb-1 font-medium text-ink">What this proves — honestly</p>
            Your words were processed in private trust mode inside a TEE, so the model provider
            could not read them. In Waves 1–2, inference is proxied through Lumen&apos;s gateway to
            keep the API key secret, so the gateway is technically in the plaintext path for the
            call (it stores no entries and logs no content). Per-request{' '}
            <em>cryptographic</em> verification arrives in Wave 3 via the wallet-signed Direct SDK.
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={SEALED_INFERENCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-accent hover:underline"
          >
            How Sealed Inference works ↗
          </a>
          <a
            href={attestation.learnMoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-muted hover:text-ink hover:underline"
          >
            Attestation docs ↗
          </a>
        </div>
      </div>
    </div>
  );
}
