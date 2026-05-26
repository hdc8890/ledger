import { describe, it, expect } from 'vitest';
import { detectTransferPairs, scorePair } from '../detect-transfers';
import type { TransferCandidate } from '../detect-transfers';
import type { TransactionId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTxn(
  id: string,
  accountId: string,
  amountCents: bigint,
  postedAt: string,
): TransferCandidate {
  return { id: id as TransactionId, accountId, amountCents, postedAt };
}

// ---------------------------------------------------------------------------
// scorePair
// ---------------------------------------------------------------------------

describe('scorePair', () => {
  it('returns 0.99 for exact amount same day', () => {
    expect(scorePair(10000n, -10000n, 0)).toBe(0.99);
  });

  it('returns 0.95 for exact amount different day', () => {
    expect(scorePair(10000n, -10000n, 2)).toBe(0.95);
  });

  it('returns 0.90 for delta amount same day', () => {
    expect(scorePair(10000n, -9950n, 0)).toBe(0.9);
  });

  it('returns 0.85 for delta amount different day', () => {
    expect(scorePair(10000n, -9950n, 3)).toBe(0.85);
  });
});

// ---------------------------------------------------------------------------
// detectTransferPairs
// ---------------------------------------------------------------------------

describe('detectTransferPairs', () => {
  it('returns empty array when no transactions', () => {
    expect(detectTransferPairs([])).toEqual([]);
  });

  it('returns empty array when only debits', () => {
    const txns = [makeTxn('d1', 'acct-A', 5000n, '2024-01-10')];
    expect(detectTransferPairs(txns)).toEqual([]);
  });

  it('returns empty array when only credits', () => {
    const txns = [makeTxn('c1', 'acct-B', -5000n, '2024-01-10')];
    expect(detectTransferPairs(txns)).toEqual([]);
  });

  it('pairs exact-amount transactions on the same day from different accounts', () => {
    const txns = [
      makeTxn('out', 'acct-A', 10000n, '2024-01-15'),
      makeTxn('in', 'acct-B', -10000n, '2024-01-15'),
    ];
    const pairs = detectTransferPairs(txns);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      outTxnId: 'out',
      inTxnId: 'in',
      confidence: 0.99,
    });
  });

  it('pairs transactions within 1% amount tolerance', () => {
    // 10000 vs 9950 → delta = 50/10000 = 0.5% < 1%
    const txns = [
      makeTxn('out', 'acct-A', 10000n, '2024-01-15'),
      makeTxn('in', 'acct-B', -9950n, '2024-01-15'),
    ];
    const pairs = detectTransferPairs(txns);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ outTxnId: 'out', inTxnId: 'in', confidence: 0.9 });
  });

  it('does not pair transactions exceeding 1% amount tolerance', () => {
    // 10000 vs 9899 → delta = 101/10000 = 1.01% > 1%
    const txns = [
      makeTxn('out', 'acct-A', 10000n, '2024-01-15'),
      makeTxn('in', 'acct-B', -9899n, '2024-01-15'),
    ];
    expect(detectTransferPairs(txns)).toHaveLength(0);
  });

  it('pairs transactions up to 3 days apart', () => {
    const txns = [
      makeTxn('out', 'acct-A', 50000n, '2024-01-15'),
      makeTxn('in', 'acct-B', -50000n, '2024-01-18'), // 3 days later
    ];
    const pairs = detectTransferPairs(txns);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ confidence: 0.95 });
  });

  it('does not pair transactions more than 3 days apart', () => {
    const txns = [
      makeTxn('out', 'acct-A', 50000n, '2024-01-15'),
      makeTxn('in', 'acct-B', -50000n, '2024-01-19'), // 4 days later
    ];
    expect(detectTransferPairs(txns)).toHaveLength(0);
  });

  it('does not pair transactions from the same account', () => {
    const txns = [
      makeTxn('out', 'acct-A', 10000n, '2024-01-15'),
      makeTxn('in', 'acct-A', -10000n, '2024-01-15'), // same account
    ];
    expect(detectTransferPairs(txns)).toHaveLength(0);
  });

  it('does not double-match: one credit matched to at most one debit', () => {
    // Two debits of the same amount with the same credit.
    const txns = [
      makeTxn('out1', 'acct-A', 10000n, '2024-01-15'),
      makeTxn('out2', 'acct-A', 10000n, '2024-01-15'),
      makeTxn('in', 'acct-B', -10000n, '2024-01-15'),
    ];
    const pairs = detectTransferPairs(txns);
    // Only one pair — the credit can only be claimed by one debit.
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.inTxnId).toBe('in');
  });

  it('does not double-match: one debit matched to at most one credit', () => {
    // One debit, two identical credits.
    const txns = [
      makeTxn('out', 'acct-A', 10000n, '2024-01-15'),
      makeTxn('in1', 'acct-B', -10000n, '2024-01-15'),
      makeTxn('in2', 'acct-C', -10000n, '2024-01-15'),
    ];
    const pairs = detectTransferPairs(txns);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.outTxnId).toBe('out');
  });

  it('prefers exact amount match over near match', () => {
    // One credit matches exactly, one is within tolerance.
    const txns = [
      makeTxn('out', 'acct-A', 10000n, '2024-01-15'),
      makeTxn('in-near', 'acct-B', -9950n, '2024-01-15'), // within 1%
      makeTxn('in-exact', 'acct-C', -10000n, '2024-01-15'), // exact
    ];
    const pairs = detectTransferPairs(txns);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.inTxnId).toBe('in-exact');
  });

  it('prefers closer date when amounts are equal', () => {
    const txns = [
      makeTxn('out', 'acct-A', 10000n, '2024-01-15'),
      makeTxn('in-far', 'acct-B', -10000n, '2024-01-18'), // 3 days
      makeTxn('in-close', 'acct-C', -10000n, '2024-01-16'), // 1 day
    ];
    const pairs = detectTransferPairs(txns);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.inTxnId).toBe('in-close');
  });

  it('finds multiple independent pairs in one call', () => {
    const txns = [
      makeTxn('out1', 'acct-A', 10000n, '2024-01-15'),
      makeTxn('in1', 'acct-B', -10000n, '2024-01-15'),
      makeTxn('out2', 'acct-C', 25000n, '2024-01-20'),
      makeTxn('in2', 'acct-D', -25000n, '2024-01-20'),
    ];
    const pairs = detectTransferPairs(txns);
    expect(pairs).toHaveLength(2);
    const outIds = pairs.map((p) => p.outTxnId).sort();
    expect(outIds).toEqual(['out1', 'out2'].sort());
  });
});
