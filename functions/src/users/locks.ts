/**
 * QAPINDA — Repairing the account locks.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * `phoneIndex` and `emailIndex` are the two documents that make "one person,
 * one account" true, and until now nothing in the product could look at one or
 * remove one. That was fine while every account left through `anonymiseUser`,
 * which releases them. It stopped being fine the first time somebody deleted a
 * `users/{uid}` document from the Firestore console: the locks stayed, naming a
 * uid that no longer existed, and the number's owner was refused registration
 * for ever with no screen anywhere able to say why or fix it.
 *
 * `registerAccount` now heals that by itself — a lock whose account is gone is
 * simply taken over, which is the real fix and the one that matters. This file
 * is the other half: it lets an admin SEE the state of a lock, which is what
 * turns "it says my number is already registered" from a mystery into a
 * sentence, and lets them clear a dead one deliberately.
 *
 * WHAT IT DELIBERATELY WILL NOT DO
 * --------------------------------
 * It will not release a live lock. Not for a super admin, not with a reason
 * typed in, not at all — `releaseAccountLock` reads the account behind the lock
 * and refuses if that account still exists and still claims the number. An
 * admin who could unhook a live number from its account would be able to hand
 * any customer's telephone number to anybody, and every "one account" guarantee
 * in the product would rest on nobody choosing to. Unwinding a live account is
 * `anonymiseUser`, which is audited, requires the account holder's own deletion
 * request first, and anonymises rather than frees.
 *
 * That refusal is the "no hidden super admin bypass" rule applied to the one
 * place it would have been most tempting to break it.
 */

import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { db } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { asObject, optionalString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { AuditAction, UserRole } from '../shared/enums';
import {
  COLLECTIONS,
  normaliseEmailKey,
  normalisePhoneKey,
  paths,
} from '../shared/collections';
import { Permission } from '../shared/permissions';
import { lockIsLive, staleReason, type LockKind, type StaleReason } from '../shared/accountLocks';
import type { User } from '../shared/models';

/** What the server found for one index entry. */
type LockReport = {
  kind: LockKind;
  key: string;
  exists: boolean;
  holderUid: string | null;
  holderExists: boolean;
  holderRole: UserRole | null;
  holderStatus: string | null;
  live: boolean;
  stale: StaleReason;
};

/**
 * Reads one index entry and the account behind it.
 *
 * Shared by the diagnosis, the release and the nightly sweep so that all three
 * agree about what "dead" means — three copies of this rule would eventually
 * become three different rules, and the one that mattered would be the loosest.
 */
async function readLock(kind: LockKind, key: string): Promise<LockReport> {
  const ref = db.doc(
    kind === 'PHONE' ? `${COLLECTIONS.phoneIndex}/${key}` : `${COLLECTIONS.emailIndex}/${key}`,
  );
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    return {
      kind,
      key,
      exists: false,
      holderUid: null,
      holderExists: false,
      holderRole: null,
      holderStatus: null,
      live: false,
      stale: 'NO_UID',
    };
  }

  const holderUid = (snapshot.data()?.uid as string | undefined) ?? null;
  const holderDoc = holderUid ? await db.doc(paths.user(holderUid)).get() : null;
  const held = holderDoc?.exists ? (holderDoc.data() as User) : null;

  const holder = held
    ? {
        accountStatus: held.accountStatus ?? null,
        phoneKey: held.phone ? normalisePhoneKey(held.phone) : null,
        emailKey: held.email ? normaliseEmailKey(held.email) : null,
      }
    : null;

  const input = { kind, lockKey: key, holderUid, holder };

  return {
    kind,
    key,
    exists: true,
    holderUid,
    holderExists: Boolean(held),
    holderRole: held?.role ?? null,
    holderStatus: held?.accountStatus ?? null,
    live: lockIsLive(input),
    stale: staleReason(input),
  };
}

/**
 * "Why can this person not register?" — answered, without changing anything.
 *
 * Read-only on purpose. The first thing anybody needs when a customer says
 * "it says my number is already registered" is to know whether that is true,
 * and a tool that answers by fixing cannot be pointed at a number safely.
 */
