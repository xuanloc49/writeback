import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { LlmModule } from '../llm/llm.module';
import { QuotaModule } from '../quota/quota.module';
import { VocabModule } from '../vocab/vocab.module';
import { PickerService } from './picker.service';
import { RewriteController } from './rewrite.controller';
import { RewriteService } from './rewrite.service';

@Module({
  imports: [AuthModule, CatalogModule, QuotaModule, LlmModule, VocabModule],
  controllers: [RewriteController],
  providers: [PickerService, RewriteService, RateLimitGuard],
})
export class RewriteModule {}
