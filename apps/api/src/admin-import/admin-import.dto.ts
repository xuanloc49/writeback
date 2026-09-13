import { z } from 'zod';

const FILENAME_MAX_LENGTH = 255;
export const DEFAULT_IMPORT_FILENAME = 'upload.json';

export const dryRunQuerySchema = z
  .object({ filename: z.string().trim().min(1).max(FILENAME_MAX_LENGTH).optional() })
  .strict();
export type DryRunQuery = z.infer<typeof dryRunQuerySchema>;

export const commitImportSchema = z.object({ batchId: z.string().uuid() }).strict();
export type CommitImportBody = z.infer<typeof commitImportSchema>;

export type ImportItemType = 'document' | 'topic' | 'lemma' | 'prompt';

/** One row-level finding of the dry-run report (PRD Appendix A "Lỗi dòng thường gặp"). */
export interface ImportIssue {
  type: ImportItemType;
  /** Array position in the file, `null` for document-level findings. */
  index: number | null;
  /** `slug` / `headword` / `external_key` of the item when known. */
  key: string | null;
  field: string | null;
  code: string;
  message: string;
}

export interface ImportEntityCounts {
  create: number;
  update: number;
}

export interface ImportCounts {
  topics: ImportEntityCounts;
  lemmas: ImportEntityCounts;
  prompts: ImportEntityCounts;
}

export interface ImportReport {
  errors: ImportIssue[];
  warnings: ImportIssue[];
  counts: ImportCounts;
}

export interface DryRunResponse extends ImportReport {
  batchId: string;
  ok: boolean;
}

export interface CommitResponse extends ImportReport {
  batchId: string;
  committedAt: string;
}

/** Ids written by a commit; stored in `import_batches.result.committed` for publish-all. */
export interface CommittedIds {
  topicIds: string[];
  lemmaIds: string[];
  promptIds: string[];
}

/** Shape of `import_batches.result` (design §7.7): report + the original document (+ committed ids). */
export interface ImportBatchResult extends ImportReport {
  document: unknown;
  committed?: CommittedIds;
}

export type PublishAllItemType = 'lemma' | 'prompt';

export interface PublishAllResponse {
  published: { type: PublishAllItemType; id: string }[];
  failed: { type: PublishAllItemType; id: string; reasons: string[] }[];
}
