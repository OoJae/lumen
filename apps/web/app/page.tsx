import { isComputeLive, isVoiceLive } from '@/lib/0g/env';
import { Journal } from '@/components/Journal';

// Server component: reads the live/demo flags on the server, then hands off to the
// client journal. Keeps the API keys (and the `openai` SDK) entirely server-side.
export default function Page() {
  return <Journal live={isComputeLive()} voiceLive={isVoiceLive()} />;
}
