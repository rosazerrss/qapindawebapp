/**
 * QAPINDA — Moving an order along.
 *
 * One callable for every status change, so there is exactly one place that runs
 * the state machine, writes the event trail, notifies, and — when the order
 * completes — posts the commission to the ledger.
 *
 * The actor is derived from the caller's role and their relationship to *this*
 * order. It is never taken from the request: a customer who could claim to be
 * the restaurant could mark their own order delivered.
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, now, minutesFromNow, FieldValue } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { cleanOptional } from '../lib/moderation';
import { requireActiveUser } from '../lib/auth';
import { auditIn } from '../lib/audit';
import { releaseCouponIn, releaseCouponRefs } from '../lib/coupon';
import { sendOrderReceipt } from './receiptEmail';
import { notifyIn, notifyOperators } from '../lib/notify';
import { asObject, optionalInt, optionalString, requireEnum, requireString } from '../lib/validate';
import { AppErrorCode, TRANSITION_ERROR_TO_CODE } from '../shared/errors';
import {
  AuditAction,
  CancellationReason,
  LedgerEntryType,
  NotificationType,
  OrderActor,
  OrderStatus,
  PaymentStatus,
  RESTAURANT_ROLES,
  UserRole,
  isOnlinePayment,
  PaymentMethod,
} from '../shared/enums';
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
  CUSTOMER_CANCEL_WINDOW_MINUTES,
  STATUS_TIMESTAMP_FIELD,
  checkTransition,
  customerCancelWindow,
} from '../shared/orderState';
import { courierPickupNotification } from '../shared/notifications';
import { OPERATOR_ROOT, Permission, hasPermission } from '../shared/permissions';
import {
  calculateCommission,
  formatMoney,
  orderFundingSplit,
  settlementNetDue,
  summariseLedger,
} from '../shared/pricing';
import { isCapturedPayment, type Payment } from '../shared/payments';
import type { LedgerEntry, Order, PublicSettings, Restaurant } from '../shared/models';
import { deliveryCodeRequired } from '../shared/deliveryCode';

const SETTABLE_STATUSES = [
  OrderStatus.ACCEPTED,
  OrderStatus.REJECTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.COMPLETED,
] as const;

const CANCELLATION_REASONS = Object.values(CancellationReason);

/**
 * Which role this caller plays *on this order*.
 *
 * Being a restaurant owner is not enough — you must be the owner of the
 * restaurant that received this order.
 *
 * AND BELONGING TO THE RESTAURANT IS NOT ENOUGH EITHER.
 *
 * This function used to grant RESTAURANT on a matching `restaurantId` alone.
 * A courier carries that same id — that is how the app knows which kitchen
 * they drive for — so every driver was silently promoted to the kitchen: they
 * could accept, reject, cancel and, worst of all, mark DELIVERED any order the
 * restaurant had, including runs that were not theirs. Marking DELIVERED from
 * here bypasses `confirmDelivery` entirely, which means the six-digit handover
 * code the restaurant chose to require was never asked for, and a cash order
 * could be closed as paid with no money in the bag.
 *
 * `RESTAURANT_ROLES` is the list of accounts that may act *for* the
 * restaurant; `RESTAURANT_LINKED_ROLES` is the list that merely *belongs* to
 * one. The distinction exists precisely for this call site.
 *
 * A courier is not left without a route: they take an order OUT_FOR_DELIVERY
 * and close it through `confirmDelivery` in `orders/delivery.ts`, where the
 * assignment and the handover code are both checked.
 */
function actorFor(
  order: Order,
  callerUid: string,
  callerRole: UserRole,
  callerRestaurantId: string | null,
): OrderActor {
  if (callerRole === UserRole.OPERATOR || callerRole === UserRole.SUPER_ADMIN) {
    return OrderActor.PLATFORM;
  }
  if (
    (RESTAURANT_ROLES as readonly UserRole[]).includes(callerRole) &&
    callerRestaurantId &&
    callerRestaurantId === order.restaurantId
  ) {
    return OrderActor.RESTAURANT;
  }
  if (callerUid === order.customerId) return OrderActor.CUSTOMER;
  fail(AppErrorCode.FORBIDDEN);
}

