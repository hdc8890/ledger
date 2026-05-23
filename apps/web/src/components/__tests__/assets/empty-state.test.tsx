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

import { AssetsEmptyState } from '../../assets/empty-state';

describe('AssetsEmptyState', () => {
  it('renders the heading and description', () => {
    render(<AssetsEmptyState />);
    expect(screen.getByText(/no assets yet/i)).toBeInTheDocument();
    expect(screen.getByText(/add your home, vehicles/i)).toBeInTheDocument();
  });

  it('renders a link to /connect', () => {
    render(<AssetsEmptyState />);
    const link = screen.getByRole('link', { name: /connect a bank/i });
    expect(link).toHaveAttribute('href', '/connect');
  });
});
