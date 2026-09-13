import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { Role } from '@prisma/client';

export const ROLES_KEY = 'wb:roles';

/**
 * Declares which roles may call a controller/handler (PRD §7.2). Enforced by `RolesGuard`,
 * which must run after `SessionGuard`:
 *
 *   @Controller('admin/topics')
 *   @UseGuards(...AdminGuards)   // AdminGuards = [SessionGuard, RolesGuard]
 *   @Roles('editor', 'admin')
 */
export const Roles = (...roles: Role[]): CustomDecorator<string> => SetMetadata(ROLES_KEY, roles);
