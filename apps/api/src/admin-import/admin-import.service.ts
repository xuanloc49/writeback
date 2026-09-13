import { Inject, Injectable } from '@nestjs/common';
import type { ImportBatch, Prisma, User } from '@prisma/client';
import { CONTENT } from '@writeback/shared';
import { LemmasService } from '../admin-content/lemmas.service';
import { PromptsService } from '../admin-content/prompts.service';
import { AnalyticsService, type AnalyticsProps } from '../analytics/analytics.service';
import { AUDIT_ACTIONS } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { AppError, appError } from '../common/app-error';
import { CLOCK, type Clock } from '../common/clock';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  DEFAULT_IMPORT_FILENAME,
  type CommitResponse,
  type CommittedIds,
  type DryRunResponse,
  type ImportBatchResult,
  type ImportCounts,
  type PublishAllItemType,
  type PublishAllResponse,
} from './admin-import.dto';
import {
  ImportValidatorService,
  type ResolvedLemma,
  type ResolvedPrompt,
  type ValidationOutcome,
} from './import-validator.service';

const ANALYTICS = { DRY_RUN: 'admin_import_dry_run', COMMIT: 'admin_import_commit' } as const;
const IMPORT_BATCH_TARGET_TYPE = 'import_batch';
/** Stored when the document root is invalid and no `schema_version` can be read. */
const UNKNOWN_SCHEMA_VERSION = 0;

/** JSON content import — PRD Appendix A, §10.10; design §12.6, §7.7. */
@Injectable()
export class AdminImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: ImportValidatorService,
    private readonly lemmas: LemmasService,
    private readonly prompts: PromptsService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Writes only `import_batches` (committed_at null); the report is the response. */
  async dryRun(
    actor: User,
    document: unknown,
    filename: string | undefined,
    requestId: string,
  ): Promise<DryRunResponse> {
    const outcome = await this.validator.validate(document);
    const ok = outcome.rootOk && (outcome.errors.length === 0 || !outcome.strict);
    const result: ImportBatchResult = {
      errors: outcome.errors,
      warnings: outcome.warnings,
      counts: outcome.counts,
      document,
    };
    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: {
          adminId: actor.id,
          filename: filename ?? DEFAULT_IMPORT_FILENAME,
          schemaVersion: outcome.schemaVersion ?? UNKNOWN_SCHEMA_VERSION,
          strict: outcome.strict,
          result: toJson(result),
          committedAt: null,
          createdAt: this.clock.now(),
        },
      });
      await this.analytics.track(
        ANALYTICS.DRY_RUN,
        actor.id,
        { batchId: created.id, ok, ...reportProps(outcome) },
        requestId,
        tx,
      );
      return created;
    });
    return {
      batchId: batch.id,
      ok,
      errors: outcome.errors,
      warnings: outcome.warnings,
      counts: outcome.counts,
    };
  }

  /**
   * Re-validates the stored document (DB may have changed) and writes everything in one
   * transaction. The file can never publish: new rows are created as `draft` (PRD §10.10) and
   * `status`/`published` keys are rejected by the strict schema; upserted rows keep their status.
   * Rows with errors are skipped unless the batch is strict, in which case nothing is written.
   */
  async commit(actor: User, batchId: string, requestId: string): Promise<CommitResponse> {
    const batch = await this.requireBatch(batchId);
    if (batch.committedAt !== null) {
      throw appError('CONFLICT', { reason: 'already_committed' });
    }
    const stored = batch.result as unknown as ImportBatchResult;
    const outcome = await this.validator.validate(stored.document);
    if (!outcome.rootOk || (batch.strict && outcome.errors.length > 0)) {
      throw appError('VALIDATION', { errors: outcome.errors });
    }

    const committedAt = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const committed = await this.writeDocument(tx, outcome);
      const result: ImportBatchResult = {
        errors: outcome.errors,
        warnings: outcome.warnings,
        counts: outcome.counts,
        document: stored.document,
        committed,
      };
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { committedAt, result: toJson(result) },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AUDIT_ACTIONS.IMPORT_COMMIT,
          targetType: IMPORT_BATCH_TARGET_TYPE,
          targetId: batch.id,
          props: { filename: batch.filename, strict: batch.strict, counts: outcome.counts },
          requestId,
        },
        tx,
      );
      await this.analytics.track(
        ANALYTICS.COMMIT,
        actor.id,
        { batchId: batch.id, ...reportProps(outcome) },
        requestId,
        tx,
      );
    });
    return {
      batchId: batch.id,
      committedAt: committedAt.toISOString(),
      errors: outcome.errors,
      warnings: outcome.warnings,
      counts: outcome.counts,
    };
  }

  /** Lemmas first, then prompts, using the exact AdminContent publish rules; each success audited. */
  async publishAll(actor: User, batchId: string, requestId: string): Promise<PublishAllResponse> {
    const batch = await this.requireBatch(batchId);
    const committed = (batch.result as unknown as ImportBatchResult).committed;
    if (batch.committedAt === null || committed === undefined) {
      throw appError('CONFLICT', { reason: 'not_committed' });
    }
    const response: PublishAllResponse = { published: [], failed: [] };
    for (const id of committed.lemmaIds) {
      await this.tryPublish(response, 'lemma', id, () => this.lemmas.publish(id, actor, requestId));
    }
    for (const id of committed.promptIds) {
      await this.tryPublish(response, 'prompt', id, () =>
        this.prompts.publish(id, actor, requestId),
      );
    }
    return response;
  }

  private async tryPublish(
    response: PublishAllResponse,
    type: PublishAllItemType,
    id: string,
    publish: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await publish();
      response.published.push({ type, id });
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }
      const reasons = error.details?.reasons;
      response.failed.push({
        type,
        id,
        reasons: Array.isArray(reasons) ? reasons.map(String) : [error.code.toLowerCase()],
      });
    }
  }

  private async writeDocument(tx: Tx, outcome: ValidationOutcome): Promise<CommittedIds> {
    const committed: CommittedIds = { topicIds: [], lemmaIds: [], promptIds: [] };
    const topicIds = new Map(outcome.dbTopicIds);
    for (const { item, existingId } of outcome.topics) {
      const topic =
        existingId === null
          ? await tx.topic.create({
              data: { slug: item.slug, nameVi: item.name_vi, status: 'draft' },
            })
          : await tx.topic.update({ where: { id: existingId }, data: { nameVi: item.name_vi } });
      topicIds.set(item.slug, topic.id);
      committed.topicIds.push(topic.id);
    }

    const lemmaIds = new Map(outcome.dbLemmaIds);
    for (const lemma of outcome.lemmas) {
      const topicId = requireId(topicIds, lemma.item.topic_slug);
      const row =
        lemma.existingId === null
          ? await tx.lemma.create({ data: lemmaCreateData(lemma, topicId) })
          : await tx.lemma.update({
              where: { id: lemma.existingId },
              data: lemmaUpdateData(lemma, topicId),
            });
      lemmaIds.set(lemma.headwordNormalized, row.id);
      committed.lemmaIds.push(row.id);
    }

    for (const prompt of outcome.prompts) {
      const topicId = requireId(topicIds, prompt.item.topic_slug);
      const links = prompt.targetHeadwordsNormalized.map((headword, index) => ({
        lemmaId: requireId(lemmaIds, headword),
        sortOrder: index,
      }));
      const data = promptData(prompt, topicId);
      let promptId: string;
      if (prompt.existingId === null) {
        const created = await tx.prompt.create({
          data: { ...data, status: 'draft', lemmaLinks: { create: links } },
        });
        promptId = created.id;
      } else {
        await tx.promptLemma.deleteMany({ where: { promptId: prompt.existingId } });
        const updated = await tx.prompt.update({
          where: { id: prompt.existingId },
          data: { ...data, lemmaLinks: { create: links } },
        });
        promptId = updated.id;
      }
      committed.promptIds.push(promptId);
    }
    return committed;
  }

  private async requireBatch(batchId: string): Promise<ImportBatch> {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (batch === null) {
      throw appError('NOT_FOUND');
    }
    return batch;
  }
}

