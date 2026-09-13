import { createTestApp, type TestApp } from './helpers/app';
import { flushRedis, resetDatabase } from './helpers/db';
import { createTopic, createUser } from './helpers/factories';
import {
  auditRows,
  chargeRewriteNew,
  createAuditRow,
  createLearnableTopic,
  createStaff,
} from './helpers/staff-factories';

const FREE_REWRITE_NEW = 10;
const PREMIUM_REWRITE_NEW = 50;
const CHARGED_TODAY = 12;

describe('Admin users / allowlist / audit (integration)', () => {
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

  describe('RBAC on GET /v1/admin/users', () => {
    it('returns 403 FORBIDDEN for user and editor', async () => {
      const user = await createUser(t.prisma);
      const editor = await createStaff(t.prisma, 'editor');
      for (const { cookie } of [user, editor]) {
        const res = await t.http.get('/v1/admin/users').set('Cookie', cookie);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect(await auditRows(t.prisma, { action: 'user.pii_view' })).toHaveLength(0);
    });

    it('returns 200 for support and writes exactly one user.pii_view row without emails', async () => {
      const support = await createStaff(t.prisma, 'support');
      await createUser(t.prisma, { email: 'alice@example.com' });
      await createUser(t.prisma, { email: 'bob@example.com' });
      const res = await t.http
        .get('/v1/admin/users')
        .query({ q: 'ALICE' })
        .set('Cookie', support.cookie)
        .set('x-request-id', 'req-list');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        email: 'alice@example.com',
        role: 'user',
        plan: 'free',
        cardCount: 0,
        rewriteNew7d: 0,
      });
      expect(res.body.nextCursor).toBeNull();
      const rows = await auditRows(t.prisma, { action: 'user.pii_view' });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actorId).toBe(support.user.id);
      expect(rows[0]?.requestId).toBe('req-list');
      expect(rows[0]?.props).toEqual({ query: 'alice', resultCount: 1 });
    });

    it('paginates with cursor + limit', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      await createUser(t.prisma);
      await createUser(t.prisma);
      const first = await t.http
        .get('/v1/admin/users')
        .query({ limit: 2 })
        .set('Cookie', admin.cookie);
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(2);
      expect(typeof first.body.nextCursor).toBe('string');
      const second = await t.http
        .get('/v1/admin/users')
        .query({ limit: 2, cursor: first.body.nextCursor })
        .set('Cookie', admin.cookie);
      expect(second.status).toBe(200);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();
      const ids = [...first.body.items, ...second.body.items].map((row: { id: string }) => row.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('GET /v1/admin/users/:id', () => {
    it('returns detail with overrides, quota and plan history and audits with targetId', async () => {
      const support = await createStaff(t.prisma, 'support');
      const { topic, prompt } = await createLearnableTopic(t.prisma);
      const target = await createUser(t.prisma, { onboardingTopicIds: [topic.id] });
      await chargeRewriteNew(t.prisma, {
        userId: target.user.id,
        promptId: prompt.id,
        topicId: topic.id,
        scoredAt: t.clock.now(),
        count: 3,
      });
      const res = await t.http
        .get(`/v1/admin/users/${target.user.id}`)
        .set('Cookie', support.cookie);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(target.user.id);
      expect(res.body.onboardingTopicIds).toEqual([topic.id]);
      expect(res.body.overrides).toEqual({ allowTopicIds: [], denyTopicIds: [] });
      expect(res.body.rewriteNew7d).toBe(3);
      expect(res.body.quotaToday).toMatchObject({
        rewriteNewUsed: 3,
        retryUsed: 0,
        rewriteNewLeft: FREE_REWRITE_NEW - 3,
        retryLeft: 3,
      });
      expect(res.body.planHistory).toEqual([]);
      const rows = await auditRows(t.prisma, { action: 'user.pii_view' });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.targetId).toBe(target.user.id);
    });

    it('returns 404 for an unknown or malformed id', async () => {
      const support = await createStaff(t.prisma, 'support');
      const missing = await t.http
        .get('/v1/admin/users/00000000-0000-4000-8000-000000000000')
        .set('Cookie', support.cookie);
      expect(missing.status).toBe(404);
      const malformed = await t.http
        .get('/v1/admin/users/not-a-uuid')
        .set('Cookie', support.cookie);
      expect(malformed.status).toBe(404);
    });
  });

  describe('POST /v1/admin/users/:id/plan', () => {
    it('is admin-only', async () => {
      const support = await createStaff(t.prisma, 'support');
      const target = await createUser(t.prisma);
      const res = await t.http
        .post(`/v1/admin/users/${target.user.id}/plan`)
        .set('Cookie', support.cookie)
        .send({ plan: 'premium', note: 'paid via bank transfer' });
      expect(res.status).toBe(403);
      expect(await t.prisma.planChange.count()).toBe(0);
    });

    it('requires a note', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      const target = await createUser(t.prisma);
      const res = await t.http
        .post(`/v1/admin/users/${target.user.id}/plan`)
        .set('Cookie', admin.cookie)
        .send({ plan: 'premium', note: '' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION');
    });

    it('writes plan_changes + audit and is visible immediately on GET /v1/me', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      const target = await createUser(t.prisma, { plan: 'free' });
      const res = await t.http
        .post(`/v1/admin/users/${target.user.id}/plan`)
        .set('Cookie', admin.cookie)
        .send({ plan: 'premium', note: 'paid via bank transfer' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ fromPlan: 'free', toPlan: 'premium' });

      const changes = await t.prisma.planChange.findMany({ where: { userId: target.user.id } });
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        fromPlan: 'free',
        toPlan: 'premium',
        changedById: admin.user.id,
        note: 'paid via bank transfer',
      });
      const audit = await auditRows(t.prisma, { action: 'plan.change' });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.targetId).toBe(target.user.id);
      expect(audit[0]?.props).toMatchObject({ fromPlan: 'free', toPlan: 'premium' });

      const me = await t.http.get('/v1/me').set('Cookie', target.cookie);
      expect(me.status).toBe(200);
      expect(me.body.plan).toBe('premium');
      expect(me.body.limits.rewriteNewPerDay).toBe(PREMIUM_REWRITE_NEW);

      const same = await t.http
        .post(`/v1/admin/users/${target.user.id}/plan`)
        .set('Cookie', admin.cookie)
        .send({ plan: 'premium', note: 'again' });
      expect(same.status).toBe(422);
    });

    it('mid-day upgrade: 12 charged rows on Free then premium â†’ rewriteNewLeft 38', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      const { topic, prompt } = await createLearnableTopic(t.prisma);
      const target = await createUser(t.prisma, { plan: 'free', onboardingTopicIds: [topic.id] });
      await chargeRewriteNew(t.prisma, {
        userId: target.user.id,
        promptId: prompt.id,
        topicId: topic.id,
        scoredAt: t.clock.now(),
        count: CHARGED_TODAY,
      });
      const blocked = await t.http.post('/v1/rewrite/start').set('Cookie', target.cookie).send({});
      expect(blocked.status).toBe(429);

      const upgrade = await t.http
        .post(`/v1/admin/users/${target.user.id}/plan`)
        .set('Cookie', admin.cookie)
        .send({ plan: 'premium', note: 'upgrade mid-day' });
      expect(upgrade.status).toBe(200);

      const detail = await t.http
        .get(`/v1/admin/users/${target.user.id}`)
        .set('Cookie', admin.cookie);
      expect(detail.body.quotaToday.rewriteNewUsed).toBe(CHARGED_TODAY);
      expect(detail.body.quotaToday.rewriteNewLeft).toBe(PREMIUM_REWRITE_NEW - CHARGED_TODAY);
      expect(detail.body.planHistory).toHaveLength(1);

      const start = await t.http.post('/v1/rewrite/start').set('Cookie', target.cookie).send({});
      expect(start.status).toBe(200);
      expect(start.body.quota.rewriteNewLeft).toBe(PREMIUM_REWRITE_NEW - CHARGED_TODAY);
    });
  });

  describe('POST /v1/admin/users/:id/role', () => {
    it('blocks demoting the last admin (self)', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      const res = await t.http
        .post(`/v1/admin/users/${admin.user.id}/role`)
        .set('Cookie', admin.cookie)
        .send({ role: 'support', note: 'stepping down' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(res.body.error.details.reason).toBe('self_last_admin');
      const reloaded = await t.prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } });
      expect(reloaded.role).toBe('admin');
      expect(await auditRows(t.prisma, { action: 'role.change' })).toHaveLength(0);
    });

    it('allows demotion when another admin remains, and promotes users; audits each', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      const other = await createStaff(t.prisma, 'admin');
      const user = await createUser(t.prisma);

      const promote = await t.http
        .post(`/v1/admin/users/${user.user.id}/role`)
        .set('Cookie', admin.cookie)
        .send({ role: 'support', note: 'joins support team' });
      expect(promote.status).toBe(200);
      expect(promote.body).toEqual({ id: user.user.id, role: 'support' });

      const demote = await t.http
        .post(`/v1/admin/users/${other.user.id}/role`)
        .set('Cookie', admin.cookie)
        .send({ role: 'editor', note: 'moves to content' });
      expect(demote.status).toBe(200);

      const lastAdmin = await t.http
        .post(`/v1/admin/users/${admin.user.id}/role`)
        .set('Cookie', admin.cookie)
        .send({ role: 'user', note: 'no more admins' });
      expect(lastAdmin.status).toBe(422);

      const audit = await auditRows(t.prisma, { action: 'role.change' });
      expect(audit).toHaveLength(2);
      expect(audit[0]?.props).toMatchObject({ fromRole: 'user', toRole: 'support' });
      expect(audit[1]?.props).toMatchObject({ fromRole: 'admin', toRole: 'editor' });
    });

    it('is forbidden for support', async () => {
      const support = await createStaff(t.prisma, 'support');
      const user = await createUser(t.prisma);
      const res = await t.http
        .post(`/v1/admin/users/${user.user.id}/role`)
        .set('Cookie', support.cookie)
        .send({ role: 'editor', note: 'nope' });
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /v1/admin/users/:id/overrides', () => {
    it('replaces the override set atomically and audits counts', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      const target = await createUser(t.prisma);
      const a = await createTopic(t.prisma);
      const b = await createTopic(t.prisma);
      const c = await createTopic(t.prisma);

      const first = await t.http
        .put(`/v1/admin/users/${target.user.id}/overrides`)
        .set('Cookie', admin.cookie)
        .send({ allowTopicIds: [a.id, b.id], denyTopicIds: [] });
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ allowTopicIds: [a.id, b.id], denyTopicIds: [] });

      const second = await t.http
        .put(`/v1/admin/users/${target.user.id}/overrides`)
        .set('Cookie', admin.cookie)
        .send({ allowTopicIds: [c.id], denyTopicIds: [a.id] });
      expect(second.status).toBe(200);

      const rows = await t.prisma.userTopicOverride.findMany({ where: { userId: target.user.id } });
      expect(rows.map((row) => `${row.kind}:${row.topicId}`).sort()).toEqual(
        [`allow:${c.id}`, `deny:${a.id}`].sort(),
      );
      expect(rows.every((row) => row.createdById === admin.user.id)).toBe(true);
      const audit = await auditRows(t.prisma, { action: 'override.change' });
      expect(audit).toHaveLength(2);
      expect(audit[1]?.props).toEqual({ allowCount: 1, denyCount: 1 });
    });

    it('rejects a topic in both lists and unknown/deleted topics with VALIDATION', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      const target = await createUser(t.prisma);
      const a = await createTopic(t.prisma);
      const deleted = await createTopic(t.prisma);
      await t.prisma.topic.update({
        where: { id: deleted.id },
        data: { deletedAt: t.clock.now() },
      });

      const overlap = await t.http
        .put(`/v1/admin/users/${target.user.id}/overrides`)
        .set('Cookie', admin.cookie)
        .send({ allowTopicIds: [a.id], denyTopicIds: [a.id] });
      expect(overlap.status).toBe(422);
      expect(overlap.body.error.code).toBe('VALIDATION');

      const gone = await t.http
        .put(`/v1/admin/users/${target.user.id}/overrides`)
        .set('Cookie', admin.cookie)
        .send({ allowTopicIds: [deleted.id], denyTopicIds: [] });
      expect(gone.status).toBe(422);
      expect(gone.body.error.details.reason).toBe('topic_not_found');
      expect(await t.prisma.userTopicOverride.count()).toBe(0);
    });

    it('has no lemma override endpoint (404 by absence)', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      const target = await createUser(t.prisma);
      const res = await t.http
        .put(`/v1/admin/users/${target.user.id}/lemma-overrides`)
        .set('Cookie', admin.cookie)
        .send({ allowLemmaIds: [] });
      expect(res.status).toBe(404);
    });
  });

  describe('/v1/admin/allowlist', () => {
    it('is admin-only', async () => {
      const support = await createStaff(t.prisma, 'support');
      const res = await t.http.get('/v1/admin/allowlist').set('Cookie', support.cookie);
      expect(res.status).toBe(403);
    });

    it('adds (normalised), rejects duplicates with 409, removes, and audits masked', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      const empty = await t.http.get('/v1/admin/allowlist').set('Cookie', admin.cookie);
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ enabled: t.config.betaAllowlistEnabled, emails: [] });

      const added = await t.http
        .post('/v1/admin/allowlist')
        .set('Cookie', admin.cookie)
        .send({ email: '  Carol@Example.COM ' });
      expect(added.status).toBe(200);
      expect(added.body).toMatchObject({ email: 'carol@example.com', createdById: admin.user.id });

      const dup = await t.http
        .post('/v1/admin/allowlist')
        .set('Cookie', admin.cookie)
        .send({ email: 'carol@example.com' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('CONFLICT');

      const list = await t.http.get('/v1/admin/allowlist').set('Cookie', admin.cookie);
      expect(list.body.emails).toHaveLength(1);
      expect(list.body.emails[0].email).toBe('carol@example.com');

      const removed = await t.http
        .delete('/v1/admin/allowlist/Carol@example.com')
        .set('Cookie', admin.cookie);
      expect(removed.status).toBe(200);
      expect(removed.body).toEqual({ email: 'carol@example.com' });
      const again = await t.http
        .delete('/v1/admin/allowlist/carol@example.com')
        .set('Cookie', admin.cookie);
      expect(again.status).toBe(404);

      const adds = await auditRows(t.prisma, { action: 'allowlist.add' });
      const removes = await auditRows(t.prisma, { action: 'allowlist.remove' });
      expect(adds).toHaveLength(1);
      expect(removes).toHaveLength(1);
      for (const row of [...adds, ...removes]) {
        expect(row.props).toEqual({ emailMasked: 'c***@example.com' });
        expect(JSON.stringify(row.props)).not.toContain('carol@');
        expect(row.targetId).not.toContain('@');
      }
    });

    it('rejects an invalid email with VALIDATION', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      const res = await t.http
        .post('/v1/admin/allowlist')
        .set('Cookie', admin.cookie)
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION');
    });
  });

  describe('GET /v1/admin/audit', () => {
    it('admin sees everything, support only own rows, editor/user 403', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      const support = await createStaff(t.prisma, 'support');
      const editor = await createStaff(t.prisma, 'editor');
      const user = await createUser(t.prisma);
      await createAuditRow(t.prisma, { actorId: admin.user.id, action: 'plan.change' });
      await createAuditRow(t.prisma, { actorId: support.user.id, action: 'quota.restore' });
      await createAuditRow(t.prisma, { actorId: support.user.id, action: 'impersonate.start' });

      const asAdmin = await t.http.get('/v1/admin/audit').set('Cookie', admin.cookie);
      expect(asAdmin.status).toBe(200);
      expect(asAdmin.body.items).toHaveLength(3);

      const asSupport = await t.http.get('/v1/admin/audit').set('Cookie', support.cookie);
      expect(asSupport.status).toBe(200);
      expect(asSupport.body.items).toHaveLength(2);
      expect(
        asSupport.body.items.every((row: { actorId: string }) => row.actorId === support.user.id),
      ).toBe(true);

      const filtered = await t.http
        .get('/v1/admin/audit')
        .query({ action: 'quota.restore' })
        .set('Cookie', admin.cookie);
      expect(filtered.body.items).toHaveLength(1);
      expect(filtered.body.items[0].action).toBe('quota.restore');

      const unknown = await t.http
        .get('/v1/admin/audit')
        .query({ action: 'not.an.action' })
        .set('Cookie', admin.cookie);
      expect(unknown.status).toBe(422);

      for (const { cookie } of [editor, user]) {
        const res = await t.http.get('/v1/admin/audit').set('Cookie', cookie);
        expect(res.status).toBe(403);
      }
    });

    it('paginates newest first', async () => {
      const admin = await createStaff(t.prisma, 'admin');
      for (let i = 0; i < 3; i += 1) {
        await createAuditRow(t.prisma, { actorId: admin.user.id, action: 'plan.change' });
      }
      const first = await t.http
        .get('/v1/admin/audit')
        .query({ limit: 2 })
        .set('Cookie', admin.cookie);
      expect(first.body.items).toHaveLength(2);
      expect(first.body.nextCursor).toBe(first.body.items[1].id);
      const second = await t.http
        .get('/v1/admin/audit')
        .query({ limit: 2, cursor: first.body.nextCursor })
        .set('Cookie', admin.cookie);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();
    });
  });
});
