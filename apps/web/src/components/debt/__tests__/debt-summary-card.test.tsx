import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DebtSummaryCard } from '../debt-summary-card';

describe('DebtSummaryCard', () => {
  it('renders the total balance', () => {
    render(
      <DebtSummaryCard totalBalanceCents={30000000n} estimatedMonthlyMinimumCents={162500n} />,
    );
    expect(screen.getByText(/\$300,000\.00/)).toBeInTheDocument();
  });

  it('renders the estimated monthly minimum when provided', () => {
    render(
      <DebtSummaryCard totalBalanceCents={10000000n} estimatedMonthlyMinimumCents={50000n} />,
    );
    expect(screen.getByText(/\$500\.00/)).toBeInTheDocument();
  });

  it('renders — when no monthly minimum data', () => {
    render(
      <DebtSummaryCard totalBalanceCents={10000000n} estimatedMonthlyMinimumCents={null} />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/add apr to liabilities/i)).toBeInTheDocument();
  });
});
