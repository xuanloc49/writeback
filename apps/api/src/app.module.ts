import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ActivityModule } from './activity/activity.module';
import { AdminContentModule } from './admin-content/admin-content.module';
import { AdminImportModule } from './admin-import/admin-import.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthJsModule } from './auth/authjs/authjs.module';
import { CatalogModule } from './catalog/catalog.module';
import { AppExceptionFilter } from './common/app-exception.filter';
import { CommonModule } from './common/common.module';
import { CsrfOriginMiddleware } from './common/csrf.middleware';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { ConfigModule } from './config/config.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { HistoryModule } from './history/history.module';
import { LlmModule } from './llm/llm.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuotaModule } from './quota/quota.module';
import { RedisModule } from './redis/redis.module';
import { ReviewModule } from './review/review.module';
import { RewriteModule } from './rewrite/rewrite.module';
import { SupportModule } from './support/support.module';
import { UsersModule } from './users/users.module';
import { VocabModule } from './vocab/vocab.module';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    PrismaModule,
    RedisModule,
    AnalyticsModule,
    ActivityModule,
    AuditModule,
    HealthModule,
    CatalogModule,
    AuthModule,
    AuthJsModule,
    UsersModule,
    QuotaModule,
    LlmModule,
    VocabModule,
    RewriteModule,
    ReviewModule,
    DashboardModule,
    HistoryModule,
    AdminContentModule,
    AdminImportModule,
    AdminUsersModule,
    SupportModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AppExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, CsrfOriginMiddleware).forRoutes('*');
  }
}
