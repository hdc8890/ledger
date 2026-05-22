/**
 * Money utilities — all amounts are bigint cents.
 *
 * Rules:
 * - Never store or compute with float for money.
 * - positive = debit (money out), negative = credit (money in) for transactions.
 * - Use these helpers for all formatting and arithmetic.
 */

/** Convert cents (bigint) to a display string, e.g. 1234n → "$12.34" */
export function formatCents(
  cents: bigint,
  currency = 'USD',
  locale = 'en-US',
): string {
  // Use bigint arithmetic for the integer part so large values don't lose
  // precision. Only the 0-99 remainder is converted to Number.
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const wholeDollars = abs / 100n;
  const remainCents = abs % 100n;
  const displayValue =
    (Number(wholeDollars) + Number(remainCents) / 100) * (negative ? -1 : 1);

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(displayValue);
}

/** Convert a dollar float (from external input) to bigint cents. */
export function dollarsToCents(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100));
}

/** Convert bigint cents to a number (dollars). Only use for display, never for storage or arithmetic. */
export function centsToNumber(cents: bigint): number {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return (Number(abs / 100n) + Number(abs % 100n) / 100) * (negative ? -1 : 1);
}

/** Add two cent values. */
export function addCents(a: bigint, b: bigint): bigint {
  return a + b;
}

/** Subtract b from a. */
export function subtractCents(a: bigint, b: bigint): bigint {
  return a - b;
}

/** Absolute value. */
export function absCents(a: bigint): bigint {
  return a < 0n ? -a : a;
}

/** Sum an array of cent values. */
export function sumCents(values: readonly bigint[]): bigint {
  return values.reduce((acc, v) => acc + v, 0n);
}
