/** Shared domain types and DTOs — design §6.2, §7.1. Plain types only (no Nest classes). */

export type Role = 'user' | 'editor' | 'support' | 'admin';
export type Plan = 'free' | 'premium';
export type LimitProfile = 'free' | 'premium' | 'staff';
export type ContentStatus = 'draft' | 'published';
export type IdeaMatchStatus = 'enough' | 'missing' | 'off_topic';
export type IssueSeverity = 'high' | 'medium' | 'low';
export type SrsStatus = 'new' | 'learning' | 'review' | 'mastered';
export type ReviewMode = 'flashcard' | 'type' | 'cloze';
/** Flashcard buttons: Quên=1, Khó=3, Tốt=4, Dễ=5 — PRD §10.6. */
export type ReviewQuality = 1 | 3 | 4 | 5;

/** Per-day limits for the effective limit profile — design §6.2. `null` means no cap. */
export interface PlanLimits {
  rewriteNewPerDay: number;
  retryPerDay: number;
  reviewSessionCap: number;
  newCardsUsedNaturalPerDay: number | null;
}

/** `GET /v1/me` response — design §6.2. */
export interface MeDto {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  plan: Plan;
  tosAcceptedAt: string | null;
  onboardingTopicIds: string[];
  learningBlocked: boolean;
  learningBlockedReason: 'TOS_REQUIRED' | 'BETA_BLOCKED' | 'ONBOARDING_REQUIRED' | null;
  impersonatorId: string | null;
  limits: PlanLimits;
}
