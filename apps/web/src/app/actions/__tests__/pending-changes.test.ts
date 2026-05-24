import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserId, PendingChangeId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Mocks (hoisted — must be before imports of the module under test)
// ---------------------------------------------------------------------------
const {
  mockAuth,
  mockFindUser,
  mockGetProposal,
  mockApplyProposal,
  mockRejectProposal,
  mockGetAsset,
  mockUpdateAsset,
  mockGetTxn,
  mockUpdateTxnCategory,
  mockInsertRule,
  mockInsertAudit,
  mockDbTransaction,
  mockRevalidate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindUser: vi.fn(),
  mockGetProposal: vi.fn(),
  mockApplyProposal: vi.fn(),
  mockRejectProposal: vi.fn(),
  mockGetAsset: vi.fn(),
  mockUpdateAsset: vi.fn(),
  mockGetTxn: vi.fn(),
  mockUpdateTxnCategory: vi.fn(),
  mockInsertRule: vi.fn(),
  mockInsertAudit: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockRevalidate: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: mockAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));
vi.mock('@/db/queries/users', () => ({ findUserByClerkId: mockFindUser }));
vi.mock('@/db/queries/pending-changes', () => ({
  getPendingChangeById: mockGetProposal,
  applyPendingChange: mockApplyProposal,
  rejectPendingChange: mockRejectProposal,
}));
vi.mock('@/db/queries/assets', () => ({
  getAssetById: mockGetAsset,
  updateAsset: mockUpdateAsset,
}));
vi.mock('@/db/queries/transactions', () => ({
  getTransactionById: mockGetTxn,
  updateTransactionCategory: mockUpdateTxnCategory,
}));
vi.mock('@/db/queries/categorization-rules', () => ({
  insertCategorizationRule: mockInsertRule,
}));
vi.mock('@/db/queries/audit-events', () => ({
  insertAuditEvent: mockInsertAudit,
}));
vi.mock('@/lib/db', () => ({
  db: {
    transaction: (fn: (tx: unknown) => Promise<void>) => mockDbTransaction(fn),
  },
}));

import { approveChangeAction, rejectChangeAction } from '../pending-changes';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CLERK_ID = 'clerk_test_user';
const USER = { id: 'user-uuid-001' as UserId, clerkId: CLERK_ID };
const PROPOSAL_ID = 'proposal-uuid-001' as PendingChangeId;

const BASE_PROPOSAL = {
  id: PROPOSAL_ID,
  userId: USER.id,
  kind: 'asset_update',
  payload: { assetId: 'asset-uuid-001', valueCents: '4800000' },
  status: 'pending' as const,
  appliedAt: null,
  createdAt: new Date(),
};

