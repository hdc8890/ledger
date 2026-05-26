/**
 * Transfer Detection Algorithm — Phase 4 Task 3
 *
 * Pairs debit transactions with credit transactions from different accounts
 * for the same user using purely heuristic criteria:
 *
 *   - Opposite signs (debit: amountCents > 0, credit: amountCents < 0)
 *   - |Δamount| < 1% relative to the debit amount
 *   - |Δdate| ≤ 3 calendar days
 *   - Different accountId values
 *
 * No LLM is involved. Results are deterministic and reproducible.
 * The caller is responsible for idempotency (only passing unprocessed rows).
 */

import type { TransactionId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransferCandidate = {
  readonly id: TransactionId;
  readonly accountId: string;
  /** Positive cents for a debit (money out), negative for a credit (money in). */
  readonly amountCents: bigint;
  /** ISO date string YYYY-MM-DD. */
  readonly postedAt: string;
};

export type TransferPair = {
  /** Debit leg (amountCents > 0). */
  readonly outTxnId: TransactionId;
  /** Credit leg (amountCents < 0). */
  readonly inTxnId: TransactionId;
  /** 0–1 pairing confidence. */
  readonly confidence: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum relative amount difference to consider a pair (1%). */
const MAX_AMOUNT_DELTA_RATIO = 0.01;

/** Maximum calendar day gap between the two legs of a transfer. */
const MAX_DATE_DELTA_DAYS = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an ISO date string to a UTC day offset (days since epoch). */
function toDayOffset(isoDate: string): number {
  return Math.floor(Date.parse(isoDate + 'T00:00:00Z') / 86_400_000);
}

/** Absolute difference between two bigint values, returned as a non-negative bigint. */
function absDiff(a: bigint, b: bigint): bigint {
  return a >= b ? a - b : b - a;
}

/**
 * Assign a confidence score based on how closely a debit/credit pair matches.
 * Higher scores for exact amounts and same-day posting.
 */
export function scorePair(
  debitCents: bigint,
  creditCents: bigint,
  dateDeltaDays: number,
): number {
  const amountDelta = absDiff(debitCents, -creditCents);
  const isExactAmount = amountDelta === 0n;
  const isSameDay = dateDeltaDays === 0;

  if (isExactAmount && isSameDay) return 0.99;
  if (isExactAmount) return 0.95;
  if (isSameDay) return 0.9;
  return 0.85;
}

// ---------------------------------------------------------------------------
// Core detection function
// ---------------------------------------------------------------------------

/**
 * Find all transfer pairs within the given transaction list.
 *
 * Algorithm:
 *   1. Split transactions into debits (amountCents > 0) and credits (< 0).
 *   2. For each debit, collect candidate credits that satisfy all criteria.
 *   3. Sort candidates by (amountDelta ASC, dateDelta ASC) and pick the best.
 *   4. Remove matched transactions from the pools to prevent double-matching.
 *
 * The function is pure — it has no side effects; the caller persists results.
 *
 * @param txns  Transactions to analyse. Should already be filtered to
 *              `isTransfer = false`, non-pending, non-deleted.
 */
export function detectTransferPairs(txns: readonly TransferCandidate[]): TransferPair[] {
  const debits = txns.filter((t) => t.amountCents > 0n);
  const credits = txns.filter((t) => t.amountCents < 0n);

  // Track which credit IDs have already been matched to avoid double-pairing.
  const matchedCreditIds = new Set<TransactionId>();
  const pairs: TransferPair[] = [];

  for (const debit of debits) {
    const debitDay = toDayOffset(debit.postedAt);

    // Collect and rank candidate credits.
    const candidates = credits
      .filter((c) => {
        if (c.accountId === debit.accountId) return false;
        if (matchedCreditIds.has(c.id)) return false;

        const creditAbs = -c.amountCents; // creditAbs > 0
        const amountDelta = absDiff(debit.amountCents, creditAbs);
        const ratio = Number(amountDelta) / Number(debit.amountCents);
        if (ratio >= MAX_AMOUNT_DELTA_RATIO) return false;

        const dateDelta = Math.abs(toDayOffset(c.postedAt) - debitDay);
        if (dateDelta > MAX_DATE_DELTA_DAYS) return false;

        return true;
      })
      .map((c) => {
        const creditAbs = -c.amountCents;
        const amountDelta = Number(absDiff(debit.amountCents, creditAbs));
        const dateDelta = Math.abs(toDayOffset(c.postedAt) - debitDay);
        return { credit: c, amountDelta, dateDelta };
      })
      // Best match: smallest amount delta first, then smallest date delta.
      .sort((a, b) =>
        a.amountDelta !== b.amountDelta
          ? a.amountDelta - b.amountDelta
          : a.dateDelta - b.dateDelta,
      );

    const best = candidates[0];
    if (best === undefined) continue;

    matchedCreditIds.add(best.credit.id);
    pairs.push({
      outTxnId: debit.id,
      inTxnId: best.credit.id,
      confidence: scorePair(debit.amountCents, best.credit.amountCents, best.dateDelta),
    });
  }

  return pairs;
}
