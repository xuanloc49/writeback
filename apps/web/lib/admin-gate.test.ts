import type { MeDto, Role } from '@writeback/shared';
import { describe, expect, it } from 'vitest';
import { adminNavItems, adminRedirect, canAccessAdminPath } from './admin-gate';

function me(overrides: Partial<MeDto> = {}): MeDto {
  return {
    id: 'u1',
    email: 'a@gmail.com',
    name: 'A',
    role: 'admin',
    plan: 'free',
    tosAcceptedAt: '2026-01-01T00:00:00.000Z',
    onboardingTopicIds: ['t1'],
    learningBlocked: false,
    learningBlockedReason: null,
    impersonatorId: null,
    limits: {
      rewriteNewPerDay: 100,
      retryPerDay: 20,
      reviewSessionCap: 40,
      newCardsUsedNaturalPerDay: null,
    },
    ...overrides,
  };
}

function hrefs(role: Role): string[] {
  return adminNavItems(role).map((item) => item.href);
}

describe('adminNavItems', () => {
  it('gives editors content routes only', () => {
    expect(hrefs('editor')).toEqual([
      '/admin',
      '/admin/topics',
      '/admin/lemmas',
      '/admin/prompts',
      '/admin/import',
    ]);
  });

  it('gives support user and audit routes, not content or allowlist', () => {
    expect(hrefs('support')).toEqual(['/admin', '/admin/users', '/admin/audit']);
  });

  it('gives admin every staff route', () => {
    expect(hrefs('admin')).toEqual([
      '/admin',
      '/admin/topics',
      '/admin/lemmas',
      '/admin/prompts',
      '/admin/import',
      '/admin/users',
      '/admin/allowlist',
      '/admin/audit',
    ]);
  });

  it('gives learners an empty nav', () => {
    expect(hrefs('user')).toEqual([]);
  });
});

describe('canAccessAdminPath', () => {
  it('lets editors use content paths and the home, not users', () => {
    expect(canAccessAdminPath('editor', '/admin')).toBe(true);
    expect(canAccessAdminPath('editor', '/admin/topics')).toBe(true);
    expect(canAccessAdminPath('editor', '/admin/lemmas')).toBe(true);
    expect(canAccessAdminPath('editor', '/admin/prompts')).toBe(true);
    expect(canAccessAdminPath('editor', '/admin/import')).toBe(true);
    expect(canAccessAdminPath('editor', '/admin/users')).toBe(false);
    expect(canAccessAdminPath('editor', '/admin/allowlist')).toBe(false);
    expect(canAccessAdminPath('editor', '/admin/audit')).toBe(false);
  });

  it('lets support open a user detail but not lemmas', () => {
    expect(canAccessAdminPath('support', '/admin')).toBe(true);
    expect(canAccessAdminPath('support', '/admin/users')).toBe(true);
    expect(canAccessAdminPath('support', '/admin/users/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(
      true,
    );
    expect(canAccessAdminPath('support', '/admin/audit')).toBe(true);
    expect(canAccessAdminPath('support', '/admin/lemmas')).toBe(false);
    expect(canAccessAdminPath('support', '/admin/allowlist')).toBe(false);
  });

  it('lets admin open every known admin path', () => {
    expect(canAccessAdminPath('admin', '/admin/allowlist')).toBe(true);
    expect(canAccessAdminPath('admin', '/admin/import')).toBe(true);
    expect(canAccessAdminPath('admin', '/admin/users/x')).toBe(true);
  });

  it('treats a trailing slash as the same staff route', () => {
    expect(canAccessAdminPath('editor', '/admin/topics/')).toBe(true);
    expect(canAccessAdminPath('editor', '/admin/import/')).toBe(true);
    expect(canAccessAdminPath('support', '/admin/users/')).toBe(true);
    expect(canAccessAdminPath('editor', '/admin/users/')).toBe(false);
  });

  it('blocks learners from every admin path', () => {
    expect(canAccessAdminPath('user', '/admin')).toBe(false);
    expect(canAccessAdminPath('user', '/admin/topics')).toBe(false);
  });
});

describe('adminRedirect', () => {
  it('sends anonymous visitors to login', () => {
    expect(adminRedirect(null, '/admin')).toBe('/login');
    expect(adminRedirect(null, '/admin/topics')).toBe('/login');
  });

  it('ignores non-admin routes', () => {
    expect(adminRedirect(null, '/app')).toBe(null);
    expect(adminRedirect(me(), '/app/account')).toBe(null);
  });

  it('kicks impersonators back to the learner app', () => {
    const impersonating = me({ impersonatorId: 'staff-1' });
    expect(adminRedirect(impersonating, '/admin')).toBe('/app');
    expect(adminRedirect(impersonating, '/admin/users')).toBe('/app');
  });

  it('keeps TOS_REQUIRED staff on /admin so they can accept', () => {
    const blocked = me({
      tosAcceptedAt: null,
      learningBlocked: true,
      learningBlockedReason: 'TOS_REQUIRED',
    });
    expect(adminRedirect(blocked, '/admin')).toBe(null);
  });

  it('does not bounce learners or staff who are already on a handled path', () => {
    expect(adminRedirect(me({ role: 'user' }), '/admin')).toBe(null);
    expect(adminRedirect(me({ role: 'editor' }), '/admin/topics')).toBe(null);
  });
});
