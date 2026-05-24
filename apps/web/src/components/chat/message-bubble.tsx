import { isToolUIPart, getToolName, type DynamicToolUIPart } from 'ai';
import type { UIMessage } from 'ai';
import { ProposalCard } from './proposal-card';

const WRITE_TOOLS = new Set(['update_asset', 'tag_transaction', 'create_rule_draft']);

interface MessageBubbleProps {
  message: UIMessage;
}

// AI SDK v6: completed tool calls surface as DynamicToolUIPart with state='output-available'
// and the result in the `output` field.
type CompletedToolPart = DynamicToolUIPart & { state: 'output-available'; output: unknown };

function isCompletedWriteTool(p: UIMessage['parts'][number]): p is CompletedToolPart {
  if (!isToolUIPart(p)) return false;
  const tool = p as DynamicToolUIPart;
  return tool.state === 'output-available' && WRITE_TOOLS.has(getToolName(tool));
}

/**
 * MessageBubble — renders a single chat message.
 *
 * User messages align right with a brand-colored background.
 * Assistant messages align left with a neutral background.
 * Completed write-tool calls (state='output-available') render a ProposalCard inline.
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  const textContent = message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');

  const proposalParts = message.parts.filter(isCompletedWriteTool);

  if (!textContent && proposalParts.length === 0) return null;

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
      <div className={`max-w-[80%] space-y-2 ${isUser ? 'items-end' : 'items-start'}`}>
        {textContent && (
          <div
            role="article"
            aria-label={isUser ? 'Your message' : 'Assistant message'}
            className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              isUser
                ? 'rounded-tr-sm bg-indigo-600 text-white'
                : 'rounded-tl-sm bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100'
            }`}
          >
            {textContent}
          </div>
        )}
        {proposalParts.map((p) => (
          <ProposalCard
            key={p.toolCallId}
            toolName={getToolName(p)}
            result={p.output as Parameters<typeof ProposalCard>[0]['result']}
          />
        ))}
      </div>
    </div>
  );
}
