import { z } from 'zod';
import { insertPendingChange } from '@/db/queries/pending-changes';
import type { ToolContext } from './context';

export const predicateSchema = z.object({
  /** Match transactions whose merchant name contains this string (case-insensitive). */
  merchantContains: z.string().optional(),
  /** Match transactions whose merchant name exactly equals this string. */
  merchantExact: z.string().optional(),
  /** Match transactions already assigned this category. */
  category: z.string().optional(),
});

export const inputSchema = z.object({
  predicate: predicateSchema,
  /** The category to assign when the predicate matches. */
  setCategory: z.string().min(1),
  /** Optional human-readable description of the rule. */
  description: z.string().optional(),
});

export const outputSchema = z.object({
  proposalId: z.string(),
  description: z.string(),
  predicate: predicateSchema,
  setCategory: z.string(),
});

export type CreateRuleDraftOutput = z.infer<typeof outputSchema>;

/** Serialized shape stored in pending_changes.payload for kind='rule_create'. */
export type RuleCreatePayload = {
  readonly predicate: z.infer<typeof predicateSchema>;
  readonly setCategory: string;
  readonly description?: string;
};

export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<CreateRuleDraftOutput> {
  const predicateFields = Object.values(input.predicate).filter((v) => v !== undefined);
  if (predicateFields.length === 0) {
    throw new Error('Rule predicate must have at least one condition');
  }

  const payload = {
    predicate: input.predicate,
    setCategory: input.setCategory,
    ...(input.description !== undefined && { description: input.description }),
  } satisfies RuleCreatePayload;

  const proposal = await insertPendingChange({
    userId: ctx.userId,
    kind: 'rule_create',
    payload,
    status: 'pending',
  });

  const predicateSummary = [
    input.predicate.merchantContains !== undefined
      ? `merchant contains "${input.predicate.merchantContains}"`
      : null,
    input.predicate.merchantExact !== undefined
      ? `merchant is "${input.predicate.merchantExact}"`
      : null,
    input.predicate.category !== undefined
      ? `current category is "${input.predicate.category}"`
      : null,
  ]
    .filter(Boolean)
    .join(' AND ');

  return {
    proposalId: proposal.id,
    description: input.description ?? `Rule: when ${predicateSummary} → set category "${input.setCategory}"`,
    predicate: input.predicate,
    setCategory: input.setCategory,
  };
}
