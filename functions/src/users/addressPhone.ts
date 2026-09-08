/**
 * QAPINDA — Proving the number on a delivery address.
 *
 * WHY A NUMBER ON AN ADDRESS HAS TO BE PROVED AT ALL
 * --------------------------------------------------
 * Unverified, this field is a way to send an unwanted courier to any telephone
 * number in the country: type a stranger's number, order food to their street,
 * and their phone rings from a driver they have never heard of. It is also a
 * way to make somebody else's delivery fail — one wrong digit and the food
 * comes back.
 *
 * So the pair (address, number) is proved once, by a code sent to that number,
 * and then it is proved for good. NOT per order: the address is the thing being
 * verified, and asking for a code every time somebody orders dinner is how a
 * checkout gets abandoned.
 *
 * THE CASE THAT SENDS NO MESSAGE
 * ------------------------------
 * If the number on the address is the account's own — proved by SMS at
 * registration, and by far the commonest case — `saveAddress` marks it verified
 * without coming anywhere near this file. Nothing is sent, nothing is spent,
 * and the customer is not asked to do anything. See `needsPhoneVerification` in
 * `shared/addressContact.ts`.
 *
 * WHAT IS STORED, AND WHAT IS NOT
 * -------------------------------
 * A SHA-256 of `{uid}:{addressId}:{code}` and nothing else. The code itself is
 * never written to Firestore and never written to a log — not at any level, not
 * in development. Cloud Logging is readable by every project member, and a
 * verification code in a log is a verification code in whatever reads the logs.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, now, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser } from '../lib/auth';
import { asObject, requireString } from '../lib/validate';
import { sendSms, smsConfigured } from '../lib/sms';
import { AppErrorCode } from '../shared/errors';
import { COLLECTIONS, SUBCOLLECTIONS, paths } from '../shared/collections';
import {
  ADDRESS_CODE_DAILY_LIMIT,
  ADDRESS_CODE_MAX_ATTEMPTS,
  ADDRESS_CODE_RESEND_SECONDS,
  ADDRESS_CODE_TTL_MINUTES,
  needsPhoneVerification,
} from '../shared/addressContact';
import type { Address } from '../shared/models';

type PendingCode = {
  uid: string;
  addressId: string;
  phone: string;
  codeHash: string;
  expiresAt: FirebaseFirestore.Timestamp;
  attempts: number;
  sentAt: FirebaseFirestore.Timestamp;
  /** Midnight-to-midnight counter, so the daily cap survives a restart. */
  dayKey: string;
  dayCount: number;
};

function hashCode(uid: string, addressId: string, code: string): string {
  return createHash('sha256').update(`${uid}:${addressId}:${code}`).digest('hex');
}

