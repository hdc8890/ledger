import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { streamText, generateText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { getChatModel, getTitleModel, modelIds } from '@/ai/provider';
import { z } from 'zod';
import { findUserByClerkId } from '@/db/queries/users';
import {
  createChatSession,
  getChatSessionById,
  touchChatSession,
  updateChatSessionTitle,
} from '@/db/queries/chat-sessions';
import { insertChatMessage } from '@/db/queries/chat-messages';
import { logLlmCall } from '@/db/queries/llm-usage';
import { checkAndConsumeRateLimit } from '@/db/queries/rate-limits';
import { buildTools } from '@/ai/tools/registry';
import { retrieveMemories } from '@/ai/memory';
import { inngest } from '@/lib/inngest';
import type { MemoryRow } from '@/db/queries/memories';
import type { ChatSessionId, UserId } from '@/shared/types';
import type { RecentMessage } from '@/inngest/functions/extract-memories';

/**
 * Model identifiers come from `@/ai/provider` so a single env var
 * (`LLM_CHAT_PROVIDER` / `LLM_CHAT_MODEL`, etc.) swaps the underlying provider.
 * We retain the chat alias so `logLlmCall(... model: MODEL)` keeps logging
 * the concrete model id.
 */
const MODEL = modelIds.chat;

/**
 * Approximate token count using 4 chars-per-token heuristic.
 * Used to enforce the ~800-token cap on injected memory context.
 */
const APPROX_CHARS_PER_TOKEN = 4;
const MEMORY_TOKEN_CAP = 800;
const MEMORY_CHAR_CAP = MEMORY_TOKEN_CAP * APPROX_CHARS_PER_TOKEN; // 3200
/** Truncate a single memory's text to this length to keep entries readable. */
const MEMORY_TEXT_MAX_CHARS = 250;

/**
 * Format a list of memories into a `### Relevant Context` system-prompt block.
 *
 * Rules:
 * - Returns empty string when the list is empty (no section is injected).
 * - Truncates individual memory text at MEMORY_TEXT_MAX_CHARS.
 * - Stops adding entries once the total character count reaches MEMORY_CHAR_CAP
 *   (~800 tokens) to bound prompt cost.
 */
export function buildMemoryContext(memories: readonly MemoryRow[]): string {
  if (memories.length === 0) return '';

  const lines: string[] = [];
  let charCount = 0;

  for (const m of memories) {
    const text = m.text.length > MEMORY_TEXT_MAX_CHARS
      ? `${m.text.slice(0, MEMORY_TEXT_MAX_CHARS)}…`
      : m.text;
    const line = `- [${m.kind}] ${text}`;
    if (charCount + line.length > MEMORY_CHAR_CAP) break;
    lines.push(line);
    charCount += line.length;
  }

  if (lines.length === 0) return '';

  return `\n\n### Relevant Context\nThe following preferences and rules have been remembered about this user:\n${lines.join('\n')}\nWhen relevant, cite these with "Based on your preference, …" or "Based on your household rule, …".`;
}

// ---------------------------------------------------------------------------
// POST /api/chat
//
// Accepts a streaming chat request from useChat (AI SDK v6). Responsibilities:
//   1. Authenticate and resolve the internal user.
//   2. Ensure the chat session exists (lazy creation on first message).
//   3. Persist the new user message.
//   4. Stream a response from Claude Sonnet.
//   5. Persist the assistant response on finish and touch the session.
//
// Write tools (Phase 3 Task 2-4) are not yet registered here. The route
// returns text-only responses for Task 1.
// ---------------------------------------------------------------------------

const ChatRequestBody = z.object({
  /** Session ID — matches the `id` passed to `useChat({ id })`. */
  id: z.string().uuid(),
  /** Full UIMessage history sent by useChat on every turn. */
  messages: z.array(z.unknown()),
});

function buildSystemPrompt(currentDate: string, memoryContext = ''): string {
  return `You are a personal AI financial assistant with access to the user's financial data.

Today's date: ${currentDate}

Guidelines:
- Never compute totals or balances yourself — always use the provided tools.
- Never invent or estimate a transaction that isn't in the data.
- Do not provide tax, legal, or investment advice.
- When stating a number, always cite the source (account name, date range, etc.).
- Be concise, accurate, and honest about what you do and don't know.
- Write tools (update_asset, tag_transaction, create_rule_draft) return proposals that the user must approve. Always present the proposal and explain what will change — never imply the change has already happened.

You have access to the user's accounts, transactions, assets, and liabilities.${memoryContext}`;
}

/**
 * Asynchronously generate a short title for a chat session from the first
 * user message. Called fire-and-forget in onFinish; errors are logged but
 * never surfaced to the user.
 */
async function generateSessionTitle(
  sessionId: ChatSessionId,
  firstUserMessage: string,
): Promise<void> {
  try {
    const { text } = await generateText({
      model: getTitleModel(),
      prompt: `Generate a concise 3-6 word title for a financial chat conversation that starts with this user message. Return only the title — no punctuation, no quotes, no explanation.

User message: "${firstUserMessage.slice(0, 300)}"`,
      maxOutputTokens: 20,
    });
    const title = text.trim().replace(/^["']|["']$/g, '');
    if (title) {
      await updateChatSessionTitle(sessionId, title);
    }
  } catch (err) {
    console.error('[chat/route] title generation error:', err);
  }
}

export async function POST(request: Request): Promise<Response> {
  // 1. Auth.
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse and validate body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ChatRequestBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { id: sessionId, messages: rawMessages } = parsed.data;

  // 3. Resolve internal user.
  const user = await findUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const userId = user.id as UserId;

  // 4. Rate limit — 50 requests/hour per user (Postgres token bucket).
  const rateLimit = await checkAndConsumeRateLimit(userId);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many requests',
        message: `You've reached the chat limit of 50 requests per hour. Please try again in about an hour.`,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  // 5. Ensure session exists — create lazily on first message.
  let session = await getChatSessionById(sessionId as ChatSessionId);
  if (!session) {
    session = await createChatSession({
      id: sessionId,
      userId,
      title: null,
    });
  } else if (session.userId !== userId) {
    // Ownership check: prevent cross-user session access.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 6. Persist the last user message (the new turn sent by the client).
  const uiMessages = rawMessages as UIMessage[];
  const lastUserMessage = uiMessages.findLast((m) => m.role === 'user');
  if (lastUserMessage) {
    const textPart = lastUserMessage.parts.find((p) => (p as { type: string }).type === 'text');
    const textContent =
      textPart != null ? (textPart as { type: 'text'; text: string }).text : '';
    await insertChatMessage({
      sessionId: sessionId as ChatSessionId,
      role: 'user',
      content: { text: textContent },
      toolCalls: null,
    });
  }

  // Fire-and-forget title generation when this is the first user message.
  const isFirstUserMessage =
    session.title === null && uiMessages.filter((m) => m.role === 'user').length === 1;
  if (isFirstUserMessage && lastUserMessage) {
    const textPart = lastUserMessage.parts.find((p) => (p as { type: string }).type === 'text');
    const firstText =
      textPart != null ? (textPart as { type: 'text'; text: string }).text : '';
    if (firstText) {
      void generateSessionTitle(sessionId as ChatSessionId, firstText);
    }
  }

  // 7. Convert UIMessage[] → ModelMessage[] for streamText.
  const modelMessages = await convertToModelMessages(uiMessages);

  // 8. Retrieve relevant memories to inject into the system prompt.
  //    Failures are non-fatal — chat must work even if the embedding API is down.
  let memoryContext = '';
  const userMessageText = (() => {
    const textPart = lastUserMessage?.parts.find((p) => (p as { type: string }).type === 'text');
    return textPart != null ? (textPart as { type: 'text'; text: string }).text : '';
  })();
  if (userMessageText) {
    try {
      const memories = await retrieveMemories(userId, userMessageText, 10, 0.3);
      memoryContext = buildMemoryContext(memories);
    } catch (err) {
      console.error('[chat/route] memory retrieval error (continuing without context):', err);
    }
  }

  // 9. Stream response.
  const streamStart = Date.now();
  try {
    const result = streamText({
      model: getChatModel(),
      system: buildSystemPrompt(new Date().toISOString().split('T')[0] ?? '', memoryContext),
      messages: modelMessages,
      tools: buildTools({ userId }),
      stopWhen: stepCountIs(10),
      onFinish: async ({ text, usage, toolCalls }) => {
        try {
          const latencyMs = Date.now() - streamStart;
          if (text) {
            await insertChatMessage({
              sessionId: sessionId as ChatSessionId,
              role: 'assistant',
              content: { text },
              toolCalls: null,
            });
          }
          await touchChatSession(sessionId as ChatSessionId);
          await logLlmCall({
            userId,
            model: MODEL,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            latencyMs,
            toolCalls: toolCalls.length > 0 ? toolCalls.map((tc) => tc.toolName) : null,
          });

          // Fire-and-forget: enqueue auto-extraction job for memory proposals.
          // Collect the last few turns from the current request's UIMessage array.
          if (text) {
            const recentMessages: RecentMessage[] = uiMessages
              .flatMap((m): RecentMessage[] => {
                if (m.role !== 'user' && m.role !== 'assistant') return [];
                const part = m.parts.find((p) => (p as { type: string }).type === 'text');
                const msgText =
                  part != null ? (part as { type: 'text'; text: string }).text : '';
                if (!msgText) return [];
                return [{ role: m.role as 'user' | 'assistant', text: msgText }];
              })
              .concat([{ role: 'assistant', text }]);

            void inngest
              .send({
                name: 'memory/chat.extract',
                data: { userId, sessionId, recentMessages },
              })
              .catch((err: unknown) => {
                console.error('[chat/route] memory extraction enqueue error:', err);
              });
          }
        } catch (err) {
          // Log but do not abort the stream response — the user already
          // received the streamed text even if persistence fails.
          console.error('[chat/route] onFinish persistence error:', err);
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch {
    return NextResponse.json({ error: 'Failed to generate response' }, { status: 500 });
  }
}
