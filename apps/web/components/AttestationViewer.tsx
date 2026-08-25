'use client';

import { useEffect } from 'react';

import { useModalFocus } from '@/lib/hooks/useModalFocus';
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
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const { label, tone } = statusPresentation(attestation.verificationStatus);
  const isDemo = attestation.verificationStatus === 'demo';
  const isAlarm = tone === 'alarm';
  const proof = attestation.proof;
  const when = new Date(attestation.timestamp).toLocaleString();

  const panelRef = useModalFocus<HTMLDivElement>();

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
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`grid h-9 w-9 place-items-center rounded-full ${
                isAlarm
                  ? 'bg-red-500/10 text-red-500'
                  : isDemo
                    ? 'bg-caution/10 text-caution'
                    : 'bg-accent-soft text-accent'
              }`}
            >
              <ShieldIcon />
            </span>
            <div>
              <p className="font-serif text-lg leading-tight text-ink">{label}</p>
              <p className="text-xs text-muted">
                {isAlarm
                  ? 'The signature did not match these bytes'
                  : tone === 'verified'
                    ? 'Processed inside a hardware enclave'
                    : tone === 'muted'
                      ? // NOT "Checking the enclave signature…". That was written when
                        // muted meant "in progress"; since verification became the
                        // normal path for every visitor, muted is where a finished
                        // check FAILED to complete — so it sat there, permanently,
                        // claiming to still be working.
                        'Enclave registered on-chain — this response unverified'
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
          {attestation.inferencePath ? (
            <Field
              label="Path"
              value={
                attestation.inferencePath === 'browser-direct'
                  ? 'browser → 0G provider (Lumen not in the path)'
                  : attestation.inferencePath === 'gateway'
                    ? "relayed by Lumen's gateway"
                    : 'local mock'
              }
            />
          ) : null}
          {attestation.proofReference ? (
            <Field label="Proof ref (ZG-Res-Key)" value={attestation.proofReference.chatId} mono />
          ) : null}
        </div>

        {proof && (
          <div className="mt-4 rounded-xl border border-border bg-canvas/50 px-4 py-1">
            <Field
              label="Enclave signature"
              value={proof.checks.signature ? 'matches on-chain signer ✓' : 'DOES NOT MATCH ✕'}
            />
            <Field
              label="Response hash"
              value={proof.checks.responseHash ? 'matches these bytes ✓' : 'DOES NOT MATCH ✕'}
            />
            {/* The derivation itself, not a verdict about it. Recovering this
                address from the signature and finding it equal to the on-chain
                one IS the proof — showing only a checkmark asked for trust
                exactly where evidence was promised. */}
            {proof.recovered && (
              <Field label="Recovered from signature" value={proof.recovered} mono />
            )}
            <Field label="TEE signer (on-chain)" value={proof.teeSignerAddress} mono />
            <Field label="SHA-256 of response" value={proof.responseSha256} mono />
            <Field label="Signature" value={proof.signature} mono />
            <Field label="Verified at" value={new Date(proof.verifiedAt).toLocaleString()} />
          </div>
        )}

        <p className="mt-4 text-sm leading-relaxed text-muted">{attestation.note}</p>

        {!isDemo && (
          <div className="mt-4 rounded-xl border border-border bg-canvas/40 p-3 text-xs leading-relaxed text-muted">
            <p className="mb-1 font-medium text-ink">What this proves — honestly</p>
            {proof?.checks.signature && proof.checks.responseHash ? (
              <>
                Your browser checked this itself: the bytes above hash to the value the
                provider&apos;s enclave signed, and that signature recovers to the enclave key the
                provider registered on-chain. Nothing between the enclave and this device altered
                the response — not the network, not Lumen&apos;s gateway.{' '}
                {attestation.inferencePath === 'gateway' &&
                  'The gateway still relays the request itself, so for the duration of the call it sees the prompt — which includes your recent entries and any older ones your companion recalled, in plaintext. It stores nothing and logs nothing, and it cannot read anything at rest. '}
                What is <em>not</em> proven: the request digest in the signed statement (we display
                it but have not confirmed how the provider derives it), so we make no claim that
                your prompt is cryptographically bound to this response.
              </>
            ) : (
              <>
                Lumen asks for private trust mode on every call, and nothing in the response
                proves the provider honoured it — a header is a request, not an attestation. What
                is checkable is that this provider is registered on-chain as running the model
                inside a TEE. A per-request signature was not confirmed on this device
                {proof ? ' — the check did not pass' : ' (the provider expires signatures)'}, so
                this reflection rests on that registration rather than on a proof.
              </>
            )}
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
