import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from '../message-bubble';
import type { UIMessage } from 'ai';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../proposal-card', () => ({
  ProposalCard: ({ toolName }: { toolName: string }) => (
    <div data-testid="proposal-card" data-tool={toolName} />
  ),
}));

function makeMessage(role: UIMessage['role'], text: string): UIMessage {
  return {
    id: 'msg-1',
    role,
    parts: [{ type: 'text', text }],
  } as UIMessage;
}

describe('MessageBubble', () => {
  it('renders a user message with correct aria label', () => {
    render(<MessageBubble message={makeMessage('user', 'Hello there')} />);

    const bubble = screen.getByRole('article', { name: /your message/i });
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveTextContent('Hello there');
  });

  it('renders an assistant message with correct aria label', () => {
    render(<MessageBubble message={makeMessage('assistant', 'I can help with that')} />);

    const bubble = screen.getByRole('article', { name: /assistant message/i });
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveTextContent('I can help with that');
  });

  it('applies indigo background for user messages', () => {
    render(<MessageBubble message={makeMessage('user', 'Test')} />);

    const bubble = screen.getByRole('article');
    expect(bubble.className).toContain('bg-indigo-600');
  });

  it('applies neutral background for assistant messages', () => {
    render(<MessageBubble message={makeMessage('assistant', 'Test')} />);

    const bubble = screen.getByRole('article');
    expect(bubble.className).toContain('bg-neutral-100');
  });

  it('renders nothing when message has no text parts and no proposal parts', () => {
    const message: UIMessage = {
      id: 'msg-1',
      role: 'user',
      parts: [],
    } as UIMessage;

    const { container } = render(<MessageBubble message={message} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a ProposalCard for a completed write-tool invocation', () => {
    const message: UIMessage = {
      id: 'msg-2',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'I propose this change:' },
        {
          // AI SDK v6: dynamic tool parts use type='dynamic-tool', flat shape, state='output-available'
          type: 'dynamic-tool',
          toolCallId: 'call-1',
          toolName: 'update_asset',
          state: 'output-available',
          input: {},
          output: { proposalId: 'p-1', description: 'test', assetId: 'a-1', assetName: 'Car', changes: {} },
        },
      ],
    } as unknown as UIMessage;

    render(<MessageBubble message={message} />);

    expect(screen.getByTestId('proposal-card')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-card').dataset['tool']).toBe('update_asset');
    expect(screen.getByRole('article')).toHaveTextContent('I propose this change:');
  });

  it('does not render a ProposalCard for a read tool invocation', () => {
    const message: UIMessage = {
      id: 'msg-3',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'call-2',
          toolName: 'get_accounts',
          state: 'output-available',
          input: {},
          output: { accounts: [] },
        },
      ],
    } as unknown as UIMessage;

    const { container } = render(<MessageBubble message={message} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('proposal-card')).not.toBeInTheDocument();
  });

  it('does not render a ProposalCard for a tool invocation in pending (input-available) state', () => {
    const message: UIMessage = {
      id: 'msg-4',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'call-3',
          toolName: 'update_asset',
          state: 'input-available',
          input: {},
        },
      ],
    } as unknown as UIMessage;

    const { container } = render(<MessageBubble message={message} />);
    expect(container.firstChild).toBeNull();
  });
});
