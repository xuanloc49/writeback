import { REWRITE } from '@writeback/shared';

export function showRevisionModelToggle(
  overallScore: number | null,
  revisionScored: boolean,
): boolean {
  return (
    !revisionScored &&
    overallScore !== null &&
    overallScore < REWRITE.MODEL_REWRITE_TOGGLE_BELOW_SCORE
  );
}

export function revisionWindowOpen(available: boolean, until: string | null, now: Date): boolean {
  if (!available || until === null) {
    return false;
  }
  return now.getTime() <= Date.parse(until);
}
