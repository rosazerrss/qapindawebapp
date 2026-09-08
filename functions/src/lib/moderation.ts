/**
 * Moderation, on the write path.
 *
 * The owner's rule is absolute — no swear word reaches another person, in any
 * language — and a rule enforced in a browser is a rule enforced by whoever
 * has not opened devtools. So every callable that stores text a second person
 * will read runs it through here first: support messages and subjects,
 * complaint details, review comments, a restaurant's reply to a review, order
 * notes, cancellation notes and address notes.
 *
 * The filter itself lives in `shared/profanity.ts`, so the browser can warn
 * somebody *before* they press send using exactly the same word list. That
 * warning is a courtesy. This is the boundary.
 *
 * WHAT COMES BACK
 * ---------------
 * `text` is what may be stored: the offending word replaced by `***`, the rest
 * of the message untouched. `filtered` is worth writing onto the document
 * beside it — an operator reading a sentence with a gap in it should be able
 * to tell moderation from a typo. The original words are deliberately not
 * returned and never stored anywhere: keeping a clean copy of the abuse would
 * defeat the point of removing it.
 *
 * A message that is *nothing but* profanity has nothing left to deliver, so
 * `clean` refuses it outright rather than storing an empty bubble.
 */

import { fail } from './errors';
import { AppErrorCode } from '../shared/errors';
import { filterProfanity } from '../shared/profanity';

export interface Moderated {
  /** Safe to store and to show. */
  text: string;
  /** True when something was masked. Store it next to the text. */
  filtered: boolean;
}

/**
 * Masks any profanity, or refuses text that was nothing else.
 *
 * The refusal is a real error code with a sentence of its own in all three
 * dictionaries, because "your message was not sent" with no reason is how a
 * person ends up sending it four more times.
 */
export function clean(value: string): Moderated {
  const result = filterProfanity(value);
  if (result.onlyProfanity) fail(AppErrorCode.PROFANITY_ONLY);
  return { text: result.text, filtered: result.filtered };
}

/**
 * The same, for a field that may be absent.
 *
 * An empty note is not a moderation decision, so null passes straight through
 * rather than becoming an empty string somewhere down the line.
 */
export interface ModeratedOptional {
  text: string | null;
  filtered: boolean;
}

export function cleanOptional(value: string | null | undefined): ModeratedOptional {
  if (value === undefined) return { text: null, filtered: false };
  if (value === null || value === '') return { text: value, filtered: false };
  return clean(value);
}
