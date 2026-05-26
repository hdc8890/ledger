import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks set up with vi.hoisted so they are ready before vi.mock factories.
// ---------------------------------------------------------------------------
const {
  mockAuth, mockFindUser, mockGetSession, mockCreateSession, mockInsertMessage,
  mockTouchSession, mockStreamText, mockConvertMessages, mockLogLlmCall,
  mockUpdateTitle, mockGenerateText, mockCheckRateLimit, mockRetrieveMemories,
} = vi.hoisted(() => {
  const mockAuth = vi.fn();
  const mockFindUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockCreateSession = vi.fn();
  const mockInsertMessage = vi.fn();
  const mockTouchSession = vi.fn();
  const mockStreamText = vi.fn();
  const mockConvertMessages = vi.fn();
  const mockLogLlmCall = vi.fn();
  const mockUpdateTitle = vi.fn();
  const mockGenerateText = vi.fn();
  const mockCheckRateLimit = vi.fn();
  const mockRetrieveMemories = vi.fn();
  return {
    mockAuth, mockFindUser, mockGetSession, mockCreateSession,
    mockInsertMessage, mockTouchSession, mockStreamText, mockConvertMessages,
    mockLogLlmCall, mockUpdateTitle, mockGenerateText, mockCheckRateLimit,
    mockRetrieveMemories,
  };
});

vi.mock('@clerk/nextjs/server', () => ({ auth: mockAuth }));
vi.mock('@/db/queries/users', () => ({ findUserByClerkId: mockFindUser }));
vi.mock('@/db/queries/chat-sessions', () => ({
  getChatSessionById: mockGetSession,
  createChatSession: mockCreateSession,
  touchChatSession: mockTouchSession,
  updateChatSessionTitle: mockUpdateTitle,
}));
vi.mock('@/db/queries/chat-messages', () => ({ insertChatMessage: mockInsertMessage }));
vi.mock('@/db/queries/llm-usage', () => ({
  logLlmCall: mockLogLlmCall,
}));
vi.mock('@/db/queries/rate-limits', () => ({
  checkAndConsumeRateLimit: mockCheckRateLimit,
}));
vi.mock('@/ai/tools/registry', () => ({ buildTools: vi.fn(() => ({})) }));
vi.mock('@/ai/memory', () => ({
  retrieveMemories: mockRetrieveMemories,
}));
vi.mock('ai', () => ({
  streamText: mockStreamText,
  generateText: mockGenerateText,
  convertToModelMessages: mockConvertMessages,
  stepCountIs: vi.fn(),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn(() => 'mock-model'),
}));

import { POST, buildMemoryContext } from '../route';
import type { MemoryRow } from '@/db/queries/memories';

