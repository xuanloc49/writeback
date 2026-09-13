import type { MeDto } from '@writeback/shared';
import { describe, expect, it } from 'vitest';
import { afterAuthPath, isLearningRoute, learnerRedirect } from './learner-gate';

function me(overrides: Partial<MeDto> = {}): MeDto {
  return {
    id: 'u1',
    email: 'a@gmail.com',
    name: 'A',
    role: 'user',
    plan: 'free',
    tosAcceptedAt: '2026-01-01T00:00:00.000Z',
    onboardingTopicIds: ['t1'],
    learningBlocked: false,
    learningBlockedReason: null,
    impersonatorId: null,
    limits: {
      rewriteNewPerDay: 10,
      retryPerDay: 3,
      reviewSessionCap: 20,
      newCardsUsedNaturalPerDay: 20,
    },
    ...overrides,
  };
}

describe('isLearningRoute', () => {
  it('treats dashboard, rewrite, vocab, review, and history as learning', () => {
    expect(isLearningRoute('/app')).toBe(true);
    expect(isLearningRoute('/app/rewrite')).toBe(true);
    expect(isLearningRoute('/app/rewrite/abc')).toBe(true);
    expect(isLearningRoute('/app/vocab/lemma')).toBe(true);
    expect(isLearningRoute('/app/review')).toBe(true);
    expect(isLearningRoute('/app/history')).toBe(true);
  });

  it('does not treat account or public pages as learning', () => {
    expect(isLearningRoute('/app/account')).toBe(false);
    expect(isLearningRoute('/login')).toBe(false);
    expect(isLearningRoute('/terms')).toBe(false);
  });
});

describe('learnerRedirect', () => {
  it('sends anonymous visitors away from /app to /login', () => {
    expect(learnerRedirect(null, '/app')).toBe('/login');
    expect(learnerRedirect(null, '/app/rewrite')).toBe('/login');
    expect(learnerRedirect(null, '/login')).toBe(null);
    expect(learnerRedirect(null, '/')).toBe(null);
  });

  it('keeps TOS_REQUIRED users on /app so they can accept', () => {
    const blocked = me({
      tosAcceptedAt: null,
      learningBlocked: true,
      learningBlockedReason: 'TOS_REQUIRED',
      onboardingTopicIds: [],
    });
    expect(learnerRedirect(blocked, '/app')).toBe(null);
    expect(learnerRedirect(blocked, '/app/account')).toBe(null);
    expect(learnerRedirect(blocked, '/login')).toBe('/app');
  });

  it('sends onboarding and beta-blocked users to /app/account off learning routes', () => {
    const onboarding = me({
      learningBlocked: true,
      learningBlockedReason: 'ONBOARDING_REQUIRED',
      onboardingTopicIds: [],
    });
    expect(learnerRedirect(onboarding, '/app')).toBe('/app/account');
    expect(learnerRedirect(onboarding, '/app/rewrite')).toBe('/app/account');
    expect(learnerRedirect(onboarding, '/app/account')).toBe(null);

    const beta = me({
      learningBlocked: true,
      learningBlockedReason: 'BETA_BLOCKED',
    });
    expect(learnerRedirect(beta, '/app/review')).toBe('/app/account');
    expect(learnerRedirect(beta, '/app/account')).toBe(null);
  });

  it('sends a ready learner away from /login to /app', () => {
    expect(learnerRedirect(me(), '/login')).toBe('/app');
    expect(learnerRedirect(me(), '/app')).toBe(null);
  });
});

describe('afterAuthPath', () => {
  it('routes gated users to the first screen they can complete', () => {
    expect(
      afterAuthPath(me({ learningBlocked: true, learningBlockedReason: 'TOS_REQUIRED' })),
    ).toBe('/app');
    expect(
      afterAuthPath(me({ learningBlocked: true, learningBlockedReason: 'ONBOARDING_REQUIRED' })),
    ).toBe('/app/account');
    expect(
      afterAuthPath(me({ learningBlocked: true, learningBlockedReason: 'BETA_BLOCKED' })),
    ).toBe('/app/account');
    expect(afterAuthPath(me())).toBe('/app');
  });
});
