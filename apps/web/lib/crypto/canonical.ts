/**
 * Canonical serialization + size bucketing for the Wave 2 memory snapshot.
 *
 * canonicalJson: deterministic JSON (recursive key-sort, no whitespace) so the
 * same logical snapshot produces byte-identical plaintext on any device — a
 * prerequisite for "re-download from 0G, decrypt, byte-compare" ownership proofs.
 *
 * padToBucket: pads ciphertext-bound plaintext to power-of-two buckets so the
 * publicly visible blob size leaks only coarse magnitude, not entry-level detail.
 * (Disclosed in docs/privacy-model.md — bucketing is a mitigation, not anonymity.)
 */

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
      }
      const entries = Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => {
          const v = (value as Record<string, unknown>)[k];
          return v === undefined ? null : `${JSON.stringify(k)}:${canonicalJson(v)}`;
        })
        .filter((e): e is string => e !== null);
      return `{${entries.join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported value of type ${typeof value}`);
  }
}

export const MIN_BUCKET_BYTES = 4096;
const LENGTH_PREFIX_BYTES = 4;

/** 4-byte big-endian length prefix + payload, zero-padded to the next
 *  power-of-two bucket (min 4 KiB). Deterministic for identical input. */
export function padToBucket(bytes: Uint8Array): Uint8Array {
  const raw = bytes.length + LENGTH_PREFIX_BYTES;
  if (bytes.length > 0xffffffff) throw new Error('padToBucket: payload too large');
  let bucket = MIN_BUCKET_BYTES;
  while (bucket < raw) bucket *= 2;
  const out = new Uint8Array(bucket);
  new DataView(out.buffer).setUint32(0, bytes.length, false);
  out.set(bytes, LENGTH_PREFIX_BYTES);
  return out;
}

export function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length < LENGTH_PREFIX_BYTES) throw new Error('unpad: buffer too short');
  const length = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(
    0,
    false,
  );
  if (LENGTH_PREFIX_BYTES + length > padded.length) throw new Error('unpad: corrupt length prefix');
  return padded.slice(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + length);
}

/** Explicit little-endian float32 encoding — stable across platforms. */
export function vectorToBytes(vector: Float32Array): Uint8Array {
  const out = new Uint8Array(vector.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < vector.length; i++) view.setFloat32(i * 4, vector[i]!, true);
  return out;
}

export function bytesToVector(bytes: Uint8Array): Float32Array {
  if (bytes.length % 4 !== 0) throw new Error('bytesToVector: length not a multiple of 4');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}
