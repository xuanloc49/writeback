import type { Lemma, Prompt, Topic } from '@prisma/client';
import { createTestApp, type TestApp } from './helpers/app';
import { flushRedis, resetDatabase } from './helpers/db';
import {
  createLemma,
  createPrompt,
  createTopic,
  createUser,
  type CreatedUser,
} from './helpers/factories';
import { createCard, createReview, createScoredAttempt } from './helpers/learning-factories';

// 17:00 GMT+7 on 2026-09-13; the business day is [2026-09-12T17:00Z, 2026-09-13T17:00Z).
const NOW = new Date('2026-09-13T10:00:00.000Z');
const TODAY_EARLY = new Date('2026-09-12T18:00:00.000Z'); // 01:00 GMT+7, same business day
const YESTERDAY_LATE = new Date('2026-09-12T16:00:00.000Z'); // 23:00 GMT+7 the day before
const DAY_MS = 86_400_000;

describe('GET /v1/dashboard (integration)', () => {
  let t: TestApp;
  let topicA: Topic;
  let topicB: Topic;
  let lemmaA1: Lemma;
  let lemmaA2: Lemma;
  let lemmaB1: Lemma;
  let draftLemma: Lemma;
  let prompt: Prompt;

  beforeAll(async () => {
    t = await createTestApp();
    await flushRedis(t.config.redisUrl);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.clock.set(NOW);
    topicA = await createTopic(t.prisma, { nameVi: 'Công việc' });
    topicB = await createTopic(t.prisma, { nameVi: 'Du lịch' });
    lemmaA1 = await createLemma(t.prisma, { topicId: topicA.id, headword: 'improve' });
    lemmaA2 = await createLemma(t.prisma, { topicId: topicA.id, headword: 'negotiate' });
    lemmaB1 = await createLemma(t.prisma, { topicId: topicB.id, headword: 'journey' });
    draftLemma = await createLemma(t.prisma, {
      topicId: topicA.id,
      headword: 'draftword',
      status: 'draft',
    });
    prompt = await createPrompt(t.prisma, { topicId: topicA.id, targets: [lemmaA1.id] });
  });

  afterAll(async () => {
    await t.close();
  });

  const learner = (): Promise<CreatedUser> =>
    createUser(t.prisma, { plan: 'free', onboardingTopicIds: [topicA.id] });
  const dashboard = (cookie: string) => t.http.get('/v1/dashboard').set('Cookie', cookie);
  const setStreak = (userId: string, count: number, lastDate: string | null) =>
    t.prisma.user.update({
      where: { id: userId },
      data: { streakCount: count, streakLastDate: lastDate === null ? null : new Date(lastDate) },
    });

  it('empty state: no cards → CTA rewrite, due 0, streak 0', async () => {
    const { cookie } = await learner();
    const res = await dashboard(cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      streak: 0,
      dueToday: 0,
      reviewedToday: 0,
      rewriteNewToday: 0,
      quota: { rewriteNewLeft: 10, retryLeft: 3 },
      topics: [],
      cta: 'rewrite',
      hasCards: false,
    });
  });

  it('computes due / reviewed / written today, streak, topics and quota', async () => {
    const { user, cookie } = await learner();
    await setStreak(user.id, 4, '2026-09-12');
    const overdue = await createCard(t.prisma, {
      userId: user.id,
      lemmaId: lemmaA1.id,
      nextReviewAt: new Date(NOW.getTime() - 3 * DAY_MS),
      status: 'mastered',
    });
    // 23:00 GMT+7 today → still due today (calendar day, not instant).
    await createCard(t.prisma, {
      userId: user.id,
      lemmaId: lemmaA2.id,
      nextReviewAt: new Date('2026-09-13T16:00:00.000Z'),
      status: 'learning',
    });
    // 00:30 GMT+7 tomorrow → not due.
    await createCard(t.prisma, {
      userId: user.id,
      lemmaId: lemmaB1.id,
      nextReviewAt: new Date('2026-09-13T17:30:00.000Z'),
    });
    // Hidden and content-gone cards are due by date but must not count.
    const hiddenLemma = await createLemma(t.prisma, { topicId: topicB.id, headword: 'hiddenword' });
    await createCard(t.prisma, {
      userId: user.id,
      lemmaId: hiddenLemma.id,
      nextReviewAt: NOW,
      hiddenAt: NOW,
    });
    await createCard(t.prisma, { userId: user.id, lemmaId: draftLemma.id, nextReviewAt: NOW });

    await createReview(t.prisma, { userId: user.id, cardId: overdue.id, createdAt: TODAY_EARLY });
    await createReview(t.prisma, {
      userId: user.id,
      cardId: overdue.id,
      createdAt: YESTERDAY_LATE,
    });

    const targets = [{ lemmaId: lemmaA1.id, headword: 'improve' }];
    const base = { userId: user.id, promptId: prompt.id, topicId: topicA.id, targets };
    const rev1 = await createScoredAttempt(t.prisma, {
      ...base,
      scoredAt: TODAY_EARLY,
      userEn: 'I improve.',
    });
    await createScoredAttempt(t.prisma, {
      ...base,
      scoredAt: NOW,
      userEn: 'I improve again.',
      revision: 2,
      attemptId: rev1.attemptId,
      parentAttemptId: rev1.id,
    });
    await createScoredAttempt(t.prisma, {
      ...base,
      scoredAt: YESTERDAY_LATE,
      userEn: 'Yesterday.',
    });

    const res = await dashboard(cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      streak: 4,
      dueToday: 2,
      reviewedToday: 1,
      rewriteNewToday: 1,
      quota: { rewriteNewLeft: 9, retryLeft: 2 },
      cta: null,
      hasCards: true,
    });
    expect(res.body.topics).toEqual([
      { topicId: topicA.id, nameVi: 'Công việc', cardCount: 2, masteredPercent: 50 },
      { topicId: topicB.id, nameVi: 'Du lịch', cardCount: 1, masteredPercent: 0 },
    ]);
  });

  it('CTA is review when cards are due and nothing was reviewed today', async () => {
    const { user, cookie } = await learner();
    await createCard(t.prisma, { userId: user.id, lemmaId: lemmaA1.id, nextReviewAt: NOW });
    await createScoredAttempt(t.prisma, {
      userId: user.id,
      promptId: prompt.id,
      topicId: topicA.id,
      targets: [{ lemmaId: lemmaA1.id, headword: 'improve' }],
      scoredAt: TODAY_EARLY,
      userEn: 'I improve.',
    });
    const res = await dashboard(cookie);
    expect(res.body).toMatchObject({ dueToday: 1, reviewedToday: 0, cta: 'review' });
  });

  it('CTA is rewrite when cards exist, nothing is due and nothing was written today', async () => {
    const { user, cookie } = await learner();
    await createCard(t.prisma, {
      userId: user.id,
      lemmaId: lemmaA1.id,
      nextReviewAt: new Date(NOW.getTime() + 5 * DAY_MS),
    });
    const res = await dashboard(cookie);
    expect(res.body).toMatchObject({ dueToday: 0, rewriteNewToday: 0, cta: 'rewrite' });
  });

  it('streak shows 0 when the last active day is before yesterday', async () => {
    const { user, cookie } = await learner();
    await setStreak(user.id, 9, '2026-09-11');
    expect((await dashboard(cookie)).body.streak).toBe(0);
    await setStreak(user.id, 9, '2026-09-13');
    expect((await dashboard(cookie)).body.streak).toBe(9);
  });

  it('lists at most the 5 topics with the most visible cards', async () => {
    const { user, cookie } = await learner();
    for (let i = 0; i < 6; i += 1) {
      const topic = await createTopic(t.prisma, { nameVi: `Chủ đề ${i}` });
      const lemma = await createLemma(t.prisma, { topicId: topic.id });
      await createCard(t.prisma, { userId: user.id, lemmaId: lemma.id, nextReviewAt: NOW });
    }
    await createCard(t.prisma, { userId: user.id, lemmaId: lemmaA1.id, nextReviewAt: NOW });
    await createCard(t.prisma, { userId: user.id, lemmaId: lemmaA2.id, nextReviewAt: NOW });
    const res = await dashboard(cookie);
    expect(res.body.topics).toHaveLength(5);
    expect(res.body.topics[0]).toMatchObject({ topicId: topicA.id, cardCount: 2 });
  });
});