export const updateOrderStatus = onCall(
  guard('updateOrderStatus', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    const orderId = requireString(data, 'orderId', { max: 128 });
    const to = requireEnum<OrderStatus>(data, 'status', SETTABLE_STATUSES);
    // A cancellation note is shown to the other party, so it is moderated.
    const note = cleanOptional(optionalString(data, 'note', { max: 300 })).text;
    const reasonCode = data.reason
      ? requireEnum<CancellationReason>(data, 'reason', CANCELLATION_REASONS)
      : null;

    /*
     * HOW LONG THE KITCHEN SAYS IT WILL BE.
     *
     * `estimatedDeliveryAt` was written on every order from the restaurant's
     * generic "up to 45 minutes" and then read by nothing at all — the number
     * existed, was never refined, and was never shown. Meanwhile the FAQ told
     * customers the time was worked out when the restaurant accepted, which was
     * simply not true.
     *
     * The kitchen is the only party that knows, and it knows at exactly one
     * moment: when it looks at the ticket and accepts. So the estimate is asked
     * for there, and everything downstream reads one honest number instead of a
     * placeholder nobody maintained.
     *
     * Optional, because a restaurant tapping "accept" quickly during a rush must
     * not be blocked by a form — the profile's own estimate stands in.
     */
    const prepMinutes = optionalInt(data, 'prepMinutes', { min: 5, max: 180 });

    const orderRef = db.doc(paths.order(orderId));

    /*
     * Read before the transaction opens, and only when it can matter.
     *
     * A cancellation window is the one rule here that comes from settings
     * rather than from the order, and reading a second document inside the
     * transaction would make every status change pay for a lookup that only a
     * customer's cancellation uses.
     */
    /*
     * Two rules need the platform settings: the cancellation window, and
     * whether a handover code is compulsory. Read once, and only for the two
     * transitions that can consult it, so an ordinary "preparing → ready" still
     * pays for nothing.
     */
    const needsSettings = to === OrderStatus.CANCELLED || to === OrderStatus.DELIVERED;
    const platformSettings = needsSettings
      ? ((await db.doc(paths.publicSettings()).get()).data() as PublicSettings | undefined)
      : undefined;

    const cancelWindowMinutes =
      platformSettings?.customerCancelWindowMinutes ?? CUSTOMER_CANCEL_WINDOW_MINUTES;

    const outcome = await db.runTransaction(async (tx) => {
      // Declared per attempt, not outside the transaction: a transaction can be
      // retried, and a flag that survived the retry would describe the attempt
      // that was thrown away.
      let refundDue = false;

      const snapshot = await tx.get(orderRef);
      if (!snapshot.exists) fail(AppErrorCode.ORDER_NOT_FOUND);
      const order = snapshot.data() as Order;

      // Read here, before any write: a notification to the restaurant needs the
      // owner's uid, and the order only carries the restaurant's id.
      const restaurantSnap = await tx.get(db.doc(paths.restaurant(order.restaurantId)));
      const ownerUserId = (restaurantSnap.data()?.ownerUserId as string | undefined) ?? null;
      // Already read for the owner's uid — the handover-code rule reuses it
      // rather than paying for the same document twice.
      const restaurantForCode = restaurantSnap.data() as Restaurant | undefined;

      /*
       * The payment record, read up here with the others.
       *
       * Whether the platform is actually holding this order's money decides
       * what a cancellation does to it, and the answer comes from the payment
       * document rather than the order's own `paymentStatus`, which is a copy
       * that can lag the provider's callback. Read now because a transaction
       * that reads after it has written is refused — the mistake that cost a
       * production evening in this very file.
       */
      const paymentSnapshot =
        isOnlinePayment(order.paymentMethod) && order.paymentId
          ? await tx.get(db.doc(paths.payment(order.paymentId)))
          : null;
      const payment = paymentSnapshot?.data() as Payment | undefined;

      /*
       * The coupon redemption, read here with the rest.
       *
       * Only for the two transitions that give it back, and read BEFORE any
       * write for the same reason as the payment above: a transaction that
       * reads after writing is refused. `releaseCouponIn` needs to know whether
       * the document was still there, because the delete is idempotent and the
       * decrement is not.
       */
      const couponRefs =
        to === OrderStatus.CANCELLED || to === OrderStatus.REJECTED
          ? releaseCouponRefs(order)
          : null;
      const redemptionSnapshot = couponRefs ? await tx.get(couponRefs.redemption) : null;

      const actor = actorFor(order, caller.uid, caller.role, caller.restaurantId);
      const check = checkTransition(order.status, to, actor, note);
      if (!check.allowed) {
        fail(TRANSITION_ERROR_TO_CODE[check.reason!] ?? AppErrorCode.TRANSITION_NOT_ALLOWED);
      }

      /*
       * THE THREE MINUTES, MEASURED BY THIS SERVER'S CLOCK.
       *
       * The state machine has already said a customer may cancel an order the
       * kitchen has not accepted. This narrows it to the window the owner
       * asked for, and it is decided here rather than trusted to the screen:
       * a browser clock can be wrong by hours, deliberately or otherwise, and
       * the request that arrives four minutes late looks exactly like the one
       * that arrives in time. `placedAt` is the server's own timestamp.
       *
       * Only the customer is measured. A restaurant rejecting, an operator
       * force-cancelling and the expiry job all run on their own rules.
       */
      /*
       * CANCELLING IS A MANAGER'S DECISION, NOT A TILL'S.
       *
       * `actorFor` answers "may this account act for the restaurant at all",
       * and the state machine answers "may the restaurant do this from that
       * status". Neither asks WHICH restaurant account — so `ORDER_CANCEL`,
       * which the permission table gives to a manager and above, was enforced
       * nowhere and a `RESTAURANT_STAFF` login could cancel an order the
       * kitchen had already accepted and started cooking.
       *
       * Rejecting a NEW order stays open to everyone on the floor: that is the
       * "we're slammed, we can't take this" button and it has to be fast.
       * Cancelling one already accepted is the one that costs a customer their
       * dinner and the restaurant its commission.
       */
      if (
        actor === OrderActor.RESTAURANT &&
        to === OrderStatus.CANCELLED &&
        !hasPermission(caller.role, Permission.ORDER_CANCEL)
      ) {
        fail(AppErrorCode.FORBIDDEN);
      }

      /*
       * THE HANDOVER CODE CANNOT BE STEPPED AROUND.
       *
       * `courierConfirmDelivery` checks the code. This function does not — and
       * both of them can write DELIVERED, so a restaurant account could simply
       * use this one and the code was never asked for. The code exists for
       * exactly the dispute where the restaurant says "delivered" and the
       * customer says nobody came; leaving the restaurant a door that skips it
       * meant it only worked when nobody wanted to abuse it.
       *
       * The platform keeps its door: an operator resolving a dispute by hand is
       * the case the code was collected FOR, and they are acting on evidence
       * rather than on their own say-so.
       */
      if (
        actor === OrderActor.RESTAURANT &&
        to === OrderStatus.DELIVERED &&
        deliveryCodeRequired({ settings: platformSettings, restaurant: restaurantForCode })
      ) {
        fail(AppErrorCode.DELIVERY_CODE_MISSING);
      }

      if (actor === OrderActor.CUSTOMER && to === OrderStatus.CANCELLED) {
        const window = customerCancelWindow(
          order.status,
          order.placedAt?.toMillis?.() ?? null,
          Date.now(),
          // The platform's configured window, read once outside the
          // transaction. A settings document that has never been touched has
          // no such field, and the shared default answers for it.
          cancelWindowMinutes,
        );
        if (!window.open) fail(AppErrorCode.CANCEL_WINDOW_CLOSED);
      }

      const update: Record<string, unknown> = { status: to, updatedAt: now() };

      const timestampField = STATUS_TIMESTAMP_FIELD[to];
      if (timestampField) update[timestampField] = now();

      // Once the restaurant answers, the response clock stops.
      if (to !== OrderStatus.PLACED) update.responseDeadlineAt = null;

      /*
       * The promise to the customer, made when the kitchen accepts.
       *
       * Cooking time plus the road. The road is taken from the restaurant's own
       * profile rather than measured — Qapında runs no fleet and has no live
       * courier position, and inventing a travel time from a straight-line
       * distance would be a guess dressed up as data. What the restaurant says
       * its deliveries take is the honest input available.
       *
       * Written only on ACCEPTED. Recomputing it at every later step would make
       * the estimate creep forward each time the kitchen touched the order,
       * which is how an app quietly never arrives late.
       */
      if (to === OrderStatus.ACCEPTED) {
        const cooking = prepMinutes ?? restaurantSnap.data()?.estimatedMinutesMin ?? 20;
        const road = Math.max(
          (restaurantSnap.data()?.estimatedMinutesMax ?? 45) -
            (restaurantSnap.data()?.estimatedMinutesMin ?? 20),
          10,
        );
        update.prepMinutes = cooking;
        update.estimatedDeliveryAt = minutesFromNow(cooking + road);
      }

      if (to === OrderStatus.REJECTED || to === OrderStatus.CANCELLED) {
        update.cancellation = {
          by: actor,
          reason: reasonCode ?? CancellationReason.OTHER,
          note: note ?? null,
          at: now(),
        };

        /*
         * Nobody pays for food that never arrived — but "nobody pays" and
         * "nobody has paid" are different sentences, and writing the second
         * one over the first is how money gets stranded.
         *
         * A cash order that is cancelled was never collected, and
         * NOT_COLLECTED is the truth. An ONLINE order that the bank already
         * captured is money this platform is holding right now: marking it
         * NOT_COLLECTED would erase it from every screen that asks what is
         * owed, and the customer would be left with no order and no refund.
         * So it goes to REFUND_PENDING and the operators are told, below,
         * because the actual refund is an API call to the provider and an API
         * call has no business inside a Firestore transaction.
         */
        refundDue = Boolean(
          payment && isCapturedPayment(payment.state) && payment.amount > payment.refundedAmount,
        );
        update.paymentStatus = refundDue
          ? PaymentStatus.REFUND_PENDING
          : PaymentStatus.NOT_COLLECTED;
      }

      if (to === OrderStatus.DELIVERED) {
        /*
         * Cash or card at the door — the restaurant collected it directly.
         *
         * Guarded by the method, because this used to run for every delivery
         * including the ones already paid online. Writing COLLECTED over PAID
         * erases the fact that the platform is holding that customer's money
         * and owes it on to the restaurant, and that flag is what the whole
         * settlement is computed from.
         */
        if (
          order.paymentMethod === PaymentMethod.CASH_ON_DELIVERY ||
          order.paymentMethod === PaymentMethod.CARD_ON_DELIVERY
        ) {
          update.paymentStatus = PaymentStatus.COLLECTED;
        }
      }

      // ---------------------------------------------------------------------
      // Completion: the one transition that moves money.
      // ---------------------------------------------------------------------

      /*
       * A WAIVED COMMISSION IS WAIVED HERE TOO.
       *
       * `settleDeliveredOrders` — the scheduled path that completes almost
       * every order — checks `commissionWaived` and posts nothing. This manual
       * path did not, so an operator who resolved a complaint by waiving the
       * commission and then pressed "complete" on the same order charged the
       * restaurant anyway. The restaurant was compensated with one hand and
       * billed with the other, and only the ledger knew.
       */
      if (to === OrderStatus.COMPLETED) {
        const commissionWaived =
          (order as Order & { commissionWaived?: boolean }).commissionWaived === true;

        const commission = calculateCommission({
          subtotal: order.pricing.subtotal,
          restaurantFunded: orderFundingSplit(order).restaurant,
          platformFunded: orderFundingSplit(order).platform,
          commissionRateBps: order.commissionRateBps,
        });

        update.commissionAmount = commissionWaived ? 0 : commission.amount;
        update.platformFundedDiscount = commission.platformFundedDiscount;

        const period = periodOf(new Date());

        // Keyed by order, so re-running the settle job cannot bill twice. The
        // same keys the scheduled job uses, which is what makes completing an
        // order by hand and letting it settle itself the same operation.
        const commissionKey = commissionIdempotencyKey(order.id);
        const discountKey = platformDiscountIdempotencyKey(order.id);
        const onlineKey = onlineCollectedIdempotencyKey(order.id);

        const commissionEntryRef = db.doc(paths.ledgerEntry(commissionKey));
        const discountRef = db.doc(paths.ledgerEntry(discountKey));
        const onlineRef = db.doc(paths.ledgerEntry(onlineKey));

        // Whether the platform is holding this order's money is answered by the
        // payment record and by nothing else — never by the order's own
        // `paymentStatus`, which is a copy that can lag the provider callback.
        const paymentRef =
          isOnlinePayment(order.paymentMethod) && order.paymentId
            ? db.doc(paths.payment(order.paymentId))
            : null;

        // EVERY read first. Firestore refuses a transaction that reads after it
        // has written, and the error it throws is a bare INTERNAL with nothing
        // in it — which is how this cost a production evening once already.
        const [existing, existingDiscount, existingOnline, paymentSnapshot] = await Promise.all([
          tx.get(commissionEntryRef),
          tx.get(discountRef),
          tx.get(onlineRef),
          paymentRef ? tx.get(paymentRef) : Promise.resolve(null),
        ]);

        const payment = paymentSnapshot?.data() as Payment | undefined;

        // Waived: the commission entry is skipped, and only that one. The
        // online takings the platform is holding are still owed to the
        // restaurant and still posted below.
        if (!commissionWaived && !existing.exists && commission.amount > 0) {
          tx.set(commissionEntryRef, {
            id: commissionKey,
            restaurantId: order.restaurantId,
            period,
            orderId: order.id,
            type: LedgerEntryType.COMMISSION,
            amount: commission.amount, // positive: the restaurant owes this
            currency: order.pricing.currency,
            description: `Komissiya · ${order.code}`,
            // Carried so the month's gross sales can be summed from the ledger
            // rather than by re-reading every order it mentions.
            orderTotal: order.pricing.total,
            idempotencyKey: commissionKey,
            createdBy: 'system',
            createdAt: now(),
          });
        }

        // A platform-funded discount is money the platform owes back — the
        // restaurant already handed over food it was promised full price for.
        if (!existingDiscount.exists && commission.platformFundedDiscount > 0) {
          tx.set(discountRef, {
            id: discountKey,
            restaurantId: order.restaurantId,
            period,
            orderId: order.id,
            type: LedgerEntryType.PLATFORM_DISCOUNT,
            amount: -commission.platformFundedDiscount, // negative: owed back
            currency: order.pricing.currency,
            description: `Platforma endirimi · ${order.code} · ${order.coupon?.code ?? ''}`,
            orderTotal: null,
            idempotencyKey: discountKey,
            createdBy: 'system',
            createdAt: now(),
          });
        }

        // Paid online: the customer's money went to Qapında, not to the
        // restaurant. Negative, because the platform owes it — netted against
        // the commission when the month is settled. Without this entry an
        // order completed by hand would leave the platform holding takings it
        // never told anybody it owed.
        if (
          !existingOnline.exists &&
          payment &&
          isCapturedPayment(payment.state) &&
          payment.amount > 0
        ) {
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

        tx.update(db.doc(paths.restaurant(order.restaurantId)), {
          completedOrderCount: FieldValue.increment(1),
          updatedAt: now(),
        });

        // Unlocks nothing retroactively — it closes the first-order coupons.
        // The counters beside it are what the admin roster sorts on; they are
        // written in both completion paths, because an order completed by hand
        // by an operator counts exactly as much as one the scheduler closed.
        tx.update(db.doc(paths.user(order.customerId)), {
          hasCompletedOrder: true,
          completedOrderCount: FieldValue.increment(1),
          totalSpent: FieldValue.increment(order.pricing.total),
          lastOrderAt: now(),
          updatedAt: now(),
        });
      }

      tx.update(orderRef, update);

      tx.set(db.collection(`${orderRef.path}/${SUBCOLLECTIONS.orderEvents}`).doc(), {
        from: order.status,
        to,
        actor,
        actorId: caller.uid,
        note: note ?? null,
        at: now(),
      });

      /*
       * ONE NOTIFICATION TO THE CUSTOMER, AND ONLY ONE.
       *
       * Seven were removed from this line on the owner's instruction, and
       * rightly — a phone that announces every step of a delivery is how people
       * learn to mute an app entirely. This one is back because it asks
       * something of them rather than telling them something: a courier is on
       * their way to the door, and a customer who does not know that is a
       * delivery that fails. Every other step is on the order screen, live, for
       * whenever they choose to look.
       */
      if (to === OrderStatus.OUT_FOR_DELIVERY) {
        notifyIn(tx, {
          userId: order.customerId,
          role: UserRole.CUSTOMER,
          orderId: order.id,
          type: NotificationType.ORDER_ON_THE_WAY,
          params: { code: order.code, restaurant: order.restaurantName },
          link: `/orders/${order.id}`,
        });
      }

      // Beyond that one, nothing is written to the CUSTOMER here: the status
      // they are waiting on is on their order screen, live. Only the kitchen's
      // copy of a cancellation survives.
      //
      // A customer cancelling has to reach the kitchen, which may be mid-prep.
      if (to === OrderStatus.CANCELLED && actor === OrderActor.CUSTOMER && ownerUserId) {
        notifyIn(tx, {
          userId: ownerUserId,
          role: UserRole.RESTAURANT_OWNER,
          restaurantId: order.restaurantId,
          orderId: order.id,
          type: NotificationType.ORDER_CANCELLED,
          params: { code: order.code },
          // `/restaurant/sifaris/:id` is not a route in this app — tapping the
          // notification landed on a 404. The board is where the order is.
          link: '/panel',
        });
      }

      // ---------------------------------------------------------------------
      // The courier carrying this order.
      //
      // Only ever the one written on the order, which is the whole privacy
      // design: a driver hears about their own runs and about nobody else's.
      // ---------------------------------------------------------------------

      if (order.courier) {
        // Stop driving. A cancelled order that only the customer and the
        // kitchen know about is a courier still on their way to that address,
        // and this is the one notification no setting may hide.
        if (
          to === OrderStatus.CANCELLED ||
          to === OrderStatus.REJECTED ||
          to === OrderStatus.EXPIRED
        ) {
          notifyIn(tx, {
            userId: order.courier.id,
            role: UserRole.RESTAURANT_COURIER,
            restaurantId: order.restaurantId,
            orderId: order.id,
            type: NotificationType.COURIER_ORDER_CANCELLED,
            /*
             * The reason travels with the message.
             *
             * A driver already on the road was told "do not go to this address"
             * and nothing else, so their next move — turn round, ring the
             * customer, take the food back — was a guess. The reason is the
             * whole difference between those three, and it is already decided
             * by the time this is written.
             */
            params: {
              code: order.code,
              restaurant: order.restaurantName,
              reason: reasonCode ?? CancellationReason.OTHER,
            },
            // Straight to where the order now lives: a cancelled delivery is
            // gone from the active list before the driver can tap the row.
            link: `/courier/history/${order.id}`,
          });
        }

        // "Ready" and "assigned to you" within a minute of each other are one
        // event and one buzz — `courierPickupNotification` is the single place
        // that decides which of the two speaks, and it is called from both
        // sides so that whichever happens second stays quiet.
        if (to === OrderStatus.READY) {
          const pickup = courierPickupNotification({
            assignedAtMs: order.courier.assignedAt?.toMillis?.() ?? null,
            readyAtMs: Date.now(),
            trigger: 'ready',
          });

          if (pickup) {
            notifyIn(tx, {
              userId: order.courier.id,
              role: UserRole.RESTAURANT_COURIER,
              restaurantId: order.restaurantId,
              orderId: order.id,
              type: pickup,
              params: {
                code: order.code,
                restaurant: order.restaurantName,
                address: order.address?.line ?? '',
              },
              link: `/courier/orders/${order.id}`,
            });
          }
        }
      }

      /*
       * EVERY transition is audited, not only the platform's.
       *
       * This used to be `if (actor === OrderActor.PLATFORM)`, which meant the
       * append-only trail held operator actions and nothing else: a restaurant
       * accepting, rejecting or marking an order delivered, and a customer
       * cancelling one, left no entry anywhere. Those are precisely the events
       * a dispute is about — "they say they delivered it", "they say I never
       * cancelled" — and the only record was the order's own `events`
       * subcollection, which the restaurant can read and which is a timeline,
       * not an audit.
       *
       * `auditIn` writes inside this same transaction, so an audit row cannot
       * be missing for a status change that succeeded, and cannot exist for one
       * that was rolled back.
       */
      /*
       * The order is dead, so the discount goes back on the shelf.
       *
       * Cancelled and rejected only. A delivery that failed keeps its coupon:
       * the food was cooked and the trip was made, and that is a compensation
       * question rather than a coupon-accounting one.
       */
      if (couponRefs) {
        releaseCouponIn(tx, order, redemptionSnapshot?.exists === true);
      }

      auditIn(tx, {
        actorId: caller.uid,
        actorRole: user.role,
        // FORCE_CANCELLED only when the platform overrode the parties. A
        // restaurant cancelling its own order, or a customer cancelling inside
        // the window, is an ordinary status change.
        action:
          to === OrderStatus.CANCELLED && actor === OrderActor.PLATFORM
            ? AuditAction.ORDER_FORCE_CANCELLED
            : AuditAction.ORDER_STATUS_CHANGED,
        targetType: 'order',
        targetId: order.id,
        restaurantId: order.restaurantId,
        oldValue: { status: order.status },
        newValue: { status: to },
        reason: note ?? null,
        ip: request.rawRequest.ip ?? null,
      });

      return {
        from: order.status,
        to,
        actor,
        code: order.code,
        restaurantId: order.restaurantId,
        restaurantName: order.restaurantName,
        refundDue,
        refundAmount: refundDue && payment ? payment.amount - payment.refundedAmount : 0,
        paymentId: order.paymentId,
        // Carried out of the transaction so the receipt can be built from the
        // order as it was completed, without a second read.
        order,
      };
    });

    /*
     * The customer's emailed receipt, when an operator completes an order by
     * hand.
     *
     * The scheduled path sends its own; this is the other way an order reaches
     * COMPLETED, and a receipt that arrives for some completions and not others
     * is worse than one that never arrives at all — the customer cannot tell
     * which orders will produce a record and which will not.
     *
     * `sendOrderReceipt` refuses to send twice, so the two paths cannot both
     * post the same receipt.
     */
    if (outcome.to === OrderStatus.COMPLETED) {
      await sendOrderReceipt({ ...outcome.order, status: OrderStatus.COMPLETED });
    }

    /*
     * What the operator's desk hears about — and, just as deliberately, what it
     * does not.
     *
     * An order that is accepted, cooked, driven and delivered produces nothing
     * here: an operator who is told about every step of every order stops
     * reading any of them, and the panel already shows the live queue. Only the
     * two endings that need somebody to pick up a phone are raised.
     *
     * Raised after the transaction has committed. The roster of operators is a
     * query, and a query cannot run inside a transaction that has begun
     * writing; more to the point, an order must never be rolled back because an
     * alert failed to send.
     */
    if (outcome.to === OrderStatus.REJECTED || outcome.to === OrderStatus.CANCELLED) {
      const rejected = outcome.to === OrderStatus.REJECTED;

      await notifyOperators({
        type: rejected
          ? NotificationType.OPS_RESTAURANT_REJECTED
          : NotificationType.OPS_ORDER_CANCELLED,
        orderId,
        restaurantId: outcome.restaurantId,
        params: {
          code: outcome.code,
          restaurant: outcome.restaurantName,
          // Who ended it, and why. "Cancelled" without either is a line an
          // operator has to open the order to understand, which is the same as
          // not being told.
          by: outcome.actor,
          reason: reasonCode ?? note ?? CancellationReason.OTHER,
        },
        link: `${OPERATOR_ROOT}?order=${orderId}`,
      }).catch(() => undefined);
    }

    /*
     * Money the platform is still holding for an order that no longer exists.
     *
     * The refund itself is a call to the payment provider, so it cannot happen
     * inside the transaction above and it does not happen behind an operator's
     * back either — `refundPayment` is the one place money goes back out, and
     * it writes the ledger entry and the audit trail while it does. What this
     * does is make sure somebody is told, immediately, with the amount in the
     * message: the order is already marked REFUND_PENDING, and this is the
     * ping that turns that flag into a person doing something about it.
     */
    if (outcome.refundDue) {
      await notifyOperators({
        type: NotificationType.OPS_ORDER_PROBLEM,
        orderId,
        restaurantId: outcome.restaurantId,
        // The template this type renders with is `{{code}} — {{source}} —
        // {{reason}}`, so the amount rides in the reason rather than in a
        // parameter the message has nowhere to print.
        params: {
          code: outcome.code,
          source: 'PAYMENT',
          reason: `REFUND_DUE · ${formatMoney(outcome.refundAmount)}`,
        },
        link: `${OPERATOR_ROOT}?order=${orderId}`,
      }).catch(() => undefined);

      logger.warn('cancelled order holds captured money — refund owed', {
        orderId,
        paymentId: outcome.paymentId,
        amount: outcome.refundAmount,
      });
    }

    logger.info('order status changed', { orderId, ...outcome });
    return { ok: true, from: outcome.from, to: outcome.to, actor: outcome.actor };
  }),
);

