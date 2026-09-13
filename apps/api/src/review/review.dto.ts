import type { ReviewMode, ReviewQuality, SrsStatus } from '@writeback/shared';
import { z } from 'zod';

/** Typed / cloze answers are a headword or short phrase; generous upper bound against abuse. */
const ANSWER_MAX_LENGTH = 100;

const cardIdSchema = z.string().uuid();

/** Flashcard buttons Quên=1, Khó=3, Tốt=4, Dễ=5 — PRD §10.6. */
const qualitySchema = z.union([z.literal(1), z.literal(3), z.literal(4), z.literal(5)]);

export const flashcardGradeSchema = z
  .object({ cardId: cardIdSchema, quality: qualitySchema })
  .strict();
export const typedGradeSchema = z
  .object({ cardId: cardIdSchema, answer: z.string().max(ANSWER_MAX_LENGTH) })
  .strict();
/** Design §12.4: flashcard `{ cardId, quality }`; type/cloze `{ cardId, answer }`. */
export const gradeSchema = z.union([flashcardGradeSchema, typedGradeSchema]);
export type FlashcardGradeBody = z.infer<typeof flashcardGradeSchema>;
export type TypedGradeBody = z.infer<typeof typedGradeSchema>;
export type GradeBody = z.infer<typeof gradeSchema>;

export interface StartSessionResponse {
  sessionId: string;
  cap: number;
  /** Cards servable in this session right now: min(due queue length, cap − graded). */
  remaining: number;
}

export interface FlashcardFront {
  senseVi: string;
  topicNameVi: string;
}

export interface TypeFront {
  senseVi: string;
}

export interface ClozeFront {
  senseVi: string;
  /** Source sentence with every headword/inflection occurrence replaced by `____`. */
  sentence: string;
}

/**
 * Flashcard back side (PRD §10.6 mode 1). Returned together with the front so the client can
 * flip locally; the answer is never sent for `type` / `cloze`.
 */
export interface FlashcardBack {
  headword: string;
  phonetic: string | null;
  notesVi: string | null;
  /** The user's own `used: true` sentence when one exists, else `lemma.example_en`. */
  exampleSentence: string | null;
}

export interface FlashcardView {
  cardId: string;
  lemmaId: string;
  mode: 'flashcard';
  front: FlashcardFront;
  back: FlashcardBack;
}

export interface TypeCardView {
  cardId: string;
  lemmaId: string;
  mode: 'type';
  front: TypeFront;
}

export interface ClozeCardView {
  cardId: string;
  lemmaId: string;
  mode: 'cloze';
  front: ClozeFront;
}

export type CardView = FlashcardView | TypeCardView | ClozeCardView;

export type DoneReason = 'empty' | 'cap';

export type NextResponse =
  { done: false; card: CardView; remaining: number } | { done: true; reason: DoneReason };

export interface GradedCardView {
  status: SrsStatus;
  nextReviewAt: string;
  intervalDays: number;
}

/** Answer shown after a typed / cloze grade (PRD §10.6: wrong → headword + example). */
export interface RevealView {
  headword: string;
  exampleSentence: string | null;
}

export interface GradeResponse {
  quality: ReviewQuality;
  /** Present for `type` / `cloze` only. */
  correct?: boolean;
  mode: ReviewMode;
  card: GradedCardView;
  reveal?: RevealView;
  next: NextResponse;
}
