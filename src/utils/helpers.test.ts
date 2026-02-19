import { describe, it, expect, vi } from 'vitest';
import { getExpiryDays, sleep, normalizeDomain, escapeCSV } from './helpers.js';

describe('getExpiryDays', () => {
  it('returns null for null input', () => {
    expect(getExpiryDays(null)).toBeNull();
  });

  it('returns positive days for a future date', () => {
    const future = new Date(Date.now() + 10 * 86400000).toISOString();
    const days = getExpiryDays(future);
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(11);
  });

  it('returns negative days for a past date', () => {
    const past = new Date(Date.now() - 5 * 86400000).toISOString();
    const days = getExpiryDays(past);
    expect(days).toBeLessThan(0);
  });

  it('returns approximately 0 for today', () => {
    const today = new Date().toISOString();
    const days = getExpiryDays(today);
    expect(days).toBeGreaterThanOrEqual(-1);
    expect(days).toBeLessThanOrEqual(1);
  });
});

describe('sleep', () => {
  it('resolves after approximately the given ms', async () => {
    vi.useFakeTimers();
    const p = sleep(100);
    vi.advanceTimersByTime(100);
    await p;
    vi.useRealTimers();
  });
});

describe('normalizeDomain', () => {
  it('trims and lowercases', () => {
    expect(normalizeDomain('  EXAMPLE.COM  ')).toBe('example.com');
  });

  it('handles empty string', () => {
    expect(normalizeDomain('')).toBe('');
  });

  it('handles undefined via default param', () => {
    expect(normalizeDomain()).toBe('');
  });
});

describe('escapeCSV', () => {
  it('wraps value in double quotes', () => {
    expect(escapeCSV('hello')).toBe('"hello"');
  });

  it('escapes internal double quotes', () => {
    expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
  });

  it('returns empty quoted string for null', () => {
    expect(escapeCSV(null)).toBe('""');
  });

  it('returns empty quoted string for undefined', () => {
    expect(escapeCSV(undefined)).toBe('""');
  });
});
