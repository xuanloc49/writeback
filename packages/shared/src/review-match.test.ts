import { describe, expect, it } from 'vitest';
import { blankHeadword } from './cloze.js';
import { inflectionSet } from './inflection.js';
import { matchReviewAnswer } from './review-match.js';

describe('matchReviewAnswer', () => {
  it('trims and compares case-insensitively', () => {
    expect(matchReviewAnswer('  Deadline ', ['deadline'])).toBe(true);
    expect(matchReviewAnswer('DEADLINE', new Set(['deadline']))).toBe(true);
  });

  it('does not strip punctuation', () => {
    expect(matchReviewAnswer('deadline.', ['deadline'])).toBe(false);
    expect(matchReviewAnswer("deadline's", ['deadline'])).toBe(false);
  });

  it('rejects empty answers and non-members', () => {
    expect(matchReviewAnswer('   ', ['deadline'])).toBe(false);
    expect(matchReviewAnswer('deadlines', ['deadline'])).toBe(false);
    expect(matchReviewAnswer('deadline', [])).toBe(false);
  });

  it('accepts inflections and surfaces blanked from a cloze sentence', () => {
    const headword = 'submit';
    const { blanked } = blankHeadword('She Submitted the form.', headword, inflectionSet(headword));
    const accepted = new Set([headword, ...inflectionSet(headword), ...blanked]);
    expect(matchReviewAnswer('submitted', accepted)).toBe(true);
    expect(matchReviewAnswer('Submitting', accepted)).toBe(true);
    expect(matchReviewAnswer('submission', accepted)).toBe(false);
  });
});
