/**
 * QAPINDA — Sales reports.
 *
 * "How many döner did I sell last month, and what did it bring in?"
 *
 * Computed from completed orders on demand rather than from running counters.
 * A counter is faster but drifts: one missed increment and the number is quietly
 * wrong forever, with nothing to reconcile it against. Reading the orders means
 * the report can always be re-derived from the same records the invoice uses.
 *
 * Every figure comes from the order's own frozen snapshot — the item names and
 * prices as they were sold, not as the menu reads today. A restaurant that
 * raised its prices in March still sees February at February's prices.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requireRestaurantAccess } from '../lib/auth';
import { asObject, requireInt, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { COLLECTIONS, paths } from '../shared/collections';
import { FAILED_ORDER_STATUSES, OrderStatus } from '../shared/enums';
import { Permission } from '../shared/permissions';
import { calculateCommission, orderFundingSplit } from '../shared/pricing';
import type { Order } from '../shared/models';

/**
 * How many orders one report will read.
 *
 * A busy restaurant over a year could exceed this. Rather than silently
 * truncating — which would understate their own takings — the response says so
 * and the screen tells them to narrow the range.
 */
const MAX_ORDERS = 4000;

interface ProductLine {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
  orderCount: number;
}

export const restaurantReport = onCall(
  guard('restaurantReport', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);

    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    requireRestaurantAccess(caller, Permission.RESTAURANT_VIEW_FINANCE, restaurantId);

    const fromMs = requireInt(data, 'from', { min: 0 });
    const toMs = requireInt(data, 'to', { min: 0 });
    if (toMs <= fromMs) fail(AppErrorCode.VALIDATION_FAILED, 'range');
    // Two years is already far more than anyone reads in one screen.
    if (toMs - fromMs > 750 * 24 * 60 * 60 * 1000) fail(AppErrorCode.VALIDATION_FAILED, 'range');

    /*
     * Three reads, in parallel: what sold, what went wrong, and at what rate.
     *
     * The cancellations are counted by `placedAt` rather than by an end time,
     * because an order that expired unanswered has no meaningful end — it is
     * the day it was PLACED that the restaurant thinks about when they ask why
     * a Tuesday was bad.
     *
     * The commission rate comes from the restaurant's private business
     * document, which no client can read. Returning it here is what lets the
     * admin's screen and the restaurant's own screen show the same rate beside
     * the same commission figure rather than each guessing at the default.
     */
    const [snapshot, failedSnap, businessSnap] = await Promise.all([
      db
        .collection(COLLECTIONS.orders)
        .where('restaurantId', '==', restaurantId)
        .where('status', '==', OrderStatus.COMPLETED)
        .where('completedAt', '>=', Timestamp.fromMillis(fromMs))
        .where('completedAt', '<=', Timestamp.fromMillis(toMs))
        .orderBy('completedAt', 'desc')
        .limit(MAX_ORDERS + 1)
        .get(),
      db
        .collection(COLLECTIONS.orders)
        .where('restaurantId', '==', restaurantId)
        .where('status', 'in', FAILED_ORDER_STATUSES)
        .where('placedAt', '>=', Timestamp.fromMillis(fromMs))
        .where('placedAt', '<=', Timestamp.fromMillis(toMs))
        .orderBy('placedAt', 'desc')
        .limit(MAX_ORDERS)
        .get(),
      db.doc(paths.restaurantBusiness(restaurantId)).get(),
    ]);

    /** How many ended each way, so "cancelled" is not one undifferentiated lump. */
    const failedByStatus: Record<string, number> = {};
    let failedValue = 0;
    /*
     * The two failures that are the RESTAURANT's own, counted apart.
     *
     * A customer changing their mind and a kitchen refusing an order both end
     * up in this list, and only one of them says anything about how the
     * restaurant is run. Rejections and expiries are the restaurant's; a
     * customer cancellation is not, and folding them together would produce a
     * number that punishes a shop for its customers' second thoughts.
     */
    let rejectedCount = 0;
    let expiredCount = 0;

    for (const doc of failedSnap.docs) {
      const order = doc.data() as Order;
      failedByStatus[order.status] = (failedByStatus[order.status] ?? 0) + 1;
      failedValue += order.pricing?.subtotal ?? 0;

      if (order.status === OrderStatus.REJECTED) rejectedCount += 1;
      if (order.status === OrderStatus.EXPIRED) expiredCount += 1;
    }

    const truncated = snapshot.size > MAX_ORDERS;
    const orders = snapshot.docs.slice(0, MAX_ORDERS).map((doc) => doc.data() as Order);

    let grossSales = 0;
    let deliveryFees = 0;
    let discounts = 0;
    let commission = 0;
    let platformCredits = 0;
    let itemsSold = 0;

    const byProduct = new Map<string, ProductLine>();
    /** Turnover per day, for the little bar chart. */
    const byDay = new Map<string, { revenue: number; orders: number }>();

    /*
     * HOW WELL THE KITCHEN IS ACTUALLY RUN.
     *
     * Three numbers, and each is chosen because a restaurant can do something
     * about it — a metric nobody can move is a metric nobody reads.
     *
     * `answerMinutes` is how long the kitchen took to accept, measured from the
     * order arriving. It is the one thing a waiting customer feels most and the
     * one an operator is rung about; it is also entirely within the shop's
     * control.
     *
     * `prepMinutes` is what the kitchen SAID it would take, averaged. Compared
     * against the deliveries that then went out late, it is how a restaurant
     * learns its own estimate is optimistic.
     *
     * Both are averaged over the orders that carry the timestamps, not over
     * every order — an order accepted before these fields existed contributes
     * nothing rather than a zero, which would drag an average down to say
     * something untrue.
     */
    let answerMinutesTotal = 0;
    let answerMinutesCount = 0;
    let prepMinutesTotal = 0;
    let prepMinutesCount = 0;

    for (const order of orders) {
      grossSales += order.pricing.subtotal;

      const placedMs = order.placedAt?.toMillis?.() ?? null;
      const acceptedMs = order.acceptedAt?.toMillis?.() ?? null;

      if (placedMs !== null && acceptedMs !== null && acceptedMs >= placedMs) {
        answerMinutesTotal += (acceptedMs - placedMs) / 60_000;
        answerMinutesCount += 1;
      }

      if (typeof order.prepMinutes === 'number' && order.prepMinutes > 0) {
        prepMinutesTotal += order.prepMinutes;
        prepMinutesCount += 1;
      }
      deliveryFees += order.pricing.deliveryFee;
      discounts += order.pricing.discount;

      // Prefer what was actually posted to the ledger; fall back to the same
      // calculation the ledger used, so an older order still reports honestly.
      const money =
        order.commissionAmount !== null
          ? {
              amount: order.commissionAmount,
              platformFundedDiscount: order.platformFundedDiscount ?? 0,
            }
          : calculateCommission({
              subtotal: order.pricing.subtotal,
              restaurantFunded: orderFundingSplit(order).restaurant,
              platformFunded: orderFundingSplit(order).platform,
              commissionRateBps: order.commissionRateBps,
            });

      commission += money.amount;
      platformCredits += money.platformFundedDiscount;

      const day = dayKey(order.completedAt);
      const bucket = byDay.get(day) ?? { revenue: 0, orders: 0 };
      bucket.revenue += order.pricing.subtotal;
      bucket.orders += 1;
      byDay.set(day, bucket);

      const seenInThisOrder = new Set<string>();

      for (const item of order.items) {
        itemsSold += item.quantity;

        const line = byProduct.get(item.productId) ?? {
          productId: item.productId,
          // The name as it was sold. A renamed dish keeps its old history.
          name: item.name,
          quantity: 0,
          revenue: 0,
          orderCount: 0,
        };

        line.quantity += item.quantity;
        line.revenue += item.lineTotal;

        // One order counts once per dish, however many of it were bought.
        if (!seenInThisOrder.has(item.productId)) {
          line.orderCount += 1;
          seenInThisOrder.add(item.productId);
        }

        byProduct.set(item.productId, line);
      }
    }

    const products = [...byProduct.values()].sort((a, b) => b.quantity - a.quantity);

    return {
      ok: true,
      from: fromMs,
      to: toMs,
      truncated,
      // Null when the restaurant has no rate of its own and the platform
      // default applies. Said as null rather than as the default, because the
      // two are different facts and only one of them is agreed with anybody.
      commissionRateBps:
        (businessSnap.data()?.commissionRateBps as number | undefined) ?? null,
      totals: {
        orderCount: orders.length,
        itemsSold,
        grossSales,
        deliveryFees,
        discounts,
        commission,
        platformCredits,
        // What the restaurant keeps: food + delivery − commission + credits.
        netToRestaurant: grossSales + deliveryFees - discounts - commission + platformCredits,
        averageOrder: orders.length > 0 ? Math.round(grossSales / orders.length) : 0,
        /** Rejected, cancelled, expired and failed deliveries, together. */
        failedCount: failedSnap.size,
        failedValue,
        failedByStatus,

        /*
         * ACCEPTANCE RATE.
         *
         * Completed orders over everything the kitchen was asked to cook — its
         * own refusals and the ones it let time out, but NOT the ones the
         * customer cancelled. Null rather than 100% when there was nothing to
         * accept: a shop with no orders has not achieved a perfect record.
         */
        acceptanceRate:
          orders.length + rejectedCount + expiredCount > 0
            ? Math.round(
                (orders.length / (orders.length + rejectedCount + expiredCount)) * 100,
              )
            : null,
        rejectedCount,
        expiredCount,

        /** Minutes from the order arriving to the kitchen accepting it. */
        averageAnswerMinutes:
          answerMinutesCount > 0 ? Math.round(answerMinutesTotal / answerMinutesCount) : null,
        /** What the kitchen said the food would take, averaged. */
        averagePrepMinutes:
          prepMinutesCount > 0 ? Math.round(prepMinutesTotal / prepMinutesCount) : null,
      },
      products,
      daily: [...byDay.entries()]
        .map(([day, value]) => ({ day, ...value }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    };
  }),
);

/** YYYY-MM-DD in Baku time — the day the restaurant thinks in. */
function dayKey(value: { toMillis?: () => number } | null): string {
  const millis = value?.toMillis?.() ?? Date.now();
  const local = new Date(millis + 4 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}
