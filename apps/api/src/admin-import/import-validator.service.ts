import { Injectable } from '@nestjs/common';
import {
  CONTENT,
  importDocumentSchema,
  importLemmaSchema,
  importPromptSchema,
  importTopicSchema,
  normalizeHeadword,
  type ImportLemma,
  type ImportPrompt,
  type ImportTopic,
} from '@writeback/shared';
import { z, type ZodIssue, type ZodTypeAny } from 'zod';
import { isBlank } from '../admin-content/publish-rules';
import { PrismaService } from '../prisma/prisma.service';
import type { ImportCounts, ImportIssue, ImportItemType } from './admin-import.dto';

/**
 * Root shape only (arrays left opaque) so each item can be validated on its own and reported
 * as a line-level error instead of failing the whole document.
 */
const rootSchema = importDocumentSchema.extend({
  topics: z.array(z.unknown()).optional(),
  lemmas: z.array(z.unknown()).optional(),
  prompts: z.array(z.unknown()).optional(),
});

export const ISSUE_CODES = {
  SCHEMA: 'schema',
  DUPLICATE_IN_FILE: 'duplicate_in_file',
  UNKNOWN_TOPIC_SLUG: 'unknown_topic_slug',
  TARGET_NOT_FOUND: 'target_not_found',
  UPDATE: 'update',
  EXAMPLE_EN_MISSING: 'example_en_missing',
  SAMPLE_EN_MISSING: 'sample_en_missing',
  THIN_CONTEXT: 'thin_context',
} as const;

const MESSAGES_VI = {
  duplicateSlug: 'Trùng slug trong file.',
  duplicateHeadword: 'Trùng headword trong file.',
  duplicateExternalKey: 'Trùng external_key trong file.',
  unknownTopic: 'Không tìm thấy topic_slug trong file hoặc CSDL.',
  targetNotFound: (headword: string): string =>
    `Không tìm thấy target_headword "${headword}" trong file hoặc CSDL.`,
  update: 'Headword đã tồn tại với sense_vi khác — sẽ ghi đè các trường được cung cấp.',
  exampleMissing: 'Thiếu example_en — không publish được cho đến khi có example.',
  sampleMissing: 'Thiếu sample_en — không publish được cho đến khi có sample.',
  thinContext: (count: number): string =>
    `Ngữ cảnh mỏng: lemma chỉ xuất hiện trên ${count} prompt (cần ≥ ${CONTENT.MIN_PROMPTS_PER_PUBLISHED_LEMMA}).`,
} as const;

export interface ResolvedTopic {
  index: number;
  item: ImportTopic;
  existingId: string | null;
}

export interface ResolvedLemma {
  index: number;
  item: ImportLemma;
  /** Raw object as sent, used to tell "field omitted" from "field defaulted" on update. */
  raw: Record<string, unknown>;
  headwordNormalized: string;
  existingId: string | null;
}

export interface ResolvedPrompt {
  index: number;
  item: ImportPrompt;
  targetHeadwordsNormalized: string[];
  existingId: string | null;
}

export interface ValidationOutcome {
  /** False when the document root itself is invalid; nothing can be committed. */
  rootOk: boolean;
  strict: boolean;
  schemaVersion: number | null;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  counts: ImportCounts;
  /** Only items free of row errors (the ones a commit would write). */
  topics: ResolvedTopic[];
  lemmas: ResolvedLemma[];
  prompts: ResolvedPrompt[];
  /** Alive DB rows referenced by the file, keyed by slug / headword_normalized. */
  dbTopicIds: Map<string, string>;
  dbLemmaIds: Map<string, string>;
}

interface DbLemma {
  id: string;
  senseVi: string;
}

