/** Support operations — PRD §10.13, design §12.8 (TTL and reason length live in shared `SUPPORT`). */
export const QUOTA_GRANT = {
  /** `reason` is mandatory; keep it short enough for the audit trail. */
  REASON_MIN_LENGTH: 1,
  REASON_MAX_LENGTH: 500,
} as const;

export const IMPERSONATE = {
  REASON_MAX_LENGTH: 500,
} as const;

/** `audit_logs.target_type` values written by this module. */
export const SUPPORT_TARGET_TYPES = {
  USER: 'user',
  IMPERSONATION: 'impersonation_session',
} as const;
