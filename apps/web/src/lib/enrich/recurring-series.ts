/**
 * Recurring Bill Detection Algorithm — Phase 4 Task 4
 *
 * Detects recurring payment series (subscriptions, utilities, bills) from
 * enriched transaction history using purely heuristic clustering:
 *
 *   1. Group by merchant_normalized.
 *   2. Within each merchant group, find the amount-band median (±10%).
 *   3. Examine posting-date intervals between consecutive transactions.
 *   4. If ≥ 50% of intervals fall within ±30% of a known cadence, the series
 *      is detected with that cadence.
 *   5. Confidence scales with occurrence count and interval consistency.
 *
 * No LLM is involved. Results are deterministic and reproducible.
 * The caller is responsible for pre-filtering (non-transfer, non-pending,
 * non-deleted, merchant_normalized IS NOT NULL).
 */

import type { RecurringSeriesId, UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecurringCandidate = {
  readonly merchantNormalized: string;
  /** Positive cents (debit / money out). Transfers and credits excluded by caller. */
  readonly amountCents: bigint;
  /** ISO date string YYYY-MM-DD. */
  readonly postedAt: string;
};

export type RecurringCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';

export type DetectedSeries = {
  readonly id?: RecurringSeriesId;
  readonly userId: UserId;
  readonly merchantNormalized: string;
  readonly cadence: RecurringCadence;
  readonly expectedAmountCents: bigint;
  readonly amountTolerancePct: number;
  readonly nextExpectedAt: string | null;
  readonly lastSeenAt: string;
  readonly confidence: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cadence definitions: name → typical interval in days. */
const CADENCES: ReadonlyArray<{ cadence: RecurringCadence; days: number }> = [
  { cadence: 'weekly', days: 7 },
  { cadence: 'biweekly', days: 14 },
  { cadence: 'monthly', days: 30 },
  { cadence: 'quarterly', days: 91 },
  { cadence: 'annual', days: 365 },
];

/** An interval is considered a match for a cadence if it falls within ±30% of the cadence days. */
const CADENCE_MATCH_TOLERANCE = 0.3;

/** Minimum fraction of consecutive intervals that must match a cadence to detect it. */
const MIN_INTERVAL_MATCH_RATIO = 0.5;

/** Amount band: transactions within ±10% of the candidate median are in the same band. */
const AMOUNT_TOLERANCE_PCT = 0.1;

/** Minimum number of transactions to detect a recurring series. */
const MIN_OCCURRENCES = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse ISO date string to a day offset (days since epoch). */
function toDayOffset(isoDate: string): number {
  return Math.floor(Date.parse(isoDate + 'T00:00:00Z') / 86_400_000);
}

/** Add `days` calendar days to an ISO date string and return a new ISO date string. */
export function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(isoDate + 'T00:00:00Z') + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Compute the integer median of a sorted bigint array (rounds down for even-length). */
export function medianBigint(sorted: readonly bigint[]): bigint {
  if (sorted.length === 0) throw new Error('Cannot compute median of empty array');
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  // Integer average of the two middle values (no float arithmetic on money).
  return (sorted[mid - 1]! + sorted[mid]!) / 2n;
}

/**
 * Filter an amount array to those within ±10% of the median.
 * Returns the median and the filtered subset.
 *
 * Uses pure bigint arithmetic for the threshold to avoid float precision loss
 * on large amounts (AGENTS.md §2: "All money is bigint cents. Never number.").
 */
export function filterAmountBand(
  amounts: readonly bigint[],
  tolerancePct = AMOUNT_TOLERANCE_PCT,
): { median: bigint; band: readonly bigint[] } {
  const sorted = [...amounts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const median = medianBigint(sorted);
  // Convert tolerance to fixed-point bigint (e.g. 0.10 → 1000/10000) to avoid
  // floating-point arithmetic on money values.
  const toleranceBasisPoints = BigInt(Math.round(tolerancePct * 10_000));
  const threshold = (median * toleranceBasisPoints) / 10_000n;
  const band = sorted.filter((a) => {
    const diff = a >= median ? a - median : median - a;
    return diff <= threshold;
  });
  return { median, band };
}

/**
 * Detect which cadence (if any) best matches an array of day intervals.
 * Returns the cadence and its match ratio, or null if no cadence matches.
 */
export function detectCadence(
  intervals: readonly number[],
): { cadence: RecurringCadence; matchRatio: number } | null {
  if (intervals.length === 0) return null;

  let best: { cadence: RecurringCadence; matchRatio: number } | null = null;

  for (const { cadence, days } of CADENCES) {
    const lo = days * (1 - CADENCE_MATCH_TOLERANCE);
    const hi = days * (1 + CADENCE_MATCH_TOLERANCE);
    const matches = intervals.filter((d) => d >= lo && d <= hi).length;
    const ratio = matches / intervals.length;
    if (ratio >= MIN_INTERVAL_MATCH_RATIO) {
      if (best === null || ratio > best.matchRatio) {
        best = { cadence, matchRatio: ratio };
      }
    }
  }

  return best;
}

/**
 * Score a detected series based on occurrence count and interval consistency.
 * More occurrences and tighter interval consistency → higher confidence.
 * Confidence is capped at 0.95 (never claim certainty).
 */
export function scoreRecurringSeries(occurrences: number, matchRatio: number): number {
  // Base score scales from 0.5 (2 occurrences) toward 0.85 (many occurrences).
  const occurrenceScore = Math.min(0.85, 0.5 + (occurrences - 2) * 0.07);
  // Consistency bonus: up to +0.10 for a perfect match ratio.
  const consistencyBonus = (matchRatio - MIN_INTERVAL_MATCH_RATIO) * 0.2;
  return Math.min(0.95, occurrenceScore + consistencyBonus);
}

// ---------------------------------------------------------------------------
// Core detection function
// ---------------------------------------------------------------------------

/**
 * Detect all recurring bill series from the given transaction list.
 *
 * Algorithm:
 *   1. Group by merchantNormalized.
 *   2. For each group, filter to the amount band (±10% of median).
 *   3. Sort by date, compute consecutive day intervals.
 *   4. Check each cadence; keep those where ≥ 50% of intervals match.
 *   5. Emit one DetectedSeries per (merchant, cadence) with confidence
 *      scaled by occurrence count and interval consistency.
 *
 * The function is pure — no side effects; the caller persists results.
 *
 * @param txns  Pre-filtered transactions: non-transfer, non-pending, non-deleted,
 *              merchant_normalized IS NOT NULL, amountCents > 0 (debits only).
 * @param userId  Branded user ID to stamp on each result.
 */
export function detectRecurringSeries(
  txns: readonly RecurringCandidate[],
  userId: UserId,
): DetectedSeries[] {
  if (txns.length === 0) return [];

  // Group by merchant.
  const byMerchant = new Map<string, RecurringCandidate[]>();
  for (const txn of txns) {
    const group = byMerchant.get(txn.merchantNormalized);
    if (group !== undefined) {
      group.push(txn);
    } else {
      byMerchant.set(txn.merchantNormalized, [txn]);
    }
  }

  const results: DetectedSeries[] = [];

  for (const [merchant, group] of byMerchant) {
    if (group.length < MIN_OCCURRENCES) continue;

    // Filter to amount band.
    const amounts = group.map((t) => t.amountCents);
    const { median: expectedAmountCents, band: bandAmounts } = filterAmountBand(amounts);

    // Rebuild the group restricted to the amount band.
    const bandSet = new Set(bandAmounts.map(String));
    const bandGroup = group
      .filter((t) => bandSet.has(String(t.amountCents)))
      .sort((a, b) => a.postedAt.localeCompare(b.postedAt));

    if (bandGroup.length < MIN_OCCURRENCES) continue;

    // Compute consecutive intervals in days.
    const intervals: number[] = [];
    for (let i = 1; i < bandGroup.length; i++) {
      const prev = bandGroup[i - 1]!;
      const curr = bandGroup[i]!;
      intervals.push(toDayOffset(curr.postedAt) - toDayOffset(prev.postedAt));
    }

    const cadenceResult = detectCadence(intervals);
    if (cadenceResult === null) continue;

    const { cadence, matchRatio } = cadenceResult;
    const lastSeenAt = bandGroup[bandGroup.length - 1]!.postedAt;
    const cadenceDays = CADENCES.find((c) => c.cadence === cadence)!.days;
    const nextExpectedAt = addDays(lastSeenAt, cadenceDays);
    const confidence = scoreRecurringSeries(bandGroup.length, matchRatio);

    results.push({
      userId,
      merchantNormalized: merchant,
      cadence,
      expectedAmountCents,
      amountTolerancePct: AMOUNT_TOLERANCE_PCT,
      nextExpectedAt,
      lastSeenAt,
      confidence,
    });
  }

  return results;
}
