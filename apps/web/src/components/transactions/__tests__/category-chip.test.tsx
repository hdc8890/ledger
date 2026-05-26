import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockCorrectCategory } = vi.hoisted(() => ({
  mockCorrectCategory: vi.fn(),
}));

vi.mock('@/app/actions/transactions', () => ({
  correctCategoryAction: mockCorrectCategory,
}));

vi.mock('@/lib/enrich/categorize', () => ({
  CATEGORY_TAXONOMY: ['Groceries', 'Streaming & Subscriptions', 'Entertainment', 'Other'],
}));

import { CategoryChip } from '../category-chip';

describe('CategoryChip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCorrectCategory.mockResolvedValue({});
  });

  it('renders the category name', () => {
    render(
      <CategoryChip
        transactionId="txn-1"
        category="Entertainment"
        categorySource="ai"
        categoryConfidence={0.9}
      />,
    );
    expect(screen.getByRole('button', { name: 'Entertainment' })).toBeInTheDocument();
  });

  it('renders source badge for ai-sourced category', () => {
    render(
      <CategoryChip
        transactionId="txn-1"
        category="Entertainment"
        categorySource="ai"
        categoryConfidence={0.9}
      />,
    );
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('renders source badge for rule-sourced category', () => {
    render(
      <CategoryChip
        transactionId="txn-1"
        category="Groceries"
        categorySource="rule"
        categoryConfidence={1.0}
      />,
    );
    expect(screen.getByText('Rule')).toBeInTheDocument();
  });

  it('renders source badge for user-sourced category', () => {
    render(
      <CategoryChip
        transactionId="txn-1"
        category="Groceries"
        categorySource="user"
        categoryConfidence={1.0}
      />,
    );
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('shows confidence badge for AI categories below 80%', () => {
    render(
      <CategoryChip
        transactionId="txn-1"
        category="Entertainment"
        categorySource="ai"
        categoryConfidence={0.65}
      />,
    );
    expect(screen.getByText('~65%')).toBeInTheDocument();
  });

  it('does not show confidence badge for AI categories at or above 80%', () => {
    render(
      <CategoryChip
        transactionId="txn-1"
        category="Entertainment"
        categorySource="ai"
        categoryConfidence={0.9}
      />,
    );
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });

  it('shows "Uncategorized" when category is null', () => {
    render(
      <CategoryChip
        transactionId="txn-1"
        category={null}
        categorySource={null}
        categoryConfidence={null}
      />,
    );
    expect(screen.getByRole('button', { name: 'Uncategorized' })).toBeInTheDocument();
  });

  it('shows select dropdown when non-user chip is clicked', () => {
    render(
      <CategoryChip
        transactionId="txn-1"
        category="Entertainment"
        categorySource="ai"
        categoryConfidence={0.9}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Entertainment' }));
    expect(screen.getByRole('combobox', { name: 'Select category' })).toBeInTheDocument();
  });

  it('does not open select when user-sourced chip is clicked', () => {
    render(
      <CategoryChip
        transactionId="txn-1"
        category="Groceries"
        categorySource="user"
        categoryConfidence={1.0}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Groceries' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('calls correctCategoryAction and shows new category optimistically', async () => {
    render(
      <CategoryChip
        transactionId="txn-1"
        category="Entertainment"
        categorySource="ai"
        categoryConfidence={0.9}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Entertainment' }));
    const select = screen.getByRole('combobox', { name: 'Select category' });
    fireEvent.change(select, { target: { value: 'Streaming & Subscriptions' } });

    await waitFor(() => {
      expect(mockCorrectCategory).toHaveBeenCalledWith('txn-1', 'Streaming & Subscriptions');
    });

    // Optimistic update shows new category immediately
    expect(screen.getByRole('button', { name: 'Streaming & Subscriptions' })).toBeInTheDocument();
  });

  it('reverts optimistic update and shows error on action failure', async () => {
    mockCorrectCategory.mockResolvedValue({ error: 'DB error' });
    render(
      <CategoryChip
        transactionId="txn-1"
        category="Entertainment"
        categorySource="ai"
        categoryConfidence={0.9}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Entertainment' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Groceries' } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('DB error');
    });

    // Reverted to original
    expect(screen.getByRole('button', { name: 'Entertainment' })).toBeInTheDocument();
  });
});
