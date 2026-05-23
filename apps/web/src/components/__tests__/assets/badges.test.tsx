import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfidenceChip } from '../../assets/confidence-chip';
import { ManualOverrideBadge } from '../../assets/manual-override-badge';

describe('ConfidenceChip', () => {
  it('renders nothing when confidence >= 0.8', () => {
    const { container } = render(<ConfidenceChip confidence={0.9} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when confidence is exactly 0.8', () => {
    const { container } = render(<ConfidenceChip confidence={0.8} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders amber chip with percentage when confidence < 0.8', () => {
    render(<ConfidenceChip confidence={0.6} />);
    expect(screen.getByText(/60%\s*confidence/i)).toBeInTheDocument();
  });

  it('rounds percentage to nearest integer', () => {
    render(<ConfidenceChip confidence={0.755} />);
    expect(screen.getByText(/76%\s*confidence/i)).toBeInTheDocument();
  });
});

describe('ManualOverrideBadge', () => {
  it('renders the "Manual" label', () => {
    render(<ManualOverrideBadge />);
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });
});
