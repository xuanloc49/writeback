/** Admin user-management rules — PRD §10.11, design §12.7. */
export const ADMIN_USERS = {
  /** `note` on plan/role changes is mandatory (PRD §10.11); this is the minimum trimmed length. */
  NOTE_MIN_LENGTH: 3,
  NOTE_MAX_LENGTH: 500,
  /** Cursor pagination for `/admin/users` and `/admin/audit`. */
  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 100,
  /** Detail view returns this many most-recent `plan_changes` rows. */
  PLAN_HISTORY_LIMIT: 5,
  /** "Lượt viết 7 ngày" column window. */
  REWRITE_WINDOW_DAYS: 7,
  /** Overrides per list (topics are few; guards against abusive payloads). */
  OVERRIDE_LIST_MAX: 200,
  /** Max `q` length for the email substring search. */
  QUERY_MAX_LENGTH: 254,
} as const;

/** `audit_logs.target_type` values written by this module. */
export const AUDIT_TARGET_TYPES = {
  USER: 'user',
  USER_LIST: 'user_list',
  ALLOWLIST_EMAIL: 'beta_allowlist_email',
} as const;
