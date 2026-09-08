/**
 * QAPINDA — a suspended restaurant's menu stops being public.
 *
 * THE HOLE THIS CLOSES
 * --------------------
 * Suspending a restaurant hid the restaurant. It did not hide its dishes.
 *
 * The rule on `restaurants` already refuses any document that is not ACTIVE, so
 * the shopfront grid drops it, the search callable skips it, and its own page
 * answers "not found". Every route a customer can walk was closed. The dishes
 * were not on any of those routes: `products` allowed a read of anything that
 * was not HIDDEN, full stop, and a `restaurantId` is not a secret — it is in
 * every URL that restaurant ever had. So the menu of a shop that was suspended
 * for selling something it should not have been remained readable to anybody
 * who asked for it directly, complete with prices and photographs.
 *
 * WHY A STORED BOOLEAN AND NOT A LOOKUP IN THE RULE
 * -------------------------------------------------
 * A security rule CAN read the restaurant document — `get(/databases/.../
 * restaurants/$(...))` — and it is the obvious answer. It is also a billed
 * document read per product evaluated, and a menu is read as one query of up to
 * four hundred products. That is four hundred extra reads every time somebody
 * opens a restaurant, to answer a question whose value changes perhaps twice in
 * a restaurant's life.
 *
 * So the answer is written onto the dishes when it changes, exactly as
 * `discounted` is, and the rule reads a field. The write cost lands on
 * suspension, which is rare; the read cost is zero, on the path a hungry person
 * is waiting on.
 *
 * WHY THE RULE ASKS `!= false` AND NOT `== true`
 * ----------------------------------------------
 * Every dish saved before this existed has no such field. Under `== true` all
 * of them would become unreadable the moment the rule deployed — every menu on
 * the platform dark until a backfill finished, which is a far worse outcome
 * than the hole being closed an hour late. `!= false` treats "not written yet"
 * as visible, so the deploy changes nothing until the flag is actually set, and
 * closes the moment it is.
 */

import { db, now } from '../lib/admin';
import { COLLECTIONS } from '../shared/collections';
import { RestaurantStatus } from '../shared/enums';

/**
 * Is a restaurant in this state supposed to be findable by a customer?
 *
 * ACTIVE and nothing else. A draft has never been approved, a pending one is
 * still being read by a human, a rejected one was refused, and a suspended one
 * was stopped on purpose — not one of those is a shop a customer should be able
 * to reach the menu of.
 */
export function isRestaurantVisible(status: RestaurantStatus | string | undefined): boolean {
  return status === RestaurantStatus.ACTIVE;
}

/** Batched at 400: Firestore refuses 500, and a smaller commit retries cheaply. */
const BATCH = 400;

/**
 * Writes the restaurant's visibility onto every one of its dishes.
 *
 * Paged rather than read whole, because a large menu is four hundred documents
 * and this runs inside a callable that has already done its real work.
 *
 * Failure is swallowed, deliberately and with a caveat. This runs AFTER the
 * status change has committed, and a suspension that reported failure because
 * the mirror did not finish would invite the admin to press again on a
 * restaurant that is already suspended. The status itself — the thing that
 * stops orders, hides the card and closes the page — is already correct. What a
 * failure here leaves behind is a menu still readable by direct query, which
 * the next status change or the search backfill repairs.
 */
export async function mirrorRestaurantVisibility(
  restaurantId: string,
  visible: boolean,
): Promise<void> {
  try {
    let after: string | null = null;

    for (;;) {
      let page = db
        .collection(COLLECTIONS.products)
        .where('restaurantId', '==', restaurantId)
        .orderBy('__name__')
        .limit(BATCH);

      if (after) page = page.startAfter(after);

      const snapshot = await page.get();
      if (snapshot.empty) return;

      const batch = db.batch();
      for (const doc of snapshot.docs) {
        batch.update(doc.ref, { restaurantVisible: visible, updatedAt: now() });
      }
      await batch.commit();

      if (snapshot.size < BATCH) return;
      after = snapshot.docs[snapshot.docs.length - 1]?.id ?? null;
      if (!after) return;
    }
  } catch {
    // See the note above: the status change itself has already landed.
  }
}
