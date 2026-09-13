import { describe, expect, it } from 'vitest';
import {
  normalizeHeadword,
  pickDisplayIssues,
  scoringOutputSchema,
  validateUsedWordsOneToOne,
  type ScoringOutput,
} from './scoring.js';

/** Sample from PRD §10.4. */
const sample: ScoringOutput = {
  overall_score: 0,
  idea_match: { status: 'enough', comment_vi: '...' },
  used_required_words: [{ headword: 'deadline', used: true, natural: true, comment_vi: '...' }],
  grammar_issues: [
    { span: 'I go yesterday', severity: 'high', explanation_vi: '...', suggestion_en: 'I went yesterday' },
  ],
  lexical_issues: [],
  naturalness_note_vi: '...',
  model_rewrite_en: '...',
  encouragement_vi: '...',
};

function issue(span: string, severity: 'high' | 'medium' | 'low') {
  return { span, severity, explanation_vi: 'vi', suggestion_en: 'en' };
}

describe('scoringOutputSchema', () => {
  it('parses the PRD §10.4 sample', () => {
    expect(scoringOutputSchema.parse(sample)).toEqual(sample);
  });

  it('rejects unknown fields at every level (strict)', () => {
    expect(scoringOutputSchema.safeParse({ ...sample, extra: 1 }).success).toBe(false);
    expect(
      scoringOutputSchema.safeParse({ ...sample, idea_match: { ...sample.idea_match, extra: 1 } }).success,
    ).toBe(false);
    expect(
      scoringOutputSchema.safeParse({ ...sample, grammar_issues: [{ ...issue('x', 'low'), extra: 1 }] }).success,
    ).toBe(false);
  });

  it('rejects non-integer or out-of-range scores and unknown enums', () => {
    expect(scoringOutputSchema.safeParse({ ...sample, overall_score: 101 }).success).toBe(false);
    expect(scoringOutputSchema.safeParse({ ...sample, overall_score: 55.5 }).success).toBe(false);
    expect(scoringOutputSchema.safeParse({ ...sample, overall_score: -1 }).success).toBe(false);
    expect(
      scoringOutputSchema.safeParse({ ...sample, idea_match: { status: 'partial', comment_vi: '' } }).success,
    ).toBe(false);
  });

  it('requires every field (no optional keys for strict structured outputs)', () => {
    const { encouragement_vi: _omitted, ...missing } = sample;
    expect(scoringOutputSchema.safeParse(missing).success).toBe(false);
  });
});

describe('pickDisplayIssues', () => {
  it('puts all high first (grammar before lexical, stable), then medium, then low, capped at 3', () => {
    const picked = pickDisplayIssues({
      grammar_issues: [issue('g-low', 'low'), issue('g-high', 'high'), issue('g-med', 'medium')],
      lexical_issues: [issue('l-high-1', 'high'), issue('l-high-2', 'high'), issue('l-med', 'medium')],
    });
    expect(picked.map((p) => p.span)).toEqual(['g-high', 'l-high-1', 'l-high-2']);
    expect(picked[0]).toMatchObject({ kind: 'grammar', explanationVi: 'vi', suggestionEn: 'en' });
  });

  it('fills up with lower severities when there are fewer than 3 high', () => {
    const picked = pickDisplayIssues({
      grammar_issues: [issue('g-low', 'low'), issue('g-med', 'medium')],
      lexical_issues: [issue('l-high', 'high'), issue('l-low', 'low')],
    });
    expect(picked.map((p) => p.span)).toEqual(['l-high', 'g-med', 'g-low']);
  });

  it('returns everything when fewer than the cap, and honours a custom cap', () => {
    const input = { grammar_issues: [issue('a', 'low')], lexical_issues: [issue('b', 'medium')] };
    expect(pickDisplayIssues(input).map((p) => p.span)).toEqual(['b', 'a']);
    expect(pickDisplayIssues(input, 1).map((p) => p.span)).toEqual(['b']);
    expect(pickDisplayIssues(input, 0)).toEqual([]);
    expect(pickDisplayIssues({ grammar_issues: [], lexical_issues: [] })).toEqual([]);
  });
});

describe('normalizeHeadword', () => {
  it('lowercases, trims and collapses inner whitespace', () => {
    expect(normalizeHeadword('  Check   In ')).toBe('check in');
    expect(normalizeHeadword('Deadline')).toBe('deadline');
  });
});

describe('validateUsedWordsOneToOne', () => {
  const entry = (headword: string) => ({ headword, used: true, natural: false, comment_vi: '' });

  it('accepts exactly one entry per target, ignoring case and surrounding whitespace', () => {
    const result = validateUsedWordsOneToOne(
      { used_required_words: [entry(' Deadline'), entry('SUBMIT ')] },
      ['submit', 'deadline'],
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects a missing entry', () => {
    const result = validateUsedWordsOneToOne({ used_required_words: [entry('deadline')] }, ['deadline', 'submit']);
    expect(result).toMatchObject({ ok: false, reason: 'count_mismatch', details: { expected: 2, actual: 1 } });
  });

  it('rejects an extra entry', () => {
    const result = validateUsedWordsOneToOne(
      { used_required_words: [entry('deadline'), entry('submit'), entry('report')] },
      ['deadline', 'submit'],
    );
    expect(result).toMatchObject({ ok: false, reason: 'count_mismatch' });
  });

  it('rejects duplicates even when the count matches', () => {
    const result = validateUsedWordsOneToOne(
      { used_required_words: [entry('deadline'), entry('Deadline')] },
      ['deadline', 'submit'],
    );
    expect(result).toMatchObject({ ok: false, reason: 'duplicate_headword', details: { duplicates: ['deadline'] } });
  });

  it('rejects a wrong headword with the same count', () => {
    const result = validateUsedWordsOneToOne(
      { used_required_words: [entry('deadline'), entry('report')] },
      ['deadline', 'submit'],
    );
    expect(result).toMatchObject({
      ok: false,
      reason: 'headword_mismatch',
      details: { missing: ['submit'], extra: ['report'] },
    });
  });
});
