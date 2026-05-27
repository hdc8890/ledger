'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { findUserByClerkId } from '@/db/queries/users';
import {
  getPendingChangeById,
  applyPendingChange,
  rejectPendingChange,
} from '@/db/queries/pending-changes';
import { getAssetById, updateAsset } from '@/db/queries/assets';
import { getTransactionById, updateTransactionCategory } from '@/db/queries/transactions';
import { insertCategorizationRule } from '@/db/queries/categorization-rules';
import { insertAuditEvent } from '@/db/queries/audit-events';
import { insertGoal } from '@/db/queries/goals';
import { upsertBudget } from '@/db/queries/budgets';
import { saveMemory } from '@/ai/memory';
import type { AssetUpdatePayload } from '@/ai/tools/update-asset';
import type { TxnTagPayload } from '@/ai/tools/tag-transaction';
import type { RuleCreatePayload } from '@/ai/tools/create-rule-draft';
import type { GoalCreatePayload } from '@/ai/tools/create-goal';
import type { PlanProposePayload } from '@/ai/tools/propose-plan';
import type { AssetId, GoalId, PendingChangeId, TransactionId, UserId } from '@/shared/types';

export type ActionResult = { error?: string };

// ---------------------------------------------------------------------------
// approveChangeAction
// ---------------------------------------------------------------------------

/**
 * Approve a pending AI write proposal. Validates ownership, applies the
 * change inside a DB transaction, writes an audit event, and marks the
 * proposal as applied. Revalidates the relevant route on success.
 *
 * Structural guarantee: this is the ONLY place pending proposals become
 * real writes. Write tools only produce proposals; they never write directly.
 */
export async function approveChangeAction(proposalId: string): Promise<ActionResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { error: 'Unauthorized' };

  const user = await findUserByClerkId(clerkId);
  if (!user) return { error: 'User not found' };

  const proposal = await getPendingChangeById(proposalId as PendingChangeId);
  if (!proposal) return { error: 'Proposal not found' };
  if (proposal.userId !== user.id) return { error: 'Forbidden' };
  if (proposal.status !== 'pending') return { error: 'Proposal already resolved' };

  const userId = user.id as UserId;
  const appliedAt = new Date();

  try {
    await db.transaction(async () => {
      if (proposal.kind === 'asset_update') {
        await applyAssetUpdate(proposal.payload, userId, clerkId);
      } else if (proposal.kind === 'txn_tag') {
        await applyTxnTag(proposal.payload, userId, clerkId);
      } else if (proposal.kind === 'rule_create') {
        await applyRuleCreate(proposal.payload, userId, clerkId);
      } else if (proposal.kind === 'goal_create') {
        await applyGoalCreate(proposal.payload, userId, clerkId);
      } else if (proposal.kind === 'plan_propose') {
        await applyPlanPropose(proposal.payload, userId, clerkId);
      } else {
        throw new Error(`Unknown proposal kind: ${proposal.kind}`);
      }

      await applyPendingChange(proposalId as PendingChangeId, appliedAt);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to apply change';
    return { error: message };
  }

  // Best-effort: persist an override_note memory for asset value updates so the
  // agent can cite this preference in future turns. Failure must not block the approval.
  if (proposal.kind === 'asset_update') {
    try {
      const assetPayload = proposal.payload as AssetUpdatePayload;
      if (assetPayload.valueCents !== undefined) {
        const asset = await getAssetById(assetPayload.assetId as AssetId);
        if (asset) {
          await saveMemory(
            userId,
            'override_note',
            `The ${asset.name} value has been manually set by the user`,
            { related_asset_id: asset.id },
          );
        }
      }
    } catch {
      // intentionally swallowed — memory is supplementary
    }
  }

  // Revalidate per kind so affected dashboards refresh.
  if (proposal.kind === 'asset_update') {
    revalidatePath('/dashboard/assets');
    revalidatePath('/dashboard');
  } else if (proposal.kind === 'txn_tag') {
    revalidatePath('/dashboard/cash-flow');
    revalidatePath('/dashboard');
  } else if (proposal.kind === 'goal_create') {
    revalidatePath('/goals');
  } else if (proposal.kind === 'plan_propose') {
    revalidatePath('/goals');
    revalidatePath('/budgets');
    revalidatePath('/dashboard');
  } else {
    revalidatePath('/dashboard');
  }

  return {};
}

// ---------------------------------------------------------------------------
// rejectChangeAction
// ---------------------------------------------------------------------------

/**
 * Reject a pending AI write proposal. Marks it rejected without touching
 * any live table. No audit event is written — rejection is passive.
 */
export async function rejectChangeAction(proposalId: string): Promise<ActionResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { error: 'Unauthorized' };

  const user = await findUserByClerkId(clerkId);
  if (!user) return { error: 'User not found' };

  const proposal = await getPendingChangeById(proposalId as PendingChangeId);
  if (!proposal) return { error: 'Proposal not found' };
  if (proposal.userId !== user.id) return { error: 'Forbidden' };
  if (proposal.status !== 'pending') return { error: 'Proposal already resolved' };

  await rejectPendingChange(proposalId as PendingChangeId);
  return {};
}

