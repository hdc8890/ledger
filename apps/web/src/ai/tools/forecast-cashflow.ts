import { z } from 'zod';
import { forecastCashFlowFromHistory } from '@/db/queries/cash-flow';
import { centsToNumber } from '@/shared/money';
import type { ToolContext } from './context';

export const inputSchema = z.object({
  /** Number of future months to project (1–12). */
  months: z.number().int().min(1).max(12).default(3),
});

export const outputSchema = z.object({
  projections: z.array(
    z.object({
      month: z.string(),
      projectedIncomeDollars: z.number(),
      projectedSpendingDollars: z.number(),
      projectedSavingsDollars: z.number(),
    }),
  ),
  methodology: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
});

export type ForecastCashflowOutput = z.infer<typeof outputSchema>;

export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<ForecastCashflowOutput> {
  const forecast = await forecastCashFlowFromHistory(ctx.userId, input.months);
  return {
    projections: forecast.projections.map((p) => ({
      month: p.month,
      projectedIncomeDollars: centsToNumber(p.projectedIncomeCents),
      projectedSpendingDollars: centsToNumber(p.projectedSpendingCents),
      projectedSavingsDollars: centsToNumber(p.projectedSavingsCents),
    })),
    methodology: forecast.methodology,
    confidence: forecast.confidence,
  };
}
