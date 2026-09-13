import { SRS } from './constants.js';
import type { ReviewQuality, SrsStatus } from './types.js';

/** SM-2 exactly as PRD Appendix C (design §10). */

export interface Sm2CardState {
  status: SrsStatus;
  ef: number;
  repetitions: number;
  intervalDays: number;
  nextReviewAt: Date;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
/** q ≥ 3 is a pass; only q = 1 exists below it. */
const PASSING_QUALITY = 3;
const MAX_QUALITY = 5;
/** EF update: ef + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)). */
const EF_BASE_GAIN = 0.1;
const EF_PENALTY_LINEAR = 0.08;
const EF_PENALTY_QUADRATIC = 0.02;
/** Typed / cloze answers map to fixed qualities — PRD §10.6. */
const TYPED_CORRECT_QUALITY: ReviewQuality = 4;
const TYPED_WRONG_QUALITY: ReviewQuality = 1;

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function clampEf(ef: number): number {
  return Math.max(SRS.MIN_EF, ef);
}

/** ef 2.5, 0 repetitions, interval 0, status `new`, due immediately. */
export function newSm2Card(now: Date): Sm2CardState {
  return {
    status: 'new',
    ef: SRS.INITIAL_EF,
    repetitions: 0,
    intervalDays: 0,
    nextReviewAt: new Date(now.getTime()),
  };
}

function nextIntervalDays(card: Sm2CardState): number {
  if (card.repetitions === 0) return SRS.FIRST_INTERVAL_DAYS;
  if (card.repetitions === 1) return SRS.SECOND_INTERVAL_DAYS;
  return Math.round(card.intervalDays * card.ef);
}

export function nextSm2(card: Sm2CardState, quality: ReviewQuality, now: Date): Sm2CardState {
  if (quality < PASSING_QUALITY) {
    // Lapse: EF formula is not applied, only the ≥ MIN_EF clamp (PRD Appendix C).
    if (card.status === 'new' || card.status === 'learning') {
      return {
        status: 'learning',
        ef: clampEf(card.ef),
        repetitions: 0,
        intervalDays: card.intervalDays,
        nextReviewAt: addMinutes(now, SRS.LAPSE_RELEARN_MINUTES),
      };
    }
    return {
      status: 'learning',
      ef: clampEf(card.ef),
      repetitions: 0,
      intervalDays: SRS.LAPSE_REVIEW_INTERVAL_DAYS,
      nextReviewAt: addDays(now, SRS.LAPSE_REVIEW_INTERVAL_DAYS),
    };
  }

  const intervalDays = nextIntervalDays(card);
  const missed = MAX_QUALITY - quality;
  const ef = clampEf(card.ef + (EF_BASE_GAIN - missed * (EF_PENALTY_LINEAR + missed * EF_PENALTY_QUADRATIC)));
  return {
    status: intervalDays >= SRS.MASTERED_INTERVAL_DAYS ? 'mastered' : 'review',
    ef,
    repetitions: card.repetitions + 1,
    intervalDays,
    nextReviewAt: addDays(now, intervalDays),
  };
}

export function qualityForTypedAnswer(correct: boolean): ReviewQuality {
  return correct ? TYPED_CORRECT_QUALITY : TYPED_WRONG_QUALITY;
}
