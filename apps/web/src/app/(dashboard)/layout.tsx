import { auth } from '@/auth';
import { Sidebar } from '@/components/sidebar';
import { BottomNav } from '@/components/bottom-nav';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const displayName = session?.user?.name ?? session?.user?.email ?? null;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Sidebar displayName={displayName} />
      <BottomNav />
      {/* Offset for sidebar on desktop; offset for bottom nav on mobile */}
      <div className="pb-16 md:ml-60 md:pb-0">
        <main className="min-h-screen p-6">{children}</main>
      </div>
    </div>
  );
}
