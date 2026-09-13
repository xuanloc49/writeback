import { describeQuotaReset, quotaExceededMessage } from './quota-reset';

const HCM = 'Asia/Ho_Chi_Minh';

describe('describeQuotaReset (design §5.2)', () => {
  it('one second before GMT+7 midnight resets at that midnight', () => {
    const { resetAt, label } = describeQuotaReset(new Date('2026-09-13T16:59:59.000Z'), HCM);
    expect(resetAt.toISOString()).toBe('2026-09-13T17:00:00.000Z');
    expect(label).toBe('00:00 GMT+7');
  });

  it('exactly at GMT+7 midnight resets at the following midnight', () => {
    const { resetAt, label } = describeQuotaReset(new Date('2026-09-13T17:00:00.000Z'), HCM);
    expect(resetAt.toISOString()).toBe('2026-09-14T17:00:00.000Z');
    expect(label).toBe('00:00 GMT+7');
  });

  it('mid-day GMT+7 resets at the next local midnight', () => {
    const { resetAt } = describeQuotaReset(new Date('2026-09-13T10:00:00.000Z'), HCM);
    expect(resetAt.toISOString()).toBe('2026-09-13T17:00:00.000Z');
  });

  it('labels a non-integer offset zone such as Asia/Kolkata', () => {
    const { resetAt, label } = describeQuotaReset(
      new Date('2026-09-13T10:00:00.000Z'),
      'Asia/Kolkata',
    );
    expect(resetAt.toISOString()).toBe('2026-09-13T18:30:00.000Z');
    expect(label).toMatch(/^00:00 GMT\+0?5:30$/);
  });

  it('labels UTC without an offset suffix', () => {
    const { resetAt, label } = describeQuotaReset(new Date('2026-09-13T10:00:00.000Z'), 'UTC');
    expect(resetAt.toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(label).toBe('00:00 GMT');
  });

  it('evaluates the offset at resetAt for DST zones', () => {
    // Europe/Berlin: 2026-10-24 is CEST (+2); local midnight 2026-10-25 is still +2,
    // the switch to CET (+1) happens at 03:00 local that same morning.
    const cest = describeQuotaReset(new Date('2026-10-24T10:00:00.000Z'), 'Europe/Berlin');
    expect(cest.resetAt.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(cest.label).toBe('00:00 GMT+2');
    // After the switch the next reset is at CET midnight (+1).
    const cet = describeQuotaReset(new Date('2026-10-25T10:00:00.000Z'), 'Europe/Berlin');
    expect(cet.resetAt.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(cet.label).toBe('00:00 GMT+1');
  });
});

describe('quotaExceededMessage (PRD §8)', () => {
  it('uses the rewrite copy for rewrite_new', () => {
    expect(quotaExceededMessage('rewrite_new', '00:00 GMT+7')).toBe(
      'Bạn đã hết lượt viết lại hôm nay. Lượt mới vào 00:00 GMT+7.',
    );
  });

  it('uses the retry copy for retry', () => {
    expect(quotaExceededMessage('retry', '00:00 GMT+7')).toBe(
      'Bạn đã hết lượt sửa bài hôm nay. Lượt mới vào 00:00 GMT+7.',
    );
  });
});
