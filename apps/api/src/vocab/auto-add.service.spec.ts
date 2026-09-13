import type { RewriteAttempt, User } from '@prisma/client';
import type { ScoringOutput } from '@writeback/shared';
import { AutoAddService } from './auto-add.service';

const NOW = new Date('2026-09-13T10:00:00.000Z');
const user = { id: 'u1', role: 'user', plan: 'free' } as unknown as User;

function output(words: { headword: string; used: boolean }[]): ScoringOutput {
  return {
    used_required_words: words.map((w) => ({ ...w, natural: w.used, comment_vi: '' })),
  } as unknown as ScoringOutput;
}

function build(opts: { existing?: string[]; countedToday?: number; cap?: number | null }) {
  const existing = new Set(opts.existing ?? []);
  const tx = {
    srsCard: {
      count: jest.fn().mockResolvedValue(opts.countedToday ?? 0),
      findUnique: jest.fn(async ({ where }: { where: { userId_lemmaId: { lemmaId: string } } }) =>
        existing.has(where.userId_lemmaId.lemmaId) ? { id: 'c-existing', hiddenAt: new Date() } : null,
      ),
      create: jest.fn(async ({ data }: { data: { lemmaId: string; countedTowardDailyNew: boolean } }) => ({
        id: `card-${data.lemmaId}`,
        ...data,
      })),
    },
    lemma: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        headword: where.id.toUpperCase(),
        topicId: 't1',
        status: 'published',
        deletedAt: null,
        includedInFree: true,
        topic: { status: 'published', deletedAt: null },
      })),
    },
  };
  const visibility = {
    overrides: jest.fn().mockResolvedValue({ allow: new Set(), deny: new Set() }),
    isLemmaVisibleWith: jest.fn().mockReturnValue(true),
  };
  const planLimits = {
    forUser: jest.fn().mockResolvedValue({
      rewriteNewPerDay: 5,
      retryPerDay: 3,
      reviewSessionCap: 20,
      newCardsUsedNaturalPerDay: opts.cap === undefined ? 20 : opts.cap,
    }),
  };
  const service = new AutoAddService(visibility as never, planLimits as never, { businessTz: 'Asia/Ho_Chi_Minh' } as never);
  const attempt = {
    id: 'att1',
    revision: 1,
    targetsSnapshot: [
      { lemmaId: 'l1', headword: 'L1' },
      { lemmaId: 'l2', headword: 'L2' },
    ],
  } as unknown as RewriteAttempt;
  return { service, tx, attempt };
}

describe('AutoAddService.apply (design §9.4)', () => {
  it('skips lemmas that already have a card (even a hidden one)', async () => {
    const { service, tx, attempt } = build({ existing: ['l1'] });
    const result = await service.apply(tx as never, user, attempt, output([{ headword: 'L1', used: true }, { headword: 'L2', used: true }]), NOW);
    expect(result.cardsAdded.map((c) => c.lemmaId)).toEqual(['l2']);
    expect(tx.srsCard.create).toHaveBeenCalledTimes(1);
  });

  it('inserts used=false targets with countedTowardDailyNew=false and undoable=false', async () => {
    const { service, tx, attempt } = build({});
    const result = await service.apply(tx as never, user, attempt, output([{ headword: 'L1', used: false }, { headword: 'L2', used: true }]), NOW);
    const l1Call = tx.srsCard.create.mock.calls.find((c) => c[0].data.lemmaId === 'l1');
    expect(l1Call?.[0].data.countedTowardDailyNew).toBe(false);
    expect(result.cardsAdded).toEqual([
      expect.objectContaining({ lemmaId: 'l1', undoable: false }),
      expect.objectContaining({ lemmaId: 'l2', undoable: true }),
    ]);
  });

  it('defers used-natural targets once the Free cap of 20 is reached, but still adds used=false ones', async () => {
    const { service, tx, attempt } = build({ countedToday: 20, cap: 20 });
    const result = await service.apply(tx as never, user, attempt, output([{ headword: 'L1', used: true }, { headword: 'L2', used: false }]), NOW);
    expect(result.cardsDeferredCap20).toEqual([{ lemmaId: 'l1', headword: 'L1' }]);
    expect(result.cardsAdded.map((c) => c.lemmaId)).toEqual(['l2']);
    expect(tx.srsCard.create).toHaveBeenCalledTimes(1);
  });

  it('never defers when the cap is null (premium)', async () => {
    const { service, tx, attempt } = build({ countedToday: 999, cap: null });
    const result = await service.apply(tx as never, user, attempt, output([{ headword: 'L1', used: true }, { headword: 'L2', used: true }]), NOW);
    expect(result.cardsDeferredCap20).toEqual([]);
    expect(result.cardsAdded).toHaveLength(2);
    expect(tx.srsCard.create).toHaveBeenCalledTimes(2);
  });
});
