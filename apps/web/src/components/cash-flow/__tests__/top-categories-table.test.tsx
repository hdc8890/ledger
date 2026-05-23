import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SpendingByCategory } from '@/db/queries/cash-flow';

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  TrendingUp: () => <svg data-testid="trending-up" />,
  TrendingDown: () => <svg data-testid="trending-down" />,
  Minus: () => <svg data-testid="minus" />,
}));

import { TopCategoriesTable } from '../top-categories-table';

const cat = (category: string, totalCents: bigint): SpendingByCategory => ({
  category,
  totalCents,
});

describe('TopCategoriesTable', () => {
  it('renders each category name', () => {
    const current = [cat('Groceries', 50000n), cat('Dining', 30000n)];
    render(
      <TopCategoriesTable
        currentCategories={current}
        previousCategories={[]}
        currentMonthLabel="May 2025"
      />,
    );
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('Dining')).toBeInTheDocument();
  });

  it('renders formatted amounts', () => {
    const current = [cat('Groceries', 50000n)];
    render(
      <TopCategoriesTable
        currentCategories={current}
        previousCategories={[]}
        currentMonthLabel="May 2025"
      />,
    );
    expect(screen.getByText('$500.00')).toBeInTheDocument();
  });

  it('shows empty state when no categories', () => {
    render(
      <TopCategoriesTable
        currentCategories={[]}
        previousCategories={[]}
        currentMonthLabel="May 2025"
      />,
    );
    expect(screen.getByText(/no spending recorded this month/i)).toBeInTheDocument();
  });

  it('shows TrendingUp when spending increased vs prior month', () => {
    const current = [cat('Groceries', 60000n)];
    const previous = [cat('Groceries', 40000n)];
    render(
      <TopCategoriesTable
        currentCategories={current}
        previousCategories={previous}
        currentMonthLabel="May 2025"
      />,
    );
    expect(screen.getByTestId('trending-up')).toBeInTheDocument();
  });

  it('shows TrendingDown when spending decreased vs prior month', () => {
    const current = [cat('Dining', 20000n)];
    const previous = [cat('Dining', 45000n)];
    render(
      <TopCategoriesTable
        currentCategories={current}
        previousCategories={previous}
        currentMonthLabel="May 2025"
      />,
    );
    expect(screen.getByTestId('trending-down')).toBeInTheDocument();
  });

  it('shows no delta icon when category is new (not in prior month)', () => {
    const current = [cat('Travel', 80000n)];
    render(
      <TopCategoriesTable
        currentCategories={current}
        previousCategories={[]}
        currentMonthLabel="May 2025"
      />,
    );
    // No trending icon for a brand-new category
    expect(screen.queryByTestId('trending-up')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trending-down')).not.toBeInTheDocument();
  });

  it('includes the month label in the heading', () => {
    render(
      <TopCategoriesTable
        currentCategories={[]}
        previousCategories={[]}
        currentMonthLabel="April 2025"
      />,
    );
    expect(screen.getByText(/april 2025/i)).toBeInTheDocument();
  });
});
