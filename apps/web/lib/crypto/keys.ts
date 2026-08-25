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

/**
 * All key-derivation message versions ever shipped. Rotation = add v2 here,
 * bump CURRENT_KEY_VERSION, re-encrypt + re-upload; envelopes/snapshots record
 * their keyVersion, so restore knows which message to ask the wallet to sign.
 */
export const KEY_DERIVATION_MESSAGES: Record<number, string> = {
  1: KEY_DERIVATION_MESSAGE,
};

export const CURRENT_KEY_VERSION = 1;

export function getKeyDerivationMessage(version: number = CURRENT_KEY_VERSION): string {
  const message = KEY_DERIVATION_MESSAGES[version];
  if (!message) throw new Error(`Unknown key derivation message version: ${version}`);
  return message;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string (odd length)');
  // Validate the WHOLE string up front. The per-byte `Number.isNaN` guard below
  // cannot catch a bad second nibble: `parseInt` truncates at the first invalid
  // character rather than returning NaN, so `parseInt('bO', 16)` is 11, not NaN.
  // Someone transcribing their recovery key and typing a capital O for zero got
  // 32 bytes with a silently wrong one — right length, right shape, wrong key.
  // That matters more since `refuted-data-unproven` (see lib/crypto/keyTrust.ts)
  // can ADMIT a recovery key on a device holding only unproven ciphertext: a
  // typo would be accepted and start encrypting new entries under a key the
  // user does not have written down anywhere.
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('Invalid hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
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
