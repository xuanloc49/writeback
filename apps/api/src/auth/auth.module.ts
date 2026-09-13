import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { LearningGateGuard } from './learning-gate.guard';
import { LearningGateService } from './learning-gate.service';
import { SessionGuard } from './session.guard';

@Module({
  imports: [CatalogModule],
  providers: [SessionGuard, LearningGateGuard, LearningGateService],
  exports: [SessionGuard, LearningGateGuard, LearningGateService],
})
export class AuthModule {}