/**
 * Opening and closing the shop for the day.
 *
 * Also writable directly by the restaurant under the security rules — this
 * callable exists so the panel can use one code path and get a clean error when
 * the restaurant is suspended.
 */
export const setServiceState = onCall(
  guard('setServiceState', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const serviceState = requireEnum(data, 'serviceState', ['OPEN', 'PAUSED', 'CLOSED'] as const);

    /*
     * A PAUSE WITH AN END, WHICH IS THE ONLY KIND ANYBODY WANTS.
     *
     * "Busy" and "shut" used to be the same state. A kitchen that paused during
     * a rush stayed paused until somebody remembered the button — and nobody
     * remembers the button at nine in the evening, so the shop lost the rest of
     * the night and the platform lost the orders. Naming a number of minutes
     * makes it a pause; `resumePausedRestaurants` puts the shop back.
     *
     * Null is still allowed and still means open-ended, because a broken oven
     * genuinely has no end time — and a scheduled job that re-opened those
     * would be worse than the problem it solved.
     */
    const pauseMinutes = optionalInt(data, 'pauseMinutes', { min: 5, max: 720 });

    // Same distinction as `restaurantDashboard`: belonging to the restaurant is
    // not permission to act for it. Closing the shop mid-service is a decision
    // for the kitchen, and a driver holding a phone in the street is not it.
    /*
     * Asked as `RESTAURANT_TOGGLE_SERVICE`, which is MANAGER and above.
     *
     * The old check accepted every `RESTAURANT_ROLES` member, so a till account
     * could close the shop in the middle of service — and it was LOOSER than
     * the Firestore rule for the very same field, which already required an
     * owner or a manager. Two doors onto one decision, one of them wider.
     */
    const mayAct =
      (hasPermission(caller.role, Permission.RESTAURANT_TOGGLE_SERVICE) &&
        caller.restaurantId === restaurantId) ||
      caller.role === UserRole.SUPER_ADMIN;

    if (!mayAct) fail(AppErrorCode.NOT_YOUR_RESTAURANT);

    const ref = db.doc(paths.restaurant(restaurantId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
    if (snapshot.data()?.status !== 'ACTIVE') fail(AppErrorCode.RESTAURANT_NOT_ACTIVE);

    await ref.update({
      serviceState,
      // Cleared on any state that is not a timed pause, so a shop re-opened by
      // hand does not carry a stale clock that the job would act on later.
      pausedUntil:
        serviceState === 'PAUSED' && pauseMinutes ? minutesFromNow(pauseMinutes) : null,
      pausedMinutes: serviceState === 'PAUSED' && pauseMinutes ? pauseMinutes : null,
      updatedAt: now(),
    });

    return { ok: true, serviceState, pauseMinutes: pauseMinutes ?? null };
  }),
);

/** What the restaurant panel needs on one screen, in one call. */
export const restaurantDashboard = onCall(
  guard('restaurantDashboard', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });

    /*
     * The kitchen's own staff, or the platform. Not the drivers.
     *
     * This check used to be `caller.restaurantId !== restaurantId`, and a
     * courier carries exactly that id. So every driver could call this and
     * receive, in one response, every active order's customer name, phone
     * number and address — plus the month's commission, online takings and
     * what the restaurant owes. Two separate leaks in one payload: personal
     * data belonging to customers who never met that driver, and the
     * restaurant's commercial position, on a phone that gets lost and sold.
     *
     * A courier's own screen is served by the security rules, which scope them
     * to the orders assigned to them and to nothing else.
     */
    const restaurantSide =
      (RESTAURANT_ROLES as readonly UserRole[]).includes(caller.role) &&
      caller.restaurantId === restaurantId;
    const platformSide =
      caller.role === UserRole.SUPER_ADMIN || caller.role === UserRole.OPERATOR;

    if (!restaurantSide && !platformSide) fail(AppErrorCode.NOT_YOUR_RESTAURANT);

    /*
     * The ORDERS and the MONEY are two different questions, and only one of
     * them is answered for everybody who gets this far.
     *
     * `monthToDate` used to ride along with the order list for anyone on the
     * restaurant side — which is every `RESTAURANT_ROLES` member, kitchen staff
     * included — and for every operator. Neither holds the permission that
     * gates the finance pages; the only thing keeping the month's takings off
     * their screen was that the navigation did not draw the link. A decision
     * made in a browser is not a decision.
     */
    const maySeeMoney =
      (restaurantSide && hasPermission(caller.role, Permission.RESTAURANT_VIEW_FINANCE)) ||
      hasPermission(caller.role, Permission.PLATFORM_VIEW_LEDGER);

    const period = periodOf(new Date());

    const [active, ledger] = await Promise.all([
      db
        .collection(COLLECTIONS.orders)
        .where('restaurantId', '==', restaurantId)
        .where('status', 'in', [
          OrderStatus.PLACED,
          OrderStatus.ACCEPTED,
          OrderStatus.PREPARING,
          OrderStatus.READY,
          OrderStatus.OUT_FOR_DELIVERY,
        ])
        .orderBy('placedAt', 'desc')
        .limit(50)
        .get(),
      // Not fetched at all when the caller may not see it. A month's ledger is
      // one read per entry, and paying for a hundred of them to throw the
      // answer away would be its own small bug.
      maySeeMoney
        ? db
            .collection(COLLECTIONS.ledgerEntries)
            .where('restaurantId', '==', restaurantId)
            .where('period', '==', period)
            .get()
        : null,
    ]);

    // Folded with the shared arithmetic rather than by sorting entries into
    // "positive" and "negative": online takings are also negative, and lumping
    // them in with the platform-funded discounts would report a restaurant's
    // own money back to it as a discount somebody gave it.
    const summary = summariseLedger(
      (ledger?.docs ?? []).map((doc) => doc.data() as LedgerEntry),
    );

    return {
      ok: true,
      period,
      activeOrders: active.docs.map((doc) => doc.data()),
      // Null, not zero. A panel that reads zero would draw "0,00 ₼ this month"
      // at a restaurant that took two hundred orders.
      monthToDate: maySeeMoney
        ? {
            commission: summary.commission,
            platformCredits: summary.platformFundedDiscount,
            onlineCollected: summary.onlineCollected,
            netDue: settlementNetDue(summary),
            entryCount: ledger?.size ?? 0,
          }
        : null,
    };
  }),
);
