import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LiabilityRowCard } from '../liability-row';
import type { LiabilityRow } from '@/db/queries/liabilities';

const baseLiability: LiabilityRow = {
  id: 'liab-1',
  userId: 'user-1',
  accountId: null,
  kind: 'mortgage',
  name: 'Home Mortgage',
  balanceCents: 30000000n,
  apr: 0.065,
  termMonths: 360,
  originalPrincipalCents: 35000000n,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('LiabilityRowCard', () => {
  it('renders the liability name', () => {
    render(<LiabilityRowCard liability={baseLiability} />);
    expect(screen.getByText('Home Mortgage')).toBeInTheDocument();
  });

  it('renders the kind label', () => {
    render(<LiabilityRowCard liability={baseLiability} />);
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
  });

  it('renders the balance', () => {
    render(<LiabilityRowCard liability={baseLiability} />);
    expect(screen.getByText(/\$300,000\.00/)).toBeInTheDocument();
  });

  it('renders the APR when present', () => {
    render(<LiabilityRowCard liability={baseLiability} />);
    expect(screen.getByText('6.50% APR')).toBeInTheDocument();
  });

  it('does not render APR row when apr is null', () => {
    render(<LiabilityRowCard liability={{ ...baseLiability, apr: null }} />);
    expect(screen.queryByText(/apr/i)).not.toBeInTheDocument();
  });

  it('renders credit_card kind label', () => {
    render(<LiabilityRowCard liability={{ ...baseLiability, kind: 'credit_card' }} />);
    expect(screen.getByText('Credit Card')).toBeInTheDocument();
  });
});
