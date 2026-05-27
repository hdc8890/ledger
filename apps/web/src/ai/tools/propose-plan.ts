import { z } from 'zod';
import { insertPendingChange } from '@/db/queries/pending-changes';
import { getGoalById } from '@/db/queries/goals';
import { getPlannerContext } from '@/db/queries/planning';
import { centsToNumber } from '@/shared/money';
import { goalKindSchema } from './create-goal';
import type { ToolContext } from './context';
import type { GoalId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const inputSchema = z.object({
  /** UUID of the goal to plan for. Must be active and owned by the calling user. */
  goalId: z.string().uuid('goalId must be a valid UUID'),
  /**
   * Number of future calendar months to create budget caps for on approval.
   * Defaults to 6. The first budget period is always the next calendar month.
   */
  planMonths: z.number().int().min(1).max(24).default(6),
});

export const categoryDeltaSchema = z.object({
  category: z.string(),
  /** Current 3-month average monthly spend (dollars, for display). */
  currentAvgDollars: z.number(),
  /** Proposed monthly spending cap (dollars). Always > 0. */
  proposedCapDollars: z.number(),
  /** Reduction amount (dollars). proposedCapDollars = currentAvgDollars − reductionDollars. */
  reductionDollars: z.number(),
});

export const outputSchema = z.object({
  proposalId: z.string(),
  description: z.string(),
  plan: z.object({
    goalName: z.string(),
    goalKind: goalKindSchema,
    /** Current average monthly savings before this plan (dollars). */
    currentMonthlySavingsDollars: z.number(),
    /** Additional monthly savings this plan generates (dollars). */
    neededExtraMonthlySavingsDollars: z.number(),
    /** Per-category reduction targets. */
    categoryDeltas: z.array(categoryDeltaSchema),
    /** Months until goal is projected to be achieved (only for save_for goals). */
    projectedTimelineMonths: z.number().optional(),
    /** Confidence in the plan based on historical data availability. */
    confidence: z.enum(['low', 'medium', 'high']),
    /** Explicit list of assumptions made during planning. */
    assumptions: z.array(z.string()),
  }),
});

export type ProposePlanOutput = z.infer<typeof outputSchema>;
export type CategoryDelta = z.infer<typeof categoryDeltaSchema>;

// ---------------------------------------------------------------------------
// Payload type — stored in pending_changes.payload
// ---------------------------------------------------------------------------

/**
 * Payload stored in pending_changes for kind='plan_propose'.
 * capCents stored as decimal strings for bigint-safe JSONB round-trip.
 */
export type PlanProposePayload = {
  readonly goalId: string;
  /** Number of future months to create budget rows for on approval. */
  readonly planMonths: number;
  /** Category caps to create. capCents is a decimal string. */
  readonly categoryDeltas: ReadonlyArray<{
    readonly category: string;
    readonly capCents: string;
  }>;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly assumptions: readonly string[];
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Propose a spending plan to advance a financial goal.
 *
 * Reads 3-month historical averages, computes category-level reduction
 * targets, and stores a pending_changes proposal for user approval.
 * On approval, the plan creates budgets rows for the next `planMonths` months.
 *
 * This tool is read-only — it never writes to live tables directly.
 */
export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<ProposePlanOutput> {
  // 1. Fetch and validate the goal
  const goal = await getGoalById(input.goalId as GoalId);
  if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
  if (goal.userId !== ctx.userId) throw new Error('Forbidden: goal does not belong to this user');
  if (goal.status !== 'active') throw new Error(`Goal is ${goal.status} — only active goals can be planned`);

  // 2. Build planner context (3-month historical averages)
  const plannerCtx = await getPlannerContext(ctx.userId, 3);

  const {
    avgIncomeCents,
    avgSpendingCents,
    currentMonthlySavingsCents,
    spendingByCategory,
    committedMonthlyBillsCents,
    confidence: dataConfidence,
    windowStart,
    windowEnd,
  } = plannerCtx;

  // 3. Determine how much extra monthly savings this goal requires
  const constraints = goal.constraints as {
    exclude_categories?: string[];
    max_monthly_reduction_cents?: string;
  } | null;
  const excludeCategories: readonly string[] = constraints?.exclude_categories ?? [];
  const maxReductionPerCategoryCents: bigint | undefined =
    constraints?.max_monthly_reduction_cents !== undefined
      ? BigInt(constraints.max_monthly_reduction_cents)
      : undefined;

  let neededExtraCents = 0n;
  let projectedTimelineMonths: number | undefined;
  const assumptions: string[] = [];

  assumptions.push(
    `Based on ${plannerCtx.basedOnMonths} month(s) of spending history (${windowStart} – ${windowEnd})`,
  );
  assumptions.push(
    `Average monthly income: ${formatCentsAssumption(avgIncomeCents)}`,
  );
  if (committedMonthlyBillsCents > 0n) {
    assumptions.push(
      `Recurring committed bills: ≈${formatCentsAssumption(committedMonthlyBillsCents)}/month — not targeted for reduction`,
    );
  }

  switch (goal.kind) {
    case 'save_for': {
      const targetAmountCents = goal.targetAmountCents;
      if (targetAmountCents === null || targetAmountCents <= 0n) {
        // No target amount — can't compute a timeline
        neededExtraCents = 0n;
        assumptions.push('No target amount set — showing proportional spending reduction suggestions');
        break;
      }

      let monthsRemaining: number;
      if (goal.targetDate) {
        const targetDateMs = new Date(goal.targetDate).getTime();
        const nowMs = Date.now();
        monthsRemaining = Math.max(1, Math.ceil((targetDateMs - nowMs) / (1000 * 60 * 60 * 24 * 30.44)));
        assumptions.push(`Target: ${formatCentsAssumption(targetAmountCents)} by ${goal.targetDate} (≈${monthsRemaining} months away)`);
      } else {
        monthsRemaining = 12;
        assumptions.push(`No target date set — assuming 12-month horizon to reach ${formatCentsAssumption(targetAmountCents)}`);
      }

      const neededMonthlyTotal = targetAmountCents / BigInt(monthsRemaining);
      neededExtraCents = neededMonthlyTotal > currentMonthlySavingsCents
        ? neededMonthlyTotal - currentMonthlySavingsCents
        : 0n;

      if (neededExtraCents === 0n) {
        assumptions.push('You are already saving enough to reach this goal on time — no spending cuts needed');
      } else {
        assumptions.push(`Extra savings needed: ${formatCentsAssumption(neededExtraCents)}/month`);
      }

      // Projected timeline = targetAmount / totalMonthlySavingsAfterPlan
      const totalMonthlySavingsAfterPlan = currentMonthlySavingsCents + neededExtraCents;
      if (totalMonthlySavingsAfterPlan > 0n) {
        projectedTimelineMonths = Math.ceil(
          Number(targetAmountCents / totalMonthlySavingsAfterPlan),
        );
      }
      break;
    }

    case 'increase_savings_rate': {
      // Target: 20% savings rate
      const targetRatePct = 20n;
      const targetMonthlySavings = (avgIncomeCents * targetRatePct) / 100n;
      neededExtraCents = targetMonthlySavings > currentMonthlySavingsCents
        ? targetMonthlySavings - currentMonthlySavingsCents
        : 0n;
      assumptions.push(`Target savings rate: 20% of income (${formatCentsAssumption(targetMonthlySavings)}/month)`);
      if (neededExtraCents === 0n) {
        assumptions.push('You are already at or above a 20% savings rate — no spending cuts needed');
      }
      break;
    }

    case 'reduce_category_spend': {
      // targetAmountCents = desired monthly reduction amount
      if (goal.targetAmountCents !== null && goal.targetAmountCents > 0n) {
        neededExtraCents = goal.targetAmountCents;
        assumptions.push(`Monthly reduction target: ${formatCentsAssumption(neededExtraCents)}`);
      } else {
        // Default: 10% of average monthly spending
        neededExtraCents = avgSpendingCents / 10n;
        assumptions.push(`No specific reduction amount set — targeting 10% of average spending (${formatCentsAssumption(neededExtraCents)}/month)`);
      }
      break;
    }

    case 'accelerate_debt': {
      // targetAmountCents = desired extra monthly payment amount
      if (goal.targetAmountCents !== null && goal.targetAmountCents > 0n) {
        neededExtraCents = goal.targetAmountCents;
        assumptions.push(`Extra monthly debt payment target: ${formatCentsAssumption(neededExtraCents)}`);
      } else {
        // Default: 20% of current monthly savings
        neededExtraCents = currentMonthlySavingsCents > 0n ? currentMonthlySavingsCents / 5n : 0n;
        assumptions.push(`No payment amount set — targeting 20% of current monthly savings (${formatCentsAssumption(neededExtraCents)}) as extra debt payment`);
      }
      break;
    }

    default: {
      const _: never = goal.kind;
      throw new Error(`Unhandled goal kind: ${String(_)}`);
    }
  }

  // 4. Distribute neededExtraCents proportionally across eligible categories
  const eligibleCategories = spendingByCategory.filter(
    (c) =>
      !excludeCategories.some((ex) => ex.toLowerCase() === c.category.toLowerCase()) &&
      c.avgMonthlyCents > 0n,
  );

  const totalEligibleCents = eligibleCategories.reduce(
    (sum, c) => sum + c.avgMonthlyCents,
    0n,
  );

  const categoryDeltas: Array<{
    category: string;
    capCents: bigint;
    currentAvgCents: bigint;
    reductionCents: bigint;
  }> = [];

  if (neededExtraCents > 0n && totalEligibleCents > 0n) {
    for (const cat of eligibleCategories) {
      // Proportional allocation — bigint integer arithmetic
      let allocation = (neededExtraCents * cat.avgMonthlyCents) / totalEligibleCents;
      if (maxReductionPerCategoryCents !== undefined) {
        if (allocation > maxReductionPerCategoryCents) allocation = maxReductionPerCategoryCents;
      }
      if (allocation <= 0n) continue;

      const capCents = cat.avgMonthlyCents - allocation;
      if (capCents <= 0n) continue; // Don't cap to zero or negative

      categoryDeltas.push({
        category: cat.category,
        capCents,
        currentAvgCents: cat.avgMonthlyCents,
        reductionCents: allocation,
      });
    }
    assumptions.push('Reductions distributed proportionally across eligible spending categories');
    if (excludeCategories.length > 0) {
      assumptions.push(`Excluded from reduction: ${excludeCategories.join(', ')}`);
    }
  }

  if (categoryDeltas.length === 0 && neededExtraCents > 0n) {
    assumptions.push('No eligible categories found to reduce — try removing category exclusions or reducing the target');
  }

  // 5. Determine overall plan confidence (lower of data confidence and category coverage)
  const planConfidence: 'low' | 'medium' | 'high' =
    dataConfidence === 'low' || categoryDeltas.length === 0
      ? 'low'
      : dataConfidence;

  // 6. Build the pending_changes payload
  const payload: PlanProposePayload = {
    goalId: goal.id,
    planMonths: input.planMonths,
    categoryDeltas: categoryDeltas.map((d) => ({
      category: d.category,
      capCents: d.capCents.toString(),
    })),
    confidence: planConfidence,
    assumptions,
  };

  const proposal = await insertPendingChange({
    userId: ctx.userId,
    kind: 'plan_propose',
    payload,
    status: 'pending',
  });

  // 7. Build and return the output
  return {
    proposalId: proposal.id,
    description: buildDescription(goal.name, goal.kind, neededExtraCents, categoryDeltas.length, planConfidence),
    plan: {
      goalName: goal.name,
      goalKind: goal.kind,
      currentMonthlySavingsDollars: centsToNumber(currentMonthlySavingsCents),
      neededExtraMonthlySavingsDollars: centsToNumber(neededExtraCents),
      categoryDeltas: categoryDeltas.map((d) => ({
        category: d.category,
        currentAvgDollars: centsToNumber(d.currentAvgCents),
        proposedCapDollars: centsToNumber(d.capCents),
        reductionDollars: centsToNumber(d.reductionCents),
      })),
      projectedTimelineMonths,
      confidence: planConfidence,
      assumptions,
    },
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function formatCentsAssumption(cents: bigint): string {
  const dollars = centsToNumber(cents < 0n ? -cents : cents);
  return `$${dollars.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function buildDescription(
  goalName: string,
  kind: string,
  neededExtraCents: bigint,
  deltasCount: number,
  confidence: string,
): string {
  const parts: string[] = [`Plan for "${goalName}" (${kind})`];
  if (neededExtraCents > 0n) {
    parts.push(`needs ${formatCentsAssumption(neededExtraCents)}/month extra`);
  }
  if (deltasCount > 0) {
    parts.push(`${deltasCount} category budget(s) proposed`);
  }
  parts.push(`confidence: ${confidence}`);
  return parts.join(' — ');
}
