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
