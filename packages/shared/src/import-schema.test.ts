import { describe, expect, it } from 'vitest';
import { CONTENT } from './constants.js';
import {
  importDocumentSchema,
  importLemmaSchema,
  importPromptSchema,
  importTopicSchema,
} from './import-schema.js';

const prompt = {
  external_key: 'p-1',
  text_vi: 'Hạn chót là ngày mai.',
  topic_slug: 'work',
  target_headwords: ['deadline', 'submit'],
};

const lemma = { headword: 'deadline', sense_vi: 'hạn chót', topic_slug: 'work' };

describe('importDocumentSchema', () => {
  it('accepts a minimal document and applies defaults', () => {
    const parsed = importDocumentSchema.parse({ schema_version: 1 });
    expect(parsed).toEqual({ schema_version: 1, strict: false });
  });

  it('accepts a full document and defaults included_in_free to false', () => {
    const parsed = importDocumentSchema.parse({
      schema_version: 1,
      strict: true,
      topics: [{ slug: 'work-life', name_vi: 'Công việc' }],
      lemmas: [lemma],
      prompts: [prompt],
    });
    expect(parsed.lemmas?.[0]?.included_in_free).toBe(false);
    expect(parsed.strict).toBe(true);
  });

  it('rejects a wrong schema_version and unknown root fields', () => {
    expect(importDocumentSchema.safeParse({ schema_version: 2 }).success).toBe(false);
    expect(importDocumentSchema.safeParse({ schema_version: 1, published: true }).success).toBe(
      false,
    );
  });
});

describe('importTopicSchema', () => {
  it('requires kebab-case slugs', () => {
    expect(importTopicSchema.safeParse({ slug: 'Work', name_vi: 'x' }).success).toBe(false);
    expect(importTopicSchema.safeParse({ slug: 'work_life', name_vi: 'x' }).success).toBe(false);
    expect(importTopicSchema.safeParse({ slug: '-work', name_vi: 'x' }).success).toBe(false);
    expect(importTopicSchema.safeParse({ slug: 'work-life-2', name_vi: 'x' }).success).toBe(true);
  });
});

describe('importLemmaSchema', () => {
  it('rejects a published/status field (all imports are draft)', () => {
    expect(importLemmaSchema.safeParse({ ...lemma, published: true }).success).toBe(false);
    expect(importLemmaSchema.safeParse({ ...lemma, status: 'published' }).success).toBe(false);
  });

  it('validates the CEFR enum', () => {
    expect(importLemmaSchema.safeParse({ ...lemma, cefr: 'B1' }).success).toBe(true);
    expect(importLemmaSchema.safeParse({ ...lemma, cefr: 'D1' }).success).toBe(false);
  });
});

describe('importPromptSchema', () => {
  it('accepts text_vi at the limit and rejects 501 chars', () => {
    expect(
      importPromptSchema.safeParse({
        ...prompt,
        text_vi: 'a'.repeat(CONTENT.PROMPT_TEXT_VI_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      importPromptSchema.safeParse({
        ...prompt,
        text_vi: 'a'.repeat(CONTENT.PROMPT_TEXT_VI_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it('requires 2–5 target headwords', () => {
    expect(importPromptSchema.safeParse({ ...prompt, target_headwords: ['one'] }).success).toBe(
      false,
    );
    expect(
      importPromptSchema.safeParse({ ...prompt, target_headwords: ['a', 'b', 'c', 'd', 'e', 'f'] })
        .success,
    ).toBe(false);
    expect(
      importPromptSchema.safeParse({ ...prompt, target_headwords: ['a', 'b', 'c', 'd', 'e'] })
        .success,
    ).toBe(true);
  });

  it('rejects duplicate target headwords after normalization', () => {
    expect(
      importPromptSchema.safeParse({ ...prompt, target_headwords: ['deadline', ' Deadline'] })
        .success,
    ).toBe(false);
  });

  it('rejects a published field (strict)', () => {
    expect(importPromptSchema.safeParse({ ...prompt, published: true }).success).toBe(false);
  });
});
