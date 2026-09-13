import type { SrsStatus } from '@prisma/client';
import { orderQueue, queueTier, ReviewQueueService } from './review-queue.service';

const TZ = 'Asia/Ho_Chi_Minh';
const DAY = 86_400_000;
/** 17:00 GMT+7 on 2026-09-13. */
const NOW = new Date('2026-09-13T10:00:00.000Z');

function card(id: string, status: SrsStatus, nextReviewAt: Date) {
  return { id, status, nextReviewAt };
}

describe('queueTier (design §10 order)', () => {
  it('puts new cards last regardless of how old they are', () => {
    expect(queueTier(card('a', 'new', new Date(NOW.getTime() - 10 * DAY)), NOW, TZ)).toBe(3);
  });

  it('treats a card whose business date is before today as overdue, whatever its status', () => {
    // 23:59 GMT+7 yesterday = 16:59Z on the 12th.
    const yesterday = new Date('2026-09-12T16:59:00.000Z');
    expect(queueTier(card('a', 'learning', yesterday), NOW, TZ)).toBe(0);
    expect(queueTier(card('a', 'review', yesterday), NOW, TZ)).toBe(0);
    expect(queueTier(card('a', 'mastered', yesterday), NOW, TZ)).toBe(0);
  });

  it('ranks learning cards due today before review/mastered cards due today', () => {
    // 00:30 GMT+7 today = 17:30Z on the 12th: same business day as NOW.
    const earlyToday = new Date('2026-09-12T17:30:00.000Z');
    expect(queueTier(card('a', 'learning', earlyToday), NOW, TZ)).toBe(1);
    expect(queueTier(card('a', 'review', earlyToday), NOW, TZ)).toBe(2);
    expect(queueTier(card('a', 'mastered', NOW), NOW, TZ)).toBe(2);
  });
});

describe('orderQueue', () => {
  it('orders overdue (oldest first) → learning → due today → new, ties by id', () => {
    const cards = [
      card('new-2', 'new', NOW),
      card('due-review', 'review', new Date(NOW.getTime() - 60_000)),
      card('learning', 'learning', NOW),
      card('overdue-1d', 'review', new Date(NOW.getTime() - DAY)),
      card('new-1', 'new', NOW),
      card('overdue-5d', 'mastered', new Date(NOW.getTime() - 5 * DAY)),
    ];
    expect(orderQueue(cards, NOW, TZ).map((c) => c.id)).toEqual([
      'overdue-5d',
      'overdue-1d',
      'learning',
      'due-review',
      'new-1',
      'new-2',
    ]);
  });

  it('does not mutate its input', () => {
    const cards = [card('b', 'new', NOW), card('a', 'new', NOW)];
    orderQueue(cards, NOW, TZ);
    expect(cards.map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('ReviewQueueService.dueCards (mocked Prisma)', () => {
  const service = new ReviewQueueService({ businessTz: TZ } as never);

  function tx(rows: unknown[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    return { tx: { srsCard: { findMany } } as never, findMany };
  }

  it('queries only visible cards of the user due before the end of the business day', async () => {
    const { tx: client, findMany } = tx([]);
    await service.dueCards(client, 'u1', NOW, ['graded-1']);
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({
      userId: 'u1',
      hiddenAt: null,
      id: { notIn: ['graded-1'] },
      // End of 2026-09-13 in GMT+7.
      nextReviewAt: { lt: new Date('2026-09-13T17:00:00.000Z') },
      lemma: {
        deletedAt: null,
        status: 'published',
        topic: { deletedAt: null, status: 'published' },
      },
    });
  });

  it('filters with isDueToday and returns cards in queue order', async () => {
    const rows = [
      card('new', 'new', NOW),
      card('tomorrow', 'review', new Date('2026-09-13T17:30:00.000Z')),
      card('overdue', 'review', new Date(NOW.getTime() - 2 * DAY)),
    ];
    const { tx: client } = tx(rows);
    const result = await service.dueCards(client, 'u1', NOW);
    expect(result.map((c) => c.id)).toEqual(['overdue', 'new']);
  });
});
