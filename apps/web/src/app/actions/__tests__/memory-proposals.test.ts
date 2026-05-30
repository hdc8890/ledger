import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetCurrentUserId,
  mockGetProposalById,
  mockUpdateProposalStatus,
  mockListPendingProposals,
  mockSaveMemory,
} = vi.hoisted(() => ({
  mockGetCurrentUserId: vi.fn(),
  mockGetProposalById: vi.fn(),
  mockUpdateProposalStatus: vi.fn(),
  mockListPendingProposals: vi.fn(),
  mockSaveMemory: vi.fn(),
}));

vi.mock('@/lib/auth-helpers', () => ({ getCurrentUserId: mockGetCurrentUserId }));
vi.mock('@/db/queries/memories', () => ({
  getProposalById: mockGetProposalById,
  updateProposalStatus: mockUpdateProposalStatus,
  listPendingProposals: mockListPendingProposals,
}));
vi.mock('@/ai/memory', () => ({ saveMemory: mockSaveMemory }));

import {
  acceptProposalAction,
  dismissProposalAction,
  getPendingProposalsAction,
} from '../memory-proposals';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const USER = { id: 'user-uuid' };
const PROPOSAL_ID = 'proposal-uuid';

const pendingProposal = {
  id: PROPOSAL_ID,
  userId: USER.id,
  proposedText: 'User prefers Groceries for Costco',
  proposedKind: 'household_rule',
  sourceSessionId: 'session-uuid',
  status: 'pending' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// acceptProposalAction
// ---------------------------------------------------------------------------
describe('acceptProposalAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue(USER.id);
    mockGetProposalById.mockResolvedValue(pendingProposal);
    mockSaveMemory.mockResolvedValue(undefined);
    mockUpdateProposalStatus.mockResolvedValue({ ...pendingProposal, status: 'accepted' });
  });

  it('returns error when unauthenticated', async () => {
    mockGetCurrentUserId.mockResolvedValue(null);
    const result = await acceptProposalAction(PROPOSAL_ID);
    expect(result).toEqual({ error: 'Unauthorized' });
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it('returns error when proposal does not exist', async () => {
    mockGetProposalById.mockResolvedValue(undefined);
    const result = await acceptProposalAction(PROPOSAL_ID);
    expect(result).toEqual({ error: 'Proposal not found' });
  });

  it('returns error when proposal belongs to a different user', async () => {
    mockGetProposalById.mockResolvedValue({ ...pendingProposal, userId: 'other-user' });
    const result = await acceptProposalAction(PROPOSAL_ID);
    expect(result).toEqual({ error: 'Forbidden' });
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it('returns error when proposal is already resolved', async () => {
    mockGetProposalById.mockResolvedValue({ ...pendingProposal, status: 'accepted' });
    const result = await acceptProposalAction(PROPOSAL_ID);
    expect(result).toEqual({ error: 'Proposal already resolved' });
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it('saves the memory and marks proposal accepted on success', async () => {
    const result = await acceptProposalAction(PROPOSAL_ID);

    expect(result).toEqual({});
    expect(mockSaveMemory).toHaveBeenCalledWith(
      USER.id,
      'household_rule',
      'User prefers Groceries for Costco',
      { source_session_id: 'session-uuid' },
      0.8,
    );
    expect(mockUpdateProposalStatus).toHaveBeenCalledWith(PROPOSAL_ID, USER.id, 'accepted');
  });

  it('returns error when saveMemory throws', async () => {
    mockSaveMemory.mockRejectedValue(new Error('embedding failed'));
    const result = await acceptProposalAction(PROPOSAL_ID);
    expect(result).toEqual({ error: 'embedding failed' });
    expect(mockUpdateProposalStatus).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dismissProposalAction
// ---------------------------------------------------------------------------
describe('dismissProposalAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue(USER.id);
    mockGetProposalById.mockResolvedValue(pendingProposal);
    mockUpdateProposalStatus.mockResolvedValue({ ...pendingProposal, status: 'rejected' });
  });

  it('returns error when unauthenticated', async () => {
    mockGetCurrentUserId.mockResolvedValue(null);
    const result = await dismissProposalAction(PROPOSAL_ID);
    expect(result).toEqual({ error: 'Unauthorized' });
  });

  it('returns error when proposal belongs to a different user', async () => {
    mockGetProposalById.mockResolvedValue({ ...pendingProposal, userId: 'other-user' });
    const result = await dismissProposalAction(PROPOSAL_ID);
    expect(result).toEqual({ error: 'Forbidden' });
    expect(mockUpdateProposalStatus).not.toHaveBeenCalled();
  });

  it('returns error when proposal is already resolved', async () => {
    mockGetProposalById.mockResolvedValue({ ...pendingProposal, status: 'rejected' });
    const result = await dismissProposalAction(PROPOSAL_ID);
    expect(result).toEqual({ error: 'Proposal already resolved' });
    expect(mockUpdateProposalStatus).not.toHaveBeenCalled();
  });

  it('marks proposal as rejected and returns empty on success', async () => {
    const result = await dismissProposalAction(PROPOSAL_ID);
    expect(result).toEqual({});
    expect(mockUpdateProposalStatus).toHaveBeenCalledWith(PROPOSAL_ID, USER.id, 'rejected');
  });
});

// ---------------------------------------------------------------------------
// getPendingProposalsAction
// ---------------------------------------------------------------------------
describe('getPendingProposalsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue(USER.id);
    mockListPendingProposals.mockResolvedValue([pendingProposal]);
  });

  it('returns error when unauthenticated', async () => {
    mockGetCurrentUserId.mockResolvedValue(null);
    const result = await getPendingProposalsAction();
    expect(result).toEqual({ error: 'Unauthorized' });
  });

  it('returns pending proposals for the authenticated user', async () => {
    const result = await getPendingProposalsAction();
    expect(result.proposals).toEqual([pendingProposal]);
    expect(mockListPendingProposals).toHaveBeenCalledWith(USER.id);
  });

  it('returns empty array when user has no pending proposals', async () => {
    mockListPendingProposals.mockResolvedValue([]);
    const result = await getPendingProposalsAction();
    expect(result.proposals).toEqual([]);
  });
});
