import { ExpressAuth, type ExpressAuthConfig } from '@auth/express';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RequestHandler } from 'express';
import { CLOCK, type Clock } from '../../common/clock';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { createAuthJsConfig } from './authjs.config';

/** Owns the Auth.js configuration and exposes the Express handler mounted at `/auth`. */
@Injectable()
export class AuthJsService {
  private readonly logger = new Logger(AuthJsService.name);
  readonly authConfig: ExpressAuthConfig;

  constructor(config: AppConfig, prisma: PrismaService, @Inject(CLOCK) clock: Clock) {
    this.authConfig = createAuthJsConfig({ config, prisma, clock, logger: this.logger });
  }

  handler(): RequestHandler {
    return ExpressAuth(this.authConfig);
  }
}
