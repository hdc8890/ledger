import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// LiabilityRowCard renders liability details — stub out the card UI.
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { LiabilityList } from '../liability-list';
import type { LiabilityRow } from '@/db/queries/liabilities';

const makeLiability = (id: string, name: string): LiabilityRow => ({
  id,
  userId: 'user-1',
  accountId: null,
  kind: 'mortgage',
  name,
  balanceCents: 20000000n,
  apr: 0.065,
  termMonths: 360,
  originalPrincipalCents: 30000000n,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('LiabilityList', () => {
  it('renders nothing when the list is empty', () => {
    const { container } = render(<LiabilityList liabilities={[]} />);
    // The wrapping div is present but has no children.
    expect(container.querySelector('.space-y-3')?.children.length).toBe(0);
  });

  it('renders a row for each liability', () => {
    const liabilities = [
      makeLiability('l1', 'Primary Mortgage'),
      makeLiability('l2', 'Car Loan'),
    ];
    render(<LiabilityList liabilities={liabilities} />);
    expect(screen.getByText('Primary Mortgage')).toBeInTheDocument();
    expect(screen.getByText('Car Loan')).toBeInTheDocument();
  });

  it('renders a single liability', () => {
    render(<LiabilityList liabilities={[makeLiability('l1', 'Student Loan')]} />);
    expect(screen.getByText('Student Loan')).toBeInTheDocument();
  });
});
