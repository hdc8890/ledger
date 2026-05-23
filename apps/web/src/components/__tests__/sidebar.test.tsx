import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';

const mockPathname = vi.hoisted(() => ({ value: '/dashboard' }));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.value,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    'aria-current': ariaCurrent,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    'aria-current'?: React.AriaAttributes['aria-current'];
  }) => (
    <a href={href} className={className} aria-current={ariaCurrent}>
      {children}
    </a>
  ),
}));

vi.mock('@clerk/nextjs', () => ({
  UserButton: () => <button type="button">User menu</button>,
  useUser: () => ({ user: { firstName: 'Alice', emailAddresses: [] } }),
}));

import { Sidebar } from '../sidebar';

describe('Sidebar', () => {
  it('renders all seven nav items', () => {
    mockPathname.value = '/dashboard';
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: /net worth/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /cash flow/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /debt/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /accounts/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /assets/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
  });

  it('marks the current route with aria-current="page"', () => {
    mockPathname.value = '/dashboard';
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: /net worth/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /chat/i })).not.toHaveAttribute('aria-current');
  });

  it('marks a nested route as active', () => {
    mockPathname.value = '/chat/session-abc';
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: /chat/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /net worth/i })).not.toHaveAttribute('aria-current');
  });

  it('does not mark unrelated routes as active', () => {
    mockPathname.value = '/settings';
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: /net worth/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /chat/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders the user display name', () => {
    mockPathname.value = '/dashboard';
    render(<Sidebar />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});