const ASSET = {
  id: 'asset-uuid-001',
  userId: USER.id,
  kind: 'vehicle' as const,
  name: 'Tesla Model 3',
  valueCents: 4500000n,
  source: 'user' as const,
  confidence: 1.0,
  manualOverride: false,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const TXN = {
  id: 'txn-uuid-001',
  userId: USER.id,
  accountId: 'acct-uuid-001',
  plaidTransactionId: 'plaid-1',
  postedAt: '2025-10-15',
  authorizedAt: null,
  amountCents: 7500n,
  currency: 'USD',
  merchantRaw: 'COSTCO WHSE #0123',
  merchantNormalized: 'Costco',
  category: 'Shopping',
  categorySource: 'plaid' as const,
  categoryConfidence: 0.7,
  pending: false,
  source: 'plaid' as const,
  confidence: 1.0,
  isTransfer: false,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Make db.transaction call through to the callback synchronously.
function passthrough(fn: (tx: unknown) => Promise<void>) {
  return fn({});
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbTransaction.mockImplementation(passthrough);
  mockApplyProposal.mockResolvedValue(undefined);
  mockRejectProposal.mockResolvedValue(undefined);
  mockInsertAudit.mockResolvedValue({ id: 'audit-1' });
});

// ---------------------------------------------------------------------------
// approveChangeAction — auth/ownership guards
// ---------------------------------------------------------------------------
describe('approveChangeAction — guards', () => {
  it('returns error when unauthenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null });
    expect(await approveChangeAction(PROPOSAL_ID)).toEqual({ error: 'Unauthorized' });
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it('returns error when user not in DB', async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(undefined);
    expect(await approveChangeAction(PROPOSAL_ID)).toEqual({ error: 'User not found' });
  });

  it('returns error when proposal not found', async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(USER);
    mockGetProposal.mockResolvedValue(undefined);
    expect(await approveChangeAction(PROPOSAL_ID)).toEqual({ error: 'Proposal not found' });
  });

  it('returns Forbidden when proposal belongs to another user', async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(USER);
    mockGetProposal.mockResolvedValue({ ...BASE_PROPOSAL, userId: 'other-user' });
    expect(await approveChangeAction(PROPOSAL_ID)).toEqual({ error: 'Forbidden' });
  });

  it('returns error when proposal is already applied', async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(USER);
    mockGetProposal.mockResolvedValue({ ...BASE_PROPOSAL, status: 'applied' });
    expect(await approveChangeAction(PROPOSAL_ID)).toEqual({ error: 'Proposal already resolved' });
  });

  it('returns error when proposal is already rejected', async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(USER);
    mockGetProposal.mockResolvedValue({ ...BASE_PROPOSAL, status: 'rejected' });
    expect(await approveChangeAction(PROPOSAL_ID)).toEqual({ error: 'Proposal already resolved' });
  });
});

// ---------------------------------------------------------------------------
// approveChangeAction — asset_update
// ---------------------------------------------------------------------------
describe('approveChangeAction — asset_update', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(USER);
    mockGetProposal.mockResolvedValue(BASE_PROPOSAL);
    mockGetAsset.mockResolvedValue(ASSET);
    mockUpdateAsset.mockResolvedValue({ ...ASSET, valueCents: 4800000n });
  });

  it('updates asset, writes audit event, marks proposal applied', async () => {
    const result = await approveChangeAction(PROPOSAL_ID);

    expect(result).toEqual({});
    expect(mockUpdateAsset).toHaveBeenCalledWith(
      'asset-uuid-001',
      expect.objectContaining({
        valueCents: 4800000n,
        source: 'user',
        manualOverride: true,
        confidence: 1.0,
      }),
    );
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'asset.update', source: 'user', actor: CLERK_ID }),
    );
    expect(mockApplyProposal).toHaveBeenCalledWith(PROPOSAL_ID, expect.any(Date));
    expect(mockRevalidate).toHaveBeenCalledWith('/dashboard/assets');
  });

  it('returns error if asset not found', async () => {
    mockGetAsset.mockResolvedValue(undefined);
    expect(await approveChangeAction(PROPOSAL_ID)).toEqual({ error: 'Asset not found' });
    expect(mockUpdateAsset).not.toHaveBeenCalled();
  });

  it('returns error if asset belongs to another user', async () => {
    mockGetAsset.mockResolvedValue({ ...ASSET, userId: 'other-user' });
    expect(await approveChangeAction(PROPOSAL_ID)).toEqual({ error: 'Forbidden' });
    expect(mockUpdateAsset).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// approveChangeAction — txn_tag
// ---------------------------------------------------------------------------
describe('approveChangeAction — txn_tag', () => {
  const txnProposal = {
    ...BASE_PROPOSAL,
    kind: 'txn_tag',
    payload: { transactionId: 'txn-uuid-001', category: 'Groceries' },
  };

  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(USER);
    mockGetProposal.mockResolvedValue(txnProposal);
    mockGetTxn.mockResolvedValue(TXN);
    mockUpdateTxnCategory.mockResolvedValue({ ...TXN, category: 'Groceries' });
  });

  it('updates transaction category, writes audit event, marks applied', async () => {
    const result = await approveChangeAction(PROPOSAL_ID);

    expect(result).toEqual({});
    expect(mockUpdateTxnCategory).toHaveBeenCalledWith('txn-uuid-001', 'Groceries', 'user');
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'txn.tag', source: 'user' }),
    );
    expect(mockApplyProposal).toHaveBeenCalled();
    expect(mockRevalidate).toHaveBeenCalledWith('/dashboard/cash-flow');
  });

  it('returns error if transaction not found', async () => {
    mockGetTxn.mockResolvedValue(undefined);
    expect(await approveChangeAction(PROPOSAL_ID)).toEqual({ error: 'Transaction not found' });
  });
});

