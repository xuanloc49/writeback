import { REWRITE } from '@writeback/shared';
import { describe, expect, it } from 'vitest';
import { revisionWindowOpen, showRevisionModelToggle } from './rewrite-display';

describe('showRevisionModelToggle', () => {
  it('is true only before revision 2 is scored and when first score is below 50', () => {
    expect(showRevisionModelToggle(49, false)).toBe(true);
    expect(showRevisionModelToggle(REWRITE.MODEL_REWRITE_TOGGLE_BELOW_SCORE, false)).toBe(false);
    expect(showRevisionModelToggle(49, true)).toBe(false);
    expect(showRevisionModelToggle(null, false)).toBe(false);
  });
});

describe('revisionWindowOpen', () => {
  const now = new Date('2026-09-13T07:10:00.000Z');

  it('requires availability and a deadline in the future', () => {
    expect(revisionWindowOpen(true, '2026-09-13T07:16:00.000Z', now)).toBe(true);
    expect(revisionWindowOpen(true, '2026-09-13T07:10:00.000Z', now)).toBe(true);
    expect(revisionWindowOpen(true, '2026-09-13T07:09:59.000Z', now)).toBe(false);
    expect(revisionWindowOpen(false, '2026-09-13T07:16:00.000Z', now)).toBe(false);
    expect(revisionWindowOpen(true, null, now)).toBe(false);
  });
});
