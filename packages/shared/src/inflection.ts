import { normalizeHeadword } from './scoring.js';

/**
 * `inflectionSet(headword)` — PRD §10.6 / Appendix B.
 * Deterministic, lowercase, no fuzzy spelling. Regular tense/plural/gerund family
 * (submit → submits/submitted/submitting) plus a fixed table of common irregular verbs.
 * Multi-word headwords (phrasal verbs such as "check in") inflect the FIRST word and keep the
 * rest verbatim; the whole phrase itself is always included.
 */

/** base → irregular past / participle / other forms. Regular -s and -ing are added on top. */
const IRREGULAR_VERBS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done'],
  go: ['went', 'gone'],
  get: ['got', 'gotten'],
  make: ['made'],
  take: ['took', 'taken'],
  come: ['came'],
  see: ['saw', 'seen'],
  know: ['knew', 'known'],
  give: ['gave', 'given'],
  find: ['found'],
  think: ['thought'],
  tell: ['told'],
  become: ['became'],
  leave: ['left'],
  feel: ['felt'],
  bring: ['brought'],
  begin: ['began', 'begun'],
  keep: ['kept'],
  hold: ['held'],
  write: ['wrote', 'written'],
  stand: ['stood'],
  hear: ['heard'],
  let: [],
  mean: ['meant'],
  set: [],
  meet: ['met'],
  run: ['ran'],
  pay: ['paid'],
  sit: ['sat'],
  speak: ['spoke', 'spoken'],
  lie: ['lay', 'lain'],
  lead: ['led'],
  read: [],
  grow: ['grew', 'grown'],
  lose: ['lost'],
  fall: ['fell', 'fallen'],
  send: ['sent'],
  build: ['built'],
  understand: ['understood'],
  draw: ['drew', 'drawn'],
  break: ['broke', 'broken'],
  spend: ['spent'],
  cut: [],
  rise: ['rose', 'risen'],
  drive: ['drove', 'driven'],
  buy: ['bought'],
  wear: ['wore', 'worn'],
  choose: ['chose', 'chosen'],
  eat: ['ate', 'eaten'],
  forget: ['forgot', 'forgotten'],
  teach: ['taught'],
  catch: ['caught'],
  sell: ['sold'],
  fly: ['flew', 'flown'],
  win: ['won'],
});

/** Polysyllabic CVC verbs with final stress: these double the last consonant (submit → submitted). */
const FINAL_STRESS_DOUBLING: ReadonlySet<string> = new Set([
  'submit',
  'commit',
  'admit',
  'permit',
  'omit',
  'emit',
  'transmit',
  'remit',
  'regret',
  'refer',
  'prefer',
  'defer',
  'confer',
  'infer',
  'transfer',
  'occur',
  'recur',
  'incur',
  'concur',
  'deter',
  'control',
  'patrol',
  'equip',
  'compel',
  'propel',
  'expel',
  'repel',
  'rebel',
  'upset',
  'allot',
  'acquit',
  'forbid',
  'begin',
  'forget',
  'format',
]);

/** Irregular verbs whose third-person form is fully covered by the table (avoid "bes", "haves"). */
const NO_REGULAR_THIRD_PERSON: ReadonlySet<string> = new Set(['be', 'have']);

const VOWELS: ReadonlySet<string> = new Set(['a', 'e', 'i', 'o', 'u']);
/** Final consonants that are never doubled before -ed / -ing. */
const NEVER_DOUBLED: ReadonlySet<string> = new Set(['w', 'x', 'y']);
/** Endings that take -es instead of -s. */
const ES_ENDINGS: readonly string[] = ['s', 'x', 'z', 'ch', 'sh', 'o'];
/** Endings where the final e is kept before -ing (see → seeing, dye → dyeing). */
const KEEP_E_BEFORE_ING: readonly string[] = ['ee', 'ye', 'oe'];
/** Minimum length for the silent-e drop, so that "be" → "being" rather than "bing". */
const MIN_LENGTH_FOR_E_DROP = 3;
/** Minimum length for the CVC doubling rule (needs consonant + vowel + consonant). */
const MIN_LENGTH_FOR_CVC = 3;
const ONLY_LETTERS = /^[a-z]+$/;
const VOWEL_RUN = /[aeiouy]+/g;

