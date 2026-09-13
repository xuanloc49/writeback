import { Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';
import { VisibilityService } from './visibility.service';

@Module({
  providers: [VisibilityService, PlanLimitsService],
  exports: [VisibilityService, PlanLimitsService],
})
export class CatalogModule {}
