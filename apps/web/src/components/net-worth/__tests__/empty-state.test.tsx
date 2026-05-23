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

import { NetWorthEmptyState } from '../empty-state';

describe('NetWorthEmptyState', () => {
  it('renders the heading and description', () => {
    render(<NetWorthEmptyState />);
    expect(screen.getByText(/no net worth data yet/i)).toBeInTheDocument();
    expect(screen.getByText(/connect your bank accounts or add manual assets/i)).toBeInTheDocument();
  });

  it('renders a link to /connect', () => {
    render(<NetWorthEmptyState />);
    const link = screen.getByRole('link', { name: /connect a bank/i });
    expect(link).toHaveAttribute('href', '/connect');
  });

  it('renders a link to /assets', () => {
    render(<NetWorthEmptyState />);
    const link = screen.getByRole('link', { name: /add an asset/i });
    expect(link).toHaveAttribute('href', '/assets');
  });
});
