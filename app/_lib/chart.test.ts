import { describe, expect, it } from 'vitest';
import { niceMax } from './chart.ts';

describe('niceMax', () => {
  it('floors non-positive values to 1, not 0 or a negative tick', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
  });

  it('rounds up to the nearest 1 × a power of ten', () => {
    expect(niceMax(1)).toBe(1);
    expect(niceMax(100)).toBe(100);
  });

  it('rounds up to the nearest 2 × a power of ten', () => {
    expect(niceMax(150)).toBe(200);
  });

  it('rounds up to the nearest 5 × a power of ten', () => {
    expect(niceMax(3)).toBe(5);
    expect(niceMax(45)).toBe(50);
  });

  it('rounds up to the nearest 10 × a power of ten, the top of the step list', () => {
    expect(niceMax(7)).toBe(10);
    expect(niceMax(999)).toBe(1000);
  });

  it('leaves an exact step untouched, rather than rounding up past it', () => {
    expect(niceMax(500)).toBe(500);
    expect(niceMax(2000)).toBe(2000);
  });
});
