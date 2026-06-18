# Privacy & threat model (read this — honesty *is* the product)

Lumen's entire reason to exist is **provable** privacy. Overclaiming would be
fatal (crypto-natives and judges will probe it), so this document states
precisely what is and isn't guaranteed at each wave. If we can't prove a claim, we
don't make it.

## What "🔒 Verified private" means in Wave 1 — exactly

> Your words were processed in **private trust mode inside a hardware TEE** (Intel
> TDX + NVIDIA H100/H200), so the **model provider could not read them**, and the
> response carries a per-request proof reference (`ZG-Res-Key`).

It does **not** yet mean "cryptographically proven to you, this observer, that
this specific response came from a genuine enclave" — that is per-request
verification via the Direct SDK (`processResponse`), which arrives in **Wave 3**.
The viewer says this in plain language.

In **demo mode** (no API key configured), the badge reads **"Demo — not live
TEE"** and the reflection is a local mock. We never dress a mock up as real.

## The guarantees (by wave)

1. **Confidentiality during inference (W1+).** 0G Sealed Inference processes the
   prompt inside a hardware TEE; the GPU/model provider cannot read it; the
   response is signed inside the enclave.
2. **Confidentiality of stored data (W2+).** Every entry/reflection is encrypted
   **client-side** with AES-GCM *before* it leaves the device. The key is derived
   from a **wallet signature** (deterministic, never transmitted). Storage nodes —
   and Lumen — only ever see ciphertext. *(The crypto layer is built and tested in
   Wave 1; storage upload lands in Wave 2.)*
3. **Ownership (W3+).** The companion + memory pointer is an **ERC-7857 INFT** the
   user holds; export/transfer is user-controlled; transfers re-encrypt via the
   TEE oracle.

## The honest threat model

### Waves 1–2 — the gateway path
To keep the Compute API key secret, inference is proxied through Lumen's gateway
(a Next.js Route Handler). The TEE guarantees the **provider** can't read
plaintext, but the **gateway is technically in the plaintext path for the
inference call.**

**Mitigations:**
- The gateway holds **no long-term plaintext** and **logs no entry/reflection
  content**.
- All *stored* data is end-to-end-encrypted client-side (from W2) — the gateway
  never sees stored memory, only the transient prompt for the live call.
- This limitation is **labeled in-app** (the attestation viewer) and here.

**We therefore do _not_ claim full end-to-end-private inference in Waves 1–2.**

### Wave 3+ — the trust-minimized path
We move to the **Direct SDK with wallet-signed requests**, so the user authorizes
inference themselves and the **gateway leaves the plaintext path**. Only then do we
make the stronger claim — and it's a great demo beat: *"we removed ourselves from
the loop."* This same change turns on per-request cryptographic verification.

### Key management
Wallet-signature-derived keys mean **losing the wallet = losing decryptable
history.** Lumen will offer an explicit, user-controlled **export/backup** of the
derived key with loud warnings. We **never custody** the key or the signature.

### Metadata
Even when content is unreadable, **timing and size metadata** (e.g. response
latency correlating with prompt length, request counts) may be observable. We
minimize what we touch and document it rather than pretend it away.

## Security hygiene
- **No secrets in the repo** — `.env.example` only; the Compute key lives in
  platform secrets (Vercel env), server-side.
- The gateway runs on the **Node runtime**, validates input, and streams without
  persisting content.
- Client-side crypto uses **native WebCrypto** (no third-party crypto dependency);
  the derivation is deterministic and unit-tested (round-trip + determinism + wrong-key rejection + fresh-IV).
- (W3) Contracts kept minimal, tested, and verified on-chain; deploy wallet is a
  **deploy-only hot wallet**, funded minimally.

## TL;DR claim ladder
- **W1 (now):** "Processed inside an attested TEE in private trust mode; provider
  can't read it; here's the proof reference." Gateway in plaintext path —
  disclosed.
- **W2:** + "Your stored memory is encrypted on your device before it ever
  leaves." 
- **W3:** + "Cryptographically verified per request, and we (the gateway) are no
  longer in the path. You own the companion on-chain."
