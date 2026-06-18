# Lumen — Own your mind. Prove your privacy.

A private, user-owned AI journaling companion built on **0G**. You write; Lumen
reflects and remembers. The difference from every other AI journal: every
reflection runs inside **0G Compute's TEE "Sealed Inference,"** so the model
provider — and Lumen itself — *cannot read your words*, and you can inspect the
proof. Your memory will live encrypted on **0G Storage** (Wave 2), and your
companion becomes an **ERC-7857 INFT you own** (Wave 3).

> One line: *the only AI you can trust with your inner life, because the trust is
> enforced in hardware and on-chain — not promised in a privacy policy.*

Built for the **0G Bridge by AKINDO WaveHack**. This repo is **Wave 1**.

---

## Why Lumen can only exist on 0G

| 0G module | What it gives Lumen | Status |
|---|---|---|
| **0G Compute — TEE Sealed Inference** | Provably-private reflection. Every inference runs in an Intel TDX + NVIDIA H100/H200 enclave; the provider can't read your prompt or memory. **This is the product.** | **Live in Wave 1** |
| **0G Storage — Log + KV** | Encrypted journal history (Log) + live memory index/embeddings (KV), client-encrypted before upload. | Wave 2 |
| **0G Chain + ERC-7857 (Agentic ID)** | Your companion minted as an INFT you own, export, and transfer; an on-chain anchor for your encrypted memory root. | Wave 3 (mainnet) |
| **0G Pay / x402** | Pay-per-use premium tier (deeper models, voice, longer memory). | Wave 4 |

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

**Live demo:** _<add Vercel URL>_ · **Demo video:** _<add link>_

## Architecture (summary)

```
Client (Next.js PWA)  ──prompt──▶  Gateway (Next API route, holds key)  ──private mode──▶  0G Compute Router (TEE)
  · journaling UI                    · injects X-0G-Provider-Trust-Mode: private            · Sealed Inference
  · attestation viewer  ◀──SSE────   · reads ZG-Res-Key proof ref     ◀──tokens+headers──   · Intel TDX + H100/H200
  · client-side crypto               · logs no content
```

Full diagram + data flow: [`docs/architecture.md`](docs/architecture.md). Honest
threat model: [`docs/privacy-model.md`](docs/privacy-model.md). 0G specifics
(verified) + forward plan: [`docs/0g-integration.md`](docs/0g-integration.md).

## Run locally

Requires Node ≥ 18.18 and pnpm.

```bash
pnpm install

# optional — for REAL Sealed Inference (otherwise demo mode runs automatically):
cp .env.example apps/web/.env.local
# then set ZG_COMPUTE_API_KEY (create a key at https://pc.0g.ai, deposit a little 0G)

pnpm dev          # → http://localhost:3000
```

Other scripts: `pnpm build` · `pnpm start` · `pnpm test` (crypto unit tests) ·
`pnpm typecheck`.

### Deploy (Vercel)
- Root directory: `apps/web` · Install: `pnpm install --frozen-lockfile` · Build: `pnpm --filter @lumen/web build`.
- Set `ZG_COMPUTE_API_KEY` (and optional `ZG_COMPUTE_MODEL`) in Vercel project env. Without it, the deployment runs in demo mode.

## Honesty (the moat is *provable* privacy — so we don't overclaim)

In Waves 1–2, inference is proxied through Lumen's gateway to keep the Compute API
key secret. The **TEE protects your words from the model provider**, but the
gateway is technically in the plaintext path *for the inference call* (it stores
no entries and logs no content). Stored data becomes end-to-end-encrypted in Wave
2; the gateway leaves the plaintext path in Wave 3 via wallet-signed Direct-SDK
inference, which also unlocks per-request cryptographic verification. See
[`docs/privacy-model.md`](docs/privacy-model.md).

## Repo layout

```
apps/web            Next.js PWA — UI, gateway route, lib/0g, lib/crypto, lib/memory
packages/shared     verified 0G network params, model catalog, shared types
services/gateway    stub (Wave 1 gateway lives in apps/web/app/api/reflect)
contracts           stub (ERC-7857 INFT + memory anchor — Wave 3)
docs                architecture, 0g-integration, privacy-model, wave submissions
```

## Roadmap

W1 core loop · **W2** Storage memory + embeddings recall + voice · **W3** mainnet +
verified contracts + ERC-7857 ownership + wallet-signed inference · **W4** 0G Pay /
x402 premium + launch + metrics · **W5** scale + insights + Token2049 demo.

## License

MIT