// ---------------------------------------------------------------------------
// approveChangeAction — rule_create
// ---------------------------------------------------------------------------
describe('approveChangeAction — rule_create', () => {
  const ruleProposal = {
    ...BASE_PROPOSAL,
    kind: 'rule_create',
    payload: {
      predicate: { merchantContains: 'Costco' },
      setCategory: 'Groceries',
    },
  };

  const insertedRule = {
    id: 'rule-uuid-001',
    userId: USER.id,
    predicate: { merchantContains: 'Costco' },
    setCategory: 'Groceries',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(USER);
    mockGetProposal.mockResolvedValue(ruleProposal);
    mockInsertRule.mockResolvedValue(insertedRule);
  });

  it('inserts rule, writes audit event, marks applied', async () => {
    const result = await approveChangeAction(PROPOSAL_ID);

    expect(result).toEqual({});
    expect(mockInsertRule).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        predicate: { merchantContains: 'Costco' },
        setCategory: 'Groceries',
        active: true,
      }),
    );
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rule.create', entityType: 'categorization_rule' }),
    );
    expect(mockApplyProposal).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// approveChangeAction — unknown kind
// ---------------------------------------------------------------------------
describe('approveChangeAction — unknown kind', () => {
  it('returns error for unknown proposal kind', async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(USER);
    mockGetProposal.mockResolvedValue({ ...BASE_PROPOSAL, kind: 'unknown_kind' });
    const result = await approveChangeAction(PROPOSAL_ID);
    expect(result.error).toMatch(/Unknown proposal kind/);
  });
});

// ---------------------------------------------------------------------------
// rejectChangeAction
// ---------------------------------------------------------------------------
describe('rejectChangeAction', () => {
  it('returns error when unauthenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null });
    expect(await rejectChangeAction(PROPOSAL_ID)).toEqual({ error: 'Unauthorized' });
  });

  it('returns Forbidden when proposal belongs to another user', async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(USER);
    mockGetProposal.mockResolvedValue({ ...BASE_PROPOSAL, userId: 'other-user' });
    expect(await rejectChangeAction(PROPOSAL_ID)).toEqual({ error: 'Forbidden' });
    expect(mockRejectProposal).not.toHaveBeenCalled();
  });

  it('marks the proposal rejected and does not touch live tables', async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(USER);
    mockGetProposal.mockResolvedValue(BASE_PROPOSAL);

    const result = await rejectChangeAction(PROPOSAL_ID);

    expect(result).toEqual({});
    expect(mockRejectProposal).toHaveBeenCalledWith(PROPOSAL_ID);
    expect(mockUpdateAsset).not.toHaveBeenCalled();
    expect(mockUpdateTxnCategory).not.toHaveBeenCalled();
    expect(mockInsertRule).not.toHaveBeenCalled();
    expect(mockInsertAudit).not.toHaveBeenCalled();
  });

  it('returns error when proposal is already resolved', async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockFindUser.mockResolvedValue(USER);
    mockGetProposal.mockResolvedValue({ ...BASE_PROPOSAL, status: 'rejected' });
    expect(await rejectChangeAction(PROPOSAL_ID)).toEqual({ error: 'Proposal already resolved' });
  });
});
