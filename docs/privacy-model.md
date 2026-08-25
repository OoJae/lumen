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
   prompt inside a hardware TEE and signs the response there. What that means
   depends on the provider, and the app reports the difference per provider from
   the on-chain registry rather than averaging over it: our live provider runs
   the model at an **upstream host**, with the enclave acting as a *sealed proxy*
   that attests the request, the response and its TLS session to that host. So
   the provider's own operator cannot read your words, and the upstream model
   host does process them inside that attested session. "The model runs inside
   the enclave" would be the stronger claim, and it is not the one we can make.
2. **Confidentiality of stored data (W2+).** Every entry/reflection is encrypted
   **client-side** with AES-GCM *before* it leaves the device. The key is derived
   from a **wallet signature** (deterministic, never transmitted). Storage nodes —
   and Lumen — only ever see ciphertext. *(Shipped in Wave 2: envelope-v2 AAD-bound
   encryption, ciphertext-only IndexedDB, user-signed snapshot uploads to the 0G
   Log layer.)*
3. **Ownership (W3+).** The companion + memory pointer is an **ERC-7857 INFT**
   the user holds. Export is user-controlled and shipped (Markdown + JSON).
   **Transfer is not.** ERC-7857 transfers must re-encrypt the memory to the new
   owner through a TEE oracle, no such oracle is live on 0G, and the deployed
   contract therefore makes every transfer path revert. Companions are soulbound
   until that changes; nothing here should be read as promising otherwise.

## The honest threat model

### Waves 1–2 — the gateway path
To keep the Compute API key secret, inference is proxied through Lumen's gateway
(a Next.js Route Handler). The TEE guarantees the **provider** can't read
plaintext, but the **gateway is technically in the plaintext path for the
inference call.**

**Mitigations:**
- The gateway holds **no long-term plaintext** and **logs no entry/reflection
  content**.
- All *stored* data is end-to-end-encrypted **at rest** (from W2): on this
  device, on 0G Storage nodes, and on the chain, Lumen sees only ciphertext.
- **But the prompt for a live call CONTAINS stored memory, in plaintext, and
  the gateway sees it.** This deserves stating plainly, because an earlier
  version of this document said the opposite. Every reflection sends: your new
  entry, and the **last 6 entries and their reflections** (the session window,
  `lib/memory/session.ts`). You can see this yourself: DevTools → Network →
  `/api/reflect` → Payload.
- **Recalled entries are now excerpted, not forwarded whole.** Up to 4 older
  entries are still selected by on-device recall, and they can come from any
  point in your history — including entries restored from a 0G snapshot months
  later. But recall picks an entry by *whole-entry* similarity, and this
  document used to describe the consequence accurately: the whole entry went.
  So a long, hard entry travelled in full because one paragraph of it rhymed
  with today's sentence. `lib/memory/minimize.ts` now cuts each recalled entry
  down to the sentences that earned its place — at most 3, and at most ~420
  characters — before it leaves the device, marking the gaps with `…` and
  telling the model not to speculate about them. In tests on realistic entries
  that withholds more than half the recalled text. It is a reduction, not
  encryption: what is sent, the gateway still sees.
- **The app now tells you what it sent.** After each reflection the composer
  states the counts — how many recent entries, how many excerpts, and roughly
  how many characters stayed on this device. `contextFootprint` is computed by
  the same module that builds the payload, so the two cannot drift.
- What that does *not* mean: the gateway keeps none of it, logs no content, and
  cannot read anything at rest. What it does mean: for the duration of an
  inference call, "encrypted end-to-end" describes storage, not the prompt.
- Removing the gateway from that path needs browser-direct, wallet-signed
  inference. It is buildable — the credential is a client-mintable signed blob,
  not a server secret, and the provider's CORS allows it — but it was
  **considered and rejected** for this product, and the reasoning belongs here
  rather than in a commit message. It would remove exactly one party (this
  gateway) from the plaintext audience, while the enclave and the upstream model
  host read the prompt either way. In exchange it would hand the provider your
  wallet address and IP — de-anonymising prompts the gateway currently pools —
  and publish two things on a public chain: an enumerable roster of everyone
  who uses Lumen (a live `getAccountsByProvider` read returns real user
  addresses), and a per-request settlement trail that amounts to a timestamped
  public record of when and how much you journal. For a journal, that trades a
  private party you can verify for a public record you cannot retract. Until
  something changes that arithmetic, the gateway stays — smaller, and disclosed.
