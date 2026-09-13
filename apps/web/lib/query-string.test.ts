import { describe, expect, it } from 'vitest';
import { withQuery } from './query-string';

describe('withQuery', () => {
  it('omits empty values and skips the question mark when nothing remains', () => {
    expect(withQuery('/admin/topics', { q: '', status: undefined })).toBe('/admin/topics');
  });

  it('appends defined filters in insertion order', () => {
    expect(
      withQuery('/admin/lemmas', { status: 'draft', q: 'overtime', includedInFree: 'true' }),
    ).toBe('/admin/lemmas?status=draft&q=overtime&includedInFree=true');
  });

  it('keeps the string false for includedInFree', () => {
    expect(withQuery('/admin/lemmas', { includedInFree: 'false' })).toBe(
      '/admin/lemmas?includedInFree=false',
    );
  });
});
