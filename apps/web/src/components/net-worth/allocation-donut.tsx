'use client';

import { Cell, Pie, PieChart, Tooltip } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ChartConfig } from '@/components/ui/chart';

export type AllocationSlice = {
  readonly kind: string;
  readonly valueDollars: number;
  readonly label: string;
};

interface AllocationDonutProps {
  slices: readonly AllocationSlice[];
}

const KIND_LABELS: Record<string, string> = {
  home: 'Home',
  vehicle: 'Vehicles',
  brokerage: 'Brokerage',
  cash: 'Cash',
  crypto: 'Crypto',
  manual: 'Manual',
};

const PALETTE = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(220, 70%, 50%)',
] as const satisfies readonly string[];

function getColor(index: number): string {
  return PALETTE[index % PALETTE.length] ?? PALETTE[0];
}

/** Client component — donut chart showing asset allocation by kind. */
export function AllocationDonut({ slices }: AllocationDonutProps) {
  const chartConfig = slices.reduce<ChartConfig>((acc, s, i) => {
    const color = getColor(i);
    acc[s.kind] = { label: s.label, color };
    return acc;
  }, {});

  const total = slices.reduce((sum, s) => sum + s.valueDollars, 0);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(v);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Asset Allocation</CardTitle>
      </CardHeader>
      <CardContent>
        {slices.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            No assets yet
          </div>
        ) : (
          <div className="flex items-center gap-6">
            <ChartContainer config={chartConfig} className="h-40 w-40 shrink-0">
              <PieChart>
                <Pie
                  data={slices as AllocationSlice[]}
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="80%"
                  dataKey="valueDollars"
                  nameKey="kind"
                  paddingAngle={2}
                >
                  {slices.map((s, i) => (
                    <Cell key={s.kind} fill={getColor(i)} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => {
                    const numValue = typeof value === 'number' ? value : Number(value ?? 0);
                    const strName = String(name ?? '');
                    return [formatCurrency(numValue), KIND_LABELS[strName] ?? strName] as [string, string];
                  }}
                />
              </PieChart>
            </ChartContainer>
            <div className="flex flex-1 flex-col gap-2">
              {slices.map((s, i) => {
                const pct = total > 0 ? ((s.valueDollars / total) * 100).toFixed(1) : '0.0';
                return (
                  <div key={s.kind} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: getColor(i) }}
                      />
                      <span className="text-muted-foreground">{s.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatCurrency(s.valueDollars)}</span>
                      <span className="w-10 text-right text-muted-foreground">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
