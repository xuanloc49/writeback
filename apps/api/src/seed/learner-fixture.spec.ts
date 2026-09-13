import { CONTENT, importDocumentSchema, normalizeHeadword } from '@writeback/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BANNED_HEADWORDS = new Set(['get', 'make', 'book', 'apply']);

function loadFixture(): unknown {
  const path = join(__dirname, '..', '..', 'prisma', 'seed', 'learner-fixture.json');
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

describe('learner fixture', () => {
  const parsed = importDocumentSchema.parse(loadFixture());
  const topics = parsed.topics ?? [];
  const lemmas = parsed.lemmas ?? [];
  const prompts = parsed.prompts ?? [];

  it('is import schema v1 with two Free topics', () => {
    expect(parsed.schema_version).toBe(CONTENT.IMPORT_SCHEMA_VERSION);
    expect(topics).toHaveLength(2);
  });

  it('publishes enough Free lemmas and prompts to write one sentence and review one card', () => {
    expect(lemmas.length).toBeGreaterThanOrEqual(4);
    expect(prompts.length).toBeGreaterThanOrEqual(4);
    expect(lemmas.every((lemma) => lemma.included_in_free === true)).toBe(true);
    expect(lemmas.every((lemma) => (lemma.example_en ?? '').trim().length > 0)).toBe(true);
    expect(prompts.every((prompt) => (prompt.sample_en ?? '').trim().length > 0)).toBe(true);
  });

  it('puts every lemma in at least two prompts of the same topic', () => {
    for (const lemma of lemmas) {
      const count = prompts.filter(
        (prompt) =>
          prompt.topic_slug === lemma.topic_slug &&
          prompt.target_headwords.some(
            (headword) => normalizeHeadword(headword) === normalizeHeadword(lemma.headword),
          ),
      ).length;
      expect(count).toBeGreaterThanOrEqual(CONTENT.MIN_PROMPTS_PER_PUBLISHED_LEMMA);
    }
  });

  it('does not seed banned multi-sense headwords', () => {
    for (const lemma of lemmas) {
      expect(BANNED_HEADWORDS.has(normalizeHeadword(lemma.headword))).toBe(false);
    }
  });
});
