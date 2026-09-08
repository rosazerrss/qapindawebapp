/**
 * QAPINDA — a person editing their own name, and an admin moving a number.
 *
 * TWO THINGS THAT LOOK ALIKE AND ARE NOT
 * --------------------------------------
 * Changing your display name is a preference. Changing your telephone number is
 * changing your identity: the number is what Firebase signs you in with, what
 * the one-account rule is built on, and what the coupon and cancellation limits
 * are counted against. So the first is self-service and the second is not.
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, auth, now } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { clean } from '../lib/moderation';
import { requireActiveUser, requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { asObject, requirePhone, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { AuditAction, UserRole } from '../shared/enums';
import { normalisePhoneKey, paths } from '../shared/collections';
import { Permission } from '../shared/permissions';
import type { User } from '../shared/models';

/** Long enough for a name and a surname; short enough for a printed ticket. */
const NAME_MIN = 2;
const NAME_MAX = 80;

/**
 * The customer's own name.
 *
 * WHY THIS IS A CALLABLE AND NOT A FIRESTORE WRITE
 * ------------------------------------------------
 * `fullName` used to be in the security rule's list of fields a person may
 * write to their own document, alongside `locale` and `defaultAddressId`. For
 * those two that is right — they are a language and a pointer, and a nonsense
 * value only inconveniences the person who wrote it.
 *
 * A name is different, because it LEAVES the account. It is printed on the
 * kitchen's ticket, shown on the courier's screen, and carried onto reviews.
 * Straight from the browser it had no length limit at all, no moderation and no
 * audit trail: a person could write five thousand characters of abuse and it
 * would come out of a restaurant's printer.
 *
 * (There was no screen for it either, so the door was open and unused. That is
 * the worst of both — a hole with no feature behind it to justify keeping it.)
 *
 * Here it is trimmed, bounded, moderated with the same filter as reviews and
 * complaints, and written to the audit log with what it was before. The rule
 * no longer lists the field.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It does not touch a single past order. Every order froze the customer's name
 * at the moment it was placed, and that is the name the restaurant packed and
 * the courier delivered to. Rewriting it afterwards would change what a receipt
 * says happened — and a receipt that changes is not a receipt.
 */
export const updateProfile = onCall(
  guard('updateProfile', async (request) => {
    const { caller, user } = await requireActiveUser(request);

    const data = asObject(request.data);
    const raw = requireString(data, 'fullName', { min: NAME_MIN, max: NAME_MAX });

    const moderated = clean(raw);
    const fullName = moderated.text.trim();

    // The filter can mask a name down to almost nothing. A person is not left
    // with an empty name because their surname tripped a word list.
    if (fullName.length < NAME_MIN) fail(AppErrorCode.VALIDATION_FAILED, 'fullName');

    // Nothing to do. Not an error, and not an audit row either — a screen that
    // saves an unchanged form must not fill the log with noise.
    if (fullName === user.fullName) return { ok: true, changed: false, fullName };

    await db.doc(paths.user(caller.uid)).update({ fullName, updatedAt: now() });

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.USER_PROFILE_CHANGED,
      targetType: 'user',
      targetId: caller.uid,
      oldValue: { fullName: user.fullName },
      newValue: { fullName, filtered: moderated.filtered },
      reason: 'self-service profile edit',
      ip: request.rawRequest.ip ?? null,
    });

    return { ok: true, changed: true, fullName, filtered: moderated.filtered };
  }),
);

