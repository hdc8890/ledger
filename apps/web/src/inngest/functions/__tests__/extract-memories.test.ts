import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockInsertMemoryProposal,
  mockHasRejectedProposalWithText,
  mockGenerateObject,
  mockLogLlmCall,
} = vi.hoisted(() => ({
  mockInsertMemoryProposal: vi.fn(),
  mockHasRejectedProposalWithText: vi.fn(),
  mockGenerateObject: vi.fn(),
  mockLogLlmCall: vi.fn(),
}));

vi.mock('@/db/queries/memories', () => ({
  insertMemoryProposal: mockInsertMemoryProposal,
  hasRejectedProposalWithText: mockHasRejectedProposalWithText,
}));

vi.mock('@/db/queries/llm-usage', () => ({
  logLlmCall: mockLogLlmCall,
}));

vi.mock('ai', () => ({
  generateObject: mockGenerateObject,
}));

vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn(() => 'mock-openai-model'),
}));

import {
  handleExtractMemories,
  type ExtractMemoriesContext,
} from '../extract-memories';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep() {
  return {
    run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
  };
}

function makeCtx(overrides?: {
  recentMessages?: Array<{ role: 'user' | 'assistant'; text: string }>;
  userId?: string;
  sessionId?: string;
}): ExtractMemoriesContext {
  return {
    event: {
      data: {
        userId: overrides?.userId ?? 'user-uuid',
        sessionId: overrides?.sessionId ?? 'session-uuid',
        recentMessages: overrides?.recentMessages ?? [
          { role: 'user', text: 'I always shop at Costco for groceries' },
          { role: 'assistant', text: 'Got it! Costco is great for grocery shopping.' },
        ],
      },
    },
    step: makeStep(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleExtractMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasRejectedProposalWithText.mockResolvedValue(false);
    mockInsertMemoryProposal.mockResolvedValue({ id: 'proposal-id' });
    mockLogLlmCall.mockResolvedValue(undefined);
  });

  it('returns zero proposed when no messages provided', async () => {
    const ctx = makeCtx({ recentMessages: [] });
    const result = await handleExtractMemories(ctx);
    expect(result.proposed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('inserts proposals returned by the LLM', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        proposals: [
          {
            text: 'User prefers Costco transactions to be categorised as Groceries',
            kind: 'household_rule',
            confidence: 0.9,
          },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const ctx = makeCtx();
    const result = await handleExtractMemories(ctx);

    expect(result.proposed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockInsertMemoryProposal).toHaveBeenCalledOnce();
    expect(mockInsertMemoryProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-uuid',
        proposedText: 'User prefers Costco transactions to be categorised as Groceries',
        proposedKind: 'household_rule',
        sourceSessionId: 'session-uuid',
      }),
    );
  });

  it('skips proposals that have already been rejected', async () => {
    mockHasRejectedProposalWithText.mockResolvedValue(true);
    mockGenerateObject.mockResolvedValue({
      object: {
        proposals: [
          {
            text: 'User prefers Costco as Groceries',
            kind: 'household_rule',
            confidence: 0.9,
          },
        ],
      },
      usage: { inputTokens: 80, outputTokens: 15 },
    });

    const ctx = makeCtx();
    const result = await handleExtractMemories(ctx);

    expect(result.proposed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockInsertMemoryProposal).not.toHaveBeenCalled();
  });

  it('handles an empty proposals array from the LLM gracefully', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { proposals: [] },
      usage: { inputTokens: 50, outputTokens: 5 },
    });

    const ctx = makeCtx();
    const result = await handleExtractMemories(ctx);

    expect(result.proposed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(mockInsertMemoryProposal).not.toHaveBeenCalled();
  });

  it('logs the LLM call after extraction', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { proposals: [] },
      usage: { inputTokens: 120, outputTokens: 30 },
    });

    const ctx = makeCtx();
    await handleExtractMemories(ctx);

    expect(mockLogLlmCall).toHaveBeenCalledOnce();
    expect(mockLogLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-uuid',
        model: 'gpt-4o-mini',
        inputTokens: 120,
        outputTokens: 30,
      }),
    );
  });

  it('trims conversation to the most recent 6 messages', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `message ${i}`,
    }));

    mockGenerateObject.mockResolvedValue({
      object: { proposals: [] },
      usage: { inputTokens: 80, outputTokens: 5 },
    });

    const ctx = makeCtx({ recentMessages: messages });
    await handleExtractMemories(ctx);

    // The prompt passed to generateObject should only contain the last 6 messages
    const callArgs = mockGenerateObject.mock.calls[0]?.[0] as { prompt: string };
    const promptLines = callArgs.prompt.split('\n').filter((l: string) => l.startsWith('User:') || l.startsWith('Assistant:'));
    expect(promptLines).toHaveLength(6);
  });

  it('handles multiple proposals correctly (proposed + skipped)', async () => {
    // First proposal: not previously rejected
    // Second proposal: previously rejected — should be skipped
    mockHasRejectedProposalWithText
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    mockGenerateObject.mockResolvedValue({
      object: {
        proposals: [
          { text: 'Proposal A', kind: 'preference', confidence: 0.8 },
          { text: 'Proposal B', kind: 'household_rule', confidence: 0.9 },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 25 },
    });

    const ctx = makeCtx();
    const result = await handleExtractMemories(ctx);

    expect(result.proposed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockInsertMemoryProposal).toHaveBeenCalledOnce();
  });
});
