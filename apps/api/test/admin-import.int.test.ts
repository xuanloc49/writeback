import { CONTENT } from '@writeback/shared';
import { createTestApp, type TestApp } from './helpers/app';
import {
  auditRows,
  countContentRows,
  importDocument,
  sampleImportDocument,
} from './helpers/admin-factories';
import { flushRedis, resetDatabase } from './helpers/db';
import { createLemma, createTopic, createUser } from './helpers/factories';

interface Issue {
  type: string;
  index: number | null;
  key: string | null;
  field: string | null;
  code: string;
}

describe('Admin import API (integration)', () => {
  let t: TestApp;
  let editor: string;

  beforeAll(async () => {
    t = await createTestApp();
    await flushRedis(t.config.redisUrl);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    editor = (await createUser(t.prisma, { role: 'editor' })).cookie;
  });

  afterAll(async () => {
    await t.close();
  });

  const dryRun = (doc: unknown, query = '') =>
    t.http
      .post(`/v1/admin/import/dry-run${query}`)
      .set('Cookie', editor)
      .send(doc as object);
  const commit = (batchId: string) =>
    t.http.post('/v1/admin/import/commit').set('Cookie', editor).send({ batchId });
  const publishAll = (batchId: string) =>
    t.http.post(`/v1/admin/import/${batchId}/publish-all`).set('Cookie', editor);
  const findIssue = (issues: Issue[], code: string, key?: string) =>
    issues.find((issue) => issue.code === code && (key === undefined || issue.key === key));

  describe('RBAC', () => {
    it.each(['user', 'support'] as const)('%s gets 403 on dry-run', async (role) => {
      const { cookie } = await createUser(t.prisma, { role });
      const res = await t.http
        .post('/v1/admin/import/dry-run')
        .set('Cookie', cookie)
        .send(sampleImportDocument());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await t.prisma.importBatch.count()).toBe(0);
    });
  });

  describe('dry-run', () => {
    it('reports counts/warnings for a clean file, persists a batch, writes no content', async () => {
      const res = await dryRun(sampleImportDocument(), '?filename=office.json');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.errors).toEqual([]);
      expect(res.body.warnings).toEqual([]);
      expect(res.body.counts).toEqual({
        topics: { create: 1, update: 0 },
        lemmas: { create: 2, update: 0 },
        prompts: { create: 2, update: 0 },
      });
      expect(await countContentRows(t.prisma)).toEqual({
        topics: 0,
        lemmas: 0,
        prompts: 0,
        promptLemmas: 0,
      });

      const batch = await t.prisma.importBatch.findUniqueOrThrow({
        where: { id: res.body.batchId },
      });
      expect(batch).toMatchObject({
        filename: 'office.json',
        schemaVersion: 1,
        strict: false,
        committedAt: null,
      });
      expect((batch.result as { document: unknown }).document).toEqual(sampleImportDocument());
      const events = await t.prisma.analyticsEvent.findMany({
        where: { name: 'admin_import_dry_run' },
      });
      expect(events).toHaveLength(1);
    });

    it('reports row-level errors and warnings (PRD Appendix A) without a 422', async () => {
      const dbTopic = await createTopic(t.prisma);
      await createLemma(t.prisma, { topicId: dbTopic.id, headword: 'invoice', senseVi: 'hóa đơn' });
      const doc = importDocument({
        topics: [{ slug: 'office', name_vi: 'Công sở' }],
        lemmas: [
          { headword: 'deadline', sense_vi: 'hạn chót', topic_slug: 'office' },
          {
            headword: 'Invoice',
            sense_vi: 'hoá đơn thanh toán',
            topic_slug: dbTopic.slug,
            example_en: 'Send the invoice.',
          },
          { headword: 'ghost', sense_vi: 'x', topic_slug: 'nope', example_en: 'x' },
          { headword: 'deadline', sense_vi: 'lặp', topic_slug: 'office', example_en: 'x' },
          { headword: 'broken', topic_slug: 'office' } as never,
        ],
        prompts: [
          {
            external_key: 'p-1',
            text_vi: 'Câu 1',
            topic_slug: 'office',
            target_headwords: ['deadline', 'invoice'],
          },
          {
            external_key: 'p-2',
            text_vi: 'Câu 2',
            topic_slug: 'office',
            target_headwords: ['deadline', 'missing-word'],
            sample_en: 'S',
          },
          {
            external_key: 'p-1',
            text_vi: 'Câu 3',
            topic_slug: 'office',
            target_headwords: ['deadline', 'invoice'],
            sample_en: 'S',
          },
          {
            external_key: 'p-4',
            text_vi: 'a'.repeat(CONTENT.PROMPT_TEXT_VI_MAX_LENGTH + 1),
            topic_slug: 'office',
            target_headwords: ['deadline', 'invoice'],
            sample_en: 'S',
          },
          {
            external_key: 'p-5',
            text_vi: 'Câu 5',
            topic_slug: 'office',
            target_headwords: ['deadline', 'invoice'],
            sample_en: 'S',
            published: true,
          } as never,
        ],
      });
      const res = await dryRun(doc);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true); // non-strict: report only
      const errors: Issue[] = res.body.errors;
      const warnings: Issue[] = res.body.warnings;

      expect(findIssue(errors, 'unknown_topic_slug', 'ghost')).toMatchObject({
        type: 'lemma',
        index: 2,
      });
      expect(findIssue(errors, 'duplicate_in_file', 'deadline')).toMatchObject({
        type: 'lemma',
        index: 3,
      });
      expect(findIssue(errors, 'schema', 'broken')).toMatchObject({
        type: 'lemma',
        index: 4,
        field: 'sense_vi',
      });
      expect(findIssue(errors, 'target_not_found', 'p-2')).toMatchObject({
        type: 'prompt',
        index: 1,
      });
      expect(findIssue(errors, 'duplicate_in_file', 'p-1')).toMatchObject({
        type: 'prompt',
        index: 2,
      });
      expect(findIssue(errors, 'schema', 'p-4')).toMatchObject({
        type: 'prompt',
        field: 'text_vi',
      });
      expect(findIssue(errors, 'schema', 'p-5')).toMatchObject({ type: 'prompt', index: 4 });

      expect(findIssue(warnings, 'update', 'Invoice')).toMatchObject({ type: 'lemma', index: 1 });
      expect(findIssue(warnings, 'example_en_missing', 'deadline')).toMatchObject({ index: 0 });
      expect(findIssue(warnings, 'sample_en_missing', 'p-1')).toMatchObject({ index: 0 });
      expect(findIssue(warnings, 'thin_context', 'deadline')).toBeDefined();
      expect(findIssue(warnings, 'thin_context', 'Invoice')).toBeDefined();

      expect(res.body.counts).toEqual({
        topics: { create: 1, update: 0 },
        lemmas: { create: 1, update: 1 },
        prompts: { create: 1, update: 0 },
      });
      expect(await countContentRows(t.prisma)).toEqual({
        topics: 1,
        lemmas: 1,
        prompts: 0,
        promptLemmas: 0,
      });
    });

    it('reports a document-level error for an unsupported schema_version', async () => {
      const res = await dryRun(importDocument({ schema_version: 2, topics: [] }));
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.errors[0]).toMatchObject({ type: 'document', field: 'schema_version' });
    });

    it('rejects a body above CONTENT.IMPORT_MAX_BYTES with 413 PAYLOAD_TOO_LARGE', async () => {
      const filler = 'x'.repeat(CONTENT.IMPORT_MAX_BYTES);
      const res = await t.http
        .post('/v1/admin/import/dry-run')
        .set('Cookie', editor)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ schema_version: 1, filler }));
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('commit', () => {
    it('writes drafts only, links targets in order, audits import.commit, and refuses a second commit', async () => {
      const dry = await dryRun(sampleImportDocument());
      const res = await commit(dry.body.batchId);
      expect(res.status).toBe(200);
      expect(res.body.counts.lemmas).toEqual({ create: 2, update: 0 });

      const topics = await t.prisma.topic.findMany();
      const lemmas = await t.prisma.lemma.findMany({ orderBy: { headwordNormalized: 'asc' } });
      const prompts = await t.prisma.prompt.findMany({
        include: { lemmaLinks: { orderBy: { sortOrder: 'asc' } } },
      });
      expect(topics.map((topic) => topic.status)).toEqual(['draft']);
      expect(lemmas.map((lemma) => lemma.status)).toEqual(['draft', 'draft']);
      expect(prompts.map((prompt) => prompt.status)).toEqual(['draft', 'draft']);
      expect(lemmas.map((lemma) => [lemma.headwordNormalized, lemma.includedInFree])).toEqual([
        ['agenda', false],
        ['deadline', true],
      ]);
      const second = prompts.find((prompt) => prompt.externalKey === 'office-002');
      const byHeadword = new Map(lemmas.map((lemma) => [lemma.headwordNormalized, lemma.id]));
      expect(second?.lemmaLinks.map((link) => link.lemmaId)).toEqual([
        byHeadword.get('agenda'),
        byHeadword.get('deadline'),
      ]);

      const batch = await t.prisma.importBatch.findUniqueOrThrow({
        where: { id: dry.body.batchId },
      });
      expect(batch.committedAt).not.toBeNull();
      const audit = await auditRows(t.prisma, 'import.commit');
      expect(audit).toEqual([
        expect.objectContaining({ targetType: 'import_batch', targetId: dry.body.batchId }),
      ]);
      expect(await t.prisma.analyticsEvent.count({ where: { name: 'admin_import_commit' } })).toBe(
        1,
      );

      const again = await commit(dry.body.batchId);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('CONFLICT');
    });

    it('upserts by alive headword / external_key: second commit updates sense_vi without duplicates', async () => {
      const first = await dryRun(sampleImportDocument());
      await commit(first.body.batchId);
      const updated = sampleImportDocument({
        lemmas: [{ headword: 'DEADLINE', sense_vi: 'thời hạn cuối', topic_slug: 'office' }],
        prompts: [
          {
            external_key: 'office-001',
            text_vi: 'Câu đã sửa.',
            topic_slug: 'office',
            target_headwords: ['agenda', 'deadline'],
            sample_en: 'Edited.',
          },
        ],
      });
      const dry = await dryRun(updated);
      expect(dry.body.counts).toEqual({
        topics: { create: 0, update: 1 },
        lemmas: { create: 0, update: 1 },
        prompts: { create: 0, update: 1 },
      });
      expect(findIssue(dry.body.warnings, 'update', 'DEADLINE')).toBeDefined();
      const res = await commit(dry.body.batchId);
      expect(res.status).toBe(200);

      const lemmas = await t.prisma.lemma.findMany({ where: { headwordNormalized: 'deadline' } });
      expect(lemmas).toHaveLength(1);
      expect(lemmas[0]).toMatchObject({
        senseVi: 'thời hạn cuối',
        exampleEn: 'We met the deadline.',
        includedInFree: true,
      });
      const prompts = await t.prisma.prompt.findMany({
        where: { externalKey: 'office-001' },
        include: { lemmaLinks: { orderBy: { sortOrder: 'asc' } } },
      });
      expect(prompts).toHaveLength(1);
      expect(prompts[0]?.textVi).toBe('Câu đã sửa.');
      expect(prompts[0]?.lemmaLinks).toHaveLength(2);
      expect(await t.prisma.topic.count()).toBe(1);
    });

    it('strict file with one error → 422 VALIDATION with the errors and nothing written', async () => {
      const doc = sampleImportDocument({
        strict: true,
        lemmas: [
          { headword: 'deadline', sense_vi: 'hạn chót', topic_slug: 'office', example_en: 'x' },
          {
            headword: 'agenda',
            sense_vi: 'chương trình',
            topic_slug: 'missing-topic',
            example_en: 'x',
          },
        ],
      });
      const dry = await dryRun(doc);
      expect(dry.status).toBe(200);
      expect(dry.body.ok).toBe(false);
      const res = await commit(dry.body.batchId);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(res.body.error.details.errors.length).toBeGreaterThan(0);
      expect(await countContentRows(t.prisma)).toEqual({
        topics: 0,
        lemmas: 0,
        prompts: 0,
        promptLemmas: 0,
      });
      expect(await auditRows(t.prisma, 'import.commit')).toEqual([]);
    });

    it('non-strict commit skips rows with errors and writes the rest', async () => {
      const doc = sampleImportDocument({
        lemmas: [
          { headword: 'deadline', sense_vi: 'hạn chót', topic_slug: 'office', example_en: 'x' },
          {
            headword: 'agenda',
            sense_vi: 'chương trình',
            topic_slug: 'missing-topic',
            example_en: 'x',
          },
        ],
      });
      const dry = await dryRun(doc);
      const res = await commit(dry.body.batchId);
      expect(res.status).toBe(200);
      const rows = await countContentRows(t.prisma);
      expect(rows.lemmas).toBe(1);
      expect(rows.prompts).toBe(0); // both prompts target `agenda`, which was skipped
    });

    it('returns 404 for an unknown batch', async () => {
      const res = await commit('00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(404);
    });
  });

  describe('publish-all', () => {
    it('publishes lemmas then prompts with the AdminContent rules, lists failures, audits successes', async () => {
      const doc = sampleImportDocument({
        prompts: [
          {
            external_key: 'ok',
            text_vi: 'Câu ổn.',
            topic_slug: 'office',
            target_headwords: ['deadline', 'agenda'],
            sample_en: 'Fine.',
          },
          {
            external_key: 'no-sample',
            text_vi: 'Thiếu mẫu.',
            topic_slug: 'office',
            target_headwords: ['deadline', 'agenda'],
          },
        ],
      });
      const dry = await dryRun(doc);
      const notCommitted = await publishAll(dry.body.batchId);
      expect(notCommitted.status).toBe(409);
      await commit(dry.body.batchId);

      const res = await publishAll(dry.body.batchId);
      expect(res.status).toBe(200);
      const lemmas = await t.prisma.lemma.findMany();
      const okPrompt = await t.prisma.prompt.findFirstOrThrow({ where: { externalKey: 'ok' } });
      const noSample = await t.prisma.prompt.findFirstOrThrow({
        where: { externalKey: 'no-sample' },
      });
      expect(lemmas.every((lemma) => lemma.status === 'published')).toBe(true);
      expect(okPrompt.status).toBe('published');
      expect(noSample.status).toBe('draft');
      expect(res.body.published).toEqual(
        expect.arrayContaining([
          ...lemmas.map((lemma) => ({ type: 'lemma', id: lemma.id })),
          { type: 'prompt', id: okPrompt.id },
        ]),
      );
      expect(res.body.failed).toEqual([
        { type: 'prompt', id: noSample.id, reasons: ['sample_en_missing'] },
      ]);
      expect(await auditRows(t.prisma, 'content.publish')).toHaveLength(3);
    });
  });
});
