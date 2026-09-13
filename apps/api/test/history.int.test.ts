import type { Lemma, Prompt, Topic } from '@prisma/client';
import { HISTORY_EXCERPT_LENGTH } from '../src/history/history.dto';
import { createTestApp, type TestApp } from './helpers/app';
import { flushRedis, resetDatabase } from './helpers/db';
import {
  collectKeys,
  createLemma,
  createPrompt,
  createTopic,
  createUser,
  type CreatedUser,
} from './helpers/factories';
import { createScoredAttempt } from './helpers/learning-factories';

const NOW = new Date('2026-09-13T10:00:00.000Z');
const HOUR_MS = 3_600_000;
const FORBIDDEN_KEYS = ['sampleEn', 'sample_en', 'sampleEnSnapshot', 'exampleEn'];

describe('history (integration)', () => {
  let t: TestApp;
  let topic: Topic;
  let lemma: Lemma;
  let prompt: Prompt;

  beforeAll(async () => {
    t = await createTestApp();
    await flushRedis(t.config.redisUrl);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.clock.set(NOW);
    topic = await createTopic(t.prisma, { nameVi: 'Công việc' });
    lemma = await createLemma(t.prisma, { topicId: topic.id, headword: 'improve' });
    prompt = await createPrompt(t.prisma, { topicId: topic.id, targets: [lemma.id] });
  });

  afterAll(async () => {
    await t.close();
  });

  const learner = (): Promise<CreatedUser> =>
    createUser(t.prisma, { plan: 'free', onboardingTopicIds: [topic.id] });
  const list = (cookie: string, query: Record<string, string> = {}) =>
    t.http.get('/v1/history').query(query).set('Cookie', cookie);
  const detail = (cookie: string, attemptId: string) =>
    t.http.get(`/v1/history/${attemptId}`).set('Cookie', cookie);
  const attemptFor = (userId: string, hoursAgo: number, userEn: string, overallScore = 70) =>
    createScoredAttempt(t.prisma, {
      userId,
      promptId: prompt.id,
      topicId: topic.id,
      targets: [{ lemmaId: lemma.id, headword: 'improve' }],
      scoredAt: new Date(NOW.getTime() - hoursAgo * HOUR_MS),
      userEn,
      overallScore,
    });

  it('empty list → { items: [], nextCursor: null }', async () => {
    const { cookie } = await learner();
    const res = await list(cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it('paginates newest-first with a keyset cursor and shows revision badges', async () => {
    const { user, cookie } = await learner();
    const other = await learner();
    const oldest = await attemptFor(user.id, 3, 'Oldest sentence.', 40);
    const middle = await attemptFor(user.id, 2, 'Middle sentence.', 60);
    const newest = await attemptFor(user.id, 1, 'Newest sentence.', 80);
    await createScoredAttempt(t.prisma, {
      userId: user.id,
      promptId: prompt.id,
      topicId: topic.id,
      targets: [{ lemmaId: lemma.id, headword: 'improve' }],
      scoredAt: NOW,
      userEn: 'Revised middle sentence.',
      overallScore: 75,
      revision: 2,
      attemptId: middle.attemptId,
      parentAttemptId: middle.id,
    });
    // Unscored rows and other users' rows are never listed.
    await t.prisma.rewriteAttempt.create({
      data: {
        attemptId: '00000000-0000-4000-8000-000000000001',
        revision: 1,
        userId: user.id,
        promptId: prompt.id,
        status: 'started',
        promptTextViSnapshot: 'vi',
        sampleEnSnapshot: 'sample',
        targetsSnapshot: [],
        topicIdSnapshot: topic.id,
      },
    });
    await attemptFor(other.user.id, 0.5, 'Other user sentence.');

    const first = await list(cookie, { limit: '2' });
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.items[0]).toEqual({
      attemptId: newest.attemptId,
      createdAt: newest.createdAt.toISOString(),
      scoredAt: newest.scoredAt?.toISOString(),
      topicNameVi: 'Công việc',
      overallScore: 80,
      excerpt: 'Newest sentence.',
      hasRevision: false,
      revisionScore: null,
    });
    expect(first.body.items[1]).toMatchObject({
      attemptId: middle.attemptId,
      overallScore: 60,
      hasRevision: true,
      revisionScore: 75,
    });
    expect(typeof first.body.nextCursor).toBe('string');

    const second = await list(cookie, { limit: '2', cursor: first.body.nextCursor });
    expect(second.status).toBe(200);
    expect(second.body.items.map((i: { attemptId: string }) => i.attemptId)).toEqual([
      oldest.attemptId,
    ]);
    expect(second.body.nextCursor).toBeNull();

    const all = await list(cookie);
    expect(all.body.items).toHaveLength(3);
    expect(all.body.nextCursor).toBeNull();
    expect(JSON.stringify(all.body)).not.toContain('Other user');
    expect(JSON.stringify(all.body)).not.toContain('must never leak');
  });

  it('truncates the excerpt to HISTORY_EXCERPT_LENGTH characters plus an ellipsis', async () => {
    const { user, cookie } = await learner();
    const long = 'word '.repeat(60).trim();
    await attemptFor(user.id, 1, long);
    const res = await list(cookie);
    const excerpt: string = res.body.items[0].excerpt;
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(HISTORY_EXCERPT_LENGTH + 1);
    expect(long.startsWith(excerpt.slice(0, -1))).toBe(true);
  });

  it('rejects an invalid cursor or an out-of-range limit with VALIDATION', async () => {
    const { cookie } = await learner();
    const badCursor = await list(cookie, { cursor: 'not-a-cursor' });
    expect(badCursor.body.error.code).toBe('VALIDATION');
    const badLimit = await list(cookie, { limit: '500' });
    expect(badLimit.body.error.code).toBe('VALIDATION');
  });

  it('GET /history/:attemptId equals GET /rewrite/:attemptId and is 404 cross-user', async () => {
    const owner = await learner();
    const other = await learner();
    const attempt = await attemptFor(owner.user.id, 1, 'My sentence.');

    const viaHistory = await detail(owner.cookie, attempt.attemptId);
    const viaRewrite = await t.http
      .get(`/v1/rewrite/${attempt.attemptId}`)
      .set('Cookie', owner.cookie);
    expect(viaHistory.status).toBe(200);
    expect(viaHistory.body).toEqual(viaRewrite.body);
    expect(viaHistory.body.revisions[0].userEn).toBe('My sentence.');
    const keys = collectKeys(viaHistory.body);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(JSON.stringify(viaHistory.body)).not.toContain('must never leak');

    const crossUser = await detail(other.cookie, attempt.attemptId);
    expect(crossUser.status).toBe(404);
    expect(crossUser.body.error.code).toBe('NOT_FOUND');
    const malformed = await detail(owner.cookie, 'nope');
    expect(malformed.status).toBe(404);
  });
});
