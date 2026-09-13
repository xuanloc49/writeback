import { describe, expect, it } from 'vitest';
import { inflectionSet } from './inflection.js';

function has(headword: string, ...forms: string[]): void {
  const set = inflectionSet(headword);
  for (const form of forms) expect(set, `${headword} should include ${form}`).toContain(form);
}

describe('inflectionSet', () => {
  it('always contains the normalized headword and is lowercase', () => {
    expect(inflectionSet('  Submit ')).toContain('submit');
    for (const form of inflectionSet('DEADLINE')) expect(form).toBe(form.toLowerCase());
  });

  it('is deterministic', () => {
    expect([...inflectionSet('apply')]).toEqual([...inflectionSet('apply')]);
    expect([...inflectionSet('check in')]).toEqual([...inflectionSet('check in')]);
  });

  it('doubles monosyllabic CVC words', () => {
    has('plan', 'plans', 'planned', 'planning');
    has('stop', 'stopped', 'stopping');
    expect(inflectionSet('plan')).not.toContain('planed');
  });

  it('doubles final-stress polysyllabic words only, with exactly one spelling', () => {
    has('submit', 'submits', 'submitted', 'submitting');
    has('commit', 'committed', 'committing');
    has('occur', 'occurred', 'occurring');
    expect(inflectionSet('submit')).not.toContain('submited');
    expect(inflectionSet('submit')).not.toContain('submiting');
    expect(inflectionSet('submit').size).toBe(4);
  });

  it('does not double other polysyllabic CVC words', () => {
    has('visit', 'visits', 'visited', 'visiting');
    has('offer', 'offers', 'offered', 'offering');
    has('open', 'opens', 'opened', 'opening');
    expect(inflectionSet('visit')).not.toContain('visitted');
    expect(inflectionSet('offer')).not.toContain('offerred');
    expect(inflectionSet('open')).not.toContain('openned');
  });

  it('does not double after w/x/y or after two vowels', () => {
    has('fix', 'fixes', 'fixed', 'fixing');
    has('show', 'shows', 'showed', 'showing');
    has('look', 'looks', 'looked', 'looking');
    expect(inflectionSet('look')).not.toContain('lookked');
  });

  it('handles consonant + y and vowel + y', () => {
    has('apply', 'applies', 'applied', 'applying');
    has('play', 'plays', 'played', 'playing');
  });

  it('drops a silent e before -ing/-ed and adds -es after s/x/z/ch/sh/o', () => {
    has('hope', 'hopes', 'hoped', 'hoping');
    has('watch', 'watches', 'watched', 'watching');
    has('wish', 'wishes');
    has('agree', 'agrees', 'agreed', 'agreeing');
  });

  it('includes irregular forms plus regular -s and -ing', () => {
    has('go', 'went', 'gone', 'goes', 'going');
    has('be', 'am', 'is', 'are', 'was', 'were', 'been', 'being');
    has('have', 'has', 'had', 'having');
    has('write', 'wrote', 'written', 'writes', 'writing');
    has('begin', 'began', 'begun', 'beginning');
    has('read', 'reads', 'reading');
    expect(inflectionSet('go')).not.toContain('goed');
    expect(inflectionSet('be')).not.toContain('bes');
  });

  it('inflects the first word of a phrasal headword and keeps the phrase', () => {
    has('check in', 'check in', 'checks in', 'checked in', 'checking in');
    has('give up', 'gave up', 'given up', 'giving up');
    expect(inflectionSet('check in')).not.toContain('check ins');
  });

  it('leaves non-alphabetic headwords alone and returns an empty set for blank input', () => {
    expect([...inflectionSet('e-mail')]).toEqual(['e-mail']);
    expect(inflectionSet('   ').size).toBe(0);
  });
});
