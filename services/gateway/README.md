# services/gateway — (stub in Wave 1)

In Wave 1 the "gateway" is implemented as a Next.js Route Handler inside the web
app — [`apps/web/app/api/reflect/route.ts`](../../apps/web/app/api/reflect/route.ts) —
so the whole product deploys as a single Vercel project. That route is the thin
proxy that holds `ZG_COMPUTE_API_KEY` and calls 0G Compute in private trust mode.

This directory is reserved for extracting that logic into a standalone Node
service if/when we need to (e.g. to run the wallet-signed Direct SDK or x402
payment verification out-of-band in Waves 3–4). The inference abstraction already
lives behind [`apps/web/lib/0g/compute.ts`](../../apps/web/lib/0g/compute.ts), so
the extraction is a lift-and-shift, not a rewrite.

**Why the gateway exists:** it keeps the 0G Compute API key off the client. See
the honest threat model in [`docs/privacy-model.md`](../../docs/privacy-model.md) —
in Waves 1–2 this gateway is technically in the plaintext path for the inference
call; Wave 3 removes it from that path via wallet-signed inference.
