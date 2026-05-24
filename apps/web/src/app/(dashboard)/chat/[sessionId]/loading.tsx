/**
 * Loading skeleton shown while the chat session page is streaming in.
 */
export default function ChatSessionLoading() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-hidden px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* Simulated skeleton bubbles */}
          <div className="flex justify-end">
            <div className="h-9 w-48 animate-pulse rounded-2xl rounded-tr-sm bg-indigo-100 dark:bg-indigo-900/30" />
          </div>
          <div className="flex justify-start gap-2">
            <div className="h-7 w-7 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-16 w-64 animate-pulse rounded-2xl rounded-tl-sm bg-neutral-100 dark:bg-neutral-800" />
          </div>
        </div>
      </div>
      <div className="border-t border-neutral-200 px-4 py-4 dark:border-neutral-800">
        <div className="mx-auto max-w-3xl">
          <div className="h-12 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
        </div>
      </div>
    </div>
  );
}
