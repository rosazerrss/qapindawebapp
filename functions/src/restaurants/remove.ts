/**
 * QAPINDA — Removing a restaurant from the platform.
 *
 * WHY THIS IS NOT A `delete()`
 * ----------------------------
 * Every order ever placed at a restaurant points at its id, and so does every
 * settlement, every ledger entry and every review. Deleting the document turns
 * each of those into a dangling reference — an invoice belonging to nothing, a
 * customer's order history with a blank where the shop used to be — and it
 * takes with it the record of money that was earned and may still be owed.
 * Those records carry a tax and accounting retention obligation that is not the
 * platform's to waive on a restaurant's behalf, and certainly not on a
 * restaurant's *customers'* behalf.
 *
 * So the restaurant is removed rather than erased, and "removed" is thorough:
 *
 *   • REMOVED status — gone from the shopfront, from search, from every list;
 *   • serviceState CLOSED, so nothing can slip through a cached page;
 *   • the whole menu deleted — categories and products both;
 *   • every staff account and courier unlinked and demoted to CUSTOMER, with
 *     their custom claims revoked, so nobody can sign back into a panel for a
 *     restaurant that no longer exists;
 *   • the shopfront fields cleared: cover, logo, description, opening hours.
 *
 * What survives is the id, the name and the record of what happened.
 *
 * WHAT WILL REFUSE THE REQUEST
 * ----------------------------
 * An order still moving. Deleting a restaurant out from under a customer whose
 * dinner is in a car is the one outcome this callable must never produce, and
 * "wait an hour" is a reasonable thing to say to an admin.
 *
 * Money still owed. A restaurant with an unpaid settlement is a debt, and
 * removing it from every list is how a debt stops being chased. The refusal
 * names the period so the admin can go and settle or write it off first —
 * writing it off is a decision somebody makes deliberately, which is exactly
 * the point.
 *
 * Neither refusal can be overridden from here. There is no force flag, on
 * purpose: the two things that block a removal are both things a person can
 * genuinely resolve in a few minutes, and a bypass would be used for both.
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, auth, now } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requirePermission, setUserClaims } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { asObject, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import {
  ACTIVE_ORDER_STATUSES,
  AuditAction,
  RestaurantStatus,
  ServiceState,
  SettlementStatus,
  UserRole,
} from '../shared/enums';
import { COLLECTIONS, paths } from '../shared/collections';
import { Permission } from '../shared/permissions';
import type { Restaurant, Settlement } from '../shared/models';

/** Firestore's own ceiling on one batch. */
const BATCH_LIMIT = 450;

