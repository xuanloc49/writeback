import { describe, expect, it } from 'vitest';
import { SRS } from './constants.js';
import { newSm2Card, nextSm2, qualityForTypedAnswer, type Sm2CardState } from './sm2.js';

const NOW = new Date('2026-09-13T10:00:00.000Z');
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function after(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

describe('newSm2Card', () => {
  it('starts new, ef 2.5, no repetitions, due now', () => {
    expect(newSm2Card(NOW)).toEqual({
      status: 'new',
      ef: SRS.INITIAL_EF,
      repetitions: 0,
      intervalDays: 0,
      nextReviewAt: NOW,
    });
  });
});

describe('nextSm2 passing answers', () => {
  it('walks 1 → 6 → round(6 × ef) days with q=4 keeping ef at 2.5', () => {
    const first = nextSm2(newSm2Card(NOW), 4, NOW);
    expect(first).toMatchObject({ status: 'review', repetitions: 1, intervalDays: 1, ef: 2.5 });
    expect(first.nextReviewAt).toEqual(after(1));

    const second = nextSm2(first, 4, NOW);
    expect(second).toMatchObject({ status: 'review', repetitions: 2, intervalDays: 6, ef: 2.5 });
    expect(second.nextReviewAt).toEqual(after(6));

    const third = nextSm2(second, 4, NOW);
    expect(third).toMatchObject({ status: 'review', repetitions: 3, intervalDays: 15 });
    expect(third.nextReviewAt).toEqual(after(15));
  });

  it('raises ef on q=5 and lowers it on q=3', () => {
    expect(nextSm2(newSm2Card(NOW), 5, NOW).ef).toBeCloseTo(2.6);
    expect(nextSm2(newSm2Card(NOW), 3, NOW).ef).toBeCloseTo(2.36);
  });

  it('never lets ef fall below 1.3', () => {
    let card: Sm2CardState = newSm2Card(NOW);
    for (let i = 0; i < 20; i += 1) card = nextSm2(card, 3, NOW);
    expect(card.ef).toBe(SRS.MIN_EF);
  });

  it('becomes mastered once the interval reaches 21 days', () => {
    const card: Sm2CardState = { status: 'review', ef: 2.5, repetitions: 3, intervalDays: 8, nextReviewAt: NOW };
    const below = nextSm2(card, 4, NOW); // round(8 × 2.5) = 20 < 21
    expect(below).toMatchObject({ status: 'review', intervalDays: 20 });
    const exactly21 = nextSm2({ ...card, intervalDays: 7, ef: 3 }, 4, NOW);
    expect(exactly21).toMatchObject({ status: 'mastered', intervalDays: 21 });
    const above = nextSm2({ ...card, intervalDays: 9 }, 4, NOW); // round(22.5) = 23
    expect(above).toMatchObject({ status: 'mastered', intervalDays: 23 });
  });
});

describe('nextSm2 lapses (q=1)', () => {
  it('on a new or learning card: +10 minutes, learning, repetitions 0, interval unchanged', () => {
    const fromNew = nextSm2(newSm2Card(NOW), 1, NOW);
    expect(fromNew).toMatchObject({ status: 'learning', repetitions: 0, intervalDays: 0, ef: 2.5 });
    expect(fromNew.nextReviewAt).toEqual(new Date(NOW.getTime() + SRS.LAPSE_RELEARN_MINUTES * MINUTE_MS));

    const learning: Sm2CardState = { status: 'learning', ef: 2.2, repetitions: 0, intervalDays: 1, nextReviewAt: NOW };
    const again = nextSm2(learning, 1, NOW);
    expect(again).toMatchObject({ status: 'learning', repetitions: 0, intervalDays: 1, ef: 2.2 });
    expect(again.nextReviewAt).toEqual(new Date(NOW.getTime() + 10 * MINUTE_MS));
  });

  it('on a review or mastered card: interval 1 day, learning, repetitions 0, ef only clamped', () => {
    const review: Sm2CardState = { status: 'review', ef: 2.5, repetitions: 4, intervalDays: 15, nextReviewAt: NOW };
    const lapsed = nextSm2(review, 1, NOW);
    expect(lapsed).toMatchObject({ status: 'learning', repetitions: 0, intervalDays: 1, ef: 2.5 });
    expect(lapsed.nextReviewAt).toEqual(after(1));

    const mastered: Sm2CardState = { status: 'mastered', ef: 1.1, repetitions: 6, intervalDays: 40, nextReviewAt: NOW };
    expect(nextSm2(mastered, 1, NOW)).toMatchObject({ status: 'learning', intervalDays: 1, ef: SRS.MIN_EF });
  });

  it('does not mutate the input card', () => {
    const card = newSm2Card(NOW);
    nextSm2(card, 4, NOW);
    expect(card).toEqual(newSm2Card(NOW));
  });
});

describe('qualityForTypedAnswer', () => {
  it('maps correct → 4 and wrong → 1', () => {
    expect(qualityForTypedAnswer(true)).toBe(4);
    expect(qualityForTypedAnswer(false)).toBe(1);
  });
});
