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

## Network parameters (verified)

| Item | Mainnet "Aristotle" | Testnet "Galileo" |
|---|---|---|
| chainId | `16661` ✅ | **`16601` vs `16602` — CONTESTED** (default `16602`) |
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

**To confirm at the relevant wave / on first keyed run:**
1. **Testnet chainId 16601 vs 16602.** docs.0g.ai + ChainList show `16602`; an
   official 0G relaunch post + ThirdWeb show `16601`. Both resolve to the same RPC.
   → Confirm via the wallet "Add Network" prompt before any W3 transaction. It is
   env-driven (`NEXT_PUBLIC_ZG_CHAIN_ID`), so this is a one-line change.
2. **Exact model id strings** vs the live `/v1/models`.
3. **Whether the private header is required or the TEE is always-on** — we send it
   regardless; reconfirm at W2.
4. **0G Pay vs x402.** 0G Pay is a proprietary payment layer; x402 is a separate
   open HTTP-402 standard not yet confirmed-integrated into 0G Pay. Revisit at W4.

## Forward plan

**Wave 2 — Storage + memory.** `@0glabs/0g-ts-sdk`: encrypted entries → Log
(`indexer.upload` → `{rootHash, txHash}`); live index/embeddings → KV
(`Batcher`/`KvClient`). Client-side AES-GCM (already built in `lib/crypto`) with
wallet-sig keys. Embeddings recall via a client-side fallback model (no 0G
embeddings model yet); voice via `whisper-large-v3`.

**Wave 3 — mainnet + ownership.** Deploy `LumenCompanion` (ERC-7857, ref
[`0gfoundation/0g-agent-nft`](https://github.com/0gfoundation/0g-agent-nft)) +
`MemoryAnchor` registry; **verify** on chainscan; mint the companion + anchor the
memory root; move inference to the wallet-signed **Direct SDK** so the gateway
leaves the plaintext path and per-request `processResponse()` verification turns
on. Record public addresses + example tx hashes here.

**Wave 4 — payments.** Gate premium inference behind an HTTP-402 / 0G Pay step.

## Public addresses & tx hashes (filled from Wave 3)

_None yet — Wave 1 uses the hosted Router and no contracts. This section will list
verified contract addresses + example mint/anchor/payment tx hashes._
