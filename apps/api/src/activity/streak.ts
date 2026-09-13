import { daysBetweenBusinessDates } from '@writeback/shared';

/** Streak counters as stored on `users` (PRD §10.6, design §10). */
export interface StreakState {
  streakCount: number;
  /** 'YYYY-MM-DD' business date of the last qualifying activity. */
  streakLastDate: string;
}

/** Business days between two consecutive streak days. */
const CONSECUTIVE_DAY_GAP = 1;
/** A qualifying activity on a fresh (non-consecutive) day restarts the streak here. */
const RESTARTED_STREAK = 1;

/**
 * Pure streak transition for one qualifying activity on `today` (PRD §10.6):
 * same day → unchanged; yesterday → +1; otherwise (never / gap ≥ 1 day) → restart at 1.
 */
export function nextStreak(current: number, lastDate: string | null, today: string): StreakState {
  if (lastDate === null) {
    return { streakCount: RESTARTED_STREAK, streakLastDate: today };
  }
  const gap = daysBetweenBusinessDates(lastDate, today);
  if (gap === 0) {
    return { streakCount: current, streakLastDate: lastDate };
  }
  if (gap === CONSECUTIVE_DAY_GAP) {
    return { streakCount: current + 1, streakLastDate: today };
  }
  return { streakCount: RESTARTED_STREAK, streakLastDate: today };
}
