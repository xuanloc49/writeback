import type { SrsStatus } from '@writeback/shared';

/** PRD §10.5: at most this many `used: true` user sentences on the lemma detail page. */
export const VOCAB_DETAIL_MAX_USER_SENTENCES = 3;
/** Upper bound on scored attempts scanned when collecting user sentences for one lemma. */
export const VOCAB_DETAIL_ATTEMPT_SCAN_LIMIT = 50;
/** Label shown next to `example_en` when the user has no `used: true` sentence yet (PRD §10.5). */
export const EXAMPLE_SENTENCE_LABEL_VI = 'câu mẫu';

export interface VocabCardView {
  cardId: string;
  lemmaId: string;
  headword: string;
  senseVi: string;
  status: SrsStatus;
  nextReviewAt: string;
  dueToday: boolean;
}

export interface VocabTopicGroup {
  topicId: string;
  nameVi: string;
  cards: VocabCardView[];
}

export interface HiddenCardView {
  cardId: string;
  lemmaId: string;
  headword: string;
  topicNameVi: string;
}

/** `GET /v1/vocab` — design §12.3. */
export interface VocabListResponse {
  topics: VocabTopicGroup[];
  hidden: HiddenCardView[];
}

export interface UserSentenceView {
  text: string;
  attemptId: string;
  scoredAt: string;
  source: 'user';
}

export interface ExampleSentenceView {
  text: string;
  source: 'example';
  label: string;
}

export type SentenceView = UserSentenceView | ExampleSentenceView;

/** `GET /v1/vocab/:lemmaId` — design §12.3, PRD §10.5. Never `cefr`, never `sample_en`. */
export interface VocabDetailResponse {
  lemma: {
    lemmaId: string;
    headword: string;
    pos: string | null;
    phonetic: string | null;
    senseVi: string;
    notesVi: string | null;
    exampleEn: string | null;
    topicNameVi: string;
  };
  srs: {
    status: SrsStatus;
    nextReviewAt: string;
    intervalDays: number;
    ef: number;
    repetitions: number;
  };
  sentences: SentenceView[];
}

export interface HideCardResult {
  cardId: string;
  lemmaId: string;
  hiddenAt: string;
}

export interface UnhideCardResult {
  cardId: string;
  lemmaId: string;
}