function lastChar(word: string): string {
  return word.charAt(word.length - 1);
}

function isVowel(char: string): boolean {
  return VOWELS.has(char);
}

function endsWithAny(word: string, endings: readonly string[]): boolean {
  return endings.some((ending) => word.endsWith(ending));
}

/** consonant + y (apply, fly) — but not vowel + y (play, pay). */
function endsWithConsonantY(word: string): boolean {
  return word.length >= 2 && word.endsWith('y') && !isVowel(word.charAt(word.length - 2));
}

/** consonant + single vowel + single final consonant (plan, submit) — candidate for doubling. */
function endsWithCvc(word: string): boolean {
  if (word.length < MIN_LENGTH_FOR_CVC) return false;
  const last = lastChar(word);
  const secondLast = word.charAt(word.length - 2);
  const thirdLast = word.charAt(word.length - 3);
  return !isVowel(last) && !NEVER_DOUBLED.has(last) && isVowel(secondLast) && !isVowel(thirdLast);
}

/** Rough syllable count = number of vowel runs (y counts as a vowel except word-initially). */
function countVowelGroups(word: string): number {
  const withoutLeadingY = word.startsWith('y') ? word.slice(1) : word;
  return withoutLeadingY.match(VOWEL_RUN)?.length ?? 0;
}

function thirdPersonForm(word: string): string {
  if (endsWithAny(word, ES_ENDINGS)) return `${word}es`;
  if (endsWithConsonantY(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/**
 * Stem for -ed / -ing — one correctly spelled stem per word (PRD §10.6 / Appendix B: no fuzzy
 * spelling). Monosyllabic CVC words double (plan → planned). Polysyllabic CVC words do NOT double
 * (visit → visited, offer → offered) unless they carry final stress and are listed in
 * `FINAL_STRESS_DOUBLING` (submit → submitted, occur → occurred).
 */
function suffixStem(word: string): string {
  if (!endsWithCvc(word)) return word;
  const doubles = countVowelGroups(word) <= 1 || FINAL_STRESS_DOUBLING.has(word);
  return doubles ? `${word}${lastChar(word)}` : word;
}

function pastForm(word: string): string {
  if (word.endsWith('e')) return `${word}d`;
  if (endsWithConsonantY(word)) return `${word.slice(0, -1)}ied`;
  return `${suffixStem(word)}ed`;
}

function gerundForm(word: string): string {
  if (word.endsWith('ie')) return `${word.slice(0, -2)}ying`;
  if (
    word.endsWith('e') &&
    word.length >= MIN_LENGTH_FOR_E_DROP &&
    !endsWithAny(word, KEEP_E_BEFORE_ING)
  ) {
    return `${word.slice(0, -1)}ing`;
  }
  return `${suffixStem(word)}ing`;
}

/** All forms of one lowercase single word (always starts with the word itself). */
function singleWordForms(word: string): string[] {
  if (!ONLY_LETTERS.test(word)) return [word];
  const irregular = IRREGULAR_VERBS[word];
  const forms = [word];
  if (irregular !== undefined) {
    forms.push(...irregular);
    if (!NO_REGULAR_THIRD_PERSON.has(word)) forms.push(thirdPersonForm(word));
    forms.push(gerundForm(word));
    return forms;
  }
  forms.push(thirdPersonForm(word), pastForm(word), gerundForm(word));
  return forms;
}

export function inflectionSet(headword: string): Set<string> {
  const normalized = normalizeHeadword(headword);
  if (normalized.length === 0) return new Set();

  const spaceIndex = normalized.indexOf(' ');
  if (spaceIndex === -1) return new Set(singleWordForms(normalized));

  const first = normalized.slice(0, spaceIndex);
  const tail = normalized.slice(spaceIndex + 1);
  return new Set([normalized, ...singleWordForms(first).map((form) => `${form} ${tail}`)]);
}
