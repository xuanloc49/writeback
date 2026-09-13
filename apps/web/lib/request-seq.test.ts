import { describe, expect, it } from 'vitest';
import {
  beginListRequest,
  commitListCursor,
  isLiveCursorGeneration,
  isLiveRequest,
  listRequestToken,
} from './request-seq';

describe('listRequestToken', () => {
  it('drops an earlier search after a newer one starts', () => {
    const seq = { current: 0 };
    const searchA = listRequestToken(seq, 'fresh');
    const searchB = listRequestToken(seq, 'fresh');
    expect(isLiveRequest(seq, searchA)).toBe(false);
    expect(isLiveRequest(seq, searchB)).toBe(true);
  });

  it('keeps load-more on the same generation as the current search', () => {
    const seq = { current: 0 };
    const search = listRequestToken(seq, 'fresh');
    const more = listRequestToken(seq, 'more');
    expect(more).toBe(search);
    expect(isLiveRequest(seq, more)).toBe(true);
  });

  it('drops load-more from a search that was superseded', () => {
    const seq = { current: 0 };
    listRequestToken(seq, 'fresh');
    const moreFromA = listRequestToken(seq, 'more');
    listRequestToken(seq, 'fresh');
    expect(isLiveRequest(seq, moreFromA)).toBe(false);
  });
});

describe('isLiveCursorGeneration', () => {
  it('allows load-more for the search that produced the cursor', () => {
    const seq = { current: 0 };
    const search = listRequestToken(seq, 'fresh');
    expect(isLiveCursorGeneration(seq, search)).toBe(true);
  });

  it('rejects load-more after a newer search starts even if more reuses the new seq', () => {
    const seq = { current: 0 };
    const searchA = listRequestToken(seq, 'fresh');
    listRequestToken(seq, 'fresh');
    const moreAfterB = listRequestToken(seq, 'more');
    expect(isLiveRequest(seq, moreAfterB)).toBe(true);
    expect(isLiveCursorGeneration(seq, searchA)).toBe(false);
  });

  it('rejects a cursor from before the first completed search', () => {
    const seq = { current: 0 };
    expect(isLiveCursorGeneration(seq, 0)).toBe(false);
  });
});

describe('beginListRequest', () => {
  it('does not start load-more after a newer search has invalidated the cursor', () => {
    const seq = { current: 0 };
    const cursorGeneration = { current: 0 };
    const searchA = beginListRequest(seq, 'fresh', cursorGeneration);
    expect(searchA).not.toBeNull();
    expect(commitListCursor(seq, searchA as number, cursorGeneration)).toBe(true);

    beginListRequest(seq, 'fresh', cursorGeneration);
    expect(beginListRequest(seq, 'more', cursorGeneration)).toBeNull();
  });
});
