import type { Lemma, Prompt, Topic } from '@prisma/client';
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
import { createCard, createScoredAttempt } from './helpers/learning-factories';

const NOW = new Date('2026-09-13T10:00:00.000Z'); // 17:00 GMT+7
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const FORBIDDEN_KEYS = ['cefr', 'sampleEn', 'sample_en', 'sampleEnSnapshot', 'modelRewriteEn'];

describe('vocab (integration)', () => {
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
    lemmaA1 = await createLemma(t.prisma, {
      topicId: topicA.id,
      headword: 'improve',
      exampleEn: 'I want to improve my English.',
    });
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
  const list = (cookie: string) => t.http.get('/v1/vocab').set('Cookie', cookie);
  const detail = (cookie: string, lemmaId: string) =>
    t.http.get(`/v1/vocab/${lemmaId}`).set('Cookie', cookie);
  const hide = (cookie: string, lemmaId: string) =>
    t.http.post(`/v1/vocab/${lemmaId}/hide`).set('Cookie', cookie).send({});
  const unhide = (cookie: string, lemmaId: string) =>
    t.http.post(`/v1/vocab/${lemmaId}/unhide`).set('Cookie', cookie).send({});

  // ---- list ------------------------------------------------------------------------------
  it('GET /vocab groups visible cards by topic, lists hidden separately and drops content-gone', async () => {
    const { user, cookie } = await learner();
    const due = await createCard(t.prisma, {
      userId: user.id,
      lemmaId: lemmaA1.id,
      nextReviewAt: new Date(NOW.getTime() - DAY_MS),
      status: 'learning',
    });
    await createCard(t.prisma, {
      userId: user.id,
      lemmaId: lemmaA2.id,
      nextReviewAt: new Date(NOW.getTime() + 3 * DAY_MS),
    });
    const hiddenCard = await createCard(t.prisma, {
      userId: user.id,
      lemmaId: lemmaB1.id,
      nextReviewAt: NOW,
      hiddenAt: NOW,
    });
    await createCard(t.prisma, { userId: user.id, lemmaId: draftLemma.id, nextReviewAt: NOW });
    // Another user's card must never show up.
    const other = await learner();
    await createCard(t.prisma, { userId: other.user.id, lemmaId: lemmaB1.id, nextReviewAt: NOW });

    const res = await list(cookie);
    expect(res.status).toBe(200);
    expect(res.body.topics).toHaveLength(1);
    expect(res.body.topics[0]).toMatchObject({ topicId: topicA.id, nameVi: 'Công việc' });
    const cards = res.body.topics[0].cards;
    expect(cards.map((c: { headword: string }) => c.headword)).toEqual(['improve', 'negotiate']);
    expect(cards[0]).toMatchObject({
      cardId: due.id,
      lemmaId: lemmaA1.id,
      status: 'learning',
      dueToday: true,
    });
    expect(cards[1].dueToday).toBe(false);
    expect(res.body.hidden).toEqual([
      { cardId: hiddenCard.id, lemmaId: lemmaB1.id, headword: 'journey', topicNameVi: 'Du lịch' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('draftword');
  });

  it('GET /vocab for a user without cards → empty groups', async () => {
    const { cookie } = await learner();
    const res = await list(cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ topics: [], hidden: [] });
  });

  // ---- detail ----------------------------------------------------------------------------
  it('GET /vocab/:lemmaId returns lemma + srs + up to 3 newest used:true sentences', async () => {
    const { user, cookie } = await learner();
    await createCard(t.prisma, {
      userId: user.id,
      lemmaId: lemmaA1.id,
      nextReviewAt: NOW,
      status: 'review',
      ef: 2.6,
      repetitions: 2,
      intervalDays: 6,
    });
    const targets = [{ lemmaId: lemmaA1.id, headword: 'improve' }];
    const base = { userId: user.id, promptId: prompt.id, topicId: topicA.id, targets };
    for (let i = 0; i < 4; i += 1) {
      await createScoredAttempt(t.prisma, {
        ...base,
        scoredAt: new Date(NOW.getTime() - (i + 1) * HOUR_MS),
        userEn: `Used sentence ${i}.`,
      });
    }
    // Newest of all but the word was NOT used → excluded.
    await createScoredAttempt(t.prisma, {
      ...base,
      scoredAt: new Date(NOW.getTime() - 1_000),
      userEn: 'Unused sentence.',
      usedWords: [{ headword: 'improve', used: false }],
    });
    // Another user's used sentence → excluded.
    const other = await learner();
    await createScoredAttempt(t.prisma, {
      ...base,
      userId: other.user.id,
      scoredAt: NOW,
      userEn: 'Other user sentence.',
    });

    const res = await detail(cookie, lemmaA1.id);
    expect(res.status).toBe(200);
    expect(res.body.lemma).toEqual({
      lemmaId: lemmaA1.id,
      headword: 'improve',
      pos: 'noun',
      phonetic: null,
      senseVi: lemmaA1.senseVi,
      notesVi: null,
      exampleEn: 'I want to improve my English.',
      topicNameVi: 'Công việc',
    });
    expect(res.body.srs).toEqual({
      status: 'review',
      nextReviewAt: NOW.toISOString(),
      intervalDays: 6,
      ef: 2.6,
      repetitions: 2,
    });
    expect(res.body.sentences).toHaveLength(3);
    expect(res.body.sentences.map((s: { text: string }) => s.text)).toEqual([
      'Used sentence 0.',
      'Used sentence 1.',
      'Used sentence 2.',
    ]);
    expect(res.body.sentences[0]).toMatchObject({ source: 'user' });
    expect(typeof res.body.sentences[0].attemptId).toBe('string');
    const keys = collectKeys(res.body);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(JSON.stringify(res.body)).not.toContain('must never leak');
  });

  it('GET /vocab/:lemmaId falls back to one labelled example sentence', async () => {
    const { user, cookie } = await learner();
    await createCard(t.prisma, { userId: user.id, lemmaId: lemmaA1.id, nextReviewAt: NOW });
    const res = await detail(cookie, lemmaA1.id);
    expect(res.status).toBe(200);
    expect(res.body.sentences).toEqual([
      { text: 'I want to improve my English.', source: 'example', label: 'câu mẫu' },
    ]);
  });

  it('GET /vocab/:lemmaId → 404 for hidden card, no card, unpublished lemma, other user', async () => {
    const owner = await learner();
    const other = await learner();
    await createCard(t.prisma, {
      userId: owner.user.id,
      lemmaId: lemmaA1.id,
      nextReviewAt: NOW,
      hiddenAt: NOW,
    });
    await createCard(t.prisma, {
      userId: owner.user.id,
      lemmaId: draftLemma.id,
      nextReviewAt: NOW,
    });
    await createCard(t.prisma, { userId: owner.user.id, lemmaId: lemmaB1.id, nextReviewAt: NOW });

    for (const [cookie, lemmaId] of [
      [owner.cookie, lemmaA1.id], // hidden
      [owner.cookie, lemmaA2.id], // no card
      [owner.cookie, draftLemma.id], // unpublished
      [other.cookie, lemmaB1.id], // other user's card
      [owner.cookie, 'not-a-uuid'],
    ]) {
      const res = await detail(cookie as string, lemmaId as string);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  // ---- hide / unhide ---------------------------------------------------------------------
  it('POST hide → detail 404 and the card moves to the hidden list', async () => {
    const { user, cookie } = await learner();
    const card = await createCard(t.prisma, {
      userId: user.id,
      lemmaId: lemmaA1.id,
      nextReviewAt: NOW,
    });
    const res = await hide(cookie, lemmaA1.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cardId: card.id, lemmaId: lemmaA1.id, hiddenAt: NOW.toISOString() });

    expect((await detail(cookie, lemmaA1.id)).status).toBe(404);
    const listed = await list(cookie);
    expect(listed.body.topics).toEqual([]);
    expect(listed.body.hidden.map((h: { cardId: string }) => h.cardId)).toEqual([card.id]);

    const again = await hide(cookie, lemmaA1.id);
    expect(again.status).toBe(404);
  });

  it('POST unhide restores the card without touching SM-2 or the daily-new flag', async () => {
    const { user, cookie } = await learner();
    const card = await createCard(t.prisma, {
      userId: user.id,
      lemmaId: lemmaA1.id,
      nextReviewAt: new Date(NOW.getTime() - 2 * DAY_MS),
      hiddenAt: new Date(NOW.getTime() - DAY_MS),
      status: 'review',
      ef: 2.36,
      repetitions: 3,
      intervalDays: 15,
      countedTowardDailyNew: true,
    });
    const res = await unhide(cookie, lemmaA1.id).set('x-request-id', 'req-unhide');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cardId: card.id, lemmaId: lemmaA1.id });

    const after = await t.prisma.srsCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(after.hiddenAt).toBeNull();
    expect(after).toMatchObject({
      status: 'review',
      ef: 2.36,
      repetitions: 3,
      intervalDays: 15,
      countedTowardDailyNew: true,
      nextReviewAt: card.nextReviewAt,
    });
    expect((await detail(cookie, lemmaA1.id)).status).toBe(200);
    const listed = await list(cookie);
    expect(listed.body.hidden).toEqual([]);
    expect(listed.body.topics[0].cards[0].cardId).toBe(card.id);

    const event = await t.prisma.analyticsEvent.findFirstOrThrow({
      where: { name: 'vocab_unhidden', userId: user.id },
    });
    expect(event.props).toEqual({ card_id: card.id, lemma_id: lemmaA1.id });
    expect(event.requestId).toBe('req-unhide');

    // Already visible → 404 (nothing to unhide).
    expect((await unhide(cookie, lemmaA1.id)).status).toBe(404);
  });

  it("POST unhide of another user's card / no card / content gone → 404", async () => {
    const owner = await learner();
    const other = await learner();
    await createCard(t.prisma, {
      userId: owner.user.id,
      lemmaId: lemmaA1.id,
      nextReviewAt: NOW,
      hiddenAt: NOW,
    });
    await createCard(t.prisma, {
      userId: owner.user.id,
      lemmaId: draftLemma.id,
      nextReviewAt: NOW,
      hiddenAt: NOW,
    });
    for (const [cookie, lemmaId] of [
      [other.cookie, lemmaA1.id],
      [owner.cookie, lemmaA2.id],
      [owner.cookie, draftLemma.id],
    ]) {
      const res = await unhide(cookie as string, lemmaId as string);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    const still = await t.prisma.srsCard.findFirstOrThrow({
      where: { userId: owner.user.id, lemmaId: lemmaA1.id },
    });
    expect(still.hiddenAt).not.toBeNull();
  });

  // ---- existing behaviour kept -----------------------------------------------------------
  it('POST /vocab stays FORBIDDEN', async () => {
    const { cookie } = await learner();
    const res = await t.http.post('/v1/vocab').set('Cookie', cookie).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
