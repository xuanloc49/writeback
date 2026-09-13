import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { QuotaService } from './quota.service';

@Module({
  imports: [CatalogModule],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
