import { describe, expect, it } from 'vitest';

import { downmixToMono, encodeWav, WHISPER_SAMPLE_RATE } from './wav';

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

describe('encodeWav', () => {
  it('writes a valid 16-bit mono PCM header at the Whisper sample rate', () => {
    const samples = new Float32Array(8);
    const wav = encodeWav(samples, WHISPER_SAMPLE_RATE);
    const view = new DataView(wav.buffer);

    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(readAscii(view, 8, 4)).toBe('WAVE');
    expect(readAscii(view, 12, 4)).toBe('fmt ');
    expect(readAscii(view, 36, 4)).toBe('data');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(WHISPER_SAMPLE_RATE);
    expect(view.getUint32(28, true)).toBe(WHISPER_SAMPLE_RATE * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bit depth
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(wav.length).toBe(44 + samples.length * 2);
  });

  it('scales full-scale samples without wrapping', () => {
    const wav = encodeWav(new Float32Array([1, -1, 0]), WHISPER_SAMPLE_RATE);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(0);
  });

  it('clamps out-of-range input instead of overflowing', () => {
    const wav = encodeWav(new Float32Array([9, -9]), WHISPER_SAMPLE_RATE);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it('sizes a 25s recording well under the 2 MB gateway cap', () => {
    const bytes = 44 + 25 * WHISPER_SAMPLE_RATE * 2;
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('downmixToMono', () => {
  it('averages channels', () => {
    const mono = downmixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(mono)).toEqual([0.5, 0.5]);
  });

  it('passes a single channel through untouched', () => {
    const only = new Float32Array([0.25, -0.5]);
    expect(downmixToMono([only])).toBe(only);
  });

  it('handles no channels', () => {
    expect(downmixToMono([]).length).toBe(0);
  });
});
