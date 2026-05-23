import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { DebtEmptyState } from '../empty-state';

describe('DebtEmptyState', () => {
  it('renders the heading and description', () => {
    render(<DebtEmptyState />);
    expect(screen.getByText(/no liabilities yet/i)).toBeInTheDocument();
    expect(screen.getByText(/connect accounts with loans/i)).toBeInTheDocument();
  });

  it('renders a link to /connect', () => {
    render(<DebtEmptyState />);
    const link = screen.getByRole('link', { name: /connect a bank/i });
    expect(link).toHaveAttribute('href', '/connect');
  });
});
