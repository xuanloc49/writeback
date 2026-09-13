import type { NestExpressApplication } from '@nestjs/platform-express';
import { CONTENT } from '@writeback/shared';
import type { AppConfig } from './config/app-config';
import { REQUEST_ID_HEADER } from './common/request-context';

/** Applies HTTP-level configuration shared by `main.ts` and the test harness. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.setGlobalPrefix('v1');
  app.useBodyParser('json', { limit: CONTENT.IMPORT_MAX_BYTES });
  app.enableCors({
    origin: config.appOrigin,
    credentials: true,
    allowedHeaders: ['Content-Type', REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER],
  });
}
