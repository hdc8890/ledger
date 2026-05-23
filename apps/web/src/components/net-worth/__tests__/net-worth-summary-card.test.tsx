import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { NetWorthSummaryCard } from '../net-worth-summary-card';

describe('NetWorthSummaryCard', () => {
  it('renders the current net worth value', () => {
    render(<NetWorthSummaryCard netWorthCents={50000000n} previousCents={null} />);
    expect(screen.getByText('$500,000.00')).toBeInTheDocument();
  });

  it('shows positive delta vs 30d ago', () => {
    render(<NetWorthSummaryCard netWorthCents={50000000n} previousCents={48000000n} />);
    expect(screen.getByText(/\+.*30d ago/)).toBeInTheDocument();
  });

  it('shows negative delta vs 30d ago', () => {
    render(<NetWorthSummaryCard netWorthCents={48000000n} previousCents={50000000n} />);
    expect(screen.getByText(/-.*30d ago/)).toBeInTheDocument();
  });

  it('omits delta when previousCents is null', () => {
    render(<NetWorthSummaryCard netWorthCents={50000000n} previousCents={null} />);
    expect(screen.queryByText(/30d ago/)).not.toBeInTheDocument();
  });

  it('renders the card title', () => {
    render(<NetWorthSummaryCard netWorthCents={0n} previousCents={null} />);
    expect(screen.getByText(/net worth/i)).toBeInTheDocument();
  });
});
