import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DebtRatioChip } from '../debt-ratio-chip';

describe('DebtRatioChip', () => {
  it('renders nothing when assets are zero', () => {
    const { container } = render(
      <DebtRatioChip assetsCents={0n} liabilitiesCents={100000n} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows green chip for low debt ratio (< 30%)', () => {
    render(<DebtRatioChip assetsCents={100000n} liabilitiesCents={10000n} />);
    const chip = screen.getByText(/10\.0%\s*debt-to-asset/i);
    expect(chip).toBeInTheDocument();
    expect(chip.className).toMatch(/emerald/);
  });

  it('shows amber chip for moderate debt ratio (30–60%)', () => {
    render(<DebtRatioChip assetsCents={100000n} liabilitiesCents={45000n} />);
    const chip = screen.getByText(/45\.0%\s*debt-to-asset/i);
    expect(chip.className).toMatch(/amber/);
  });

  it('shows red chip for high debt ratio (> 60%)', () => {
    render(<DebtRatioChip assetsCents={100000n} liabilitiesCents={70000n} />);
    const chip = screen.getByText(/70\.0%\s*debt-to-asset/i);
    expect(chip.className).toMatch(/red/);
  });

  it('renders the percentage label', () => {
    render(<DebtRatioChip assetsCents={200000n} liabilitiesCents={60000n} />);
    expect(screen.getByText(/30\.0%\s*debt-to-asset/i)).toBeInTheDocument();
  });
});
