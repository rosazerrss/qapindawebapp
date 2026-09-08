/**
 * QAPINDA — Scheduled work.
 *
 * Some things must happen without anybody clicking anything:
 *
 *  - An order the restaurant never answered has to expire, or the customer sits
 *    watching a spinner while their dinner is not being cooked.
 *  - A delivered order has to settle, or the commission is never posted.
 *  - Somebody has to notice the things that did *not* happen — food that is
 *    still not ready, a driver who never accepted, a shop shut in the middle of
 *    its own opening hours. None of those is an event, so none of them can hang
 *    off a status hook; they are a clock, and this is where the clock lives.
 *
 * Every job here is idempotent and bounded: it takes a page of work at a time,
 * so a backlog cannot turn into a function that times out and never catches up.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import { db, now, Timestamp, FieldValue, REGION } from '../lib/admin';
import { resolveNotificationPrefs } from '../shared/notifications';
import { isOpenByHours } from '../shared/hours';
import { notify, notifyIn, notifyOperators, type OperatorAlertInput } from '../lib/notify';
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  commissionIdempotencyKey,
  onlineCollectedIdempotencyKey,
  paths,
  periodOf,
  platformDiscountIdempotencyKey,
} from '../shared/collections';
import {
  CancellationReason,
  LedgerEntryType,
  NotificationType,
  OrderActor,
  OrderStatus,
  PaymentStatus,
  RestaurantStatus,
  ServiceState,
  UserRole,
  isOnlinePayment,
} from '../shared/enums';
import { isCapturedPayment, type Payment } from '../shared/payments';
import {
  calculateCommission,
  orderFundingSplit,
  summariseLedger,
  type SettlementSummary,
} from '../shared/pricing';
import { writeSettlement } from '../lib/settlement';
import { OPERATOR_ROOT } from '../shared/permissions';
import { releaseCouponInBatch, releaseCouponRefs } from '../lib/coupon';
import { sendOrderReceipt } from './receiptEmail';
import type {
  LedgerEntry,
  Order,
  PublicSettings,
  Restaurant,
  TimestampLike,
  User,
} from '../shared/models';

const BATCH_SIZE = 100;
const DEFAULT_AUTO_COMPLETE_MINUTES = 60;

/**
 * Expires orders the restaurant did not answer in time.
 *
 * Runs every minute: a customer waiting on food notices ten minutes, and the
 * whole point of the response window is that it is honoured to the minute.
 */
export const expireStaleOrders = onSchedule(
  { schedule: 'every 1 minutes', region: REGION, timeoutSeconds: 120 },
  async () => {
    const overdue = await db
      .collection(COLLECTIONS.orders)
      .where('status', '==', OrderStatus.PLACED)
      .where('responseDeadlineAt', '<=', Timestamp.now())
      .limit(BATCH_SIZE)
      .get();

    if (overdue.empty) return;

    /*
     * The coupon redemptions these orders claimed, fetched in ONE round trip.
     *
     * An order the kitchen never answered was never really placed, so the
     * discount goes back on the shelf — see `lib/coupon.ts`. Read here rather
     * than inside the loop: a sweep handles a hundred orders and a read per
     * order would be a hundred round trips for a job that runs every minute.
     */
    const couponRefs = overdue.docs.map((doc) => releaseCouponRefs(doc.data() as Order));
    const redemptions = couponRefs.some(Boolean)
      ? await db.getAll(...couponRefs.filter((entry) => entry !== null).map((entry) => entry!.redemption))
      : [];
    const liveRedemptions = new Set(
      redemptions.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id),
    );

    const batch = db.batch();

    // Collected as the batch is built and raised after it commits: the roster
    // of operators is a query, and a query may not run once a batch is being
    // written. An alert that fails must never take an expiry with it.
    const alerts: OperatorAlertInput[] = [];

    for (const doc of overdue.docs) {
      const order = doc.data() as Order;

      /*
       * `lastUpdateTime` as a precondition — the order must not have moved
       * since the query read it.
       *
       * The window is small but real: this job runs every minute, and the
       * restaurant that accepts an order in the same second the sweep decides
       * it is overdue would otherwise have that acceptance overwritten with
       * EXPIRED. The kitchen starts cooking an order the customer has been
       * told is dead.
       *
       * A failed precondition aborts the whole batch, which is acceptable here
       * and needs no retry loop: the job runs again in sixty seconds, and the
       * order that raced is no longer PLACED, so it no longer matches the
       * query. The sweep converges by itself.
       */
      batch.update(doc.ref, {
        status: OrderStatus.EXPIRED,
        paymentStatus: PaymentStatus.NOT_COLLECTED,
        responseDeadlineAt: null,
        cancellation: {
          by: OrderActor.SYSTEM,
          reason: CancellationReason.RESTAURANT_TOO_BUSY,
          note: 'Restoran vaxtında cavab vermədi',
          at: now(),
        },
        updatedAt: now(),
      }, { lastUpdateTime: doc.updateTime });

      batch.set(db.collection(`${doc.ref.path}/${SUBCOLLECTIONS.orderEvents}`).doc(), {
        from: OrderStatus.PLACED,
        to: OrderStatus.EXPIRED,
        actor: OrderActor.SYSTEM,
        actorId: 'system',
        note: 'response window elapsed',
        at: now(),
      });

      // The customer is not notified. An order the kitchen never answered is
      // shown as expired on the order screen, which is where they are waiting.

      // A courier assigned before the kitchen ever answered is rare and worth
      // catching: it is a driver waiting outside a restaurant for food that is
      // not being cooked.
      if (order.courier) {
        notifyIn(batch, {
          userId: order.courier.id,
          role: UserRole.RESTAURANT_COURIER,
          restaurantId: order.restaurantId,
          orderId: order.id,
          type: NotificationType.COURIER_ORDER_CANCELLED,
          params: { code: order.code, restaurant: order.restaurantName },
          link: `/courier/history/${order.id}`,
        });
      }

      const refs = releaseCouponRefs(order);
      if (refs) {
        releaseCouponInBatch(batch, order, liveRedemptions.has(refs.redemption.id));
      }

      alerts.push({
        type: NotificationType.OPS_RESTAURANT_NO_RESPONSE,
        orderId: order.id,
        restaurantId: order.restaurantId,
        params: { code: order.code, restaurant: order.restaurantName },
        link: `${OPERATOR_ROOT}?order=${order.id}`,
      });
    }

    try {
      await batch.commit();
    } catch (error) {
      // A precondition failed: at least one order moved while this batch was
      // being built. Nothing is written, nothing is lost, and the next run in
      // sixty seconds sees the world as it now is.
      logger.warn('expire batch aborted, retrying next run', { error: String(error) });
      return;
    }

    for (const alert of alerts) {
      await notifyOperators(alert).catch(() => undefined);
    }

    logger.info('expired stale orders', { count: overdue.size });
  },
);

