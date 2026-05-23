import { describe, it, expect } from 'vitest';
import {
  formatCents,
  dollarsToCents,
  centsToNumber,
  addCents,
  subtractCents,
  absCents,
  sumCents,
} from '../money';

describe('dollarsToCents', () => {
  it('converts whole dollars', () => {
    expect(dollarsToCents(12)).toBe(1200n);
  });

  it('converts fractional dollars', () => {
    expect(dollarsToCents(12.34)).toBe(1234n);
  });

  it('rounds to nearest cent', () => {
    expect(dollarsToCents(0.005)).toBe(1n);
  });

  it('handles zero', () => {
    expect(dollarsToCents(0)).toBe(0n);
  });

  it('handles negative values', () => {
    expect(dollarsToCents(-5.5)).toBe(-550n);
  });
});

describe('formatCents', () => {
  it('formats positive cents as USD', () => {
    expect(formatCents(1234n)).toBe('$12.34');
  });

  it('formats zero', () => {
    expect(formatCents(0n)).toBe('$0.00');
  });

  it('formats negative cents', () => {
    expect(formatCents(-1234n)).toBe('-$12.34');
  });
});

describe('centsToNumber', () => {
  it('returns dollars as a float', () => {
    expect(centsToNumber(100n)).toBe(1);
    expect(centsToNumber(150n)).toBe(1.5);
  });
});

describe('arithmetic helpers', () => {
  it('addCents', () => {
    expect(addCents(100n, 50n)).toBe(150n);
  });

  it('subtractCents', () => {
    expect(subtractCents(100n, 30n)).toBe(70n);
  });

  it('absCents handles negative', () => {
    expect(absCents(-200n)).toBe(200n);
  });

  it('absCents handles positive', () => {
    expect(absCents(200n)).toBe(200n);
  });

  it('sumCents over an array', () => {
    expect(sumCents([100n, 200n, 300n])).toBe(600n);
  });

  it('sumCents empty array returns 0', () => {
    expect(sumCents([])).toBe(0n);
  });
});
