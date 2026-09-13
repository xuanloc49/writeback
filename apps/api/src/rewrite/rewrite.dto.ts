import { REWRITE, type IdeaMatchStatus, type DisplayIssue } from '@writeback/shared';
import { z } from 'zod';

export const startRewriteSchema = z
  .object({ topicId: z.string().uuid().optional(), lemmaId: z.string().uuid().optional() })
  .strict();
export type StartRewriteBody = z.infer<typeof startRewriteSchema>;

export const submitRewriteSchema = z
  .object({
    revision: z.union([z.literal(1), z.literal(REWRITE.MAX_REVISION)]),
    userEn: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1).max(REWRITE.USER_EN_MAX_LENGTH)),
  })
  .strict();
export type SubmitRewriteBody = z.infer<typeof submitRewriteSchema>;

export interface TargetSnapshot {
  lemmaId: string;
  headword: string;
  pos: string | null;
  senseVi: string;
}

export interface PromptView {
  id: string;
  textVi: string;
  hintsVi: string | null;
  topicId: string;
  topicNameVi: string;
  targets: TargetSnapshot[];
}

export interface QuotaView {
  rewriteNewLeft: number;
  retryLeft: number;
}

export interface StartRewriteResponse {
  attemptId: string;
  revision: number;
  prompt: PromptView;
  quota: QuotaView;
  revisionUntil: null;
}

export interface UsedWordView {
  headword: string;
  used: boolean;
  natural: boolean;
  commentVi: string;
}

export interface CardAddedView {
  cardId: string;
  lemmaId: string;
  headword: string;
  undoable: boolean;
}

export interface CardDeferredView {
  lemmaId: string;
  headword: string;
}

/** Design Appendix B. */
export interface SubmitRewriteResponse {
  attemptId: string;
  revision: number;
  scoredAt: string;
  overallScore: number;
  ideaMatch: { status: IdeaMatchStatus; commentVi: string };
  usedRequiredWords: UsedWordView[];
  displayIssues: DisplayIssue[];
  naturalnessNoteVi: string;
  encouragementVi: string;
  modelRewriteEn: string;
  showModelRewriteToggle: boolean;
  revisionUntil: string | null;
  revisionAvailable: boolean;
  cardsAdded: CardAddedView[];
  cardsDeferredCap20: CardDeferredView[];
  quota: QuotaView;
}

export interface RevisionView {
  revision: number;
  status: string;
  userEn: string | null;
  scoredAt: string | null;
  overallScore: number | null;
  ideaMatch: { status: IdeaMatchStatus; commentVi: string } | null;
  usedRequiredWords: UsedWordView[];
  displayIssues: DisplayIssue[];
  naturalnessNoteVi: string | null;
  encouragementVi: string | null;
  modelRewriteEn: string | null;
}

export interface AttemptFamilyResponse {
  attemptId: string;
  prompt: PromptView;
  revisions: RevisionView[];
  revisionAvailable: boolean;
  revisionUntil: string | null;
  showModelRewriteToggle: boolean;
  quota: QuotaView;
}
