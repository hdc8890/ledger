import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDateInTz, toUserTz, utcToday } from '../dates';

describe('formatDateInTz', () => {
  it('formats a UTC date in the given timezone with the default format', () => {
    // 2024-06-15 03:00 UTC is 2024-06-14 23:00 in America/New_York
    const d = new Date('2024-06-15T03:00:00Z');
    expect(formatDateInTz(d, 'America/New_York')).toBe('Jun 14, 2024');
  });

  it('respects a custom format string', () => {
    const d = new Date('2024-06-15T12:00:00Z');
    expect(formatDateInTz(d, 'UTC', 'yyyy-MM-dd')).toBe('2024-06-15');
  });
});

describe('toUserTz', () => {
  it('returns a Date shifted to the target timezone', () => {
    const d = new Date('2024-01-01T12:00:00Z');
    const result = toUserTz(d, 'America/New_York');
    expect(result).toBeInstanceOf(Date);
    // 12:00 UTC on Jan 1 is 07:00 in NY (EST, UTC-5)
    expect(result.getHours()).toBe(7);
  });
});

describe('utcToday', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a Date at UTC midnight for the current day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T18:42:13Z'));
    const today = utcToday();
    expect(today.toISOString()).toBe('2024-06-15T00:00:00.000Z');
  });
});
