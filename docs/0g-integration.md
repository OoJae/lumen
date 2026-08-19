# 0G Integration

Which 0G modules Lumen uses, how, and exactly what was confirmed against live
docs/repos (mid-2026) before wiring. Everything network-specific is centralized in
[`packages/shared`](../packages/shared/src) so nothing is hard-coded twice.

## Module plan

| 0G module | How Lumen uses it | Depth | Wave |
|---|---|---|---|
| **0G Compute — TEE Sealed Inference** | Every reflection is generated inside a hardware enclave via the OpenAI-compatible Router in **private trust mode**; the user inspects the attestation. *This is the product.* | Load-bearing | **W1** (Router) → W3 (Direct SDK / wallet-signed) |
| **0G Storage — Log + KV** | Encrypted journal history on the Log layer; live memory index + embeddings on KV. Client-encrypted first. | Load-bearing | W2 |
| **0G Chain + ERC-7857 (Agentic ID)** | Companion minted as an INFT the user owns; registry anchors the encrypted memory root; transfers re-encrypt via the TEE oracle. | Load-bearing | W3 (mainnet, verified) |
| **0G Pay / x402** | Pay-per-use premium tier. | Supporting | W4 |

## Wave 1 — Compute (what is wired now)

**Endpoint & auth (confirmed).** OpenAI-compatible Router at
`https://router-api.0g.ai/v1`, `Authorization: Bearer sk-<KEY>`; key from
[pc.0g.ai](https://pc.0g.ai) (no-KYC, deposit a little 0G). Held only by the
gateway (`ZG_COMPUTE_API_KEY`), never shipped to the client.

**Private / Sealed mode (confirmed, with a nuance).** We send the header
`X-0G-Provider-Trust-Mode: private` on every request — confirmed from the live
pc.0g.ai docs ("switch to fully private inference by adding a single header"). One
source describes the TEE as *always-on* with no header required; sending the
header is harmless if ignored and meaningful if honored, so we always send it.
The TEE is **Intel TDX + NVIDIA H100/H200**; responses are signed inside the
enclave.

**Attestation retrieval (confirmed).** The per-request proof reference (`chatID`)
is returned in the **`ZG-Res-Key`** response header (fallback: body `data.id` /
`data.chatID`). We capture it via the OpenAI SDK's `.withResponse()` and surface
it in the viewer. **Full cryptographic verification** — `broker.inference.processResponse(providerAddress, chatID)` — lives on the **Direct SDK**
(`@0glabs/0g-serving-broker`, v0.7.4) and needs a `providerAddress` that the hosted
Router abstracts away; it is therefore a **Wave 3** capability. Wave 1 honestly
shows trust-mode + proof reference and says so.

**Models (confirmed live).** `glm-5` (default), `deepseek-v3`, `gpt-oss-120b`,
`qwen3-vl`, `whisper-large-v3` (voice, W2), `z-image`. There is **no dedicated
embeddings model** yet → Wave 2 uses a small client-side embedding fallback with
encrypted vectors. Exact id strings should be reconfirmed against the live
`GET /v1/models` once a key is provisioned; the active model is env-configurable
(`ZG_COMPUTE_MODEL`).

### What actually shipped in Wave 1 (Direct path — verified live)

The deployed credential turned out to be a wallet-signed **`app-sk-` Direct-SDK
token** (from `0g-compute-cli inference get-secret`), **not** a hosted-Router
`sk-` key — the Router (`router-api.0g.ai`) rejects `app-sk-` for chat (401),
while `GET /v1/models` is public. So Wave 1 ships the **Direct provider path**,
which is actually a *stronger* privacy story:

- The token is sent as `Authorization: Bearer app-sk-…` to the **provider's own
  endpoint**, `POST ${providerUrl}/v1/proxy/chat/completions` (OpenAI-compatible).
  No wallet private key is needed at request time — the signature is baked into
  the token.
- The provider URL is discovered **read-only** (no wallet/funds) via
  `@0gfoundation/0g-compute-ts-sdk` (`createReadOnlyInferenceBroker(rpc).listService()`,
  filtered by the provider address embedded in the token). We discover once and
  bake `ZG_PROVIDER_URL` into env, so **no SDK/on-chain call happens at runtime**.
- **Verified live on 0G mainnet:** provider `0xDB7B4653…` →
  `https://compute-network-23.integratenetwork.work`, model **`glm-5.1`**,
  verifiability **TeeML** (the model runs *inside* the enclave and signs
  responses), `teeSignerAcknowledged: true`. A real reflection returned in ~8s
  with proof reference `chatId` (e.g. `a1125cbc-…`).
- **Gateway env:** `ZG_COMPUTE_API_KEY` (the `app-sk-` token), `ZG_PROVIDER_URL`,
  `ZG_COMPUTE_MODEL=glm-5.1`. If `ZG_PROVIDER_URL` is unset, the same code path
  targets the hosted Router instead (drop-in `sk-` support). If a live call
  times out, the gateway streams a clearly-labeled demo so the UI never hangs.
- **Caveat:** the `app-sk-` token is cryptographically **locked to one provider**
  (no failover) and that provider can be unreachable from some networks. A hosted
  Router `sk-` key (auto-failover across providers) remains the more robust option
  and is a one-line env change (`ZG_PROVIDER_URL` unset + `sk-` key).
- **Package note:** `@0glabs/0g-serving-broker` is **deprecated/renamed** →
  **`@0gfoundation/0g-compute-ts-sdk`** (used here for read-only discovery only).
  Per-request crypto verification (`processResponse(provider, chatID)`) stays a
  Wave-3 enhancement.

## Network parameters (verified)

| Item | Mainnet "Aristotle" | Testnet "Galileo" |
|---|---|---|
| chainId | `16661` ✅ | **`16602` — SETTLED** (live `eth_chainId` → `0x40da` + docs.0g.ai, 2026-08; 16601 posts are stale) |
| RPC | `https://evmrpc.0g.ai` | `https://evmrpc-testnet.0g.ai` |
| Explorer | `https://chainscan.0g.ai` | `https://chainscan-galileo.0g.ai` |
| Explorer API | `https://chainscan.0g.ai/open/api` | `https://chainscan-galileo.0g.ai/open/api` |
| Storage flow contract | `0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526` | `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296` |
| Storage indexer | `https://indexer-storage-turbo.0g.ai` | `https://indexer-storage-testnet-turbo.0g.ai` |
| EVM version | `cancun` | `cancun` |
| Faucet | — | `https://faucet.0g.ai` |

## Confirmed vs. to-confirm

**Confirmed (high confidence):** Router base URL + auth model; private-mode header
present on live pc.0g.ai; `ZG-Res-Key` proof header; mainnet chain params + EVM
version; model availability; storage SDK package + flow contracts (W2); ERC-7857
reference repo (W3).

**Resolved in Wave 2 (2026-08-15, verified live):**
1. **Testnet chainId = 16602.** Live `eth_chainId` against `evmrpc-testnet.0g.ai`
   returned `0x40da` (16602); docs.0g.ai testnet-overview agrees. Treat 16601 as stale.
2. **Storage SDK renamed TWICE**: `@0glabs/0g-ts-sdk` (deprecated) →
   `@0gfoundation/0g-ts-sdk` (deprecated) → **`@0gfoundation/0g-storage-ts-sdk`**
   (we pin `1.2.11`). Same symbols; browser subpath export; the flow contract is
   now auto-detected from the indexer (confirmed by our spike:
   `apps/web/scripts/spike-storage.mjs` — node selection reported
   `flowAddress: 0x22e03…5296`, `chainId: 16602`). `MemData` enables fully
   in-memory uploads (no tmp files). The SDK's built-in AES/ECIES encryption is
   deliberately NOT used (WebCrypto-only commitment) — it only ever sees our
   envelope-v2 ciphertext.
3. **Whisper**: `whisper-large-v3` live on the Router (`/v1/audio/transcriptions`,
   `sk-` key) and on provider proxies (`/v1/proxy/audio/transcriptions`,
   `app-sk-`). TeeML/TDX-attested, OpenAI-compatible, ~30s/448-token window,
   provider_count=1 → Router failover preferred. Our existing chat `app-sk-` is
   locked to the GLM-5.1 provider and CANNOT reach whisper — hence the separate
   `ZG_VOICE_API_KEY` Router key. **Verified end-to-end 2026-08-16** with a real
   `sk-` key: correct transcript in ~6s.
   ⚠️ **Accepted audio formats are narrower than OpenAI's** (probed live):
   `wav`, `mp3`, `ogg` → 200; **`webm`, `mp4`, `m4a` → 400 "Invalid or
   unsupported audio file"**. Those two rejected containers are exactly what
   MediaRecorder emits in Chrome and Safari, so the client re-encodes to
   16 kHz mono WAV (`lib/media/wav.ts`) before upload. Re-probe this list if
   0G swaps the whisper provider.
4. **Embeddings: still none** on the live `/v1/models` (28 models checked) →
   client-side MiniLM fallback shipped, disclosed.
5. **KV: no hosted testnet endpoint documented** (SDK README hardcodes a raw
   node IP) → W2 ships Log-layer snapshots + a client-side encrypted index
   instead; KV re-enters with the W3 anchor if a hosted endpoint lands.

**Still to confirm later:**
1. **Whether the private header is required or the TEE is always-on** — we send it
   regardless; reconfirm at W3 with `processResponse`.
2. **0G Pay vs x402.** 0G Pay is a proprietary payment layer; x402 is a separate
   open HTTP-402 standard not yet confirmed-integrated into 0G Pay. Revisit at W4.

## Forward plan

**Wave 2 — Storage + memory (SHIPPED).** `@0gfoundation/0g-storage-ts-sdk@1.2.11`:
encrypted memory snapshots → Log layer via **user-signed** `indexer.upload(MemData,
rpc, signer)` → `{rootHash, txHash}` (the wallet pays; Lumen holds no storage key
and is not in the storage path). `downloadToBlob(root, {proof:true})` for
restore/prove flows. No KV (no hosted testnet endpoint) — the encrypted index +
vectors ride inside the snapshot; the snapshot rootHash IS the memory root W3
anchors, with `prevRootHash` chaining for tamper-evidence. Client-side AES-GCM
envelope v2 (AAD-bound) with wallet-sig keys + KCV + recovery key. Recall via
on-device MiniLM (lazy Web Worker); voice via `whisper-large-v3` (Router `sk-`
key, `/api/transcribe`, feature-flagged, no mock).

**Wave 3 — mainnet + ownership.** Deploy `LumenCompanion` (ERC-7857, ref
[`0gfoundation/0g-agent-nft`](https://github.com/0gfoundation/0g-agent-nft)) +
`MemoryAnchor` registry; **verify** on chainscan; mint the companion + anchor the
memory root; move inference to the wallet-signed **Direct SDK** so the gateway
leaves the plaintext path and per-request `processResponse()` verification turns
on. Record public addresses + example tx hashes here.

**Wave 4 — payments.** Gate premium inference behind an HTTP-402 / 0G Pay step.

## App network (Wave 3)

The web app ships on **0G mainnet** (`NEXT_PUBLIC_ZG_NETWORK=mainnet`, chain
16661, indexer `https://indexer-storage-turbo.0g.ai`). One build talks to one
network: the wallet chain, upload RPC, storage indexer and explorer links are
all derived from that single switch, and endpoint overrides are per-network
(`NEXT_PUBLIC_ZG_{MAINNET,TESTNET}_{RPC,INDEXER_RPC}`) so they can't cross.
There is deliberately no chainId override.

NEXT_PUBLIC_* is inlined at build time, so the active network is a property of
the deployed artifact — changing the dashboard value requires a rebuild. The
header badge and footer read the same frozen object the uploader does, which is
what makes the deployed network observable at all.

**Rollback:** promote the last testnet production deployment
(`lumen-lzc2z22z2`) — an alias swap, no rebuild, safe precisely because the
network is baked into the artifact. Slower path: set
`NEXT_PUBLIC_ZG_NETWORK=testnet` and redeploy. If mainnet chain is fine but its
indexer misbehaves, override `NEXT_PUBLIC_ZG_MAINNET_INDEXER_RPC` and redeploy.

## Public addresses & tx hashes

Every hash below was read back from the live chain with `eth_getLogs` against
`https://evmrpc.0g.ai`, not copied from a deploy script's stdout.

### Contract — `LumenCompanion` (ERC-7857 companion + memory anchor)

| | |
|---|---|
| Address (identical on both networks) | `0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738` |
| **0G Mainnet (Aristotle, 16661)** | [chainscan.0g.ai](https://chainscan.0g.ai/address/0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738) — source-verified |
| **0G Testnet (Galileo, 16602)** | [chainscan-galileo.0g.ai](https://chainscan-galileo.0g.ai/address/0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738) — source-verified |
| Compiler | solc 0.8.24, `evmVersion: cancun`, optimizer 200 runs |
| Deploy tx (mainnet) | `0x7ba38b3921d78c8ceef54e0bc05945e2dcd70397f1caeffd405bce6e8f75ff8e` (block 41801714) |
| Deploy tx (galileo) | `0x69f346d7ba72f1086a0438fc223a04620e52961c2f687663f39e190793f2af1c` (block 49747640) |

### Mainnet activity — six transactions, not just a deploy

A deployed contract with one transaction is a deployed contract nobody used.
This one has a real history, from two independent wallets:

| # | What | Tx | Block / UTC |
|---|---|---|---|
| 1 | Deploy | `0x7ba38b39…f8e` | 41801714 · 2026-08-16 14:14 |
| 2 | `mint` → token **#1** (deploy smoke) | `0xc1b6a680…9a2` | 41801897 · 2026-08-16 14:17 |
| 3 | `anchorMemoryRoot` seq 1 | `0x88a720f9…e49` | 41801941 · 2026-08-16 14:18 |
| 4 | `anchorMemoryRoot` seq 2 | `0x57bd0e2e…6eb` | 41801962 · 2026-08-16 14:18 |
| 5 | `mint` → token **#2** (real user wallet) | `0x9abb62f7…6ee` | 42066838 · 2026-08-19 13:05 |
| 6 | `anchorMemoryRoot` seq 1 | `0x74cf42d3…a98` | 42067154 · 2026-08-19 13:10 |

Full hashes:

```
2  0xc1b6a68068ff8de809ea664a926c8a0ef56729e1cd8d03973c3dd2f084e739a2
3  0x88a720f913381d947f8e9906b172a19e2ae7213a4a5a14b66cddd557e6858e49
4  0x57bd0e2e550b7cd47e18faad7a3d638fdff73684cf796da73813506c3103c6eb
5  0x9abb62f70a399d1edb4bb69c7e6bcd7dec8c0f3e7c08be03a70356aa41e196ee
6  0x74cf42d33f4f969bee614e0e8f199c24441d55aeaf6204199bc68f3fbc449a98
```

### Token #2 — the real user companion

| | |
|---|---|
| Owner | `0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52` |
| Root at mint | `0x1caeee295b94a8f28c09a19e32c243fa238f684476289f63bc06f1c2546eb6a2` |
| Root after anchor seq 1 | `0x94f51264d5288f3359020eb37be3008445f0ca61591a414c46d814bdf6fd4e5d` |
| `anchorCount` | 1 |

Both roots are 0G Storage merkle roots of a snapshot encrypted in the owner's
browser. The chain stores the pointer; nobody — including us — can read what it
points at. The `MemoryRootAnchored` log makes the pointer history a verifiable
chain: each anchor's `prevRoot` must equal the previous anchor's `newRoot`, so
the sequence cannot be silently rewritten.

Verify the whole history yourself, no wallet required:

```bash
cast logs --rpc-url https://evmrpc.0g.ai \
  --from-block 41801714 \
  --address 0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738
```

### Wallets

| Role | Address |
|---|---|
| Deployer (deploy-only hot wallet) | `0x446106F3E5b94C297C5c45bC0958ACD86C861CcB` |
| Example user companion owner | `0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52` |
| 0G Compute provider (TeeML) | `0xDB7B4653…` → `compute-network-23.integratenetwork.work` |

### Not on-chain, deliberately

0G Compute and 0G Storage stay on their own networks per the programme rules
(Compute and DA may remain on testnet). Journal text, embeddings and keys are
never on any chain in any form — see [privacy-model.md](./privacy-model.md).
