import { Injectable } from '@nestjs/common';
import { Prisma, type Lemma, type Prompt, type PromptLemma, type User } from '@prisma/client';
import { isStaffRole } from '@writeback/shared';
import { PrismaService } from '../prisma/prisma.service';

export type PromptWithLemmas = Prompt & {
  lemmaLinks: (PromptLemma & { lemma: Lemma })[];
  topic: { id: string; nameVi: string; status: string; deletedAt: Date | null };
};

interface OverrideSets {
  allow: Set<string>;
  deny: Set<string>;
}

/** Design §8.1 visibility rules for lemmas, prompts and topics. */
@Injectable()
export class VisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async overrides(userId: string): Promise<OverrideSets> {
    const rows = await this.prisma.userTopicOverride.findMany({ where: { userId } });
    const allow = new Set<string>();
    const deny = new Set<string>();
    for (const row of rows) {
      (row.kind === 'allow' ? allow : deny).add(row.topicId);
    }
    return { allow, deny };
  }

  /** Prisma `where` fragment selecting lemmas visible to `user`. */
  async lemmaVisibilityWhere(user: User): Promise<Prisma.LemmaWhereInput> {
    const { allow, deny } = await this.overrides(user.id);
    const planAllows = isStaffRole(user.role) || user.plan === 'premium';
    const alive: Prisma.LemmaWhereInput = {
      deletedAt: null,
      status: 'published',
      topic: { deletedAt: null, status: 'published' },
    };
    const planClause: Prisma.LemmaWhereInput = planAllows
      ? {}
      : { OR: [{ includedInFree: true }, { topicId: { in: [...allow] } }] };
    const denyClause: Prisma.LemmaWhereInput =
      deny.size === 0 ? {} : { topicId: { notIn: [...deny] } };
    return { AND: [alive, planClause, denyClause] };
  }

  /** Pure predicate on an already-loaded lemma (+ its topic) using preloaded overrides. */
  isLemmaVisibleWith(
    user: User,
    lemma: Lemma,
    topic: { status: string; deletedAt: Date | null },
    overrides: OverrideSets,
  ): boolean {
    const alive =
      lemma.deletedAt === null &&
      lemma.status === 'published' &&
      topic.deletedAt === null &&
      topic.status === 'published';
    if (!alive) {
      return false;
    }
    const planAllows = isStaffRole(user.role) || user.plan === 'premium' || lemma.includedInFree;
    return (planAllows || overrides.allow.has(lemma.topicId)) && !overrides.deny.has(lemma.topicId);
  }

  async isLemmaVisible(user: User, lemmaId: string): Promise<boolean> {
    const where = await this.lemmaVisibilityWhere(user);
    const count = await this.prisma.lemma.count({ where: { AND: [where, { id: lemmaId }] } });
    return count > 0;
  }

  /** Subset of `topicIds` that are published, alive and have ≥1 visible lemma for `user`. */
  async visibleTopicIds(user: User, topicIds?: string[]): Promise<Set<string>> {
    const where = await this.lemmaVisibilityWhere(user);
    const rows = await this.prisma.lemma.findMany({
      where: { AND: [where, topicIds === undefined ? {} : { topicId: { in: topicIds } }] },
      select: { topicId: true },
      distinct: ['topicId'],
    });
    return new Set(rows.map((row) => row.topicId));
  }

  /** Alive published prompts whose EVERY target lemma is visible to `user`. */
  async visiblePromptCandidates(
    user: User,
    filters: { topicId?: string; lemmaId?: string },
  ): Promise<PromptWithLemmas[]> {
    const overrides = await this.overrides(user.id);
    const prompts = await this.prisma.prompt.findMany({
      where: {
        deletedAt: null,
        status: 'published',
        ...(filters.topicId !== undefined ? { topicId: filters.topicId } : {}),
        ...(filters.lemmaId !== undefined
          ? { lemmaLinks: { some: { lemmaId: filters.lemmaId } } }
          : {}),
      },
      include: {
        lemmaLinks: { include: { lemma: true }, orderBy: { sortOrder: 'asc' } },
        topic: { select: { id: true, nameVi: true, status: true, deletedAt: true } },
      },
    });
    return prompts.filter(
      (prompt) =>
        prompt.lemmaLinks.length > 0 &&
        prompt.lemmaLinks.every((link) =>
          this.isLemmaVisibleWith(user, link.lemma, prompt.topic, overrides),
        ),
    );
  }
}
