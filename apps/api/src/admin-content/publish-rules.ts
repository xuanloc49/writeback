import { CONTENT, type ContentStatus } from '@writeback/shared';

/**
 * Publish blockers — design §13, PRD §10.3. Pure so AdminContent and Import publish-all share them.
 * Reason codes are stable identifiers surfaced in `details.reasons[]`.
 */
export const PUBLISH_REASONS = {
  EXAMPLE_EN_MISSING: 'example_en_missing',
  SAMPLE_EN_MISSING: 'sample_en_missing',
  TARGETS_COUNT: 'targets_count',
  TARGET_NOT_PUBLISHED: 'target_not_published',
  TARGET_CROSS_TOPIC: 'target_cross_topic',
} as const;

export type PublishReason = (typeof PUBLISH_REASONS)[keyof typeof PUBLISH_REASONS];

/** "Normalize không rỗng": blank after trimming whitespace. */
export function isBlank(text: string | null | undefined): boolean {
  return text === null || text === undefined || text.trim().length === 0;
}

export function lemmaPublishReasons(lemma: { exampleEn: string | null }): PublishReason[] {
  return isBlank(lemma.exampleEn) ? [PUBLISH_REASONS.EXAMPLE_EN_MISSING] : [];
}

export interface PromptPublishTarget {
  status: ContentStatus;
  deletedAt: Date | null;
  topicId: string;
}

export function promptPublishReasons(
  prompt: { sampleEn: string | null; topicId: string },
  targets: readonly PromptPublishTarget[],
): PublishReason[] {
  const reasons: PublishReason[] = [];
  if (isBlank(prompt.sampleEn)) {
    reasons.push(PUBLISH_REASONS.SAMPLE_EN_MISSING);
  }
  if (targets.length < CONTENT.PROMPT_TARGETS_MIN || targets.length > CONTENT.PROMPT_TARGETS_MAX) {
    reasons.push(PUBLISH_REASONS.TARGETS_COUNT);
  }
  if (targets.some((target) => target.status !== 'published' || target.deletedAt !== null)) {
    reasons.push(PUBLISH_REASONS.TARGET_NOT_PUBLISHED);
  }
  if (targets.some((target) => target.topicId !== prompt.topicId)) {
    reasons.push(PUBLISH_REASONS.TARGET_CROSS_TOPIC);
  }
  return reasons;
}
