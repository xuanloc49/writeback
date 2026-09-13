import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { appError } from '../common/app-error';
import type { AppRequest } from '../common/request-context';
import { LearningGateService } from './learning-gate.service';
import { ROLES_KEY } from './roles.decorator';
import { SessionGuard } from './session.guard';

/** Every route under this prefix is closed to impersonated principals (design §6.1 step 5, §12.6). */
const ADMIN_PATH_PREFIX = '/v1/admin';

/**
 * Role-based access for staff routes (design §6.1 step 5, §12.6–12.8; PRD §7.2).
 * Requires `SessionGuard` to have attached `req.principal`. Checks, in order:
 *  1. role ∈ `@Roles(...)` list (missing metadata = fail closed) → else `FORBIDDEN`;
 *  2. impersonating principals never reach `/v1/admin/*` → `FORBIDDEN`;
 *  3. staff still must have accepted the current ToS → `TOS_REQUIRED`
 *     (allowlist/onboarding are not required for admin routes; staff bypass the allowlist anyway).
 *
 * Usage: `@UseGuards(...AdminGuards)` + `@Roles('editor', 'admin')` on the controller.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly gate: LearningGateService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (req.principal === undefined) {
      throw appError('UNAUTHENTICATED');
    }
    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed === undefined || !allowed.includes(req.principal.user.role)) {
      throw appError('FORBIDDEN');
    }
    if (req.principal.impersonatorId !== null && isAdminPath(req)) {
      throw appError('FORBIDDEN');
    }
    // Staff are never allowlist-blocked, so this can only yield TOS_REQUIRED or null.
    const reason = await this.gate.evaluatePreOnboarding(req.principal.user);
    if (reason !== null) {
      throw appError(reason);
    }
    return true;
  }
}

function isAdminPath(req: AppRequest): boolean {
  const path = req.originalUrl ?? req.url ?? '';
  return path.startsWith(ADMIN_PATH_PREFIX);
}

/** Guard chain for `/v1/admin/*` controllers: session first, then role/impersonation/ToS. */
export const AdminGuards = [SessionGuard, RolesGuard] as const;
