import { SUPPORT } from '@writeback/shared';
import { SupportService } from '../src/support/support.service';
import { createTestApp, type TestApp } from './helpers/app';
import { flushRedis, resetDatabase } from './helpers/db';
import { createUser } from './helpers/factories';
import {
  auditRows,
  chargeRewriteNew,
  createLearnableTopic,
  createStaff,
} from './helpers/staff-factories';

const MS_PER_SECOND = 1000;
const FREE_REWRITE_NEW = 10;
const VALID_REASON = 'user reports missing quota after outage';

describe('Support â€” impersonation + quota grants (integration)', () => {
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

  function impersonate(cookie: string, targetId: string, body: object) {
    return t.http.post(`/v1/admin/users/${targetId}/impersonate`).set('Cookie', cookie).send(body);
  }

  describe('POST /v1/admin/users/:id/impersonate', () => {
    it('rejects a missing or short reason with 422 VALIDATION', async () => {
      const support = await createStaff(t.prisma, 'support');
      const target = await createUser(t.prisma);
      const missing = await impersonate(support.cookie, target.user.id, {});
      expect(missing.status).toBe(422);
      expect(missing.body.error.code).toBe('VALIDATION');
      const short = await impersonate(support.cookie, target.user.id, {
        reason: 'x'.repeat(SUPPORT.IMPERSONATE_REASON_MIN_LENGTH - 1),
      });
      expect(short.status).toBe(422);
      expect(await t.prisma.impersonationSession.count()).toBe(0);
    });

    it('rejects staff targets with 422 and non-staff actors with 403', async () => {
      const support = await createStaff(t.prisma, 'support');
      const editor = await createStaff(t.prisma, 'editor');
      const user = await createUser(t.prisma);
      const staffTarget = await impersonate(support.cookie, editor.user.id, {
        reason: VALID_REASON,
      });
      expect(staffTarget.status).toBe(422);
      expect(staffTarget.body.error.details.reason).toBe('target_not_user');
      const asUser = await impersonate(user.cookie, support.user.id, { reason: VALID_REASON });
      expect(asUser.status).toBe(403);
      const asEditor = await impersonate(editor.cookie, user.user.id, { reason: VALID_REASON });
      expect(asEditor.status).toBe(403);
    });

    it('switches /v1/me to the target, blocks /admin while impersonating, one open session per actor', async () => {
      const support = await createStaff(t.prisma, 'support');
      const target = await createUser(t.prisma, { plan: 'free' });
      const started = await impersonate(support.cookie, target.user.id, { reason: VALID_REASON });
      expect(started.status).toBe(200);
      expect(started.body.targetId).toBe(target.user.id);
      expect(typeof started.body.impersonationId).toBe('string');
      expect(started.body.expiresAt).toBe(
        new Date(
          t.clock.now().getTime() + SUPPORT.IMPERSONATE_TTL_SECONDS * MS_PER_SECOND,
        ).toISOString(),
      );

      const me = await t.http.get('/v1/me').set('Cookie', support.cookie);
      expect(me.status).toBe(200);
      expect(me.body.id).toBe(target.user.id);
      expect(me.body.role).toBe('user');
      expect(me.body.impersonatorId).toBe(support.user.id);
      expect(me.body.limits.rewriteNewPerDay).toBe(FREE_REWRITE_NEW);

      const admin = await t.http.get('/v1/admin/users').set('Cookie', support.cookie);
      expect(admin.status).toBe(403);

      // Over HTTP the impersonating principal is locked out of /admin/* first (403). The 409 path
      // (partial unique index `impersonation_one_open_actor`) is exercised at the service level.
      const second = await impersonate(support.cookie, target.user.id, { reason: VALID_REASON });
      expect(second.status).toBe(403);
      await expect(
        t.app
          .get(SupportService)
          .impersonate(support.user, target.user.id, VALID_REASON, 'req-second'),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await t.prisma.impersonationSession.count()).toBe(1);

      const audit = await auditRows(t.prisma, { action: 'impersonate.start' });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.targetId).toBe(target.user.id);
      expect(audit[0]?.props).toMatchObject({ reasonLength: VALID_REASON.length });
      expect(JSON.stringify(audit[0]?.props)).not.toContain(VALID_REASON);
    });

    it('learning gates follow the target (ToS of the target, not the actor)', async () => {
      const support = await createStaff(t.prisma, 'support');
      const target = await createUser(t.prisma, { tosAccepted: false });
      const started = await impersonate(support.cookie, target.user.id, { reason: VALID_REASON });
      expect(started.status).toBe(200);
      const me = await t.http.get('/v1/me').set('Cookie', support.cookie);
      expect(me.body.id).toBe(target.user.id);
      expect(me.body.learningBlockedReason).toBe('TOS_REQUIRED');
      const start = await t.http.post('/v1/rewrite/start').set('Cookie', support.cookie).send({});
      expect(start.status).toBe(403);
      expect(start.body.error.code).toBe('TOS_REQUIRED');
    });
  });

  describe('POST /v1/admin/impersonate/stop', () => {
    it('ends the open session, audits, and /me returns to the actor; 404 when none', async () => {
      const support = await createStaff(t.prisma, 'support');
      const target = await createUser(t.prisma);
      const started = await impersonate(support.cookie, target.user.id, { reason: VALID_REASON });
      expect(started.status).toBe(200);

      const stopped = await t.http.post('/v1/admin/impersonate/stop').set('Cookie', support.cookie);
      expect(stopped.status).toBe(200);
      expect(stopped.body).toEqual({
        impersonationId: started.body.impersonationId,
        endedAt: t.clock.now().toISOString(),
      });

      const me = await t.http.get('/v1/me').set('Cookie', support.cookie);
      expect(me.body.id).toBe(support.user.id);
      expect(me.body.impersonatorId).toBeNull();

      const again = await t.http.post('/v1/admin/impersonate/stop').set('Cookie', support.cookie);
      expect(again.status).toBe(404);
      expect(await auditRows(t.prisma, { action: 'impersonate.stop' })).toHaveLength(1);

      const user = await createUser(t.prisma);
      const asUser = await t.http.post('/v1/admin/impersonate/stop').set('Cookie', user.cookie);
      expect(asUser.status).toBe(403);
    });

    it('expires after the TTL: /me is the actor again and a new impersonation can start', async () => {
      const support = await createStaff(t.prisma, 'support');
      const target = await createUser(t.prisma);
      const started = await impersonate(support.cookie, target.user.id, { reason: VALID_REASON });
      expect(started.status).toBe(200);

      t.clock.advanceMs(SUPPORT.IMPERSONATE_TTL_SECONDS * MS_PER_SECOND - MS_PER_SECOND);
      const still = await t.http.get('/v1/me').set('Cookie', support.cookie);
      expect(still.body.id).toBe(target.user.id);

      t.clock.advanceMs(2 * MS_PER_SECOND);
      const back = await t.http.get('/v1/me').set('Cookie', support.cookie);
      expect(back.body.id).toBe(support.user.id);
      expect(back.body.impersonatorId).toBeNull();
      const row = await t.prisma.impersonationSession.findUniqueOrThrow({
        where: { id: started.body.impersonationId },
      });
      expect(row.endedAt).not.toBeNull();

      const restart = await impersonate(support.cookie, target.user.id, { reason: VALID_REASON });
      expect(restart.status).toBe(200);
    });
  });

  describe('POST /v1/admin/users/:id/quota-grants', () => {
    function grant(cookie: string, targetId: string, body: object) {
      return t.http
        .post(`/v1/admin/users/${targetId}/quota-grants`)
        .set('Cookie', cookie)
        .send(body);
    }

    it('validates: above cap â†’ 422, all-zero â†’ 422, negative â†’ 422, user â†’ 403', async () => {
      const support = await createStaff(t.prisma, 'support');
      const target = await createUser(t.prisma, { plan: 'free' });
      const aboveCap = await grant(support.cookie, target.user.id, {
        reason: VALID_REASON,
        extraRewriteNew: FREE_REWRITE_NEW + 1,
        extraRetry: 0,
      });
      expect(aboveCap.status).toBe(422);
      expect(aboveCap.body.error.details).toEqual({
        reason: 'grant_above_cap',
        maxExtraRewriteNew: FREE_REWRITE_NEW,
      });
      const zero = await grant(support.cookie, target.user.id, {
        reason: VALID_REASON,
        extraRewriteNew: 0,
        extraRetry: 0,
      });
      expect(zero.status).toBe(422);
      const negative = await grant(support.cookie, target.user.id, {
        reason: VALID_REASON,
        extraRewriteNew: -1,
        extraRetry: 1,
      });
      expect(negative.status).toBe(422);
      const asUser = await grant(target.cookie, target.user.id, {
        reason: VALID_REASON,
        extraRewriteNew: 1,
        extraRetry: 0,
      });
      expect(asUser.status).toBe(403);
      expect(await t.prisma.quotaGrant.count()).toBe(0);
    });

    it('restores quota for today without touching attempts and audits quota.restore', async () => {
      const support = await createStaff(t.prisma, 'support');
      const { topic, prompt } = await createLearnableTopic(t.prisma);
      const target = await createUser(t.prisma, { plan: 'free', onboardingTopicIds: [topic.id] });
      await chargeRewriteNew(t.prisma, {
        userId: target.user.id,
        promptId: prompt.id,
        topicId: topic.id,
        scoredAt: t.clock.now(),
        count: FREE_REWRITE_NEW,
      });
      const exhausted = await t.http
        .post('/v1/rewrite/start')
        .set('Cookie', target.cookie)
        .send({});
      expect(exhausted.status).toBe(429);
      const chargedBefore = await t.prisma.rewriteAttempt.count({ where: { quotaCharged: true } });

      const res = await grant(support.cookie, target.user.id, {
        reason: VALID_REASON,
        extraRewriteNew: 2,
        extraRetry: 1,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ date: '2026-09-13', extraRewriteNew: 2, extraRetry: 1 });
      expect(typeof res.body.grantId).toBe('string');

      const start = await t.http.post('/v1/rewrite/start').set('Cookie', target.cookie).send({});
      expect(start.status).toBe(200);
      expect(start.body.quota).toEqual({ rewriteNewLeft: 2, retryLeft: 3 + 1 });

      const chargedAfter = await t.prisma.rewriteAttempt.count({ where: { quotaCharged: true } });
      expect(chargedAfter).toBe(chargedBefore);
      const audit = await auditRows(t.prisma, { action: 'quota.restore' });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.targetId).toBe(target.user.id);
      expect(audit[0]?.props).toMatchObject({
        grantId: res.body.grantId,
        date: '2026-09-13',
        extraRewriteNew: 2,
        extraRetry: 1,
      });
    });
  });
});
