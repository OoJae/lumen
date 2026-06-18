# Lumen — Wave 1 Submission

**Wave 1 focus:** Project scoping + 0G integration plan + a working core loop.
**Judging (Foundation):** Vision & 0G Fit 40% · Technical Approach 30% · Team & Execution 30%.

## 1. Project information

**Name:** Lumen

**One-liner (≤30 words):**
> Lumen is a private, user-owned AI journaling companion. Every reflection runs inside 0G's TEE so no one — not even us — can read your thoughts, and you can prove it.

**Summary:**
> Lumen is an AI companion for journaling and reflection you can actually trust with your inner life. Unlike any other AI journal, every inference runs through 0G Compute's TEE "Sealed Inference," so the model provider — and Lumen itself — cannot read your prompt or memory, and you can inspect a hardware attestation that proves it. Your journal history and the companion's memory will live encrypted on 0G Storage (Wave 2); by Wave 3 your companion is minted as an ERC-7857 INFT on 0G Chain that you own and can export or transfer; premium features are paid with 0G Pay / x402 (Wave 4). Lumen uses **0G Compute** (TEE inference — the core, live now), **0G Storage** (encrypted memory), **0G Chain + ERC-7857** (ownership), and **0G Pay / x402** (monetization). The thesis: provable privacy and true ownership of a personal AI can only exist on 0G.

## 2. 0G integration plan

See [`docs/0g-integration.md`](../0g-integration.md) for the verified specifics
(endpoints, header, attestation retrieval, model list, the contested testnet
chainId, and the W2–W4 forward plan).

| 0G component | How | Depth | Wave |
|---|---|---|---|
| 0G Compute — TEE Sealed Inference | Private-mode reflection via the Router; attestation viewer | Load-bearing | **W1 live** → W3 Direct SDK |
| 0G Storage — Log + KV | Encrypted history + live index/embeddings | Load-bearing | W2 |
| 0G Chain + ERC-7857 | Companion INFT + memory-root anchor | Load-bearing | W3 (mainnet) |
| 0G Pay / x402 | Pay-per-use premium | Supporting | W4 |

## 3. What's built (working core loop)

- Clean journaling/chat UI (serif notebook, warm amber, light + true-dark), write-before-wallet.
- 0G Compute Router inference in **private trust mode** through a thin gateway (Next.js Route Handler holding the key), **streamed** to the client over SSE.
- **🔒 Verified private** badge on every reflection + a one-tap **attestation viewer** (TEE hardware, model, `ZG-Res-Key` proof reference, and an honest statement of what's proven in W1 vs W3).
- In-session memory (recent turns → model context).
- **Demo mode** so the loop is always clickable without a key (badge clearly reads "Demo — not live TEE").
- Tested client-side **AES-GCM + wallet-signature key-derivation** crypto foundation (wired into storage in W2).

**Verification:** production build passes (type-checked); `pnpm test` → 9/9 crypto
tests pass; the demo-mode SSE loop is confirmed end-to-end (token stream → final
attestation event).

**Live demo:** https://lumen-snowy-two.vercel.app (real 0G TEE inference) · **Repo:** https://github.com/OoJae/lumen · **Demo video:** _<link>_

## 4. Demo video script (≤3 min)

- **0:00–0:20 — Hook.** "You'd never paste your private journal into ChatGPT — someone could read it. Lumen is an AI journal where no one can, and we can prove it. Built on 0G."
- **0:20–0:50 — Vision + 0G fit (slide).** One line each: provable privacy (0G TEE), encrypted memory (0G Storage), ownership (ERC-7857), payments (0G Pay). "These make Lumen impossible to build anywhere but 0G."
- **0:50–1:50 — Live loop.** Write a real, personal-feeling entry → reflection streams in → point at **🔒 Verified private** → tap **view proof** → "this ran in private trust mode inside a hardware enclave; the provider couldn't read it. Here's the proof reference and the honest scope."
- **1:50–2:30 — Architecture + roadmap (slide).** System diagram + 20-second data-flow; W2 memory, W3 mainnet + INFT, W4 payments.
- **2:30–3:00 — Team & close.** Who, why we'll ship all five waves, Token2049 ambition. "Own your mind. Prove your privacy."

## 5. X post (draft)

> 🔒 Introducing **Lumen** — a private, user-owned AI journaling companion built on @0G_labs.
>
> You'd never paste your journal into ChatGPT. With Lumen you can — every reflection runs inside 0G's TEE Sealed Inference, so no one (not even us) can read your thoughts. And you can verify it.
>
> Live now, real on-chain TEE inference 👇
> https://lumen-snowy-two.vercel.app
>
> #0GBridge #BuildOn0G
> @0G_labs @0G_Builders @AKINDO_io

Attach a ≤30s screen clip: write an entry → reflection streams → tap 🔒 → attestation viewer (model GLM-5.1, TeeML, proof reference).

## 6. Submission checklist

- [ ] Project information (above)
- [ ] Public GitHub repo with meaningful commits + README
- [ ] 0G integration **plan** (this doc + `docs/0g-integration.md`)
- [ ] Demo video (≤3 min, public)
- [ ] Documentation (architecture, privacy-model, integration)
- [ ] Public X post (`#0GBridge #BuildOn0G`, tags `@0G_labs @0G_Builders @AKINDO_io`)
- [ ] (Bonus) live demo URL + "how Sealed Inference makes Lumen possible" note

## 7. Pre-submit self-check

- **Vision & 0G Fit (40%):** the "provable privacy + true ownership, only-on-0G" thesis is explicit in README, summary, and video; all four 0G components named with *how*. ✅
- **Technical Approach (30%):** a real working loop (not slides); concrete architecture + data flow; honestly-scoped threat model. ✅
- **Team & Execution (30%):** the demo works live (incl. demo-mode fallback); meaningful commit history; credible 5-wave roadmap. ✅