// ---------------------------------------------------------------------------
// Private helpers — one per proposal kind
// ---------------------------------------------------------------------------

async function applyAssetUpdate(
  rawPayload: unknown,
  userId: UserId,
  clerkId: string,
): Promise<void> {
  const payload = rawPayload as AssetUpdatePayload;

  const asset = await getAssetById(payload.assetId as AssetId);
  if (!asset) throw new Error('Asset not found');
  if (asset.userId !== userId) throw new Error('Forbidden');

  const valueChanging = payload.valueCents !== undefined;
  const patch: Parameters<typeof updateAsset>[1] = {
    ...(payload.name !== undefined && { name: payload.name }),
    ...(valueChanging && { valueCents: BigInt(payload.valueCents!) }),
    source: 'user',
    confidence: 1.0,
    ...(valueChanging && { manualOverride: true }),
  };

  await updateAsset(payload.assetId as AssetId, patch);

  await insertAuditEvent({
    actor: clerkId,
    action: 'asset.update',
    entityType: 'asset',
    entityId: payload.assetId,
    before: {
      valueCents: asset.valueCents.toString(),
      name: asset.name,
    },
    after: {
      ...(valueChanging && { valueCents: payload.valueCents }),
      ...(payload.name !== undefined && { name: payload.name }),
    },
    source: 'user',
    confidence: 1.0,
  });
}

async function applyTxnTag(rawPayload: unknown, userId: UserId, clerkId: string): Promise<void> {
  const payload = rawPayload as TxnTagPayload;

  const txn = await getTransactionById(payload.transactionId as TransactionId);
  if (!txn) throw new Error('Transaction not found');
  if (txn.userId !== userId) throw new Error('Forbidden');

  await updateTransactionCategory(payload.transactionId as TransactionId, payload.category, 'user');

  await insertAuditEvent({
    actor: clerkId,
    action: 'txn.tag',
    entityType: 'transaction',
    entityId: payload.transactionId,
    before: { category: txn.category ?? null, categorySource: txn.categorySource ?? null },
    after: { category: payload.category, categorySource: 'user' },
    source: 'user',
    confidence: 1.0,
  });
}

async function applyRuleCreate(
  rawPayload: unknown,
  userId: UserId,
  clerkId: string,
): Promise<void> {
  const payload = rawPayload as RuleCreatePayload;

  const rule = await insertCategorizationRule({
    userId,
    predicate: payload.predicate,
    setCategory: payload.setCategory,
    active: true,
  });

  await insertAuditEvent({
    actor: clerkId,
    action: 'rule.create',
    entityType: 'categorization_rule',
    entityId: rule.id,
    before: null,
    after: { predicate: payload.predicate, setCategory: payload.setCategory },
    source: 'user',
    confidence: 1.0,
  });
}

async function applyGoalCreate(
  rawPayload: unknown,
  userId: UserId,
  clerkId: string,
): Promise<void> {
  const payload = rawPayload as GoalCreatePayload;

  const goal = await insertGoal({
    userId,
    kind: payload.kind,
    name: payload.name,
    targetAmountCents:
      payload.targetAmountCents !== undefined
        ? BigInt(payload.targetAmountCents)
        : null,
    targetDate: payload.targetDate ?? null,
    priority: payload.priority,
    constraints: payload.constraints,
    status: 'active',
  });

  await insertAuditEvent({
    actor: clerkId,
    action: 'goal.create',
    entityType: 'goal',
    entityId: goal.id,
    before: null,
    after: {
      name: payload.name,
      kind: payload.kind,
      targetAmountCents: payload.targetAmountCents ?? null,
      targetDate: payload.targetDate ?? null,
      priority: payload.priority,
    },
    source: 'user',
    confidence: 1.0,
  });
}

async function applyPlanPropose(
  rawPayload: unknown,
  userId: UserId,
  clerkId: string,
): Promise<void> {
  const payload = rawPayload as PlanProposePayload;

  // Verify the goal exists and belongs to the user before creating budgets.
  const { getGoalById } = await import('@/db/queries/goals');
  const goal = await getGoalById(payload.goalId as GoalId);
  if (!goal) throw new Error('Goal not found');
  if (goal.userId !== userId) throw new Error('Forbidden');

  const now = new Date();
  let budgetCount = 0;

  // Create budget rows for each future month in the plan window.
  // Period 0 = next calendar month; period i = currentMonth + 1 + i.
  for (let i = 0; i < payload.planMonths; i++) {
    const periodDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + i, 1));
    const period = periodDate.toISOString().slice(0, 10);

    for (const delta of payload.categoryDeltas) {
      await upsertBudget({
        userId,
        goalId: goal.id,
        period,
        category: delta.category,
        capCents: BigInt(delta.capCents),
        manualOverride: false,
        createdBy: 'ai',
      });
      budgetCount++;
    }
  }

  await insertAuditEvent({
    actor: clerkId,
    action: 'plan.apply',
    entityType: 'goal',
    entityId: goal.id,
    before: null,
    after: {
      planMonths: payload.planMonths,
      categoryCount: payload.categoryDeltas.length,
      budgetCount,
      confidence: payload.confidence,
    },
    source: 'user',
    confidence: 1.0,
  });
}
