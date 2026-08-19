# Lumen — Own your mind. Prove your privacy.

A private, user-owned AI journaling companion built on **0G**. You write; Lumen
reflects and remembers. The difference from every other AI journal: every
reflection runs inside **0G Compute's TEE "Sealed Inference,"** so the model
provider — and Lumen itself — *cannot read your words*, and you can inspect the
proof. Your memory lives **encrypted on 0G Storage** — encrypted on your device,
uploaded and owned by *your* wallet (Wave 2, live) — and your companion becomes
an **ERC-7857 INFT you own** (Wave 3).

> One line: *the only AI you can trust with your inner life, because the trust is
> enforced in hardware and on-chain — not promised in a privacy policy.*

Built for the **0G Bridge by AKINDO WaveHack**. This repo is **Waves 1–2**.

---

## Why Lumen can only exist on 0G

| 0G module | What it gives Lumen | Status |
|---|---|---|
| **0G Compute — TEE Sealed Inference** | Provably-private reflection. Every inference runs in an Intel TDX + NVIDIA H100/H200 enclave; the provider can't read your prompt or memory. **This is the product.** | **Live in Wave 1** |
| **0G Storage — Log layer** | Encrypted memory snapshots (entries + embedding vectors), encrypted client-side, **signed and paid for by the user's own wallet** (the encrypted bytes are relayed by Lumen because 0G's nodes are HTTP-only — see Honesty). The snapshot rootHash is the memory root Wave 3 anchors. (KV index arrives with the W3 anchor once a hosted testnet KV endpoint is documented.) | **Live in Wave 2** |
| **0G Chain + ERC-7857 (Agentic ID)** | Your companion minted as an INFT you own, export, and transfer; an on-chain anchor for your encrypted memory root. | Wave 3 (mainnet) |
| **0G Compute — Whisper (TeeML)** | Voice entries transcribed by whisper-large-v3 inside a TEE. | **Live in Wave 2** |
| **0G Pay / x402** | Pay-per-use premium tier (deeper models, longer memory). | Wave 4 |

## Status — Wave 1 (working core loop)

**Write → streaming private reflection → 🔒 Verified-private badge → one-tap
attestation viewer → session memory → wallet "save & own" stub.**

