import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { AppExceptionFilter } from './common/app-exception.filter';
import { CommonModule } from './common/common.module';
import { CsrfOriginMiddleware } from './common/csrf.middleware';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { LlmModule } from './llm/llm.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuotaModule } from './quota/quota.module';
import { RedisModule } from './redis/redis.module';
import { RewriteModule } from './rewrite/rewrite.module';
import { UsersModule } from './users/users.module';
import { VocabModule } from './vocab/vocab.module';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    PrismaModule,
    RedisModule,
    AnalyticsModule,
    HealthModule,
    CatalogModule,
    AuthModule,
    UsersModule,
    QuotaModule,
    LlmModule,
    VocabModule,
    RewriteModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AppExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, CsrfOriginMiddleware).forRoutes('*');
  }
}
