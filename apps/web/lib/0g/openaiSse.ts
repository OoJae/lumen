/**
 * Parser for the provider's OpenAI-style SSE stream (Wave 3).
 *
 * Two jobs at once, and the second is the subtle one:
 *  1. surface display text as it arrives;
 *  2. retain every received byte VERBATIM, because per-request verification
 *     hashes the raw stream. Anything that re-serializes or trims breaks the
 *     proof, so `rawBytes()` is a plain concatenation of what came off the wire.
 *
 * GLM-5.1 also streams `delta.reasoning_content` (its own scratch-pad, billed
 * as completion tokens). That is deliberately NOT shown to the writer — a
 * journal should answer, not think out loud — but it stays in the raw bytes.
 */

interface OpenAiChunk {
  id?: string;
  choices?: { delta?: { content?: string; reasoning_content?: string }; finish_reason?: string | null }[];
}

export class OpenAiSseAccumulator {
  private chunks: Uint8Array[] = [];
  private totalBytes = 0;
  private textBuffer = '';
  private decoder = new TextDecoder();
  private _chatId: string | null = null;
  private _finished = false;

  /** Feed a network chunk; returns any newly-complete display deltas. */
  push(chunk: Uint8Array): string[] {
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;

    this.textBuffer += this.decoder.decode(chunk, { stream: true });
    const deltas: string[] = [];

    // SSE frames are separated by a blank line; keep any partial tail.
    const frames = this.textBuffer.split(/\r?\n\r?\n/);
    this.textBuffer = frames.pop() ?? '';

    for (const frame of frames) {
      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          this._finished = true;
          continue;
        }
        let parsed: OpenAiChunk;
        try {
          parsed = JSON.parse(payload) as OpenAiChunk;
        } catch {
          continue; // ignore keep-alives / non-JSON frames
        }
        if (!this._chatId && parsed.id) this._chatId = parsed.id;
        const choice = parsed.choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) deltas.push(delta);
        if (choice?.finish_reason) this._finished = true;
      }
    }

    return deltas;
  }

  get chatId(): string | null {
    return this._chatId;
  }

  get finished(): boolean {
    return this._finished;
  }

  get byteLength(): number {
    return this.totalBytes;
  }

  /** The exact bytes received, concatenated in order — what gets hashed. */
  rawBytes(): Uint8Array {
    const out = new Uint8Array(this.totalBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}
