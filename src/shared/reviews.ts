/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Reviews.
 *
 * WHO MAY REVIEW
 * --------------
 * Only the person whose order it was, only once, and only after the food
 * actually arrived. This is not enforced by a check that could be forgotten: a
 * review document's id *is* the order's id, so writing one requires naming a
 * real order, and writing a second one collides with the first.
 *
 * WHY TAGS FIRST
 * --------------
 * Most people will not type a sentence, but almost everyone will tap "Yemək
 * dadlı idi". Tags give a restaurant something usable from the 90% who never
 * write prose, and they are a closed list — so they can be counted, translated,
 * and cannot contain a phone number or an insult.
 *
 * The comment box stays, optional, for the people who do want to write.
 */

/** Tags offered for a happy review (4–5 stars). */
export const POSITIVE_TAGS = [
  'TASTY',
  'FAST',
  'HOT',
  'GOOD_PACKAGING',
  'POLITE_COURIER',
  'GOOD_VALUE',
] as const;

/** Tags offered for an unhappy one (1–3 stars). */
export const NEGATIVE_TAGS = [
  'LATE',
  'COLD',
  'WRONG_ITEM',
  'MISSING_ITEM',
  'SMALL_PORTION',
  'PACKAGING_DAMAGED',
] as const;

export type ReviewTag = (typeof POSITIVE_TAGS)[number] | (typeof NEGATIVE_TAGS)[number];

export const ALL_REVIEW_TAGS: readonly string[] = [...POSITIVE_TAGS, ...NEGATIVE_TAGS];

/** Which set of chips to show for a given star count. */
export function tagsForRating(rating: number): readonly string[] {
  return rating >= 4 ? POSITIVE_TAGS : NEGATIVE_TAGS;
}

export const MAX_REVIEW_TAGS = 4;
export const MAX_REVIEW_COMMENT = 500;
export const MAX_REVIEW_REPLY = 500;

/**
 * How long after delivery a review may still be written.
 *
 * Long enough that somebody who ordered on Friday can answer on Monday, short
 * enough that a review still describes a meal the kitchen remembers cooking.
 */
export const REVIEW_WINDOW_DAYS = 30;

/**
 * "Aysel Məmmədova" → "Aysel M."
 *
 * A review is public. The platform promised never to display a customer's full
 * legal name, and this is the function that keeps that promise — it lives in
 * shared code so the server and the screen can never disagree about it.
 */
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

/**
 * Folding one more rating into a running average.
 *
 * Kept here rather than written inline in the function so the arithmetic that
 * decides a restaurant's public score exists in exactly one place, with a test
 * against it.
 */
export function foldRating(
  current: { average: number; count: number },
  rating: number,
): { average: number; count: number } {
  const count = current.count + 1;
  // Rounded to two decimals: a score is displayed as 4.7, and storing
  // 4.699999999999999 invites two screens disagreeing about the last digit.
  const average = Math.round(((current.average * current.count + rating) / count) * 100) / 100;
  return { average, count };
}