/**
 * Moving a telephone number to another account. Super admin only.
 *
 * THE PROBLEM THIS EXISTS FOR
 * ---------------------------
 * Sign-in is a code sent to a telephone number, and nothing else. So a person
 * who loses that number loses the account with it: their order history, their
 * coupons, their saved addresses, all of it, permanently. Support had no tool
 * at all — `releaseAccountLock` refuses a live lock on purpose, and a live lock
 * is exactly what this case has.
 *
 * WHY IT IS NOT SELF-SERVICE
 * --------------------------
 * A customer-facing "change my number" flow is the single most dangerous thing
 * this codebase could grow. Done with one code — sent to the NEW number — it is
 * an account takeover: anybody holding a stolen phone points the account at
 * their own number and the real owner is locked out of their own history. Done
 * properly it needs a code to the old number AND a code to the new one, which
 * is precisely the flow a person with a lost phone cannot complete.
 *
 * So the person who cannot complete it is the person who needs it, and the
 * answer is a human: an admin who recognises the customer decides, and this
 * writes down that they decided. Every field of that decision is in the audit
 * log, including the old number.
 *
 * WHAT IT DOES, IN ONE TRANSACTION
 * --------------------------------
 * Releases the old lock, claims the new one, and moves the number on the user
 * document — all three together, because a half-applied move leaves either a
 * number nobody can register or an account whose lock points at somebody else.
 *
 * Firebase Auth is updated separately, afterwards, and its failure is loud: the
 * Firestore side is what the platform believes, but the Auth side is what
 * actually lets a person sign in, and an admin needs to know if only half of it
 * landed.
 */
