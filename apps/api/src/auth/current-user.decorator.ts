import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';
import { appError } from '../common/app-error';
import type { AppRequest } from '../common/request-context';

/** Injects the authenticated user; must be used behind `SessionGuard`. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (req.principal === undefined) {
    throw appError('UNAUTHENTICATED');
  }
  return req.principal.user;
});

export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest<AppRequest>().requestId;
});
