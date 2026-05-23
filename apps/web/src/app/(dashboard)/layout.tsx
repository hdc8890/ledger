import { Sidebar } from '@/components/sidebar';
import { BottomNav } from '@/components/bottom-nav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
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
