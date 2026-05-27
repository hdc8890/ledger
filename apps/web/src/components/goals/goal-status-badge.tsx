import type { GoalRow } from '@/db/queries/goals';

type GoalStatus = GoalRow['status'];

const STATUS_CONFIG: Record<
  GoalStatus,
  { label: string; className: string }
> = {
  active: {
    label: 'Active',
    className:
      'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  },
  achieved: {
    label: 'Achieved',
    className:
      'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  },
  paused: {
    label: 'Paused',
    className:
      'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  },
  archived: {
    label: 'Archived',
    className:
      'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
  },
};

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
