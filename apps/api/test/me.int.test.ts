import { createTestApp, type TestApp } from './helpers/app';
import { flushRedis, resetDatabase } from './helpers/db';
import { createLemma, createTopic, createUser } from './helpers/factories';

describe('GET /v1/me (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await flushRedis(t.config.redisUrl);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  afterAll(async () => {
    await t.close();
  });

  it('returns 401 UNAUTHENTICATED envelope with request_id when no cookie', async () => {
    const res = await t.http.get('/v1/me').set('x-request-id', 'req-me-401');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.request_id).toBe('req-me-401');
    expect(res.headers['x-request-id']).toBe('req-me-401');
  });

  it('mints a request id when none is supplied', async () => {
    const res = await t.http.get('/v1/me');
    expect(res.status).toBe(401);
    expect(typeof res.body.error.request_id).toBe('string');
    expect(res.body.error.request_id.length).toBeGreaterThan(0);
    expect(res.headers['x-request-id']).toBe(res.body.error.request_id);
  });

  it('returns free limits 10/3/20/20 for a free user', async () => {
    const { cookie } = await createUser(t.prisma, { plan: 'free' });
    const res = await t.http.get('/v1/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('free');
    expect(res.body.limits).toEqual({
      rewriteNewPerDay: 10,
      retryPerDay: 3,
      reviewSessionCap: 20,
      newCardsUsedNaturalPerDay: 20,
    });
  });

  it('returns premium limits 50/10/40/null', async () => {
    const { cookie } = await createUser(t.prisma, { plan: 'premium' });
    const res = await t.http.get('/v1/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.limits).toEqual({
      rewriteNewPerDay: 50,
      retryPerDay: 10,
      reviewSessionCap: 40,
      newCardsUsedNaturalPerDay: null,
    });
  });

  it('returns staff limits 100/10/40/null for an admin', async () => {
    const { cookie } = await createUser(t.prisma, { role: 'admin' });
    const res = await t.http.get('/v1/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
    expect(res.body.limits).toEqual({
      rewriteNewPerDay: 100,
      retryPerDay: 10,
      reviewSessionCap: 40,
      newCardsUsedNaturalPerDay: null,
    });
  });

  it('reports learningBlocked with TOS_REQUIRED for a user without ToS', async () => {
    const { cookie } = await createUser(t.prisma, { tosAccepted: false });
    const res = await t.http.get('/v1/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.tosAcceptedAt).toBeNull();
    expect(res.body.learningBlocked).toBe(true);
    expect(res.body.learningBlockedReason).toBe('TOS_REQUIRED');
  });

  it('reports ONBOARDING_REQUIRED when ToS is accepted but no topics chosen', async () => {
    const { cookie } = await createUser(t.prisma);
    const res = await t.http.get('/v1/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.learningBlocked).toBe(true);
    expect(res.body.learningBlockedReason).toBe('ONBOARDING_REQUIRED');
  });

  it('is not blocked once ToS is accepted and a visible topic is chosen', async () => {
    const topic = await createTopic(t.prisma);
    await createLemma(t.prisma, { topicId: topic.id, includedInFree: true });
    const { cookie } = await createUser(t.prisma, { onboardingTopicIds: [topic.id] });
    const res = await t.http.get('/v1/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.learningBlocked).toBe(false);
    expect(res.body.learningBlockedReason).toBeNull();
    expect(res.body.onboardingTopicIds).toEqual([topic.id]);
  });
});
