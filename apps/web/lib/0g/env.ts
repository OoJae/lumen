/** Server-only flag: is a real 0G Compute key configured? Used to honestly show
 *  "live TEE" vs "demo" state. Reading env here keeps `openai` out of the page
 *  bundle (only the route imports compute.ts). */
export function isComputeLive(): boolean {
  return Boolean(process.env.ZG_COMPUTE_API_KEY);
}
