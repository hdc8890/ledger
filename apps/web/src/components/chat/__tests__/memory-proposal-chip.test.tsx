import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryProposalChip } from '../memory-proposal-chip';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { mockAccept, mockDismiss } = vi.hoisted(() => ({
  mockAccept: vi.fn(),
  mockDismiss: vi.fn(),
}));

vi.mock('@/app/actions/memory-proposals', () => ({
  acceptProposalAction: mockAccept,
  dismissProposalAction: mockDismiss,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const proposal = {
  id: 'proposal-uuid',
  userId: 'user-uuid',
  proposedText: 'User prefers Costco to be categorized as Groceries',
  proposedKind: 'household_rule',
  sourceSessionId: null,
  status: 'pending' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAccept.mockResolvedValue({});
  mockDismiss.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
describe('MemoryProposalChip — rendering', () => {
  it('renders the proposal text', () => {
    render(<MemoryProposalChip proposal={proposal} onResolved={vi.fn()} />);
    expect(
      screen.getByText('User prefers Costco to be categorized as Groceries'),
    ).toBeInTheDocument();
  });

  it('renders "Remember this?" label', () => {
    render(<MemoryProposalChip proposal={proposal} onResolved={vi.fn()} />);
    expect(screen.getByText(/remember this/i)).toBeInTheDocument();
  });

  it('renders Save and Dismiss buttons in pending state', () => {
    render(<MemoryProposalChip proposal={proposal} onResolved={vi.fn()} />);
    expect(screen.getByRole('button', { name: /accept memory/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss memory/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Accept flow
// ---------------------------------------------------------------------------
describe('MemoryProposalChip — accept', () => {
  it('calls acceptProposalAction with the proposal id', async () => {
    render(<MemoryProposalChip proposal={proposal} onResolved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /accept memory/i }));

    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith('proposal-uuid'));
  });

  it('shows "✓ Saved" after successful accept', async () => {
    render(<MemoryProposalChip proposal={proposal} onResolved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /accept memory/i }));

    await waitFor(() => expect(screen.getByText(/✓ Saved/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /accept memory/i })).not.toBeInTheDocument();
  });

  it('calls onResolved after the accept delay', async () => {
    const onResolved = vi.fn();
    render(<MemoryProposalChip proposal={proposal} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole('button', { name: /accept memory/i }));

    // The component schedules onResolved with a 1200 ms delay; allow up to 2500 ms.
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('proposal-uuid'), {
      timeout: 2500,
    });
  });

  it('shows error state when acceptProposalAction returns an error', async () => {
    mockAccept.mockResolvedValue({ error: 'Something went wrong' });
    render(<MemoryProposalChip proposal={proposal} onResolved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /accept memory/i }));

    await waitFor(() => expect(screen.getByText(/error/i)).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Dismiss flow
// ---------------------------------------------------------------------------
describe('MemoryProposalChip — dismiss', () => {
  it('calls dismissProposalAction with the proposal id', async () => {
    render(<MemoryProposalChip proposal={proposal} onResolved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss memory/i }));

    await waitFor(() => expect(mockDismiss).toHaveBeenCalledWith('proposal-uuid'));
  });

  it('shows "✗ Dismissed" after successful dismiss', async () => {
    render(<MemoryProposalChip proposal={proposal} onResolved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss memory/i }));

    await waitFor(() => expect(screen.getByText(/✗ Dismissed/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /dismiss memory/i })).not.toBeInTheDocument();
  });

  it('calls onResolved after the dismiss delay', async () => {
    const onResolved = vi.fn();
    render(<MemoryProposalChip proposal={proposal} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss memory/i }));

    // The component schedules onResolved with a 600 ms delay; allow up to 1500 ms.
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('proposal-uuid'), {
      timeout: 1500,
    });
  });

  it('shows error state when dismissProposalAction returns an error', async () => {
    mockDismiss.mockResolvedValue({ error: 'Failed to dismiss' });
    render(<MemoryProposalChip proposal={proposal} onResolved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss memory/i }));

    await waitFor(() => expect(screen.getByText(/error/i)).toBeInTheDocument());
  });
});
