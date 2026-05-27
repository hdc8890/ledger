import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { findUserByClerkId } from '@/db/queries/users';
import { listMemories } from '@/ai/memory';
import { MemoryManager } from '@/components/settings/memory-manager';
import type { UserId } from '@/shared/types';

export default async function MemoryPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const user = await findUserByClerkId(clerkId);
  if (!user) redirect('/sign-in');

  const userId = user.id as UserId;
  const memories = await listMemories(userId, undefined, 500, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/settings"
          className="mb-2 inline-flex items-center text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Memory</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          The agent remembers your preferences, rules, and corrections. Edit or delete any memory
          to refine what the AI knows about you.
        </p>
      </div>

      <MemoryManager initialMemories={memories} />
    </div>
  );
}