export const inspectAccountLocks = onCall(
  guard('inspectAccountLocks', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_CHANGE_USER_STATUS);

    const data = asObject(request.data);
    const phone = optionalString(data, 'phone', { max: 32 });
    const email = optionalString(data, 'email', { max: 200 });

    if (!phone && !email) fail(AppErrorCode.VALIDATION_FAILED, 'phone-or-email');

    const reports: LockReport[] = [];
    if (phone) reports.push(await readLock('PHONE', normalisePhoneKey(phone)));
    if (email) reports.push(await readLock('EMAIL', normaliseEmailKey(email)));

    return { ok: true, locks: reports };
  }),
);

/**
 * Clears one dead index entry.
 *
 * Super admin only, and only when the account behind the lock is gone,
 * anonymised, or no longer claims the number. A live lock is refused with
 * CONFLICT — see the note at the top of this file for why that refusal is not
 * negotiable.
 */
export const releaseAccountLock = onCall(
  guard('releaseAccountLock', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_CHANGE_USER_STATUS);
    if (caller.role !== UserRole.SUPER_ADMIN) fail(AppErrorCode.FORBIDDEN);

    const data = asObject(request.data);
    const phone = optionalString(data, 'phone', { max: 32 });
    const email = optionalString(data, 'email', { max: 200 });
    if (!phone && !email) fail(AppErrorCode.VALIDATION_FAILED, 'phone-or-email');

    const kind: LockKind = phone ? 'PHONE' : 'EMAIL';
    const key = phone ? normalisePhoneKey(phone) : normaliseEmailKey(email!);

    const report = await readLock(kind, key);
    if (!report.exists) fail(AppErrorCode.NOT_FOUND, 'lock');

    // The whole point of the callable, and the one line worth reading twice.
    if (report.live) fail(AppErrorCode.CONFLICT, 'lock-is-live');

    await db
      .doc(
        kind === 'PHONE'
          ? `${COLLECTIONS.phoneIndex}/${key}`
          : `${COLLECTIONS.emailIndex}/${key}`,
      )
      .delete();

    await writeAudit({
      actorId: caller.uid,
      actorRole: actor.role,
      action: AuditAction.ACCOUNT_LOCK_RELEASED,
      targetType: 'user',
      // The uid the lock pointed at, when it pointed anywhere. That is the
      // subject of this record — not the admin, and not the number.
      targetId: report.holderUid ?? key,
      oldValue: { kind, key, holderUid: report.holderUid },
      newValue: null,
      reason: `stale lock released (${report.stale ?? 'UNKNOWN'})`,
    });

    logger.warn('account lock released', { kind, key, holderUid: report.holderUid });

    return { ok: true, released: true, reason: report.stale };
  }),
);

/**
 * The nightly tidy.
 *
 * `registerAccount` already heals a ghost lock the moment somebody tries to use
 * the number, so nothing here is load-bearing — a person who never comes back
 * is never blocked by their own stranded lock. What this adds is that the index
 * does not silently accumulate rows pointing at nothing, and that the warning
 * in the log is the place somebody finds out that accounts are being deleted by
 * hand.
 *
 * It is bounded, and it deletes only what `lockIsLive` calls dead. A sweep that
 * could touch a live lock would be the same bypass this file refuses to give an
 * admin, only unattended.
 */
const SWEEP_LIMIT = 400;

async function sweep(kind: LockKind): Promise<number> {
  const collection = kind === 'PHONE' ? COLLECTIONS.phoneIndex : COLLECTIONS.emailIndex;
  const snapshot = await db.collection(collection).limit(SWEEP_LIMIT).get();

  let removed = 0;
  const batch = db.batch();

  for (const doc of snapshot.docs) {
    const report = await readLock(kind, doc.id);
    if (report.live) continue;

    batch.delete(doc.ref);
    removed += 1;
    logger.warn('stale account lock swept', {
      kind,
      key: doc.id,
      holderUid: report.holderUid,
      reason: report.stale,
    });
  }

  if (removed > 0) await batch.commit();
  return removed;
}

export const sweepStaleAccountLocks = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeZone: 'Asia/Baku' },
  async () => {
    const phone = await sweep('PHONE');
    const email = await sweep('EMAIL');

    if (phone + email > 0) {
      logger.warn('account locks swept', { phone, email });
    }
  },
);