/** Resolves an import document against the file itself and alive DB rows (PRD Appendix A). */
@Injectable()
export class ImportValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(raw: unknown): Promise<ValidationOutcome> {
    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    const counts = emptyCounts();
    const root = rootSchema.safeParse(raw);
    if (!root.success) {
      errors.push(...schemaIssues('document', null, null, root.error.issues));
      return {
        rootOk: false,
        strict: readStrict(raw),
        schemaVersion: readSchemaVersion(raw),
        errors,
        warnings,
        counts,
        topics: [],
        lemmas: [],
        prompts: [],
        dbTopicIds: new Map(),
        dbLemmaIds: new Map(),
      };
    }

    const topicItems = parseItems('topic', importTopicSchema, root.data.topics ?? [], errors);
    const lemmaItems = parseItems('lemma', importLemmaSchema, root.data.lemmas ?? [], errors);
    const promptItems = parseItems('prompt', importPromptSchema, root.data.prompts ?? [], errors);

    const referencedSlugs = new Set<string>([
      ...topicItems.map(({ item }) => item.slug),
      ...lemmaItems.map(({ item }) => item.topic_slug),
      ...promptItems.map(({ item }) => item.topic_slug),
    ]);
    const referencedHeadwords = new Set<string>([
      ...lemmaItems.map(({ item }) => normalizeHeadword(item.headword)),
      ...promptItems.flatMap(({ item }) => item.target_headwords.map(normalizeHeadword)),
    ]);
    const fileExternalKeys = promptItems.map(({ item }) => item.external_key);
    const [dbTopicIds, dbLemmas, dbPromptIds] = await Promise.all([
      this.loadTopics([...referencedSlugs]),
      this.loadLemmas([...referencedHeadwords]),
      this.loadPrompts(fileExternalKeys),
    ]);

    // Topics: duplicates in file, then create/update.
    const topics: ResolvedTopic[] = [];
    const seenSlugs = new Set<string>();
    for (const { index, item } of topicItems) {
      if (seenSlugs.has(item.slug)) {
        errors.push(
          issue(
            'topic',
            index,
            item.slug,
            'slug',
            ISSUE_CODES.DUPLICATE_IN_FILE,
            MESSAGES_VI.duplicateSlug,
          ),
        );
        continue;
      }
      seenSlugs.add(item.slug);
      const existingId = dbTopicIds.get(item.slug) ?? null;
      bump(counts.topics, existingId);
      topics.push({ index, item, existingId });
    }
    const knownSlugs = new Set<string>([...seenSlugs, ...dbTopicIds.keys()]);

    // Lemmas: duplicates, unknown topic, update marker, missing example.
    const lemmas: ResolvedLemma[] = [];
    const seenHeadwords = new Set<string>();
    for (const { index, item, raw: rawItem } of lemmaItems) {
      const headwordNormalized = normalizeHeadword(item.headword);
      if (seenHeadwords.has(headwordNormalized)) {
        errors.push(
          issue(
            'lemma',
            index,
            item.headword,
            'headword',
            ISSUE_CODES.DUPLICATE_IN_FILE,
            MESSAGES_VI.duplicateHeadword,
          ),
        );
        continue;
      }
      seenHeadwords.add(headwordNormalized);
      if (!knownSlugs.has(item.topic_slug)) {
        errors.push(
          issue(
            'lemma',
            index,
            item.headword,
            'topic_slug',
            ISSUE_CODES.UNKNOWN_TOPIC_SLUG,
            MESSAGES_VI.unknownTopic,
          ),
        );
        continue;
      }
      const existing = dbLemmas.get(headwordNormalized) ?? null;
      if (existing !== null && existing.senseVi !== item.sense_vi) {
        warnings.push(
          issue('lemma', index, item.headword, 'sense_vi', ISSUE_CODES.UPDATE, MESSAGES_VI.update),
        );
      }
      if (isBlank(item.example_en)) {
        warnings.push(
          issue(
            'lemma',
            index,
            item.headword,
            'example_en',
            ISSUE_CODES.EXAMPLE_EN_MISSING,
            MESSAGES_VI.exampleMissing,
          ),
        );
      }
      bump(counts.lemmas, existing?.id ?? null);
      lemmas.push({
        index,
        item,
        raw: rawItem,
        headwordNormalized,
        existingId: existing?.id ?? null,
      });
    }
    // Only lemmas that will actually be written (plus alive DB rows) can be prompt targets.
    const knownHeadwords = new Set<string>([
      ...lemmas.map((lemma) => lemma.headwordNormalized),
      ...dbLemmas.keys(),
    ]);

