# Lumen — Own your mind. Prove your privacy.

A private, user-owned AI journaling companion built on **0G**. You write; Lumen
reflects and remembers. The difference from every other AI journal: every
reflection goes through **0G Compute's TEE "Sealed Inference,"** and your browser
verifies the enclave's signature over the exact bytes it received — so the proof
is something you check rather than something we assert. Your memory lives
**encrypted on 0G Storage** — encrypted on your device, uploaded and owned by
*your* wallet (Wave 2, live) — and your companion becomes an **ERC-7857 INFT you
own** (Wave 3).

Precisely, because it matters: our live provider runs the model at an upstream
host and the enclave is a *sealed proxy* that attests the request, the response
and its TLS session to that host. The app says exactly this in the attestation
viewer, per provider, read from the on-chain registry — see
[docs/privacy-model.md](docs/privacy-model.md).

> One line: *the only AI you can trust with your inner life, because the trust is
> enforced in hardware and on-chain — not promised in a privacy policy.*

Built for the **0G Bridge by AKINDO WaveHack**. This repo is **Waves 1–3**.

**Live app:** https://lumen-snowy-two.vercel.app · **Contract (0G mainnet, verified):**
[`0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738`](https://chainscan.0g.ai/address/0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738)

---

## Why Lumen can only exist on 0G

| 0G module | What it gives Lumen | Status |
|---|---|---|
| **0G Compute — TEE Sealed Inference** | Provably-private reflection. Every inference runs in an Intel TDX + NVIDIA H100/H200 enclave; the provider can't read your prompt or memory. **This is the product.** | **Live in Wave 1** |
| **0G Storage — Log layer** | Encrypted memory snapshots (entries + embedding vectors), encrypted client-side, **signed and paid for by the user's own wallet** (the encrypted bytes are relayed by Lumen because 0G's nodes are HTTP-only — see Honesty). The snapshot rootHash is the memory root Wave 3 anchors. (KV index arrives with the W3 anchor once a hosted testnet KV endpoint is documented.) | **Live in Wave 2** |
| **0G Chain + ERC-7857 (Agentic ID)** | Your companion minted as an INFT you own; an on-chain anchor for your encrypted memory root, compare-and-swap so the pointer history is a verifiable chain. | **Live on MAINNET in Wave 3** |
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
- ✅ **Ciphertext-only local store** (IndexedDB): entry and reflection text is always ciphertext at rest — DevTools shows base64 and nothing readable. The plaintext metadata alongside it is enumerated exhaustively in [docs/privacy-model.md](docs/privacy-model.md): turn ids, turn timestamps, the storage pointer (already public on-chain), and a deletion marker per deleted entry.
- ✅ **Save to 0G — user-signed**: your wallet (not Lumen) submits and pays the storage tx on the 0G Log layer, and Lumen holds no storage key. One honest caveat, the same one [docs/privacy-model.md](docs/privacy-model.md) records: 0G's storage nodes are HTTP-only and an HTTPS page cannot reach them, so Lumen relays the already-encrypted bytes on the browser's behalf. It cannot read them and the transaction is still yours — but "not in the storage path at all" would be false. Receipt shows the memory root + tx, with **"Verify on 0G"** and **"Prove I own it"** (fresh download + local decrypt) affordances.
- ✅ **Restore-by-root**: paste a root hash on any device, sign with the same wallet, your journal comes back — snapshots also chain (`prevRootHash`) for tamper-evidence.
- ✅ **Recovery key** export (32-byte key material, loud warnings) + recovery-key unlock.
- ✅ **On-device recall**: MiniLM embeddings in a lazy Web Worker (0G has no embeddings model yet — disclosed); relevant older entries quietly inform new reflections. Text never leaves the device for embedding; vectors are encrypted at rest.
- ✅ **Voice entries**: whisper-large-v3 (TeeML) via a feature-flagged gateway route; transcript lands in the composer for review; no key → no mic (never a mock).

**Live demo:** https://lumen-snowy-two.vercel.app (real 0G TEE inference — GLM-5.1, TeeML) · **Demo video:** _<add link>_

