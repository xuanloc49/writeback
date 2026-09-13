import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';

/** Global (like AnalyticsModule): a transaction-scoped helper used by both rewrite and review. */
@Global()
@Module({
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
