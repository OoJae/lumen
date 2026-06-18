# CLAUDE.md — Lumen project context

## Project
Lumen: a private, user-owned AI companion for journaling & reflection, built on 0G for the "0G Bridge by AKINDO" WaveHack (5 waves). Moat = PROVABLE PRIVACY (0G TEE Sealed Inference) + TRUE OWNERSHIP (ERC-7857 INFT). Pitch: "Own your mind. Prove your privacy." **Wave 1 is built and working** (see Status).

## Golden rules
- One companion, done beautifully. NO trading/DeFi/agent-swarm/marketplace scope creep.
- ALL personal data encrypted client-side (AES-GCM, wallet-sig-derived key, never transmitted) before any upload.
- Be honest about the threat model (docs/privacy-model.md). Don't overclaim E2E inference while the gateway is in the plaintext path (Waves 1–2). Tighten via Direct SDK / wallet-signed inference in Wave 3.
- Provable privacy must be unmistakable in UX: 🔒 Verified-private state + one-tap attestation viewer.
- VERIFY 0G specifics against live docs/repos before integrating. Tools are new (2026) and move.

## Architecture (built)
Client (Next.js App Router PWA: UI + client crypto + wallet stub + attestation viewer) → thin Gateway (`apps/web/app/api/reflect/route.ts`, Node runtime, holds Compute key, private-mode inference, SSE streaming) → 0G Compute Router (TEE Sealed Inference). All inference behind `apps/web/lib/0g/compute.ts` (swap to Direct SDK in W3 with no caller change). Network params centralized in `packages/shared`.

## Verified 0G facts (Wave 1 — confirmed against live docs/repos, mid-2026)
- **Compute Router**: `https://router-api.0g.ai/v1`, OpenAI-compatible, `Authorization: Bearer sk-<KEY>` (key from pc.0g.ai). Private mode header `X-0G-Provider-Trust-Mode: private` (confirmed from live pc.0g.ai; one source says TEE is default — we send the header regardless). Per-request proof ref in `ZG-Res-Key` response header.
- **Models**: glm-5 (default), deepseek-v3, gpt-oss-120b, qwen3-vl, whisper-large-v3, z-image. **No embeddings model** → W2 uses a client-side fallback. Exact model id strings to be confirmed vs live `/v1/models` on first keyed run; model is env-configurable (`ZG_COMPUTE_MODEL`).
- **Per-request crypto verify** (`broker.inference.processResponse(providerAddress, chatID)`) needs the Direct SDK `@0glabs/0g-serving-broker` (v0.7.4) — the hosted Router hides providerAddress, so this is a **Wave 3** capability. W1 surfaces trust-mode + proof ref honestly.
- **Chain**: Mainnet Aristotle chainId 16661, RPC `https://evmrpc.0g.ai`, explorer chainscan.0g.ai, `evmVersion: cancun`. **Testnet Galileo chainId is CONTESTED: 16601 vs 16602** (docs/ChainList say 16602; an official relaunch post + ThirdWeb say 16601). It's env-driven (`NEXT_PUBLIC_ZG_CHAIN_ID`, default 16602) — confirm via wallet "Add Network" before any W3 transaction.
- **Storage (W2)**: `@0glabs/0g-ts-sdk`; flow contracts testnet `0x22E0…5296` / mainnet `0x62D4…C526`; indexer `https://indexer-storage-testnet-turbo.0g.ai`.
- **ERC-7857 (W3)**: ref `github.com/0gfoundation/0g-agent-nft` (EIP-7857). **0G Pay (W4)**: proprietary payment layer; x402 is a separate standard not yet confirmed-integrated.

## Tech (locked, known-good)
Next 15 (App Router, Node runtime) · React 19 · TS 5.7 · Tailwind v4 (CSS-first, `@tailwindcss/postcss`, **no tailwind.config.js**) · **wagmi 2 + viem 2 + RainbowKit 2** (NOT wagmi 3 — RainbowKit pins ^2.9.0) · @tanstack/react-query 5 · openai 6 (`.withResponse()` to read `ZG-Res-Key`). pnpm workspace; `apps/web` is the Vercel root. Aesthetic: serif notebook, warm amber, light + true-dark.

## Status
- **Wave 1: DONE & verified** — build passes, 9/9 crypto tests pass, demo-mode SSE loop confirmed end-to-end. Core loop: write → streaming private reflection → 🔒 badge → attestation viewer → session memory → wallet stub.
- Pending for submission: live Vercel URL, demo video, X post (see docs/wave-submissions/wave-1.md).

## Wave roadmap
- W1 ✅ core loop (UI + private inference + attestation + session memory).
- W2: 0G Storage encrypted memory (Log+KV) + embeddings recall + voice (Whisper) + onboarding.
- W3 (mainnet, highest leverage): deploy + VERIFY contracts; ERC-7857 INFT mint + memory-root anchor; move inference to Direct SDK / wallet-signed; real on-chain activity + public addresses.
- W4: 0G Pay / x402 premium; launch; growth; instrument signups/DAU/WAU/retention/on-chain tx.
- W5: scale + polish + insights dashboard + growth roadmap + Token2049 demo.

## Conventions
- TypeScript everywhere; Tailwind; calm typographic aesthetic (light + true dark).
- Small, frequent, meaningful git commits (rubric checks this).
- Never commit secrets; .env.example only. Deploy wallet = deploy-only hot wallet.
- Flag every assumption; ask before adding deps that touch plaintext/keys.

## Key files
- `apps/web/lib/0g/compute.ts` — inference seam (Router private mode; W3 → broker SDK here).
- `apps/web/lib/0g/attestation.ts` — single honest place for "what Verified-private means".
- `apps/web/app/api/reflect/route.ts` — gateway: SSE stream + final attestation event + demo fallback.
- `apps/web/lib/hooks/useStreamingReflection.ts` — client SSE consumer.
- `apps/web/lib/crypto/{keys,encrypt}.ts` — AES-GCM + wallet-sig derivation (tested; wired in W2).
- `packages/shared/src/{networks,models,types}.ts` — verified 0G params (single source of truth).
