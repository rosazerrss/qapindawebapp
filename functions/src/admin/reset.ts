/**
 * QAPINDA — the pre-launch test-data reset.
 *
 * The scope, the switches and every refusal live in `shared/reset.ts`, which is
 * a pure module so that "who may run this, and when" can be tested without a
 * database. This file is the part that touches Firestore: it counts, it deletes
 * in bounded rounds, and it writes what it did into the audit log.
 *
 * THE FOUR GATES, AND WHY NONE OF THEM IS THE UI
 * ----------------------------------------------
 * The dialog on the admin panel asks for a typed platform name and a set of
 * switches, and none of that is what protects anything. `refuseReset` re-decides
 * all of it here from the caller's stored role, the settings document as it is
 * on the server right now, and the payload as it arrived:
 *
 *   1. SUPER_ADMIN, read from the user document rather than the token — a
 *      token is an hour behind the truth, and this is not the action to be an
 *      hour behind on;
 *   2. `publicSettings.testDataResetEnabled === true`, which is absent (and so
 *      false) until an admin deliberately turns it on;
 *   3. the platform's name, typed out;
 *   4. at least one valid scope, and only scopes this file knows.
 *
 * WHY IT DELETES IN ROUNDS AND TELLS YOU WHAT IS LEFT
 * --------------------------------------------------
 * A callable has 540 seconds and a collection has no upper bound. A single
 * unbounded pass is a run that dies in the middle having deleted an unknown
 * amount and reported nothing. So each invocation spends a document budget and
 * a time budget, stops on its own terms, and answers with what it deleted and
 * what remains. Pressing the button again finishes the job — deleting a
 * document that is already gone is a no-op, so a run that is interrupted,
 * retried, or simply fired twice by a nervous owner does the remainder and
 * nothing more.
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { asObject, optionalInt, requireArray, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { AuditAction, UserRole } from '../shared/enums';
import { paths } from '../shared/collections';
import { Permission } from '../shared/permissions';
import {
  PLATFORM_NAME,
  RESET_CHUNK,
  RESET_DEFAULT_LIMIT,
  RESET_MAX_LIMIT,
  RESET_MIN_LIMIT,
  RESET_PROTECTED_COLLECTIONS,
  RESET_SCOPES,
  RESET_TIME_BUDGET_MS,
  ResetScope,
  chunkSize,
  isProtectedCollection,
  isResetComplete,
  isResetScope,
  refuseReset,
  resetTargets,
  totalOf,
  type ResetTarget,
} from '../shared/reset';
import type { PublicSettings } from '../shared/models';

/** Firestore's own limit is 500 writes per batch; this leaves room to spare. */
const BATCH_LIMIT = 400;

/** Children read per round under one parent. An order has a dozen events. */
const NESTED_CHUNK = 200;

/** How many such rounds one parent gets before it is left for the next run. */
const NESTED_ROUNDS = 5;

/**
 * The highest number the counts will report.
 *
 * A count is an aggregation query, not a read of every document, but a screen
 * that says "48,912" and a screen that says "5,000+" lead to the same decision
 * — and the cap keeps the confirmation dialog cheap enough to open freely.
 */
const COUNT_CAP = 5000;

/** How many documents are in one collection, up to the cap. */
async function countIn(collection: string): Promise<number> {
  const snapshot = await db.collection(collection).limit(COUNT_CAP).count().get();
  return snapshot.data().count;
}

/** Every collection any scope can reach, in the order the scopes are listed. */
function allTargets(): ResetTarget[] {
  return resetTargets(RESET_SCOPES);
}

/**
 * What is in each collection right now, read live so the confirmation dialog
 * states facts rather than a number cached when the page loaded.
 */
async function countAll(targets: ResetTarget[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const target of targets) counts[target.collection] = await countIn(target.collection);
  return counts;
}

/**
 * The numbers behind the confirmation, plus whether the reset is permitted at
 * all. Read-only, and it is the screen's only source for both.
 */
export const platformResetStatus = onCall(
  guard('platformResetStatus', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_RESET_DATA);
    // The permission table says the same thing, and this says it again from
    // the stored document. Two spellings of one rule, on the one action in the
    // system that cannot be undone.
    if (user.role !== UserRole.SUPER_ADMIN) fail(AppErrorCode.FORBIDDEN);

    const settings = (await db.doc(paths.publicSettings()).get()).data() as
      | PublicSettings
      | undefined;

    return {
      ok: true,
      /** False until an admin switches it on in Ayarlar. */
      enabled: settings?.testDataResetEnabled === true,
      platformName: PLATFORM_NAME,
      counts: await countAll(allTargets()),
      countCap: COUNT_CAP,
      kept: RESET_PROTECTED_COLLECTIONS,
    };
  }),
);

/**
 * Empties one collection, up to a budget and a deadline.
 *
 * A parent's subcollections go first. Firestore does not remove them with the
 * parent, and a deleted order whose event trail survived is a set of documents
 * nothing in the system can ever reach again — so if the children cannot all
 * be cleared this round, the parent is deliberately left in place and the next
 * run picks it up with its children still attached to it.
 */
