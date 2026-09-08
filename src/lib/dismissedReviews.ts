'use client';

/**
 * QAPINDA — Which "rate your order" nudges this person has already waved away.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * The card at the top of Sifarişlərim asks for a review of every delivered
 * order that has not got one. Without a way to close it, somebody who does not
 * want to review their dinner is asked about that same dinner on every visit,
 * for ever. That is not a nudge, it is nagging, and the usual outcome is that
 * the person stops reading the card at all — including the times it is asking
 * about something they would happily have rated.
 *
 * So the X remembers. The dismissed order ids are kept, and a new delivered
 * order still brings the card back — because that is a new question rather than
 * the one already answered.
 *
 * WHY IT IS NOT ON THE ACCOUNT
 * ----------------------------
 * A field, a security rule and a write, for a preference about a banner.
 * Losing it when somebody changes phone means being asked once more about an
 * order they had waved away, which is not a failure worth engineering against.
 *
 * EVERY READ AND WRITE IS WRAPPED
 * -------------------------------
 * `localStorage` throws — not returns null, THROWS — in a private window with
 * site data blocked, and on a device out of storage. An unguarded read here
 * would take down the whole orders page over a dismissed banner.
 */

const KEY = 'qapinda.dismissedReviews';

/**
 * How many ids to keep.
 *
 * Enough that a regular customer never sees a dismissed order return, small
 * enough that the value cannot grow without bound in a browser that never
 * clears it. The newest are kept: an id from two hundred orders ago is about
 * an order whose review window closed long since.
 */
const MAX_REMEMBERED = 200;

export function dismissedReviews(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();

    const parsed: unknown = JSON.parse(raw);
    // Anything but an array of strings is treated as absent rather than
    // repaired: this is a cache of banner dismissals, and the cost of getting
    // it wrong is one extra prompt.
    if (!Array.isArray(parsed)) return new Set();

    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

export function rememberDismissedReviews(orderIds: string[]): void {
  if (orderIds.length === 0) return;

  try {
    // The new ones last, so the trim below drops the oldest.
    const merged = [...dismissedReviews(), ...orderIds];
    const kept = [...new Set(merged)].slice(-MAX_REMEMBERED);
    window.localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Storage refused. The card will ask again next visit, which is the old
    // behaviour and is not worth breaking a page over.
  }
}
