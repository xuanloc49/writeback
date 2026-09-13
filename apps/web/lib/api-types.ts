import type {
  DisplayIssue,
  IdeaMatchStatus,
  MeDto,
  ReviewMode,
  ReviewQuality,
  SrsStatus,
} from '@writeback/shared';

export type QuotaView = {
  rewriteNewLeft: number;
  retryLeft: number;
};

export type PromptView = {
  id: string;
  textVi: string;
  hintsVi: string | null;
  topicId: string;
  topicNameVi: string;
  targets: { lemmaId: string; headword: string; pos: string | null; senseVi: string }[];
};

export type StartRewriteResponse = {
  attemptId: string;
  revision: number;
  prompt: PromptView;
  quota: QuotaView;
  revisionUntil: null;
};

export type UsedWordView = {
  headword: string;
  used: boolean;
  natural: boolean;
  commentVi: string;
};

export type CardAddedView = {
  cardId: string;
  lemmaId: string;
  headword: string;
  undoable: boolean;
};

export type SubmitRewriteResponse = {
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
  cardsDeferredCap20: { lemmaId: string; headword: string }[];
  quota: QuotaView;
};

export type RevisionView = {
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
};

export type AttemptFamilyResponse = {
  attemptId: string;
  prompt: PromptView;
  revisions: RevisionView[];
  revisionAvailable: boolean;
  revisionUntil: string | null;
  showModelRewriteToggle: boolean;
  quota: QuotaView;
};

export type DashboardResponse = {
  streak: number;
  dueToday: number;
  reviewedToday: number;
  rewriteNewToday: number;
  quota: QuotaView;
  topics: { topicId: string; nameVi: string; cardCount: number; masteredPercent: number }[];
  cta: 'rewrite' | 'review' | null;
  hasCards: boolean;
};

export type VocabListResponse = {
  topics: {
    topicId: string;
    nameVi: string;
    cards: {
      cardId: string;
      lemmaId: string;
      headword: string;
      senseVi: string;
      status: SrsStatus;
      nextReviewAt: string;
      dueToday: boolean;
    }[];
  }[];
  hidden: { cardId: string; lemmaId: string; headword: string; topicNameVi: string }[];
};

export type VocabDetailResponse = {
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
  sentences: (
    | { text: string; attemptId: string; scoredAt: string; source: 'user' }
    | { text: string; source: 'example'; label: string }
  )[];
};

export type StartSessionResponse = { sessionId: string; cap: number; remaining: number };

export type CardView =
  | {
      cardId: string;
      lemmaId: string;
      mode: 'flashcard';
      front: { senseVi: string; topicNameVi: string };
      back: {
        headword: string;
        phonetic: string | null;
        notesVi: string | null;
        exampleSentence: string | null;
      };
    }
  | { cardId: string; lemmaId: string; mode: 'type'; front: { senseVi: string } }
  | {
      cardId: string;
      lemmaId: string;
      mode: 'cloze';
      front: { senseVi: string; sentence: string };
    };

export type NextResponse =
  { done: false; card: CardView; remaining: number } | { done: true; reason: 'empty' | 'cap' };

export type GradeResponse = {
  quality: ReviewQuality;
  correct?: boolean;
  mode: ReviewMode;
  card: { status: SrsStatus; nextReviewAt: string; intervalDays: number };
  reveal?: { headword: string; exampleSentence: string | null };
  next: NextResponse;
};

export type HistoryListResponse = {
  items: {
    attemptId: string;
    createdAt: string;
    scoredAt: string;
    topicNameVi: string;
    overallScore: number;
    excerpt: string;
    hasRevision: boolean;
    revisionScore: number | null;
  }[];
  nextCursor: string | null;
};

export type VisibleTopicList = { topics: { id: string; nameVi: string }[] };

export type { MeDto, DisplayIssue };
