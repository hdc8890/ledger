import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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

import { AssetKindCard } from '../../assets/asset-kind-card';
import type { AssetRow } from '@/db/queries/assets';

const baseAsset: AssetRow = {
  id: 'asset-1',
  userId: 'user-1',
  kind: 'home',
  name: 'Primary Residence',
  valueCents: 45000000n,
  source: 'user',
  confidence: 1.0,
  manualOverride: true,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AssetKindCard', () => {
  it('renders the kind label and total value', () => {
    render(
      <AssetKindCard
        label="Home"
        totalCents={45000000n}
        delta30dCents={null}
        delta1yCents={null}
        assets={[baseAsset]}
      />,
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    // Both the summary total and the individual asset row show the same value.
    expect(screen.getAllByText('$450,000.00').length).toBeGreaterThanOrEqual(1);
  });

  it('renders 30d and 1y delta chips when provided', () => {
    render(
      <AssetKindCard
        label="Home"
        totalCents={45000000n}
        delta30dCents={100000n}
        delta1yCents={-500000n}
        assets={[baseAsset]}
      />,
    );
    expect(screen.getByText(/\+.*30d/)).toBeInTheDocument();
    expect(screen.getByText(/1y/)).toBeInTheDocument();
  });

  it('omits delta section when both deltas are null', () => {
    render(
      <AssetKindCard
        label="Home"
        totalCents={45000000n}
        delta30dCents={null}
        delta1yCents={null}
        assets={[baseAsset]}
      />,
    );
    expect(screen.queryByText(/30d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1y/)).not.toBeInTheDocument();
  });

  it('shows the Manual badge when manualOverride is true', () => {
    render(
      <AssetKindCard
        label="Home"
        totalCents={45000000n}
        delta30dCents={null}
        delta1yCents={null}
        assets={[baseAsset]}
      />,
    );
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('shows confidence chip when confidence < 0.8', () => {
    const lowConfidenceAsset: AssetRow = { ...baseAsset, confidence: 0.6, manualOverride: false };
    render(
      <AssetKindCard
        label="Brokerage"
        totalCents={lowConfidenceAsset.valueCents}
        delta30dCents={null}
        delta1yCents={null}
        assets={[lowConfidenceAsset]}
      />,
    );
    expect(screen.getByText(/60%\s*confidence/i)).toBeInTheDocument();
  });

  it('does not show Manual badge when manualOverride is false', () => {
    const nonManual: AssetRow = { ...baseAsset, manualOverride: false };
    render(
      <AssetKindCard
        label="Brokerage"
        totalCents={nonManual.valueCents}
        delta30dCents={null}
        delta1yCents={null}
        assets={[nonManual]}
      />,
    );
    expect(screen.queryByText('Manual')).not.toBeInTheDocument();
  });

  it('renders each individual asset name', () => {
    const second: AssetRow = { ...baseAsset, id: 'asset-2', name: 'Vacation Home' };
    render(
      <AssetKindCard
        label="Home"
        totalCents={90000000n}
        delta30dCents={null}
        delta1yCents={null}
        assets={[baseAsset, second]}
      />,
    );
    expect(screen.getByText('Primary Residence')).toBeInTheDocument();
    expect(screen.getByText('Vacation Home')).toBeInTheDocument();
  });
});
