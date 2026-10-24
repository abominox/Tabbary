/**
 * Sync crypto.
 *
 * Two independent ways to reach the same data key:
 *   - passphrase  (PBKDF2-SHA256, high iteration count)
 *   - recovery phrase (24 BIP39 words → entropy → HKDF)
 *
 * The data key itself is random and never sent to the server; only wrapped
 * copies of it are stored locally and uploaded, so the server can hold the
 * ciphertext and the wrapped keys without being able to derive anything.
 *
 * Everything here is WebCrypto + a pure-JS BIP39 wordlist, so it runs in the
 * service worker, the UI, and Node (for tests) without a native dependency.
 */

import { generateMnemonic, mnemonicToEntropy, entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export const SYNC_AAD = 'windrow-sync-v1';
export const RECOVERY_WORDS = 24;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ── base64 helpers (browser + Node) ──────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Key derivation ───────────────────────────────────────

export interface KdfParams {
  name: 'PBKDF2-SHA256' | 'HKDF-SHA256';
  iterations: number;
  salt: string;
}

export const DEFAULT_KDF_ITERATIONS = 600_000;

async function importHkdfKey(ikm: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
}

/** Derive raw key bytes (32) from a passphrase. */
async function deriveFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase) as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    256,
  );
  return new Uint8Array(bits);
}

/** Derive raw key bytes (32) from a 24-word recovery phrase. */
async function deriveFromRecoveryPhrase(phrase: string): Promise<Uint8Array> {
  const normalized = normalizePhrase(phrase);
  let entropy: Uint8Array;
  try {
    entropy = mnemonicToEntropy(normalized, wordlist);
  } catch {
    throw new Error('That is not a valid recovery phrase');
  }

  const salt = encoder.encode('windrow-recovery-v1');
  const key = await importHkdfKey(entropy);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: encoder.encode(SYNC_AAD) as BufferSource },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

// ── Recovery phrase ──────────────────────────────────────

export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Generate a fresh 24-word phrase. Show it once; it is not stored. */
export function generateRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256);
}

/** Structural check used before accepting a phrase in the UI. */
export function isValidRecoveryPhrase(phrase: string): boolean {
  try {
    mnemonicToEntropy(normalizePhrase(phrase), wordlist);
    return true;
  } catch {
    return false;
  }
}

/** Round-trip through entropy so the UI can show a canonical form. */
export function canonicalPhrase(phrase: string): string {
  const normalized = normalizePhrase(phrase);
  return entropyToMnemonic(mnemonicToEntropy(normalized, wordlist), wordlist);
}

// ── Data key ─────────────────────────────────────────────

/**
 * Create a new random data key plus the two wrapped copies used to unlock it.
 * The caller is responsible for storing/uploading the wrapped keys and for
 * showing `recoveryPhrase` to the user exactly once.
 */
export async function createSyncKeys(passphrase: string): Promise<{
  dataKey: Uint8Array;
  recoveryPhrase: string;
  wrappedByPassphrase: WrappedKey;
  wrappedByRecovery: WrappedKey;
}> {
  if (passphrase.length < 10) {
    throw new Error('Use a passphrase of at least 10 characters');
  }

  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  const recoveryPhrase = generateRecoveryPhrase();

  const [wrappedByPassphrase, wrappedByRecovery] = await Promise.all([
    wrapWithPassphrase(dataKey, passphrase),
    wrapWithRecoveryPhrase(dataKey, recoveryPhrase),
  ]);

  return { dataKey, recoveryPhrase, wrappedByPassphrase, wrappedByRecovery };
}

export interface WrappedKey {
  kdf: KdfParams;
  iv: string;
  ciphertext: string;
}

async function wrapWithPassphrase(dataKey: Uint8Array, passphrase: string): Promise<WrappedKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = DEFAULT_KDF_ITERATIONS;
  const kekBytes = await deriveFromPassphrase(passphrase, salt, iterations);
  return wrap(dataKey, await importAesKey(kekBytes), {
    name: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToBase64(salt),
  });
}

async function wrapWithRecoveryPhrase(
  dataKey: Uint8Array,
  phrase: string,
): Promise<WrappedKey> {
  const kekBytes = await deriveFromRecoveryPhrase(phrase);
  return wrap(dataKey, await importAesKey(kekBytes), {
    name: 'HKDF-SHA256',
    iterations: 1,
    salt: bytesToBase64(encoder.encode('windrow-recovery-v1')),
  });
}

async function wrap(
  dataKey: Uint8Array,
  kek: CryptoKey,
  kdf: KdfParams,
): Promise<WrappedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      additionalData: encoder.encode(SYNC_AAD) as BufferSource,
    },
    kek,
    dataKey as BufferSource,
  );
  return {
    kdf,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ct)),
  };
}

/** Unwrap the data key with a passphrase. */
export async function unwrapWithPassphrase(
  wrapped: WrappedKey,
  passphrase: string,
): Promise<Uint8Array> {
  const salt = base64ToBytes(wrapped.kdf.salt);
  const kekBytes = await deriveFromPassphrase(passphrase, salt, wrapped.kdf.iterations);
  return unwrap(wrapped, await importAesKey(kekBytes), 'Wrong passphrase');
}

/** Unwrap the data key with a 24-word recovery phrase. */
export async function unwrapWithRecoveryPhrase(
  wrapped: WrappedKey,
  phrase: string,
): Promise<Uint8Array> {
  const kekBytes = await deriveFromRecoveryPhrase(phrase);
  return unwrap(wrapped, await importAesKey(kekBytes), 'That recovery phrase does not match');
}

async function unwrap(
  wrapped: WrappedKey,
  kek: CryptoKey,
  errorMessage: string,
): Promise<Uint8Array> {
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(wrapped.iv) as BufferSource,
        additionalData: encoder.encode(SYNC_AAD) as BufferSource,
      },
      kek,
      base64ToBytes(wrapped.ciphertext) as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error(errorMessage);
  }
}

// ── Blob encryption ──────────────────────────────────────

/**
 * Encrypt a JSON value with the data key.
 *
 * AAD binds the ciphertext to its blob id, so a blob cannot be swapped for a
 * different one (or replayed under another id) by the server.
 */
export async function encryptBlob(
  dataKey: Uint8Array,
  blobId: string,
  value: unknown,
  updatedAt: number,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importAesKey(dataKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`${SYNC_AAD}:${blobId}:${updatedAt}`);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource },
    key,
    encoder.encode(JSON.stringify(value)) as BufferSource,
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ct)), iv: bytesToBase64(iv) };
}

export async function decryptBlob<T = unknown>(
  dataKey: Uint8Array,
  blobId: string,
  updatedAt: number,
  ciphertext: string,
  iv: string,
): Promise<T> {
  const key = await importAesKey(dataKey);
  const aad = encoder.encode(`${SYNC_AAD}:${blobId}:${updatedAt}`);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource, additionalData: aad as BufferSource },
      key,
      base64ToBytes(ciphertext) as BufferSource,
    );
    return JSON.parse(decoder.decode(plain)) as T;
  } catch {
    throw new Error('Could not decrypt this blob (wrong key or tampered payload)');
  }
}

/** Short fingerprint so two devices can confirm they hold the same key. */
export async function keyFingerprint(dataKey: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', dataKey as BufferSource);
  return [...new Uint8Array(digest).slice(0, 4)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('-');
}
