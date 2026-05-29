import { auth } from '@clerk/nextjs/server';
import { upsertUserByClerkId } from '@/db/queries/users';
import { Sidebar } from '@/components/sidebar';
import { BottomNav } from '@/components/bottom-nav';

// Ensure a users row exists on every dashboard load. This is the primary
// provisioning path during local development where the Clerk webhook may not
// be configured. It is idempotent — upsert is a no-op after first sign-in.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (userId) {
    await upsertUserByClerkId({ clerkId: userId });
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Sidebar />
      <BottomNav />
      {/* Offset for sidebar on desktop; offset for bottom nav on mobile */}
      <div className="pb-16 md:ml-60 md:pb-0">
        <main className="min-h-screen p-6">{children}</main>
      </div>
    </div>
  );
}
