import type { Lemma, Prompt, Topic } from '@prisma/client';
import { REWRITE } from '@writeback/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { flushRedis, resetDatabase } from './helpers/db';
import {
  collectKeys,
  createChargedAttempt,
  createLemma,
  createPrompt,
  createQuotaGrant,
  createTopic,
  createUser,
  type CreatedUser,
} from './helpers/factories';

const FORBIDDEN_KEYS = ['sampleEn', 'modelRewriteEn', 'exampleEn', 'sample_en', 'example_en'];

describe('rewrite flow (integration)', () => {
  let t: TestApp;
  let topic: Topic;
  let freeLemma: Lemma;
  let premiumLemma: Lemma;
  let freePrompt: Prompt;
  let premiumPrompt: Prompt;

  beforeAll(async () => {
    t = await createTestApp();
    await flushRedis(t.config.redisUrl);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await flushRedis(t.config.redisUrl);
    t.scoring.calls.length = 0;
    t.clock.set(new Date('2026-09-13T10:00:00.000Z'));
    topic = await createTopic(t.prisma);
    freeLemma = await createLemma(t.prisma, {
      topicId: topic.id,
      includedInFree: true,
      headword: 'improve',
    });
    premiumLemma = await createLemma(t.prisma, {
      topicId: topic.id,
      includedInFree: false,
      headword: 'negotiate',
    });
    freePrompt = await createPrompt(t.prisma, {
      topicId: topic.id,
      targets: [freeLemma.id],
      sampleEn: 'I want to improve my English every day.',
      textVi: 'Tôi muốn cải thiện tiếng Anh mỗi ngày.',
    });
    premiumPrompt = await createPrompt(t.prisma, {
      topicId: topic.id,
      targets: [premiumLemma.id],
      sampleEn: 'We negotiate the price before signing.',
    });
    await createPrompt(t.prisma, {
      topicId: topic.id,
      targets: [freeLemma.id],
      status: 'draft',
      sampleEn: 'Draft prompt that must never be served.',
    });
  });

  afterAll(async () => {
    await t.close();
  });

  const freeUser = (): Promise<CreatedUser> =>
    createUser(t.prisma, { plan: 'free', onboardingTopicIds: [topic.id] });
  const premiumUser = (): Promise<CreatedUser> =>
    createUser(t.prisma, { plan: 'premium', onboardingTopicIds: [topic.id] });

  const start = (cookie: string, body: Record<string, unknown> = {}) =>
    t.http.post('/v1/rewrite/start').set('Cookie', cookie).send(body);
  const submit = (cookie: string, attemptId: string, revision: number, userEn: string) =>
    t.http.post(`/v1/rewrite/${attemptId}/submit`).set('Cookie', cookie).send({ revision, userEn });

  // ---- gates -----------------------------------------------------------------------------
  it('start → 403 ONBOARDING_REQUIRED for a user without onboarding topics', async () => {
    const { cookie } = await createUser(t.prisma, { plan: 'free' });
    const res = await start(cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ONBOARDING_REQUIRED');
  });

  it('start → 403 TOS_REQUIRED for a user without ToS', async () => {
    const { cookie } = await createUser(t.prisma, {
      tosAccepted: false,
      onboardingTopicIds: [topic.id],
    });
    const res = await start(cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TOS_REQUIRED');
  });

  // ---- picker / visibility ---------------------------------------------------------------
  it('free user never receives the premium or draft prompt across many starts', async () => {
    const { cookie } = await freeUser();
    const seen = new Set<string>();
    for (let i = 0; i < 6; i += 1) {
      t.random.push(i / 6);
      const res = await start(cookie);
      expect(res.status).toBe(200);
      seen.add(res.body.prompt.id);
    }
    expect(seen).toEqual(new Set([freePrompt.id]));
  });

  it('an allow override makes the premium prompt eligible for a free user', async () => {
    const { user, cookie } = await freeUser();
    const admin = await createUser(t.prisma, { role: 'admin' });
    await t.prisma.userTopicOverride.create({
      data: { userId: user.id, topicId: topic.id, kind: 'allow', createdById: admin.user.id },
    });
    const res = await start(cookie, { lemmaId: premiumLemma.id });
    expect(res.status).toBe(200);
    expect(res.body.prompt.id).toBe(premiumPrompt.id);
  });

  it('start { lemmaId } returns a prompt containing that lemma, or 422 NO_PROMPT', async () => {
    const { cookie } = await freeUser();
    const ok = await start(cookie, { lemmaId: freeLemma.id });
    expect(ok.status).toBe(200);
    expect(ok.body.prompt.targets.map((x: { lemmaId: string }) => x.lemmaId)).toContain(
      freeLemma.id,
    );
    const none = await start(cookie, { lemmaId: premiumLemma.id });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('NO_PROMPT');
  });

  // ---- start response leaks nothing ------------------------------------------------------
  it('start response never contains sample/model/example keys and snapshots sample_en', async () => {
    const { cookie } = await freeUser();
    const res = await start(cookie);
    expect(res.status).toBe(200);
    const keys = collectKeys(res.body);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(JSON.stringify(res.body)).not.toContain('I want to improve my English');
    const row = await t.prisma.rewriteAttempt.findFirstOrThrow({
      where: { attemptId: res.body.attemptId },
    });
    expect(row.sampleEnSnapshot).toBe('I want to improve my English every day.');
    expect(row.status).toBe('started');
    expect(res.body.quota).toEqual({ rewriteNewLeft: 10, retryLeft: 3 });
  });

  // ---- quota -----------------------------------------------------------------------------
  it('start → 429 QUOTA_EXCEEDED at 10 charged rows today; a grant re-enables it', async () => {
    const { user, cookie } = await freeUser();
    const scoredAt = new Date('2026-09-13T02:00:00.000Z'); // 09:00 GMT+7, same business day
    for (let i = 0; i < 10; i += 1) {
      await createChargedAttempt(t.prisma, {
        userId: user.id,
        promptId: freePrompt.id,
        topicId: topic.id,
        scoredAt,
      });
    }
    const before = await t.prisma.rewriteAttempt.count();
    const blocked = await start(cookie);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(await t.prisma.rewriteAttempt.count()).toBe(before);

    const admin = await createUser(t.prisma, { role: 'admin' });
    await createQuotaGrant(t.prisma, {
      userId: user.id,
      date: new Date('2026-09-13T00:00:00.000Z'),
      extraRewriteNew: 1,
      createdById: admin.user.id,
    });
    const ok = await start(cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.quota.rewriteNewLeft).toBe(1);
  });

  // ---- submit happy path -----------------------------------------------------------------
  it('submit happy path scores, charges quota and auto-adds used∧natural lemma', async () => {
    const { cookie } = await freeUser();
    const started = await start(cookie);
    const attemptId: string = started.body.attemptId;

    const res = await submit(cookie, attemptId, 1, 'Every day I try to improve my writing skills.');
    expect(res.status).toBe(200);
    expect(res.body.usedRequiredWords).toHaveLength(1);
    expect(res.body.usedRequiredWords[0]).toMatchObject({
      headword: 'improve',
      used: true,
      natural: true,
    });
    expect(res.body.displayIssues.length).toBeLessThanOrEqual(3);
    const scoredAt = new Date(res.body.scoredAt).getTime();
    expect(new Date(res.body.revisionUntil).getTime()).toBe(scoredAt + REWRITE.REVISION_WINDOW_MS);
    expect(res.body.cardsAdded).toHaveLength(1);
    expect(res.body.cardsAdded[0]).toMatchObject({ lemmaId: freeLemma.id, undoable: true });
    expect(res.body.quota.rewriteNewLeft).toBe(9);
    expect(res.body.quota.retryLeft).toBe(3);

    const row = await t.prisma.rewriteAttempt.findFirstOrThrow({ where: { attemptId } });
    expect(row.status).toBe('scored');
    expect(row.quotaCharged).toBe(true);
    expect(t.scoring.calls).toHaveLength(1);
  });

  // ---- copy block ------------------------------------------------------------------------
  it('submit with userEn ≈ sampleEn → 422 COPY_BLOCKED, provider not called, not charged', async () => {
    const { cookie } = await freeUser();
    const started = await start(cookie);
    const attemptId: string = started.body.attemptId;
    const res = await submit(cookie, attemptId, 1, 'i WANT to improve my english every day!!');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COPY_BLOCKED');
    expect(t.scoring.calls).toHaveLength(0);
    const row = await t.prisma.rewriteAttempt.findFirstOrThrow({ where: { attemptId } });
    expect(row.quotaCharged).toBe(false);
    expect(row.status).toBe('started');
  });

  // ---- invalid schema + retry ------------------------------------------------------------
  it('invalid provider schema → 502 LLM_INVALID_SCHEMA, row failed; resubmit succeeds and charges once', async () => {
    const { cookie } = await freeUser();
    const started = await start(cookie);
    const attemptId: string = started.body.attemptId;

    t.scoring.enqueueRaw({});
    const bad = await submit(cookie, attemptId, 1, 'I improve my skills daily.');
    expect(bad.status).toBe(502);
    expect(bad.body.error.code).toBe('LLM_INVALID_SCHEMA');
    let row = await t.prisma.rewriteAttempt.findFirstOrThrow({ where: { attemptId } });
    expect(row.status).toBe('failed');
    expect(row.failReason).toBe('invalid_schema');
    expect(row.quotaCharged).toBe(false);

    const good = await submit(cookie, attemptId, 1, 'I improve my skills daily.');
    expect(good.status).toBe(200);
    row = await t.prisma.rewriteAttempt.findFirstOrThrow({ where: { attemptId } });
    expect(row.status).toBe('scored');
    expect(row.quotaCharged).toBe(true);
    const charged = await t.prisma.rewriteAttempt.count({
      where: { attemptId, quotaCharged: true },
    });
    expect(charged).toBe(1);
    expect(good.body.quota.rewriteNewLeft).toBe(9);
  });

  // ---- idempotency -----------------------------------------------------------------------
  it('second identical submit returns the stored payload without calling the provider again', async () => {
    const { cookie } = await freeUser();
    const started = await start(cookie);
    const attemptId: string = started.body.attemptId;
    const first = await submit(cookie, attemptId, 1, 'I improve a little every day.');
    expect(first.status).toBe(200);
    const calls = t.scoring.calls.length;
    const second = await submit(cookie, attemptId, 1, 'I improve a little every day.');
    expect(second.status).toBe(200);
    expect(second.body.scoredAt).toBe(first.body.scoredAt);
    expect(second.body.overallScore).toBe(first.body.overallScore);
    expect(second.body.quota).toEqual(first.body.quota);
    expect(t.scoring.calls.length).toBe(calls);
  });

  // ---- 1-1 mismatch ----------------------------------------------------------------------
  it('provider returning an extra headword → 502 LLM_INVALID_SCHEMA, not charged', async () => {
    const { cookie } = await freeUser();
    const started = await start(cookie);
    const attemptId: string = started.body.attemptId;
    t.scoring.enqueueRaw({
      overall_score: 80,
      idea_match: { status: 'enough', comment_vi: 'ok' },
      used_required_words: [
        { headword: 'improve', used: true, natural: true, comment_vi: 'ok' },
        { headword: 'extra', used: true, natural: true, comment_vi: 'ok' },
      ],
      grammar_issues: [],
      lexical_issues: [],
      naturalness_note_vi: 'ok',
      model_rewrite_en: 'x',
      encouragement_vi: 'ok',
    });
    const res = await submit(cookie, attemptId, 1, 'I improve a lot.');
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('LLM_INVALID_SCHEMA');
    const row = await t.prisma.rewriteAttempt.findFirstOrThrow({ where: { attemptId } });
    expect(row.quotaCharged).toBe(false);
    expect(row.status).toBe('failed');
  });

  // ---- revision --------------------------------------------------------------------------
  it('rev 2 inside the window decrements retryLeft only; after 900s it is FORBIDDEN', async () => {
    const { cookie } = await freeUser();
    const started = await start(cookie);
    const attemptId: string = started.body.attemptId;
    const rev1 = await submit(cookie, attemptId, 1, 'I try to improve daily.');
    expect(rev1.status).toBe(200);
    expect(rev1.body.quota).toEqual({ rewriteNewLeft: 9, retryLeft: 3 });

    t.clock.advanceMs(60_000);
    const rev2 = await submit(cookie, attemptId, 2, 'Every single day I improve my English.');
    expect(rev2.status).toBe(200);
    expect(rev2.body.revision).toBe(2);
    expect(rev2.body.quota).toEqual({ rewriteNewLeft: 9, retryLeft: 2 });

    // A fresh attempt whose window has expired.
    const started2 = await start(cookie);
    const rev1b = await submit(cookie, started2.body.attemptId, 1, 'I improve when I practice.');
    expect(rev1b.status).toBe(200);
    t.clock.advanceMs(REWRITE.REVISION_WINDOW_MS + 1_000);
    const late = await submit(cookie, started2.body.attemptId, 2, 'I improve slowly but surely.');
    expect(late.status).toBe(403);
    expect(late.body.error.code).toBe('FORBIDDEN');
  });

  // ---- cross-user ------------------------------------------------------------------------
  it("another user's attempt is NOT_FOUND on GET and submit", async () => {
    const owner = await freeUser();
    const other = await freeUser();
    const started = await start(owner.cookie);
    const attemptId: string = started.body.attemptId;
    const get = await t.http.get(`/v1/rewrite/${attemptId}`).set('Cookie', other.cookie);
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe('NOT_FOUND');
    const sub = await submit(other.cookie, attemptId, 1, 'I improve.');
    expect(sub.status).toBe(404);
    expect(sub.body.error.code).toBe('NOT_FOUND');
    const own = await t.http.get(`/v1/rewrite/${attemptId}`).set('Cookie', owner.cookie);
    expect(own.status).toBe(200);
    expect(own.body.attemptId).toBe(attemptId);
  });

  // ---- vocab -----------------------------------------------------------------------------
  it('POST /v1/vocab is FORBIDDEN; undo-auto-add hides the card and it is not re-added', async () => {
    const { user, cookie } = await freeUser();
    const manual = await t.http.post('/v1/vocab').set('Cookie', cookie).send({});
    expect(manual.status).toBe(403);
    expect(manual.body.error.code).toBe('FORBIDDEN');

    const started = await start(cookie);
    const scored = await submit(cookie, started.body.attemptId, 1, 'I improve every day.');
    expect(scored.status).toBe(200);
    const cardId: string = scored.body.cardsAdded[0].cardId;

    const undo = await t.http
      .post(`/v1/vocab/cards/${cardId}/undo-auto-add`)
      .set('Cookie', cookie)
      .send({});
    expect(undo.status).toBe(200);
    const card = await t.prisma.srsCard.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.hiddenAt).not.toBeNull();

    // No-repeat would exclude the same prompt; force it via lemmaId and a later day.
    t.clock.advanceMs(8 * 86_400_000);
    const again = await start(cookie, { lemmaId: freeLemma.id });
    expect(again.status).toBe(200);
    const scored2 = await submit(cookie, again.body.attemptId, 1, 'I still improve every day.');
    expect(scored2.status).toBe(200);
    expect(scored2.body.cardsAdded).toEqual([]);
    const cards = await t.prisma.srsCard.count({
      where: { userId: user.id, lemmaId: freeLemma.id },
    });
    expect(cards).toBe(1);
  });

  // ---- rate limit ------------------------------------------------------------------------
  it('exceeding RATE_LIMIT_START_PER_MIN starts within a minute → 429 RATE_LIMITED', async () => {
    const { cookie } = await premiumUser();
    const limit = t.config.rateLimitStartPerMin;
    for (let i = 0; i < limit; i += 1) {
      const res = await start(cookie);
      expect(res.status).toBe(200);
    }
    const blocked = await start(cookie);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
