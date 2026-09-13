import { describe, expect, it } from 'vitest';
import { blankHeadword, CLOZE_BLANK } from './cloze.js';
import { inflectionSet } from './inflection.js';

describe('blankHeadword', () => {
  it('blanks the headword only at word boundaries', () => {
    const result = blankHeadword('You must apply before the application closes.', 'apply');
    expect(result.text).toBe(`You must ${CLOZE_BLANK} before the application closes.`);
    expect(result.blanked).toEqual(['apply']);
  });

  it('blanks every occurrence including inflections, case-insensitively', () => {
    const result = blankHeadword(
      'Submit the form. She submitted it; we are submitting ours. SUBMITS!',
      'submit',
      inflectionSet('submit'),
    );
    expect(result.text).toBe(
      `${CLOZE_BLANK} the form. She ${CLOZE_BLANK} it; we are ${CLOZE_BLANK} ours. ${CLOZE_BLANK}!`,
    );
    expect(result.blanked).toEqual(['Submit', 'submitted', 'submitting', 'SUBMITS']);
  });

  it('deduplicates blanked surfaces case-insensitively, keeping the first casing', () => {
    const result = blankHeadword('Apply now. apply again.', 'apply');
    expect(result.text).toBe(`${CLOZE_BLANK} now. ${CLOZE_BLANK} again.`);
    expect(result.blanked).toEqual(['Apply']);
  });

  it('prefers longer multi-word surfaces over their prefixes', () => {
    const result = blankHeadword('I checked in late, then checked the mail.', 'check in', inflectionSet('check in'));
    expect(result.text).toBe(`I ${CLOZE_BLANK} late, then checked the mail.`);
    expect(result.blanked).toEqual(['checked in']);
  });

  it('matches multi-word surfaces across any whitespace run', () => {
    const result = blankHeadword('Please check  in early.', 'check in');
    expect(result.text).toBe(`Please ${CLOZE_BLANK} early.`);
    expect(result.blanked).toEqual(['check  in']);
  });

  it('leaves the sentence unchanged when there is no occurrence', () => {
    const sentence = 'Nothing to see here.';
    expect(blankHeadword(sentence, 'deadline', inflectionSet('deadline'))).toEqual({ text: sentence, blanked: [] });
    expect(blankHeadword(sentence, '   ')).toEqual({ text: sentence, blanked: [] });
  });

  it('does not treat regex metacharacters in surfaces as patterns', () => {
    const result = blankHeadword('It costs a lot (a.k.a. money).', 'a.k.a.');
    expect(result.text).toBe(`It costs a lot (${CLOZE_BLANK} money).`);
  });
});
