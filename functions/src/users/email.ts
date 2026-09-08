/**
 * QAPINDA — Email verification by six-digit code.
 *
 * The code is generated here, hashed, and only the hash is stored. A leaked
 * backup of `emailVerifications` therefore proves nothing and verifies nobody.
 *
 * Delivery goes through Resend. If `RESEND_API_KEY` is not set the callable
 * refuses cleanly with EMAIL_SENDING_DISABLED rather than pretending to send —
 * a "code sent" message with no email behind it is the worst possible failure.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, now, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser } from '../lib/auth';
import { asObject, optionalEmail, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { COLLECTIONS, normaliseEmailKey, paths } from '../shared/collections';
import type { EmailVerification } from '../shared/models';

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
/** One code per minute per account — enough to retry, too slow to abuse. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * How many verification emails one account may send in a day.
 *
 * Ten. A person changing their email address and mistyping it twice is well
 * inside that; a script pointing this at somebody else's inbox is not.
 */
const EMAIL_CODE_DAILY_LIMIT = 10;

/** The platform's day, not UTC's — Baku is UTC+4 and the cap should feel local. */
function dayKey(): string {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function hashCode(uid: string, code: string): string {
  // The uid is mixed in so the same code for two people hashes differently.
  return createHash('sha256').update(`${uid}:${code}`).digest('hex');
}

function equalHashes(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // Constant time: a length check first, because timingSafeEqual throws on
  // differing lengths and that itself would leak.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function sendCodeEmail(to: string, code: string, fullName: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM ?? 'Qapında <onboarding@resend.dev>';

  if (!apiKey) fail(AppErrorCode.EMAIL_SENDING_DISABLED);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Qapında təsdiq kodu: ${code}`,
      text: [
        `Salam${fullName ? `, ${fullName}` : ''}!`,
        '',
        `Qapında hesabınızın e-poçt ünvanını təsdiqləmək üçün kod: ${code}`,
        '',
        `Kod ${CODE_TTL_MINUTES} dəqiqə keçərlidir.`,
        'Bu kodu heç kimlə paylaşmayın. Qapında işçiləri sizdən kod istəmir.',
        '',
        'Bu kodu siz istəməmisinizsə, məktubu nəzərə almayın.',
      ].join('\n'),
    }),
  });

  if (!response.ok) {
    // The provider's message is logged, never returned: it can contain the
    // recipient address and internal ids.
    logger.error('resend failed', { status: response.status, body: await response.text() });
    fail(AppErrorCode.INTERNAL);
  }
}

/**
 * Sends (or re-sends) a code to the address the customer wants to verify.
 *
 * The email lock is checked first: there is no point mailing a code for an
 * address that already belongs to somebody else's account.
 */
export const sendEmailCode = onCall(
  guard('sendEmailCode', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    const email = optionalEmail(data, 'email') ?? user.email;
    if (!email) fail(AppErrorCode.INVALID_EMAIL);

    // Already taken by another account? Say so now, not after the round trip.
    const lock = await db.doc(paths.emailLock(email)).get();
    if (lock.exists && lock.data()?.uid !== caller.uid) {
      fail(AppErrorCode.EMAIL_ALREADY_REGISTERED);
    }

    const ref = db.doc(paths.emailVerification(caller.uid));
    const existing = (await ref.get()).data() as EmailVerification | undefined;

    if (existing?.sentAt) {
      const since = Date.now() - existing.sentAt.toMillis();
      if (since < RESEND_COOLDOWN_SECONDS * 1000) fail(AppErrorCode.RATE_LIMITED);
    }

    /*
     * A DAILY CAP, not just a cooldown between messages.
     *
     * The address comes from the REQUEST, not from the account — that is
     * deliberate, because attaching a new email is the whole point of this
     * function. With only a sixty-second cooldown it was also a mail cannon:
     * one account could send 1,440 "Qapında təsdiq kodu" messages a day to any
     * address in the world, from the platform's own verified sender domain.
     * That is somebody else's inbox filled and Qapında's mail reputation
     * burned, from one signed-in customer.
     *
     * The same shape as `codesSentToday` in `addressPhone.ts`, which had this
     * from the start; the counter lives on the pending document so there is
     * nothing separate to forget to increment.
     */
    const today = dayKey();
    const sameDay = existing?.dayKey === today;
    const sentToday = sameDay ? (existing?.dayCount ?? 0) : 0;
    if (sentToday >= EMAIL_CODE_DAILY_LIMIT) fail(AppErrorCode.RATE_LIMITED, 'daily');

    // randomInt is cryptographically secure; Math.random is not, and a
    // guessable verification code is not a verification code.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await ref.set({
      uid: caller.uid,
      email,
      codeHash: hashCode(caller.uid, code),
      expiresAt: Timestamp.fromMillis(Date.now() + CODE_TTL_MINUTES * 60_000),
      attempts: 0,
      sentAt: now(),
      dayKey: today,
      dayCount: sentToday + 1,
    });

    await sendCodeEmail(email, code, user.fullName);

    logger.info('email code sent', { uid: caller.uid });
    return { ok: true, expiresInMinutes: CODE_TTL_MINUTES };
  }),
);

/**
 * Checks the code and, on success, claims the email lock for this account.
 *
 * The lock move happens in a transaction so two accounts racing for the same
 * address cannot both end up verified.
 */
export const verifyEmailCode = onCall(
  guard('verifyEmailCode', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);
    const code = requireString(data, 'code', { min: 6, max: 6 });

    const ref = db.doc(paths.emailVerification(caller.uid));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.EMAIL_CODE_EXPIRED);

    const pending = snapshot.data() as EmailVerification;

    if (pending.attempts >= MAX_ATTEMPTS) fail(AppErrorCode.EMAIL_CODE_TOO_MANY);
    if (pending.expiresAt.toMillis() < Date.now()) {
      await ref.delete();
      fail(AppErrorCode.EMAIL_CODE_EXPIRED);
    }

    if (!equalHashes(pending.codeHash, hashCode(caller.uid, code))) {
      // Count the miss before returning, or the limit means nothing.
      await ref.update({ attempts: pending.attempts + 1 });
      fail(AppErrorCode.EMAIL_CODE_WRONG);
    }

    const newLockRef = db.doc(`${COLLECTIONS.emailIndex}/${normaliseEmailKey(pending.email)}`);
    const oldLockRef =
      user.email && normaliseEmailKey(user.email) !== normaliseEmailKey(pending.email)
        ? db.doc(paths.emailLock(user.email))
        : null;

    await db.runTransaction(async (tx) => {
      const held = await tx.get(newLockRef);
      if (held.exists && held.data()?.uid !== caller.uid) {
        fail(AppErrorCode.EMAIL_ALREADY_REGISTERED);
      }

      if (oldLockRef) tx.delete(oldLockRef);
      tx.set(newLockRef, { uid: caller.uid, createdAt: now() });
      tx.update(db.doc(paths.user(caller.uid)), {
        email: pending.email,
        emailVerified: true,
        updatedAt: now(),
      });
      tx.delete(ref);
    });

    logger.info('email verified', { uid: caller.uid });
    return { ok: true, email: pending.email };
  }),
);
