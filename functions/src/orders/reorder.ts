/**
 * QAPINDA — "The same again."
 *
 * The most pressed button in any food app, and the one this platform did not
 * have: the home screen carried a "Yenidən sifariş et" section that only linked
 * back to the restaurant, leaving the customer to rebuild a six-item basket by
 * hand.
 *
 * WHY IT IS A SERVER CALL AND NOT A CLIENT LOOP
 * ---------------------------------------------
 * An order is a photograph. It holds the dish names, the prices and the chosen
 * options exactly as they were on the night — which is right for a receipt and
 * useless for a basket, because a menu moves. Between then and now a dish can
 * be delisted, sold out, renamed, repriced, or have the very option the
 * customer picked ("no onions", "large") removed from it.
 *
 * Rebuilding the basket from the snapshot alone would put a dish at last
 * month's price into a cart that the checkout then re-prices — so the customer
 * agrees to one number and is charged another, which is exactly the surprise
 * `expectedSubtotal` exists to prevent. So every line is resolved against the
 * live menu here, and what comes back is not "the old order" but "what of the
 * old order you can actually have tonight", with each difference named.
 *
 * NOTHING IS ADDED TO A CART BY THIS CALL. It answers a question; the customer
 * decides.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser } from '../lib/auth';
import { asObject, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { paths } from '../shared/collections';
import { ProductAvailability, RestaurantStatus, ServiceState } from '../shared/enums';
import type { Order, Product, Restaurant } from '../shared/models';

/**
 * What happened to one line between the old order and tonight.
 *
 * Ordered from "fine" to "gone", and every one of them is shown to the
 * customer. A reorder that silently drops the dish somebody actually wanted is
 * worse than one that refuses.
 */
export type ReorderLineState =
  /** Same dish, same price, same options. */
  | 'OK'
  /** Still available, but it costs something different now. */
  | 'PRICE_CHANGED'
  /** Some of the chosen options no longer exist or have sold out. */
  | 'OPTIONS_CHANGED'
  /** On the menu, but marked sold out today. */
  | 'UNAVAILABLE'
  /** Deleted from the menu, or hidden. */
  | 'GONE';

export const prepareReorder = onCall(
  guard('prepareReorder', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const orderId = requireString(data, 'orderId', { max: 128 });

    const orderSnapshot = await db.doc(paths.order(orderId)).get();
    if (!orderSnapshot.exists) fail(AppErrorCode.ORDER_NOT_FOUND);

    const order = orderSnapshot.data() as Order;
    // Their own order. Somebody else's is somebody else's shopping, their
    // address's neighbourhood and their taste in food.
    if (order.customerId !== caller.uid) fail(AppErrorCode.FORBIDDEN);

    const restaurantSnapshot = await db.doc(paths.restaurant(order.restaurantId)).get();
    const restaurant = restaurantSnapshot.data() as Restaurant | undefined;

    /*
     * A restaurant that has left the platform is the end of the conversation.
     *
     * Being CLOSED right now is not: a customer looking at last Friday's order
     * on a Tuesday morning should still be able to fill their basket and order
     * when the shop opens. So closed is reported and not refused, and only
     * "gone from the platform" stops here.
     */
    const restaurantAvailable = restaurant?.status === RestaurantStatus.ACTIVE;

    // Read once, in one call, rather than a query per line: a ten-item order is
    // one round trip.
    const productIds = [...new Set(order.items.map((item) => item.productId))];
    const documents = productIds.length
      ? await db.getAll(...productIds.map((id) => db.doc(paths.product(id))))
      : [];

    const products = new Map<string, Product>();
    for (const doc of documents) {
      if (doc.exists) products.set(doc.id, doc.data() as Product);
    }

    const lines = order.items.map((item) => {
      const product = products.get(item.productId);

      if (
        !product ||
        product.restaurantId !== order.restaurantId ||
        product.availability === ProductAvailability.HIDDEN
      ) {
        return {
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          state: 'GONE' as ReorderLineState,
          selectedOptionIds: [] as string[],
          previousUnitPrice: item.unitPrice,
          unitPrice: null as number | null,
          droppedOptions: [] as string[],
        };
      }

      /*
       * The options, checked one by one against today's menu.
       *
       * An id that no longer exists, or an option switched off because the
       * kitchen has run out, is dropped — and named, so the customer can see
       * that the "extra cheese" they ordered last week is not in this basket
       * rather than discovering it at the door.
       */
      const live = new Set(
        product.modifierGroups.flatMap((group) =>
          group.options.filter((option) => option.available).map((option) => option.id),
        ),
      );

      const previousOptionIds = item.modifiers.map((modifier) => modifier.optionId);
      const selectedOptionIds = previousOptionIds.filter((id) => live.has(id));
      const droppedOptions = item.modifiers
        .filter((modifier) => !live.has(modifier.optionId))
        .map((modifier) => modifier.optionName);

      const state: ReorderLineState =
        product.availability === ProductAvailability.OUT_OF_STOCK_TODAY
          ? 'UNAVAILABLE'
          : droppedOptions.length > 0
            ? 'OPTIONS_CHANGED'
            : product.price !== item.unitPrice
              ? 'PRICE_CHANGED'
              : 'OK';

      return {
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        state,
        selectedOptionIds,
        previousUnitPrice: item.unitPrice,
        unitPrice: product.price,
        droppedOptions,
      };
    });

    return {
      ok: true,
      restaurantId: order.restaurantId,
      restaurantName: order.restaurantName,
      restaurantAvailable,
      // Whether they can order right now, as opposed to at all. The screen says
      // "closed — you can still fill your basket", which is the truth.
      restaurantOpen: restaurant?.serviceState === ServiceState.OPEN,
      lines,
      /*
       * The products themselves, for the lines that can be added.
       *
       * Sent back so the cart can be filled without a second round of reads
       * from the browser — and, more to the point, so the cart holds TODAY's
       * price and today's option list rather than the photograph's.
       */
      products: lines
        .filter((line) => line.state !== 'GONE')
        .map((line) => products.get(line.productId))
        .filter((product): product is Product => Boolean(product)),
    };
  }),
);
