import { nextStreak } from './streak';

describe('nextStreak (PRD §10.6 streak transitions)', () => {
  it('starts at 1 when there was never any activity', () => {
    expect(nextStreak(0, null, '2026-09-13')).toEqual({
      streakCount: 1,
      streakLastDate: '2026-09-13',
    });
  });

  it('does not change when the last activity was today', () => {
    expect(nextStreak(4, '2026-09-13', '2026-09-13')).toEqual({
      streakCount: 4,
      streakLastDate: '2026-09-13',
    });
  });

  it('increments when the last activity was yesterday', () => {
    expect(nextStreak(4, '2026-09-12', '2026-09-13')).toEqual({
      streakCount: 5,
      streakLastDate: '2026-09-13',
    });
  });

  it('increments across a month boundary', () => {
    expect(nextStreak(1, '2026-08-31', '2026-09-01').streakCount).toBe(2);
  });

  it('restarts at 1 after missing one or more days', () => {
    expect(nextStreak(7, '2026-09-11', '2026-09-13')).toEqual({
      streakCount: 1,
      streakLastDate: '2026-09-13',
    });
    expect(nextStreak(7, '2026-01-01', '2026-09-13').streakCount).toBe(1);
  });

  it('restarts at 1 when the stored date is in the future (clock skew)', () => {
    expect(nextStreak(3, '2026-09-14', '2026-09-13').streakCount).toBe(1);
  });
});
