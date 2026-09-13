import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { QuotaModule } from '../quota/quota.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AllowlistController } from './allowlist.controller';
import { AllowlistService } from './allowlist.service';
import { AuditReadController } from './audit-read.controller';
import { AuditReadService } from './audit-read.service';

/** Design §12.7 — admin user table, plan/role/overrides, beta allowlist, audit read. */
@Module({
  imports: [AuthModule, CatalogModule, QuotaModule],
  controllers: [AdminUsersController, AllowlistController, AuditReadController],
  providers: [AdminUsersService, AllowlistService, AuditReadService],
})
export class AdminUsersModule {}
