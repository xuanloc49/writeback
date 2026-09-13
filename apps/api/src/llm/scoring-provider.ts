export interface ScoringRequiredWord {
  headword: string;
  pos: string | null;
  senseVi: string;
}

export interface ScoringInput {
  textVi: string;
  requiredWords: ScoringRequiredWord[];
  sampleEn: string;
  userEn: string;
}

export interface ScoringResult {
  raw: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface ScoringProvider {
  score(input: ScoringInput): Promise<ScoringResult>;
}

export const SCORING_PROVIDER = Symbol('SCORING_PROVIDER');

export type ScoringFailureReason = 'timeout' | 'provider_5xx';

/** Thrown by providers when the upstream call times out or fails server-side. */
export class ScoringProviderError extends Error {
  constructor(
    readonly reason: ScoringFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'ScoringProviderError';
  }
}
