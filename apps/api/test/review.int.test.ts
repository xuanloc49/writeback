import type { Lemma, Prompt, Topic } from '@prisma/client';
import { SRS } from '@writeback/shared';
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
import { createCard, createScoredAttempt } from './helpers/review-factories';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** 17:00 GMT+7 on 2026-09-13 — same instant the other suites use. */
const NOW = new Date('2026-09-13T10:00:00.000Z');
const FREE_SESSION_CAP = 20;
const FORBIDDEN_FRONT_KEYS = ['headword', 'phonetic', 'exampleEn', 'exampleSentence', 'sampleEn'];

describe('review sessions (integration)', () => {
  let t: TestApp;
  let topic: Topic;
  let submitLemma: Lemma;
  let prompt: Prompt;

  beforeAll(async () => {
    t = await createTestApp();
    await flushRedis(t.config.redisUrl);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await flushRedis(t.config.redisUrl);
    t.scoring.calls.length = 0;
    t.clock.set(NOW);
    topic = await createTopic(t.prisma, { nameVi: 'Công việc' });
    submitLemma = await createLemma(t.prisma, {
      topicId: topic.id,
      headword: 'submit',
      pos: 'verb',
      senseVi: 'nộp',
      exampleEn: 'Please submit the form before Friday.',
    });
    prompt = await createPrompt(t.prisma, {
      topicId: topic.id,
      targets: [submitLemma.id],
      sampleEn: 'I submit my homework on time.',
    });
  });

  afterAll(async () => {
    await t.close();
  });

  const freeUser = (): Promise<CreatedUser> =>
    createUser(t.prisma, { plan: 'free', onboardingTopicIds: [topic.id], now: NOW });

  const startSession = (cookie: string) =>
    t.http.post('/v1/review/sessions').set('Cookie', cookie).send({});
  const next = (cookie: string, sessionId: string) =>
    t.http.get(`/v1/review/sessions/${sessionId}/next`).set('Cookie', cookie);
  const grade = (cookie: string, sessionId: string, body: Record<string, unknown>) =>
    t.http.post(`/v1/review/sessions/${sessionId}/grade`).set('Cookie', cookie).send(body);

  async function openSession(cookie: string): Promise<{ sessionId: string; cap: number }> {
    const res = await startSession(cookie);
    expect(res.status).toBe(200);
    return { sessionId: res.body.sessionId, cap: res.body.cap };
  }

  // ---- gates -----------------------------------------------------------------------------
  it('POST /review/sessions → 403 ONBOARDING_REQUIRED without onboarding topics', async () => {
    const { cookie } = await createUser(t.prisma, { plan: 'free', now: NOW });
    const res = await startSession(cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ONBOARDING_REQUIRED');
  });

  // ---- flashcard -------------------------------------------------------------------------
  it('new card → flashcard front without answer; grade 4 → review, interval 1, +1 day', async () => {
    const { user, cookie } = await freeUser();
    const card = await createCard(t.prisma, {
      userId: user.id,
      lemmaId: submitLemma.id,
      nextReviewAt: NOW,
    });

    const started = await startSession(cookie);
    expect(started.status).toBe(200);
    expect(started.body).toEqual({
      sessionId: expect.any(String),
      cap: FREE_SESSION_CAP,
      remaining: 1,
    });
    const sessionId: string = started.body.sessionId;

    const res = await next(cookie, sessionId);
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(false);
    expect(res.body.remaining).toBe(1);
    expect(res.body.card).toMatchObject({
      cardId: card.id,
      lemmaId: submitLemma.id,
      mode: 'flashcard',
      front: { senseVi: 'nộp', topicNameVi: 'Công việc' },
      back: {
        headword: 'submit',
        exampleSentence: 'Please submit the form before Friday.',
      },
    });
    const frontKeys = collectKeys(res.body.card.front);
    for (const forbidden of FORBIDDEN_FRONT_KEYS) {
      expect(frontKeys.has(forbidden)).toBe(false);
    }
    expect(JSON.stringify(res.body)).not.toContain('I submit my homework');

    const graded = await grade(cookie, sessionId, { cardId: card.id, quality: 4 });
    expect(graded.status).toBe(200);
    expect(graded.body.quality).toBe(4);
    expect(graded.body.correct).toBeUndefined();
    expect(graded.body.mode).toBe('flashcard');
    expect(graded.body.card).toEqual({
      status: 'review',
      intervalDays: SRS.FIRST_INTERVAL_DAYS,
      nextReviewAt: new Date(NOW.getTime() + SRS.FIRST_INTERVAL_DAYS * DAY_MS).toISOString(),
    });
    expect(graded.body.next).toEqual({ done: true, reason: 'empty' });

    const row = await t.prisma.srsCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.status).toBe('review');
    expect(row.repetitions).toBe(1);
    expect(row.intervalDays).toBe(1);
    const reviews = await t.prisma.srsReview.findMany({ where: { sessionId } });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ cardId: card.id, mode: 'flashcard', quality: 4 });
    const session = await t.prisma.reviewSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.gradedCount).toBe(1);
    expect(session.endedAt).toBeNull();

    const events = await t.prisma.analyticsEvent.findMany({
      where: { userId: user.id, name: { in: ['review_session_started', 'review_graded'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.name)).toEqual(['review_session_started', 'review_graded']);
    expect(events[1]?.props).toMatchObject({ mode: 'flashcard', quality: 4 });
  });

  // ---- cloze -----------------------------------------------------------------------------
  it('learning card with a used:true attempt → cloze from user_en; inflected answer → q=4', async () => {
    const { user, cookie } = await freeUser();
    await createScoredAttempt(t.prisma, {
      userId: user.id,
      promptId: prompt.id,
      topicId: topic.id,
      targets: [submitLemma],
      userEn: 'Yesterday I submitted the report and my boss submits hers today.',
      usedHeadwords: ['submit'],
      modelRewriteEn: 'I submitted the report yesterday.',
      scoredAt: new Date(NOW.getTime() - DAY_MS),
    });
    const card = await createCard(t.prisma, {
      userId: user.id,
      lemmaId: submitLemma.id,
      status: 'learning',
      nextReviewAt: NOW,
    });
    const { sessionId } = await openSession(cookie);

    const res = await next(cookie, sessionId);
    expect(res.status).toBe(200);
    expect(res.body.card.mode).toBe('cloze');
    const sentence: string = res.body.card.front.sentence;
    expect(sentence).toBe('Yesterday I ____ the report and my boss ____ hers today.');
    expect(sentence).not.toContain('submit');
    expect(res.body.card.back).toBeUndefined();
    const keys = collectKeys(res.body);
    for (const forbidden of FORBIDDEN_FRONT_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(JSON.stringify(res.body)).not.toContain('SAMPLE SENTENCE');

    const graded = await grade(cookie, sessionId, { cardId: card.id, answer: '  Submitted ' });
    expect(graded.status).toBe(200);
    expect(graded.body).toMatchObject({
      quality: 4,
      correct: true,
      mode: 'cloze',
      card: { status: 'review', intervalDays: SRS.FIRST_INTERVAL_DAYS },
      reveal: {
        headword: 'submit',
        exampleSentence: 'Yesterday I submitted the report and my boss submits hers today.',
      },
    });
    const review = await t.prisma.srsReview.findFirstOrThrow({ where: { cardId: card.id } });
    expect(review.mode).toBe('cloze');
  });

  it('cloze falls back to model_rewrite_en when the user never used the word, then example_en', async () => {
    const { user, cookie } = await freeUser();
    await createScoredAttempt(t.prisma, {
      userId: user.id,
      promptId: prompt.id,
      topicId: topic.id,
      targets: [submitLemma],
      userEn: 'I gave the report to my boss.',
      usedHeadwords: [],
      modelRewriteEn: 'I submitted the report to my boss.',
      scoredAt: new Date(NOW.getTime() - DAY_MS),
    });
    await createCard(t.prisma, {
      userId: user.id,
      lemmaId: submitLemma.id,
      status: 'review',
      repetitions: 1,
      intervalDays: 1,
      nextReviewAt: new Date(NOW.getTime() - DAY_MS),
    });
    const first = await openSession(cookie);
    const fromModel = await next(cookie, first.sessionId);
    expect(fromModel.body.card.mode).toBe('cloze');
    expect(fromModel.body.card.front.sentence).toBe('I ____ the report to my boss.');

    // Without any attempt the lemma's own example is used.
    await t.prisma.rewriteAttempt.deleteMany({ where: { userId: user.id } });
    const second = await openSession(cookie);
    const fromExample = await next(cookie, second.sessionId);
    expect(fromExample.body.card.mode).toBe('cloze');
    expect(fromExample.body.card.front.sentence).toBe('Please ____ the form before Friday.');
  });

  // ---- type ------------------------------------------------------------------------------
  it('no source sentence → type mode; wrong answer on learning → q=1, due again in 10 minutes', async () => {
    const { user, cookie } = await freeUser();
    const bare = await createLemma(t.prisma, {
      topicId: topic.id,
      headword: 'deadline',
      exampleEn: null,
    });
    const card = await createCard(t.prisma, {
      userId: user.id,
      lemmaId: bare.id,
      status: 'learning',
      nextReviewAt: NOW,
    });
    const { sessionId } = await openSession(cookie);

    const res = await next(cookie, sessionId);
    expect(res.status).toBe(200);
    expect(res.body.card).toEqual({
      cardId: card.id,
      lemmaId: bare.id,
      mode: 'type',
      front: { senseVi: 'nghĩa của deadline' },
    });

    const graded = await grade(cookie, sessionId, { cardId: card.id, answer: 'deadline.' });
    expect(graded.status).toBe(200);
    expect(graded.body).toMatchObject({
      quality: 1,
      correct: false,
      mode: 'type',
      card: {
        status: 'learning',
        nextReviewAt: new Date(NOW.getTime() + SRS.LAPSE_RELEARN_MINUTES * MINUTE_MS).toISOString(),
      },
      reveal: { headword: 'deadline', exampleSentence: null },
    });
    const row = await t.prisma.srsCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.repetitions).toBe(0);
    expect(row.ef).toBe(SRS.INITIAL_EF);
    // Graded once in this session → not served again even though it is due today.
    expect(graded.body.next).toEqual({ done: true, reason: 'empty' });
  });

  it('body shape must match the server-chosen mode → 422 VALIDATION', async () => {
    const { user, cookie } = await freeUser();
    const card = await createCard(t.prisma, {
      userId: user.id,
      lemmaId: submitLemma.id,
      status: 'learning',
      nextReviewAt: NOW,
    });
    const { sessionId } = await openSession(cookie);
    const wrongShape = await grade(cookie, sessionId, { cardId: card.id, quality: 4 });
    expect(wrongShape.status).toBe(422);
    expect(wrongShape.body.error.code).toBe('VALIDATION');
    expect(wrongShape.body.error.details.expectedMode).toBe('cloze');
    const badQuality = await grade(cookie, sessionId, { cardId: card.id, quality: 2 });
    expect(badQuality.status).toBe(422);
    expect(await t.prisma.srsReview.count()).toBe(0);
  });

  // ---- visibility ------------------------------------------------------------------------
  it('hidden cards, unpublished lemmas, deleted topics and future cards are never served', async () => {
    const { user, cookie } = await freeUser();
    await createCard(t.prisma, {
      userId: user.id,
      lemmaId: submitLemma.id,
      nextReviewAt: NOW,
      hiddenAt: NOW,
    });
    const draft = await createLemma(t.prisma, { topicId: topic.id, status: 'draft' });
    await createCard(t.prisma, { userId: user.id, lemmaId: draft.id, nextReviewAt: NOW });
    const deletedTopic = await createTopic(t.prisma);
    const orphan = await createLemma(t.prisma, { topicId: deletedTopic.id });
    await t.prisma.topic.update({ where: { id: deletedTopic.id }, data: { deletedAt: NOW } });
    await createCard(t.prisma, { userId: user.id, lemmaId: orphan.id, nextReviewAt: NOW });
    const later = await createLemma(t.prisma, { topicId: topic.id });
    // 07:00Z next day = 14:00 GMT+7 tomorrow → not due today.
    await createCard(t.prisma, {
      userId: user.id,
      lemmaId: later.id,
      nextReviewAt: new Date('2026-09-14T07:00:00.000Z'),
    });

    const started = await startSession(cookie);
    expect(started.body.remaining).toBe(0);
    const res = await next(cookie, started.body.sessionId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ done: true, reason: 'empty' });
  });

  it('a card due at 23:30 GMT+7 today is due (calendar day, not 24h window)', async () => {
    const { user, cookie } = await freeUser();
    await createCard(t.prisma, {
      userId: user.id,
      lemmaId: submitLemma.id,
      status: 'review',
      nextReviewAt: new Date('2026-09-13T16:30:00.000Z'),
    });
    const started = await startSession(cookie);
    expect(started.body.remaining).toBe(1);
  });

  // ---- ordering --------------------------------------------------------------------------
  it('serves the longest-overdue card first, then learning, then new', async () => {
    const { user, cookie } = await freeUser();
    const [a, b, c] = await Promise.all([
      createLemma(t.prisma, { topicId: topic.id, headword: 'alpha' }),
      createLemma(t.prisma, { topicId: topic.id, headword: 'beta' }),
      createLemma(t.prisma, { topicId: topic.id, headword: 'gamma' }),
    ]);
    const fresh = await createCard(t.prisma, { userId: user.id, lemmaId: a.id, nextReviewAt: NOW });
    const learning = await createCard(t.prisma, {
      userId: user.id,
      lemmaId: b.id,
      status: 'learning',
      nextReviewAt: new Date(NOW.getTime() - MINUTE_MS),
    });
    const overdue = await createCard(t.prisma, {
      userId: user.id,
      lemmaId: c.id,
      status: 'review',
      nextReviewAt: new Date(NOW.getTime() - 3 * DAY_MS),
    });
    const { sessionId } = await openSession(cookie);
    const first = await next(cookie, sessionId);
    expect(first.body.card.cardId).toBe(overdue.id);
    expect(first.body.remaining).toBe(3);
    const g1 = await grade(cookie, sessionId, { cardId: overdue.id, answer: 'gamma' });
    expect(g1.body.next.card.cardId).toBe(learning.id);
    expect(g1.body.next.remaining).toBe(2);
    const g2 = await grade(cookie, sessionId, { cardId: learning.id, answer: 'beta' });
    expect(g2.body.next.card.cardId).toBe(fresh.id);
    expect(g2.body.next.card.mode).toBe('flashcard');
  });

  // ---- cap -------------------------------------------------------------------------------
  it('cap reached (Free, 20) → done: cap, ended_at set, GET next FORBIDDEN, new session allowed', async () => {
    const { user, cookie } = await freeUser();
    const cards = [];
    for (let i = 0; i < FREE_SESSION_CAP + 1; i += 1) {
      const lemma = await createLemma(t.prisma, { topicId: topic.id, headword: `word${i}x` });
      cards.push(
        await createCard(t.prisma, { userId: user.id, lemmaId: lemma.id, nextReviewAt: NOW }),
      );
    }
    const started = await startSession(cookie);
    expect(started.body).toMatchObject({ cap: FREE_SESSION_CAP, remaining: FREE_SESSION_CAP });
    const sessionId: string = started.body.sessionId;

    let last: Record<string, unknown> | null = null;
    const gradedIds = new Set<string>();
    for (let i = 0; i < FREE_SESSION_CAP; i += 1) {
      const current = await next(cookie, sessionId);
      expect(current.body.done).toBe(false);
      expect(current.body.remaining).toBe(FREE_SESSION_CAP - i);
      const cardId: string = current.body.card.cardId;
      expect(gradedIds.has(cardId)).toBe(false);
      gradedIds.add(cardId);
      const res = await grade(cookie, sessionId, { cardId, quality: 5 });
      expect(res.status).toBe(200);
      last = res.body;
    }
    const leftover = cards.find((card) => !gradedIds.has(card.id));
    expect(leftover).toBeDefined();
    expect(last?.next).toEqual({ done: true, reason: 'cap' });
    const session = await t.prisma.reviewSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.gradedCount).toBe(FREE_SESSION_CAP);
    expect(session.endedAt).toEqual(NOW);

    const afterEnd = await next(cookie, sessionId);
    expect(afterEnd.status).toBe(403);
    expect(afterEnd.body.error.code).toBe('FORBIDDEN');
    const lateGrade = await grade(cookie, sessionId, { cardId: leftover!.id, quality: 4 });
    expect(lateGrade.status).toBe(403);

    // Same day, second session: allowed, serves the one card not graded yet.
    const second = await startSession(cookie);
    expect(second.status).toBe(200);
    expect(second.body.remaining).toBe(1);
    const nextCard = await next(cookie, second.body.sessionId);
    expect(nextCard.body.card.cardId).toBe(leftover!.id);
  });

  // ---- ownership -------------------------------------------------------------------------
  it("another user's session → 404; grading a card not in the queue → 404", async () => {
    const owner = await freeUser();
    const other = await freeUser();
    const card = await createCard(t.prisma, {
      userId: owner.user.id,
      lemmaId: submitLemma.id,
      nextReviewAt: NOW,
    });
    const { sessionId } = await openSession(owner.cookie);
    const foreignNext = await next(other.cookie, sessionId);
    expect(foreignNext.status).toBe(404);
    expect(foreignNext.body.error.code).toBe('NOT_FOUND');
    const foreignGrade = await grade(other.cookie, sessionId, { cardId: card.id, quality: 4 });
    expect(foreignGrade.status).toBe(404);

    const otherLemma = await createLemma(t.prisma, { topicId: topic.id });
    const notDue = await createCard(t.prisma, {
      userId: owner.user.id,
      lemmaId: otherLemma.id,
      nextReviewAt: new Date(NOW.getTime() + 5 * DAY_MS),
    });
    const notInQueue = await grade(owner.cookie, sessionId, { cardId: notDue.id, quality: 4 });
    expect(notInQueue.status).toBe(404);
    const unknown = await next(owner.cookie, 'not-a-uuid');
    expect(unknown.status).toBe(404);
  });

  // ---- streak / daily activity -----------------------------------------------------------
  it('streak: 1 after first review, unchanged same day, 2 tomorrow, back to 1 after a gap', async () => {
    const { user, cookie } = await freeUser();
    const lemmas = await Promise.all(
      ['one', 'two', 'three', 'four'].map((headword) =>
        createLemma(t.prisma, { topicId: topic.id, headword }),
      ),
    );
    const cards = await Promise.all(
      lemmas.map((lemma) =>
        createCard(t.prisma, { userId: user.id, lemmaId: lemma.id, nextReviewAt: NOW }),
      ),
    );
    const streak = async () => {
      const row = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      return {
        count: row.streakCount,
        last: row.streakLastDate?.toISOString().slice(0, 'YYYY-MM-DD'.length) ?? null,
      };
    };
    const reviewOne = async (cardId: string) => {
      const { sessionId } = await openSession(cookie);
      const res = await grade(cookie, sessionId, { cardId, quality: 5 });
      expect(res.status).toBe(200);
    };

    await reviewOne(cards[0]!.id);
    expect(await streak()).toEqual({ count: 1, last: '2026-09-13' });
    await reviewOne(cards[1]!.id);
    expect(await streak()).toEqual({ count: 1, last: '2026-09-13' });
    let activity = await t.prisma.userDailyActivity.findMany({ where: { userId: user.id } });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ reviewCount: 2, rewriteNewCount: 0 });

    // Tomorrow (same wall-clock hour GMT+7): +1.
    t.clock.advanceMs(DAY_MS);
    await reviewOne(cards[2]!.id);
    expect(await streak()).toEqual({ count: 2, last: '2026-09-14' });

    // Skip 2026-09-15 entirely → restart at 1.
    t.clock.advanceMs(2 * DAY_MS);
    await reviewOne(cards[3]!.id);
    expect(await streak()).toEqual({ count: 1, last: '2026-09-16' });
    activity = await t.prisma.userDailyActivity.findMany({
      where: { userId: user.id },
      orderBy: { date: 'asc' },
    });
    expect(activity.map((a) => a.reviewCount)).toEqual([2, 1, 1]);

    const increments = await t.prisma.analyticsEvent.findMany({
      where: { userId: user.id, name: 'streak_incremented' },
      orderBy: { createdAt: 'asc' },
    });
    // A restart (2 → 1) is not an increment.
    expect(increments.map((e) => (e.props as { streak_count: number }).streak_count)).toEqual([
      1, 2,
    ]);
  });

  it('a charged rev-1 rewrite counts toward streak / rewrite_new_count; rev 2 does not', async () => {
    const { user, cookie } = await freeUser();
    const started = await t.http.post('/v1/rewrite/start').set('Cookie', cookie).send({});
    expect(started.status).toBe(200);
    const attemptId: string = started.body.attemptId;
    const rev1 = await t.http
      .post(`/v1/rewrite/${attemptId}/submit`)
      .set('Cookie', cookie)
      .send({ revision: 1, userEn: 'I always submit my work before the deadline.' });
    expect(rev1.status).toBe(200);

    let row = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.streakCount).toBe(1);
    let activity = await t.prisma.userDailyActivity.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(activity).toMatchObject({ rewriteNewCount: 1, reviewCount: 0 });

    t.clock.advanceMs(MINUTE_MS);
    const rev2 = await t.http
      .post(`/v1/rewrite/${attemptId}/submit`)
      .set('Cookie', cookie)
      .send({ revision: 2, userEn: 'Every week I submit my work early.' });
    expect(rev2.status).toBe(200);
    row = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.streakCount).toBe(1);
    activity = await t.prisma.userDailyActivity.findFirstOrThrow({ where: { userId: user.id } });
    expect(activity.rewriteNewCount).toBe(1);
  });
});
