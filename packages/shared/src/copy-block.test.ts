import { describe, expect, it } from 'vitest';
import { isCopyBlocked, normalizeCopyBlock } from './copy-block.js';

describe('normalizeCopyBlock', () => {
  it('ignores punctuation, case and extra whitespace', () => {
    expect(normalizeCopyBlock('Deadline is   tomorrow!!')).toBe('deadline is tomorrow');
    expect(normalizeCopyBlock('“Deadline”, is tomorrow…')).toBe('deadline is tomorrow');
  });

  it('applies NFKC so full-width characters fold to ASCII', () => {
    expect(normalizeCopyBlock('Ｄｅａｄｌｉｎｅ　ｉｓ　ｔｏｍｏｒｒｏｗ！')).toBe(
      'deadline is tomorrow',
    );
  });

  it('preserves Vietnamese diacritics', () => {
    expect(normalizeCopyBlock('Hạn chót là ngày mai.')).toBe('hạn chót là ngày mai');
  });

  it('strips symbols such as currency and emoji', () => {
    expect(normalizeCopyBlock('Pay $5 now ✅')).toBe('pay 5 now');
  });

  it('returns an empty string for empty or punctuation-only input', () => {
    expect(normalizeCopyBlock('')).toBe('');
    expect(normalizeCopyBlock('   ')).toBe('');
    expect(normalizeCopyBlock('!!! ...')).toBe('');
  });
});

describe('isCopyBlocked', () => {
  it('blocks when the normalized sentence equals any reference', () => {
    expect(isCopyBlocked('Deadline is tomorrow!!', ['deadline is tomorrow'])).toBe(true);
    expect(
      isCopyBlocked('Deadline is tomorrow!!', ['Something else', 'deadline, is tomorrow']),
    ).toBe(true);
  });

  it('does not block different sentences or empty inputs', () => {
    expect(isCopyBlocked('The deadline is tomorrow', ['deadline is tomorrow'])).toBe(false);
    expect(isCopyBlocked('!!!', ['', '...'])).toBe(false);
    expect(isCopyBlocked('deadline', [])).toBe(false);
  });
});
