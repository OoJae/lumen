/**
 * WAV re-encoding for voice entries (Wave 2).
 *
 * WHY THIS EXISTS: 0G's Whisper endpoint rejects the containers MediaRecorder
 * actually produces — verified live 2026-08-16: wav/mp3/ogg → 200, but
 * webm (Chrome) and mp4/m4a (Safari) → 400 "Invalid or unsupported audio
 * file." So the browser recording is decoded and re-encoded to 16 kHz mono
 * PCM WAV before upload — which is Whisper's native input rate anyway, and
 * smaller than 44.1 kHz stereo.
 *
 * No dependencies: WebAudio decodes/resamples, and the WAV header is 44 bytes
 * of DataView writes.
 */

export const WHISPER_SAMPLE_RATE = 16_000;

const HEADER_BYTES = 44;

/** Pure: mono float samples in [-1,1] → a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + samples.length * 2);
  const view = new DataView(out.buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true); // file size - 8
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    // Asymmetric scaling keeps -1 → -32768 and +1 → 32767 without wrapping.
    view.setInt16(HEADER_BYTES + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return out;
}

/** Average all channels into one — mono is what Whisper wants. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0]!;
  const length = channels[0]!.length;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Browser-only: a MediaRecorder Blob (webm/mp4/…) → a 16 kHz mono WAV Blob
 * the 0G Whisper endpoint accepts. Runs entirely on-device.
 */
export async function toWhisperWav(input: Blob): Promise<Blob> {
  const AudioCtx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error('This browser cannot process audio for transcription');

  const decodeCtx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(await input.arrayBuffer());
  } finally {
    void decodeCtx.close();
  }

  // Resample to Whisper's rate via OfflineAudioContext (skip when already there).
  let buffer = decoded;
  if (decoded.sampleRate !== WHISPER_SAMPLE_RATE) {
    const frames = Math.max(
      1,
      Math.ceil((decoded.duration || decoded.length / decoded.sampleRate) * WHISPER_SAMPLE_RATE),
    );
    const offline = new OfflineAudioContext(1, frames, WHISPER_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    buffer = await offline.startRendering();
  }

  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const wav = encodeWav(downmixToMono(channels), buffer.sampleRate);
  return new Blob([wav as BlobPart], { type: 'audio/wav' });
}
