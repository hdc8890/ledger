import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks set up with vi.hoisted so they are ready before vi.mock factories.
// ---------------------------------------------------------------------------
const {
  mockAuth, mockFindUser, mockGetSession, mockCreateSession, mockInsertMessage,
  mockTouchSession, mockStreamText, mockConvertMessages, mockInsertLlmUsage,
  mockUpdateTitle, mockGenerateText,
} = vi.hoisted(() => {
  const mockAuth = vi.fn();
  const mockFindUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockCreateSession = vi.fn();
  const mockInsertMessage = vi.fn();
  const mockTouchSession = vi.fn();
  const mockStreamText = vi.fn();
  const mockConvertMessages = vi.fn();
  const mockInsertLlmUsage = vi.fn();
  const mockUpdateTitle = vi.fn();
  const mockGenerateText = vi.fn();
  return {
    mockAuth, mockFindUser, mockGetSession, mockCreateSession,
    mockInsertMessage, mockTouchSession, mockStreamText, mockConvertMessages,
    mockInsertLlmUsage, mockUpdateTitle, mockGenerateText,
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
  insertLlmUsage: mockInsertLlmUsage,
  estimateCostUsd: vi.fn(() => '0.000010'),
}));
vi.mock('@/ai/tools/registry', () => ({ buildTools: vi.fn(() => ({})) }));
vi.mock('ai', () => ({
  streamText: mockStreamText,
  generateText: mockGenerateText,
  convertToModelMessages: mockConvertMessages,
  stepCountIs: vi.fn(),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn(() => 'mock-model'),
}));

import { POST } from '../route';

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
    mockInsertLlmUsage.mockResolvedValue({});
    // Default: generateText returns a valid response so fire-and-forget title
    // generation doesn't produce uncaught destructuring errors in unrelated tests.
    mockGenerateText.mockResolvedValue({ text: 'Test Title' });
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
});
