/**
 * AES-GCM encrypt/decrypt for journal data. Every personal datum is encrypted
 * with this BEFORE it leaves the device (Wave 2 storage). Fresh 96-bit IV per
 * message; output is a small JSON-serialisable blob (base64 iv + ciphertext).
 */

export interface EncryptedBlob {
  v: 1;
  alg: 'AES-GCM';
  iv: string; // base64 (12 bytes)
  ciphertext: string; // base64 (includes the GCM auth tag)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encryptString(key: CryptoKey, plaintext: string): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );
  return {
    v: 1,
    alg: 'AES-GCM',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptString(key: CryptoKey, blob: EncryptedBlob): Promise<string> {
  const iv = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return decoder.decode(plaintext);
}

export async function encryptJSON(key: CryptoKey, data: unknown): Promise<EncryptedBlob> {
  return encryptString(key, JSON.stringify(data));
}

export async function decryptJSON<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
  return JSON.parse(await decryptString(key, blob)) as T;
}

// ── Envelope v2 (Wave 2): AAD-bound, binary payloads ───────────────────────────
// v2 binds every ciphertext to its context (what it is + which key version +
// whose slot it fills) via AES-GCM additionalData. A blob copied into another
// wallet's store, another turn's slot, or presented as a different envelope
// type fails authentication instead of decrypting into the wrong place.
// v1 blobs above remain readable — nothing about them changed.

export type EnvelopeType = 'turn' | 'vector' | 'snapshot' | 'kcv';

export interface EncryptedEnvelope {
  v: 2;
  alg: 'AES-GCM';
  typ: EnvelopeType;
  /** The exact AAD string authenticated at encrypt time (transparency +
   *  restore flows read ids like the snapshot seq back out of it). */
  aad: string;
  iv: string; // base64 (12 bytes)
  ciphertext: string; // base64 (includes the GCM auth tag)
}

/** AAD id conventions: turn/vector `${wallet}:${turnId}`, snapshot
 *  `${wallet}:${seq}`, kcv `${wallet}` — wallet always lowercase 0x. */
export function buildAad(typ: EnvelopeType, keyVersion: number, id: string): string {
  return `lumen:v2:${keyVersion}:${typ}:${id}`;
}

export interface AadParts {
  keyVersion: number;
  typ: EnvelopeType;
  id: string;
}

const ENVELOPE_TYPES: readonly EnvelopeType[] = ['turn', 'vector', 'snapshot', 'kcv'];

export function parseAad(aad: string): AadParts {
  const match = /^lumen:v2:(\d+):([a-z]+):(.+)$/.exec(aad);
  if (!match) throw new Error('Malformed envelope AAD');
  const typ = match[2] as EnvelopeType;
  if (!ENVELOPE_TYPES.includes(typ)) throw new Error('Unknown envelope type in AAD');
  return { keyVersion: Number(match[1]), typ, id: match[3]! };
}

export async function encryptBytes(
  key: CryptoKey,
  bytes: Uint8Array,
  typ: EnvelopeType,
  aadId: string,
  keyVersion: number,
): Promise<EncryptedEnvelope> {
  const aad = buildAad(typ, keyVersion, aadId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    key,
    bytes as BufferSource,
  );
  return {
    v: 2,
    alg: 'AES-GCM',
    typ,
    aad,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export interface ExpectedEnvelope {
  typ: EnvelopeType;
  keyVersion: number;
  /** Exact AAD id to enforce. Omit only when the id must be read FROM the
   *  envelope (restore-by-rootHash reads the seq out of the AAD) — then the
   *  caller validates the parsed id itself. */
  aadId?: string;
}

/**
 * Structural context checks first (clear errors), then GCM decryption with the
 * envelope's AAD as additionalData — so even a hand-edited `aad` field fails
 * authentication, because the ciphertext was bound to the original string.
 */
export async function decryptBytes(
  key: CryptoKey,
  env: EncryptedEnvelope,
  expected: ExpectedEnvelope,
): Promise<Uint8Array> {
  if (env.v !== 2 || env.alg !== 'AES-GCM') throw new Error('Unsupported envelope version');
  const parts = parseAad(env.aad);
  if (env.typ !== expected.typ || parts.typ !== expected.typ) {
    throw new Error(`Envelope type mismatch: expected ${expected.typ}, got ${env.typ}`);
  }
  if (parts.keyVersion !== expected.keyVersion) {
    throw new Error(
      `Envelope key version mismatch: expected v${expected.keyVersion}, got v${parts.keyVersion}`,
    );
  }
  if (expected.aadId !== undefined && parts.id !== expected.aadId) {
    throw new Error('Envelope context mismatch: this blob belongs to a different slot');
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(env.iv),
      additionalData: encoder.encode(env.aad),
    },
    key,
    base64ToBytes(env.ciphertext),
  );
  return new Uint8Array(plaintext);
}
