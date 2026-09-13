import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppConfig } from '../config/app-config';
import { appError } from './app-error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Rejects mutating requests whose Origin is present and not the configured web origin (design §3.2). */
@Injectable()
export class CsrfOriginMiddleware implements NestMiddleware {
  constructor(private readonly config: AppConfig) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.header('origin');
    if (origin !== undefined && origin !== this.config.appOrigin) {
      next(appError('FORBIDDEN', { reason: 'origin_not_allowed' }));
      return;
    }
    next();
  }
}
