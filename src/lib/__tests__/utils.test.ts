import { describe, it, expect, vi } from 'vitest';
import { cn, debounce, formatRelativeTime, clamp } from '../utils';

describe('cn', () => {
  it('merges class names without conflicts', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
  });

  it('handles conditional classes via clsx syntax', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('resolves tailwind conflicts (tailwind-merge)', () => {
    // twMerge should keep the last value for conflicting classes
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('handles empty / undefined inputs', () => {
    expect(cn()).toBe('');
    expect(cn(undefined, null, '')).toBe('');
  });
});

describe('debounce', () => {
  it('calls the function after the wait period', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('a');

    vi.useRealTimers();
  });

  it('cancels a pending call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    debounced.cancel();

    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('flushes a pending call immediately', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    expect(fn).not.toHaveBeenCalled();

    debounced.flush();
    expect(fn).toHaveBeenCalledWith('a');

    // Timer should be cleared after flush
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('only calls once for rapid successive calls within the wait period', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    debounced('b');
    debounced('c');

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');

    vi.useRealTimers();
  });
});

describe('formatRelativeTime', () => {
  const now = Date.now();

  it('returns "just now" for very recent timestamps', () => {
    expect(formatRelativeTime(now)).toBe('just now');
    expect(formatRelativeTime(now - 10_000)).toBe('just now'); // 10s ago
    expect(formatRelativeTime(now + 5000)).toBe('just now'); // future? still "just now"
  });

  it('returns "Xm ago" for times within the last hour', () => {
    expect(formatRelativeTime(now - 60_000)).toBe('1m ago');
    expect(formatRelativeTime(now - 5 * 60_000)).toBe('5m ago');
    expect(formatRelativeTime(now - 59 * 60_000)).toBe('59m ago');
  });

  it('returns "Xh ago" for times within the last day', () => {
    expect(formatRelativeTime(now - 60 * 60_000)).toBe('1h ago');
    expect(formatRelativeTime(now - 3 * 60 * 60_000)).toBe('3h ago');
  });

  it('returns "Xd ago" for times within the last 7 days', () => {
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000)).toBe('2d ago');
    expect(formatRelativeTime(now - 6 * 24 * 60 * 60_000)).toBe('6d ago');
  });

  it('returns "Xw ago" for times within the last 30 days', () => {
    expect(formatRelativeTime(now - 14 * 24 * 60 * 60_000)).toBe('2w ago');
  });

  it('falls back to locale date for older timestamps', () => {
    // Use a date far enough back that relative formatting drops to locale date
    const old = new Date('2023-06-01T12:00:00Z').getTime();
    const result = formatRelativeTime(old);
    // Should return a locale date string (contains month abbreviation + year)
    expect(result).toMatch(/\d{4}/);
    expect(typeof result).toBe('string');
    expect(result).not.toMatch(/^(just now|\d+[mhdw] ago)$/);
  });
});

describe('clamp', () => {
  it('returns the value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns min when below range', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('returns max when above range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('handles edge cases', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});