import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type React from 'react';

vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: ({ dataKey }: { dataKey: string }) => <div data-testid={`line-${dataKey}`} />,
  // Invoke tickFormatter so the inline format branches are exercised.
  XAxis: ({
    tickFormatter,
  }: {
    tickFormatter?: (v: string) => string;
  }) => <div data-testid="xaxis" data-sample={tickFormatter?.('2025-01') ?? ''} />,
  YAxis: ({
    tickFormatter,
  }: {
    tickFormatter?: (v: number) => string;
  }) => (
    <div
      data-testid="yaxis"
      data-sm={tickFormatter?.(500) ?? ''}
      data-k={tickFormatter?.(15000) ?? ''}
      data-m={tickFormatter?.(2000000) ?? ''}
    />
  ),
  CartesianGrid: () => null,
  ChartTooltip: () => null,
}));

vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
  // Render content so ChartTooltipContent is mounted and its formatter called.
  ChartTooltip: ({ content }: { content?: React.ReactNode }) => <>{content ?? null}</>,
  // Call formatter/labelFormatter so those branches are exercised.
  ChartTooltipContent: ({
    formatter,
    labelFormatter,
  }: {
    formatter?: (v: unknown) => unknown;
    labelFormatter?: (v: unknown) => unknown;
  }) => {
    formatter?.(12345);
    labelFormatter?.('2025-01-15');
    return null;
  },
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { NetWorthTrendChart } from '../net-worth-trend-chart';
import type { TrendPoint } from '../net-worth-trend-chart';

const makePoint = (date: string, valueDollars: number): TrendPoint => ({
  date,
  valueDollars,
});

describe('NetWorthTrendChart', () => {
  it('shows empty state when all data arrays are empty', () => {
    render(<NetWorthTrendChart data30d={[]} data90d={[]} data1y={[]} />);
    expect(screen.getByText(/no trend data yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  });

  it('renders the line chart when 30d data is provided', () => {
    const data = [makePoint('2025-01-01', 500000), makePoint('2025-01-31', 510000)];
    render(<NetWorthTrendChart data30d={data} data90d={[]} data1y={[]} />);
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.getByTestId('line-valueDollars')).toBeInTheDocument();
  });

  it('renders range toggle buttons', () => {
    render(<NetWorthTrendChart data30d={[]} data90d={[]} data1y={[]} />);
    expect(screen.getByRole('button', { name: /30D/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /90D/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1Y/i })).toBeInTheDocument();
  });

  it('switches to 90d range when the 90D button is clicked', () => {
    const data90d = [makePoint('2024-10-01', 480000), makePoint('2025-01-01', 500000)];
    render(<NetWorthTrendChart data30d={[]} data90d={data90d} data1y={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /90D/i }));
    // After switching, the chart should render (90d has data).
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  it('renders the Trend heading', () => {
    render(<NetWorthTrendChart data30d={[]} data90d={[]} data1y={[]} />);
    expect(screen.getByRole('heading', { name: /trend/i })).toBeInTheDocument();
  });

  it('formats axis values correctly via YAxis tickFormatter', () => {
    const data = [makePoint('2025-01-01', 500000)];
    render(<NetWorthTrendChart data30d={data} data90d={[]} data1y={[]} />);
    const yaxis = screen.getByTestId('yaxis');
    // Small value: no suffix
    expect(yaxis).toHaveAttribute('data-sm', '$500');
    // Thousands
    expect(yaxis).toHaveAttribute('data-k', '$15k');
    // Millions
    expect(yaxis).toHaveAttribute('data-m', '$2.0M');
  });
});
