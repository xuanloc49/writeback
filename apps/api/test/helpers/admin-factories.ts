import type { PrismaService } from '../../src/prisma/prisma.service';

/** Import document builders (PRD Appendix A) and row counters for admin content/import tests. */

export interface ImportTopicInput {
  slug: string;
  name_vi: string;
}

export interface ImportLemmaInput {
  headword: string;
  sense_vi: string;
  topic_slug: string;
  pos?: string;
  phonetic?: string;
  example_en?: string;
  notes_vi?: string;
  included_in_free?: boolean;
  cefr?: string;
}

export interface ImportPromptInput {
  external_key: string;
  text_vi: string;
  topic_slug: string;
  target_headwords: string[];
  sample_en?: string;
  hints_vi?: string;
}

export interface ImportDocumentInput {
  schema_version?: number;
  strict?: boolean;
  topics?: ImportTopicInput[];
  lemmas?: ImportLemmaInput[];
  prompts?: ImportPromptInput[];
}

export function importDocument(input: ImportDocumentInput = {}): Record<string, unknown> {
  return {
    schema_version: input.schema_version ?? 1,
    strict: input.strict ?? false,
    ...(input.topics !== undefined ? { topics: input.topics } : {}),
    ...(input.lemmas !== undefined ? { lemmas: input.lemmas } : {}),
    ...(input.prompts !== undefined ? { prompts: input.prompts } : {}),
  };
}

/** A small self-contained valid document: one topic, two lemmas, two prompts covering both. */
export function sampleImportDocument(overrides: ImportDocumentInput = {}): Record<string, unknown> {
  return importDocument({
    topics: [{ slug: 'office', name_vi: 'Công sở' }],
    lemmas: [
      {
        headword: 'deadline',
        sense_vi: 'hạn chót',
        topic_slug: 'office',
        example_en: 'We met the deadline.',
        included_in_free: true,
      },
      {
        headword: 'agenda',
        sense_vi: 'chương trình họp',
        topic_slug: 'office',
        example_en: 'Please send the agenda.',
      },
    ],
    prompts: [
      {
        external_key: 'office-001',
        text_vi: 'Chúng tôi đã gửi chương trình họp trước hạn chót.',
        topic_slug: 'office',
        target_headwords: ['deadline', 'agenda'],
        sample_en: 'We sent the agenda before the deadline.',
      },
      {
        external_key: 'office-002',
        text_vi: 'Hạn chót và chương trình họp đều được xác nhận.',
        topic_slug: 'office',
        target_headwords: ['agenda', 'deadline'],
        sample_en: 'Both the deadline and the agenda were confirmed.',
      },
    ],
    ...overrides,
  });
}

export interface ContentRowCounts {
  topics: number;
  lemmas: number;
  prompts: number;
  promptLemmas: number;
}

export async function countContentRows(prisma: PrismaService): Promise<ContentRowCounts> {
  const [topics, lemmas, prompts, promptLemmas] = await Promise.all([
    prisma.topic.count(),
    prisma.lemma.count(),
    prisma.prompt.count(),
    prisma.promptLemma.count(),
  ]);
  return { topics, lemmas, prompts, promptLemmas };
}

export async function auditRows(
  prisma: PrismaService,
  action: string,
): Promise<
  { actorId: string | null; targetType: string; targetId: string | null; props: unknown }[]
> {
  return prisma.auditLog.findMany({
    where: { action },
    orderBy: { createdAt: 'asc' },
    select: { actorId: true, targetType: true, targetId: true, props: true },
  });
}
