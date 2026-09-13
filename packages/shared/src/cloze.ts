import { normalizeHeadword } from './scoring.js';

/**
 * Cloze blanking — PRD §10.6, design §4.1.
 * Blanks EVERY whole-word occurrence (case-insensitive) of the headword and the extra surfaces
 * (typically `inflectionSet(headword)`). Word boundaries are Unicode letter/digit boundaries, so
 * `apply` is never blanked inside `application`. Longer surfaces win ("checked in" over "checked").
 */

export const CLOZE_BLANK = '____';

const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;
const NOT_PRECEDED_BY_WORD_CHAR = '(?<![\\p{L}\\p{N}])';
const NOT_FOLLOWED_BY_WORD_CHAR = '(?![\\p{L}\\p{N}])';

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL_CHARS, '\\$&');
}

/** A normalized surface; spaces match any whitespace run in the sentence. */
function surfacePattern(surface: string): string {
  return surface.split(' ').map(escapeRegex).join('\\s+');
}

function uniqueSurfacesLongestFirst(headword: string, extras: Iterable<string>): string[] {
  const surfaces = new Set<string>();
  for (const raw of [headword, ...extras]) {
    const normalized = normalizeHeadword(raw);
    if (normalized.length > 0) surfaces.add(normalized);
  }
  return [...surfaces].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function blankHeadword(
  sentence: string,
  headword: string,
  extras: Iterable<string> = [],
): { text: string; blanked: string[] } {
  const surfaces = uniqueSurfacesLongestFirst(headword, extras);
  if (surfaces.length === 0) return { text: sentence, blanked: [] };

  const pattern = new RegExp(
    `${NOT_PRECEDED_BY_WORD_CHAR}(?:${surfaces.map(surfacePattern).join('|')})${NOT_FOLLOWED_BY_WORD_CHAR}`,
    'giu',
  );

  const blanked: string[] = [];
  const seen = new Set<string>();
  const text = sentence.replace(pattern, (match: string) => {
    const key = normalizeHeadword(match);
    if (!seen.has(key)) {
      seen.add(key);
      blanked.push(match);
    }
    return CLOZE_BLANK;
  });
  return { text, blanked };
}
