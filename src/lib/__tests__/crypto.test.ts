import { describe, it, expect } from 'vitest';
import { encryptJson, decryptJson, isEncryptedPayload } from '@/lib/crypto';

// Keep KDF iterations low so the suite stays fast; the default is 600k.
const FAST = { iterations: 1_000 };

describe('encryptJson / decryptJson', () => {
  it('round-trips a payload', async () => {
    const data = { sessions: [{ id: 'a', tabs: ['https://x.test'] }] };
    const payload = await encryptJson(data, 'correct horse battery staple', FAST);
    const out = await decryptJson<typeof data>(payload, 'correct horse battery staple');
    expect(out).toEqual(data);
  });

  it('produces a self-describing envelope', async () => {
    const payload = await encryptJson({ a: 1 }, 'pw', FAST);
    expect(payload.format).toBe('tabbary-encrypted');
    expect(payload.version).toBe(1);
    expect(payload.kdf.name).toBe('PBKDF2-SHA256');
    expect(payload.kdf.iterations).toBe(1_000);
    expect(payload.cipher).toBe('AES-GCM');
    expect(payload.kdf.salt).toBeTruthy();
    expect(payload.iv).toBeTruthy();
    expect(payload.data).toBeTruthy();
  });

  it('never stores the plaintext', async () => {
    const payload = await encryptJson({ secret: 'my-private-tab' }, 'pw', FAST);
    expect(JSON.stringify(payload)).not.toContain('my-private-tab');
  });

  it('uses a fresh salt and iv per call', async () => {
    const a = await encryptJson({ x: 1 }, 'pw', FAST);
    const b = await encryptJson({ x: 1 }, 'pw', FAST);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('fails with the wrong passphrase', async () => {
    const payload = await encryptJson({ x: 1 }, 'right', FAST);
    await expect(decryptJson(payload, 'wrong')).rejects.toThrow(/Wrong passphrase/);
  });

  it('fails when the ciphertext is tampered with', async () => {
    const payload = await encryptJson({ x: 1 }, 'pw', FAST);
    const bytes = atob(payload.data).split('');
    bytes[0] = String.fromCharCode(bytes[0]!.charCodeAt(0) ^ 0xff);
    const tampered = { ...payload, data: btoa(bytes.join('')) };
    await expect(decryptJson(tampered, 'pw')).rejects.toThrow(/Wrong passphrase|corrupted/);
  });

  it('rejects a non-Tabbary envelope', async () => {
    await expect(decryptJson({ format: 'other' } as never, 'pw')).rejects.toThrow(
      /Not an encrypted Tabbary export/,
    );
  });

  it('requires a passphrase to encrypt', async () => {
    await expect(encryptJson({ x: 1 }, '', FAST)).rejects.toThrow(/passphrase is required/);
  });

  it('handles unicode payloads', async () => {
    const data = { title: 'Résumé — 日本語 — 🔐' };
    const payload = await encryptJson(data, 'pässwörd', FAST);
    const out = await decryptJson<typeof data>(payload, 'pässwörd');
    expect(out).toEqual(data);
  });
});

describe('isEncryptedPayload', () => {
  it('detects our envelope', async () => {
    const payload = await encryptJson({ x: 1 }, 'pw', FAST);
    expect(isEncryptedPayload(payload)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isEncryptedPayload(null)).toBe(false);
    expect(isEncryptedPayload({})).toBe(false);
    expect(isEncryptedPayload({ format: 'tabbary-export' })).toBe(false);
  });
});

describe('legacy encrypted tags', () => {
  it('recognises a payload written before the rename', () => {
    // The ciphertext is format-identical; only the tag changed.
    expect(isEncryptedPayload({ format: 'windrow-encrypted', kdf: {}, iv: '', data: '' })).toBe(true);
  });

  it('still recognises the current tag', () => {
    expect(isEncryptedPayload({ format: 'tabbary-encrypted', kdf: {}, iv: '', data: '' })).toBe(true);
  });

  it('rejects an unrelated payload', () => {
    expect(isEncryptedPayload({ format: 'other', kdf: {}, iv: '', data: '' })).toBe(false);
  });
});