const USER = { id: 'user-uuid', clerkId: 'clerk_abc' };
const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
const SESSION = { id: SESSION_ID, userId: 'user-uuid', title: null, createdAt: new Date(), updatedAt: new Date() };

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConvertMessages.mockResolvedValue([]);
    mockLogLlmCall.mockResolvedValue({});
    // Default: rate limit allows the request.
    mockCheckRateLimit.mockResolvedValue({ allowed: true, tokensRemaining: 49 });
    // Default: generateText returns a valid response so fire-and-forget title
    // generation doesn't produce uncaught destructuring errors in unrelated tests.
    mockGenerateText.mockResolvedValue({ text: 'Test Title' });
    // Default: no memories — avoids memory injection in unrelated tests.
    mockRetrieveMemories.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(401);
  });

  it('returns 400 when body is missing id', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);

    const res = await POST(makeRequest({ messages: [] }));

    expect(res.status).toBe(400);
  });

  it('returns 400 when body id is not a UUID', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);

    const res = await POST(makeRequest({ id: 'not-a-uuid', messages: [] }));

    expect(res.status).toBe(400);
  });

  it('returns 404 when user is not in DB', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(undefined);

    const res = await POST(makeRequest({ id: crypto.randomUUID(), messages: [] }));

    expect(res.status).toBe(404);
  });

  it('creates a new session if one does not exist', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockGetSession.mockResolvedValue(undefined);
    mockCreateSession.mockResolvedValue(SESSION);
    mockInsertMessage.mockResolvedValue({});
    const mockResponse = new Response('stream', { status: 200 });
    mockStreamText.mockReturnValue({ toUIMessageStreamResponse: () => mockResponse });

    await POST(makeRequest({
      id: SESSION_ID,
      messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
    }));

    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ id: SESSION_ID }));
  });

  it('returns 403 when session belongs to a different user', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockGetSession.mockResolvedValue({ ...SESSION, userId: 'other-user-uuid' });

    const res = await POST(makeRequest({
      id: SESSION_ID,
      messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    }));

    expect(res.status).toBe(403);
  });

  it('calls streamText and returns the streaming response', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockGetSession.mockResolvedValue(SESSION);
    mockInsertMessage.mockResolvedValue({});
    const mockResponse = new Response('stream', { status: 200 });
    mockStreamText.mockReturnValue({ toUIMessageStreamResponse: () => mockResponse });

    const res = await POST(makeRequest({
      id: SESSION_ID,
      messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'What is my balance?' }] }],
    }));

    expect(mockStreamText).toHaveBeenCalledOnce();
    expect(mockStreamText).toHaveBeenCalledWith(expect.objectContaining({
      model: 'mock-model',
    }));
    expect(res.status).toBe(200);
  });

  it('triggers title generation on first user message when session has no title', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockGetSession.mockResolvedValue(SESSION); // title: null
    mockInsertMessage.mockResolvedValue({});
    mockGenerateText.mockResolvedValue({ text: 'My Spending Question' });
    const mockResponse = new Response('stream', { status: 200 });
    mockStreamText.mockReturnValue({ toUIMessageStreamResponse: () => mockResponse });

    await POST(makeRequest({
      id: SESSION_ID,
      messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'How much did I spend?' }] }],
    }));

    // Give the fire-and-forget a tick to run.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockGenerateText).toHaveBeenCalledOnce();
    expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
      model: 'mock-model',
    }));
    expect(mockUpdateTitle).toHaveBeenCalledWith(SESSION_ID, 'My Spending Question');
  });

  it('does not trigger title generation on follow-up messages', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockGetSession.mockResolvedValue(SESSION);
    mockInsertMessage.mockResolvedValue({});
    const mockResponse = new Response('stream', { status: 200 });
    mockStreamText.mockReturnValue({ toUIMessageStreamResponse: () => mockResponse });

    // Two user messages → not the first message
    await POST(makeRequest({
      id: SESSION_ID,
      messages: [
        { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'First question' }] },
        { id: 'msg-2', role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] },
        { id: 'msg-3', role: 'user', parts: [{ type: 'text', text: 'Follow-up' }] },
      ],
    }));

    await new Promise((r) => setTimeout(r, 0));

    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('does not trigger title generation when session already has a title', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockGetSession.mockResolvedValue({ ...SESSION, title: 'Existing Title' });
    mockInsertMessage.mockResolvedValue({});
    const mockResponse = new Response('stream', { status: 200 });
    mockStreamText.mockReturnValue({ toUIMessageStreamResponse: () => mockResponse });

    await POST(makeRequest({
      id: SESSION_ID,
      messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    }));

    await new Promise((r) => setTimeout(r, 0));

    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('logs tool call names to logLlmCall when tools were invoked', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockGetSession.mockResolvedValue(SESSION);
    mockInsertMessage.mockResolvedValue({});

    // Simulate streamText invoking onFinish with tool calls.
    mockStreamText.mockImplementation(
      ({ onFinish }: { onFinish?: (r: Record<string, unknown>) => Promise<void> }) => {
        void onFinish?.({
          text: 'Here are your accounts.',
          usage: { inputTokens: 500, outputTokens: 100 },
          toolCalls: [
            { toolName: 'get_accounts', toolCallId: 'tc-1', args: {} },
            { toolName: 'calculate_networth', toolCallId: 'tc-2', args: {} },
          ],
        });
        return { toUIMessageStreamResponse: () => new Response('stream', { status: 200 }) };
      },
    );

    await POST(makeRequest({
      id: SESSION_ID,
      messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'What are my accounts?' }] }],
    }));
    // Give fire-and-forget a tick to settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockLogLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCalls: ['get_accounts', 'calculate_networth'],
      }),
    );
  });

  it('passes toolCalls: null to logLlmCall when no tools were invoked', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockGetSession.mockResolvedValue(SESSION);
    mockInsertMessage.mockResolvedValue({});

    mockStreamText.mockImplementation(
      ({ onFinish }: { onFinish?: (r: Record<string, unknown>) => Promise<void> }) => {
        void onFinish?.({
          text: 'Hello!',
          usage: { inputTokens: 100, outputTokens: 20 },
          toolCalls: [],
        });
        return { toUIMessageStreamResponse: () => new Response('stream', { status: 200 }) };
      },
    );

    await POST(makeRequest({
      id: SESSION_ID,
      messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
    }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockLogLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ toolCalls: null }),
    );
  });

  it('returns 429 with friendly message when rate limit is exhausted', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 3600 });

    const res = await POST(makeRequest({
      id: SESSION_ID,
      messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    }));

    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; retryAfterSeconds: number };
    expect(body.error).toBe('Too many requests');
    expect(body.retryAfterSeconds).toBe(3600);
    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it('injects Relevant Context into the system prompt when memories exist', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockGetSession.mockResolvedValue(SESSION);
    mockInsertMessage.mockResolvedValue({});
    mockRetrieveMemories.mockResolvedValue([
      {
        id: 'mem-1',
        userId: 'user-uuid',
        kind: 'preference',
        text: 'Costco should be Groceries',
        embedding: null,
        metadata: null,
        confidence: 1.0,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies MemoryRow,
    ]);
    const mockResponse = new Response('stream', { status: 200 });
    mockStreamText.mockReturnValue({ toUIMessageStreamResponse: () => mockResponse });

    await POST(makeRequest({
      id: SESSION_ID,
      messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'What did I spend on groceries?' }] }],
    }));

    expect(mockStreamText).toHaveBeenCalledOnce();
    const callArg = mockStreamText.mock.calls[0]?.[0] as { system?: string };
    expect(callArg.system).toContain('### Relevant Context');
    expect(callArg.system).toContain('Costco should be Groceries');
  });

  it('does not inject Relevant Context when no memories are returned', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockGetSession.mockResolvedValue(SESSION);
    mockInsertMessage.mockResolvedValue({});
    mockRetrieveMemories.mockResolvedValue([]); // no memories
    const mockResponse = new Response('stream', { status: 200 });
    mockStreamText.mockReturnValue({ toUIMessageStreamResponse: () => mockResponse });

    await POST(makeRequest({
      id: SESSION_ID,
      messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    }));

    const callArg = mockStreamText.mock.calls[0]?.[0] as { system?: string };
    expect(callArg.system).not.toContain('### Relevant Context');
  });

  it('succeeds without memory context when retrieveMemories throws', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(USER);
    mockGetSession.mockResolvedValue(SESSION);
    mockInsertMessage.mockResolvedValue({});
    mockRetrieveMemories.mockRejectedValueOnce(new Error('OpenAI embedding API down'));
    const mockResponse = new Response('stream', { status: 200 });
    mockStreamText.mockReturnValue({ toUIMessageStreamResponse: () => mockResponse });

    const res = await POST(makeRequest({
      id: SESSION_ID,
      messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    }));

    // Chat must succeed even if memory retrieval fails.
    expect(res.status).toBe(200);
    expect(mockStreamText).toHaveBeenCalledOnce();
    const callArg = mockStreamText.mock.calls[0]?.[0] as { system?: string };
    expect(callArg.system).not.toContain('### Relevant Context');
  });
});

