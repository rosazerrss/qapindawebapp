/**
 * QAPINDA — "Geri bildirim": what a customer sees after a ticket is closed.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The owner asked for it in one sentence: "operator müşteri deteyini
 * bağladıqdan sonra hemin yere düşsün ve orada çox qalmasın mence bir müddet
 * sonra silinsin". When an operator closes a customer's support ticket, an
 * entry lands in the customer's Ayarlar → Geri bildirim so they can read how it
 * ended and say whether it was handled well — and then it goes away again.
 *
 * IT IS TRANSIENT, AND THE TICKET IS NOT
 * --------------------------------------
 * These two facts have to be held apart or the retention rule becomes a data
 * loss bug. The SUPPORT TICKET is a record: it is retained, it is never
 * deleted, and `SupportTicket.closedBy/closedAt` is the account of how the
 * problem ended. This entry is a *prompt* pointing at that record — a subject
 * line, a date, and a place to leave a rating — and it is the prompt that
 * expires, not the record.
 *
 * So the rating a person leaves is copied onto the ticket at the moment they
 * leave it, before anything here can expire. Deleting an entry afterwards
 * cannot lose it. If an entry ever carried something the ticket did not, the
 * rule is the one in the brief: keep the ticket, delete only the entry.
 *
 * WHY THE PERIOD IS A NAMED CONSTANT AND THE DELETION IS A JOB
 * -----------------------------------------------------------
 * A screen that simply hides old entries is a screen that lies: the documents
 * go on accumulating, the customer's "it disappears" is not true, and one day
 * somebody exports the collection. `purgeExpiredSupportFeedback` in
 * `functions/src/support/jobs.ts` actually deletes them, on the clock, and the
 * period lives here so the job, the screen and the tests cannot disagree about
 * how long "a while" is.
 */

/**
 * How long a closed ticket stays in Geri bildirim.
 *
 * Fourteen days. Long enough that somebody who only opens the app at weekends
 * still finds it and can still rate it; short enough that the list is a list of
 * what just happened rather than a year of old complaints. "çox qalmasın" —
 * it should not stay there long — is what this number is an answer to.
 */
export const SUPPORT_FEEDBACK_RETENTION_DAYS = 14;

/** The same period in milliseconds, for the two places that do arithmetic. */
export const SUPPORT_FEEDBACK_RETENTION_MS = SUPPORT_FEEDBACK_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** When an entry created at `closedAtMs` stops being shown and is deleted. */
export function supportFeedbackExpiresAt(closedAtMs: number): number {
  return closedAtMs + SUPPORT_FEEDBACK_RETENTION_MS;
}

/**
 * Whether an entry is past its period.
 *
 * Used by the screen as well as by the job, on purpose: the job runs on a
 * schedule, so between two runs there is always a window in which an expired
 * entry still exists. The screen must not show it during that window, or the
 * promise "it disappears after two weeks" is kept only approximately.
 */
export function supportFeedbackExpired(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs <= nowMs;
}

/** Whole days left, floored at zero. What the screen tells the customer. */
export function supportFeedbackDaysLeft(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / (24 * 60 * 60 * 1000)));
}

/** The stars. Five of them, because everybody already knows what five means. */
export const SUPPORT_FEEDBACK_MIN_RATING = 1;
export const SUPPORT_FEEDBACK_MAX_RATING = 5;

/** The longest comment. A sentence or two — this is not a second ticket. */
export const SUPPORT_FEEDBACK_COMMENT_MAX = 300;

/** Whether a value is a rating this system accepts. Asked on both sides. */
export function isSupportFeedbackRating(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= SUPPORT_FEEDBACK_MIN_RATING &&
    value <= SUPPORT_FEEDBACK_MAX_RATING
  );
}
