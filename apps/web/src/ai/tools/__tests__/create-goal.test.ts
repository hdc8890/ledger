import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/pending-changes', () => ({
  insertPendingChange: vi.fn(),
}));

import { insertPendingChange } from '@/db/queries/pending-changes';
import { handler, inputSchema } from '../create-goal';

const ctx = { userId: brand<UserId>('user-1') };

const sampleProposal = {
  id: 'proposal-42',
  userId: 'user-1',
  kind: 'goal_create',
  payload: {},
  status: 'pending' as const,
  appliedAt: null,
  createdAt: new Date(),
};

describe('create-goal handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a pending_changes proposal for a save_for goal with target amount and date', async () => {
    vi.mocked(insertPendingChange).mockResolvedValueOnce(sampleProposal);

    const result = await handler(
      {
        name: 'Save for new car',
        kind: 'save_for',
        targetAmountDollars: 30000,
        targetDate: '2026-12-31',
        priority: 5,
      },
      ctx,
    );

    expect(insertPendingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        kind: 'goal_create',
        status: 'pending',
        payload: expect.objectContaining({
          name: 'Save for new car',
          kind: 'save_for',
          targetAmountCents: '3000000',
          targetDate: '2026-12-31',
          priority: 5,
        }),
      }),
    );

    expect(result.proposalId).toBe('proposal-42');
    expect(result.goal.name).toBe('Save for new car');
    expect(result.goal.kind).toBe('save_for');
    expect(result.goal.targetAmountDollars).toBe(30000);
    expect(result.goal.targetDate).toBe('2026-12-31');
    expect(result.description).toContain('Save for new car');
  });

  it('creates a proposal without optional fields (increase_savings_rate goal)', async () => {
    vi.mocked(insertPendingChange).mockResolvedValueOnce({
      ...sampleProposal,
      id: 'proposal-99',
    });

    const result = await handler(
      {
        name: 'Boost savings rate',
        kind: 'increase_savings_rate',
        priority: 0,
      },
      ctx,
    );

    const callArg = vi.mocked(insertPendingChange).mock.calls[0]?.[0];
    const payload = callArg?.payload as Record<string, unknown>;
    expect(payload?.['targetAmountCents']).toBeUndefined();
    expect(payload?.['targetDate']).toBeUndefined();
    expect(result.goal.targetAmountDollars).toBeUndefined();
    expect(result.proposalId).toBe('proposal-99');
  });

  it('stores constraints when provided', async () => {
    vi.mocked(insertPendingChange).mockResolvedValueOnce(sampleProposal);

    await handler(
      {
        name: 'Cut dining spend',
        kind: 'reduce_category_spend',
        priority: 2,
        constraints: {
          exclude_categories: ['Groceries'],
          max_monthly_reduction_dollars: 500,
        },
      },
      ctx,
    );

    const callArg = vi.mocked(insertPendingChange).mock.calls[0]?.[0];
    const payload = callArg?.payload as Record<string, unknown>;
    const constraints = payload?.['constraints'] as Record<string, unknown>;
    expect(constraints?.['exclude_categories']).toEqual(['Groceries']);
    expect(constraints?.['max_monthly_reduction_cents']).toBe('50000');
  });

  it('rejects invalid kind via inputSchema', () => {
    const parsed = inputSchema.safeParse({
      name: 'Bad goal',
      kind: 'unknown_kind',
      priority: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects empty name', () => {
    const parsed = inputSchema.safeParse({ name: '', kind: 'save_for', priority: 0 });
    expect(parsed.success).toBe(false);
  });

  it('rejects negative targetAmountDollars', () => {
    const parsed = inputSchema.safeParse({
      name: 'Test',
      kind: 'save_for',
      targetAmountDollars: -100,
      priority: 0,
    });
    expect(parsed.success).toBe(false);
  });
});
