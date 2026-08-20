# services/gateway — the gateway is a route, not a service

Lumen's "gateway" is a Next.js Route Handler inside the web app —
[`apps/web/app/api/reflect/route.ts`](../../apps/web/app/api/reflect/route.ts) —
so the whole product deploys as a single Vercel project. That route holds the 0G
Compute credential and calls the provider in private trust mode.

This directory is reserved for extracting that logic into a standalone Node
service if we ever need to (running wallet-signed browser-direct inference or
0G Pay verification out-of-band). The inference abstraction already lives behind
[`apps/web/lib/0g/compute.ts`](../../apps/web/lib/0g/compute.ts), so the
extraction would be a lift-and-shift, not a rewrite. **Nothing in here runs
today.**

## Why the gateway exists, and what it costs

It keeps the Compute credential off the client. The cost is that the gateway is
in the plaintext path for the inference call: the prompt it forwards contains the
new entry plus up to ten previously-stored entries, in cleartext. It holds no
long-term plaintext and logs no content, but it *sees* the prompt.

**Wave 3 did not change that**, and an earlier version of this file promised it
would. What Wave 3 changed is that the gateway is now a **verbatim byte pipe** —
it relays the provider's response bytes unaltered, and every user's browser
verifies the enclave's signature over exactly those bytes. A gateway that
tampered with one token would be caught client-side, without a wallet and
without trusting Lumen.

That is detection, not prevention. Removing the gateway from the plaintext path
entirely needs browser-direct, wallet-signed inference and a funded inference
wallet per user, which is **Wave 4**. Until then,
[`docs/privacy-model.md`](../../docs/privacy-model.md) is the authority on the
boundary, and the app labels it in the attestation viewer.
