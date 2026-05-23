import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  TrendingUp: () => <svg data-testid="trending-up" />,
  TrendingDown: () => <svg data-testid="trending-down" />,
}));

import { SavingsRateCard } from '../savings-rate-card';

describe('SavingsRateCard', () => {
  it('displays the correct savings rate percentage when income > 0', () => {
    // $1000 income, $600 spending → 40% savings rate
    render(
      <SavingsRateCard
        incomeCents={100000n}
        spendingCents={60000n}
        savingsCents={40000n}
      />,
    );
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('shows TrendingUp icon for positive savings', () => {
    render(
      <SavingsRateCard
        incomeCents={100000n}
        spendingCents={60000n}
        savingsCents={40000n}
      />,
    );
    expect(screen.getByTestId('trending-up')).toBeInTheDocument();
  });

  it('shows TrendingDown icon for negative savings (spending > income)', () => {
    // Spending exceeds income
    render(
      <SavingsRateCard
        incomeCents={60000n}
        spendingCents={100000n}
        savingsCents={-40000n}
      />,
    );
    expect(screen.getByTestId('trending-down')).toBeInTheDocument();
  });

  it('shows dash when income is zero', () => {
    render(
      <SavingsRateCard
        incomeCents={0n}
        spendingCents={0n}
        savingsCents={0n}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders income and spending amounts', () => {
    render(
      <SavingsRateCard
        incomeCents={500000n}
        spendingCents={300000n}
        savingsCents={200000n}
      />,
    );
    // $5,000.00 income
    expect(screen.getByText('$5,000.00')).toBeInTheDocument();
    // $3,000.00 spending
    expect(screen.getByText('$3,000.00')).toBeInTheDocument();
  });

  it('rounds savings rate to nearest integer', () => {
    // $300 income, $100 spending → 66.67% → rounds to 67%
    render(
      <SavingsRateCard
        incomeCents={30000n}
        spendingCents={10000n}
        savingsCents={20000n}
      />,
    );
    expect(screen.getByText('67%')).toBeInTheDocument();
  });
});
