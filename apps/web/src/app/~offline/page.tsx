import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Offline',
};

// Static fallback served by the service worker when a navigation request
// cannot reach the network. Kept dependency-free so it precaches cleanly.
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-neutral-50 p-6 text-center dark:bg-neutral-950">
      <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        You&apos;re offline
      </h1>
      <p className="max-w-sm text-sm text-neutral-600 dark:text-neutral-400">
        Ledger needs a connection to load your latest financial data. Check
        your network and try again.
      </p>
    </div>
  );
}
