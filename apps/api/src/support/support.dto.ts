import { SUPPORT } from '@writeback/shared';
import { z } from 'zod';
import { IMPERSONATE, QUOTA_GRANT } from './support.constants';

export const impersonateSchema = z
  .object({
    reason: z
      .string()
      .transform((value) => value.trim())
      .pipe(
        z.string().min(SUPPORT.IMPERSONATE_REASON_MIN_LENGTH).max(IMPERSONATE.REASON_MAX_LENGTH),
      ),
  })
  .strict();
export type ImpersonateBody = z.infer<typeof impersonateSchema>;

export const quotaGrantSchema = z
  .object({
    reason: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(QUOTA_GRANT.REASON_MIN_LENGTH).max(QUOTA_GRANT.REASON_MAX_LENGTH)),
    extraRewriteNew: z.number().int().nonnegative(),
    extraRetry: z.number().int().nonnegative(),
  })
  .strict()
  .refine((body) => body.extraRewriteNew > 0 || body.extraRetry > 0, {
    message: 'at least one of extraRewriteNew / extraRetry must be > 0',
  });
export type QuotaGrantBody = z.infer<typeof quotaGrantSchema>;

export interface ImpersonateResponse {
  impersonationId: string;
  targetId: string;
  expiresAt: string;
}

export interface StopImpersonateResponse {
  impersonationId: string;
  endedAt: string;
}

export interface QuotaGrantResponse {
  grantId: string;
  /** Business date 'YYYY-MM-DD' (GMT+7) the grant applies to. */
  date: string;
  extraRewriteNew: number;
  extraRetry: number;
}