- This limitation is **labeled in-app** (the attestation viewer) and here.

**We therefore do _not_ claim full end-to-end-private inference in Waves 1–2.**

### Wave 3 — what actually shipped, and what didn't

**Shipped: per-request cryptographic verification, in every user's browser.**
This was expected to require the Direct SDK and a wallet-signed request. It
didn't. The gateway became a verbatim byte pipe — it relays the provider's
response bytes unaltered — and the browser fetches the enclave's signature,
hashes exactly the bytes it received, recovers the signing address and compares
it to the signer registered on-chain for that provider. A gateway that altered
one token would fail that check in every user's browser. No wallet is needed, so
this runs for signed-out visitors too.

**Not shipped: removing the gateway from the plaintext path.** That still needs
browser-direct, wallet-signed inference, which needs a funded inference wallet
per user. It is designed and deferred to **Wave 4**. Until then the Waves 1–2
boundary above stands **unchanged**: the gateway sees the prompt, and the prompt
contains up to ten previously-stored entries in cleartext.

So the honest Wave 3 sentence is *"you can now verify the enclave signed exactly
what you read"* — **not** *"we removed ourselves from the loop."* Detection, not
prevention. Earlier drafts of this section wrote the Wave 4 change as though it
had already happened; it has not.

### Key management
Wallet-signature-derived keys mean **losing the wallet = losing decryptable
history.** Lumen offers (since W2) an explicit, user-controlled **recovery-key
export** with loud warnings: the exported artifact is the **32 bytes of derived
key material** (hex), *not* the signature — the signature is strictly more
powerful and never leaves the signing ceremony. We **never custody** either.

**Determinism assumption (disclosed):** same wallet + same message ⇒ same
signature ⇒ same key. True for RFC-6979 EOA wallets (MetaMask/Ledger class);
NOT guaranteed for some smart-account/MPC wallets. A **key-check value (KCV)**
exists as a **cache**, and it is no longer the authority on what a correct key
is — it never should have been. A KCV is a fixed constant encrypted with
whatever key the last signature produced, verified against nothing, so treating
it as authoritative meant a non-deterministic wallet's *wrong* first signature
became the device's law and locked the *correct* recovery key out permanently.

The authority is your own ciphertext. Every envelope is AES-GCM-bound to
`lumen:v2:<keyVersion>:<typ>:<wallet>:<id>`, so **one successful authenticated
decrypt is proof the key is this journal's key**, and a typo cannot forge it.
Unlock therefore probes real data first and consults the KCV only when this
device holds no ciphertext to ask — the fresh device, the new browser profile,
the cleared site data. That case admits the key as **asserted** rather than
proven, says so plainly in the UI rather than claiming a check it didn't
perform, and promotes itself to proven the moment a restored snapshot decrypts,
rewriting the KCV from proven material. Every branch lives in
`apps/web/lib/crypto/keyTrust.ts` and is unit-tested cell by cell.

The recovery-key **export is checked against whatever this device can check it
against** — and the distinction matters. If the device holds ciphertext and the
wallet's fresh signature does not open it, Lumen refuses the export outright and
tells you to keep your existing backup rather than hand you a key that decrypts
nothing. But on a device that holds nothing yet — a new laptop, a fresh profile,
the case where you most need a backup — there is nothing to check against, so
the export is **allowed and labelled unverified**, with a warning not to
overwrite a backup you already have. Refusing there would leave a new journal
with no way to ever make one. `decideExport` in
`apps/web/lib/crypto/keyTrust.ts` is the whole rule, and it refuses only on
evidence that actively REFUTES the key.

