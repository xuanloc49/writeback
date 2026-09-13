import type { Plan, Role } from '@prisma/client';
import type { PlanLimits } from '@writeback/shared';
import { z } from 'zod';
import { ADMIN_USERS } from './admin-users.constants';

const ROLES = ['user', 'editor', 'support', 'admin'] as const satisfies readonly Role[];
const PLANS = ['free', 'premium'] as const satisfies readonly Plan[];

const trimmedNote = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(ADMIN_USERS.NOTE_MIN_LENGTH).max(ADMIN_USERS.NOTE_MAX_LENGTH));

const distinctUuidList = z
  .array(z.string().uuid())
  .max(ADMIN_USERS.OVERRIDE_LIST_MAX)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'ids must be distinct' });

/** Shared `?cursor&limit` query shape (cursor = id of the last row on the previous page). */
export const pageQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN_USERS.PAGE_SIZE_MAX)
    .default(ADMIN_USERS.PAGE_SIZE_DEFAULT),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const listUsersQuerySchema = pageQuerySchema
  .extend({
    q: z
      .string()
      .max(ADMIN_USERS.QUERY_MAX_LENGTH)
      .transform((value) => value.trim().toLowerCase())
      .optional(),
  })
  .strict();
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const changePlanSchema = z.object({ plan: z.enum(PLANS), note: trimmedNote }).strict();
export type ChangePlanBody = z.infer<typeof changePlanSchema>;

export const changeRoleSchema = z.object({ role: z.enum(ROLES), note: trimmedNote }).strict();
export type ChangeRoleBody = z.infer<typeof changeRoleSchema>;

export const overridesSchema = z
  .object({ allowTopicIds: distinctUuidList, denyTopicIds: distinctUuidList })
  .strict()
  .refine(
    (body) => {
      const deny = new Set(body.denyTopicIds);
      return body.allowTopicIds.every((id) => !deny.has(id));
    },
    { message: 'a topic cannot be both allowed and denied' },
  );
export type OverridesBody = z.infer<typeof overridesSchema>;

export const allowlistAddSchema = z
  .object({
    email: z
      .string()
      .transform((value) => value.trim().toLowerCase())
      .pipe(z.string().email().max(ADMIN_USERS.QUERY_MAX_LENGTH)),
  })
  .strict();
export type AllowlistAddBody = z.infer<typeof allowlistAddSchema>;

export const auditQuerySchema = pageQuerySchema.extend({ action: z.string().optional() }).strict();
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** One row of the admin user table (PRD §10.11). */
export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  plan: Plan;
  createdAt: string;
  lastLoginAt: string | null;
  cardCount: number;
  rewriteNew7d: number;
}

export interface PlanChangeView {
  id: string;
  fromPlan: Plan;
  toPlan: Plan;
  changedById: string;
  note: string;
  createdAt: string;
}

export interface QuotaTodayView {
  date: string;
  limits: PlanLimits;
  rewriteNewUsed: number;
  retryUsed: number;
  rewriteNewLeft: number;
  retryLeft: number;
}

export interface AdminUserDetail extends AdminUserRow {
  tosAcceptedAt: string | null;
  onboardingCompletedAt: string | null;
  onboardingTopicIds: string[];
  overrides: { allowTopicIds: string[]; denyTopicIds: string[] };
  quotaToday: QuotaTodayView;
  planHistory: PlanChangeView[];
}

export interface AllowlistEmailView {
  email: string;
  createdAt: string;
  createdById: string;
}

export interface AllowlistView {
  enabled: boolean;
  emails: AllowlistEmailView[];
}

export interface AuditRowView {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  props: unknown;
  requestId: string | null;
  createdAt: string;
}
