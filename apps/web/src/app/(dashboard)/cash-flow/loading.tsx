import { Skeleton } from '@/components/ui/skeleton';

export default function CashFlowLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-72" />
      </div>
      {/* Savings rate card */}
      <Skeleton className="h-28 rounded-xl" />
      {/* Bar chart */}
      <Skeleton className="h-64 rounded-xl" />
      {/* Top categories */}
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
