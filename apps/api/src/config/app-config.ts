import { Injectable } from '@nestjs/common';
import { DEFAULT_BUSINESS_TIMEZONE } from '@writeback/shared';
import { z } from 'zod';

const APP_ENVS = ['local', 'staging', 'prod', 'test'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? null : value.trim()));

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    APP_ENV: z.enum(APP_ENVS),
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    BUSINESS_TZ: z.string().min(1).default(DEFAULT_BUSINESS_TIMEZONE),
    APP_ORIGIN: z.string().url(),
    COOKIE_DOMAIN: optionalString,
    AUTH_URL: optionalString,
    AUTH_SECRET: optionalString,
    AUTH_GOOGLE_ID: optionalString,
    AUTH_GOOGLE_SECRET: optionalString,
    BETA_ALLOWLIST_ENABLED: booleanFromEnv,
    BETA_ALLOWLIST_EMAILS: optionalString,
    TOS_VERSION: z.string().min(1),
    PRIVACY_VERSION: z.string().min(1),
    OPENAI_API_KEY: optionalString,
    OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
    OPENAI_PRICE_IN: z.coerce.number().nonnegative(),
    OPENAI_PRICE_OUT: z.coerce.number().nonnegative(),
    OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1200),
    OPENAI_DATA_HANDLING: z.string().default('zero_retention'),
    DAILY_AI_BUDGET_USD: z.coerce.number().nonnegative(),
    SCORING_PROMPT_VERSION: z.string().min(1).default('score.v1'),
    RATE_LIMIT_SUBMIT_PER_MIN: z.coerce.number().int().positive(),
    RATE_LIMIT_START_PER_MIN: z.coerce.number().int().positive(),
    SENTRY_DSN: optionalString,
  })
  .superRefine((env, ctx) => {
    const keyOptional = env.APP_ENV === 'local' || env.APP_ENV === 'test';
    if (!keyOptional && env.OPENAI_API_KEY === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required outside local/test',
      });
    }
    // Auth.js (design §6.0): Google credentials may be blank only in local/test.
    const authKeys = ['AUTH_URL', 'AUTH_SECRET', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'] as const;
    for (const key of authKeys) {
      if (!keyOptional && env[key] === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required outside local/test`,
        });
      }
    }
  });

type ParsedEnv = z.infer<typeof envSchema>;

/** Typed, validated process configuration. Fails fast at startup on invalid env. */
@Injectable()
export class AppConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly appEnv: AppEnv;
  readonly nodeEnv: string;
  readonly port: number;
  readonly businessTz: string;
  readonly appOrigin: string;
  readonly cookieDomain: string | null;
  readonly authUrl: string | null;
  readonly authSecret: string | null;
  readonly authGoogleId: string | null;
  readonly authGoogleSecret: string | null;
  readonly betaAllowlistEnabled: boolean;
  readonly betaAllowlistSeedEmails: string | null;
  readonly tosVersion: string;
  readonly privacyVersion: string;
  readonly openaiApiKey: string | null;
  readonly openaiModel: string;
  readonly openaiPriceInPerMillion: number;
  readonly openaiPriceOutPerMillion: number;
  readonly openaiMaxOutputTokens: number;
  readonly openaiDataHandling: string;
  readonly dailyAiBudgetUsd: number;
  readonly scoringPromptVersion: string;
  readonly rateLimitSubmitPerMin: number;
  readonly rateLimitStartPerMin: number;
  readonly sentryDsn: string | null;

  constructor(env: ParsedEnv) {
    this.databaseUrl = env.DATABASE_URL;
    this.redisUrl = env.REDIS_URL;
    this.appEnv = env.APP_ENV;
    this.nodeEnv = env.NODE_ENV;
    this.port = env.PORT;
    this.businessTz = env.BUSINESS_TZ;
    this.appOrigin = env.APP_ORIGIN;
    this.cookieDomain = env.COOKIE_DOMAIN;
    this.authUrl = env.AUTH_URL;
    this.authSecret = env.AUTH_SECRET;
    this.authGoogleId = env.AUTH_GOOGLE_ID;
    this.authGoogleSecret = env.AUTH_GOOGLE_SECRET;
    this.betaAllowlistEnabled = env.BETA_ALLOWLIST_ENABLED;
    this.betaAllowlistSeedEmails = env.BETA_ALLOWLIST_EMAILS;
    this.tosVersion = env.TOS_VERSION;
    this.privacyVersion = env.PRIVACY_VERSION;
    this.openaiApiKey = env.OPENAI_API_KEY;
    this.openaiModel = env.OPENAI_MODEL;
    this.openaiPriceInPerMillion = env.OPENAI_PRICE_IN;
    this.openaiPriceOutPerMillion = env.OPENAI_PRICE_OUT;
    this.openaiMaxOutputTokens = env.OPENAI_MAX_OUTPUT_TOKENS;
    this.openaiDataHandling = env.OPENAI_DATA_HANDLING;
    this.dailyAiBudgetUsd = env.DAILY_AI_BUDGET_USD;
    this.scoringPromptVersion = env.SCORING_PROMPT_VERSION;
    this.rateLimitSubmitPerMin = env.RATE_LIMIT_SUBMIT_PER_MIN;
    this.rateLimitStartPerMin = env.RATE_LIMIT_START_PER_MIN;
    this.sentryDsn = env.SENTRY_DSN;
  }

  /** True when the real OpenAI provider must be used. */
  get useRealScoringProvider(): boolean {
    return this.openaiApiKey !== null;
  }

  /** Cookies are `Secure` everywhere except plain-HTTP local/test (design §3.1). */
  get secureCookies(): boolean {
    return this.appEnv !== 'local' && this.appEnv !== 'test';
  }

  static fromEnv(source: NodeJS.ProcessEnv = process.env): AppConfig {
    const parsed = envSchema.safeParse(source);
    if (!parsed.success) {
      const problems = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid environment configuration: ${problems}`);
    }
    return new AppConfig(parsed.data);
  }
}
