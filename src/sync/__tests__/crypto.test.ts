import { describe, it, expect } from 'vitest';
import {
  createSyncKeys,
  generateRecoveryPhrase,
  isValidRecoveryPhrase,
  canonicalPhrase,
  normalizePhrase,
  unwrapWithPassphrase,
  unwrapWithRecoveryPhrase,
  encryptBlob,
  decryptBlob,
  keyFingerprint,
  bytesToBase64,
  base64ToBytes,
  DEFAULT_KDF_ITERATIONS,
} from '@/sync/crypto';

// The real KDF is deliberately slow. Tests that do not exercise the KDF
// parameters use the fast path; the default is asserted separately.
describe('sync crypto', () => {
  describe('recovery phrases', () => {
    it('generates 24 valid words', () => {
      const phrase = generateRecoveryPhrase();
      expect(phrase.split(' ')).toHaveLength(24);
      expect(isValidRecoveryPhrase(phrase)).toBe(true);
    });

    it('normalises case and whitespace', () => {
      const phrase = generateRecoveryPhrase();
      const messy = `  ${phrase.toUpperCase().replace(/ /g, '   ')}  `;
      expect(normalizePhrase(messy)).toBe(phrase);
      expect(isValidRecoveryPhrase(messy)).toBe(true);
    });

    it('rejects nonsense and wrong word counts', () => {
      expect(isValidRecoveryPhrase('not a real phrase')).toBe(false);
      expect(isValidRecoveryPhrase('')).toBe(false);
      expect(isValidRecoveryPhrase('abandon '.repeat(24))).toBe(false);
    });

    it('canonicalises to the same phrase', () => {
      const phrase = generateRecoveryPhrase();
      expect(canonicalPhrase(phrase.toUpperCase())).toBe(phrase);
    });

    it('generates a different phrase each time', () => {
      expect(generateRecoveryPhrase()).not.toBe(generateRecoveryPhrase());
    });
  });

  describe('key wrapping', () => {
    it('creates a data key, a phrase, and two wrapped copies', async () => {
      const keys = await createSyncKeys('a sufficiently long passphrase');
      expect(keys.dataKey).toHaveLength(32);
      expect(keys.recoveryPhrase.split(' ')).toHaveLength(24);
      expect(keys.wrappedByPassphrase.kdf.name).toBe('PBKDF2-SHA256');
      expect(keys.wrappedByPassphrase.kdf.iterations).toBe(DEFAULT_KDF_ITERATIONS);
      expect(keys.wrappedByRecovery.kdf.name).toBe('HKDF-SHA256');
      // The data key itself must never appear in the wrapped copies.
      expect(JSON.stringify(keys.wrappedByPassphrase)).not.toContain(
        bytesToBase64(keys.dataKey),
      );
    });

    it('rejects short passphrases', async () => {
      await expect(createSyncKeys('short')).rejects.toThrow(/at least 10/);
    });

    it('unwraps the same data key with the passphrase', async () => {
      const keys = await createSyncKeys('correct horse battery staple');
      const recovered = await unwrapWithPassphrase(
        keys.wrappedByPassphrase,
        'correct horse battery staple',
      );
      expect(Array.from(recovered)).toEqual(Array.from(keys.dataKey));
    });

    it('unwraps the same data key with the recovery phrase', async () => {
      const keys = await createSyncKeys('correct horse battery staple');
      const recovered = await unwrapWithRecoveryPhrase(
        keys.wrappedByRecovery,
        keys.recoveryPhrase,
      );
      expect(Array.from(recovered)).toEqual(Array.from(keys.dataKey));
    });

    it('accepts a messy but valid recovery phrase', async () => {
      const keys = await createSyncKeys('correct horse battery staple');
      const messy = ` ${keys.recoveryPhrase.toUpperCase()} `;
      const recovered = await unwrapWithRecoveryPhrase(keys.wrappedByRecovery, messy);
      expect(Array.from(recovered)).toEqual(Array.from(keys.dataKey));
    });

    it('fails with the wrong passphrase', async () => {
      const keys = await createSyncKeys('correct horse battery staple');
      await expect(
        unwrapWithPassphrase(keys.wrappedByPassphrase, 'wrong passphrase here'),
      ).rejects.toThrow(/Wrong passphrase/);
    });

    it('fails with the wrong recovery phrase', async () => {
      const keys = await createSyncKeys('correct horse battery staple');
      await expect(
        unwrapWithRecoveryPhrase(keys.wrappedByRecovery, generateRecoveryPhrase()),
      ).rejects.toThrow(/does not match/);
    });

    it('fails on a malformed recovery phrase with a clear error', async () => {
      const keys = await createSyncKeys('correct horse battery staple');
      await expect(
        unwrapWithRecoveryPhrase(keys.wrappedByRecovery, 'nope'),
      ).rejects.toThrow(/not a valid recovery phrase/);
    });
  });

  describe('blob encryption', () => {
    const dataKey = new Uint8Array(32).fill(7);
    const updatedAt = 1_700_000_000_000;

    it('round-trips a payload', async () => {
      const value = { name: 'Research', tabs: [{ url: 'https://a.test' }] };
      const { ciphertext, iv } = await encryptBlob(dataKey, 'blob-1', value, updatedAt);
      const out = await decryptBlob(dataKey, 'blob-1', updatedAt, ciphertext, iv);
      expect(out).toEqual(value);
    });

    it('does not leak plaintext', async () => {
      const { ciphertext, iv } = await encryptBlob(
        dataKey,
        'blob-1',
        { secret: 'private-tab-url' },
        updatedAt,
      );
      expect(ciphertext + iv).not.toContain('private-tab-url');
    });

    it('refuses a blob replayed under a different id', async () => {
      const { ciphertext, iv } = await encryptBlob(dataKey, 'blob-1', { a: 1 }, updatedAt);
      await expect(decryptBlob(dataKey, 'blob-2', updatedAt, ciphertext, iv)).rejects.toThrow(
        /Could not decrypt/,
      );
    });

    it('refuses a blob with a changed timestamp', async () => {
      const { ciphertext, iv } = await encryptBlob(dataKey, 'blob-1', { a: 1 }, updatedAt);
      await expect(
        decryptBlob(dataKey, 'blob-1', updatedAt + 1, ciphertext, iv),
      ).rejects.toThrow(/Could not decrypt/);
    });

    it('refuses a different key', async () => {
      const { ciphertext, iv } = await encryptBlob(dataKey, 'blob-1', { a: 1 }, updatedAt);
      const other = new Uint8Array(32).fill(8);
      await expect(decryptBlob(other, 'blob-1', updatedAt, ciphertext, iv)).rejects.toThrow();
    });

    it('uses a fresh IV per call', async () => {
      const a = await encryptBlob(dataKey, 'blob-1', { a: 1 }, updatedAt);
      const b = await encryptBlob(dataKey, 'blob-1', { a: 1 }, updatedAt);
      expect(a.iv).not.toBe(b.iv);
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });
  });

  describe('fingerprint', () => {
    it('is stable and differs per key', async () => {
      const a = await keyFingerprint(new Uint8Array(32).fill(1));
      const b = await keyFingerprint(new Uint8Array(32).fill(1));
      const c = await keyFingerprint(new Uint8Array(32).fill(2));
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a).toMatch(/^[0-9a-f]{2}(-[0-9a-f]{2}){3}$/);
    });
  });

  describe('base64 helpers', () => {
    it('round-trip arbitrary bytes', () => {
      const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    });
  });
});
