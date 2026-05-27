'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { findUserByClerkId } from '@/db/queries/users';
import { getTransactionById, updateTransactionCategory, retagSameMerchantTransactions } from '@/db/queries/transactions';
import { insertCategorizationRule } from '@/db/queries/categorization-rules';
import { insertAuditEvent } from '@/db/queries/audit-events';
import { saveMemory } from '@/ai/memory';
import { CATEGORY_TAXONOMY } from '@/lib/enrich/categorize';
import type { TransactionId, UserId } from '@/shared/types';

export type CorrectCategoryResult = { error?: string };

/**
 * Correct the category of a transaction.
 *
 * On success:
 * 1. Updates this transaction's category to categorySource='user', confidence=1.0.
 * 2. Creates a categorization_rules row for the merchant so future transactions
 *    from the same merchant get this category automatically.
 * 3. Re-tags all other ai/rule-sourced transactions from the same merchant.
 * 4. Writes an audit_events row.
 *
 * Manual overrides always win — user-sourced categories are never overwritten
 * by subsequent enrichment runs.
 */
export async function correctCategoryAction(
  transactionId: string,
  newCategory: string,
): Promise<CorrectCategoryResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { error: 'Unauthorized' };

  const user = await findUserByClerkId(clerkId);
  if (!user) return { error: 'User not found' };

  if (!(CATEGORY_TAXONOMY as readonly string[]).includes(newCategory)) {
    return { error: 'Invalid category' };
  }

  const txn = await getTransactionById(transactionId as TransactionId);
  if (!txn) return { error: 'Transaction not found' };
  if (txn.userId !== user.id) return { error: 'Forbidden' };

  const userId = user.id as UserId;
  const merchantKey = txn.merchantNormalized ?? txn.merchantRaw;

  try {
    await db.transaction(async () => {
      // 1. Update the selected transaction to user-sourced.
      await updateTransactionCategory(transactionId as TransactionId, newCategory, 'user');

      // 2. Create a rule so future transactions auto-match.
      await insertCategorizationRule({
        userId,
        predicate: { merchant_contains: merchantKey },
        setCategory: newCategory,
        priority: 10,
        active: true,
      });

      // 3. Re-tag other ai/rule-sourced transactions from the same merchant.
      await retagSameMerchantTransactions(userId, merchantKey, newCategory);

      // 4. Audit event.
      await insertAuditEvent({
        actor: clerkId,
        action: 'txn.category_correct',
        entityType: 'transaction',
        entityId: transactionId,
        before: { category: txn.category ?? null, categorySource: txn.categorySource ?? null },
        after: { category: newCategory, categorySource: 'user' },
        source: 'user',
        confidence: 1.0,
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to correct category';
    return { error: message };
  }

  // Best-effort: persist a household_rule memory so the agent can cite this preference.
  // Failure here must not surface to the user — the correction is already committed.
  try {
    await saveMemory(
      userId,
      'household_rule',
      `${merchantKey} transactions should be categorized as ${newCategory}`,
      { source_txn_id: transactionId },
    );
  } catch {
    // intentionally swallowed — memory is supplementary
  }

  revalidatePath('/transactions');
  revalidatePath('/cash-flow');
  revalidatePath('/dashboard');

  return {};
}
