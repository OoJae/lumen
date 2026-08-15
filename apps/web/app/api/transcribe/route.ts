/**
 * Voice gateway (Wave 2): browser audio → 0G Whisper (TeeML) → transcript.
 *
 * Threat model (documented in docs/privacy-model.md): like text inference in
 * Waves 1–2, audio transits this gateway in plaintext for the duration of the
 * call — held in memory only, size-capped, never written to disk, never
 * logged. The whisper model itself runs TEE-attested on 0G. The transcript is
 * returned to the composer for the user to review/edit BEFORE it is ever
 * reflected on. Removing the gateway from the plaintext path is Wave 3.
 */
import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import {
  PRIVATE_MODE_HEADER,
  PRIVATE_MODE_VALUE,
  ROUTER_BASE_URL,
  WHISPER_MODEL_ID,
  type TranscribeResponse,
} from '@lumen/shared';
import { isVoiceLive } from '@/lib/0g/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Whisper's native window is ~30s; the client stops at 25s. 2 MB comfortably
 *  covers 25s of opus/mp4 audio while bounding gateway memory. */
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

const TRANSCRIBE_TIMEOUT_MS = 45_000;

export async function POST(req: NextRequest): Promise<Response> {
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

  const client = new OpenAI({
    apiKey: process.env.ZG_VOICE_API_KEY,
    baseURL: process.env.ZG_VOICE_BASE_URL || ROUTER_BASE_URL,
    timeout: TRANSCRIBE_TIMEOUT_MS,
    maxRetries: 0,
  });

  try {
    const result = await client.audio.transcriptions.create(
      {
        file,
        model: process.env.ZG_VOICE_MODEL || WHISPER_MODEL_ID,
        response_format: 'json',
      },
      { headers: { [PRIVATE_MODE_HEADER]: PRIVATE_MODE_VALUE } },
    );
    const text = typeof result.text === 'string' ? result.text.trim() : '';
    return Response.json({ text } satisfies TranscribeResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'transcription failed';
    // No audio or transcript content is ever logged — only the failure class.
    console.error('[transcribe] upstream error:', message);
    return Response.json({ error: 'Transcription failed — please try again.' }, { status: 502 });
  }
}
