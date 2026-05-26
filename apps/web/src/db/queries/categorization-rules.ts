import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { categorizationRules } from '@/db/schema';
import type { CategorizationRuleId, UserId } from '@/shared/types';

export type CategorizationRuleRow = typeof categorizationRules.$inferSelect;
export type NewCategorizationRule = typeof categorizationRules.$inferInsert;

/**
 * Insert a new categorization rule. Called when a 'rule_create' pending
 * change is approved (Phase 3 Task 4). Rules are applied to transactions
 * during Phase 4 enrichment.
 */
export async function insertCategorizationRule(
  input: NewCategorizationRule,
): Promise<CategorizationRuleRow> {
  const rows = await db.insert(categorizationRules).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('insertCategorizationRule: no row returned');
  return row;
}

/**
 * Fetch all active categorization rules for a user.
 */
export async function getCategorizationRulesByUserId(
  userId: UserId,
): Promise<CategorizationRuleRow[]> {
  return db
    .select()
    .from(categorizationRules)
    .where(eq(categorizationRules.userId, userId));
}

/**
 * Fetch all active categorization rules for a user, sorted by priority descending.
 * Used by the enrichment pipeline — returns only active rules so disabled rules
 * are not applied.
 */
export async function getActiveCategorizationRulesByUserId(
  userId: UserId,
): Promise<CategorizationRuleRow[]> {
  return db
    .select()
    .from(categorizationRules)
    .where(and(eq(categorizationRules.userId, userId), eq(categorizationRules.active, true)))
    .orderBy(desc(categorizationRules.priority));
}

/**
 * Fetch a single categorization rule by ID. Returns undefined if not found.
 */
export async function getCategorizationRuleById(
  id: CategorizationRuleId,
): Promise<CategorizationRuleRow | undefined> {
  const rows = await db
    .select()
    .from(categorizationRules)
    .where(eq(categorizationRules.id, id))
    .limit(1);
  return rows[0];
}
