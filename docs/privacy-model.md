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
   and Lumen — only ever see ciphertext. *(Shipped in Wave 2: envelope-v2 AAD-bound
   encryption, ciphertext-only IndexedDB, user-signed snapshot uploads to the 0G
   Log layer.)*
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
history.** Lumen offers (since W2) an explicit, user-controlled **recovery-key
export** with loud warnings: the exported artifact is the **32 bytes of derived
key material** (hex), *not* the signature — the signature is strictly more
powerful and never leaves the signing ceremony. We **never custody** either.

**Determinism assumption (disclosed):** same wallet + same message ⇒ same
signature ⇒ same key. True for RFC-6979 EOA wallets (MetaMask/Ledger class);
NOT guaranteed for some smart-account/MPC wallets. A **key-check value (KCV)**
is decrypted on every unlock — a mismatch surfaces a clear error state (and the
recovery key restores access) instead of silently decrypting garbage.
The KCV is only ever *created* by a signature unlock, never by a recovery-key
unlock (a typo there would otherwise poison every future unlock), and the
recovery-key **export is itself KCV-verified before it is shown** — if the
wallet's fresh signature doesn't reproduce the journal's key, Lumen refuses to
export and tells you to keep your existing backup rather than hand you a key
that cannot decrypt anything.

### Metadata
Even when content is unreadable, **timing and size metadata** (e.g. response
latency correlating with prompt length, request counts) may be observable. We
minimize what we touch and document it rather than pretend it away.

## Wave 2 — new data flows, enumerated

W2 added encrypted persistence, on-device recall, and voice. Every new flow and
what it exposes:

1. **Audio → gateway → Whisper TEE (voice entries).** The same documented W1–2
   gateway caveat now covers audio: the clip transits Lumen's gateway in
   plaintext for the call (held in memory, ≤2 MB/≤25 s, never written, never
   logged), then whisper-large-v3 runs TEE-attested (TeeML) on 0G. The
   transcript returns to the composer for the user to review/edit **before**
   anything is reflected on. There is deliberately **no mock transcription** —
   no key, no mic.
2. **Ciphertext → 0G storage nodes + chain (the big one: metadata
   linkability).** An on-chain observer can see that **your wallet** saves an
   encrypted blob to 0G, **when** you save, and the **approximate (bucketed)
   size** — never the content. Over time this reveals journaling cadence and
   rough volume. Mitigations shipped: saves are **explicit and batched** (one
   snapshot tx per "Save to 0G", never per entry) and plaintext is **padded to
   power-of-two buckets** (min 4 KiB) so size leaks only coarse magnitude.
   Mitigations NOT claimed: unlinkability, mixing, timing obfuscation. If
   cadence privacy matters to you, use a dedicated wallet for Lumen. We never
   use the word "anonymous."
3. **Vectors are content.** Embedding inversion is a real research risk, so
   vectors are treated exactly like entries: computed locally (MiniLM in a Web
   Worker), plaintext only in memory, encrypted under the same key (with their
   own AAD binding) everywhere at rest.
4. **Local IndexedDB.** Content is ciphertext-only. The plaintext metadata it
   does hold, exhaustively: turn ids, turn timestamps, vector-presence, the
   storage pointer `{seq, rootHash, txHash}` (already public on-chain), and the
   KCV envelope (itself ciphertext). This enables the pre-unlock "N encrypted
   entries" UX without weakening "no plaintext at rest."
5. **Model-weight download.** First recall use fetches ~23 MB of MiniLM weights
   from the Hugging Face CDN (then browser-cached). The CDN learns an IP loaded
   Lumen's embedding model; no content is ever sent anywhere.
6. **Recovery key.** What it is (raw key material), what it grants (full read
   access), that we never see or store it — plus the determinism assumption and
   KCV behavior above, in writing.
7. **Minting is a public, permanent statement (W3).** The mint transaction puts
   on a public chain: your address, the block time, one 32-byte root hash, and
   the token's label — a fixed `data:application/json` string that is
   byte-for-byte identical for every Lumen companion, containing no address, no
   timestamp and no entry count. Anyone can then see that this wallet owns a
   Lumen companion and every root it has ever anchored — a public count and
   cadence of the moments you chose to anchor. The content stays unreadable. One
   companion per wallet is enforced on-chain and the token cannot be
   transferred, so a companion is a permanent public link between that address
   and "uses Lumen". Minting is never automatic and is never offered before your
   first successful save. If that link matters to you, mint from a dedicated
   wallet.

**Envelope integrity (W2).** Every ciphertext is AAD-bound (AES-GCM
`additionalData`) to its context — `lumen:v2:<keyVersion>:<type>:<wallet>:<id>`
— so a blob replayed into another wallet's store, another turn's slot, or
another snapshot seq fails authentication. Snapshots also chain
(`prevRootHash`), making history tampering *evident* to anyone holding the
chain. Wave 3 adds a public witness to that chain — see *What an on-chain
anchor proves* below — but it does **not** make rollback impossible.