// ---------------------------------------------------------------------------
// buildMemoryContext unit tests
// ---------------------------------------------------------------------------
describe('buildMemoryContext', () => {
  function makeMemory(overrides: Partial<MemoryRow> = {}): MemoryRow {
    return {
      id: 'mem-1',
      userId: 'user-uuid',
      kind: 'preference',
      text: 'Costco should be Groceries',
      embedding: null,
      metadata: null,
      confidence: 1.0,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('returns empty string for an empty list', () => {
    expect(buildMemoryContext([])).toBe('');
  });

  it('includes ### Relevant Context heading and memory text', () => {
    const result = buildMemoryContext([makeMemory()]);
    expect(result).toContain('### Relevant Context');
    expect(result).toContain('Costco should be Groceries');
    expect(result).toContain('[preference]');
  });

  it('includes the kind label for each memory', () => {
    const result = buildMemoryContext([
      makeMemory({ kind: 'household_rule', text: 'Rent is always fixed' }),
    ]);
    expect(result).toContain('[household_rule]');
    expect(result).toContain('Rent is always fixed');
  });

  it('truncates memory text longer than 250 characters', () => {
    const longText = 'A'.repeat(300);
    const result = buildMemoryContext([makeMemory({ text: longText })]);
    expect(result).toContain('A'.repeat(250) + '…');
    expect(result).not.toContain('A'.repeat(251) + 'A');
  });

  it('respects the ~3200 character cap by stopping early', () => {
    // Each line is ~270 chars (kind label ~15 + text 250 + "… " ≈ 270).
    // Fill with enough memories to exceed the cap.
    const memories = Array.from({ length: 15 }, (_, i) =>
      makeMemory({ id: `mem-${i}`, text: 'B'.repeat(250) }),
    );
    const result = buildMemoryContext(memories);
    expect(result.length).toBeLessThanOrEqual(3400); // cap + small header overhead
    // Not all 15 should appear if we hit the cap.
    const lineCount = (result.match(/^- \[/gm) ?? []).length;
    expect(lineCount).toBeLessThan(15);
  });

  it('includes citation instruction', () => {
    const result = buildMemoryContext([makeMemory()]);
    expect(result).toContain('Based on your preference');
  });
});
