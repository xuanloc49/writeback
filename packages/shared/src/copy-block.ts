/**
 * Copy-block normalization — design §4.1, §9.3.
 * NFKC → lowercase → strip Unicode punctuation and symbols → collapse whitespace → trim.
 * Letters (including Vietnamese diacritics) and digits are preserved.
 */

const PUNCTUATION_AND_SYMBOLS = /[\p{P}\p{S}]/gu;
const WHITESPACE_RUN = /\s+/g;

export function normalizeCopyBlock(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(PUNCTUATION_AND_SYMBOLS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

/** True when the normalized user sentence equals any non-empty normalized reference. */
export function isCopyBlocked(userEn: string, references: readonly string[]): boolean {
  const normalizedUser = normalizeCopyBlock(userEn);
  if (normalizedUser.length === 0) return false;
  return references.some((reference) => {
    const normalizedReference = normalizeCopyBlock(reference);
    return normalizedReference.length > 0 && normalizedReference === normalizedUser;
  });
}
