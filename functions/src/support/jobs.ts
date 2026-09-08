/**
 * QAPINDA — Scheduled work for support.
 *
 * One job, and it deletes things, so it is worth being explicit about what it
 * may and may not touch.
 *
 * WHAT IT DELETES
 * ---------------
 * `supportFeedback/{ticketId}` entries whose `expiresAt` has passed. That is
 * the whole of it. The entry is the prompt a customer sees in Ayarlar → Geri
 * bildirim after an operator closed their ticket, and the owner asked for it to
 * be temporary: *"orada çox qalmasın mence bir müddet sonra silinsin"*. The
 * period is `SUPPORT_FEEDBACK_RETENTION_DAYS` in `shared/feedback.ts`.
 *
 * WHAT IT MUST NEVER DELETE, AND WHY THE DISTINCTION IS LOAD-BEARING
 * ------------------------------------------------------------------
 * The standing rule in this codebase is that financial and legal records are
 * not deleted. A support ticket is not a financial record — but it *is* the
 * account of a dispute, it can be the only written trace of a refund argument,
 * and `SupportTicket` says in its own comment that a closed ticket is retained
 * forever. So this job does not touch `supportTickets`, its messages, the order
 * the ticket points at, or anything else. It deletes one document per expired
 * entry and nothing beside it.
 *
 * The rating is the one thing a customer adds here, and it is copied onto the
 * ticket by `rateSupportFeedback` at the moment it is given — before this job
 * can ever run against that entry. So there is nothing on an expiring entry
 * that is not already held somewhere retained, which is the condition that
 * makes deleting it safe. Anything added to `SupportFeedback` later has to be
 * held to the same test, and if the answer is ever in doubt the rule from the
 * brief applies: keep the ticket, delete only the entry.
 *
 * Bounded like every other job here: a page at a time, so a backlog cannot turn
 * into a function that times out and never catches up.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { db, Timestamp, REGION } from '../lib/admin';
import { COLLECTIONS } from '../shared/collections';

/** One page of deletions. Well inside a batch's 500-write limit. */
const BATCH_SIZE = 200;

/**
 * Sweeps expired Geri bildirim entries.
 *
 * Hourly rather than daily: the screen already hides an entry the moment it
 * expires — `supportFeedbackExpired` is read on both sides — but "hidden" and
 * "gone" should not be more than an hour apart, or the promise made to the
 * customer is only true of what they can see.
 */
export const purgeExpiredSupportFeedback = onSchedule(
  { schedule: 'every 60 minutes', region: REGION, timeoutSeconds: 120 },
  async () => {
    const expired = await db
      .collection(COLLECTIONS.supportFeedback)
      .where('expiresAt', '<=', Timestamp.now())
      .limit(BATCH_SIZE)
      .get();

    if (expired.empty) return;

    const batch = db.batch();
    for (const doc of expired.docs) batch.delete(doc.ref);
    await batch.commit();

    // Worth a line in the log: a number that never falls to zero means the page
    // size is below the rate entries are being created, which is a thing to fix
    // rather than a thing to discover from a growing collection.
    logger.info('purged expired support feedback', { deleted: expired.size });
  },
);