    // Prompts: duplicates, unknown topic, unresolved targets, missing sample.
    const prompts: ResolvedPrompt[] = [];
    const seenKeys = new Set<string>();
    for (const { index, item } of promptItems) {
      if (seenKeys.has(item.external_key)) {
        errors.push(
          issue(
            'prompt',
            index,
            item.external_key,
            'external_key',
            ISSUE_CODES.DUPLICATE_IN_FILE,
            MESSAGES_VI.duplicateExternalKey,
          ),
        );
        continue;
      }
      seenKeys.add(item.external_key);
      if (!knownSlugs.has(item.topic_slug)) {
        errors.push(
          issue(
            'prompt',
            index,
            item.external_key,
            'topic_slug',
            ISSUE_CODES.UNKNOWN_TOPIC_SLUG,
            MESSAGES_VI.unknownTopic,
          ),
        );
        continue;
      }
      const missing = item.target_headwords.filter(
        (headword) => !knownHeadwords.has(normalizeHeadword(headword)),
      );
      if (missing.length > 0) {
        for (const headword of missing) {
          errors.push(
            issue(
              'prompt',
              index,
              item.external_key,
              'target_headwords',
              ISSUE_CODES.TARGET_NOT_FOUND,
              MESSAGES_VI.targetNotFound(headword),
            ),
          );
        }
        continue;
      }
      if (isBlank(item.sample_en)) {
        warnings.push(
          issue(
            'prompt',
            index,
            item.external_key,
            'sample_en',
            ISSUE_CODES.SAMPLE_EN_MISSING,
            MESSAGES_VI.sampleMissing,
          ),
        );
      }
      const existingId = dbPromptIds.get(item.external_key) ?? null;
      bump(counts.prompts, existingId);
      prompts.push({
        index,
        item,
        targetHeadwordsNormalized: item.target_headwords.map(normalizeHeadword),
        existingId,
      });
    }

    // Thin context: file prompts + alive DB prompts not overridden by this file.
    const dbPromptCounts = await this.countDbPromptsPerLemma(
      lemmas.flatMap((lemma) => (lemma.existingId === null ? [] : [lemma.existingId])),
      new Set(seenKeys),
    );
    for (const lemma of lemmas) {
      const inFile = prompts.filter((prompt) =>
        prompt.targetHeadwordsNormalized.includes(lemma.headwordNormalized),
      ).length;
      const inDb = lemma.existingId === null ? 0 : (dbPromptCounts.get(lemma.existingId) ?? 0);
      const total = inFile + inDb;
      if (total < CONTENT.MIN_PROMPTS_PER_PUBLISHED_LEMMA) {
        warnings.push(
          issue(
            'lemma',
            lemma.index,
            lemma.item.headword,
            null,
            ISSUE_CODES.THIN_CONTEXT,
            MESSAGES_VI.thinContext(total),
          ),
        );
      }
    }

