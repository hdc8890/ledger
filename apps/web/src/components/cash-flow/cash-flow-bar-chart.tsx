'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { centsToNumber } from '@/shared/money';
import type { ChartConfig } from '@/components/ui/chart';
import type { CashFlowMonth } from '@/db/queries/cash-flow';

interface CashFlowBarChartProps {
  /** Monthly data in chronological order (oldest first). */
  data: readonly CashFlowMonth[];
}

type ChartRow = {
  readonly month: string;
  readonly incomeDollars: number;
  readonly spendingDollars: number;
};

const chartConfig: ChartConfig = {
  incomeDollars: {
    label: 'Income',
    color: 'hsl(var(--chart-2))',
  },
  spendingDollars: {
    label: 'Spending',
    color: 'hsl(var(--chart-1))',
  },
};

const formatAxis = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value}`;
};

/** Client component — grouped bar chart showing income vs spending by month. */
export function CashFlowBarChart({ data }: CashFlowBarChartProps) {
  const rows: ChartRow[] = data.map((m) => ({
    month: m.month,
    incomeDollars: centsToNumber(m.incomeCents),
    spendingDollars: centsToNumber(m.spendingCents),
  }));

  const formatMonthLabel = (value: string) => {
    const [year, mon] = value.split('-');
    if (!year || !mon) return value;
    const d = new Date(Date.UTC(Number(year), Number(mon) - 1, 1));
    return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Income vs Spending
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No cash flow data yet
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-48 w-full">
            <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={formatMonthLabel}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={formatAxis}
                tick={{ fontSize: 11 }}
                width={56}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) =>
                      new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                      }).format(value as number)
                    }
                    labelFormatter={(label: unknown) =>
                      typeof label === 'string' ? formatMonthLabel(label) : String(label ?? '')
                    }
                  />
                }
              />
              <Legend
                iconType="square"
                iconSize={10}
                wrapperStyle={{ fontSize: 11 }}
              />
              <Bar dataKey="incomeDollars" fill="var(--color-incomeDollars)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="spendingDollars" fill="var(--color-spendingDollars)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
