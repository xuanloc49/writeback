import { Injectable } from '@nestjs/common';
import type { Lemma, Prisma } from '@prisma/client';
import { blankHeadword, inflectionSet, scoringOutputSchema } from '@writeback/shared';
import type { Tx } from '../prisma/prisma.service';
import type { TargetSnapshot } from '../rewrite/rewrite.dto';

/** Candidate sentences for one lemma, in PRD §10.6 priority order. `sample_en` is never used. */
export interface LemmaSentenceSources {
  /** (a) `user_en` of the most recent scored attempt where the LLM marked this lemma `used: true`. */
  usedSentence: string | null;
  /** (b) `model_rewrite_en` of the most recent scored attempt targeting this lemma. */
  modelRewrite: string | null;
  /** (c) `lemma.example_en`. */
  exampleEn: string | null;
}

export interface ClozeSource {
  /** Original sentence (server-side only, never returned to the client). */
  sentence: string;
  /** Sentence with every occurrence blanked — the cloze front. */
  text: string;
  /** Surfaces actually blanked; part of the accepted answer set. */
  blanked: string[];
}

export interface AttemptForSources {
  userEn: string | null;
  feedback: Prisma.JsonValue | null;
  targetsSnapshot: Prisma.JsonValue;
}

function targetsLemma(attempt: AttemptForSources, lemmaId: string): boolean {
  const targets = attempt.targetsSnapshot as unknown as TargetSnapshot[];
  return Array.isArray(targets) && targets.some((target) => target.lemmaId === lemmaId);
}

/** Pure selection over attempts sorted most-recent first. */
export function collectSentenceSources(
  attempts: readonly AttemptForSources[],
  lemma: Pick<Lemma, 'id' | 'headword' | 'exampleEn'>,
): LemmaSentenceSources {
  const headword = lemma.headword.toLowerCase();
  let usedSentence: string | null = null;
  let modelRewrite: string | null = null;
  for (const attempt of attempts) {
    if (!targetsLemma(attempt, lemma.id)) {
      continue;
    }
    const parsed = scoringOutputSchema.safeParse(attempt.feedback);
    if (!parsed.success) {
      continue;
    }
    if (modelRewrite === null) {
      modelRewrite = parsed.data.model_rewrite_en;
    }
    const used = parsed.data.used_required_words.some(
      (word) => word.headword.toLowerCase() === headword && word.used,
    );
    if (used && attempt.userEn !== null) {
      usedSentence = attempt.userEn;
      break;
    }
  }
  return { usedSentence, modelRewrite, exampleEn: lemma.exampleEn };
}

/**
 * First usable source in order (a) → (b) → (c). A sentence is usable only when blanking actually
 * removes at least one occurrence; otherwise the caller falls back to `type` mode (PRD §13).
 */
export function selectClozeSource(
  sources: LemmaSentenceSources,
  headword: string,
): ClozeSource | null {
  const extras = inflectionSet(headword);
  for (const sentence of [sources.usedSentence, sources.modelRewrite, sources.exampleEn]) {
    if (sentence === null || sentence.trim().length === 0) {
      continue;
    }
    const { text, blanked } = blankHeadword(sentence, headword, extras);
    if (blanked.length > 0) {
      return { sentence, text, blanked };
    }
  }
  return null;
}

@Injectable()
export class ClozeSourceService {
  /** Loads the user's scored attempts that targeted `lemma` (most recent first) and collects sources. */
  async sourcesFor(
    tx: Tx,
    userId: string,
    lemma: Pick<Lemma, 'id' | 'headword' | 'exampleEn'>,
  ): Promise<LemmaSentenceSources> {
    const attempts = await tx.rewriteAttempt.findMany({
      where: {
        userId,
        status: 'scored',
        targetsSnapshot: { array_contains: [{ lemmaId: lemma.id }] },
      },
      orderBy: [{ scoredAt: 'desc' }, { revision: 'desc' }],
      select: { userEn: true, feedback: true, targetsSnapshot: true },
    });
    return collectSentenceSources(attempts, lemma);
  }
}
