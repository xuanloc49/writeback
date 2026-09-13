/** Audit action names — PRD §10.11, design §12.7. Only these may be written to `audit_logs`. */
export const AUDIT_ACTIONS = {
  PLAN_CHANGE: 'plan.change',
  OVERRIDE_CHANGE: 'override.change',
  ROLE_CHANGE: 'role.change',
  ALLOWLIST_ADD: 'allowlist.add',
  ALLOWLIST_REMOVE: 'allowlist.remove',
  USER_PII_VIEW: 'user.pii_view',
  CONTENT_PUBLISH: 'content.publish',
  CONTENT_UNPUBLISH: 'content.unpublish',
  IMPORT_COMMIT: 'import.commit',
  QUOTA_RESTORE: 'quota.restore',
  IMPERSONATE_START: 'impersonate.start',
  IMPERSONATE_STOP: 'impersonate.stop',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

const AUDIT_ACTION_SET: ReadonlySet<string> = new Set(Object.values(AUDIT_ACTIONS));

export function isAuditAction(value: string): value is AuditAction {
  return AUDIT_ACTION_SET.has(value);
}
