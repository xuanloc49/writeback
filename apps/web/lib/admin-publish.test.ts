import { describe, expect, it } from 'vitest';
import { lemmaPublishDisabled, promptPublishMessages } from './admin-publish';

describe('lemmaPublishDisabled', () => {
  it('blocks blank and whitespace example_en', () => {
    expect(lemmaPublishDisabled(null)).toBe(true);
    expect(lemmaPublishDisabled('  ')).toBe(true);
    expect(lemmaPublishDisabled('Send the file.')).toBe(false);
  });
});

describe('promptPublishMessages', () => {
  const published = [
    { id: 'l1', status: 'published' },
    { id: 'l2', status: 'published' },
  ];

  it('blocks unsaved-looking whitespace on the saved sample', () => {
    expect(
      promptPublishMessages({
        sampleEn: ' ',
        targetLemmaIds: ['l1', 'l2'],
        lemmas: published,
        lemmasMatchTopic: true,
      }),
    ).toEqual(['Xuất bản cần sample_en.']);
  });

  it('blocks fewer than two saved targets', () => {
    expect(
      promptPublishMessages({
        sampleEn: 'I will send it.',
        targetLemmaIds: ['l1'],
        lemmas: published,
        lemmasMatchTopic: true,
      }),
    ).toEqual(['Xuất bản cần 2–5 target.']);
  });

  it('treats a missing lemma as unpublished when the list matches the topic', () => {
    expect(
      promptPublishMessages({
        sampleEn: 'I will send it.',
        targetLemmaIds: ['l1', 'gone'],
        lemmas: published,
        lemmasMatchTopic: true,
      }),
    ).toEqual(['Xuất bản cần mọi target đã published.']);
  });

  it('does not false-flag unpublished when lemmas belong to another topic', () => {
    expect(
      promptPublishMessages({
        sampleEn: 'I will send it.',
        targetLemmaIds: ['l1', 'l2'],
        lemmas: [],
        lemmasMatchTopic: false,
      }),
    ).toEqual([]);
  });
});
