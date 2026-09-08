'use client';

/**
 * Where the bank sends the customer when a payment did not go through.
 *
 * The order still exists and is still unpaid, which is the useful thing to say:
 * nothing was lost, nothing was charged, and the way to try again is from the
 * order itself. A dead end here — "payment failed", full stop — is how people
 * end up placing the same order three times.
 *
 * Reuses the same screen as the success return, because the honest answer is
 * decided by the server's record of the payment, not by which URL the bank
 * chose to redirect to. A bank that sends somebody here after a payment that
 * actually cleared must not be able to tell them it failed.
 */

export { default } from '../success/page';
