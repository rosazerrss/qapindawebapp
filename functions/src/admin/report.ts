/**
 * QAPINDA — the platform's own numbers.
 *
 * The restaurant report answers "what did I sell". This answers "what is the
 * marketplace doing": orders per day, commission earned, which restaurants
 * carry the volume, and how many orders never made it.
 *
 * Same principle as the restaurant report — derived from the orders themselves,
 * never from a counter that can drift, and always from the frozen snapshots so
 * a renamed restaurant keeps its history.
 */

import { logger } from 'firebase-functions/v2';
import { onCall } from 'firebase-functions/v2/https';

import { db, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requirePermission } from '../lib/auth';
import { asObject, requireInt } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { COLLECTIONS } from '../shared/collections';
import { OrderStatus } from '../shared/enums';
import { Permission } from '../shared/permissions';
import { calculateCommission, orderFundingSplit } from '../shared/pricing';
import type { Order } from '../shared/models';

/** Reading more than this in one screen helps nobody. */
const MAX_ORDERS = 6000;

export const platformReport = onCall(
  /*
   * More room than the platform default, because this one call reads a whole
   * period of orders in a single pass.
   *
   * Everything else here answers a question about one order or one restaurant
   * and fits comfortably in the 256MiB the global options set; this reads up to
   * `MAX_ORDERS` documents and holds them all while it sums them. A function
   * that runs out of memory or time does not fail politely — it is killed, the
   * caller is handed a bare `internal`, and the screen shows "Xəta baş verdi"
   * with nothing to say which of the two happened. Giving the one heavy report
   * its own headroom is cheaper than that sentence.
   */
  { memory: '512MiB', timeoutSeconds: 120 },
  guard('platformReport', async (request) => {
    const { caller } = await requireActiveUser(request);
    /*
     * Two permissions, because this answers two questions.
     *
     * It was guarded by PLATFORM_VIEW_ORDERS alone — which an operator has,
     * and rightly: seeing the order queue is the job. But what comes back is
     * not a queue, it is the platform's revenue, its commission and its
     * per-restaurant takings, and the admin panel simply never drew that page
     * for an operator. A page not drawn is not a permission not granted: the
     * function answered anyone who called it.
     */
    requirePermission(caller, Permission.PLATFORM_VIEW_ORDERS);
    requirePermission(caller, Permission.PLATFORM_VIEW_LEDGER);

    const data = asObject(request.data);
    const fromMs = requireInt(data, 'from', { min: 0 });
    const toMs = requireInt(data, 'to', { min: 0 });
    if (toMs <= fromMs) fail(AppErrorCode.VALIDATION_FAILED, 'range');
    if (toMs - fromMs > 750 * 24 * 60 * 60 * 1000) fail(AppErrorCode.VALIDATION_FAILED, 'range');

    const from = Timestamp.fromMillis(fromMs);
    const to = Timestamp.fromMillis(toMs);

    /*
     * Everything placed in the window, so cancellations are visible too, and
     * inside it what completed. `placedAt` is the honest axis for "how busy
     * were we"; money only counts once an order completes.
     *
     * The read has its own failure, told apart from a crash.
     *
     * A refused or timed-out query used to arrive at the browser as a bare
     * INTERNAL — the same "Xəta baş verdi. Yenidən cəhd edin." a genuine bug
     * produces — which left the date range looking broken with no way to tell
     * a slow evening from a real fault. `REPORT_UNAVAILABLE` says what actually
     * happened, and the screen offers the retry that answer deserves.
     */
    let snapshot;
    try {
      snapshot = await db
        .collection(COLLECTIONS.orders)
        .where('placedAt', '>=', from)
        .where('placedAt', '<=', to)
        .orderBy('placedAt', 'desc')
        .limit(MAX_ORDERS + 1)
        .get();
    } catch (error) {
      logger.error('platformReport could not read the orders', {
        from: fromMs,
        to: toMs,
        message: error instanceof Error ? error.message : String(error),
      });
      fail(AppErrorCode.REPORT_UNAVAILABLE);
    }

    const truncated = snapshot.size > MAX_ORDERS;
    const orders = snapshot.docs.slice(0, MAX_ORDERS).map((doc) => doc.data() as Order);

    let placed = 0;
    let completed = 0;
    let cancelled = 0;
    let grossSales = 0;
    let commission = 0;
    let platformCredits = 0;

    const byDay = new Map<string, { orders: number; revenue: number; commission: number }>();
    const byRestaurant = new Map<string, { name: string; orders: number; revenue: number }>();

    /*
     * One malformed order must not blank the whole dashboard.
     *
     * This collection has outlived two schema changes. A document written
     * before `pricing` took its current shape, or before the coupon funding
     * split existed, throws a TypeError the moment the arithmetic below reaches
     * into it — and a throw here is not a wrong number on one row, it is the
     * entire İcmal screen replaced by "Xəta baş verdi", which is exactly what
     * was reported. So each order is summed inside its own try, and a document
     * that cannot be read is counted as skipped rather than taken down with it.
     *
     * `skipped` is returned rather than swallowed: a report quietly missing
     * orders is worse than one that says how many it could not read.
     */
    let skipped = 0;

    for (const order of orders) {
      try {
      placed += 1;

      const day = dayKey(order.placedAt);
      const bucket = byDay.get(day) ?? { orders: 0, revenue: 0, commission: 0 };
      bucket.orders += 1;

      if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.EXPIRED) {
        cancelled += 1;
        byDay.set(day, bucket);
        continue;
      }

      if (order.status !== OrderStatus.COMPLETED) {
        byDay.set(day, bucket);
        continue;
      }

      completed += 1;
      const subtotal = order.pricing?.subtotal ?? 0;
      grossSales += subtotal;

      const money =
        order.commissionAmount !== null && order.commissionAmount !== undefined
          ? {
              amount: order.commissionAmount,
              platformFundedDiscount: order.platformFundedDiscount ?? 0,
            }
          : calculateCommission({
              subtotal,
              restaurantFunded: orderFundingSplit(order).restaurant,
              platformFunded: orderFundingSplit(order).platform,
              commissionRateBps: order.commissionRateBps ?? 0,
            });

      commission += money.amount;
      platformCredits += money.platformFundedDiscount;

      bucket.revenue += subtotal;
      bucket.commission += money.amount;
      byDay.set(day, bucket);

      const restaurant = byRestaurant.get(order.restaurantId) ?? {
        name: order.restaurantName,
        orders: 0,
        revenue: 0,
      };
      restaurant.orders += 1;
      restaurant.revenue += subtotal;
      byRestaurant.set(order.restaurantId, restaurant);
      } catch (error) {
        skipped += 1;
        logger.warn('platformReport skipped an unreadable order', {
          orderId: (order as { id?: string }).id ?? null,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: true,
      from: fromMs,
      to: toMs,
      truncated,
      skipped,
      totals: {
        placed,
        completed,
        cancelled,
        grossSales,
        commission,
        platformCredits,
        netCommission: commission - platformCredits,
        averageOrder: completed > 0 ? Math.round(grossSales / completed) : 0,
        // The share that never became food. Basis points, so no float creeps in.
        cancelRateBps: placed > 0 ? Math.round((cancelled / placed) * 10000) : 0,
      },
      daily: [...byDay.entries()]
        .map(([day, value]) => ({ day, ...value }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      restaurants: [...byRestaurant.entries()]
        .map(([restaurantId, value]) => ({ restaurantId, ...value }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 12),
    };
  }),
);

/** YYYY-MM-DD in Baku time — the day the office thinks in. */
function dayKey(value: { toMillis?: () => number } | null): string {
  const millis = value?.toMillis?.() ?? Date.now();
  return new Date(millis + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
