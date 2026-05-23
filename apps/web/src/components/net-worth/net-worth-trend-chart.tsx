'use client';

import { useState } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ChartConfig } from '@/components/ui/chart';

export type TrendPoint = {
  /** YYYY-MM-DD */
  readonly date: string;
  /** Net worth in whole dollars (for chart axis display). */
  readonly valueDollars: number;
};

export type TrendRange = '30d' | '90d' | '1y';

interface NetWorthTrendChartProps {
  data30d: readonly TrendPoint[];
  data90d: readonly TrendPoint[];
  data1y: readonly TrendPoint[];
}

const chartConfig: ChartConfig = {
  valueDollars: {
    label: 'Net Worth',
    color: 'hsl(var(--chart-1))',
  },
};

const RANGES: { label: string; value: TrendRange }[] = [
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: '1Y', value: '1y' },
];

/** Client component — sparkline trend chart with 30d/90d/1y range toggle. */
export function NetWorthTrendChart({ data30d, data90d, data1y }: NetWorthTrendChartProps) {
  const [range, setRange] = useState<TrendRange>('30d');

  const dataMap: Record<TrendRange, readonly TrendPoint[]> = {
    '30d': data30d,
    '90d': data90d,
    '1y': data1y,
  };

  const data = dataMap[range];

  const formatAxis = (value: number) => {
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
    return `$${value}`;
  };

  const formatTooltip = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Trend</CardTitle>
        <div className="flex gap-1">
          {RANGES.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setRange(value)}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                range === value
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            No trend data yet
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-40 w-full">
            <LineChart data={data as TrendPoint[]} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v: string) => {
                  const d = new Date(v + 'T00:00:00Z');
                  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }}
                interval="preserveStartEnd"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={formatAxis}
                tick={{ fontSize: 11 }}
                width={60}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatTooltip(value as number)}
                    labelFormatter={(label) => {
                      const d = new Date((label as string) + 'T00:00:00Z');
                      return d.toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      });
                    }}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="valueDollars"
                stroke="var(--color-valueDollars)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
