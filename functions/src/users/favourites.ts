/**
 * QAPINDA — Favourites.
 *
 * A shortlist of dishes and restaurants, private to the customer.
 *
 * The display fields (name, price, photo) are copied onto the favourite rather
 * than looked up later. That makes the favourites page a single query instead
 * of one read per saved item, and it means a deleted dish still shows what was
 * saved rather than vanishing without explanation. The price shown there is a
 * memory, not a promise — the cart re-reads the real one.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, now } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser } from '../lib/auth';
import { asObject, requireEnum, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { favouriteId, paths } from '../shared/collections';
import type { Product, Restaurant } from '../shared/models';

const MAX_FAVOURITES = 300;

export const toggleFavourite = onCall(
  guard('toggleFavourite', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);

    const kind = requireEnum(data, 'kind', ['PRODUCT', 'RESTAURANT'] as const);
    const targetId = requireString(data, 'targetId', { max: 128 });

    const ref = db.doc(paths.userFavourite(caller.uid, favouriteId(kind, targetId)));
    const existing = await ref.get();

    // A toggle, so the client never has to track which state it is in.
    if (existing.exists) {
      await ref.delete();
      return { ok: true, saved: false };
    }

    const count = await db.collection(paths.userFavourites(caller.uid)).count().get();
    if (count.data().count >= MAX_FAVOURITES) fail(AppErrorCode.CONFLICT, 'too-many');

    if (kind === 'PRODUCT') {
      const productSnap = await db.doc(paths.product(targetId)).get();
      if (!productSnap.exists) fail(AppErrorCode.PRODUCT_NOT_FOUND);
      const product = productSnap.data() as Product;

      const restaurantSnap = await db.doc(paths.restaurant(product.restaurantId)).get();
      const restaurant = restaurantSnap.data() as Restaurant | undefined;

      await ref.set({
        id: ref.id,
        kind,
        productId: product.id,
        restaurantId: product.restaurantId,
        name: product.name,
        restaurantName: restaurant?.name ?? '',
        restaurantSlug: restaurant?.slug ?? '',
        imageUrl: product.imageUrl,
        price: product.price,
        createdAt: now(),
      });
    } else {
      const restaurantSnap = await db.doc(paths.restaurant(targetId)).get();
      if (!restaurantSnap.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
      const restaurant = restaurantSnap.data() as Restaurant;

      await ref.set({
        id: ref.id,
        kind,
        productId: null,
        restaurantId: restaurant.id,
        name: restaurant.name,
        restaurantName: restaurant.name,
        restaurantSlug: restaurant.slug,
        imageUrl: restaurant.logoUrl ?? restaurant.coverUrl,
        price: null,
        createdAt: now(),
      });
    }

    return { ok: true, saved: true };
  }),
);