    return {
      rootOk: true,
      strict: root.data.strict,
      schemaVersion: root.data.schema_version,
      errors,
      warnings,
      counts,
      topics,
      lemmas,
      prompts,
      dbTopicIds,
      dbLemmaIds: new Map([...dbLemmas].map(([key, value]) => [key, value.id])),
    };
  }

  private async loadTopics(slugs: string[]): Promise<Map<string, string>> {
    if (slugs.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.topic.findMany({
      where: { slug: { in: slugs }, deletedAt: null },
      select: { id: true, slug: true },
    });
    return new Map(rows.map((row) => [row.slug, row.id]));
  }

  private async loadLemmas(headwordsNormalized: string[]): Promise<Map<string, DbLemma>> {
    if (headwordsNormalized.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.lemma.findMany({
      where: { headwordNormalized: { in: headwordsNormalized }, deletedAt: null },
      select: { id: true, headwordNormalized: true, senseVi: true },
    });
    return new Map(
      rows.map((row) => [row.headwordNormalized, { id: row.id, senseVi: row.senseVi }]),
    );
  }

  private async loadPrompts(externalKeys: string[]): Promise<Map<string, string>> {
    if (externalKeys.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.prompt.findMany({
      where: { externalKey: { in: externalKeys }, deletedAt: null },
      select: { id: true, externalKey: true },
    });
    return new Map(
      rows.flatMap((row) => (row.externalKey === null ? [] : [[row.externalKey, row.id]])),
    );
  }

  /** Alive DB prompts per lemma, excluding prompts this file will overwrite (by external_key). */
  private async countDbPromptsPerLemma(
    lemmaIds: string[],
    fileExternalKeys: Set<string>,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (lemmaIds.length === 0) {
      return counts;
    }
    const links = await this.prisma.promptLemma.findMany({
      where: { lemmaId: { in: lemmaIds }, prompt: { deletedAt: null } },
      select: { lemmaId: true, prompt: { select: { externalKey: true } } },
    });
    for (const link of links) {
      if (link.prompt.externalKey !== null && fileExternalKeys.has(link.prompt.externalKey)) {
        continue;
      }
      counts.set(link.lemmaId, (counts.get(link.lemmaId) ?? 0) + 1);
    }
    return counts;
  }
}

interface ParsedItem<T> {
  index: number;
  item: T;
  raw: Record<string, unknown>;
}

function parseItems<S extends ZodTypeAny>(
  type: ImportItemType,
  schema: S,
  rawItems: unknown[],
  errors: ImportIssue[],
): ParsedItem<z.output<S>>[] {
  const parsed: ParsedItem<z.output<S>>[] = [];
  rawItems.forEach((rawItem, index) => {
    const result = schema.safeParse(rawItem);
    if (!result.success) {
      errors.push(...schemaIssues(type, index, keyOf(type, rawItem), result.error.issues));
      return;
    }
    parsed.push({ index, item: result.data, raw: asRecord(rawItem) });
  });
  return parsed;
}

const KEY_FIELD: Record<ImportItemType, string | null> = {
  document: null,
  topic: 'slug',
  lemma: 'headword',
  prompt: 'external_key',
};

function keyOf(type: ImportItemType, rawItem: unknown): string | null {
  const field = KEY_FIELD[type];
  if (field === null) {
    return null;
  }
  const value = asRecord(rawItem)[field];
  return typeof value === 'string' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function schemaIssues(
  type: ImportItemType,
  index: number | null,
  key: string | null,
  issues: ZodIssue[],
): ImportIssue[] {
  return issues.map((zodIssue) =>
    issue(type, index, key, zodIssue.path.join('.') || null, ISSUE_CODES.SCHEMA, zodIssue.message),
  );
}

function issue(
  type: ImportItemType,
  index: number | null,
  key: string | null,
  field: string | null,
  code: string,
  message: string,
): ImportIssue {
  return { type, index, key, field, code, message };
}

function bump(counts: { create: number; update: number }, existingId: string | null): void {
  if (existingId === null) {
    counts.create += 1;
  } else {
    counts.update += 1;
  }
}

function emptyCounts(): ImportCounts {
  return {
    topics: { create: 0, update: 0 },
    lemmas: { create: 0, update: 0 },
    prompts: { create: 0, update: 0 },
  };
}

function readStrict(raw: unknown): boolean {
  return asRecord(raw).strict === true;
}

function readSchemaVersion(raw: unknown): number | null {
  const value = asRecord(raw).schema_version;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
