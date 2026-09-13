import { ACCOUNT_DELETE_CONFIRMATION } from '@writeback/shared';
import { createTestApp, type TestApp } from './helpers/app';
import { flushRedis, resetDatabase } from './helpers/db';
import {
  createChargedAttempt,
  createLemma,
  createPrompt,
  createTopic,
  createUser,
  type CreatedUser,
} from './helpers/factories';

describe('DELETE /v1/me (integration)', () => {
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

  const del = (cookie: string, body: unknown) =>
    t.http
      .delete('/v1/me')
      .set('Cookie', cookie)
      .send(body as Record<string, unknown>);

  /** User with a card, a charged attempt, an OAuth account and audit rows about/by them. */
  async function seedUserWithData(
    email?: string,
  ): Promise<{ owner: CreatedUser; adminId: string }> {
    const topic = await createTopic(t.prisma);
    const lemma = await createLemma(t.prisma, { topicId: topic.id });
    const prompt = await createPrompt(t.prisma, { topicId: topic.id, targets: [lemma.id] });
    const owner = await createUser(t.prisma, { email, onboardingTopicIds: [topic.id] });
    const { user: admin } = await createUser(t.prisma, { role: 'admin' });
    await t.prisma.srsCard.create({
      data: { userId: owner.user.id, lemmaId: lemma.id, nextReviewAt: t.clock.now() },
    });
    await createChargedAttempt(t.prisma, {
      userId: owner.user.id,
      promptId: prompt.id,
      topicId: topic.id,
      scoredAt: t.clock.now(),
    });
    await t.prisma.account.create({
      data: {
        userId: owner.user.id,
        type: 'oidc',
        provider: 'google',
        providerAccountId: `google-${owner.user.id}`,
      },
    });
    await t.prisma.analyticsEvent.create({
      data: { userId: owner.user.id, name: 'rewrite_started', props: {} },
    });
    await t.prisma.auditLog.createMany({
      data: [
        {
          actorId: admin.id,
          action: 'user.plan_changed',
          targetType: 'user',
          targetId: owner.user.id,
          props: { email: owner.user.email, before: { plan: 'free', userEmail: owner.user.email } },
        },
        {
          actorId: owner.user.id,
          action: 'me.tos_accepted',
          targetType: 'user',
          targetId: owner.user.id,
          props: { Email: owner.user.email, tosVersion: '1' },
        },
        {
          actorId: admin.id,
          action: 'topic.published',
          targetType: 'topic',
          targetId: topic.id,
          props: { email: 'unrelated@example.com' },
        },
      ],
    });
    return { owner, adminId: admin.id };
  }

  it('401 without a session', async () => {
    const res = await t.http.delete('/v1/me').send({ confirm: ACCOUNT_DELETE_CONFIRMATION });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('422 VALIDATION when the confirmation word is wrong; nothing is deleted', async () => {
    const { owner } = await seedUserWithData();
    for (const body of [{ confirm: 'xoa' }, { confirm: 'XÓA' }, {}, { confirm: true }]) {
      const res = await del(owner.cookie, body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION');
    }
    expect(await t.prisma.user.findUnique({ where: { id: owner.user.id } })).not.toBeNull();
  });

  it('does not require ToS/onboarding (session only)', async () => {
    const { cookie } = await createUser(t.prisma, { tosAccepted: false });
    const res = await del(cookie, { confirm: ACCOUNT_DELETE_CONFIRMATION });
    expect(res.status).toBe(204);
  });

  it('204 hard-deletes the user, cascades data, kills the session and strips audit e-mails', async () => {
    const { owner, adminId } = await seedUserWithData();
    const userId = owner.user.id;

    const res = await del(owner.cookie, { confirm: ACCOUNT_DELETE_CONFIRMATION });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');

    const me = await t.http.get('/v1/me').set('Cookie', owner.cookie);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('UNAUTHENTICATED');

    expect(await t.prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await t.prisma.session.count({ where: { userId } })).toBe(0);
    expect(await t.prisma.account.count({ where: { userId } })).toBe(0);
    expect(await t.prisma.srsCard.count({ where: { userId } })).toBe(0);
    expect(await t.prisma.rewriteAttempt.count({ where: { userId } })).toBe(0);
    expect(await t.prisma.tosAcceptance.count({ where: { userId } })).toBe(0);
    expect(await t.prisma.userOnboardingTopic.count({ where: { userId } })).toBe(0);

    // Analytics rows survive with user_id = NULL.
    const events = await t.prisma.analyticsEvent.findMany({ where: { name: 'rewrite_started' } });
    expect(events).toHaveLength(1);
    expect(events[0]?.userId).toBeNull();

    // Audit rows are kept; UUIDs stay; every *email* key about/by the user is stripped.
    const about = await t.prisma.auditLog.findMany({
      where: { targetType: 'user', targetId: userId },
      orderBy: { action: 'asc' },
    });
    expect(about).toHaveLength(2);
    const byAction = Object.fromEntries(about.map((row) => [row.action, row]));
    expect(byAction['user.plan_changed']?.actorId).toBe(adminId);
    expect(byAction['user.plan_changed']?.targetId).toBe(userId);
    expect(byAction['user.plan_changed']?.props).toEqual({ before: { plan: 'free' } });
    expect(byAction['me.tos_accepted']?.actorId).toBeNull(); // FK SetNull
    expect(byAction['me.tos_accepted']?.props).toEqual({ tosVersion: '1' });
    for (const row of about) {
      expect(JSON.stringify(row.props).toLowerCase()).not.toContain('email');
    }

    // Rows about other targets are untouched.
    const other = await t.prisma.auditLog.findFirst({ where: { action: 'topic.published' } });
    expect(other?.props).toEqual({ email: 'unrelated@example.com' });
  });

  it('frees the e-mail: the same address signs up again as a new empty user', async () => {
    const email = 'returning@example.com';
    const { owner } = await seedUserWithData(email);
    const res = await del(owner.cookie, { confirm: ACCOUNT_DELETE_CONFIRMATION });
    expect(res.status).toBe(204);

    const again = await createUser(t.prisma, { email, tosAccepted: false });
    expect(again.user.id).not.toBe(owner.user.id);
    expect(again.user.email).toBe(email);
    expect(again.user.role).toBe('user');
    expect(again.user.plan).toBe('free');
    expect(again.user.tosAcceptedAt).toBeNull();
    expect(await t.prisma.srsCard.count({ where: { userId: again.user.id } })).toBe(0);
    expect(await t.prisma.rewriteAttempt.count({ where: { userId: again.user.id } })).toBe(0);

    const me = await t.http.get('/v1/me').set('Cookie', again.cookie);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(again.user.id);
    expect(me.body.learningBlockedReason).toBe('TOS_REQUIRED');
  });
});
