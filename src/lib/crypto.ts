/**
 * Passphrase-based encryption for export files.
 *
 * PBKDF2-SHA256 → AES-GCM-256, both from WebCrypto, so there is no dependency
 * and the key never leaves the device. The payload is self-describing so a
 * future version can migrate KDF parameters without guessing.
 */

const DEFAULT_ITERATIONS = 600_000;

export interface EncryptedPayload {
  format: 'windrow-encrypted';
  version: 1;
  kdf: {
    name: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;
  };
  cipher: 'AES-GCM';
  iv: string;
  data: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt any JSON-serialisable value with a passphrase. */
export async function encryptJson(
  value: unknown,
  passphrase: string,
  opts?: { iterations?: number },
): Promise<EncryptedPayload> {
  if (!passphrase) throw new Error('A passphrase is required');

  const iterations = opts?.iterations ?? DEFAULT_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);

  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );

  return {
    format: 'windrow-encrypted',
    version: 1,
    kdf: { name: 'PBKDF2-SHA256', iterations, salt: toBase64(salt) },
    cipher: 'AES-GCM',
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypt a payload produced by encryptJson.
 * Throws a readable error when the passphrase is wrong (AES-GCM authenticates,
 * so this is a tamper check too).
 */
export async function decryptJson<T = unknown>(
  payload: EncryptedPayload,
  passphrase: string,
): Promise<T> {
  if (payload?.format !== 'windrow-encrypted') {
    throw new Error('Not an encrypted Windrow export');
  }

  const salt = fromBase64(payload.kdf.salt);
  const iv = fromBase64(payload.iv);
  const key = await deriveKey(passphrase, salt, payload.kdf.iterations);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      fromBase64(payload.data) as BufferSource,
    );
  } catch {
    throw new Error('Wrong passphrase, or the file is corrupted');
  }

  return JSON.parse(decoder.decode(plaintext)) as T;
}

/** Cheap structural check used before asking for a passphrase. */
export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { format?: unknown }).format === 'windrow-encrypted'
  );
}
