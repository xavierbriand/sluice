import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayAsDay } from './today.ts';

describe('todayAsDay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the date the wall clock is currently on', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22));
    expect(todayAsDay()).toBe('2026-08-22');
  });

  it('pads a single-digit month and day, not just double-digit ones', () => {
    // Every other date this project's fixtures use happens to be two digits
    // on both sides. A dropped `+ 1` on the month or a swapped `padStart`
    // argument would only show up on the days this test picks.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 3));
    expect(todayAsDay()).toBe('2026-01-03');
  });
});
