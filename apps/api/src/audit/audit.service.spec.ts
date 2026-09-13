import type { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ACTIONS } from './audit-actions';
import { AuditService, maskEmail } from './audit.service';

const NOW = new Date('2026-09-13T10:00:00.000Z');

function serviceWithSpy(): { service: AuditService; create: jest.Mock } {
  const create = jest.fn().mockResolvedValue(undefined);
  const prisma = { auditLog: { create } } as unknown as PrismaService;
  return { service: new AuditService(prisma, { now: () => NOW }), create };
}

describe('AuditService (PRD §10.11, design §7.7)', () => {
  it('writes actor/action/target/props/request_id/created_at', async () => {
    const { service, create } = serviceWithSpy();
    await service.record({
      actorId: 'actor',
      action: AUDIT_ACTIONS.CONTENT_PUBLISH,
      targetType: 'lemma',
      targetId: 'lemma-1',
      props: { topicId: 't' },
      requestId: 'req-1',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: 'actor',
        action: 'content.publish',
        targetType: 'lemma',
        targetId: 'lemma-1',
        props: { topicId: 't' },
        requestId: 'req-1',
        createdAt: NOW,
      },
    });
  });

  it('rejects unknown actions', async () => {
    const { service, create } = serviceWithSpy();
    await expect(
      service.record({ actorId: null, action: 'content.delete', targetType: 'lemma' }),
    ).rejects.toThrow(/unknown audit action/);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['user_en', 'sample_en', 'model_rewrite_en'])(
    'rejects forbidden key %s (nested too)',
    async (key) => {
      const { service, create } = serviceWithSpy();
      await expect(
        service.record({
          actorId: null,
          action: AUDIT_ACTIONS.IMPORT_COMMIT,
          targetType: 'import_batch',
          props: { nested: { [key]: 'x' } },
        }),
      ).rejects.toThrow(/forbidden keys/);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('masks email unless the action is user.pii_view', async () => {
    const { service, create } = serviceWithSpy();
    await service.record({
      actorId: null,
      action: AUDIT_ACTIONS.PLAN_CHANGE,
      targetType: 'user',
      props: { email: 'alice@example.com' },
    });
    await service.record({
      actorId: null,
      action: AUDIT_ACTIONS.USER_PII_VIEW,
      targetType: 'user',
      props: { email: 'alice@example.com' },
    });
    expect(create.mock.calls[0]?.[0].data.props).toEqual({ email: 'a***@example.com' });
    expect(create.mock.calls[1]?.[0].data.props).toEqual({ email: 'alice@example.com' });
  });

  it('maskEmail keeps first character and domain', () => {
    expect(maskEmail('bob@x.io')).toBe('b***@x.io');
    expect(maskEmail('not-an-email')).toBe('***');
  });
});
