import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { findUserByClerkId } from '@/db/queries/users';
import { getGoalsByUserId } from '@/db/queries/goals';
import { GoalCard } from '@/components/goals/goal-card';
import type { UserId } from '@/shared/types';

export const metadata = { title: 'Goals' };

export default async function GoalsPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const user = await findUserByClerkId(clerkId);
  if (!user) redirect('/sign-in');

  const goals = await getGoalsByUserId(user.id as UserId);

  const activeGoals = goals.filter((g) => g.status === 'active' || g.status === 'paused');
  const doneGoals = goals.filter((g) => g.status === 'achieved' || g.status === 'archived');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Goals</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Financial goals you&apos;ve set. Ask the AI to create a plan for any goal.
        </p>
      </div>

      {goals.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            No goals yet
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Ask the AI to create a goal, e.g. &ldquo;Help me save an extra $1,500/month&rdquo;.
          </p>
        </div>
      )}

      {activeGoals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">
            Active
          </h2>
          {activeGoals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
        </section>
      )}

      {doneGoals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">
            Completed &amp; Archived
          </h2>
          {doneGoals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
        </section>
      )}
    </div>
  );
}