## Status — Wave 3 (mainnet, and a proof you can check yourself)

**Every reflection is cryptographically verified in your own browser → your
companion is an ERC-7857 INFT on 0G mainnet → its memory pointer moves only when
you sign.**

- ✅ **Per-request TEE verification, in the browser, for every user.** The gateway
  no longer re-frames the provider's stream — it relays the raw bytes. The client
  hashes exactly what it received, fetches the enclave signature from the provider,
  recovers the signer and checks it against the provider's on-chain address. This is
  *stronger* than the SDK's `processResponse`, which does not bind the response
  content. A gateway that tampered with a single token would be caught.
- ✅ **`LumenCompanion` deployed and source-verified on 0G mainnet (16661)** and
  Galileo (16602) at the same address, with **six real mainnet transactions**
  from two independent wallets — mints and compare-and-swap anchors, not just a deploy.
- ✅ **ERC-7857 to the Final ERC**, plus the 0G reference aliases. Transfers
  `revert` rather than pretending — **transfers are not available and no
  document here should be read as promising them**: a real ERC-7857 transfer must re-encrypt the
  memory to the new owner through a TEE oracle, and none is live. Soulbound and
  honest about why.
- ✅ **Anchor = compare-and-swap.** `anchorMemoryRoot(tokenId, newRoot, expectedPrevRoot)`
  means two devices can't silently clobber each other, and the `MemoryRootAnchored`
  log is a verifiable `prevRoot → newRoot` chain.
- ✅ **One network per build**, with a chain guard, per-network memory pointers and
  a permanent network badge — you can always see which chain you're on.
- ✅ **Zero admin keys.** No owner, no pause, no upgrade path, no way for us to move
  your pointer.

