import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { streamText, generateText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { findUserByClerkId } from '@/db/queries/users';
import {
  createChatSession,
  getChatSessionById,
  touchChatSession,
  updateChatSessionTitle,
} from '@/db/queries/chat-sessions';
import { insertChatMessage } from '@/db/queries/chat-messages';
import { insertLlmUsage, estimateCostUsd } from '@/db/queries/llm-usage';
import { buildTools } from '@/ai/tools/registry';
import type { ChatSessionId, UserId } from '@/shared/types';

const MODEL = 'claude-sonnet-4-5';
/** Cheap model used only for generating short session titles (fire-and-forget). */
const TITLE_MODEL = 'claude-haiku-4-5';

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

function buildSystemPrompt(currentDate: string): string {
  return `You are a personal AI financial assistant with access to the user's financial data.

Today's date: ${currentDate}

Guidelines:
- Never compute totals or balances yourself — always use the provided tools.
- Never invent or estimate a transaction that isn't in the data.
- Do not provide tax, legal, or investment advice.
- When stating a number, always cite the source (account name, date range, etc.).
- Be concise, accurate, and honest about what you do and don't know.
- Write tools (update_asset, tag_transaction, create_rule_draft) return proposals that the user must approve. Always present the proposal and explain what will change — never imply the change has already happened.

You have access to the user's accounts, transactions, assets, and liabilities.`;
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
      model: anthropic(TITLE_MODEL),
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

  // 4. Ensure session exists — create lazily on first message.
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

  // 5. Persist the last user message (the new turn sent by the client).
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

  // 6. Convert UIMessage[] → ModelMessage[] for streamText.
  const modelMessages = await convertToModelMessages(uiMessages);

  // 7. Stream response.
  const streamStart = Date.now();
  try {
    const result = streamText({
      model: anthropic(MODEL),
      system: buildSystemPrompt(new Date().toISOString().split('T')[0] ?? ''),
      messages: modelMessages,
      tools: buildTools({ userId }),
      stopWhen: stepCountIs(10),
      onFinish: async ({ text, usage }) => {
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
          await insertLlmUsage({
            userId,
            model: MODEL,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            latencyMs,
            toolCalls: null,
            estimatedCostUsd: estimateCostUsd(MODEL, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
          });
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
