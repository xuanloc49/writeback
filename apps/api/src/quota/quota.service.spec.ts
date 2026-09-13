import { computeLeft, QuotaService } from './quota.service';

const NOW = new Date('2026-09-13T10:00:00.000Z');

describe('computeLeft (design §9.1)', () => {
  it('is limit − charged + grants', () => {
    expect(computeLeft(10, 3, 0)).toBe(7);
    expect(computeLeft(10, 3, 2)).toBe(9);
  });

  it('never goes negative', () => {
    expect(computeLeft(3, 5, 0)).toBe(0);
    expect(computeLeft(0, 0, 0)).toBe(0);
  });
});

describe('QuotaService.remaining', () => {
  const FREE = {
    rewriteNewPerDay: 5,
    retryPerDay: 3,
    reviewSessionCap: 20,
    newCardsUsedNaturalPerDay: 20,
  };
  const STAFF = {
    rewriteNewPerDay: 500,
    retryPerDay: 500,
    reviewSessionCap: 500,
    newCardsUsedNaturalPerDay: null,
  };

  function build(
    counts: { new: number; retry: number },
    grants: { new: number | null; retry: number | null },
  ) {
    const planLimits = {
      forUser: jest.fn(async (user: { role: string }) => (user.role === 'admin' ? STAFF : FREE)),
    };
    const tx = {
      rewriteAttempt: {
        count: jest.fn(async ({ where }: { where: { revision: number } }) =>
          where.revision === 1 ? counts.new : counts.retry,
        ),
      },
      quotaGrant: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { extraRewriteNew: grants.new, extraRetry: grants.retry } }),
      },
    };
    const service = new QuotaService(
      planLimits as never,
      { businessTz: 'Asia/Ho_Chi_Minh' } as never,
    );
    return { service, tx, planLimits };
  }

  it('computes rev1 and rev2 remaining separately, including grants', async () => {
    const { service, tx } = build({ new: 2, retry: 1 }, { new: 1, retry: null });
    const left = await service.remaining(
      tx as never,
      { id: 'u1', role: 'user', plan: 'free' },
      NOW,
    );
    expect(left).toEqual({ rewriteNewLeft: 5 - 2 + 1, retryLeft: 3 - 1 });
  });

  it('clamps at zero when over-charged', async () => {
    const { service, tx } = build({ new: 9, retry: 7 }, { new: null, retry: null });
    const left = await service.remaining(
      tx as never,
      { id: 'u1', role: 'user', plan: 'free' },
      NOW,
    );
    expect(left).toEqual({ rewriteNewLeft: 0, retryLeft: 0 });
  });

  it('uses the staff limits for an admin regardless of plan', async () => {
    const { service, tx, planLimits } = build({ new: 1, retry: 0 }, { new: null, retry: null });
    const admin = { id: 'a1', role: 'admin', plan: 'free' } as const;
    const left = await service.remaining(tx as never, admin, NOW);
    expect(planLimits.forUser).toHaveBeenCalledWith(admin, tx);
    expect(left).toEqual({ rewriteNewLeft: 499, retryLeft: 500 });
  });
});
