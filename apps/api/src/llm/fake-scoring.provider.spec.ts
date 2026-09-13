import type { ScoringOutput } from '@writeback/shared';
import { FakeScoringProvider } from './fake-scoring.provider';
import type { ScoringInput, ScoringResult } from './scoring-provider';

function input(userEn: string, headwords: string[]): ScoringInput {
  return {
    textVi: 'Tôi đã nộp báo cáo.',
    requiredWords: headwords.map((headword) => ({ headword, pos: 'verb', senseVi: 'nộp' })),
    sampleEn: 'I submitted the report.',
    userEn,
  };
}

describe('FakeScoringProvider', () => {
  it('marks a headword used when an inflection appears, false otherwise', async () => {
    const provider = new FakeScoringProvider();
    const result = await provider.score(input('Yesterday I submitted the report.', ['submit', 'deadline']));
    const raw = result.raw as ScoringOutput;
    expect(raw.used_required_words).toEqual([
      expect.objectContaining({ headword: 'submit', used: true, natural: true }),
      expect.objectContaining({ headword: 'deadline', used: false, natural: false }),
    ]);
    expect(provider.calls).toHaveLength(1);
  });

  it('returns an enqueued payload once, then falls back to deterministic output', async () => {
    const provider = new FakeScoringProvider();
    const canned: ScoringResult = { raw: { canned: true }, model: 'm', inputTokens: 1, outputTokens: 2, latencyMs: 3 };
    provider.enqueue(canned);
    expect(await provider.score(input('x', ['submit']))).toBe(canned);
    const second = await provider.score(input('x', ['submit']));
    expect(second.model).toBe('fake-scoring');
  });

  it('throws an enqueued Error once', async () => {
    const provider = new FakeScoringProvider();
    provider.enqueue(new Error('boom'));
    await expect(provider.score(input('x', []))).rejects.toThrow('boom');
    await expect(provider.score(input('x', []))).resolves.toBeDefined();
  });
});