**Storage path (W2, amended in W3).** Upload is **user-signed**: the wallet —
not Lumen — pays and submits the storage transaction, and the snapshot is
encrypted on the device before anything leaves it.

The amendment, because the original claim is no longer exactly true: 0G's
storage nodes serve **plain HTTP only** (verified live — `https://<node>:5678`
refuses the connection). Browsers block requests from an HTTPS page to an HTTP
address as *mixed content*, unconditionally, so the browser cannot reach a
storage node at all — uploads, restores and proof-downloads all fail the same
way. Lumen therefore **relays the encrypted bytes** through a same-origin route
(`/api/zg/node/<host>`, host-allowlisted so it can't be used to probe private
networks). What that means precisely:

- Lumen sees ciphertext only, holds no key, and cannot read a byte of it — the
  same bytes the storage nodes and the public network see.
- Your wallet still signs and pays the on-chain transaction, so ownership and
  the on-chain record are unchanged.
- We previously said "for stored memory, Lumen is not even in the ciphertext
  path". That is no longer accurate, so we've said so here rather than leave the
  stronger sentence standing. It becomes true again the day 0G serves its
  storage nodes over HTTPS.

## Wave 3 — running on 0G mainnet

Lumen now ships pointed at **0G mainnet (Aristotle, chain 16661)**. What changes
for you:

- **The metadata disclosure above is now on a public mainnet with real value.**
  Save timing and bucketed sizes were always publicly linkable to your address;
  on mainnet that ledger is permanent and economically interesting to index. The
  mitigation is unchanged and still honest: explicit batched saves, padded
  sizes, and — if cadence privacy matters to you — a dedicated wallet.
- **Root hashes are per-network.** A snapshot saved on testnet does not exist on
  mainnet. Lumen scopes its pointer per network and will tell you plainly when
  your only snapshot is on the other one; it will never show a root as "saved"
  on a network that has never stored it.
- **Wrong-chain writes are blocked, not warned about.** If your wallet is on
  another chain, saving is refused before anything is signed — a mainnet-indexed
  save broadcast to another chain can burn a fee against an address that holds
  no contract there.
- The active network is displayed permanently in the header and footer, read
  from the same value the uploader uses, so what you see is where your bytes go.

### What an on-chain anchor proves — exactly

Anchoring writes one 32-byte root hash into `LumenCompanion`
(`0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738`) from your own wallet.

**It proves:**
- **An attributed, timestamped commitment.** Your address — nobody else's, since
  only the token owner may anchor — published this exact root at this block. A
  third party can check that without taking Lumen's word for anything.
- **An unforkable public history.** `anchorMemoryRoot` is compare-and-swap: the
  call carries the root it expects to replace, so every
  `MemoryRootAnchored(tokenId, seq, prevRoot, newRoot)` event links to the one
  before it. Your pointer's whole history replays from the logs with no gaps,
  and `anchorCount` says how many links there should be. Nothing can be inserted
  in the middle and nothing can be replaced quietly.
- **A public witness for the off-chain chain.** A snapshot's `prevRootHash`
  chain used to be evident only to whoever held the snapshots. "This root
  existed by this block" is now witnessed by the network.

**It does not prove:**
- **That the anchored root is your newest snapshot.** You can save without
  anchoring, and you can anchor an older root: the contract has no idea which
  root is "newer" and refuses only a re-anchor of the *current* one. A rollback
  becomes publicly *visible*; it does not become *impossible*. **Anchoring is
  tamper-evidence with a public witness, not rollback prevention** — and we
  would rather say that than sell the stronger word.
- **That the snapshot still exists, decrypts, or is non-empty.** The chain holds
  32 bytes. Retrievability is what "Verify on 0G" checks; decryptability is what
  "Prove I own it" checks. If the storage network stops serving the blob, the
  anchor stands and the memory is gone.
- **When the entries were written.** Entry timestamps live inside the ciphertext
  and are self-asserted; the block timestamp only dates the commitment.

*Correction of record: `LumenCompanion`'s own NatSpec calls the CAS chain
"rollback-PROTECTED". That comment is baked into a deployed, verified contract
and overstates what the mechanism does. This document is the accurate statement,
and the app's copy follows this document, not the comment.*

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
- **W1:** "Processed inside an attested TEE in private trust mode; provider
  can't read it; here's the proof reference." Gateway in plaintext path —
  disclosed.
- **W2:** + "Your stored memory is encrypted on your device before it
  ever leaves; storage nodes, the chain, and Lumen see only ciphertext; your
  wallet — not ours — is the on-chain owner of every upload." Disclosed: the
  gateway remains in the plaintext path for the inference/transcription call;
  save timing and bucketed sizes are publicly linkable to your wallet.
- **W3 (now):** + "Every live reflection is cryptographically verified in your
  browser — for every user, wallet or not. You own the companion on-chain, and
  every memory root you anchored is a public, timestamped commitment from your
  own address." Disclosed: an anchor proves *when* you committed to a root, not
  that the root is your latest; owning a companion is a permanent public link
  between your address and Lumen; and the gateway still relays the inference
  call itself — browser-direct inference is designed but not shipped.
