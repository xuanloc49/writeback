/**
 * Type / cloze answer matching — PRD §10.6.
 * trim + case-insensitive exact equality. Punctuation is NOT stripped ("deadline." ≠ "deadline").
 * `accepted` = headword ∪ inflectionSet ∪ surfaces actually blanked in the cloze sentence.
 */
export function matchReviewAnswer(answer: string, accepted: Iterable<string>): boolean {
  const normalizedAnswer = answer.trim().toLowerCase();
  if (normalizedAnswer.length === 0) return false;
  for (const candidate of accepted) {
    if (candidate.trim().toLowerCase() === normalizedAnswer) return true;
  }
  return false;
}
