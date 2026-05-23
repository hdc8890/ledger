import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';

vi.mock('recharts', () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: ({ data }: { data: unknown[] }) => (
    <div data-testid="pie" data-slices={data.length} />
  ),
  Cell: () => null,
  // Call formatter with both number and non-number values, and with/without name.
  Tooltip: ({
    formatter,
  }: {
    formatter?: (value: unknown, name: unknown) => unknown;
  }) => {
    formatter?.(50000, 'home');
    formatter?.('not-a-number', undefined);
    return null;
  },
}));

vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { AllocationDonut } from '../allocation-donut';
import type { AllocationSlice } from '../allocation-donut';

describe('AllocationDonut', () => {
  it('renders empty state when no slices', () => {
    render(<AllocationDonut slices={[]} />);
    expect(screen.getByText(/no assets yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
  });

  it('renders the pie chart when slices are provided', () => {
    const slices: AllocationSlice[] = [
      { kind: 'home', valueDollars: 450000, label: 'Home' },
      { kind: 'cash', valueDollars: 20000, label: 'Cash' },
    ];
    render(<AllocationDonut slices={slices} />);
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    expect(screen.getByTestId('pie')).toHaveAttribute('data-slices', '2');
  });

  it('renders legend labels for each slice', () => {
    const slices: AllocationSlice[] = [
      { kind: 'brokerage', valueDollars: 100000, label: 'Brokerage' },
    ];
    render(<AllocationDonut slices={slices} />);
    expect(screen.getByText('Brokerage')).toBeInTheDocument();
  });

  it('renders the section heading', () => {
    render(<AllocationDonut slices={[]} />);
    expect(screen.getByText(/asset allocation/i)).toBeInTheDocument();
  });
});
