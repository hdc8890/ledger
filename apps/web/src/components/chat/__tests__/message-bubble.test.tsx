import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from '../message-bubble';
import type { UIMessage } from 'ai';

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

  it('renders nothing when message has no text parts', () => {
    const message: UIMessage = {
      id: 'msg-1',
      role: 'user',
      parts: [],
    } as UIMessage;

    const { container } = render(<MessageBubble message={message} />);
    expect(container.firstChild).toBeNull();
  });
});
