import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role, User } from '@prisma/client';
import { AppError } from '../common/app-error';
import type { LearningGateService } from './learning-gate.service';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

function fakeContext(
  principal: { user: Partial<User>; impersonatorId: string | null } | undefined,
  roles: Role[] | undefined,
  url = '/v1/admin/lemmas',
): ExecutionContext {
  class Handler {}
  const handler = (): void => undefined;
  if (roles !== undefined) {
    Roles(...roles)(Handler);
  }
  return {
    switchToHttp: () => ({ getRequest: () => ({ principal, originalUrl: url, url }) }),
    getHandler: () => handler,
    getClass: () => Handler,
  } as unknown as ExecutionContext;
}

function guardWith(tosReason: 'TOS_REQUIRED' | null = null): RolesGuard {
  const gate = {
    evaluatePreOnboarding: jest.fn().mockResolvedValue(tosReason),
  } as unknown as LearningGateService;
  return new RolesGuard(new Reflector(), gate);
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    return error instanceof AppError ? error.code : 'OTHER';
  }
}

describe('RolesGuard (design §6.1 step 5, PRD §7.2)', () => {
  it('allows a listed role with no impersonation and current ToS', async () => {
    const ctx = fakeContext({ user: { role: 'editor' }, impersonatorId: null }, [
      'editor',
      'admin',
    ]);
    await expect(guardWith().canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects roles outside the list with FORBIDDEN', async () => {
    const ctx = fakeContext({ user: { role: 'support' }, impersonatorId: null }, [
      'editor',
      'admin',
    ]);
    expect(await codeOf(guardWith().canActivate(ctx))).toBe('FORBIDDEN');
  });

  it('fails closed when a route has no @Roles metadata', async () => {
    const ctx = fakeContext({ user: { role: 'admin' }, impersonatorId: null }, undefined);
    expect(await codeOf(guardWith().canActivate(ctx))).toBe('FORBIDDEN');
  });

  it('rejects an impersonating principal on /v1/admin/* even when the role is allowed', async () => {
    const ctx = fakeContext({ user: { role: 'admin' }, impersonatorId: 'staff-uuid' }, ['admin']);
    expect(await codeOf(guardWith().canActivate(ctx))).toBe('FORBIDDEN');
  });

  it('requires an accepted ToS for staff (TOS_REQUIRED)', async () => {
    const ctx = fakeContext({ user: { role: 'editor' }, impersonatorId: null }, ['editor']);
    expect(await codeOf(guardWith('TOS_REQUIRED').canActivate(ctx))).toBe('TOS_REQUIRED');
  });

  it('is UNAUTHENTICATED without a principal (SessionGuard must run first)', async () => {
    const ctx = fakeContext(undefined, ['editor']);
    expect(await codeOf(guardWith().canActivate(ctx))).toBe('UNAUTHENTICATED');
  });
});
