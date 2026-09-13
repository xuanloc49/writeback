import {
  CONTENT,
  importLemmaSchema,
  importPromptSchema,
  importTopicSchema,
} from '@writeback/shared';
import { z } from 'zod';

/** Field rules are shared with the import schema (PRD Appendix A) so manual CRUD and import agree. */
const slugSchema = importTopicSchema.shape.slug;
const nameViSchema = importTopicSchema.shape.name_vi;
const headwordSchema = importLemmaSchema.shape.headword;
const senseViSchema = importLemmaSchema.shape.sense_vi;
const cefrSchema = importLemmaSchema.shape.cefr;
const externalKeySchema = importPromptSchema.shape.external_key;

const QUERY_MAX_LENGTH = 200;
const optionalText = z.string().optional();
const nullableText = z.string().nullable().optional();
const contentStatusSchema = z.enum(['draft', 'published']);
/** Query strings carry booleans as text; `ZodValidationPipe` needs input = output, so no transform. */
const booleanQuery = z.enum(['true', 'false']);
const searchQuery = z.string().trim().min(1).max(QUERY_MAX_LENGTH).optional();

function atLeastOneField(value: Record<string, unknown>): boolean {
  return Object.values(value).some((field) => field !== undefined);
}
const AT_LEAST_ONE_FIELD = { message: 'Cần ít nhất một trường để cập nhật' };

// ---- Topics -------------------------------------------------------------------------------

export const listTopicsQuerySchema = z
  .object({ status: contentStatusSchema.optional(), q: searchQuery })
  .strict();
export type ListTopicsQuery = z.infer<typeof listTopicsQuerySchema>;

export const createTopicSchema = z.object({ slug: slugSchema, nameVi: nameViSchema }).strict();
export type CreateTopicBody = z.infer<typeof createTopicSchema>;

export const updateTopicSchema = z
  .object({ slug: slugSchema.optional(), nameVi: nameViSchema.optional() })
  .strict()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);
export type UpdateTopicBody = z.infer<typeof updateTopicSchema>;

// ---- Lemmas -------------------------------------------------------------------------------

export const LEMMA_SORT_KEYS = ['headword', 'createdAt', 'updatedAt'] as const;
export type LemmaSortKey = (typeof LEMMA_SORT_KEYS)[number];

export const listLemmasQuerySchema = z
  .object({
    topicId: z.string().uuid().optional(),
    status: contentStatusSchema.optional(),
    includedInFree: booleanQuery.optional(),
    q: searchQuery,
    sort: z.enum(LEMMA_SORT_KEYS).optional(),
  })
  .strict();
export type ListLemmasQuery = z.infer<typeof listLemmasQuerySchema>;

export const createLemmaSchema = z
  .object({
    headword: headwordSchema,
    pos: optionalText,
    phonetic: optionalText,
    senseVi: senseViSchema,
    exampleEn: optionalText,
    notesVi: optionalText,
    topicId: z.string().uuid(),
    includedInFree: z.boolean().optional(),
    cefr: cefrSchema,
  })
  .strict();
export type CreateLemmaBody = z.infer<typeof createLemmaSchema>;

export const updateLemmaSchema = z
  .object({
    headword: headwordSchema.optional(),
    pos: nullableText,
    phonetic: nullableText,
    senseVi: senseViSchema.optional(),
    exampleEn: nullableText,
    notesVi: nullableText,
    topicId: z.string().uuid().optional(),
    includedInFree: z.boolean().optional(),
    cefr: cefrSchema.nullable(),
  })
  .strict()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);
export type UpdateLemmaBody = z.infer<typeof updateLemmaSchema>;

// ---- Prompts ------------------------------------------------------------------------------

export const listPromptsQuerySchema = z
  .object({
    topicId: z.string().uuid().optional(),
    status: contentStatusSchema.optional(),
    q: searchQuery,
  })
  .strict();
export type ListPromptsQuery = z.infer<typeof listPromptsQuerySchema>;

const targetLemmaIdsSchema = z
  .array(z.string().uuid())
  .min(CONTENT.PROMPT_TARGETS_MIN)
  .max(CONTENT.PROMPT_TARGETS_MAX)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'targetLemmaIds must be distinct',
  });

const textViSchema = z.string().min(1).max(CONTENT.PROMPT_TEXT_VI_MAX_LENGTH);

export const createPromptSchema = z
  .object({
    externalKey: externalKeySchema.optional(),
    textVi: textViSchema,
    topicId: z.string().uuid(),
    targetLemmaIds: targetLemmaIdsSchema,
    sampleEn: optionalText,
    hintsVi: optionalText,
  })
  .strict();
export type CreatePromptBody = z.infer<typeof createPromptSchema>;

export const updatePromptSchema = z
  .object({
    externalKey: externalKeySchema.nullable().optional(),
    textVi: textViSchema.optional(),
    topicId: z.string().uuid().optional(),
    targetLemmaIds: targetLemmaIdsSchema.optional(),
    sampleEn: nullableText,
    hintsVi: nullableText,
  })
  .strict()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);
export type UpdatePromptBody = z.infer<typeof updatePromptSchema>;

// ---- Views --------------------------------------------------------------------------------

export interface TopicContextView {
  lemmaCounts: { draft: number; published: number };
  promptCounts: { draft: number; published: number };
  blockers: { lemmaId: string; headword: string; publishedPromptCount: number }[];
}
