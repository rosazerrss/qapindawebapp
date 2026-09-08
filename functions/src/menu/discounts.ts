/**
 * QAPINDA — which restaurants have something on offer.
 *
 * THE QUESTION AND WHY IT IS AWKWARD
 * ----------------------------------
 * The shopfront wants to mark a restaurant that is running a discount. That is
 * one boolean per card, and the shopfront already has the restaurant document
 * in hand — so the only problem is putting the answer there.
 *
 * It cannot be asked directly. "A dish whose `compareAtPrice` is above its
 * `price`" compares two fields against each other, and Firestore cannot query
 * that at all: every `where` compares a field to a VALUE. Reading a restaurant's
 * whole menu to find out would be four hundred documents per card on a screen
 * showing twenty cards.
 *
 * So the comparison is done once, at write time, and stored as a plain boolean
 * on the dish — `discounted` — which IS queryable. The restaurant then carries
 * a `hasDiscount` flag recomputed from a single `limit(1)` query after any menu
 * change: one read to answer a question the shopfront would otherwise pay
 * thousands for.
 *
 * WHY `discounted` IS FALSE FOR A HIDDEN DISH
 * -------------------------------------------
 * A hidden dish is not on the menu, so a discount on it is not an offer to
 * anybody. Folding that into the stored value rather than into the query keeps
 * the query a single equality — and keeps the shopfront from advertising a
 * saving nobody can take.
 */

import { db, now } from '../lib/admin';
import { COLLECTIONS, paths } from '../shared/collections';
import { isDiscountedProduct } from '../shared/pricing';

/**
 * Is this dish, as saved, actually on offer to a customer right now?
 *
 * The rule itself lives in `shared/pricing.ts` because the menu screen draws
 * its mark from the same question, and a second copy of it here is how the
 * badge on a restaurant card and the badge in its menu end up disagreeing.
 */
export const isDiscounted = isDiscountedProduct;

/**
 * Recomputes the restaurant's flag from its menu.
 *
 * Derived rather than incremented. An increment on save and a decrement on
 * delete is cheaper by one read and wrong the first time anything goes
 * sideways — a failed write, a bulk price change that flipped ten dishes at
 * once, a backfill run twice — and a counter that drifts here shows a discount
 * badge on a restaurant that has none, which is the one outcome worth avoiding.
 *
 * One `limit(1)` query: it asks "is there at least one", not "how many",
 * because the shopfront only ever renders a yes or a no.
 *
 * Failure is swallowed on purpose. This runs after the menu write has already
 * committed, and a badge that is briefly stale must never turn a successful
 * menu save into an error the restaurant sees.
 */
export async function refreshDiscountFlag(restaurantId: string): Promise<void> {
  try {
    const found = await db
      .collection(COLLECTIONS.products)
      .where('restaurantId', '==', restaurantId)
      .where('discounted', '==', true)
      .limit(1)
      .get();

    await db.doc(paths.restaurant(restaurantId)).update({
      hasDiscount: !found.empty,
      updatedAt: now(),
    });
  } catch {
    // Left as it was. The next menu save, or the backfill, corrects it.
  }
}
