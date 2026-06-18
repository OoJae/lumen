/**
 * Wallet-signature → AES-GCM key derivation (deterministic).
 *
 * The user signs a FIXED message with their wallet; we SHA-256 that signature to
 * get 256 bits of key material and import it as an AES-GCM key. Same wallet +
 * same message ⇒ same key, every time, on any device — and the signature/key
 * never leave the device or touch any server.
 *
 * Foundational for Wave 2 (encrypting entries before they reach 0G Storage).
 * Tested in ./crypto.test.ts. Not yet wired into the Wave 1 flow.
 */

export const KEY_DERIVATION_MESSAGE =
  'Lumen — sign to unlock your private journal.\n\n' +
  'This signature derives the encryption key for your entries on this device. ' +
  'It never leaves your device and is never sent to Lumen or any server.\n\n' +
  'Version: 1';

export function getKeyDerivationMessage(): string {
  return KEY_DERIVATION_MESSAGE;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string (odd length)');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('Invalid hex string');
    out[i] = byte;
  }
  return out;
}

/** 32 bytes of deterministic key material = SHA-256(signature). */
export async function deriveKeyMaterial(signatureHex: string): Promise<Uint8Array> {
  const sig = hexToBytes(signatureHex);
  const digest = await crypto.subtle.digest('SHA-256', sig);
  return new Uint8Array(digest);
}

/** Non-extractable AES-GCM key derived from a wallet signature. */
export async function deriveAesKey(signatureHex: string): Promise<CryptoKey> {
  const material = await deriveKeyMaterial(signatureHex);
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}
