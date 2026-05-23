import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';
import type { CashFlowMonth } from '@/db/queries/cash-flow';

// Mock Recharts — renders minimal stub elements so we can assert on labels/keys
vi.mock('recharts', () => ({
  BarChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
    <div data-testid="bar-chart" data-rows={data.length}>
      {children}
    </div>
  ),
  Bar: ({ dataKey }: { dataKey: string }) => <div data-testid={`bar-${dataKey}`} />,
  XAxis: ({ dataKey }: { dataKey: string }) => <div data-testid={`xaxis-${dataKey}`} />,
  YAxis: () => <div data-testid="yaxis" />,
  CartesianGrid: () => null,
  Legend: () => <div data-testid="legend" />,
  Tooltip: () => null,
}));

vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { CashFlowBarChart } from '../cash-flow-bar-chart';

const makeMonth = (month: string, incomeCents: bigint, spendingCents: bigint): CashFlowMonth => ({
  month,
  incomeCents,
  spendingCents,
  savingsCents: incomeCents - spendingCents,
  topCategories: [],
});

describe('CashFlowBarChart', () => {
  it('renders the chart with data rows', () => {
    const data = [
      makeMonth('2025-01', 500000n, 300000n),
      makeMonth('2025-02', 520000n, 310000n),
    ];
    render(<CashFlowBarChart data={data} />);
    expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-rows', '2');
  });

  it('renders income and spending bars', () => {
    const data = [makeMonth('2025-03', 400000n, 250000n)];
    render(<CashFlowBarChart data={data} />);
    expect(screen.getByTestId('bar-incomeDollars')).toBeInTheDocument();
    expect(screen.getByTestId('bar-spendingDollars')).toBeInTheDocument();
  });

  it('shows empty state message when data is empty', () => {
    render(<CashFlowBarChart data={[]} />);
    expect(screen.getByText(/no cash flow data yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('renders the section heading', () => {
    const data = [makeMonth('2025-04', 600000n, 400000n)];
    render(<CashFlowBarChart data={data} />);
    expect(screen.getByText(/income vs spending/i)).toBeInTheDocument();
  });
});
