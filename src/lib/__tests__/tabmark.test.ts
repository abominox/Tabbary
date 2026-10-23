import { describe, it, expect } from 'vitest';
import { tabMark, hostnameOf, hashString } from '@/lib/tabmark';

describe('hostnameOf', () => {
  it('strips protocol, path and www', () => {
    expect(hostnameOf('https://www.github.com/a/b?c=1')).toBe('github.com');
    expect(hostnameOf('http://arxiv.org/abs/123')).toBe('arxiv.org');
  });

  it('falls back for non-URL strings', () => {
    expect(hostnameOf('chrome://extensions')).toBe('extensions');
    expect(hostnameOf('not a url')).toBe('not a url');
  });
});

describe('hashString', () => {
  it('is stable for the same input', () => {
    expect(hashString('github.com')).toBe(hashString('github.com'));
  });

  it('differs for different inputs', () => {
    expect(hashString('github.com')).not.toBe(hashString('arxiv.org'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = hashString('example.com');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});

describe('tabMark', () => {
  it('uses the first label of the hostname, uppercased', () => {
    expect(tabMark('https://github.com/x').letter).toBe('G');
    expect(tabMark('https://www.arxiv.org/abs').letter).toBe('A');
  });

  it('is deterministic per host', () => {
    const a = tabMark('https://github.com/one');
    const b = tabMark('https://github.com/two');
    expect(a.bg).toBe(b.bg);
    expect(a.fg).toBe(b.fg);
    expect(a.letter).toBe(b.letter);
  });

  it('always returns readable colours for the tile', () => {
    const mark = tabMark('https://example.com');
    expect(mark.bg).toMatch(/^#[0-9A-F]{6}$/i);
    expect(mark.fg).toMatch(/^#[0-9A-F]{6}$/i);
    expect(mark.host).toBe('example.com');
  });

  it('never returns an empty letter', () => {
    expect(tabMark('').letter).not.toBe('');
    expect(tabMark('https://').letter).not.toBe('');
  });
});