Deliberately *not* claimed: the gateway still sees plaintext during an inference
call. Browser-direct inference is Wave 4. See [Honesty](#honesty-the-moat-is-provable-privacy--so-we-dont-overclaim).

## Verify our claims yourself (no wallet, no install)

Every headline claim in this README is checkable by a stranger. That is the point.

**0. Open a companion's public proof page — no wallet, no install, one click.**

> **https://lumen-snowy-two.vercel.app/companion/0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52**

That page reads 0G mainnet live and shows the companion's owner, its current
encrypted-memory root, and its entire anchor history replayed as a chain — each
anchor proving which root it replaced. It also asks the 0G Storage indexer
whether the encrypted snapshot is retrievable right now, and answers with the
number of nodes serving it. It reveals nothing about what the owner wrote,
because it cannot.

**1. The contract is real, verified, and used.**

```bash
# six transactions, from two wallets — not a lonely deploy
cast logs --rpc-url https://evmrpc.0g.ai --from-block 41801714 \
  --address 0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738
```
Or open [chainscan](https://chainscan.0g.ai/address/0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738)
and read the verified source. Full hash list: [docs/0g-integration.md](docs/0g-integration.md).

**2. The memory pointer chain is intact.** Each `MemoryRootAnchored` event carries
`prevRoot` and `newRoot`. Walk them in order; every `prevRoot` must equal the
previous `newRoot`. Token #2 (a real user wallet, `0xB5609C73…1a52`) mints at
`0x1caeee29…` and anchors to `0x94f51264…`.

**3. The reflection really was signed by an enclave.** Open the live app, write
an entry, and click the 🔒 badge. The viewer shows the sha256 of the exact bytes
your browser received, the signature fetched from the provider, and the recovered
signer address matching the provider's on-chain address. Verification runs in
*your* browser — nothing about it is a server-side claim.

**4. Nothing is stored in plaintext.** DevTools → Application → IndexedDB. Every
record's payload is base64 ciphertext — no entry or reflection text is readable.
You will also see plaintext keys and timestamps beside it; those are enumerated
exhaustively in [docs/privacy-model.md](docs/privacy-model.md), and seeing them
is the point of checking rather than a contradiction of it.

**5. The tests pass.** `pnpm test` (457 tests, `apps/web`) and
`pnpm --filter @lumen/contracts test` (20 tests). There is no CI workflow in this
repo — the suite is run locally before every commit, and saying so is cheaper
than implying a pipeline that does not exist.

## Architecture (summary)

```
Client (Next.js PWA)  ──prompt──▶  Gateway (Next API route, holds key)  ──private mode──▶  0G Compute (TEE)
  · journaling UI                    · injects X-0G-Provider-Trust-Mode: private            · Sealed Inference
  · VERIFIES in-browser  ◀─raw bytes─ · RELAYS provider bytes VERBATIM  ◀─bytes+headers──   · GLM-5.1 + Whisper
  · client-side crypto               · logs no content, stores no audio                     · signs every response
  · IndexedDB (ciphertext only)
  · MiniLM recall (Web Worker)
        │                                            ┌─ GET /v1/proxy/signature/{chatId} ─┐
        │        the browser fetches the enclave      └───────────▶ 0G Compute provider ───┘
        │        signature ITSELF and checks it against the provider's on-chain address
        │
        ├──encrypted snapshot, USER-signed tx (Lumen not in this path)──▶  0G Storage Log layer
        │                                                                        │ rootHash
        └──mint / anchorMemoryRoot, USER-signed──▶  0G Chain mainnet (16661) ◀────┘
                                                    LumenCompanion (ERC-7857)
```

The gateway is a **byte pipe, not a narrator**. Any re-serialization would change
the hash and silently break every user's proof — so it forwards the provider's
bytes untouched, with `no-transform`, and the browser does the verifying.

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

Other scripts: `pnpm build` · `pnpm start` · `pnpm test` (141 unit tests) ·
`pnpm typecheck`.

### Contracts

```bash
pnpm --filter @lumen/contracts test      # 20 tests, Hardhat
```

`LumenCompanion` is already deployed and source-verified at
`0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738` on **both** 0G mainnet (16661) and
Galileo (16602) — you do not need to redeploy to try the app. To deploy your own,
set `PRIVATE_KEY` in `contracts/.env` (use a **deploy-only hot wallet**) and run
`pnpm --filter @lumen/contracts deploy:mainnet`.

### Further reading

- [docs/architecture.md](docs/architecture.md) — system design, data flows, module map
- [docs/0g-integration.md](docs/0g-integration.md) — which 0G modules, how, and every address + tx hash
- [docs/privacy-model.md](docs/privacy-model.md) — the honest threat model, claim by claim

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
(padded) size at a time, and that your address owns a Lumen companion pointing at
a given root — never the content.

**What changed in Wave 3, precisely.** The gateway is still in the plaintext path
— we did *not* ship browser-direct inference, and nothing in this repo claims we
did. What we did ship is verification that no longer requires trusting the
gateway at all: it relays the provider's raw bytes, and your browser checks the
enclave's signature over exactly those bytes. A gateway that altered one token
would fail verification in every user's browser. Removing the gateway from the
plaintext path entirely (wallet-signed browser-direct inference) needs a funded
inference wallet per user and is **Wave 4**.

There is exactly **one** mock in this codebase: with no Compute credential
configured, local dev serves a loudly-labelled demo reflection. It cannot run in
production, and it is *not* a failure fallback — when a credential is configured
and the provider is unreachable, Lumen returns an error. It will never invent a
reflection and let you believe something read you.

## Repo layout

```
apps/web            Next.js PWA — UI, gateway route, lib/0g, lib/crypto, lib/memory
packages/shared     verified 0G network params, model catalog, contract ABI, shared types
services/gateway    stub (the gateway lives in apps/web/app/api/reflect)
contracts           LumenCompanion.sol — ERC-7857 companion + memory anchor (Hardhat, 20 tests)
docs/               architecture · 0g-integration (addresses + tx hashes) · privacy-model
```

## Roadmap

W1 core loop ✅ · **W2** encrypted Storage memory + recall + voice ✅ · **W3** mainnet +
verified contracts + ERC-7857 ownership + per-request TEE verification ✅ · **W4** browser-direct
(wallet-signed) inference + 0G Pay premium + launch + metrics · **W5** scale + insights +
Token2049 demo.

## License

MIT
