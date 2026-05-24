import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProposalCard } from '../proposal-card';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { mockApprove, mockReject } = vi.hoisted(() => ({
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
}));

vi.mock('@/app/actions/pending-changes', () => ({
  approveChangeAction: mockApprove,
  rejectChangeAction: mockReject,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockApprove.mockResolvedValue({});
  mockReject.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const assetResult = {
  proposalId: 'proposal-1',
  description: 'Proposed update to "Tesla Model 3": value from $45000.00 to $48000.00',
  assetId: 'asset-1',
  assetName: 'Tesla Model 3',
  changes: {
    valueDollars: { from: 45000, to: 48000 },
  },
};

const txnResult = {
  proposalId: 'proposal-2',
  description: 'Proposed category "Groceries" for "Costco"',
  transactionId: 'txn-1',
  merchantRaw: 'COSTCO WHSE #0123',
  currentCategory: 'Shopping',
  proposedCategory: 'Groceries',
};

const ruleResult = {
  proposalId: 'proposal-3',
  description: 'Rule: when merchant contains "Costco" → set category "Groceries"',
  predicate: { merchantContains: 'Costco' },
  setCategory: 'Groceries',
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
describe('ProposalCard — rendering', () => {
  it('renders asset_update diff with asset name and value change', () => {
    render(<ProposalCard toolName="update_asset" result={assetResult} />);

    expect(screen.getByRole('region', { name: /proposal card/i })).toBeInTheDocument();
    expect(screen.getByText('Tesla Model 3')).toBeInTheDocument();
    expect(screen.getByText('$45000.00')).toBeInTheDocument();
    expect(screen.getByText('$48000.00')).toBeInTheDocument();
    expect(screen.getByText('Asset update')).toBeInTheDocument();
  });

  it('renders txn_tag diff with merchant and category change', () => {
    render(<ProposalCard toolName="tag_transaction" result={txnResult} />);

    expect(screen.getByText('COSTCO WHSE #0123')).toBeInTheDocument();
    expect(screen.getByText('Shopping')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('Transaction tag')).toBeInTheDocument();
  });

  it('renders create_rule_draft diff with predicate and category', () => {
    render(<ProposalCard toolName="create_rule_draft" result={ruleResult} />);

    expect(screen.getByText(/merchant contains "Costco"/)).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('New rule')).toBeInTheDocument();
  });

  it('renders Approve and Reject buttons in pending state', () => {
    render(<ProposalCard toolName="update_asset" result={assetResult} />);

    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------
describe('ProposalCard — interactions', () => {
  it('calls approveChangeAction with the correct proposalId on approve', async () => {
    render(<ProposalCard toolName="update_asset" result={assetResult} />);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(mockApprove).toHaveBeenCalledWith('proposal-1');
    });
  });

  it('shows "Change applied" and hides buttons after successful approval', async () => {
    render(<ProposalCard toolName="update_asset" result={assetResult} />);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(screen.getByText(/change applied/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('calls rejectChangeAction with the correct proposalId on reject', async () => {
    render(<ProposalCard toolName="update_asset" result={assetResult} />);

    fireEvent.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() => {
      expect(mockReject).toHaveBeenCalledWith('proposal-1');
    });
  });

  it('shows "Change rejected" and hides buttons after rejection', async () => {
    render(<ProposalCard toolName="tag_transaction" result={txnResult} />);

    fireEvent.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() => {
      expect(screen.getByText(/change rejected/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('shows error state when approveChangeAction returns an error', async () => {
    mockApprove.mockResolvedValue({ error: 'Something went wrong' });
    render(<ProposalCard toolName="update_asset" result={assetResult} />);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });
});
