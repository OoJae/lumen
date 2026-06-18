import { isComputeLive } from '@/lib/0g/env';
import { Journal } from '@/components/Journal';

// Server component: reads the live/demo flag on the server, then hands off to the
// client journal. Keeps the API key (and the `openai` SDK) entirely server-side.
export default function Page() {
  return <Journal live={isComputeLive()} />;
}
