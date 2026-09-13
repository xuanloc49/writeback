import { Injectable } from '@nestjs/common';
import { inflectionSet, type ScoringOutput } from '@writeback/shared';
import type { ScoringInput, ScoringProvider, ScoringResult } from './scoring-provider';

const FAKE_MODEL = 'fake-scoring';
const FAKE_SCORE = 70;

/**
 * Deterministic provider for local/test: marks a required word `used` when any inflection
 * appears in `userEn`. Tests may enqueue canned results or errors consumed FIFO.
 */
@Injectable()
export class FakeScoringProvider implements ScoringProvider {
  readonly calls: ScoringInput[] = [];
  private readonly queue: (ScoringResult | Error)[] = [];

  enqueue(item: ScoringResult | Error): void {
    this.queue.push(item);
  }

  enqueueRaw(raw: unknown): void {
    this.queue.push({ raw, model: FAKE_MODEL, inputTokens: 0, outputTokens: 0, latencyMs: 0 });
  }

  async score(input: ScoringInput): Promise<ScoringResult> {
    this.calls.push(input);
    const queued = this.queue.shift();
    if (queued instanceof Error) {
      throw queued;
    }
    if (queued !== undefined) {
      return queued;
    }
    return {
      raw: buildDeterministicOutput(input),
      model: FAKE_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };
  }
}

function buildDeterministicOutput(input: ScoringInput): ScoringOutput {
  const tokens = new Set(
    input.userEn
      .toLowerCase()
      .split(/[^a-z0-9'-]+/u)
      .filter((token) => token.length > 0),
  );
  return {
    overall_score: FAKE_SCORE,
    idea_match: { status: 'enough', comment_vi: 'Câu đã chuyển đủ ý chính.' },
    used_required_words: input.requiredWords.map((word) => {
      const forms = [...inflectionSet(word.headword)].map((form) => form.toLowerCase());
      const used = forms.some((form) => tokens.has(form));
      return {
        headword: word.headword,
        used,
        natural: used,
        comment_vi: used ? 'Dùng đúng và tự nhiên.' : 'Chưa dùng từ này.',
      };
    }),
    grammar_issues: [],
    lexical_issues: [],
    naturalness_note_vi: 'Câu khá tự nhiên.',
    model_rewrite_en: input.sampleEn,
    encouragement_vi: 'Tốt lắm, tiếp tục nhé!',
  };
}
