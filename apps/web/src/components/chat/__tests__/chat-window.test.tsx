import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatWindow } from '../chat-window';
import type { UIMessage } from 'ai';

// jsdom doesn't implement scrollIntoView; stub it to avoid unhandled errors.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// ---------------------------------------------------------------------------
// Mocks — mockUseChat MUST be initialized via vi.hoisted so it is ready
// before vi.mock() factories run (vi.mock is hoisted to top of file).
// ---------------------------------------------------------------------------
const { mockUseChat } = vi.hoisted(() => ({
  mockUseChat: vi.fn(),
}));

vi.mock('@ai-sdk/react', () => ({
  useChat: mockUseChat,
}));

vi.mock('../chat-input', () => ({
  ChatInput: ({ disabled }: { disabled: boolean }) => (
    <div data-testid="chat-input" data-disabled={String(disabled)} />
  ),
}));

vi.mock('../message-bubble', () => ({
  MessageBubble: ({ message }: { message: UIMessage }) => (
    <div data-testid="message-bubble" data-role={message.role}>
      {(message.parts as Array<{ type: string; text?: string }>)
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('')}
    </div>
  ),
}));

function makeUIMessage(id: string, role: 'user' | 'assistant', text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', text }],
  } as UIMessage;
}

describe('ChatWindow', () => {
  it('renders the empty-state prompt when there are no messages', () => {
    mockUseChat.mockReturnValue({
      messages: [],
      status: 'ready',
      sendMessage: vi.fn(),
      error: null,
    });

    render(<ChatWindow sessionId="sess-1" />);

    expect(screen.getByText('Start a conversation')).toBeInTheDocument();
    expect(screen.queryByTestId('message-bubble')).not.toBeInTheDocument();
  });

  it('renders initialMessages passed as props', () => {
    const initial: UIMessage[] = [
      makeUIMessage('m1', 'user', 'How much did I spend?'),
      makeUIMessage('m2', 'assistant', 'You spent $500.'),
    ];

    mockUseChat.mockReturnValue({
      messages: initial,
      status: 'ready',
      sendMessage: vi.fn(),
      error: null,
    });

    render(<ChatWindow sessionId="sess-1" initialMessages={initial} />);

    const bubbles = screen.getAllByTestId('message-bubble');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toHaveTextContent('How much did I spend?');
    expect(bubbles[1]).toHaveTextContent('You spent $500.');
  });

  it('forwards initialMessages to useChat', () => {
    const initial: UIMessage[] = [makeUIMessage('m1', 'user', 'Hello')];

    mockUseChat.mockReturnValue({
      messages: initial,
      status: 'ready',
      sendMessage: vi.fn(),
      error: null,
    });

    render(<ChatWindow sessionId="sess-42" initialMessages={initial} />);

    expect(mockUseChat).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sess-42',
        messages: initial,
      }),
    );
  });

  it('does not pass initialMessages to useChat when prop is undefined', () => {
    mockUseChat.mockReturnValue({
      messages: [],
      status: 'ready',
      sendMessage: vi.fn(),
      error: null,
    });

    render(<ChatWindow sessionId="sess-99" />);

    expect(mockUseChat).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess-99' }),
    );
    const call = mockUseChat.mock.calls[0] as [Record<string, unknown>];
    expect(call[0]['messages']).toBeUndefined();
  });

  it('renders an error banner when useChat returns an error', () => {
    mockUseChat.mockReturnValue({
      messages: [],
      status: 'error',
      sendMessage: vi.fn(),
      error: new Error('Something went wrong'),
    });

    render(<ChatWindow sessionId="sess-err" />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
