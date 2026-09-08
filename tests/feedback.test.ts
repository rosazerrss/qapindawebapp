import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  SUPPORT_FEEDBACK_MAX_RATING,
  SUPPORT_FEEDBACK_MIN_RATING,
  SUPPORT_FEEDBACK_RETENTION_DAYS,
  SUPPORT_FEEDBACK_RETENTION_MS,
  isSupportFeedbackRating,
  supportFeedbackDaysLeft,
  supportFeedbackExpired,
  supportFeedbackExpiresAt,
} from '../shared/feedback';

/**
 * Geri bildirim, and the two promises it makes.
 *
 * The first is to the customer: an entry appears when their ticket is closed
 * and goes away again after a set period. The second is to everybody else: the
 * TICKET is a record and is never deleted, and neither is anything financial.
 * A retention rule that quietly took a support ticket with it would be a data
 * loss bug wearing a feature's clothes, so the second promise is asserted
 * against the source of the job that does the deleting.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-31T12:00:00.000Z');

describe('the retention period', () => {
  it('is a named constant, in days and in milliseconds, and they agree', () => {
    expect(SUPPORT_FEEDBACK_RETENTION_DAYS).toBeGreaterThan(0);
    expect(SUPPORT_FEEDBACK_RETENTION_MS).toBe(SUPPORT_FEEDBACK_RETENTION_DAYS * DAY_MS);
  });

  it('expires exactly that far after the ticket was closed', () => {
    expect(supportFeedbackExpiresAt(NOW)).toBe(NOW + SUPPORT_FEEDBACK_RETENTION_MS);
  });

  it('is still shown the day before, and gone the moment it is due', () => {
    const expires = supportFeedbackExpiresAt(NOW);

    expect(supportFeedbackExpired(expires, NOW)).toBe(false);
    expect(supportFeedbackExpired(expires, expires - 1)).toBe(false);
    // On the boundary it is gone: an entry that is "expired" and still on
    // screen is the state that makes the promise untrue.
    expect(supportFeedbackExpired(expires, expires)).toBe(true);
    expect(supportFeedbackExpired(expires, expires + DAY_MS)).toBe(true);
  });

  it('counts down in whole days and never goes negative', () => {
    const expires = supportFeedbackExpiresAt(NOW);

    expect(supportFeedbackDaysLeft(expires, NOW)).toBe(SUPPORT_FEEDBACK_RETENTION_DAYS);
    expect(supportFeedbackDaysLeft(expires, expires - DAY_MS)).toBe(1);
    expect(supportFeedbackDaysLeft(expires, expires)).toBe(0);
    expect(supportFeedbackDaysLeft(expires, expires + 5 * DAY_MS)).toBe(0);
  });
});

describe('a rating', () => {
  it('is a whole number inside the range and nothing else', () => {
    for (let value = SUPPORT_FEEDBACK_MIN_RATING; value <= SUPPORT_FEEDBACK_MAX_RATING; value += 1) {
      expect(isSupportFeedbackRating(value)).toBe(true);
    }

    for (const value of [0, 6, -1, 3.5, '4', null, undefined, NaN, Infinity, {}]) {
      expect(isSupportFeedbackRating(value), `${String(value)} should be refused`).toBe(false);
    }
  });
});

describe('what the sweep is allowed to delete', () => {
  const job = readFileSync('functions/src/support/jobs.ts', 'utf8');

  it('deletes feedback entries and only feedback entries', () => {
    expect(job).toContain('COLLECTIONS.supportFeedback');

    // The standing rule: financial and legal records are not deleted, and a
    // closed support ticket is the account of a dispute. A `delete` reaching
    // any other collection from this job fails here.
    for (const forbidden of [
      'COLLECTIONS.supportTickets',
      'COLLECTIONS.orders',
      'COLLECTIONS.ledgerEntries',
      'COLLECTIONS.settlements',
      'COLLECTIONS.complaints',
      'COLLECTIONS.payments',
    ]) {
      expect(job, `the sweep must never touch ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('sweeps by expiry and takes a bounded page at a time', () => {
    expect(job).toContain("where('expiresAt', '<=', Timestamp.now())");
    expect(job).toContain('.limit(BATCH_SIZE)');
  });
});

describe('the rating survives the entry being deleted', () => {
  const chat = readFileSync('functions/src/support/chat.ts', 'utf8');

  it('is written onto the retained ticket in the same transaction', () => {
    const rate = chat.slice(chat.indexOf('export const rateSupportFeedback'));

    // Both writes, and the ticket one is what makes the deletion safe: the
    // entry expires, the ticket does not.
    expect(rate).toContain('supportRating');
    expect(rate).toContain('paths.supportTicket(');
    expect(rate).toContain('runTransaction');
  });

  it('reads everything before it writes anything', () => {
    const rate = chat.slice(
      chat.indexOf('export const rateSupportFeedback'),
    );
    const firstWrite = rate.indexOf('transaction.update(feedbackRef');
    const lastRead = rate.lastIndexOf('await transaction.get(');

    expect(lastRead).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(lastRead);
  });
});
