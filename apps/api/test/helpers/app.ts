import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { CLOCK, type Clock } from '../../src/common/clock';
import { RANDOM, type Random } from '../../src/common/random';
import { AppConfig } from '../../src/config/app-config';
import { FakeScoringProvider } from '../../src/llm/fake-scoring.provider';
import { SCORING_PROVIDER } from '../../src/llm/scoring-provider';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';

/** Settable clock so tests can advance time (revision window, quota day). */
export class FixedClock implements Clock {
  constructor(public now_: Date = new Date('2026-09-13T10:00:00.000Z')) {}

  now(): Date {
    return new Date(this.now_.getTime());
  }

  set(date: Date): void {
    this.now_ = new Date(date.getTime());
  }

  advanceMs(ms: number): void {
    this.now_ = new Date(this.now_.getTime() + ms);
  }
}

/** Deterministic random: returns queued values FIFO, then `fallback`. */
export class FixedRandom implements Random {
  private readonly queue: number[] = [];

  constructor(public fallback = 0) {}

  push(...values: number[]): void {
    this.queue.push(...values);
  }

  next(): number {
    return this.queue.shift() ?? this.fallback;
  }
}

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof supertest>;
  prisma: PrismaService;
  redis: RedisService;
  config: AppConfig;
  clock: FixedClock;
  random: FixedRandom;
  scoring: FakeScoringProvider;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const clock = new FixedClock();
  const random = new FixedRandom();
  const scoring = new FakeScoringProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(RANDOM)
    .useValue(random)
    .overrideProvider(SCORING_PROVIDER)
    .useValue(scoring)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  const config = app.get(AppConfig);
  configureApp(app, config);
  await app.init();

  return {
    app,
    http: supertest(app.getHttpServer()),
    prisma: app.get(PrismaService),
    redis: app.get(RedisService),
    config,
    clock,
    random,
    scoring,
    close: () => app.close(),
  };
}
