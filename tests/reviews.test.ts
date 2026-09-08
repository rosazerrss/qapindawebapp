import { describe, expect, it } from 'vitest';

import { displayName, foldRating, tagsForRating, POSITIVE_TAGS, NEGATIVE_TAGS } from '../shared/reviews';

describe('displayName', () => {
  it('shortens a surname to an initial', () => {
    expect(displayName('Aysel Məmmədova')).toBe('Aysel M.');
  });

  it('keeps a single name whole — there is nothing to shorten', () => {
    expect(displayName('Aysel')).toBe('Aysel');
  });

  it('uses the last part, not the second, for a three-part name', () => {
    expect(displayName('Aysel Nurlan qızı Məmmədova')).toBe('Aysel M.');
  });

  it('never returns an empty label', () => {
    expect(displayName('   ')).toBe('—');
  });
});

describe('foldRating', () => {
  it('starts an average from nothing', () => {
    expect(foldRating({ average: 0, count: 0 }, 5)).toEqual({ average: 5, count: 1 });
  });

  it('rounds to two decimals rather than storing binary noise', () => {
    const folded = foldRating({ average: 4, count: 2 }, 5);
    expect(folded).toEqual({ average: 4.33, count: 3 });
  });

  it('is stable over many folds', () => {
    let state = { average: 0, count: 0 };
    for (const rating of [5, 4, 5, 3, 5]) state = foldRating(state, rating);
    expect(state.count).toBe(5);
    expect(state.average).toBeCloseTo(4.4, 1);
  });
});

describe('tagsForRating', () => {
  it('offers praise at four stars and above', () => {
    expect(tagsForRating(4)).toBe(POSITIVE_TAGS);
    expect(tagsForRating(5)).toBe(POSITIVE_TAGS);
  });

  it('offers complaints below four', () => {
    expect(tagsForRating(3)).toBe(NEGATIVE_TAGS);
    expect(tagsForRating(1)).toBe(NEGATIVE_TAGS);
  });
});
