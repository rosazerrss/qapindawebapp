/**
 * QAPINDA — "Who sells döner?"
 *
 * One word in, a list of restaurants out, each with the dishes that matched.
 * This is the query the home screen's search box makes when somebody types a
 * food rather than a restaurant name.
 *
 * It runs as a callable rather than from the browser for one reason: the
 * products collection is readable per restaurant, and a client-side search
 * would need a rule permitting an unscoped query across every menu on the
 * platform. Better a function that reads with the server's credentials and
 * returns only what a shopfront may show.
 *
 * A backfill exists alongside it because dishes saved before search existed
 * carry no tokens, and a search that silently misses old menus is worse than no
 * search at all.
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, now } from '../lib/admin';
import { guard } from '../lib/errors';
import { requireActiveUser, requirePermission } from '../lib/auth';
import { asObject, optionalString, requireString } from '../lib/validate';
import { COLLECTIONS, paths } from '../shared/collections';
import { ProductAvailability, RestaurantStatus, ServiceState } from '../shared/enums';
import { Permission } from '../shared/permissions';
import { buildSearchTokens, matchesAllTokens, primaryToken } from '../shared/search';
import { isDiscounted, refreshDiscountFlag } from './discounts';
import { isRestaurantVisible } from './visibility';
import type { Product, Restaurant } from '../shared/models';

/** Enough to fill a screen; a search that returns 500 rows is a list, not an answer. */
const MAX_MATCHES = 120;
const MAX_RESTAURANTS = 30;

/**
 * Dishes reindexed per call.
 *
 * Small enough that one page — the products, their restaurants, the batched
 * writes and the per-restaurant discount refresh — finishes inside a single
 * callable, and the button resumes rather than starting again if it does not.
 */
const BACKFILL_PAGE = 500;

export const searchMenu = onCall(
  guard('searchMenu', async (request) => {
    const data = asObject(request.data);
    const typed = requireString(data, 'term', { min: 2, max: 40 });
    // The most selective word goes to Firestore; the rest narrow the results
    // below. Sending only the first word — which is what this used to do —
    // meant "toyuq burger" returned every chicken dish on the platform.
    const term = primaryToken(typed);
    const regionId = optionalString(data, 'regionId', { max: 40 });

    // A term that folds to nothing (punctuation, a single letter) is not an
    // error — it is simply no search. Returning empty beats an error toast.
    if (!term) return { ok: true, term: '', restaurants: [] };

    const matches = await db
      .collection(COLLECTIONS.products)
      .where('searchTokens', 'array-contains', term)
      .limit(MAX_MATCHES)
      .get();

    // Group the dishes by restaurant before reading any restaurant document:
    // twenty döner from one kebab shop is one document, not twenty.
    const byRestaurant = new Map<string, string[]>();

    for (const doc of matches.docs) {
      const product = doc.data() as Product;
      if (product.availability === ProductAvailability.HIDDEN) continue;
      // Every word the customer typed, not just the one Firestore answered.
      if (!matchesAllTokens(product.searchTokens, typed)) continue;

      const names = byRestaurant.get(product.restaurantId) ?? [];
      if (names.length < 4) names.push(product.name);
      byRestaurant.set(product.restaurantId, names);
    }

    const ids = [...byRestaurant.keys()].slice(0, MAX_RESTAURANTS);
    if (ids.length === 0) return { ok: true, term, restaurants: [] };

    const documents = await db.getAll(...ids.map((id) => db.doc(paths.restaurant(id))));

    const restaurants = documents
      .filter((doc) => doc.exists)
      .map((doc) => doc.data() as Restaurant)
      // A restaurant awaiting approval or suspended has a menu in the database
      // and no business appearing in a customer's search results.
      .filter((restaurant) => restaurant.status === RestaurantStatus.ACTIVE)
      .filter((restaurant) => !regionId || restaurant.regionId === regionId)
      .map((restaurant) => ({
        restaurant,
        matchedProducts: byRestaurant.get(restaurant.id) ?? [],
      }))
      // Open first, then by rating — the same order the shopfront uses, so a
      // search does not reshuffle the world for no reason.
      .sort((a, b) => {
        const openGap =
          Number(b.restaurant.serviceState === ServiceState.OPEN) -
          Number(a.restaurant.serviceState === ServiceState.OPEN);
        if (openGap !== 0) return openGap;
        return (b.restaurant.ratingAverage ?? 0) - (a.restaurant.ratingAverage ?? 0);
      });

    return { ok: true, term, restaurants };
  }),
);

