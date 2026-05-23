import { describe, it, expect } from 'vitest';
import { buildPayoffSeries } from '../payoff-chart';
import type { LiabilityPayoffInput } from '../payoff-chart';

const base: LiabilityPayoffInput = {
  id: 'l1',
  name: 'Mortgage',
  balanceCents: 30000000n, // $300,000
  apr: 0.065,
  termMonths: 360,
};

describe('buildPayoffSeries', () => {
  it('starts at the full balance at month 0', () => {
    const series = buildPayoffSeries(base);
    expect(series[0]).toEqual({ month: 0, balanceCents: 30000000n });
  });

  it('ends at zero balance', () => {
    const series = buildPayoffSeries(base);
    const last = series[series.length - 1];
    expect(last?.balanceCents).toBe(0n);
  });

  it('produces a monotonically decreasing balance', () => {
    const series = buildPayoffSeries(base);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.balanceCents).toBeLessThanOrEqual(series[i - 1]!.balanceCents);
    }
  });

  it('uses linear paydown when APR is null (zero interest)', () => {
    const noApr: LiabilityPayoffInput = { ...base, apr: null, termMonths: 12 };
    const series = buildPayoffSeries(noApr);
    expect(series[0]?.balanceCents).toBe(30000000n);
    expect(series[series.length - 1]?.balanceCents).toBe(0n);
    // Linear: each step should reduce by ~balanceCents/12
    const step0 = series[0]!.balanceCents;
    const step1 = series[1]!.balanceCents;
    const reduction = step0 - step1;
    expect(reduction).toBe(30000000n / 12n);
  });

  it('uses 60-month default when termMonths is null', () => {
    const revolving: LiabilityPayoffInput = { ...base, termMonths: null };
    const series = buildPayoffSeries(revolving);
    // Should produce at most 61 points (months 0–60) or end at 0
    expect(series.length).toBeLessThanOrEqual(62);
  });

  it('does not crash when termMonths is 0 (treats as unknown, uses 60-month default)', () => {
    const zeroTerm: LiabilityPayoffInput = { ...base, termMonths: 0, apr: null };
    const series = buildPayoffSeries(zeroTerm);
    expect(series.length).toBeGreaterThan(1);
    expect(series[0]?.balanceCents).toBe(30000000n);
    expect(series[series.length - 1]?.balanceCents).toBe(0n);
  });

  it('does not crash when termMonths is negative (treats as unknown)', () => {
    const negTerm: LiabilityPayoffInput = { ...base, termMonths: -1, apr: null };
    const series = buildPayoffSeries(negTerm);
    expect(series.length).toBeGreaterThan(1);
  });

  it('returns a single zero point when balance is zero', () => {
    const paid: LiabilityPayoffInput = { ...base, balanceCents: 0n };
    const series = buildPayoffSeries(paid);
    expect(series).toEqual([{ month: 0, balanceCents: 0n }]);
  });

  it('respects maxMonths cap', () => {
    const longLoan: LiabilityPayoffInput = { ...base, termMonths: 360 };
    const series = buildPayoffSeries(longLoan, 24);
    // Should not exceed maxMonths + 2 points
    expect(series.length).toBeLessThanOrEqual(26);
  });
});
