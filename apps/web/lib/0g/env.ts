/** Server-only flag: is a real 0G Compute key configured? Used to honestly show
 *  "live TEE" vs "demo" state. Reading env here keeps `openai` out of the page
 *  bundle (only the route imports compute.ts). */
export function isComputeLive(): boolean {
  return Boolean(process.env.ZG_COMPUTE_API_KEY);
}

/** Server-only flag: is a Router key configured for Whisper voice transcription?
 *  No key → the mic never renders and /api/transcribe answers 503 honestly —
 *  there is deliberately NO mock transcription. */
export function isVoiceLive(): boolean {
  return Boolean(process.env.ZG_VOICE_API_KEY);
}

/**
 * Is this a production deployment?
 *
 * `VERCEL_ENV` is the authority when it exists ('production' | 'preview' |
 * 'development'), because `NODE_ENV` is 'production' for preview builds too and
 * a preview is a fine place to demo. Off Vercel, fall back to NODE_ENV.
 */
export function isProductionDeploy(): boolean {
  const vercel = process.env.VERCEL_ENV;
  if (vercel) return vercel === 'production';
  return process.env.NODE_ENV === 'production';
}

/**
 * May this request be served by the demo reflection?
 *
 * The README and the reflect route both asserted that the mock "cannot run in
 * production" — and nothing enforced it. `isComputeLive()` reads one env var,
 * so a production deploy that lost its credential (rotated key, missing env on
 * a new project, a typo'd variable name) would quietly serve a fabricated
 * reflection to real users, under a UI that promises a hardware enclave read
 * their words. A demo label in that situation is not enough: the whole product
 * claim is that nothing invents a reflection.
 *
 * So the invariant is now a function, and the route refuses instead. Production
 * without a credential is a misconfiguration, and an honest 503 is the correct
 * answer to one.
 */
export function mayServeDemo(): boolean {
  return !isProductionDeploy();
}