export const changeUserPhone = onCall(
  guard('changeUserPhone', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_CHANGE_USER_STATUS);

    // The same line `anonymiseUser` and `releaseAccountLock` draw. An operator
    // handles support; changing who an account belongs to is not support.
    if (caller.role !== UserRole.SUPER_ADMIN) fail(AppErrorCode.FORBIDDEN);

    const data = asObject(request.data);
    const targetUid = requireString(data, 'uid', { min: 1, max: 128 });
    const newPhone = requirePhone(data, 'phone');
    const reason = requireString(data, 'reason', { min: 10, max: 300 });

    if (targetUid === caller.uid) fail(AppErrorCode.FORBIDDEN, 'self');

    const newKey = normalisePhoneKey(newPhone);
    if (!newKey) fail(AppErrorCode.INVALID_PHONE);

    const userRef = db.doc(paths.user(targetUid));
    // `phoneLock` normalises the number itself, so the E.164 form goes in and
    // the lock's real key comes out — one place decides what a key looks like.
    const newLockRef = db.doc(paths.phoneLock(newPhone));

    const outcome = await db.runTransaction(async (tx) => {
      const [userSnap, newLockSnap] = await Promise.all([tx.get(userRef), tx.get(newLockRef)]);

      if (!userSnap.exists) fail(AppErrorCode.ACCOUNT_NOT_FOUND);
      const target = userSnap.data() as User;

      const oldPhone = target.phone ?? '';
      const oldKey = normalisePhoneKey(oldPhone);

      if (oldKey === newKey) return { changed: false, oldPhone };

      /*
       * The new number must be free.
       *
       * Not "free unless the admin insists": a lock held by a live account is
       * somebody else's identity, and moving it would sign that person out of
       * their own account without telling them. If the number genuinely belongs
       * to this customer and is stuck on an old, dead account, the admin
       * releases that lock first with `releaseAccountLock` — which refuses a
       * live one, and refuses it for the same reason.
       */
      if (newLockSnap.exists && (newLockSnap.data()?.uid as string | undefined) !== targetUid) {
        fail(AppErrorCode.PHONE_ALREADY_REGISTERED);
      }

      // Old lock first. Releasing before claiming means a crash between the two
      // leaves a number nobody holds, which registration can heal. The reverse
      // leaves one number locked to two accounts, which it cannot.
      if (oldKey) tx.delete(db.doc(paths.phoneLock(oldPhone)));
      tx.set(newLockRef, { uid: targetUid, createdAt: now() });

      tx.update(userRef, {
        phone: newPhone,
        // The new number has not proved itself to anybody yet. An admin decided
        // this; the person still verifies it the first time they sign in.
        phoneVerified: false,
        updatedAt: now(),
      });

      return { changed: true, oldPhone };
    });

    if (!outcome.changed) return { ok: true, changed: false };

    /*
     * Firebase Auth, after Firestore and outside the transaction.
     *
     * This is the half that decides whether the person can actually receive a
     * sign-in code. If it fails the platform's own records are already correct,
     * so the failure is reported rather than swallowed — an admin who thinks
     * they have fixed somebody's account and has not is worse off than one who
     * is told to try again.
     */
    let authUpdated = true;
    try {
      await auth.updateUser(targetUid, { phoneNumber: newPhone });
    } catch (error) {
      authUpdated = false;
      logger.error('phone moved in Firestore but not in Auth', {
        uid: targetUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Whatever else happened, the old sessions must go: they were signed in as
    // an account whose identity has just changed.
    await auth.revokeRefreshTokens(targetUid).catch(() => undefined);

    await writeAudit({
      actorId: caller.uid,
      actorRole: actor.role,
      action: AuditAction.USER_PHONE_CHANGED,
      targetType: 'user',
      targetId: targetUid,
      oldValue: { phone: outcome.oldPhone },
      newValue: { phone: newPhone, authUpdated },
      reason,
      ip: request.rawRequest.ip ?? null,
    });

    logger.warn('user phone changed by admin', { uid: targetUid, by: caller.uid, authUpdated });

    return { ok: true, changed: true, authUpdated };
  }),
);

/** How many accounts one run of the backfill walks. */
const BACKFILL_PAGE = 400;

/**
 * Fills in the order counters for accounts that existed before they did.
 *
 * The counters are incremented at completion from here on, so this is only ever
 * about history. It is a callable rather than a scheduled job because it should
 * run once, watched, and then never again — a job that quietly recomputes
 * lifetime totals every night is a job that will one day double them.
 *
 * Paged by uid so a second run resumes rather than restarting, and each account
 * is written with the value it computed rather than an increment: run it twice
 * and the answer is the same, which is the only safe shape for a backfill.
 */
export const backfillCustomerCounters = onCall(
  guard('backfillCustomerCounters', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_EDIT_SETTINGS);

    const data = asObject(request.data);
    const after = typeof data.after === 'string' ? data.after : null;

    let query = db.collection('users').orderBy('__name__').limit(BACKFILL_PAGE);
    if (after) query = query.startAfter(after);

    const page = await query.get();
    if (page.empty) return { ok: true, scanned: 0, updated: 0, more: false, last: null };

    let updated = 0;
    let batch = db.batch();
    let queued = 0;

    for (const doc of page.docs) {
      // Only completed orders count, and only this customer's. `COMPLETED` is
      // the same status the live counter increments on, so a backfilled account
      // and a live one mean the same thing by the same number.
      const orders = await db
        .collection('orders')
        .where('customerId', '==', doc.id)
        .where('status', '==', 'COMPLETED')
        .get();

      if (orders.empty) continue;

      let spent = 0;
      let lastMs = 0;
      for (const order of orders.docs) {
        const value = order.data() as { pricing?: { total?: number }; completedAt?: { toMillis?: () => number } };
        spent += value.pricing?.total ?? 0;
        const at = value.completedAt?.toMillis?.() ?? 0;
        if (at > lastMs) lastMs = at;
      }

      batch.update(doc.ref, {
        completedOrderCount: orders.size,
        totalSpent: spent,
        ...(lastMs > 0 ? { lastOrderAt: new Date(lastMs) } : {}),
      });
      updated += 1;
      queued += 1;

      if (queued >= 400) {
        await batch.commit();
        batch = db.batch();
        queued = 0;
      }
    }

    if (queued > 0) await batch.commit();

    return {
      ok: true,
      scanned: page.size,
      updated,
      more: page.size === BACKFILL_PAGE,
      last: page.docs[page.docs.length - 1]?.id ?? null,
    };
  }),
);
