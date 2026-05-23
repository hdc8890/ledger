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

import { CashFlowEmptyState } from '../empty-state';

describe('CashFlowEmptyState', () => {
  it('renders the heading and description', () => {
    render(<CashFlowEmptyState />);
    expect(screen.getByText(/no cash flow data yet/i)).toBeInTheDocument();
    expect(screen.getByText(/connect your bank accounts/i)).toBeInTheDocument();
  });

  it('renders a link to /connect', () => {
    render(<CashFlowEmptyState />);
    const link = screen.getByRole('link', { name: /connect a bank/i });
    expect(link).toHaveAttribute('href', '/connect');
  });
});
