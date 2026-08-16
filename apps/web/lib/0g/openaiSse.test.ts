import { describe, expect, it } from 'vitest';

import fixture from './__fixtures__/teeProof.json';
import { OpenAiSseAccumulator } from './openaiSse';
import { sha256Hex } from './verify';

const enc = new TextEncoder();
const frame = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

describe('OpenAiSseAccumulator', () => {
  it('extracts content deltas and the chat id', () => {
    const acc = new OpenAiSseAccumulator();
    const a = acc.push(frame({ id: 'chatcmpl-abc', choices: [{ delta: { content: 'Hel' } }] }));
    const b = acc.push(frame({ id: 'chatcmpl-abc', choices: [{ delta: { content: 'lo' } }] }));

    expect(a).toEqual(['Hel']);
    expect(b).toEqual(['lo']);
    expect(acc.chatId).toBe('chatcmpl-abc');
    expect(acc.finished).toBe(false);
  });

  it('hides reasoning_content from display but keeps it in the raw bytes', () => {
    const acc = new OpenAiSseAccumulator();
    const deltas = acc.push(
      frame({ choices: [{ delta: { reasoning_content: 'thinking out loud…' } }] }),
    );
    expect(deltas).toEqual([]);
    expect(new TextDecoder().decode(acc.rawBytes())).toContain('thinking out loud');
  });

  it('survives frames split across chunk boundaries', () => {
    const acc = new OpenAiSseAccumulator();
    const whole = `data: ${JSON.stringify({ choices: [{ delta: { content: 'split' } }] })}\n\n`;
    const bytes = enc.encode(whole);
    const cut = Math.floor(bytes.length / 2);

    expect(acc.push(bytes.slice(0, cut))).toEqual([]);
    expect(acc.push(bytes.slice(cut))).toEqual(['split']);
  });

  it('handles CRLF framing and [DONE]', () => {
    const acc = new OpenAiSseAccumulator();
    acc.push(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\r\n\r\n`));
    acc.push(enc.encode('data: [DONE]\r\n\r\n'));
    expect(acc.finished).toBe(true);
  });

  it('marks finished on finish_reason', () => {
    const acc = new OpenAiSseAccumulator();
    acc.push(frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
    expect(acc.finished).toBe(true);
  });

  it('ignores malformed frames instead of throwing', () => {
    const acc = new OpenAiSseAccumulator();
    expect(() => acc.push(enc.encode('data: not-json\n\n'))).not.toThrow();
    expect(() => acc.push(enc.encode(': keep-alive\n\n'))).not.toThrow();
    expect(acc.push(frame({ choices: [{ delta: { content: 'ok' } }] }))).toEqual(['ok']);
  });

  it('reproduces the exact bytes of a real provider stream', async () => {
    // Split the captured real response at awkward offsets and confirm the
    // accumulator reassembles a byte-identical stream — the hash depends on it.
    const real = Uint8Array.from(Buffer.from(fixture.rawResponseBase64, 'base64'));
    const acc = new OpenAiSseAccumulator();
    for (let i = 0; i < real.length; i += 137) acc.push(real.slice(i, i + 137));

    const rebuilt = acc.rawBytes();
    expect(rebuilt.length).toBe(real.length);
    expect(await sha256Hex(rebuilt)).toBe(await sha256Hex(real));
    expect(acc.finished).toBe(true);
    expect(acc.chatId).toBeTruthy();
  });

  it('recovers readable text from the real stream', () => {
    const real = Uint8Array.from(Buffer.from(fixture.rawResponseBase64, 'base64'));
    const acc = new OpenAiSseAccumulator();
    const text: string[] = [];
    for (let i = 0; i < real.length; i += 512) text.push(...acc.push(real.slice(i, i + 512)));
    expect(text.join('').trim().length).toBeGreaterThan(0);
  });
});
