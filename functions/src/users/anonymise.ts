/**
 * QAPINDA — Erasing a person without erasing the books.
 *
 * WHY THIS IS ONE FUNCTION AND NOT TWO
 * ------------------------------------
 * Two callables end an account: the customer's own "hesabımı sil" and the
 * admin's `anonymiseUser`. They differ in who is allowed to ask and in nothing
 * else — and the part they share is the part that must not be got wrong twice.
 * A second copy that forgot to release the phone lock would recreate, by hand,
 * exactly the bug that locked this platform's own admin out of registration.
 *
 * WHAT GOES AND WHAT STAYS
 * ------------------------
 * What goes: the name, the phone, the email, the saved addresses, the Firebase
 * Auth credential, and both index locks.
 *
 * What stays: the orders. Every one of them, with no name on it. A restaurant's
 * own books and the tax record have to balance after a customer leaves, and a
 * marketplace that deletes an invoice because the buyer asked is a marketplace
 * whose restaurants cannot file their accounts. This is the standard answer —
 * anonymise, do not erase — and it is why the account document survives with
 * `ANONYMIZED` on it rather than being deleted outright: the orders point at a
 * uid, and that uid has to resolve to something.
 *
 * THE LOCKS ARE RELEASED, AND THAT IS THE POINT
 * ---------------------------------------------
 * `phoneIndex` and `emailIndex` are what make "one customer, one account" true.
 * Leaving them behind would mean a person who deleted their account could never
 * register again with their own telephone number — and could never be told why,
 * because "this number is already registered" would be pointing at an account
 * that no longer exists in any meaningful sense. `registerAccount` now heals
 * that case by itself, but healing a mess is not a reason to make one.
 */

import { logger } from 'firebase-functions/v2';

import { db, auth, now } from '../lib/admin';
import { writeAudit } from '../lib/audit';
import { COLLECTIONS, paths } from '../shared/collections';
import { AccountStatus, AuditAction, UserRole } from '../shared/enums';
import type { User } from '../shared/models';

/** What a deleted account's name reads as everywhere it still appears. */
export const ANONYMOUS_NAME = 'Silinmiş istifadəçi';

/**
 * Anonymises one account.
 *
 * The caller decides WHO may do this and WHETHER the preconditions are met;
 * this decides what "deleted" means. Safe to run twice: an account already
 * anonymised has no locks left to release and its phone is already the
 * `deleted:` placeholder, so a retried request is an expensive no-op rather
 * than a second, different outcome.
 */
export async function anonymiseAccount(input: {
  uid: string;
  target: User;
  actorId: string;
  actorRole: UserRole;
  reason: string;
}): Promise<void> {
  const targetRef = db.doc(paths.user(input.uid));
  const batch = db.batch();

  batch.update(targetRef, {
    fullName: ANONYMOUS_NAME,
    // A placeholder rather than null, because `phone` is read in a hundred
    // places that expect a string — and prefixed, because `anonymiseAccount`
    // and `lockIsLive` both test for exactly this prefix to know that a phone
    // is not a phone.
    phone: `deleted:${input.uid}`,
    email: null,
    phoneVerified: false,
    emailVerified: false,
    accountStatus: AccountStatus.ANONYMIZED,
    linkedProviders: [],
    defaultAddressId: null,
    updatedAt: now(),
  });

  // The locks. The single most important two lines in this file — see the note
  // at the top about what leaving them behind costs.
  if (input.target.phone && !input.target.phone.startsWith('deleted:')) {
    batch.delete(db.doc(paths.phoneLock(input.target.phone)));
  }
  if (input.target.email) batch.delete(db.doc(paths.emailLock(input.target.email)));

  // The saved addresses go entirely. They are the most identifying thing on the
  // account — a street, a flat number, a name at a door, a telephone — and
  // nothing in the books needs them: every order already carries its own frozen
  // snapshot of the address it went to, which is what an audit or a dispute
  // actually reads.
  const addresses = await db.collection(paths.userAddresses(input.uid)).get();
  for (const doc of addresses.docs) batch.delete(doc.ref);

  /*
   * The favourites, for the same reason.
   *
   * A shortlist of restaurants is not financial and nothing in the books reads
   * it — it is only a record of what this person liked, attached to a uid that
   * still exists. It was being left behind, so a "deleted" account kept a list
   * of its owner's tastes for ever.
   */
  const favourites = await db.collection(paths.userFavourites(input.uid)).get();
  for (const doc of favourites.docs) batch.delete(doc.ref);

  /*
   * AND THE DEVICES. This one is not tidiness — it is a live channel.
   *
   * A push token is a permanent address for a phone. Left behind, a notification
   * written for this uid by any later job would still be DELIVERED: a banner on
   * a real handset belonging to somebody who deleted their account and was told
   * their data was gone. Deleting the account's rows here closes every device it
   * ever registered, not merely the one it happened to be signed in on.
   */
  const devices = await db
    .collection(COLLECTIONS.pushTokens)
    .where('userId', '==', input.uid)
    .get();
  for (const doc of devices.docs) batch.delete(doc.ref);

  await batch.commit();

  /*
   * The Firebase Auth credential, last and separately.
   *
   * Last because it is the one step that cannot be undone and cannot be part of
   * the batch. Separately, and swallowing its error, because the Firestore work
   * above has already committed: an account whose data is anonymised but whose
   * credential survived is recoverable by an admin, while a thrown error here
   * would report failure for work that in fact succeeded, and the caller would
   * try again against a half-erased account.
   */
  await auth.deleteUser(input.uid).catch((error) => {
    logger.warn('auth credential not deleted', { uid: input.uid, error: String(error) });
  });

  await writeAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: AuditAction.USER_STATUS_CHANGED,
    targetType: 'user',
    targetId: input.uid,
    oldValue: { accountStatus: input.target.accountStatus },
    newValue: { accountStatus: AccountStatus.ANONYMIZED },
    reason: input.reason,
  });

  logger.info('account anonymised', { uid: input.uid, by: input.actorId });
}
