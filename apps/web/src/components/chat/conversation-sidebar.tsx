'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { deleteSessionAction } from '@/app/actions/chat';
import type { ChatSessionRow } from '@/db/queries/chat-sessions';

interface ConversationSidebarProps {
  sessions: ChatSessionRow[];
  activeSessionId?: string;
}

/**
 * ConversationSidebar — lists all chat sessions for the current user.
 *
 * Receives sessions as props from the server component layout (avoids a
 * separate client-side fetch). The "New Chat" button navigates to a freshly
 * generated UUID, which creates the session lazily on first message.
 *
 * Delete calls the `deleteSessionAction` server action, then refreshes the
 * router to re-fetch the session list from the server.
 */
export function ConversationSidebar({ sessions, activeSessionId }: ConversationSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function handleNewChat() {
    const newId = crypto.randomUUID();
    router.push(`/chat/${newId}`);
  }

  function handleDelete(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation();
    e.preventDefault();

    startTransition(async () => {
      await deleteSessionAction(sessionId);
      // If we just deleted the active session, navigate to /chat.
      if (pathname === `/chat/${sessionId}`) {
        router.push('/chat');
      } else {
        router.refresh();
      }
    });
  }

  return (
    <aside
      className="flex h-full w-60 flex-shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      aria-label="Conversation history"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Conversations
        </span>
        <button
          onClick={handleNewChat}
          aria-label="New conversation"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Session list */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {sessions.length === 0 ? (
          <p className="px-2 py-3 text-xs text-neutral-400 dark:text-neutral-600">
            No conversations yet.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const label = session.title ?? 'New conversation';

              return (
                <li key={session.id}>
                  <div
                    className={`group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                        : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                    }`}
                    onClick={() => router.push(`/chat/${session.id}`)}
                    role="button"
                    tabIndex={0}
                    aria-current={isActive ? 'page' : undefined}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        router.push(`/chat/${session.id}`);
                      }
                    }}
                  >
                    <span className="flex-1 truncate text-sm" title={label}>
                      {label}
                    </span>
                    <button
                      onClick={(e) => handleDelete(e, session.id)}
                      aria-label={`Delete conversation: ${label}`}
                      disabled={isPending}
                      className="hidden h-5 w-5 flex-shrink-0 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-red-600 group-hover:flex dark:hover:bg-neutral-700 dark:hover:text-red-400"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
