/**
 * QAPINDA — what people are actually searching for.
 *
 * WHY IT COUNTS OPENS, NOT SEARCHES
 * ---------------------------------
 * The obvious design records every term typed into the box. It is also the
 * wrong one, twice over.
 *
 * On volume: search runs on a debounce, so one person looking for "dönər" types
 * `dö`, `dön`, `dönə`, `dönər` and produces four writes for one intention. Every
 * search on the platform would cost several Firestore writes, forever, to build
 * a list of eight words.
 *
 * On meaning, which matters more: a term somebody typed and abandoned is a
 * search that FAILED. Offering it back to the next customer as a popular search
 * is recommending the exact query that did not work. A term somebody typed and
 * then opened a restaurant from is a search that WORKED — that is the one worth
 * suggesting, and it is what this records.
 *
 * So the client calls this once, when a result is opened, with the term that
 * produced it. Low volume, high signal, and the two are the same decision.
 *
 * WHY THE TERM IS MODERATED
 * -------------------------
 * These words are shown publicly, as chips, to every customer on the search
 * screen. That makes the collection a place where a stranger's typing reaches
 * other people's eyes — which is the definition of something that has to go
 * through the same filter as a review or a complaint. A platform whose search
 * suggestions can be seeded with abuse has published that abuse itself.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, now, FieldValue } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser } from '../lib/auth';
import { clean } from '../lib/moderation';
import { asObject, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { fold } from '../shared/search';

/** Long enough to mean something, short enough to render as a chip. */
const MIN_TERM = 3;
const MAX_TERM = 24;

/**
 * The stored key.
 *
 * Folded — Azerbaijani letters to ASCII, lower case — so that `Dönər`, `doner`
 * and `DÖNƏR` are one row and not three. The DISPLAY form is stored beside it,
 * taken from the first person who searched it, because a chip that reads
 * `doner` when the dish is `Dönər` looks like a mistake.
 */
function termKey(term: string): string {
  return fold(term).replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
}

/**
 * Records that a search led somewhere.
 *
 * Deliberately cheap to refuse: a term that is too short, too long, or masked
 * by the profanity filter is dropped silently with `ok: true`. Nothing on the
 * customer's screen depends on this succeeding, and an error banner on the way
 * into a restaurant would be a worse outcome than an uncounted search.
 */
export const recordSearchHit = onCall(
  guard('recordSearchHit', async (request) => {
    // A signed-in account, so the counts cannot be driven by an anonymous
    // script. The rate limit in `guard` bounds it further.
    await requireActiveUser(request);

    const data = asObject(request.data);
    const raw = requireString(data, 'term', { min: 1, max: 60 }).trim();

    if (raw.length < MIN_TERM || raw.length > MAX_TERM) return { ok: true, counted: false };

    // The same filter reviews and complaints go through. A refusal throws, and
    // is caught here rather than reported: the customer was opening a
    // restaurant, not submitting anything.
    let display: string;
    try {
      display = clean(raw).text.trim();
    } catch {
      return { ok: true, counted: false };
    }

    if (display !== raw) return { ok: true, counted: false };

    const key = termKey(raw);
    if (key.length < MIN_TERM) return { ok: true, counted: false };

    await db
      .collection('searchTerms')
      .doc(key)
      .set(
        {
          term: key,
          // First writer wins the spelling; `merge` leaves an existing one
          // alone, so one person typing in lower case cannot restyle a chip
          // thousands of people have already seen.
          display,
          count: FieldValue.increment(1),
          updatedAt: now(),
        },
        { merge: true },
      )
      .catch(() => undefined);

    return { ok: true, counted: true };
  }),
);

/**
 * Wipes a term. Super admin only — the escape hatch for a chip that should not
 * be on the screen, whatever the filter thought.
 */
export const removeSearchTerm = onCall(
  guard('removeSearchTerm', async (request) => {
    const { caller } = await requireActiveUser(request);
    if (caller.role !== 'SUPER_ADMIN') fail(AppErrorCode.FORBIDDEN);

    const data = asObject(request.data);
    const term = requireString(data, 'term', { min: 1, max: 60 });

    await db.collection('searchTerms').doc(termKey(term)).delete();
    return { ok: true };
  }),
);
