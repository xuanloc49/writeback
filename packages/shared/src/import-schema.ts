import { z } from 'zod';
import { CONTENT } from './constants.js';
import { normalizeHeadword } from './scoring.js';

/**
 * JSON import schema v1 — PRD Appendix A.
 * All item objects are `.strict()`: unknown fields (e.g. `published`, `status`) are rejected,
 * because every imported item always lands as `draft` (PRD §10.10).
 */

const SLUG_MAX_LENGTH = 64;
const NAME_VI_MAX_LENGTH = 200;
const HEADWORD_MAX_LENGTH = 100;
const SENSE_VI_MAX_LENGTH = 300;
const EXTERNAL_KEY_MAX_LENGTH = 100;
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slugSchema = z.string().min(1).max(SLUG_MAX_LENGTH).regex(KEBAB_CASE, 'slug must be kebab-case');
const headwordSchema = z.string().min(1).max(HEADWORD_MAX_LENGTH);

export const cefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

export const importTopicSchema = z
  .object({
    slug: slugSchema,
    name_vi: z.string().min(1).max(NAME_VI_MAX_LENGTH),
  })
  .strict();

export const importLemmaSchema = z
  .object({
    headword: headwordSchema,
    pos: z.string().optional(),
    phonetic: z.string().optional(),
    sense_vi: z.string().min(1).max(SENSE_VI_MAX_LENGTH),
    example_en: z.string().optional(),
    notes_vi: z.string().optional(),
    topic_slug: slugSchema,
    included_in_free: z.boolean().default(false),
    cefr: cefrLevelSchema.optional(),
  })
  .strict();

function hasNoDuplicateHeadwords(headwords: readonly string[]): boolean {
  return new Set(headwords.map(normalizeHeadword)).size === headwords.length;
}

export const importPromptSchema = z
  .object({
    external_key: z.string().min(1).max(EXTERNAL_KEY_MAX_LENGTH),
    text_vi: z.string().min(1).max(CONTENT.PROMPT_TEXT_VI_MAX_LENGTH),
    topic_slug: slugSchema,
    target_headwords: z
      .array(headwordSchema)
      .min(CONTENT.PROMPT_TARGETS_MIN)
      .max(CONTENT.PROMPT_TARGETS_MAX)
      .refine(hasNoDuplicateHeadwords, { message: 'target_headwords must not contain duplicates' }),
    sample_en: z.string().optional(),
    hints_vi: z.string().optional(),
  })
  .strict();

export const importDocumentSchema = z
  .object({
    schema_version: z.literal(CONTENT.IMPORT_SCHEMA_VERSION),
    strict: z.boolean().default(false),
    topics: z.array(importTopicSchema).optional(),
    lemmas: z.array(importLemmaSchema).optional(),
    prompts: z.array(importPromptSchema).optional(),
  })
  .strict();

export type ImportTopic = z.infer<typeof importTopicSchema>;
export type ImportLemma = z.infer<typeof importLemmaSchema>;
export type ImportPrompt = z.infer<typeof importPromptSchema>;
export type ImportDocument = z.infer<typeof importDocumentSchema>;
