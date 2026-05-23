import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PlaidLinkOnSuccess } from 'react-plaid-link';

const { mockOpen, capturedHandlers } = vi.hoisted(() => ({
  mockOpen: vi.fn(),
  capturedHandlers: { onSuccess: null as PlaidLinkOnSuccess | null },
}));

vi.mock('react-plaid-link', () => ({
  usePlaidLink: (opts: { token: string | null; onSuccess: PlaidLinkOnSuccess }) => {
    capturedHandlers.onSuccess = opts.onSuccess;
    return { open: mockOpen, ready: opts.token !== null };
  },
}));

import { PlaidLinkButton } from '../plaid-link-button';

const originalFetch = globalThis.fetch;

function mockFetch(map: Record<string, () => Response | Promise<Response>>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = map[url];
    if (!handler) throw new Error(`Unmocked fetch: ${url}`);
    return handler();
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('PlaidLinkButton', () => {
  beforeEach(() => {
    mockOpen.mockReset();
    capturedHandlers.onSuccess = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches a link token on mount and enables the button', async () => {
    mockFetch({
      '/api/plaid/create-link-token': () => jsonResponse({ link_token: 'tok-123' }),
    });

    render(<PlaidLinkButton />);

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /connect bank account/i });
      expect(button).not.toBeDisabled();
    });
  });

  it('shows an error message when the link token request fails', async () => {
    mockFetch({
      '/api/plaid/create-link-token': () =>
        jsonResponse({ error: 'nope' }, { status: 500 }),
    });

    render(<PlaidLinkButton />);

    await waitFor(() => {
      expect(
        screen.getByText(/unable to initialise bank connection/i),
      ).toBeInTheDocument();
    });
  });

  it('opens Plaid Link when the button is clicked', async () => {
    mockFetch({
      '/api/plaid/create-link-token': () => jsonResponse({ link_token: 'tok-123' }),
    });

    render(<PlaidLinkButton />);
    const button = await screen.findByRole('button', { name: /connect bank account/i });
    await waitFor(() => expect(button).not.toBeDisabled());

    fireEvent.click(button);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('exchanges the public token and invokes onConnected on success', async () => {
    mockFetch({
      '/api/plaid/create-link-token': () => jsonResponse({ link_token: 'tok-123' }),
      '/api/plaid/exchange': () => jsonResponse({ itemId: 'item-xyz' }),
    });

    const onConnected = vi.fn();
    render(<PlaidLinkButton onConnected={onConnected} />);

    await waitFor(() => expect(capturedHandlers.onSuccess).not.toBeNull());

    await act(async () => {
      await capturedHandlers.onSuccess!('public-token-abc', {
        institution: { institution_id: 'ins_1', name: 'Test Bank' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    });

    expect(onConnected).toHaveBeenCalledWith('item-xyz');
  });

  it('shows an error and does not call onConnected when exchange fails', async () => {
    mockFetch({
      '/api/plaid/create-link-token': () => jsonResponse({ link_token: 'tok-123' }),
      '/api/plaid/exchange': () => jsonResponse({ error: 'bad' }, { status: 500 }),
    });

    const onConnected = vi.fn();
    render(<PlaidLinkButton onConnected={onConnected} />);

    await waitFor(() => expect(capturedHandlers.onSuccess).not.toBeNull());

    await act(async () => {
      await capturedHandlers.onSuccess!('public-token-abc', {
        institution: { institution_id: 'ins_1', name: 'Test Bank' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    });

    expect(onConnected).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/failed to connect institution/i)).toBeInTheDocument();
    });
  });
});
