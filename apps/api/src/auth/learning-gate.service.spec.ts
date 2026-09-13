import type { User } from '@prisma/client';
import { LearningGateService } from './learning-gate.service';

interface Setup {
  tosAcceptedAt?: Date | null;
  latestTos?: { tosVersion: string; privacyVersion: string } | null;
  allowlistEnabled?: boolean;
  allowlisted?: boolean;
  topics?: string[];
  role?: string;
}

function build(setup: Setup) {
  const topics = setup.topics ?? ['t1', 't2'];
  const prisma = {
    userOnboardingTopic: {
      findMany: jest.fn().mockResolvedValue(topics.map((topicId) => ({ topicId }))),
    },
    tosAcceptance: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          setup.latestTos === undefined
            ? { tosVersion: 'v2', privacyVersion: 'p2' }
            : setup.latestTos,
        ),
    },
    betaAllowlistEmail: {
      findUnique: jest.fn().mockResolvedValue(setup.allowlisted ? { email: 'x@y.z' } : null),
    },
  };
  const config = {
    tosVersion: 'v2',
    privacyVersion: 'p2',
    betaAllowlistEnabled: setup.allowlistEnabled ?? false,
  };
  const visibility = {
    visibleTopicIds: jest.fn(async (_user: User, ids: string[]) => new Set(ids)),
  };
  const service = new LearningGateService(prisma as never, config as never, visibility as never);
  const user = {
    id: 'u1',
    email: 'X@Y.Z ',
    role: setup.role ?? 'user',
    plan: 'free',
    tosAcceptedAt: setup.tosAcceptedAt === undefined ? new Date() : setup.tosAcceptedAt,
  } as unknown as User;
  return { service, user, prisma };
}

describe('LearningGateService.evaluate (design §6.1 gate order)', () => {
  it('returns TOS_REQUIRED before BETA_BLOCKED when ToS never accepted', async () => {
    const { service, user } = build({
      tosAcceptedAt: null,
      allowlistEnabled: true,
      allowlisted: false,
    });
    const result = await service.evaluate(user);
    expect(result).toMatchObject({ blocked: true, reason: 'TOS_REQUIRED' });
  });

  it('returns TOS_REQUIRED when the latest accepted tosVersion is stale', async () => {
    const { service, user } = build({ latestTos: { tosVersion: 'v1', privacyVersion: 'p2' } });
    expect((await service.evaluate(user)).reason).toBe('TOS_REQUIRED');
  });

  it('returns BETA_BLOCKED for a non-staff user not on the allowlist', async () => {
    const { service, user, prisma } = build({ allowlistEnabled: true, allowlisted: false });
    expect((await service.evaluate(user)).reason).toBe('BETA_BLOCKED');
    expect(prisma.betaAllowlistEmail.findUnique).toHaveBeenCalledWith({
      where: { email: 'x@y.z' },
    });
  });

  it('lets staff through the allowlist gate', async () => {
    const { service, user, prisma } = build({
      allowlistEnabled: true,
      allowlisted: false,
      role: 'admin',
    });
    expect((await service.evaluate(user)).blocked).toBe(false);
    expect(prisma.betaAllowlistEmail.findUnique).not.toHaveBeenCalled();
  });

  it('returns ONBOARDING_REQUIRED for 0 topics', async () => {
    const { service, user } = build({ topics: [] });
    expect(await service.evaluate(user)).toEqual({
      blocked: true,
      reason: 'ONBOARDING_REQUIRED',
      onboardingTopicIds: [],
    });
  });

  it('returns ONBOARDING_REQUIRED for 4 topics', async () => {
    const { service, user } = build({ topics: ['a', 'b', 'c', 'd'] });
    expect((await service.evaluate(user)).reason).toBe('ONBOARDING_REQUIRED');
  });

  it('passes with 1–3 visible topics', async () => {
    const { service, user } = build({ topics: ['a', 'b', 'c'] });
    expect(await service.evaluate(user)).toEqual({
      blocked: false,
      reason: null,
      onboardingTopicIds: ['a', 'b', 'c'],
    });
  });
});
