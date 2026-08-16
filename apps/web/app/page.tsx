import { isComputeLive, isVoiceLive } from '@/lib/0g/env';
import { Journal } from '@/components/Journal';

// Read the live/demo/voice flags per REQUEST, not at build time. Statically
// prerendering this page bakes the env in, so adding ZG_VOICE_API_KEY (or the
// compute key) in the host dashboard would silently do nothing until a
// redeploy — the mic would stay hidden with the key sitting right there.
export const dynamic = 'force-dynamic';

// Server component: reads the live/demo flags on the server, then hands off to the
// client journal. Keeps the API keys (and the `openai` SDK) entirely server-side.
export default function Page() {
  return <Journal live={isComputeLive()} voiceLive={isVoiceLive()} />;
}
