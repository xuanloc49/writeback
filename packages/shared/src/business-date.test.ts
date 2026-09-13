import { describe, expect, it } from 'vitest';
import {
  businessDate,
  businessDayRange,
  daysBetweenBusinessDates,
  isDueToday,
  isSameBusinessDay,
} from './business-date.js';
import { DEFAULT_BUSINESS_TIMEZONE } from './constants.js';

const TZ = DEFAULT_BUSINESS_TIMEZONE;
const LAST_SECOND_OF_SEP_13 = new Date('2026-09-13T16:59:59Z'); // 23:59:59 GMT+7
const FIRST_SECOND_OF_SEP_14 = new Date('2026-09-13T17:00:00Z'); // 00:00:00 GMT+7

describe('businessDate', () => {
  it('rolls over at midnight GMT+7, not UTC midnight', () => {
    expect(businessDate(LAST_SECOND_OF_SEP_13, TZ)).toBe('2026-09-13');
    expect(businessDate(FIRST_SECOND_OF_SEP_14, TZ)).toBe('2026-09-14');
    expect(businessDate(new Date('2026-09-13T23:30:00Z'), TZ)).toBe('2026-09-14');
  });

  it('depends on the time zone argument', () => {
    const instant = new Date('2026-01-01T02:00:00Z');
    expect(businessDate(instant, 'UTC')).toBe('2026-01-01');
    expect(businessDate(instant, 'America/Los_Angeles')).toBe('2025-12-31');
    expect(businessDate(instant, TZ)).toBe('2026-01-01');
  });

  it('zero-pads month and day', () => {
    expect(businessDate(new Date('2026-03-05T12:00:00Z'), TZ)).toBe('2026-03-05');
  });
});

describe('businessDayRange', () => {
  it('returns [17:00Z previous day, 17:00Z) for a GMT+7 calendar day', () => {
    const { start, end } = businessDayRange(new Date('2026-09-13T10:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-09-12T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-13T17:00:00.000Z');
  });

  it('is consistent with businessDate at both edges', () => {
    const { start, end } = businessDayRange(LAST_SECOND_OF_SEP_13, TZ);
    expect(businessDate(start, TZ)).toBe('2026-09-13');
    expect(businessDate(new Date(end.getTime() - 1), TZ)).toBe('2026-09-13');
    expect(businessDate(end, TZ)).toBe('2026-09-14');
    expect(businessDayRange(FIRST_SECOND_OF_SEP_14, TZ).start.toISOString()).toBe('2026-09-13T17:00:00.000Z');
  });

  it('handles a DST transition day in a zone that observes it', () => {
    // 2026-03-29 is the EU spring-forward day (23 hours long in Europe/Berlin).
    const { start, end } = businessDayRange(new Date('2026-03-29T12:00:00Z'), 'Europe/Berlin');
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });
});

describe('isDueToday / isSameBusinessDay', () => {
  const now = new Date('2026-09-13T10:00:00Z'); // 17:00 GMT+7 on 2026-09-13

  it('is due for yesterday and today, not tomorrow', () => {
    expect(isDueToday(new Date('2026-09-12T10:00:00Z'), now, TZ)).toBe(true);
    expect(isDueToday(LAST_SECOND_OF_SEP_13, now, TZ)).toBe(true);
    expect(isDueToday(FIRST_SECOND_OF_SEP_14, now, TZ)).toBe(false);
  });

  it('is due when next review is later today even if after now', () => {
    expect(isDueToday(new Date('2026-09-13T16:00:00Z'), now, TZ)).toBe(true);
  });

  it('compares calendar days in the given zone', () => {
    expect(isSameBusinessDay(now, LAST_SECOND_OF_SEP_13, TZ)).toBe(true);
    expect(isSameBusinessDay(now, FIRST_SECOND_OF_SEP_14, TZ)).toBe(false);
    expect(isSameBusinessDay(LAST_SECOND_OF_SEP_13, FIRST_SECOND_OF_SEP_14, 'UTC')).toBe(true);
  });
});

describe('daysBetweenBusinessDates', () => {
  it('counts whole days, signed', () => {
    expect(daysBetweenBusinessDates('2026-09-12', '2026-09-13')).toBe(1);
    expect(daysBetweenBusinessDates('2026-09-13', '2026-09-13')).toBe(0);
    expect(daysBetweenBusinessDates('2026-09-13', '2026-09-11')).toBe(-2);
    expect(daysBetweenBusinessDates('2025-12-31', '2026-01-01')).toBe(1);
  });

  it('rejects malformed dates', () => {
    expect(() => daysBetweenBusinessDates('2026-9-1', '2026-09-13')).toThrow(RangeError);
  });
});
