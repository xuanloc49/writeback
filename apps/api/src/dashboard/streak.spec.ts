import { dateColumnToBusinessDate, effectiveStreak } from './streak';

const TODAY = '2026-09-13';

describe('effectiveStreak (PRD §10.6, design §10)', () => {
  it('keeps the stored count when the last active day is today', () => {
    expect(effectiveStreak(7, TODAY, TODAY)).toBe(7);
  });

  it('keeps the stored count when the last active day is yesterday', () => {
    expect(effectiveStreak(7, '2026-09-12', TODAY)).toBe(7);
  });

  it('resets to 0 when a day was missed', () => {
    expect(effectiveStreak(7, '2026-09-11', TODAY)).toBe(0);
    expect(effectiveStreak(30, '2026-01-01', TODAY)).toBe(0);
  });

  it('is 0 when the user has never been active', () => {
    expect(effectiveStreak(0, null, TODAY)).toBe(0);
    expect(effectiveStreak(5, null, TODAY)).toBe(0);
  });

  it('handles month boundaries', () => {
    expect(effectiveStreak(3, '2026-08-31', '2026-09-01')).toBe(3);
    expect(effectiveStreak(3, '2026-08-30', '2026-09-01')).toBe(0);
  });
});

describe('dateColumnToBusinessDate', () => {
  it('maps a Prisma DATE value (UTC midnight) back to YYYY-MM-DD', () => {
    expect(dateColumnToBusinessDate(new Date('2026-09-13T00:00:00.000Z'))).toBe('2026-09-13');
    expect(dateColumnToBusinessDate(null)).toBeNull();
  });
});
