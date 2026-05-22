import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

/** Format a UTC Date in the user's timezone for display. */
export function formatDateInTz(
  date: Date,
  timezone: string,
  fmt = 'MMM d, yyyy',
): string {
  return formatInTimeZone(date, timezone, fmt);
}

/** Convert a UTC Date to the user's timezone (for date-only comparisons). */
export function toUserTz(date: Date, timezone: string): Date {
  return toZonedTime(date, timezone);
}

/** Returns today's date as a UTC midnight Date object. */
export function utcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