function lemmaCreateData(lemma: ResolvedLemma, topicId: string): Prisma.LemmaUncheckedCreateInput {
  const { item } = lemma;
  return {
    headword: item.headword,
    headwordNormalized: lemma.headwordNormalized,
    pos: item.pos ?? null,
    phonetic: item.phonetic ?? null,
    senseVi: item.sense_vi,
    exampleEn: item.example_en ?? null,
    notesVi: item.notes_vi ?? null,
    topicId,
    includedInFree: item.included_in_free,
    cefr: item.cefr ?? null,
    status: 'draft',
  };
}

/**
 * Overwrites only the fields present in the file row (PRD Appendix A "ghi đè field đưa vào").
 * `status` is never a file field: new rows are created as draft, existing rows keep their status
 * (same semantics as a manual PATCH).
 */
function lemmaUpdateData(lemma: ResolvedLemma, topicId: string): Prisma.LemmaUncheckedUpdateInput {
  const { item, raw } = lemma;
  return {
    headword: item.headword,
    senseVi: item.sense_vi,
    topicId,
    ...(item.pos !== undefined ? { pos: item.pos } : {}),
    ...(item.phonetic !== undefined ? { phonetic: item.phonetic } : {}),
    ...(item.example_en !== undefined ? { exampleEn: item.example_en } : {}),
    ...(item.notes_vi !== undefined ? { notesVi: item.notes_vi } : {}),
    ...('included_in_free' in raw ? { includedInFree: item.included_in_free } : {}),
    ...(item.cefr !== undefined ? { cefr: item.cefr } : {}),
  };
}

function promptData(
  prompt: ResolvedPrompt,
  topicId: string,
): Omit<Prisma.PromptUncheckedCreateInput, 'status'> {
  const { item } = prompt;
  return {
    externalKey: item.external_key,
    textVi: item.text_vi,
    topicId,
    sampleEn: item.sample_en ?? null,
    hintsVi: item.hints_vi ?? null,
  };
}

function requireId(map: Map<string, string>, key: string): string {
  const id = map.get(key);
  if (id === undefined) {
    // Validation guarantees resolution; reaching here is a programming error, not user input.
    throw new Error(`import: unresolved reference "${key}"`);
  }
  return id;
}

function reportProps(outcome: ValidationOutcome): AnalyticsProps {
  return {
    strict: outcome.strict,
    errorCount: outcome.errors.length,
    warningCount: outcome.warnings.length,
    ...flattenCounts(outcome.counts),
  };
}

function flattenCounts(counts: ImportCounts): AnalyticsProps {
  return {
    topicsCreate: counts.topics.create,
    topicsUpdate: counts.topics.update,
    lemmasCreate: counts.lemmas.create,
    lemmasUpdate: counts.lemmas.update,
    promptsCreate: counts.prompts.create,
    promptsUpdate: counts.prompts.update,
    schemaVersion: CONTENT.IMPORT_SCHEMA_VERSION,
  };
}

function toJson(result: ImportBatchResult): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(result)) as Prisma.InputJsonObject;
}
