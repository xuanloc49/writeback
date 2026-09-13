import type { Prisma } from '@prisma/client';

/**
 * Design §7.4: a card's content is alive while its lemma AND topic are published and not
 * soft-deleted. Cards whose content is gone are `content_gone` (computed at read time) and
 * appear nowhere: not in the vocab list, not in due counts, not in the hidden list.
 */
export const ALIVE_LEMMA_WHERE: Prisma.LemmaWhereInput = {
  deletedAt: null,
  status: 'published',
  topic: { deletedAt: null, status: 'published' },
};

/** Visible card = own, not hidden, content alive (design §7.4). */
export function visibleCardWhere(userId: string): Prisma.SrsCardWhereInput {
  return { userId, hiddenAt: null, lemma: ALIVE_LEMMA_WHERE };
}

/** Hidden card whose content is still alive — the only kind that can be unhidden (design §9.4). */
export function hiddenCardWhere(userId: string): Prisma.SrsCardWhereInput {
  return { userId, hiddenAt: { not: null }, lemma: ALIVE_LEMMA_WHERE };
}
