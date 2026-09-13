import { daysBetweenBusinessDates } from '@writeback/shared';

/** A streak survives a gap of at most this many business days (yesterday → today). */
const MAX_STREAK_GAP_DAYS = 1;
/** Length of 'YYYY-MM-DD'. */
const BUSINESS_DATE_LENGTH = 10;

/**
 * PRD §10.6 / design §10: the stored `streak_count` is only meaningful while
 * `streak_last_date` is today or yesterday (GMT+7). Missing a day resets it to 0.
 * Pure; `streakLastDate` and `todayBusinessDate` are 'YYYY-MM-DD' business dates.
 */
export function effectiveStreak(
  streakCount: number,
  streakLastDate: string | null,
  todayBusinessDate: string,
): number {
  if (streakLastDate === null) {
    return 0;
  }
  const gap = daysBetweenBusinessDates(streakLastDate, todayBusinessDate);
  return gap > MAX_STREAK_GAP_DAYS ? 0 : streakCount;
}

/** Prisma maps a `DATE` column to UTC midnight of that calendar day; recover 'YYYY-MM-DD'. */
export function dateColumnToBusinessDate(value: Date | null): string | null {
  if (value === null) {
    return null;
  }
  return value.toISOString().slice(0, BUSINESS_DATE_LENGTH);
}
