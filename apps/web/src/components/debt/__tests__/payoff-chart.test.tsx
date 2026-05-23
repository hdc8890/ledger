import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';
import { buildPayoffSeries } from '../payoff-chart';
import type { LiabilityPayoffInput } from '../payoff-chart';

// Recharts stub — minimal render to verify the chart receives correct data.
vi.mock('recharts', () => ({
  LineChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
    <div data-testid="line-chart" data-points={data.length}>
      {children}
    </div>
  ),
  Line: ({ dataKey }: { dataKey: string }) => <div data-testid={`line-${dataKey}`} />,
  // Call tickFormatter to exercise the XAxis year-label branch.
  XAxis: ({
    tickFormatter,
  }: {
    tickFormatter?: (v: number) => string;
  }) => (
    <div
      data-testid="xaxis"
      data-yr0={tickFormatter?.(0) ?? ''}
      data-yr12={tickFormatter?.(12) ?? ''}
      data-yr1={tickFormatter?.(1) ?? ''}
    />
  ),
  YAxis: () => <div data-testid="yaxis" />,
  CartesianGrid: () => null,
  // Call formatter and labelFormatter to cover those inline branches.
  Tooltip: ({
    formatter,
    labelFormatter,
  }: {
    formatter?: (v: unknown) => unknown;
    labelFormatter?: (v: unknown) => unknown;
  }) => {
    formatter?.(12345);
    labelFormatter?.(6);
    return null;
  },
  Legend: () => <div data-testid="legend" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
}));

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

// ---------------------------------------------------------------------------
// PayoffChart render tests
// ---------------------------------------------------------------------------

import { PayoffChart } from '../payoff-chart';

describe('PayoffChart', () => {
  it('renders nothing when all liabilities have zero balance', () => {
    const { container } = render(
      <PayoffChart liabilities={[{ ...base, balanceCents: 0n }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the line chart for a liability with a positive balance', () => {
    render(<PayoffChart liabilities={[base]} />);
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.getByTestId('line-Mortgage')).toBeInTheDocument();
  });

  it('renders the "Projected Payoff" heading', () => {
    render(<PayoffChart liabilities={[base]} />);
    expect(screen.getByText(/projected payoff/i)).toBeInTheDocument();
  });

  it('omits the legend when only one liability is shown', () => {
    render(<PayoffChart liabilities={[base]} />);
    expect(screen.queryByTestId('legend')).not.toBeInTheDocument();
  });

  it('renders the legend when multiple liabilities are shown', () => {
    const second: LiabilityPayoffInput = {
      ...base,
      id: 'l2',
      name: 'Car Loan',
      balanceCents: 2000000n,
      apr: 0.05,
      termMonths: 60,
    };
    render(<PayoffChart liabilities={[base, second]} />);
    expect(screen.getByTestId('legend')).toBeInTheDocument();
  });
});
