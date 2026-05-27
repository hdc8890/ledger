import { z } from 'zod';
import { insertPendingChange } from '@/db/queries/pending-changes';
import type { ToolContext } from './context';

export const goalKindSchema = z.enum([
  'save_for',
  'accelerate_debt',
  'reduce_category_spend',
  'increase_savings_rate',
]);

export const inputSchema = z.object({
  /** Human-readable goal name, e.g. "Save for new car". */
  name: z.string().min(1).max(200),
  /** Goal category. */
  kind: goalKindSchema,
  /** Target amount in dollars (positive). Omit for rate-based goals. */
  targetAmountDollars: z.number().positive().optional(),
  /** Target completion date (ISO 8601, e.g. "2026-12-31"). Omit for open-ended goals. */
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /**
   * Allocation priority for multi-goal arbitration.
   * Higher number = first claim on discretionary dollars. Default 0.
   */
  priority: z.number().int().min(0).max(100).default(0),
  /**
   * Optional constraints on how the plan is derived.
   * exclude_categories: categories the planner must not reduce
   * max_monthly_reduction_dollars: cap on monthly discretionary cuts
   */
  constraints: z
    .object({
      exclude_categories: z.array(z.string()).optional(),
      max_monthly_reduction_dollars: z.number().positive().optional(),
    })
    .optional(),
});

export const outputSchema = z.object({
  proposalId: z.string(),
  description: z.string(),
  goal: z.object({
    name: z.string(),
    kind: goalKindSchema,
    targetAmountDollars: z.number().optional(),
    targetDate: z.string().optional(),
    priority: z.number(),
  }),
});

export type CreateGoalOutput = z.infer<typeof outputSchema>;

/**
 * Serialized shape stored in pending_changes.payload for kind='goal_create'.
 *
 * targetAmountCents is serialized as a decimal string (bigint-safe JSONB).
 * The approval action must reconstruct it with BigInt(payload.targetAmountCents).
 */
export type GoalCreatePayload = {
  readonly name: string;
  readonly kind: z.infer<typeof goalKindSchema>;
  /** Positive bigint cents serialized as a decimal string. */
  readonly targetAmountCents?: string;
  readonly targetDate?: string;
  readonly priority: number;
  readonly constraints: Record<string, unknown>;
};

/**
 * Propose a new financial goal. Never writes directly — returns a
 * pending_changes proposal for the user to approve.
 */
export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<CreateGoalOutput> {
  const targetAmountCents =
    input.targetAmountDollars !== undefined
      ? BigInt(Math.round(input.targetAmountDollars * 100))
      : undefined;

  const constraints: Record<string, unknown> = {};
  if (input.constraints?.exclude_categories?.length) {
    constraints['exclude_categories'] = input.constraints.exclude_categories;
  }
  if (input.constraints?.max_monthly_reduction_dollars !== undefined) {
    // Store as cents string for bigint safety
    constraints['max_monthly_reduction_cents'] = String(
      BigInt(Math.round(input.constraints.max_monthly_reduction_dollars * 100)),
    );
  }

  const payload: GoalCreatePayload = {
    name: input.name,
    kind: input.kind,
    ...(targetAmountCents !== undefined && {
      targetAmountCents: targetAmountCents.toString(),
    }),
    ...(input.targetDate !== undefined && { targetDate: input.targetDate }),
    priority: input.priority,
    constraints,
  };

  const proposal = await insertPendingChange({
    userId: ctx.userId,
    kind: 'goal_create',
    payload,
    status: 'pending',
  });

  const descParts: string[] = [`Goal: "${input.name}" (${input.kind})`];
  if (input.targetAmountDollars !== undefined) {
    descParts.push(`target $${input.targetAmountDollars.toLocaleString()}`);
  }
  if (input.targetDate !== undefined) {
    descParts.push(`by ${input.targetDate}`);
  }

  return {
    proposalId: proposal.id,
    description: `Proposed new goal — ${descParts.join(', ')}`,
    goal: {
      name: input.name,
      kind: input.kind,
      ...(input.targetAmountDollars !== undefined && {
        targetAmountDollars: input.targetAmountDollars,
      }),
      ...(input.targetDate !== undefined && { targetDate: input.targetDate }),
      priority: input.priority,
    },
  };
}
