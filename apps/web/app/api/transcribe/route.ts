/**
 * Voice gateway (Wave 2): browser audio → 0G Whisper (TeeML) → transcript.
 *
 * Thin by design — how Lumen talks to 0G lives in lib/0g/compute.ts
 * (`transcribeAudio`), exactly like /api/reflect. Threat model (documented in
 * docs/privacy-model.md): like text inference in Waves 1–2, audio transits
 * this gateway in plaintext for the duration of the call — held in memory
 * only, size-capped BEFORE the body is read, never written to disk, never
 * logged. The transcript is returned to the composer for the user to
 * review/edit BEFORE it is ever reflected on.
 */
import { clientKey, createRateLimiter } from '@/lib/0g/rateLimit';
import { NextRequest } from 'next/server';
import type { TranscribeResponse } from '@lumen/shared';
import { transcribeAudio } from '@/lib/0g/compute';
import { isVoiceLive } from '@/lib/0g/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Whisper's native window is ~30s; the client stops at 25s. 2 MB comfortably
 *  covers 25s of opus/mp4 audio while bounding gateway memory. */
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
/** Multipart framing overhead allowance on top of the audio cap. */
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 64 * 1024;

/** Whisper is billed per clip; same reasoning as the reflect route. */
const limiter = createRateLimiter({ burst: 10, refillPerSecond: 1 / 12 });

export async function POST(req: NextRequest): Promise<Response> {
  const limit = limiter(clientKey(req.headers));
  if (!limit.allowed) {
    return new Response('Too many transcriptions from this address in a short time.', {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    });
  }

  if (!isVoiceLive()) {
    return Response.json(
      {
        error:
          'Voice is not configured on this deployment (no 0G Router key). ' +
          'Lumen never fakes a transcription — type your entry instead.',
      },
      { status: 503 },
    );
  }

  // Reject oversized requests BEFORE buffering the body — formData() would
  // otherwise materialize an arbitrarily large upload in gateway memory.
  const contentLength = Number(req.headers.get('content-length'));
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return Response.json({ error: 'Content-Length required' }, { status: 411 });
  }
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'Audio too large (max 2 MB / ~25s)' }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: '`file` audio field is required' }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: 'Audio too large (max 2 MB / ~25s)' }, { status: 413 });
  }

  try {
    const text = await transcribeAudio(file);
    return Response.json({ text } satisfies TranscribeResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'transcription failed';
    // No audio or transcript content is ever logged — only the failure class.
    console.error('[transcribe] upstream error:', message);
    return Response.json({ error: 'Transcription failed — please try again.' }, { status: 502 });
  }
}
