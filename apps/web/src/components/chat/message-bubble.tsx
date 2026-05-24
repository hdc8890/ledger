import type { UIMessage } from 'ai';

interface MessageBubbleProps {
  message: UIMessage;
}

/**
 * MessageBubble — renders a single chat message.
 *
 * User messages align right with a brand-colored background.
 * Assistant messages align left with a neutral background.
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  const textContent = message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');

  if (!textContent) return null;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div
          aria-hidden="true"
          className="mr-2 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
        >
          AI
        </div>
      )}
      <div
        role="article"
        aria-label={isUser ? 'Your message' : 'Assistant message'}
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'rounded-tr-sm bg-indigo-600 text-white'
            : 'rounded-tl-sm bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100'
        }`}
      >
        {textContent}
      </div>
    </div>
  );
}