function equalHashes(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The platform's day, not UTC's — Baku is UTC+4 and the cap should feel local. */
function dayKey(): string {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * How many codes this account has asked for today, across every address.
 *
 * THE CAP THAT ACTUALLY MATTERS. Without it an account is a free SMS gun
 * pointed at any number in the country: change the address's phone, ask for a
 * code, repeat. The count is kept on the pending documents rather than in a
 * separate counter so that there is nothing to forget to increment.
 */
async function codesSentToday(uid: string): Promise<number> {
  const today = dayKey();
  const snapshot = await db
    .collection(COLLECTIONS.addressVerifications)
    .where('uid', '==', uid)
    .where('dayKey', '==', today)
    .get();

  return snapshot.docs.reduce((total, doc) => total + ((doc.data().dayCount as number) ?? 0), 0);
}

/**
 * Sends a code to the number saved on one address.
 *
 * Refuses rather than pretending when no gateway is configured. A verification
 * flow that silently accepts an unverifiable number would put a wrong telephone
 * on a delivery, and the failure would surface at somebody's door, days later,
 * as a courier ringing a stranger.
 */
export const sendAddressPhoneCode = onCall(
  guard('sendAddressPhoneCode', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);
    const addressId = requireString(data, 'addressId', { max: 64 });

    const addressRef = db.doc(
      `${paths.user(caller.uid)}/${SUBCOLLECTIONS.addresses}/${addressId}`,
    );
    const addressSnap = await addressRef.get();
    if (!addressSnap.exists) fail(AppErrorCode.NOT_FOUND, 'address');
    const address = addressSnap.data() as Address;

    const phone = (address.phone ?? '').trim();
    if (!phone) fail(AppErrorCode.VALIDATION_FAILED, 'phone');

    // Nothing to prove — and this is the branch most addresses take.
    if (
      !needsPhoneVerification({
        addressPhone: phone,
        accountPhone: user.phone,
        accountPhoneVerified: user.phoneVerified === true,
      })
    ) {
      await addressRef.update({ phoneVerified: true, updatedAt: now() });
      return { ok: true, alreadyVerified: true, sent: false };
    }

    if (!smsConfigured()) fail(AppErrorCode.SMS_SENDING_DISABLED);

    const ref = db.doc(paths.addressVerification(caller.uid, addressId));
    const existing = (await ref.get()).data() as PendingCode | undefined;

    if (existing?.sentAt) {
      const since = Date.now() - existing.sentAt.toMillis();
      if (since < ADDRESS_CODE_RESEND_SECONDS * 1000) fail(AppErrorCode.RATE_LIMITED, 'cooldown');
    }

    if ((await codesSentToday(caller.uid)) >= ADDRESS_CODE_DAILY_LIMIT) {
      fail(AppErrorCode.RATE_LIMITED, 'daily');
    }

    // Cryptographically secure. `Math.random` is not, and a guessable
    // verification code is not a verification code.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const today = dayKey();

    const pending: PendingCode = {
      uid: caller.uid,
      addressId,
      phone,
      codeHash: hashCode(caller.uid, addressId, code),
      expiresAt: Timestamp.fromMillis(Date.now() + ADDRESS_CODE_TTL_MINUTES * 60_000),
      attempts: 0,
      sentAt: Timestamp.now(),
      dayKey: today,
      // Resetting to 1 on a new day is what makes the cap daily rather than
      // permanent; the counter lives with the code so nothing can drift.
      dayCount: existing?.dayKey === today ? (existing.dayCount ?? 0) + 1 : 1,
    };

    await ref.set(pending);

    const result = await sendSms({
      to: phone,
      body: `Qapında təsdiq kodu: ${code}. ${ADDRESS_CODE_TTL_MINUTES} dəqiqə keçərlidir. Kodu heç kimlə paylaşmayın.`,
    });

    if (!result.ok) {
      // The pending document goes with it. Leaving it would burn the cooldown
      // and a slot in the daily cap for a message that never arrived.
      await ref.delete().catch(() => undefined);
      fail(
        result.reason === 'NOT_CONFIGURED'
          ? AppErrorCode.SMS_SENDING_DISABLED
          : AppErrorCode.SMS_SEND_FAILED,
      );
    }

    logger.info('address code sent', { uid: caller.uid, addressId });
    return { ok: true, alreadyVerified: false, sent: true, expiresInMinutes: ADDRESS_CODE_TTL_MINUTES };
  }),
);

/**
 * Checks the code and marks the address verified.
 *
 * A wrong answer is counted BEFORE the refusal is returned — a limit that is
 * incremented after an early return is not a limit.
 */
export const verifyAddressPhoneCode = onCall(
  guard('verifyAddressPhoneCode', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const addressId = requireString(data, 'addressId', { max: 64 });
    const code = requireString(data, 'code', { min: 6, max: 6 });

    const ref = db.doc(paths.addressVerification(caller.uid, addressId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.ADDRESS_CODE_EXPIRED);

    const pending = snapshot.data() as PendingCode;

    if (pending.attempts >= ADDRESS_CODE_MAX_ATTEMPTS) fail(AppErrorCode.ADDRESS_CODE_TOO_MANY);
    if (pending.expiresAt.toMillis() < Date.now()) {
      await ref.delete();
      fail(AppErrorCode.ADDRESS_CODE_EXPIRED);
    }

    if (!equalHashes(pending.codeHash, hashCode(caller.uid, addressId, code))) {
      await ref.update({ attempts: pending.attempts + 1 });
      fail(AppErrorCode.ADDRESS_CODE_WRONG);
    }

    const addressRef = db.doc(
      `${paths.user(caller.uid)}/${SUBCOLLECTIONS.addresses}/${addressId}`,
    );

    await db.runTransaction(async (tx) => {
      const addressSnap = await tx.get(addressRef);
      if (!addressSnap.exists) fail(AppErrorCode.NOT_FOUND, 'address');

      /*
       * THE NUMBER IS RE-READ FROM THE ADDRESS, AND IT HAS TO MATCH.
       *
       * Otherwise the flow is: ask for a code to your own number, receive it,
       * change the address to a stranger's number, then submit the code. The
       * pending document remembers which number the code was actually sent to,
       * and only that number is marked verified.
       */
      const current = ((addressSnap.data() as Address).phone ?? '').trim();
      if (current !== pending.phone) fail(AppErrorCode.CONFLICT, 'phone-changed');

      tx.update(addressRef, { phoneVerified: true, updatedAt: now() });
      tx.delete(ref);
    });

    logger.info('address phone verified', { uid: caller.uid, addressId });
    return { ok: true };
  }),
);