The signature itself never enters any cache. Lumen calls `signMessage` from
`wagmi/actions` rather than the `useSignMessage` hook, so no TanStack mutation —
and therefore no five-minute retained copy of the signature or its derivation
message — is ever created. `apps/web/lib/crypto/cacheAudit.ts` asserts this in
development and fails loudly if a signing hook is reintroduced.

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
   storage pointer `{seq, rootHash, txHash}` (already public on-chain), the
   KCV envelope (itself ciphertext), and — for entries you delete — a
   **deletion marker** holding that entry's id and the time you deleted it.
   This enables the pre-unlock "N encrypted entries" UX without weakening "no
   plaintext at rest."

   The marker is plaintext for two reasons. It has to be written in the *same*
   IndexedDB transaction that removes the turn and its vector (awaiting
   `crypto.subtle` inside a transaction lets the transaction auto-commit), and
   it leaks strictly less than what was there a moment earlier: the store
   already held that id and timestamp as plaintext keys alongside the
   ciphertext. After the delete it holds the id and a timestamp, and nothing
   else.

5. **Deletion is local and forward-looking, never retroactive.** Deleting an
   entry removes its ciphertext and its vector from this device and keeps them
   out of every snapshot you save afterwards. Deletion markers travel inside
   those later snapshots, which is how a deletion reaches your other devices
   and how restoring an older root cannot resurrect it.

   What deletion **cannot** do, and no mechanism could: unpublish a snapshot
   already uploaded to 0G. Those bytes remain retrievable by anyone holding the
   root hash, and remain decryptable only by your wallet's key. If that root is
   also anchored to your companion, the root itself stays in a public,
   permanent anchor history. Save (and re-anchor) after deleting and your newest
   snapshot will not contain the entry; the older one still will. Markers are
   never pruned, so they accumulate — roughly 60 bytes each — inside your own
   ciphertext.

   One narrower caveat: an IndexedDB `delete` frees a record; it does not
   guarantee the underlying disk blocks are overwritten. That is below what a
   web application can control, and it is why the delete dialog says "removed
   from this device" and never "erased."
6. **Model-weight download.** First recall use fetches ~23 MB of MiniLM weights
   from the Hugging Face CDN (then browser-cached). The CDN learns an IP loaded
   Lumen's embedding model; no content is ever sent anywhere.
7. **Recovery key.** What it is (raw key material), what it grants (full read
   access), that we never see or store it — plus the determinism assumption and
   KCV behavior above, in writing.
8. **Minting is a public, permanent statement (W3).** The mint transaction puts
   on a public chain: your address, the block time, one 32-byte root hash, and
   the token's label — a fixed `data:application/json` string, identical for
   every companion minted through the app, containing no address, no timestamp
   and no entry count. (The label is a mint argument, so a companion minted by
   other means can carry a different one; token #1 on each network, minted by
   `contracts/scripts/smoke.ts`, does.) Anyone can then see that this wallet owns a
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
- **An unbroken public history that only you can extend.** Every
  `MemoryRootAnchored(tokenId, seq, prevRoot, newRoot)` event links to the one
  before it, because the contract always writes `prevRoot = current`. Your
  pointer's whole history replays from the logs with no gaps, `anchorCount` says
  how many links there should be, and nothing can be inserted in the middle or
  reordered. Both writers are owner-only, so nobody else can extend it.

  **The precise limit.** `anchorMemoryRoot` — the only call the app makes — is
  compare-and-swap: it carries the root it expects to replace and reverts if
  that is stale, so two devices cannot silently clobber each other. But the
  contract also exposes `update`, the 0G reference-implementation alias, which
  performs no such check and emits a **byte-identical** event. So a replayer can
  prove the chain is unbroken; it cannot prove every link was compare-and-swapped
  by an owner who knew the prior root. `contracts/README.md` has the full
  table.
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
- **W2:** + "Your stored memory is encrypted on your device before it ever
  leaves; storage nodes and the chain see only ciphertext; your wallet — not
  ours — is the on-chain owner of every upload." Disclosed: the gateway remains
  in the plaintext path for the inference/transcription call, **and the prompt
  it sees carries up to ten of your previously-stored entries**, because that is
  how the companion remembers; save timing and bucketed sizes are publicly
  linkable to your wallet.
- **W3 (now):** + "Every live reflection is cryptographically verified in your
  browser — for every user, wallet or not. You own the companion on-chain, and
  every memory root you anchored is a public, timestamped commitment from your
  own address." Disclosed: an anchor proves *when* you committed to a root, not
  that the root is your latest; owning a companion is a permanent public link
  between your address and Lumen; and the gateway still relays the inference
  call itself — browser-direct inference is designed but not shipped.
