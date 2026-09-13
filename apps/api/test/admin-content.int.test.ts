import { createTestApp, type TestApp } from './helpers/app';
import { auditRows } from './helpers/admin-factories';
import { flushRedis, resetDatabase } from './helpers/db';
import { createLemma, createPrompt, createTopic, createUser } from './helpers/factories';

describe('Admin content API (integration)', () => {
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

  function lemmaBody(topicId: string, overrides: Record<string, unknown> = {}) {
    return {
      headword: 'Deadline',
      senseVi: 'hạn chót',
      topicId,
      exampleEn: 'We met the deadline.',
      ...overrides,
    };
  }

  describe('RBAC (design §6.1 step 5, PRD §7.2, §10.10 AC)', () => {
    it.each(['user', 'support'] as const)(
      '%s gets 403 FORBIDDEN on POST /admin/lemmas',
      async (role) => {
        const topic = await createTopic(t.prisma);
        const { cookie } = await createUser(t.prisma, { role });
        const res = await t.http
          .post('/v1/admin/lemmas')
          .set('Cookie', cookie)
          .send(lemmaBody(topic.id));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      },
    );

    it.each(['editor', 'admin'] as const)('%s can create a lemma (201, draft)', async (role) => {
      const topic = await createTopic(t.prisma);
      const { cookie } = await createUser(t.prisma, { role });
      const res = await t.http
        .post('/v1/admin/lemmas')
        .set('Cookie', cookie)
        .send(lemmaBody(topic.id));
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('draft');
      expect(res.body.headwordNormalized).toBe('deadline');
    });

    it('returns 401 without a session and 403 TOS_REQUIRED for staff without ToS', async () => {
      const topic = await createTopic(t.prisma);
      const anon = await t.http.post('/v1/admin/lemmas').send(lemmaBody(topic.id));
      expect(anon.status).toBe(401);
      const { cookie } = await createUser(t.prisma, { role: 'editor', tosAccepted: false });
      const res = await t.http.get('/v1/admin/topics').set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TOS_REQUIRED');
    });
  });

  describe('topics', () => {
    it('creates, lists (drafts included), updates, publishes with audit, and rejects duplicate slug', async () => {
      const created = await t.http
        .post('/v1/admin/topics')
        .set('Cookie', editor)
        .send({ slug: 'office', nameVi: 'Công sở' });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('draft');

      const dup = await t.http
        .post('/v1/admin/topics')
        .set('Cookie', editor)
        .send({ slug: 'office', nameVi: 'Khác' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('CONFLICT');

      const badSlug = await t.http
        .post('/v1/admin/topics')
        .set('Cookie', editor)
        .send({ slug: 'Not Kebab', nameVi: 'x' });
      expect(badSlug.status).toBe(422);

      const list = await t.http.get('/v1/admin/topics?status=draft&q=off').set('Cookie', editor);
      expect(list.status).toBe(200);
      expect(list.body.topics.map((topic: { id: string }) => topic.id)).toEqual([created.body.id]);

      const patched = await t.http
        .patch(`/v1/admin/topics/${created.body.id}`)
        .set('Cookie', editor)
        .send({ nameVi: 'Văn phòng' });
      expect(patched.status).toBe(200);
      expect(patched.body.nameVi).toBe('Văn phòng');

      const published = await t.http
        .post(`/v1/admin/topics/${created.body.id}/publish`)
        .set('Cookie', editor);
      expect(published.status).toBe(200);
      expect(published.body.status).toBe('published');
      const rows = await auditRows(t.prisma, 'content.publish');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ targetType: 'topic', targetId: created.body.id });
    });

    it('soft-deletes a topic and hides its lemmas from a Free user GET /v1/topics', async () => {
      const topic = await createTopic(t.prisma);
      await createLemma(t.prisma, { topicId: topic.id, includedInFree: true });
      const { cookie: learner } = await createUser(t.prisma, { plan: 'free' });
      const before = await t.http.get('/v1/topics').set('Cookie', learner);
      expect(before.body.topics.map((row: { id: string }) => row.id)).toEqual([topic.id]);

      const del = await t.http.delete(`/v1/admin/topics/${topic.id}`).set('Cookie', editor);
      expect(del.status).toBe(200);
      const after = await t.http.get('/v1/topics').set('Cookie', learner);
      expect(after.body.topics).toEqual([]);
      const adminList = await t.http.get('/v1/admin/topics').set('Cookie', editor);
      expect(adminList.body.topics).toEqual([]);
      const gone = await t.http.get(`/v1/admin/topics/${topic.id}/context`).set('Cookie', editor);
      expect(gone.status).toBe(404);
    });

    it('context reports counts and blockers (published lemma with < 2 published prompts)', async () => {
      const topic = await createTopic(t.prisma);
      const covered = await createLemma(t.prisma, { topicId: topic.id, headword: 'covered' });
      const thin = await createLemma(t.prisma, { topicId: topic.id, headword: 'thin' });
      const draftLemma = await createLemma(t.prisma, {
        topicId: topic.id,
        headword: 'draftword',
        status: 'draft',
      });
      await createPrompt(t.prisma, { topicId: topic.id, targets: [covered.id, thin.id] });
      await createPrompt(t.prisma, { topicId: topic.id, targets: [covered.id, draftLemma.id] });
      await createPrompt(t.prisma, {
        topicId: topic.id,
        targets: [thin.id, covered.id],
        status: 'draft',
      });

      const res = await t.http.get(`/v1/admin/topics/${topic.id}/context`).set('Cookie', editor);
      expect(res.status).toBe(200);
      expect(res.body.lemmaCounts).toEqual({ draft: 1, published: 2 });
      expect(res.body.promptCounts).toEqual({ draft: 1, published: 2 });
      expect(res.body.blockers).toEqual([
        { lemmaId: thin.id, headword: 'thin', publishedPromptCount: 1 },
      ]);
    });
  });

  describe('lemmas', () => {
    it('blocks publish without example_en (VALIDATION + reasons) and publishes once fixed', async () => {
      const topic = await createTopic(t.prisma);
      const lemma = await createLemma(t.prisma, {
        topicId: topic.id,
        status: 'draft',
        exampleEn: '   ',
      });
      const blocked = await t.http
        .post(`/v1/admin/lemmas/${lemma.id}/publish`)
        .set('Cookie', editor);
      expect(blocked.status).toBe(422);
      expect(blocked.body.error.code).toBe('VALIDATION');
      expect(blocked.body.error.details.reasons).toEqual(['example_en_missing']);

      await t.http
        .patch(`/v1/admin/lemmas/${lemma.id}`)
        .set('Cookie', editor)
        .send({ exampleEn: 'An example.' });
      const ok = await t.http.post(`/v1/admin/lemmas/${lemma.id}/publish`).set('Cookie', editor);
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('published');
      const rows = await auditRows(t.prisma, 'content.publish');
      expect(rows).toEqual([expect.objectContaining({ targetType: 'lemma', targetId: lemma.id })]);
    });

    it('rejects a manual duplicate headword (case/space-insensitive) with 409 CONFLICT', async () => {
      const topic = await createTopic(t.prisma);
      await createLemma(t.prisma, { topicId: topic.id, headword: 'follow up' });
      const res = await t.http
        .post('/v1/admin/lemmas')
        .set('Cookie', editor)
        .send(lemmaBody(topic.id, { headword: '  Follow   Up ' }));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('allows re-creating a headword after the old lemma is soft-deleted', async () => {
      const topic = await createTopic(t.prisma);
      const old = await createLemma(t.prisma, { topicId: topic.id, headword: 'deadline' });
      const del = await t.http.delete(`/v1/admin/lemmas/${old.id}`).set('Cookie', editor);
      expect(del.status).toBe(200);
      const res = await t.http
        .post('/v1/admin/lemmas')
        .set('Cookie', editor)
        .send(lemmaBody(topic.id));
      expect(res.status).toBe(201);
    });

    it('lists with filters (topicId, status, includedInFree, q) and unpublishes with audit', async () => {
      const topic = await createTopic(t.prisma);
      const other = await createTopic(t.prisma);
      const a = await createLemma(t.prisma, {
        topicId: topic.id,
        headword: 'alpha',
        includedInFree: true,
      });
      await createLemma(t.prisma, { topicId: topic.id, headword: 'beta', includedInFree: false });
      await createLemma(t.prisma, {
        topicId: other.id,
        headword: 'alphabet',
        includedInFree: true,
      });

      const res = await t.http
        .get(`/v1/admin/lemmas?topicId=${topic.id}&status=published&includedInFree=true&q=ALP`)
        .set('Cookie', editor);
      expect(res.status).toBe(200);
      expect(res.body.lemmas.map((row: { id: string }) => row.id)).toEqual([a.id]);

      const un = await t.http.post(`/v1/admin/lemmas/${a.id}/unpublish`).set('Cookie', editor);
      expect(un.status).toBe(200);
      expect(un.body.status).toBe('draft');
      expect(await auditRows(t.prisma, 'content.unpublish')).toHaveLength(1);
    });
  });

  describe('prompts', () => {
    it('blocks publish for missing sample, draft target and cross-topic target', async () => {
      const topic = await createTopic(t.prisma);
      const other = await createTopic(t.prisma);
      const ok1 = await createLemma(t.prisma, { topicId: topic.id });
      const ok2 = await createLemma(t.prisma, { topicId: topic.id });
      const draft = await createLemma(t.prisma, { topicId: topic.id, status: 'draft' });
      const foreign = await createLemma(t.prisma, { topicId: other.id });

      const noSample = await createPrompt(t.prisma, {
        topicId: topic.id,
        targets: [ok1.id, ok2.id],
        status: 'draft',
        sampleEn: null,
      });
      const withDraft = await createPrompt(t.prisma, {
        topicId: topic.id,
        targets: [ok1.id, draft.id],
        status: 'draft',
      });
      const crossTopic = await createPrompt(t.prisma, {
        topicId: topic.id,
        targets: [ok1.id, foreign.id],
        status: 'draft',
      });

      const cases: [string, string][] = [
        [noSample.id, 'sample_en_missing'],
        [withDraft.id, 'target_not_published'],
        [crossTopic.id, 'target_cross_topic'],
      ];
      for (const [id, reason] of cases) {
        const res = await t.http.post(`/v1/admin/prompts/${id}/publish`).set('Cookie', editor);
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('VALIDATION');
        expect(res.body.error.details.reasons).toEqual([reason]);
      }
      expect(await auditRows(t.prisma, 'content.publish')).toHaveLength(0);
      const still = await t.prisma.prompt.findMany({ where: { status: 'published' } });
      expect(still).toHaveLength(0);
    });

    it('creates with 2–5 distinct targets, enforces text_vi cap and duplicate externalKey', async () => {
      const topic = await createTopic(t.prisma);
      const l1 = await createLemma(t.prisma, { topicId: topic.id });
      const l2 = await createLemma(t.prisma, { topicId: topic.id });
      const base = {
        externalKey: 'k-1',
        textVi: 'Câu mẫu.',
        topicId: topic.id,
        targetLemmaIds: [l1.id, l2.id],
        sampleEn: 'Sample.',
      };

      const one = await t.http
        .post('/v1/admin/prompts')
        .set('Cookie', editor)
        .send({ ...base, targetLemmaIds: [l1.id] });
      expect(one.status).toBe(422);
      const dupTargets = await t.http
        .post('/v1/admin/prompts')
        .set('Cookie', editor)
        .send({ ...base, targetLemmaIds: [l1.id, l1.id] });
      expect(dupTargets.status).toBe(422);
      const tooLong = await t.http
        .post('/v1/admin/prompts')
        .set('Cookie', editor)
        .send({ ...base, textVi: 'a'.repeat(501) });
      expect(tooLong.status).toBe(422);

      const created = await t.http.post('/v1/admin/prompts').set('Cookie', editor).send(base);
      expect(created.status).toBe(201);
      expect(created.body.targetLemmaIds).toEqual([l1.id, l2.id]);
      expect(created.body.status).toBe('draft');

      const dupKey = await t.http.post('/v1/admin/prompts').set('Cookie', editor).send(base);
      expect(dupKey.status).toBe(409);
      expect(dupKey.body.error.code).toBe('CONFLICT');

      const published = await t.http
        .post(`/v1/admin/prompts/${created.body.id}/publish`)
        .set('Cookie', editor);
      expect(published.status).toBe(200);
      expect(published.body.status).toBe('published');
    });

    it('PATCH replaces targets in order; unpublish keeps lemmas published', async () => {
      const topic = await createTopic(t.prisma);
      const l1 = await createLemma(t.prisma, { topicId: topic.id });
      const l2 = await createLemma(t.prisma, { topicId: topic.id });
      const l3 = await createLemma(t.prisma, { topicId: topic.id });
      const prompt = await createPrompt(t.prisma, { topicId: topic.id, targets: [l1.id, l2.id] });

      const patched = await t.http
        .patch(`/v1/admin/prompts/${prompt.id}`)
        .set('Cookie', editor)
        .send({ targetLemmaIds: [l3.id, l1.id] });
      expect(patched.status).toBe(200);
      expect(patched.body.targetLemmaIds).toEqual([l3.id, l1.id]);
      const links = await t.prisma.promptLemma.findMany({
        where: { promptId: prompt.id },
        orderBy: { sortOrder: 'asc' },
      });
      expect(links.map((link) => [link.lemmaId, link.sortOrder])).toEqual([
        [l3.id, 0],
        [l1.id, 1],
      ]);

      const un = await t.http
        .post(`/v1/admin/prompts/${prompt.id}/unpublish`)
        .set('Cookie', editor);
      expect(un.status).toBe(200);
      expect(un.body.status).toBe('draft');
      const lemmas = await t.prisma.lemma.findMany({ where: { id: { in: [l1.id, l3.id] } } });
      expect(lemmas.every((lemma) => lemma.status === 'published')).toBe(true);
      const rows = await auditRows(t.prisma, 'content.unpublish');
      expect(rows).toEqual([
        expect.objectContaining({ targetType: 'prompt', targetId: prompt.id }),
      ]);
    });
  });
});
