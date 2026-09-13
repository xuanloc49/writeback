import { CONTENT } from '@writeback/shared';
import {
  isBlank,
  lemmaPublishReasons,
  promptPublishReasons,
  PUBLISH_REASONS,
  type PromptPublishTarget,
} from './publish-rules';

const TOPIC = 'topic-a';

function target(
  overrides: Partial<PromptPublishTarget> & { topicId?: string } = {},
): PromptPublishTarget {
  return {
    status: 'published',
    deletedAt: null,
    topicId: TOPIC,
    ...overrides,
  };
}

describe('isBlank', () => {
  it('treats null, undefined, empty, and whitespace as blank', () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank('')).toBe(true);
    expect(isBlank('  \n')).toBe(true);
    expect(isBlank('ok')).toBe(false);
  });
});

describe('lemmaPublishReasons', () => {
  it('blocks whitespace-only example_en', () => {
    expect(lemmaPublishReasons({ exampleEn: '   ' })).toEqual([PUBLISH_REASONS.EXAMPLE_EN_MISSING]);
  });

  it('allows a non-blank example', () => {
    expect(lemmaPublishReasons({ exampleEn: 'Please send the file.' })).toEqual([]);
  });
});

describe('promptPublishReasons', () => {
  const prompt = { sampleEn: 'I will send it.', topicId: TOPIC };
  const two = [target(), target({ topicId: TOPIC })];

  it('blocks blank sample_en', () => {
    expect(promptPublishReasons({ sampleEn: ' \t', topicId: TOPIC }, two)).toEqual([
      PUBLISH_REASONS.SAMPLE_EN_MISSING,
    ]);
  });

  it('blocks fewer than min targets', () => {
    expect(promptPublishReasons(prompt, [target()])).toEqual([PUBLISH_REASONS.TARGETS_COUNT]);
  });

  it('blocks more than max targets', () => {
    const tooMany = Array.from({ length: CONTENT.PROMPT_TARGETS_MAX + 1 }, () => target());
    expect(promptPublishReasons(prompt, tooMany)).toEqual([PUBLISH_REASONS.TARGETS_COUNT]);
  });

  it('blocks draft or soft-deleted targets', () => {
    expect(promptPublishReasons(prompt, [target(), target({ status: 'draft' })])).toEqual([
      PUBLISH_REASONS.TARGET_NOT_PUBLISHED,
    ]);
    expect(
      promptPublishReasons(prompt, [target(), target({ deletedAt: new Date('2026-01-01') })]),
    ).toEqual([PUBLISH_REASONS.TARGET_NOT_PUBLISHED]);
  });

  it('blocks a target from another topic', () => {
    expect(promptPublishReasons(prompt, [target(), target({ topicId: 'other' })])).toEqual([
      PUBLISH_REASONS.TARGET_CROSS_TOPIC,
    ]);
  });

  it('returns every matching reason together', () => {
    expect(
      promptPublishReasons({ sampleEn: null, topicId: TOPIC }, [
        target({ status: 'draft', topicId: 'other' }),
      ]),
    ).toEqual([
      PUBLISH_REASONS.SAMPLE_EN_MISSING,
      PUBLISH_REASONS.TARGETS_COUNT,
      PUBLISH_REASONS.TARGET_NOT_PUBLISHED,
      PUBLISH_REASONS.TARGET_CROSS_TOPIC,
    ]);
  });

  it('allows a valid published prompt', () => {
    expect(promptPublishReasons(prompt, two)).toEqual([]);
  });
});
