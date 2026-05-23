'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePlaidLink, type PlaidLinkOnSuccess } from 'react-plaid-link';

interface PlaidLinkButtonProps {
  /** Called after a successful token exchange. */
  onConnected?: (itemId: string) => void;
}

/**
 * PlaidLinkButton
 *
 * Fetches a Plaid link token on mount, then opens the Plaid Link widget
 * when the user clicks the button. On success it exchanges the public token
 * via POST /api/plaid/exchange and calls onConnected with the new item ID.
 */
export function PlaidLinkButton({ onConnected }: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch link token eagerly so the Link dialog opens instantly on click.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/plaid/create-link-token', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to initialise Plaid Link');
        const data = (await res.json()) as { link_token: string };
        setLinkToken(data.link_token);
      } catch {
        setError('Unable to initialise bank connection. Please try again.');
      }
    })();
  }, []);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken, metadata) => {
      setConnecting(true);
      setError(null);
      try {
        const res = await fetch('/api/plaid/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publicToken,
            institutionId: metadata.institution?.institution_id ?? '',
            institutionName: metadata.institution?.name ?? '',
          }),
        });
        if (!res.ok) throw new Error('Token exchange failed');
        const data = (await res.json()) as { itemId: string };
        onConnected?.(data.itemId);
      } catch {
        setError('Failed to connect institution. Please try again.');
      } finally {
        setConnecting(false);
      }
    },
    [onConnected],
  );

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={() => open()}
        disabled={!ready || connecting}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {connecting ? 'Connecting…' : 'Connect Bank Account'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