/**
 * Rebuilds every dish's search tokens.
 *
 * It used to skip any product that already had tokens, which made it a
 * one-off. That is no longer right: the token format itself changed — prefixes
 * and the restaurant's name are stored now — so a dish indexed under the old
 * scheme is a dish that cannot be found by three letters or by the name on the
 * shop's sign. It therefore rewrites everything, and stays safe to run again
 * because the tokens are derived, never accumulated.
 *
 * MUST BE RUN ONCE AFTER DEPLOYING. Until it is, existing menus keep their old
 * whole-word tokens and search behaves as it did before.
 */
export const backfillProductSearch = onCall(
  guard('backfillProductSearch', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_EDIT_SETTINGS);

    /*
     * PAGED, AND THE PAGE IS RESUMABLE.
     *
     * This used to be one `limit(2000)` with no cursor. It reported
     * `more: true` when it filled the page — honestly — and then had no way of
     * saying WHERE it stopped, so there was nothing the button could do with
     * that answer. Every press reindexed the same first two thousand dishes and
     * the rest of the catalogue stayed unindexed for ever.
     *
     * It has not shown itself yet because the platform has fewer than two
     * thousand dishes. It would show itself as menus that simply cannot be
     * found by search, with no error anywhere and a button that says "done".
     *
     * `orderBy('__name__')` is what makes a cursor possible at all: a page needs
     * a stable order, and the document id is the only field every product is
     * guaranteed to have. The page is smaller than it was — five hundred rather
     * than two thousand — because each page also reads its restaurants and
     * commits its batches inside one callable's time budget.
     */
    const data = asObject(request.data);
    const after = typeof data.after === 'string' ? data.after : null;

    let page = db.collection(COLLECTIONS.products).orderBy('__name__').limit(BACKFILL_PAGE);
    if (after) page = page.startAfter(after);

    const snapshot = await page.get();
    if (snapshot.empty) {
      return { ok: true, scanned: 0, updated: 0, more: false, last: null };
    }

    // Read once per restaurant, not once per dish: a shop with sixty items is
    // one document here, not sixty.
    const restaurantNames = new Map<string, string>();
    /** Whether each restaurant is public, so the dishes can carry the answer. */
    const restaurantVisible = new Map<string, boolean>();
    const ids = [...new Set(snapshot.docs.map((doc) => (doc.data() as Product).restaurantId))];

    for (let at = 0; at < ids.length; at += 100) {
      const slice = ids.slice(at, at + 100);
      const documents = await db.getAll(...slice.map((id) => db.doc(paths.restaurant(id))));
      for (const doc of documents) {
        if (!doc.exists) continue;
        const restaurant = doc.data() as Restaurant;
        restaurantNames.set(doc.id, restaurant.name);
        restaurantVisible.set(doc.id, isRestaurantVisible(restaurant.status));
      }
    }

    let updated = 0;
    let batch = db.batch();
    let pending = 0;

    for (const doc of snapshot.docs) {
      const product = doc.data() as Product;

      batch.update(doc.ref, {
        searchTokens: buildSearchTokens({
          name: product.name,
          description: product.description,
          restaurantName: restaurantNames.get(product.restaurantId) ?? null,
        }),
        // The dish's own discount flag, filled in for menus written before the
        // field existed. Same derivation as `saveProduct`, so a backfilled dish
        // and a freshly saved one mean the same thing by the same value.
        discounted: isDiscounted(product),
        /*
         * The flag the security rule reads.
         *
         * A dish whose restaurant document is missing gets `false` — the
         * conservative answer. A product with no shop behind it is not a menu
         * anybody should be reading, and treating "cannot tell" as "show it"
         * is how a rule quietly stops meaning anything.
         */
        restaurantVisible: restaurantVisible.get(product.restaurantId) ?? false,
        updatedAt: now(),
      });

      updated += 1;
      pending += 1;

      // Firestore refuses a batch over 500 writes; committing at 400 leaves
      // room and keeps each commit small enough to retry cheaply.
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }

    if (pending > 0) await batch.commit();

    /*
     * Then the restaurants, once each.
     *
     * After the dishes rather than during: the flag is derived from a query
     * over the dishes, so asking before they are written would answer from the
     * old data. `ids` is already deduplicated above, so a shop with sixty items
     * is refreshed once.
     */
    for (const restaurantId of ids) {
      await refreshDiscountFlag(restaurantId);
    }

    logger.info('backfillProductSearch', {
      scanned: snapshot.size,
      updated,
      restaurants: ids.length,
      after,
    });

    return {
      ok: true,
      scanned: snapshot.size,
      updated,
      more: snapshot.size === BACKFILL_PAGE,
      last: snapshot.docs[snapshot.docs.length - 1]?.id ?? null,
    };
  }),
);
