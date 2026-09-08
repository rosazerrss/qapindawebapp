/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — When a phone or email lock is real, and when it is a ghost.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * WHAT WENT WRONG
 * ---------------
 * `phoneIndex/{phone}` and `emailIndex/{email}` are what make "one person, one
 * account" true. They are claimed in the same transaction that creates
 * `users/{uid}`, and they are released by `anonymiseUser` when an account goes.
 *
 * That covers every path the code takes. It does not cover the path a person
 * takes: somebody opens the Firestore console and deletes `users/{uid}` by
 * hand. The user document is gone; the two index documents are still there,
 * still naming a uid that no longer exists. Registration then reads the lock,
 * sees a uid that is not the caller's, and refuses — for ever, to the real
 * owner of the number, with the sentence "this number is already registered".
 * There is no screen anywhere in the product that can clear it.
 *
 * It happened to this platform's own admin account.
 *
 * THE RULE THIS FILE STATES
 * -------------------------
 * A lock is only worth honouring while the account it names still claims it
 * back. Both halves have to agree:
 *
 *   the index says   phoneIndex/994501234567 → uid ABC
 *   and users/ABC    exists, is not anonymised, and its own phone
 *                    normalises to 994501234567
 *
 * If any of that is untrue the lock is a ghost — it protects nobody and blocks
 * somebody — and the number may be claimed again.
 *
 * WHY THIS IS NOT A WEAKENING OF THE ONE-ACCOUNT RULE
 * --------------------------------------------------
 * The rule exists to stop *two live accounts* sharing a number. Every check
 * below is about whether the first account is still live. A lock held by a real,
 * active user whose document still names that number is refused exactly as
 * before — that is the case the rule was written for, and it is untouched. What
 * is no longer refused is a lock held by nothing.
 *
 * And the caller cannot influence any of it: the holder document is read by the
 * server, inside the same transaction, from the uid written in the lock. A
 * client has no way to make `users/ABC` disappear.
 */

/**
 * What the server found at `users/{uid}` for the uid written in the lock.
 *
 * `null` means the document is not there at all — the console-deletion case.
 */
export type LockHolder = {
  accountStatus?: string | null;
  /** Normalised the same way the index key is. */
  phoneKey?: string | null;
  /** Normalised the same way the index key is. */
  emailKey?: string | null;
} | null;

/** The one status that means an account has been deliberately unwound. */
const ANONYMIZED = 'ANONYMIZED';

export type LockKind = 'PHONE' | 'EMAIL';

/**
 * Should this lock stop somebody registering?
 *
 * `false` — the lock is stale and may be taken over — in exactly four cases:
 *
 *  1. it names no uid at all (a half-written document);
 *  2. the account it names no longer exists;
 *  3. that account has been anonymised, so its identity fields were cleared
 *     and it is not going to sign in again;
 *  4. that account exists but its own phone/email is no longer this one — the
 *     person changed their address and the old lock was stranded.
 */
export function lockIsLive(input: {
  kind: LockKind;
  /** The document id of the index entry — already normalised. */
  lockKey: string;
  /** The uid written inside the lock document. */
  holderUid: string | null | undefined;
  /** `users/{holderUid}` as the server found it, or null if it is not there. */
  holder: LockHolder;
}): boolean {
  if (!input.holderUid) return false;
  if (!input.holder) return false;
  if (input.holder.accountStatus === ANONYMIZED) return false;

  const claimed = input.kind === 'PHONE' ? input.holder.phoneKey : input.holder.emailKey;
  if (!claimed) return false;

  return claimed === input.lockKey;
}

/** The mirror of the above, for code that reads better in the negative. */
export function lockIsStale(input: Parameters<typeof lockIsLive>[0]): boolean {
  return !lockIsLive(input);
}

/**
 * Why a stale lock was stale, for the audit entry.
 *
 * Written down because "the admin cleared a lock" is not a useful record six
 * months later; "the admin cleared a lock whose account had been deleted from
 * the console" is.
 */
export type StaleReason = 'NO_UID' | 'NO_ACCOUNT' | 'ANONYMISED' | 'MOVED_ON' | null;

export function staleReason(input: Parameters<typeof lockIsLive>[0]): StaleReason {
  if (!input.holderUid) return 'NO_UID';
  if (!input.holder) return 'NO_ACCOUNT';
  if (input.holder.accountStatus === ANONYMIZED) return 'ANONYMISED';

  const claimed = input.kind === 'PHONE' ? input.holder.phoneKey : input.holder.emailKey;
  if (!claimed || claimed !== input.lockKey) return 'MOVED_ON';

  return null;
}
