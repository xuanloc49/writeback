/** Token for in-flight list fetches. A new search/filter bumps; load-more reuses. */

export function listRequestToken(seq: { current: number }, mode: 'fresh' | 'more'): number {
  if (mode === 'fresh' || seq.current === 0) {
    seq.current += 1;
  }
  return seq.current;
}

export function isLiveRequest(seq: { current: number }, token: number): boolean {
  return token === seq.current;
}

/** Cursor from search A is not valid after search B has started (seq moved on). */
export function isLiveCursorGeneration(
  seq: { current: number },
  cursorGeneration: number,
): boolean {
  return cursorGeneration > 0 && cursorGeneration === seq.current;
}

export function beginListRequest(
  seq: { current: number },
  mode: 'fresh' | 'more',
  cursorGeneration: { current: number },
): number | null {
  if (mode === 'more' && !isLiveCursorGeneration(seq, cursorGeneration.current)) {
    return null;
  }
  const token = listRequestToken(seq, mode);
  if (mode === 'fresh') {
    cursorGeneration.current = 0;
  }
  return token;
}

export function commitListCursor(
  seq: { current: number },
  token: number,
  cursorGeneration: { current: number },
): boolean {
  if (!isLiveRequest(seq, token)) {
    return false;
  }
  cursorGeneration.current = token;
  return true;
}