// ---------------------------------------------------------------------------
// The operational watch
// ---------------------------------------------------------------------------

/**
 * How long past the kitchen's own estimate counts as late.
 *
 * The restaurant said how long it would take; this is the grace on top of that
 * before an operator is told. Short enough that somebody can still ring the
 * kitchen and get the food moving, long enough that a shop running five minutes
 * behind on a Friday is not a queue of alerts.
 */
const LATE_GRACE_MINUTES = 15;

/**
 * How long a courier has to say they have the delivery.
 *
 * Assignment is the restaurant's decision, acceptance is the driver's, and this
 * is how long the platform waits for the second before deciding the order has
 * been handed to a phone nobody is looking at.
 */
const COURIER_ACCEPT_MINUTES = 10;

/**
 * How long out of contact makes a courier "offline".
 *
 * `lastSeenAt` is written by `touchSession` while the app is open. Twenty
 * minutes is well past a tunnel, a lift or a driver who put the phone down to
 * carry two bags up four flights.
 */
const COURIER_OFFLINE_MINUTES = 20;

/** Orders looked at per run. Bounded, so a bad evening cannot time the job out. */
const WATCH_LIMIT = 200;

/** Baku's calendar day, for alerts that may repeat once a day and no more. */
function bakuDay(at: Date): string {
  return new Date(at.getTime() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function millis(value: TimestampLike | null | undefined): number | null {
  return value?.toMillis?.() ?? null;
}

/**
 * Watches the orders that are already moving, and tells somebody when they stop.
 *
 * FOUR THINGS A STATUS HOOK CANNOT SEE
 * -----------------------------------
 * Every alert here is about something that did *not* happen: food that is not
 * ready, a driver who has not accepted, a phone that has stopped reporting in,
 * a delivery that is not arriving. There is no event to hang them on, which is
 * why they are a clock rather than a hook.
 *
 * WHY EACH ONE IS RAISED EXACTLY ONCE
 * -----------------------------------
 * A marker per alert on the order, written in the same batch as the alert. The
 * notification's own id would already collapse a repeat into a single document,
 * but a second write would mark it unread again and ring a second time — which
 * for `COURIER_DELIVERY_LATE` would be a driver's phone buzzing every five
 * minutes for the rest of the run. So the job skips what it has already
 * reported, and the id is the second line of defence rather than the first.
 */
export const watchActiveOrders = onSchedule(
  { schedule: 'every 5 minutes', region: REGION, timeoutSeconds: 300 },
  async () => {
    const moving = await db
      .collection(COLLECTIONS.orders)
      .where('status', 'in', [
        OrderStatus.ACCEPTED,
        OrderStatus.PREPARING,
        OrderStatus.READY,
        OrderStatus.OUT_FOR_DELIVERY,
      ])
      .orderBy('placedAt', 'desc')
      .limit(WATCH_LIMIT)
      .get();

    if (moving.empty) return;

    const orders = moving.docs.map((doc) => ({ ref: doc.ref, order: doc.data() as Order }));

    /*
     * Every read first, and all of them before the batch exists.
     *
     * The courier documents are needed to answer "is this driver online", and
     * they are fetched here — in one pass, de-duplicated, because a shop with
     * one driver out on six orders is one read, not six — rather than inside
     * the loop that writes. Reading after writing has cost this project a
     * production evening once already.
     */
    const courierIds = [
      ...new Set(
        orders
          .map(({ order }) => order.courier?.id)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];

    const courierDocs = courierIds.length
      ? await db.getAll(...courierIds.map((id) => db.doc(paths.user(id))))
      : [];

    const lastSeen = new Map<string, number | null>();
    for (const doc of courierDocs) {
      const user = doc.data() as User | undefined;
      lastSeen.set(doc.id, millis(user?.lastSeenAt));
    }

    const at = Date.now();
    const batch = db.batch();
    const alerts: OperatorAlertInput[] = [];
    /*
     * The customer is NOT told that their food is late.
     *
     * This job used to collect the late orders and notify each customer after
     * the batch committed. The owner removed it with the rest of the
     * order-status notifications, and it is the one whose removal is easiest to
     * defend: being told that the food you are already waiting for is late
     * tells you nothing you cannot see, on a screen you are already watching.
     * The operator still hears about it — that is OPS_RESTAURANT_LATE, and an
     * operator can ring the kitchen.
     */
    let flagged = 0;

    for (const { ref, order } of orders) {
      const raised: Record<string, unknown> = {};
      const link = `${OPERATOR_ROOT}?order=${order.id}`;
      const params = { code: order.code, restaurant: order.restaurantName };

      // --- The kitchen is behind ------------------------------------------
      //
      // Measured against the restaurant's own estimate, which is the only
      // promise anybody made. An order still not out of the kitchen well past
      // it is the alert an operator can act on by picking up a phone.
      const estimated = millis(order.estimatedDeliveryAt);
      const stillCooking =
        order.status === OrderStatus.ACCEPTED || order.status === OrderStatus.PREPARING;

      if (
        stillCooking &&
        !order.alerts?.lateAt &&
        estimated !== null &&
        at > estimated + LATE_GRACE_MINUTES * 60_000
      ) {
        raised.lateAt = now();
        alerts.push({
          type: NotificationType.OPS_RESTAURANT_LATE,
          orderId: order.id,
          restaurantId: order.restaurantId,
          params,
          link,
        });

      }

      if (order.courier) {
        const courierId = order.courier.id;
        const assignedAt = millis(order.courier.assignedAt);
        const accepted = Boolean(order.courier.acceptedAt);

        // --- Nobody has picked it up --------------------------------------
        if (
          !accepted &&
          !order.alerts?.courierUnacceptedAt &&
          assignedAt !== null &&
          at > assignedAt + COURIER_ACCEPT_MINUTES * 60_000
        ) {
          raised.courierUnacceptedAt = now();
          alerts.push({
            type: NotificationType.OPS_COURIER_NOT_ACCEPTED,
            orderId: order.id,
            restaurantId: order.restaurantId,
            params: { ...params, courier: order.courier.name },
            link,
          });
        }

        // --- The driver has gone quiet ------------------------------------
        //
        // Only while the order is actually moving. A courier who closed the app
        // after handing the food over is not a problem, and telling an operator
        // about one is how a queue fills with things nobody needs to read.
        const seen = lastSeen.get(courierId) ?? null;
        const quiet = seen === null || at > seen + COURIER_OFFLINE_MINUTES * 60_000;

        if (quiet && !order.alerts?.courierOfflineAt) {
          raised.courierOfflineAt = now();
          alerts.push({
            type: NotificationType.OPS_COURIER_OFFLINE,
            orderId: order.id,
            restaurantId: order.restaurantId,
            params: { ...params, courier: order.courier.name },
            link,
          });
        }

        // --- The delivery itself is late ----------------------------------
        //
        // Told to the driver, once. A phone that buzzes every five minutes for
        // the rest of a run is a phone that goes into a pocket.
        if (
          order.status === OrderStatus.OUT_FOR_DELIVERY &&
          !order.alerts?.deliveryLateAt &&
          estimated !== null &&
          at > estimated + LATE_GRACE_MINUTES * 60_000
        ) {
          raised.deliveryLateAt = now();

          notifyIn(batch, {
            userId: courierId,
            role: UserRole.RESTAURANT_COURIER,
            restaurantId: order.restaurantId,
            orderId: order.id,
            type: NotificationType.COURIER_DELIVERY_LATE,
            params,
            link: `/courier/orders/${order.id}`,
          });
        }
      }

      if (Object.keys(raised).length > 0) {
        // Merged into whatever markers the order already carries, so raising
        // one alert cannot erase the record of another.
        batch.set(ref, { alerts: raised, updatedAt: now() }, { merge: true });
        flagged += 1;
      }
    }

    await batch.commit();

    for (const alert of alerts) {
      await notifyOperators(alert).catch(() => undefined);
    }

    logger.info('watched active orders', {
      considered: orders.length,
      flagged,
      alerts: alerts.length,
    });
  },
);

/**
 * Notices a restaurant that is shut during its own opening hours.
 *
 * The one operational alert with no order behind it, and the one that would
 * otherwise repeat forever: a shop that closed early is still closed fifteen
 * minutes later, and an operator does not need to be told again. The dedupe key
 * carries the Baku date, so the alert lands once a day per restaurant however
 * often this job runs — the repetition is bounded by the key rather than by a
 * marker somebody has to remember to clear at midnight.
 */
export const watchRestaurantAvailability = onSchedule(
  { schedule: 'every 15 minutes', region: REGION, timeoutSeconds: 300 },
  async () => {
    const paused = await db
      .collection(COLLECTIONS.restaurants)
      .where('status', '==', RestaurantStatus.ACTIVE)
      .where('serviceState', 'in', [ServiceState.PAUSED, ServiceState.CLOSED])
      .limit(WATCH_LIMIT)
      .get();

    if (paused.empty) return;

    const at = new Date();
    const day = bakuDay(at);
    let raised = 0;

    for (const doc of paused.docs) {
      const restaurant = doc.data() as Restaurant;
      // Shut outside its own hours is not a problem — it is a shop being shut.
      if (!isOpenByHours(restaurant.openingHours, at)) continue;

      raised += 1;
      await notifyOperators({
        type: NotificationType.OPS_RESTAURANT_OFFLINE,
        restaurantId: restaurant.id,
        params: { restaurant: restaurant.name, state: restaurant.serviceState },
        link: `${OPERATOR_ROOT}?restaurant=${restaurant.id}`,
        occurrence: day,
      }).catch(() => undefined);
    }

    if (raised > 0) logger.info('restaurants offline during opening hours', { raised });
  },
);

/**
 * Settles delivered orders.
 *
 * A delivered order becomes COMPLETED after a grace period — long enough for a
 * customer to call about a missing item, short enough that the month closes.
 * The commission is posted here under the same idempotency keys the manual
 * transition uses, so an order settled by hand is never billed twice.
 */
/**
 * Puts a paused kitchen back on the shopfront when its pause runs out.
 *
 * The pause button used to be a switch with no other end: a restaurant that
 * paused for the twenty minutes it took to clear a backlog stayed paused until
 * a human pressed it again, and at nine on a Friday evening nobody does. The
 * shop lost the night, the customers saw a closed restaurant that was in fact
 * cooking, and the platform lost the orders.
 *
 * Only restaurants that named an end time are touched. `pausedUntil === null`
 * is an open-ended pause — a broken oven, a staff shortage — and re-opening one
 * of those would be worse than the problem this fixes.
 *
 * Every five minutes, because the shortest pause the panel offers is fifteen: a
 * shop is never shut for more than a third of its pause longer than it asked.
 */
export const resumePausedRestaurants = onSchedule(
  { schedule: 'every 5 minutes', region: REGION },
  async () => {
    const due = await db
      .collection(COLLECTIONS.restaurants)
      .where('serviceState', '==', ServiceState.PAUSED)
      .where('pausedUntil', '<=', Timestamp.fromMillis(Date.now()))
      .limit(200)
      .get();

    if (due.empty) return;

    const batch = db.batch();

    for (const doc of due.docs) {
      const restaurant = doc.data() as Restaurant;

      /*
       * Back to OPEN, or to CLOSED if the pause outlasted the working day.
       *
       * A shop that paused at half past eleven for an hour must not re-open at
       * half past midnight to take orders nobody is there to cook. The opening
       * hours decide, exactly as they do everywhere else.
       */
      batch.update(doc.ref, {
        serviceState: isOpenByHours(restaurant.openingHours, new Date())
          ? ServiceState.OPEN
          : ServiceState.CLOSED,
        pausedUntil: null,
        pausedMinutes: null,
        updatedAt: now(),
      });
    }

    await batch.commit();
    console.info('resumed paused restaurants', { count: due.size });
  },
);

/**
 * Ends promotions whose date has passed.
 *
 * WHY THIS EXISTS WHEN `badgeFor` ALREADY CHECKS THE DATE
 * -------------------------------------------------------
 * The screens are already correct without it: `badgeFor` compares
 * `featuredUntil` on every render, so an expired advert stops being drawn the
 * moment it expires whether or not this job ever runs. That belt is the one
 * that matters, and it is deliberately the one that cannot be forgotten.
 *
 * This is the braces. It clears the stored flag, so that:
 *
 *   • the admin's list does not show a restaurant as promoted when no customer
 *     can see it promoted — two screens telling different stories about the
 *     same document is how somebody sells the same slot twice;
 *   • any future query that filters on `featured` is filtering on something
 *     true, rather than on a flag that has quietly stopped meaning anything.
 *
 * Every five minutes, alongside the pause sweep, because both answer the same
 * question — has a clock run out on this restaurant — and one scheduled
 * function is one less thing to notice has stopped.
 */
export const expirePromotions = onSchedule(
  { schedule: 'every 5 minutes', region: REGION },
  async () => {
    const due = await db
      .collection(COLLECTIONS.restaurants)
      .where('featured', '==', true)
      .where('featuredUntil', '<=', Timestamp.fromMillis(Date.now()))
      .limit(200)
      .get();

    if (due.empty) return;

    const batch = db.batch();
    for (const doc of due.docs) {
      batch.update(doc.ref, {
        featured: false,
        // Cleared with it: a document that says SPONSORED but not featured is a
        // document the next reader has to think about.
        featuredKind: null,
        featuredUntil: null,
        updatedAt: now(),
      });
    }

    await batch.commit();
    console.info('expired promotions', { count: due.size });
  },
);

export const settleDeliveredOrders = onSchedule(
  { schedule: 'every 15 minutes', region: REGION, timeoutSeconds: 300 },
  async () => {
    const settingsSnap = await db.doc(paths.publicSettings()).get();
    const settings = settingsSnap.data() as PublicSettings | undefined;
    const graceMinutes = settings?.autoCompleteAfterMinutes ?? DEFAULT_AUTO_COMPLETE_MINUTES;

    const cutoff = Timestamp.fromMillis(Date.now() - graceMinutes * 60_000);

    const ready = await db
      .collection(COLLECTIONS.orders)
      .where('status', '==', OrderStatus.DELIVERED)
      .where('deliveredAt', '<=', cutoff)
      .limit(BATCH_SIZE)
      .get();

    if (ready.empty) return;

    let settled = 0;

    for (const doc of ready.docs) {
      const order = doc.data() as Order;

      /*
       * A WAIVED COMMISSION SKIPS THE COMMISSION, NOT THE WHOLE SETTLEMENT.
       *
       * This used to `continue` — complete the order and post nothing at all —
       * and for a cash order that is exactly right: no commission is charged
       * and no money passed through the platform, so there is nothing to book.
       *
       * For an ONLINE order it was a hole with the restaurant on the wrong side
       * of it. The customer paid Qapında; the platform is holding that money
       * and owes it on. `ONLINE_COLLECTED` is the entry that records the debt,
       * and skipping the whole settlement skipped that too — so a restaurant
       * that suffered a complaint, had its commission waived as an apology, was
       * then never paid for the meal at all. The apology cost it the order.
       *
       * So the waiver now suppresses one entry, not three. `commission.amount`
       * is forced to zero and everything else proceeds normally.
       */
      const commissionWaived =
        (order as Order & { commissionWaived?: boolean }).commissionWaived === true;

      const commission = calculateCommission({
        subtotal: order.pricing.subtotal,
        restaurantFunded: orderFundingSplit(order).restaurant,
        platformFunded: orderFundingSplit(order).platform,
        commissionRateBps: order.commissionRateBps,
      });

      const period = periodOf(new Date());
      const commissionKey = commissionIdempotencyKey(order.id);
      const discountKey = platformDiscountIdempotencyKey(order.id);
      const onlineKey = onlineCollectedIdempotencyKey(order.id);

      try {
        await db.runTransaction(async (tx) => {
          // EVERY read comes first. Firestore refuses a transaction that reads
          // after it has written, and the failure is a bare INTERNAL error with
          // nothing in it to say which transaction was at fault.
          const fresh = await tx.get(doc.ref);
          // Somebody may have completed or cancelled it in the meantime.
          if (fresh.data()?.status !== OrderStatus.DELIVERED) return;

          const commissionRef = db.doc(paths.ledgerEntry(commissionKey));
          const discountRef = db.doc(paths.ledgerEntry(discountKey));
          const onlineRef = db.doc(paths.ledgerEntry(onlineKey));

          // The payment record, not the order, decides whether the platform is
          // holding this order's money. `order.paymentStatus` is a denormalised
          // copy that can lag a callback by seconds, and crediting a restaurant
          // for money that never cleared is not a mistake this system may make.
          const paymentRef =
            isOnlinePayment(order.paymentMethod) && order.paymentId
              ? db.doc(paths.payment(order.paymentId))
              : null;

          const [commissionExists, discountExists, onlineExists, paymentSnapshot] =
            await Promise.all([
              tx.get(commissionRef),
              tx.get(discountRef),
              tx.get(onlineRef),
              paymentRef ? tx.get(paymentRef) : Promise.resolve(null),
            ]);

          const payment = paymentSnapshot?.data() as Payment | undefined;
          const collectedOnline = payment ? isCapturedPayment(payment.state) : false;

          if (!commissionWaived && !commissionExists.exists && commission.amount > 0) {
            tx.set(commissionRef, {
              id: commissionKey,
              restaurantId: order.restaurantId,
              period,
              orderId: order.id,
              type: LedgerEntryType.COMMISSION,
              amount: commission.amount,
              currency: order.pricing.currency,
              description: `Komissiya · ${order.code}`,
              // What the order was sold for, carried here so the month's gross
              // sales can be summed without re-reading every order.
              orderTotal: order.pricing.total,
              idempotencyKey: commissionKey,
              createdBy: 'system',
              createdAt: now(),
            });
          }

          // Money the customer paid to Qapında for food the restaurant cooked.
          // Negative, because it is the platform that owes it — netted against
          // the commission at the end of the month. The full captured amount is
          // posted even if part of it has since been refunded; the refund is
          // its own entry, so the bank statement and the ledger can be read
          // against each other line by line.
          if (!onlineExists.exists && collectedOnline && payment && payment.amount > 0) {
            tx.set(onlineRef, {
              id: onlineKey,
              restaurantId: order.restaurantId,
              period,
              orderId: order.id,
              type: LedgerEntryType.ONLINE_COLLECTED,
              amount: -payment.amount,
              currency: payment.currency,
              description: `Onlayn ödəniş · ${order.code}`,
              orderTotal: null,
              idempotencyKey: onlineKey,
              createdBy: 'system',
              createdAt: now(),
            });
          }

          if (!discountExists.exists && commission.platformFundedDiscount > 0) {
            tx.set(discountRef, {
              id: discountKey,
              restaurantId: order.restaurantId,
              period,
              orderId: order.id,
              type: LedgerEntryType.PLATFORM_DISCOUNT,
              amount: -commission.platformFundedDiscount,
              currency: order.pricing.currency,
              description: `Platforma endirimi · ${order.code}`,
              orderTotal: null,
              idempotencyKey: discountKey,
              createdBy: 'system',
              createdAt: now(),
            });
          }

          tx.update(doc.ref, {
            status: OrderStatus.COMPLETED,
            completedAt: now(),
            commissionAmount: commission.amount,
            platformFundedDiscount: commission.platformFundedDiscount,
            updatedAt: now(),
          });

          tx.set(db.collection(`${doc.ref.path}/${SUBCOLLECTIONS.orderEvents}`).doc(), {
            from: OrderStatus.DELIVERED,
            to: OrderStatus.COMPLETED,
            actor: OrderActor.SYSTEM,
            actorId: 'system',
            note: null,
            at: now(),
          });

          tx.update(db.doc(paths.restaurant(order.restaurantId)), {
            completedOrderCount: FieldValue.increment(1),
            updatedAt: now(),
          });

          tx.update(db.doc(paths.user(order.customerId)), {
            hasCompletedOrder: true,
            /*
             * The three counters that make the admin roster sortable.
             *
             * Written here rather than derived, because "who orders the most"
             * has to be answerable across every account at once and Firestore
             * cannot sort on a number it does not hold. They ride along in the
             * transaction that was already writing `hasCompletedOrder`, so they
             * cost nothing and can never disagree with it.
             *
             * `increment` on a field that does not exist yet starts it at the
             * increment, so an account created before this shipped needs no
             * special case — only the backfill, for its history.
             */
            completedOrderCount: FieldValue.increment(1),
            totalSpent: FieldValue.increment(order.pricing.total),
            lastOrderAt: now(),
            updatedAt: now(),
          });
        });
        settled += 1;

        /*
         * The customer's copy, after the transaction has committed.
         *
         * Outside it because an HTTP call has no business inside a Firestore
         * transaction, and after it because the receipt should describe an
         * order that is actually finished. It never throws — a mail provider
         * having a bad minute must not stop the queue of orders behind it.
         */
        await sendOrderReceipt({ ...order, id: doc.id, status: OrderStatus.COMPLETED });
      } catch (error) {
        // One bad order must not stop the queue behind it.
        logger.error('settle failed', { orderId: order.id, error: String(error) });
      }
    }

    logger.info('settled delivered orders', { settled, considered: ready.size });
  },
);

/**
 * Rolls each month's ledger into one invoice per restaurant.
 *
 * Runs daily so the figure a restaurant sees mid-month is current, and lands on
 * the final number the day after the month ends.
 */

/**
 * How many ledger entries are held in memory at once.
 *
 * Small enough that one page is nothing next to the function's 256 MiB, large
 * enough that a busy month is a few dozen reads rather than a few thousand.
 */
const SETTLEMENT_PAGE = 500;

/**
 * Adds two ledger summaries together.
 *
 * Every field of a summary is a sum, so merging is field-by-field addition —
 * which is what makes it safe to fold a month in one entry at a time instead of
 * holding all of them. Written by walking the keys rather than by listing them,
 * so a field added to `summariseLedger` later cannot be silently dropped here.
 */
function mergeSummaries(left: SettlementSummary, right: SettlementSummary): SettlementSummary {
  const merged: Record<string, number> = { ...left } as unknown as Record<string, number>;
  const other = right as unknown as Record<string, number>;

  for (const key of Object.keys(other)) {
    merged[key] = (merged[key] ?? 0) + (other[key] ?? 0);
  }

  return merged as unknown as SettlementSummary;
}

/**
 * "How was it?" — asked once, a few hours after the food arrived.
 *
 * The switch for this has been on the customer's settings screen since launch
 * with nothing behind it. A control that changes nothing is worse than a
 * missing one: it teaches people the settings are decorative, and the next
 * switch they turn off — the one that does work — they will not trust either.
 *
 * WHY IT WAITS
 * ------------
 * Asking at the moment of delivery is asking somebody holding a hot bag. Three
 * hours later they have eaten, and the answer is about the food rather than
 * about the wait. Asking a day later is asking about a meal they have
 * forgotten.
 *
 * ASKED ONCE, NEVER REPEATED
 * --------------------------
 * `reviewReminderAt` is stamped on the order when the question is asked, and
 * the query skips anything that has it. A second "how was it?" about a dinner
 * somebody has already decided not to rate is precisely the message that gets
 * an app muted for good — and this one is a favour being asked, so it has no
 * business being persistent.
 */
const REVIEW_REMINDER_AFTER_MS = 3 * 60 * 60_000;
const REVIEW_REMINDER_WINDOW_MS = 24 * 60 * 60_000;

export const askForReviews = onSchedule(
  { schedule: 'every 60 minutes', region: REGION, timeZone: 'Asia/Baku', timeoutSeconds: 300 },
  async () => {
    const now_ = Date.now();

    const delivered = await db
      .collection(COLLECTIONS.orders)
      .where('status', 'in', [OrderStatus.DELIVERED, OrderStatus.COMPLETED])
      .where('deliveredAt', '>=', Timestamp.fromMillis(now_ - REVIEW_REMINDER_WINDOW_MS))
      .where('deliveredAt', '<=', Timestamp.fromMillis(now_ - REVIEW_REMINDER_AFTER_MS))
      .limit(300)
      .get();

    if (delivered.empty) return;

    let asked = 0;

    for (const doc of delivered.docs) {
      const order = doc.data() as Order;

      // Already asked, or already reviewed. Neither wants a reminder.
      if (order.reviewReminderAt || order.reviewedAt) continue;

      const customer = (await db.doc(paths.user(order.customerId)).get()).data() as
        | User
        | undefined;
      if (!customer) continue;

      // The shared resolver, so this sender and the switch on the settings
      // screen cannot disagree about what "off by default" means.
      const prefs = resolveNotificationPrefs(customer.notificationPrefs, UserRole.CUSTOMER);
      if (prefs.reviewReminders !== true) {
        // Stamped anyway. Without this the query re-reads the same orders every
        // hour for a day, paying for a decision that was already made.
        await doc.ref.update({ reviewReminderAt: now() }).catch(() => undefined);
        continue;
      }

      await notify({
        userId: order.customerId,
        role: UserRole.CUSTOMER,
        orderId: order.id,
        restaurantId: order.restaurantId,
        type: NotificationType.REVIEW_REMINDER,
        params: { restaurant: order.restaurantName, code: order.code },
        link: `/orders/${order.id}`,
      }).catch(() => undefined);

      await doc.ref.update({ reviewReminderAt: now() }).catch(() => undefined);
      asked += 1;
    }

    logger.info('review reminders sent', { scanned: delivered.size, asked });
  },
);

export const rollUpSettlements = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'Asia/Baku', region: REGION, timeoutSeconds: 540 },
  async () => {
    const period = periodOf(new Date());
    const previous = periodOf(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
    const periods = [...new Set([period, previous])];

    for (const target of periods) {
      /*
       * READ IN PAGES, SUMMED AS IT GOES.
       *
       * This used to load the WHOLE month — every ledger entry on the platform
       * — into a 256 MiB function and hold it there twice: once as an array of
       * documents and again grouped into a map. It is the only job that
       * produces invoices, so it is also the first thing that would fall over
       * as the platform grew, and it would fall over silently on the night the
       * month closed.
       *
       * Paging keeps the memory proportional to one page rather than to one
       * month, and folding each entry into a running summary as it arrives
       * means nothing is held that has already been counted.
       */
      const summaries = new Map<string, ReturnType<typeof summariseLedger>>();
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      let scanned = 0;

      for (;;) {
        let page = db
          .collection(COLLECTIONS.ledgerEntries)
          .where('period', '==', target)
          // Ordered by `createdAt` rather than by document id: the id ordering
          // needs no declared index in theory and is refused in practice, and a
          // ledger is naturally chronological anyway — so the cursor walks the
          // month in the order the entries were written.
          .orderBy('createdAt', 'asc')
          .limit(SETTLEMENT_PAGE);

        if (cursor) page = page.startAfter(cursor);

        const entries = await page.get();
        if (entries.empty) break;

        for (const doc of entries.docs) {
          const entry = doc.data() as LedgerEntry;
          // Folded one at a time. `summariseLedger` over a single-entry array
          // is the same arithmetic every screen uses, applied incrementally —
          // rather than a second copy of it written specially for this job,
          // which is how a report and an invoice come to disagree.
          const running = summaries.get(entry.restaurantId);
          summaries.set(
            entry.restaurantId,
            running ? mergeSummaries(running, summariseLedger([entry])) : summariseLedger([entry]),
          );
        }

        scanned += entries.size;
        cursor = entries.docs[entries.docs.length - 1];
        if (entries.size < SETTLEMENT_PAGE) break;
      }

      for (const [restaurantId, summary] of summaries) {
        // `writeSettlement` leaves a paid or written-off month alone: its
        // figures were agreed, and a late entry must not rewrite them.
        await writeSettlement(restaurantId, target, summary);
      }

      logger.info('rolled up settlements', {
        period: target,
        restaurants: summaries.size,
        entries: scanned,
      });
    }
  },
);

/**
 * Clears spent idempotency keys.
 *
 * They only need to outlive a client's retry window. Keeping them forever would
 * turn a safety mechanism into an ever-growing bill.
 */
export const pruneIdempotencyKeys = onSchedule(
  { schedule: '0 4 * * *', timeZone: 'Asia/Baku', region: REGION, timeoutSeconds: 540 },
  async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let deleted = 0;

    for (let round = 0; round < 10; round += 1) {
      const stale = await db
        .collection(COLLECTIONS.idempotencyKeys)
        .where('createdAt', '<=', cutoff)
        .limit(400)
        .get();
      if (stale.empty) break;

      const batch = db.batch();
      for (const doc of stale.docs) batch.delete(doc.ref);
      await batch.commit();
      deleted += stale.size;
    }

    if (deleted > 0) logger.info('pruned idempotency keys', { deleted });

    /*
     * The rate-limit counters, in the same run.
     *
     * They expire on their own — the window index is part of the document id,
     * so yesterday's counter is simply never read again — but "never read
     * again" is not "gone", and a busy month would leave a collection with
     * millions of rows nobody ever looks at. Deleted here rather than in a job
     * of its own because it is the same shape of work at the same hour, and one
     * scheduled function is one less thing to notice has stopped.
     *
     * Cheap by design: the durable limiter is used by eight callables, not
     * ninety-nine, so this is hundreds of documents a day and not hundreds of
     * thousands.
     */
    const stale = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
    let counters = 0;

    for (let round = 0; round < 10; round += 1) {
      const page = await db
        .collection('rateLimits')
        .where('expiresAt', '<=', stale)
        .limit(400)
        .get();
      if (page.empty) break;

      const batch = db.batch();
      for (const doc of page.docs) batch.delete(doc.ref);
      await batch.commit();
      counters += page.size;
    }

    if (counters > 0) logger.info('pruned rate limit counters', { counters });
  },
);