async function purge(
  target: ResetTarget,
  budget: number,
  deadline: number,
): Promise<{ deleted: number; nested: number }> {
  let deleted = 0;
  let nested = 0;

  while (deleted < budget && Date.now() < deadline) {
    const size = chunkSize(budget - deleted, RESET_CHUNK);
    if (size === 0) break;

    const snapshot = await db.collection(target.collection).limit(size).get();
    if (snapshot.empty) break;

    let batch = db.batch();
    let writes = 0;
    let progressed = false;

    const commit = async () => {
      if (writes === 0) return;
      await batch.commit();
      batch = db.batch();
      writes = 0;
    };

    for (const doc of snapshot.docs) {
      // Checked here as well as on the outer loop: subcollection children do
      // not count against the document budget, so one round over two hundred
      // parents with busy event trails could otherwise run past the deadline
      // before the budget noticed.
      if (Date.now() >= deadline) break;

      let childrenCleared = true;

      for (const sub of target.subcollections) {
        for (let round = 0; round < NESTED_ROUNDS; round += 1) {
          const children = await doc.ref.collection(sub).limit(NESTED_CHUNK).get();
          if (children.empty) break;

          for (const child of children.docs) {
            batch.delete(child.ref);
            writes += 1;
            nested += 1;
            if (writes >= BATCH_LIMIT) await commit();
          }

          if (children.size < NESTED_CHUNK) break;

          // A queued delete is not a delete yet, so the next round would read
          // back the very documents this one has already spoken for. Commit
          // before looking again.
          await commit();

          // Still full after the last allowed round: leave the parent for the
          // next invocation rather than orphaning what is underneath it.
          if (round === NESTED_ROUNDS - 1) childrenCleared = false;
        }
      }

      if (!childrenCleared) continue;

      batch.delete(doc.ref);
      writes += 1;
      deleted += 1;
      progressed = true;
      if (writes >= BATCH_LIMIT) await commit();
    }

    await commit();

    // Nothing in this round could be deleted, so the next round would read the
    // same documents and do the same nothing. Stop and report what is left.
    if (!progressed) break;
  }

  return { deleted, nested };
}

/**
 * Deletes the selected test data, in bounded rounds, and records what it did.
 *
 * Returns `done: false` with the remaining counts when the budget runs out.
 * The screen shows that and offers the button again; there is no state to
 * resume, because "what is left" is simply what is still in the collections.
 */
export const resetPlatformData = onCall(
  // Its own timeout, well above the platform's 60-second default and well
  // below the 540-second ceiling — the run stops on `RESET_TIME_BUDGET_MS`
  // and this is only the outer wall behind it.
  { timeoutSeconds: 300, memory: '512MiB' },
  guard('resetPlatformData', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_RESET_DATA);

    const data = asObject(request.data);
    const confirmation = requireString(data, 'confirmation', { min: 1, max: 120 });
    const requested = requireArray<unknown>(data, 'scopes', { max: RESET_SCOPES.length });
    const limit = Math.min(
      RESET_MAX_LIMIT,
      Math.max(RESET_MIN_LIMIT, optionalInt(data, 'limit', { min: 1, max: RESET_MAX_LIMIT }) ?? RESET_DEFAULT_LIMIT),
    );

    const settings = (await db.doc(paths.publicSettings()).get()).data() as
      | PublicSettings
      | undefined;

    // Everything that can refuse this, decided in one place from the server's
    // own copy of the facts. Nothing below runs until it returns null.
    const refusal = refuseReset({
      role: user.role,
      resetEnabled: settings?.testDataResetEnabled,
      confirmation,
      scopes: requested.filter((entry): entry is string => typeof entry === 'string'),
    });
    if (refusal) fail(refusal);

    const scopes = requested.filter(isResetScope) as ResetScope[];
    const targets = resetTargets(scopes);

    // Belt and braces on the one mistake that could not be taken back: a scope
    // that named `users` or `auditLogs` would empty them before anybody read
    // the diff that introduced it.
    if (targets.some((target) => isProtectedCollection(target.collection))) {
      logger.error('reset scope reached a protected collection', {
        scopes,
        collections: targets.map((target) => target.collection),
      });
      fail(AppErrorCode.INTERNAL);
    }

    const deadline = Date.now() + RESET_TIME_BUDGET_MS;
    const deleted: Record<string, number> = {};
    const nested: Record<string, number> = {};
    let spent = 0;

    for (const target of targets) {
      const result = await purge(target, limit - spent, deadline);
      deleted[target.collection] = result.deleted;
      nested[target.collection] = result.nested;
      spent += result.deleted;
    }

    const remaining = await countAll(targets);
    const done = isResetComplete(remaining);

    // Written after the deletions rather than before, so it records what
    // actually happened rather than what was attempted — and it survives the
    // reset, because `auditLogs` is on the protected list.
    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.PLATFORM_DATA_RESET,
      targetType: 'platform',
      targetId: 'test-data',
      newValue: {
        scopes,
        deleted,
        nestedDeleted: nested,
        remaining,
        documentsDeleted: totalOf(deleted) + totalOf(nested),
        done,
      },
      reason: `Test məlumatlarının sıfırlanması · ${scopes.join(', ')}`,
      ip: request.rawRequest.ip ?? null,
    });

    logger.warn('platform test data reset', {
      uid: caller.uid,
      scopes,
      deleted,
      remaining,
      done,
    });

    return {
      ok: true,
      scopes,
      deleted,
      nestedDeleted: nested,
      remaining,
      documentsDeleted: totalOf(deleted) + totalOf(nested),
      /** False when the budget ran out. Press again to continue. */
      done,
      countCap: COUNT_CAP,
    };
  }),
);
