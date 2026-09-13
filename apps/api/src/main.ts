import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get(AppConfig);
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port);
}

void bootstrap();
