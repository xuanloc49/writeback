import { Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Express, NextFunction, Request, Response } from 'express';
import { CsrfOriginMiddleware } from '../../common/csrf.middleware';
import { RequestIdMiddleware } from '../../common/request-id.middleware';
import { AUTH_BASE_PATH } from './authjs.config';
import { AuthJsService } from './authjs.service';

/**
 * Mounts `ExpressAuth` on the underlying Express instance at `/auth` (design §6.0), outside the
 * Nest `/v1` prefix. Nest's `forRoutes('*')` middleware is scoped to the global prefix, so the
 * request-id and Origin (CSRF, design §3.2) middleware are applied here explicitly: Google's
 * callback is a GET (always allowed) and the web's sign-in/sign-out POSTs carry `Origin =
 * APP_ORIGIN`. `onModuleInit` runs after Nest registered its routes and before its 404 handler.
 */
@Module({
  providers: [AuthJsService, RequestIdMiddleware, CsrfOriginMiddleware],
  exports: [AuthJsService],
})
export class AuthJsModule implements OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly authJs: AuthJsService,
    private readonly requestId: RequestIdMiddleware,
    private readonly csrfOrigin: CsrfOriginMiddleware,
  ) {}

  onModuleInit(): void {
    const express = this.adapterHost.httpAdapter.getInstance<Express>();
    express.use(
      AUTH_BASE_PATH,
      (req: Request, res: Response, next: NextFunction) => this.requestId.use(req, res, next),
      (req: Request, res: Response, next: NextFunction) => this.csrfOrigin.use(req, res, next),
      this.authJs.handler(),
    );
  }
}
