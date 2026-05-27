/**
 * extract-memories — Phase 5 Task 4
 *
 * Background Inngest job that runs after each chat turn. Sends the recent
 * conversation to gpt-4o-mini with a strict JSON schema and asks whether
 * any messages reveal a preference, household rule, or fact worth persisting
 * as a memory. Returns 0–3 proposals that are inserted into memory_proposals
 * for the user to accept or dismiss via the chat UI chip.
 *
 * Privacy rule (AGENTS.md §0): the job must not produce proposals containing
 * raw dollar amounts, account numbers, or institution names. The LLM prompt
 * enforces this through explicit instruction.
 *
 * Idempotency: proposals with text that was already rejected by the user are
 * silently skipped so the same content is never re-proposed.
 *
 * Triggered by: 'memory/chat.extract'
 * Emitted by: POST /api/chat onFinish (fire-and-forget)
 */

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { inngest } from '@/lib/inngest';
import {
  insertMemoryProposal,
  hasRejectedProposalWithText,
} from '@/db/queries/memories';
import { logLlmCall } from '@/db/queries/llm-usage';
import type { UserId, ChatSessionId } from '@/shared/types';

/** Use the cheap model — this is a high-volume post-processing call. */
const EXTRACT_MODEL = 'gpt-4o-mini';

/** Maximum number of proposals to produce per turn. */
const MAX_PROPOSALS = 3;

/**
 * How many recent message tokens to send. We cap at the last 6 messages
 * (3 turns) to keep cost low and signal high.
 */
const MAX_RECENT_MESSAGES = 6;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const MemoryProposalItemSchema = z.object({
  text: z
    .string()
    .describe(
      'Semantic memory text. Must not contain raw dollar amounts, account numbers, or institution names.',
    ),
  kind: z
    .enum(['preference', 'household_rule', 'historical_context', 'goal', 'override_note'])
    .describe('Memory category'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('How confident are you that this is worth remembering (0–1)?'),
});

export const ExtractionResultSchema = z.object({
  proposals: z
    .array(MemoryProposalItemSchema)
    .max(MAX_PROPOSALS)
    .describe('List of proposed memories. Return an empty array if nothing is worth saving.'),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export type RecentMessage = {
  readonly role: 'user' | 'assistant';
  readonly text: string;
};

// ---------------------------------------------------------------------------
// Core handler — exported for unit testing
// ---------------------------------------------------------------------------

export type ExtractMemoriesContext = {
  event: {
    data: {
      userId: string;
      sessionId: string;
      recentMessages: RecentMessage[];
    };
  };
  step: {
    run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  };
};

export type ExtractMemoriesResult = {
  userId: string;
  sessionId: string;
  proposed: number;
  skipped: number;
};

export async function handleExtractMemories(
  ctx: ExtractMemoriesContext,
): Promise<ExtractMemoriesResult> {
  const { userId, sessionId, recentMessages } = ctx.event.data;
  const { step } = ctx;

  // Limit to the most recent MAX_RECENT_MESSAGES messages.
  const messages = recentMessages.slice(-MAX_RECENT_MESSAGES);

  if (messages.length === 0) {
    return { userId, sessionId, proposed: 0, skipped: 0 };
  }

  // Build the conversation transcript for the LLM.
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
    .join('\n');

  // Run the LLM extraction step.
  const extraction = await step.run('extract-proposals', async () => {
    const start = Date.now();
    const { object, usage } = await generateObject({
      model: openai(EXTRACT_MODEL),
      schema: ExtractionResultSchema,
      prompt: `You are a memory extraction assistant for a personal financial AI. Review the conversation below and identify any lasting preferences, household rules, or facts that are worth remembering for future conversations.

Only propose memories that meet ALL of these criteria:
- A clear, durable preference or rule (not a one-time request)
- Semantic content only — absolutely NO raw dollar amounts, account numbers, institution names, or personally identifiable financial details
- Not already obvious or trivial
- Genuinely useful for personalizing future AI responses

Return an empty proposals array if nothing meets these criteria. Return at most ${MAX_PROPOSALS} proposals.

Examples of GOOD memory text:
- "User prefers Costco transactions to be categorized as Groceries"
- "User's household treats all transfers between savings and checking as non-spending"
- "User is saving for a down payment on a house"

Examples of BAD memory text (do not propose):
- "User's checking account balance is $X" (raw amount)
- "User's Chase account ends in 1234" (account detail)
- "User spent money on groceries" (one-time, not durable)

Conversation:
${transcript}`,
    });

    await logLlmCall({
      userId: userId as UserId,
      model: EXTRACT_MODEL,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      latencyMs: Date.now() - start,
      toolCalls: null,
    });

    return object;
  });

  // Insert non-duplicate proposals.
  let proposed = 0;
  let skipped = 0;

  for (const item of extraction.proposals) {
    const result = await step.run(`insert-proposal-${proposed + skipped}`, async () => {
      const alreadyRejected = await hasRejectedProposalWithText(userId as UserId, item.text);
      if (alreadyRejected) return { inserted: false };

      await insertMemoryProposal({
        userId: userId as UserId,
        proposedText: item.text,
        proposedKind: item.kind,
        sourceSessionId: sessionId as ChatSessionId,
      });
      return { inserted: true };
    });

    if (result.inserted) {
      proposed++;
    } else {
      skipped++;
    }
  }

  return { userId, sessionId, proposed, skipped };
}

// ---------------------------------------------------------------------------
// Inngest function registration
// ---------------------------------------------------------------------------

/**
 * memory/chat.extract — auto-extract memory proposals after each chat turn.
 *
 * Event payload: { userId: string, sessionId: string, recentMessages: RecentMessage[] }
 * Emitted by: POST /api/chat onFinish
 */
export const extractMemories = inngest.createFunction(
  {
    id: 'memory-chat-extract',
    name: 'Memory: Auto-Extract Proposals',
    triggers: [{ event: 'memory/chat.extract' }],
  },
  handleExtractMemories,
);
