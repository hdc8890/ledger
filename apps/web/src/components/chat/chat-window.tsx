'use client';

import { useEffect, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { ChatInput } from './chat-input';
import { MessageBubble } from './message-bubble';

interface ChatWindowProps {
  sessionId: string;
}

/**
 * ChatWindow — main chat interface.
 *
 * Uses the AI SDK v6 `useChat` hook which communicates with POST /api/chat.
 * The `id` option ensures the session ID is sent in the request body so the
 * server can persist messages to the correct session.
 */
export function ChatWindow({ sessionId }: ChatWindowProps) {
  const { messages, status, sendMessage, error } = useChat({
    id: sessionId,
  });

  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 rounded-full bg-neutral-100 p-4 dark:bg-neutral-800">
              <svg
                className="h-8 w-8 text-neutral-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-neutral-700 dark:text-neutral-300">
              Start a conversation
            </h2>
            <p className="mt-1 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
              Ask about your accounts, spending, net worth, or anything about your finances.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {isStreaming && (
              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                  <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                  <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
                </span>
                <span>Thinking…</span>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {error.message ?? 'Something went wrong. Please try again.'}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-neutral-200 bg-white px-4 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto max-w-3xl">
          <ChatInput
            onSend={(text) => {
              void sendMessage({ text });
            }}
            disabled={isStreaming}
          />
        </div>
      </div>
    </div>
  );
}
