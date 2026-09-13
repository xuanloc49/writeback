import { randomUUID } from 'node:crypto';
import type { ContentStatus, Lemma, Plan, Prompt, Role, Topic, User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { SESSION } from '@writeback/shared';
import type { PrismaService } from '../../src/prisma/prisma.service';

const ONE_DAY_MS = 86_400_000;
let seq = 0;

function nextId(): number {
  seq += 1;
  return seq;
}

export interface CreateUserOptions {
  role?: Role;
  plan?: Plan;
  tosAccepted?: boolean;
  onboardingTopicIds?: string[];
  email?: string;
  now?: Date;
}

export interface CreatedUser {
  user: User;
  cookie: string;
}

export async function createUser(
  prisma: PrismaService,
  options: CreateUserOptions = {},
): Promise<CreatedUser> {
  const now = options.now ?? new Date();
  const tosAccepted = options.tosAccepted ?? true;
  const email = options.email ?? `user${nextId()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Test User',
      role: options.role ?? 'user',
      plan: options.plan ?? 'free',
      tosAcceptedAt: tosAccepted ? now : null,
      onboardingCompletedAt: options.onboardingTopicIds?.length ? now : null,
    },
  });
  if (tosAccepted) {
    await prisma.tosAcceptance.create({
      data: {
        userId: user.id,
        acceptedAt: now,
        tosVersion: process.env.TOS_VERSION ?? '1',
        privacyVersion: process.env.PRIVACY_VERSION ?? '1',
        ageAttested: true,
      },
    });
  }
  if (options.onboardingTopicIds?.length) {
    await prisma.userOnboardingTopic.createMany({
      data: options.onboardingTopicIds.map((topicId) => ({ userId: user.id, topicId })),
    });
  }
  const token = randomUUID();
  await prisma.session.create({
    data: {
      sessionToken: token,
      userId: user.id,
      expires: new Date(now.getTime() + 30 * ONE_DAY_MS),
    },
  });
  return { user, cookie: `${SESSION.COOKIE_NAME}=${token}` };
}

export async function createTopic(
  prisma: PrismaService,
  options: { status?: ContentStatus; nameVi?: string } = {},
): Promise<Topic> {
  const n = nextId();
  return prisma.topic.create({
    data: {
      slug: `topic-${n}`,
      nameVi: options.nameVi ?? `Chủ đề ${n}`,
      status: options.status ?? 'published',
    },
  });
}

export interface CreateLemmaOptions {
  topicId: string;
  includedInFree?: boolean;
  status?: ContentStatus;
  headword?: string;
  exampleEn?: string | null;
  senseVi?: string;
  pos?: string | null;
}

export async function createLemma(
  prisma: PrismaService,
  options: CreateLemmaOptions,
): Promise<Lemma> {
  const headword = options.headword ?? `word${nextId()}`;
  return prisma.lemma.create({
    data: {
      headword,
      headwordNormalized: headword.toLowerCase(),
      pos: options.pos ?? 'noun',
      senseVi: options.senseVi ?? `nghĩa của ${headword}`,
      exampleEn: options.exampleEn === undefined ? `Example with ${headword}.` : options.exampleEn,
      topicId: options.topicId,
      includedInFree: options.includedInFree ?? true,
      status: options.status ?? 'published',
    },
  });
}

export interface CreatePromptOptions {
  topicId: string;
  targets: string[];
  status?: ContentStatus;
  sampleEn?: string | null;
  textVi?: string;
}

export async function createPrompt(
  prisma: PrismaService,
  options: CreatePromptOptions,
): Promise<Prompt> {
  const n = nextId();
  return prisma.prompt.create({
    data: {
      textVi: options.textVi ?? `Câu tiếng Việt số ${n}`,
      topicId: options.topicId,
      sampleEn: options.sampleEn === undefined ? `Sample sentence number ${n}.` : options.sampleEn,
      status: options.status ?? 'published',
      lemmaLinks: {
        create: options.targets.map((lemmaId, index) => ({ lemmaId, sortOrder: index })),
      },
    },
  });
}

export async function createAllowlistEmail(
  prisma: PrismaService,
  email: string,
  createdById: string,
): Promise<void> {
  await prisma.betaAllowlistEmail.create({
    data: { email: email.trim().toLowerCase(), createdById },
  });
}

export async function createQuotaGrant(
  prisma: PrismaService,
  options: {
    userId: string;
    date: Date;
    extraRewriteNew?: number;
    extraRetry?: number;
    createdById: string;
  },
): Promise<void> {
  await prisma.quotaGrant.create({
    data: {
      userId: options.userId,
      date: options.date,
      extraRewriteNew: options.extraRewriteNew ?? 0,
      extraRetry: options.extraRetry ?? 0,
      reason: 'test grant',
      createdById: options.createdById,
    },
  });
}

/** Inserts a charged, scored rev-1 attempt row directly (for quota tests). */
export async function createChargedAttempt(
  prisma: PrismaService,
  options: { userId: string; promptId: string; topicId: string; scoredAt: Date },
): Promise<void> {
  const id = randomUUID();
  await prisma.rewriteAttempt.create({
    data: {
      id,
      attemptId: id,
      revision: 1,
      userId: options.userId,
      promptId: options.promptId,
      status: 'scored',
      userEn: 'x',
      promptTextViSnapshot: 'vi',
      sampleEnSnapshot: 'sample',
      targetsSnapshot: [] as unknown as Prisma.InputJsonArray,
      topicIdSnapshot: options.topicId,
      scoredAt: options.scoredAt,
      quotaCharged: true,
    },
  });
}

/** Recursively collects every object key in a JSON value. */
export function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, acc);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      acc.add(key);
      collectKeys(inner, acc);
    }
  }
  return acc;
}