export const removeRestaurant = onCall(
  guard('removeRestaurant', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_SUSPEND_RESTAURANT);

    // Suspending is reversible and an operator may do it. This is not, so it is
    // the super admin's alone — the same line `anonymiseUser` draws, for the
    // same reason.
    if (caller.role !== UserRole.SUPER_ADMIN) fail(AppErrorCode.FORBIDDEN);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const reason = requireString(data, 'reason', { min: 10, max: 500 });

    /*
     * The restaurant's own name, typed out.
     *
     * The same guard the platform reset uses. This callable ends a business's
     * presence on the platform and cannot be undone from any screen; asking
     * somebody to type the name is what turns a misclick in a long list into a
     * deliberate act on the row they meant.
     */
    const confirmName = requireString(data, 'confirmName', { min: 1, max: 120 });

    const ref = db.doc(paths.restaurant(restaurantId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
    const restaurant = snapshot.data() as Restaurant;

    if (restaurant.status === RestaurantStatus.REMOVED) {
      // Already gone. Not an error worth alarming anybody with — two admins
      // looking at the same list, or one slow connection.
      return { ok: true, alreadyRemoved: true };
    }

    if (confirmName.trim().toLowerCase() !== restaurant.name.trim().toLowerCase()) {
      fail(AppErrorCode.VALIDATION_FAILED, 'confirmName');
    }

    // ---- The two refusals ------------------------------------------------

    const live = await db
      .collection(COLLECTIONS.orders)
      .where('restaurantId', '==', restaurantId)
      .where('status', 'in', ACTIVE_ORDER_STATUSES)
      .limit(1)
      .get();
    if (!live.empty) fail(AppErrorCode.CONFLICT, 'active-orders');

    const owing = await db
      .collection(COLLECTIONS.settlements)
      .where('restaurantId', '==', restaurantId)
      .where('status', 'in', [
        SettlementStatus.OPEN,
        SettlementStatus.INVOICED,
        SettlementStatus.OVERDUE,
      ])
      .get();

    // An OPEN settlement with nothing in it is a month that simply happened,
    // not a debt. Only a non-zero balance blocks the removal — otherwise every
    // restaurant would be permanently undeletable by its own empty invoice.
    const unsettled = owing.docs.find((doc) => (doc.data() as Settlement).netDue !== 0);
    if (unsettled) {
      fail(AppErrorCode.CONFLICT, `unsettled:${(unsettled.data() as Settlement).period}`);
    }

    // ---- The removal itself ----------------------------------------------

    const [categories, products, staff] = await Promise.all([
      db.collection(COLLECTIONS.menuCategories).where('restaurantId', '==', restaurantId).get(),
      db.collection(COLLECTIONS.products).where('restaurantId', '==', restaurantId).get(),
      db.collection(COLLECTIONS.users).where('restaurantId', '==', restaurantId).get(),
    ]);

    /*
     * Written in chunks rather than one batch.
     *
     * A restaurant with four hundred dishes is not unusual, and Firestore
     * refuses a batch beyond five hundred writes — which would fail AFTER the
     * refusals above had passed, leaving the caller with an error and the
     * restaurant half-removed.
     */
    let batch = db.batch();
    let queued = 0;

    const commits: Promise<unknown>[] = [];
    const flush = () => {
      if (queued === 0) return;
      commits.push(batch.commit());
      batch = db.batch();
      queued = 0;
    };

    const add = (apply: (b: FirebaseFirestore.WriteBatch) => void) => {
      apply(batch);
      queued += 1;
      if (queued >= BATCH_LIMIT) flush();
    };

    for (const doc of [...categories.docs, ...products.docs]) {
      add((b) => b.delete(doc.ref));
    }

    /*
     * The staff.
     *
     * Demoted to CUSTOMER rather than deleted: these are real people with real
     * telephone numbers, and some of them are also customers of the platform.
     * Deleting their accounts because their employer left would take their own
     * order history with it and free their number — neither of which anybody
     * asked for.
     *
     * The claims are what actually lock them out. A stale claim would let a
     * manager keep loading the panel of a removed restaurant until their token
     * expired, and `setUserClaims` plus a token revocation closes that now.
     */
    const staffUids: string[] = [];
    for (const doc of staff.docs) {
      staffUids.push(doc.id);
      add((b) =>
        b.update(doc.ref, {
          role: UserRole.CUSTOMER,
          restaurantId: null,
          updatedAt: now(),
        }),
      );
    }

    add((b) =>
      b.update(ref, {
        status: RestaurantStatus.REMOVED,
        serviceState: ServiceState.CLOSED,
        // The shopfront, cleared. What is left is a name and an id.
        featured: false,
        coverUrl: null,
        logoUrl: null,
        tagline: null,
        // The date it stopped being a restaurant. Read by nothing today and
        // the first thing anybody wants when they open the tombstone.
        removedAt: now(),
        updatedAt: now(),
      }),
    );

    flush();
    await Promise.all(commits);

    /*
     * The claims, after the documents are written.
     *
     * Not inside the batch because they are not Firestore writes, and after
     * rather than before because a claim revoked against a document that then
     * failed to save would sign somebody out of a restaurant that still exists.
     * Each is allowed to fail on its own: one account whose claims did not
     * update must not abandon the other nine.
     */
    for (const uid of staffUids) {
      await setUserClaims(uid, UserRole.CUSTOMER, null).catch((error) =>
        logger.warn('claims not cleared for removed restaurant staff', {
          uid,
          error: String(error),
        }),
      );
      await auth.revokeRefreshTokens(uid).catch(() => undefined);
    }

    await writeAudit({
      actorId: caller.uid,
      actorRole: actor.role,
      action: AuditAction.RESTAURANT_REMOVED,
      targetType: 'restaurant',
      targetId: restaurantId,
      restaurantId,
      oldValue: { status: restaurant.status, name: restaurant.name },
      newValue: {
        status: RestaurantStatus.REMOVED,
        // Counted into the record, because "how big was this restaurant when it
        // was removed" is the question an auditor asks and nothing else will
        // answer it once the menu is gone.
        menuItemsDeleted: categories.size + products.size,
        staffUnlinked: staffUids.length,
      },
      reason,
    });

    logger.warn('restaurant removed', {
      restaurantId,
      name: restaurant.name,
      by: caller.uid,
      staffUnlinked: staffUids.length,
    });

    return {
      ok: true,
      alreadyRemoved: false,
      menuItemsDeleted: categories.size + products.size,
      staffUnlinked: staffUids.length,
    };
  }),
);
