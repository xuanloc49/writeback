export type ContentStatus = 'draft' | 'published';

export type AdminTopic = {
  id: string;
  slug: string;
  nameVi: string;
  status: ContentStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type TopicContextView = {
  lemmaCounts: { draft: number; published: number };
  promptCounts: { draft: number; published: number };
  blockers: { lemmaId: string; headword: string; publishedPromptCount: number }[];
};

export type AdminLemma = {
  id: string;
  headword: string;
  headwordNormalized: string;
  pos: string | null;
  phonetic: string | null;
  senseVi: string;
  exampleEn: string | null;
  notesVi: string | null;
  topicId: string;
  includedInFree: boolean;
  status: ContentStatus;
  cefr: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type AdminPrompt = {
  id: string;
  externalKey: string | null;
  textVi: string;
  topicId: string;
  sampleEn: string | null;
  hintsVi: string | null;
  status: ContentStatus;
  targetLemmaIds: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'editor' | 'support' | 'admin';
  plan: 'free' | 'premium';
  createdAt: string;
  lastLoginAt: string | null;
  cardCount: number;
  rewriteNew7d: number;
};

export type PlanChangeView = {
  id: string;
  fromPlan: 'free' | 'premium';
  toPlan: 'free' | 'premium';
  changedById: string;
  note: string;
  createdAt: string;
};

export type QuotaTodayView = {
  date: string;
  limits: {
    rewriteNewPerDay: number;
    retryPerDay: number;
    reviewSessionCap: number;
    newCardsUsedNaturalPerDay: number | null;
  };
  rewriteNewUsed: number;
  retryUsed: number;
  rewriteNewLeft: number;
  retryLeft: number;
};

export type AdminUserDetail = AdminUserRow & {
  tosAcceptedAt: string | null;
  onboardingCompletedAt: string | null;
  onboardingTopicIds: string[];
  overrides: { allowTopicIds: string[]; denyTopicIds: string[] };
  quotaToday: QuotaTodayView;
  planHistory: PlanChangeView[];
};

export type AllowlistView = {
  enabled: boolean;
  emails: { email: string; createdAt: string; createdById: string }[];
};

export type AuditRowView = {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  props: unknown;
  requestId: string | null;
  createdAt: string;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type ImportIssue = {
  type: string;
  index: number | null;
  key: string | null;
  field: string | null;
  code: string;
  message: string;
};

export type ImportCounts = {
  topics: { create: number; update: number };
  lemmas: { create: number; update: number };
  prompts: { create: number; update: number };
};

export type DryRunResponse = {
  batchId: string;
  ok: boolean;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  counts: ImportCounts;
};

export type CommitResponse = DryRunResponse & { committedAt: string };

export type PublishAllResponse = {
  published: { type: string; id: string }[];
  failed: { type: string; id: string; reasons: string[] }[];
};
