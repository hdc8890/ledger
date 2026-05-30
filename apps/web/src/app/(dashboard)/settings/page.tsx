import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUserId } from '@/lib/auth-helpers';
import { getLlmUsageTotals } from '@/db/queries/llm-usage';

export default async function SettingsPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/sign-in');
  const usage = await getLlmUsageTotals(userId);

  const totalTokens = usage.totalInputTokens + usage.totalOutputTokens;
  const costDisplay = `$${Number(usage.totalCostUsd).toFixed(4)}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Settings</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Manage your connected accounts, preferences, and data.
        </p>
      </div>

      {/* AI Usage */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">
          AI Usage
        </h2>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
            Estimated costs are based on token pricing and are for informational purposes only.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                Total cost
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {costDisplay}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                Requests
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {usage.totalCalls.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                Tokens used
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                {totalTokens.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Memory */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">Memory</h2>
        <Link
          href="/settings/memory"
          className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
        >
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Manage memories
            </p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              View, edit, or delete the preferences and rules the AI has learned about you.
            </p>
          </div>
          <span className="text-neutral-400 dark:text-neutral-500" aria-hidden="true">
            →
          </span>
        </Link>
      </section>
    </div>
  );
}