- ✅ Clean, calm journaling UI (typography-first, light + true-dark) — write before connecting a wallet.
- ✅ 0G Compute Router inference in **private trust mode** through a thin gateway (a Next.js Route Handler that holds the API key).
- ✅ **🔒 Verified private** badge on every reflection + an honest attestation viewer (TEE hardware, model, the `ZG-Res-Key` proof reference, and exactly what is/isn't proven in Wave 1).
- ✅ In-session memory (recent turns become model context).
- ✅ **Demo mode**: with no API key set, the loop still runs against a clearly-labeled mock (badge reads *"Demo — not live TEE"*) so it's always clickable.
- ✅ Client-side **AES-GCM + wallet-signature key-derivation** crypto foundation, unit-tested (wired into storage in Wave 2).

Not in Wave 1 (by design): Storage persistence, INFT minting, payments — those are Waves 2–4.

## Status — Wave 2 (encrypted memory, owned by your wallet)

**One signature → your journal is encrypted on-device → your wallet saves it to
0G Storage → restore it anywhere → Lumen remembers what matters.**

- ✅ **Sign-to-unlock key ceremony**: one free signature derives a non-extractable AES-GCM key (WebCrypto only). Memory-only; refresh relocks. A key-check value catches non-deterministic wallet signatures with a clear error instead of garbage.
- ✅ **Envelope v2 encryption**: every turn, vector, and snapshot is AAD-bound (type + key version + wallet + slot) — blobs can't be replayed across wallets, slots, or snapshots. Plaintext padded to power-of-two buckets so public sizes leak only coarse magnitude.
- ✅ **Ciphertext-only local store** (IndexedDB): entries survive refresh; DevTools shows only base64 ciphertext — "no plaintext at rest," checkable in 10 seconds.
- ✅ **Save to 0G — user-signed**: your wallet (not Lumen) submits and pays the storage tx on the 0G Log layer. Lumen is not in the storage path at all. Receipt shows the memory root + tx, with **"Verify on 0G"** and **"Prove I own it"** (fresh download + local decrypt) affordances.
- ✅ **Restore-by-root**: paste a root hash on any device, sign with the same wallet, your journal comes back — snapshots also chain (`prevRootHash`) for tamper-evidence.
- ✅ **Recovery key** export (32-byte key material, loud warnings) + recovery-key unlock.
- ✅ **On-device recall**: MiniLM embeddings in a lazy Web Worker (0G has no embeddings model yet — disclosed); relevant older entries quietly inform new reflections. Text never leaves the device for embedding; vectors are encrypted at rest.
- ✅ **Voice entries**: whisper-large-v3 (TeeML) via a feature-flagged gateway route; transcript lands in the composer for review; no key → no mic (never a mock).

**Live demo:** https://lumen-snowy-two.vercel.app (real 0G TEE inference — GLM-5.1, TeeML) · **Demo video:** _<add link>_

## Architecture (summary)

```
Client (Next.js PWA)  ──prompt──▶  Gateway (Next API route, holds key)  ──private mode──▶  0G Compute (TEE)
  · journaling UI                    · injects X-0G-Provider-Trust-Mode: private            · Sealed Inference
  · attestation viewer  ◀──SSE────   · reads ZG-Res-Key proof ref     ◀──tokens+headers──   · GLM-5.1 + Whisper
  · client-side crypto               · logs no content, stores no audio
  · IndexedDB (ciphertext only)
  · MiniLM recall (Web Worker)
        │
        └──encrypted snapshot, USER-signed tx (Lumen not in this path)──▶  0G Storage Log layer
```

## Run locally

Requires Node ≥ 18.18 and pnpm.

```bash
pnpm install

# optional — for REAL Sealed Inference (otherwise demo mode runs automatically):
cp .env.example apps/web/.env.local
# then set ZG_COMPUTE_API_KEY (create a key at https://pc.0g.ai, deposit a little 0G)
# optional — voice: set ZG_VOICE_API_KEY (an sk- Router key) to enable the mic
# storage saves need only YOUR wallet + a little 0G. Lumen ships on 0G MAINNET
# (saves ~0.001 0G); set NEXT_PUBLIC_ZG_NETWORK=testnet for free faucet 0G instead

pnpm dev          # → http://localhost:3000
```

Other scripts: `pnpm build` · `pnpm start` · `pnpm test` (crypto unit tests) ·
`pnpm typecheck`.

### Deploy (Vercel)
- Root directory: `apps/web` · Install: `pnpm install --frozen-lockfile` · Build: `pnpm --filter @lumen/web build`.
- Set `ZG_COMPUTE_API_KEY` (and optional `ZG_COMPUTE_MODEL`) in Vercel project env. Without it, the deployment runs in demo mode. Add `ZG_VOICE_API_KEY` to enable voice.

## Honesty (the moat is *provable* privacy — so we don't overclaim)

In Waves 1–2, inference is proxied through Lumen's gateway to keep the Compute API
key secret. The **TEE protects your words from the model provider**, but the
gateway is technically in the plaintext path *for the inference and voice
transcription calls* (it stores no entries, keeps no audio, and logs no content).
**Stored data is different**: it is encrypted on your device and the upload is
signed and paid for by your own wallet. One honest caveat: 0G's storage nodes
serve plain HTTP, and a browser refuses to send anything from an HTTPS page to
an HTTP one (mixed content), so Lumen relays the already-encrypted bytes to
those nodes on the browser's behalf. It holds no key and cannot read them, and
the on-chain transaction is still yours. What an
on-chain observer *can* see: that your wallet saved an encrypted blob of a
(padded) size at a time — never the content. The gateway leaves the inference
plaintext path in Wave 3 via wallet-signed Direct-SDK inference, which also
unlocks per-request cryptographic verification.

## Repo layout

```
apps/web            Next.js PWA — UI, gateway route, lib/0g, lib/crypto, lib/memory
packages/shared     verified 0G network params, model catalog, shared types
services/gateway    stub (Wave 1 gateway lives in apps/web/app/api/reflect)
contracts           stub (ERC-7857 INFT + memory anchor — Wave 3)
```

## Roadmap

W1 core loop ✅ · **W2** encrypted Storage memory + recall + voice ✅ · **W3** mainnet +
verified contracts + ERC-7857 ownership + wallet-signed inference · **W4** 0G Pay /
x402 premium + launch + metrics · **W5** scale + insights + Token2049 demo.

## License

MIT
