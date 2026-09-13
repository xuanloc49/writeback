/** Rewrite flow — PRD §10.4 (400-char cap, 15-minute revision window, max 2 revisions, ≤3 display issues). */
export const REWRITE = {
  USER_EN_MAX_LENGTH: 400,
  REVISION_WINDOW_MS: 900_000,
  MAX_REVISION: 2,
  /** Model rewrite toggle is shown on the revision form only when first score is strictly below this. */
  MODEL_REWRITE_TOGGLE_BELOW_SCORE: 50,
  DISPLAY_ISSUES_MAX: 3,
} as const;

/** Prompt picker ranking — PRD §10.3. */
export const PICKER = {
  TOP_N: 8,
  NO_REPEAT_DAYS: 7,
  MISUSE_LOOKBACK_DAYS: 14,
  WEIGHT_DUE_OR_LEARNING: 3,
  WEIGHT_RECENT_MISUSE: 2,
  WEIGHT_ONBOARDING_TOPIC: 1,
  WEIGHT_NEVER_DONE: 1,
} as const;

/** Content rules — PRD §10.3, §10.10 and Appendix A. */
export const CONTENT = {
  PROMPT_TEXT_VI_MAX_LENGTH: 500,
  PROMPT_TARGETS_MIN: 2,
  PROMPT_TARGETS_MAX: 5,
  MIN_PROMPTS_PER_PUBLISHED_LEMMA: 2,
  IMPORT_MAX_BYTES: 2 * 1024 * 1024,
  IMPORT_SCHEMA_VERSION: 1,
} as const;

/** SM-2 parameters — PRD §10.6 and Appendix C. */
export const SRS = {
  INITIAL_EF: 2.5,
  MIN_EF: 1.3,
  MASTERED_INTERVAL_DAYS: 21,
  LAPSE_RELEARN_MINUTES: 10,
  LAPSE_REVIEW_INTERVAL_DAYS: 1,
  FIRST_INTERVAL_DAYS: 1,
  SECOND_INTERVAL_DAYS: 6,
} as const;

/** Session cookie — design §6.1 (30-day max age, rolling update once per day). */
export const SESSION = {
  COOKIE_NAME: 'wb.session',
  MAX_AGE_SECONDS: 2_592_000,
  UPDATE_AGE_SECONDS: 86_400,
} as const;

/** Support impersonation — PRD §10.12 / design §13. */
export const SUPPORT = {
  IMPERSONATE_TTL_SECONDS: 1800,
  IMPERSONATE_REASON_MIN_LENGTH: 10,
} as const;

/** Onboarding topics — PRD §10.2 (user picks 1–3 topics). */
export const ONBOARDING = {
  MIN_TOPICS: 1,
  MAX_TOPICS: 3,
} as const;

/** LLM call limits — design §5.4 and §11 (20 s timeout; scoring lock considered stale after 25 s). */
export const LLM = {
  TIMEOUT_MS: 20_000,
  SCORING_IN_PROGRESS_STALE_MS: 25_000,
} as const;

/** Account deletion requires typing this exact word — PRD §10.9. */
export const ACCOUNT_DELETE_CONFIRMATION = 'XOA';

/** Quota / streak / due-today calendar — design §5.1 (`BUSINESS_TZ`). */
export const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
