import { z } from 'zod';
import { REWRITE } from './constants.js';
import type { IssueSeverity } from './types.js';

/**
 * AI scoring output — PRD §10.4 / Appendix B, design §11.
 * Shaped for OpenAI strict structured outputs: every field required, objects `.strict()`,
 * enums are the only unions. Numeric bounds are re-validated after parse.
 */

const SCORE_MIN = 0;
const SCORE_MAX = 100;

export const issueSeveritySchema = z.enum(['high', 'medium', 'low']);
export const ideaMatchStatusSchema = z.enum(['enough', 'missing', 'off_topic']);

export const scoringIssueSchema = z
  .object({
    span: z.string(),
    severity: issueSeveritySchema,
    explanation_vi: z.string(),
    suggestion_en: z.string(),
  })
  .strict();

export const scoringOutputSchema = z
  .object({
    overall_score: z.number().int().min(SCORE_MIN).max(SCORE_MAX),
    idea_match: z.object({ status: ideaMatchStatusSchema, comment_vi: z.string() }).strict(),
    used_required_words: z.array(
      z
        .object({
          headword: z.string(),
          used: z.boolean(),
          natural: z.boolean(),
          comment_vi: z.string(),
        })
        .strict(),
    ),
    grammar_issues: z.array(scoringIssueSchema),
    lexical_issues: z.array(scoringIssueSchema),
    naturalness_note_vi: z.string(),
    model_rewrite_en: z.string(),
    encouragement_vi: z.string(),
  })
  .strict();

export type ScoringOutput = z.infer<typeof scoringOutputSchema>;
type ScoringIssue = z.infer<typeof scoringIssueSchema>;

export interface DisplayIssue {
  kind: 'grammar' | 'lexical';
  span: string;
  severity: IssueSeverity;
  explanationVi: string;
  suggestionEn: string;
}

/** Lower rank is shown first — PRD §10.4 "high trước, rồi severity khác cho đủ 3". */
const SEVERITY_RANK: Readonly<Record<IssueSeverity, number>> = { high: 0, medium: 1, low: 2 };

function toDisplayIssue(kind: DisplayIssue['kind'], issue: ScoringIssue): DisplayIssue {
  return {
    kind,
    span: issue.span,
    severity: issue.severity,
    explanationVi: issue.explanation_vi,
    suggestionEn: issue.suggestion_en,
  };
}

/**
 * Merge grammar + lexical issues, all `high` first, then `medium`, then `low`.
 * Within one severity the order is stable: grammar issues before lexical, each in original order.
 */
export function pickDisplayIssues(
  output: Pick<ScoringOutput, 'grammar_issues' | 'lexical_issues'>,
  max: number = REWRITE.DISPLAY_ISSUES_MAX,
): DisplayIssue[] {
  const merged: DisplayIssue[] = [
    ...output.grammar_issues.map((issue) => toDisplayIssue('grammar', issue)),
    ...output.lexical_issues.map((issue) => toDisplayIssue('lexical', issue)),
  ];
  merged.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return merged.slice(0, Math.max(0, max));
}

/** lower(trim) with inner whitespace collapsed — used for every headword comparison. */
export function normalizeHeadword(headword: string): string {
  return headword.trim().replace(/\s+/g, ' ').toLowerCase();
}

export type UsedWordsValidation =
  | { ok: true }
  | {
      ok: false;
      reason: 'count_mismatch' | 'headword_mismatch' | 'duplicate_headword';
      details: Record<string, unknown>;
    };

/**
 * PRD §10.4 / design §11: exactly one `used_required_words` entry per target headword
 * (compared after `normalizeHeadword`), no extras, no duplicates. Failing this is `LLM_INVALID_SCHEMA`.
 */
export function validateUsedWordsOneToOne(
  output: Pick<ScoringOutput, 'used_required_words'>,
  targetHeadwords: readonly string[],
): UsedWordsValidation {
  const targets = new Set(targetHeadwords.map(normalizeHeadword));
  const actual = output.used_required_words.map((entry) => normalizeHeadword(entry.headword));

  if (actual.length !== targets.size) {
    return {
      ok: false,
      reason: 'count_mismatch',
      details: { expected: targets.size, actual: actual.length },
    };
  }

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const headword of actual) {
    if (seen.has(headword) && !duplicates.includes(headword)) duplicates.push(headword);
    seen.add(headword);
  }
  if (duplicates.length > 0) {
    return { ok: false, reason: 'duplicate_headword', details: { duplicates } };
  }

  const missing = [...targets].filter((target) => !seen.has(target));
  const extra = actual.filter((headword) => !targets.has(headword));
  if (missing.length > 0 || extra.length > 0) {
    return { ok: false, reason: 'headword_mismatch', details: { missing, extra } };
  }

  return { ok: true };
}
