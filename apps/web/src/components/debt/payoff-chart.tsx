'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { centsToNumber } from '@/shared/money';

export interface PayoffPoint {
  /** Month index, 0 = current month. */
  month: number;
  /** Remaining balance in cents. */
  balanceCents: bigint;
}

export interface LiabilityPayoffInput {
  id: string;
  name: string;
  /** Outstanding balance in cents. */
  balanceCents: bigint;
  /** Annual percentage rate (0–1). Null = 0% assumption. */
  apr: number | null;
  /** Loan term in months remaining. Null for revolving / unknown. */
  termMonths: number | null;
}

/**
 * Build a month-by-month payoff series for a single liability using
 * standard amortization. Pure function — no side effects.
 *
 * - If `termMonths` is known: computes the fixed monthly payment and
 *   amortizes until balance reaches 0, capped at `termMonths` points.
 * - If `termMonths` is unknown: assumes a 60-month linear paydown.
 * - If APR is null or 0: simple linear reduction.
 */
export function buildPayoffSeries(
  liability: LiabilityPayoffInput,
  maxMonths = 360,
): PayoffPoint[] {
  const { balanceCents, apr, termMonths } = liability;
  if (balanceCents <= 0n) return [{ month: 0, balanceCents: 0n }];

  const months = Math.min(termMonths != null && termMonths > 0 ? termMonths : 60, maxMonths);
  const monthlyRate = apr != null && apr > 0 ? apr / 12 : 0;

  if (monthlyRate === 0) {
    // Linear paydown
    const points: PayoffPoint[] = [];
    for (let m = 0; m <= months; m++) {
      const remaining = balanceCents - (balanceCents * BigInt(m)) / BigInt(months);
      points.push({ month: m, balanceCents: remaining < 0n ? 0n : remaining });
    }
    return points;
  }

  // Standard amortization: M = P × r(1+r)^n / ((1+r)^n − 1)
  const rn = Math.pow(1 + monthlyRate, months);
  const monthlyPaymentDollars =
    (centsToNumber(balanceCents) * monthlyRate * rn) / (rn - 1);

  const points: PayoffPoint[] = [];
  let remainingDollars = centsToNumber(balanceCents);

  for (let m = 0; m <= months && remainingDollars > 0.005; m++) {
    points.push({ month: m, balanceCents: BigInt(Math.round(remainingDollars * 100)) });
    const interest = remainingDollars * monthlyRate;
    remainingDollars = remainingDollars - monthlyPaymentDollars + interest;
    if (remainingDollars < 0) remainingDollars = 0;
  }
  // Ensure we end at 0
  const lastMonth = points[points.length - 1]?.month ?? 0;
  if ((points[points.length - 1]?.balanceCents ?? 0n) > 0n) {
    points.push({ month: lastMonth + 1, balanceCents: 0n });
  }

  return points;
}

interface ChartSeries {
  name: string;
  data: PayoffPoint[];
  color: string;
}

const SERIES_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
] as const;

interface PayoffChartProps {
  liabilities: readonly LiabilityPayoffInput[];
}

/** Client component — projected payoff line chart for all liabilities. */
export function PayoffChart({ liabilities }: PayoffChartProps) {
  const seriesList: ChartSeries[] = liabilities
    .filter((l) => l.balanceCents > 0n)
    .map((l, i) => ({
      name: l.name,
      data: buildPayoffSeries(l),
      color: SERIES_COLORS[i % SERIES_COLORS.length] ?? '#ef4444',
    }));

  if (seriesList.length === 0) return null;

  // Build a unified month axis across all series
  const maxMonth = Math.max(...seriesList.map((s) => s.data[s.data.length - 1]?.month ?? 0));

  // Recharts needs a single flat data array keyed by month with one key per series
  const chartData: Record<string, number>[] = [];
  for (let m = 0; m <= maxMonth; m++) {
    const point: Record<string, number> = { month: m };
    for (const series of seriesList) {
      // Find the balance at this month (last known value if series ended early)
      const found = series.data.find((p) => p.month === m);
      const val = found
        ? centsToNumber(found.balanceCents)
        : 0;
      point[series.name] = val;
    }
    chartData.push(point);
  }

  const formatDollar = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="mb-4 text-sm font-medium text-muted-foreground">Projected Payoff</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-neutral-200 dark:stroke-neutral-700" />
          <XAxis
            dataKey="month"
            tickFormatter={(v: number) => (v % 12 === 0 ? `Yr ${v / 12}` : '')}
            tick={{ fontSize: 11 }}
          />
          <YAxis tickFormatter={formatDollar} tick={{ fontSize: 11 }} width={72} />
          <Tooltip
            formatter={(v) => [typeof v === 'number' ? formatDollar(v) : String(v ?? '')]}
            labelFormatter={(label) => `Month ${String(label)}`}
          />
          {seriesList.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {seriesList.map((series) => (
            <Line
              key={series.name}
              type="monotone"
              dataKey={series.name}
              stroke={series.color}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
