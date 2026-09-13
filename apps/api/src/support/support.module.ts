import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ImpersonateStopController, SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Design §12.8 — support impersonation and quota grants. */
@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [SupportController, ImpersonateStopController],
  providers: [SupportService],
})
export class SupportModule {}
