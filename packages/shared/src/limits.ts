import type { LimitProfile, Plan, Role } from './types.js';

/** Roles that get the Staff limit row and bypass the beta allowlist — design §6.2, §5.3. */
export const STAFF_ROLES: readonly Role[] = ['editor', 'support', 'admin'];

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

/** Staff roles always use the `staff` profile regardless of plan; everyone else uses their plan. */
export function limitProfileFor(role: Role, plan: Plan): LimitProfile {
  return isStaffRole(role) ? 'staff' : plan;
}
