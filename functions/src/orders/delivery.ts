/**
 * QAPINDA — The last hundred metres.
 *
 * WHO THE COURIER IS
 * ------------------
 * Somebody the restaurant employs. Qapında runs no fleet: it does not hire,
 * assign, pay or insure anyone who drives. This role exists for one reason —
 * the person standing at the door is the person who knows the food arrived, and
 * every arrangement where they ring the kitchen so somebody else can press a
 * button produces a status that is wrong for ten minutes and a dispute nobody
 * can settle.
 *
 * WHAT A COURIER CAN SEE
 * ----------------------
 * The orders assigned to them, and nothing else. Not the menu, not the
 * takings, not the restaurant's other deliveries. This account lives on a
 * personal phone that gets lost, sold and handed to the next driver, so the
 * customer addresses and phone numbers it can reach are exactly the ones it
 * needs and no more. The security rules enforce that, not this file.
 *
 * THE CODE, AND WHY IT IS OPTIONAL
 * --------------------------------
 * A restaurant decides for itself. A two-person kebab shop where the owner
 * drives the moped gains nothing from a code and loses seconds at every door;
 * a restaurant with six drivers gains the only answer there is to "he says he
 * delivered it, she says nobody came". Making it compulsory for both would be
 * choosing one of them to annoy.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { onCall } from 'firebase-functions/v2/https';

import { db, now, Timestamp, FieldValue } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { cleanOptional } from '../lib/moderation';
import { requireActiveUser } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { notify, notifyOperators } from '../lib/notify';
import { asObject, optionalString, requireEnum, requireString, sanitiseText } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { paths } from '../shared/collections';
import {
  AuditAction,
  DeliveryFailureReason,
  NotificationType,
  OrderActor,
  OrderStatus,
  PLATFORM_ROLES,
  RESTAURANT_ROLES,
  UserRole,
  PaymentMethod,
  PaymentStatus,
} from '../shared/enums';
import { courierPickupNotification } from '../shared/notifications';
import { OPERATOR_ROOT } from '../shared/permissions';
import { deliveryCodeRequired } from '../shared/deliveryCode';
import type { DeliveryCode, Order, PublicSettings, Restaurant, User } from '../shared/models';

/** Long enough not to be guessed, short enough to say out loud at a door. */
const CODE_DIGITS = 6;

/**
 * How long a code lives.
 *
 * Long enough for a delivery that goes wrong — traffic, a wrong building, a
 * customer who does not pick up — and short enough that a code overheard today
 * is worthless tomorrow.
 */
const CODE_TTL_MINUTES = 180;

/**
 * Wrong tries before this order's handover freezes.
 *
 * Six digits and five tries is a one-in-two-hundred-thousand guess. The freeze
 * clears when a new code is issued, so a courier with cold fingers is not
 * stranded, but nobody can sit in a car and grind through the space.
 */
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  // Cryptographically strong. `Math.random` is not, and a predictable delivery
  // code is the same as no delivery code at all.
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
}

/** The order id is the salt: the same digits on two orders hash differently. */
function hashCode(orderId: string, code: string): string {
  return createHash('sha256').update(`${orderId}:${code}`).digest('hex');
}

function equalHashes(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function isRestaurantStaff(role: string): boolean {
  return (RESTAURANT_ROLES as readonly UserRole[]).includes(role as UserRole);
}

/**
 * The courier went out and came back with the food.
 *
 * Its own status, not a cancellation: a marketplace that cannot tell "the
 * customer changed their mind" from "nobody answered the door" cannot see bad
 * addresses, unreachable phones or a restaurant sending couriers to the wrong
 * street — and those are the three problems worth seeing.
 */
export const reportDeliveryFailure = onCall(
  guard('reportDeliveryFailure', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    const orderId = requireString(data, 'orderId', { max: 128 });
    const reason = requireEnum<DeliveryFailureReason>(
      data,
      'reason',
      Object.values(DeliveryFailureReason),
    );
    const rawNote = optionalString(data, 'note', { max: 300 });
    // A courier's account of what went wrong is read by the operator and lands
    // on the order, so it is moderated like any other written note.
    const note = cleanOptional(rawNote ? sanitiseText(rawNote) : null).text;

    /*
     * WHO IS ALLOWED TO SAY A DELIVERY FAILED.
     *
     * Two sides, and a closed door for everybody else. This used to read
     * `const platform = !restaurantSide`, which quietly made "not restaurant
     * staff" mean "platform" — and a plain customer is not restaurant staff.
     * Any signed-in account could therefore push any OUT_FOR_DELIVERY order to
     * DELIVERY_FAILED with `commissionWaived: true` from a browser console:
     * somebody else's food cancelled, and the restaurant's commission written
     * off, by a stranger.
     *
     * So the platform side is now named rather than inferred. Being neither is
     * a refusal, not a promotion.
     */
    const restaurantSide =
      isRestaurantStaff(caller.role) || caller.role === UserRole.RESTAURANT_COURIER;
    const platform = (PLATFORM_ROLES as readonly UserRole[]).includes(caller.role);
    if (!restaurantSide && !platform) fail(AppErrorCode.FORBIDDEN);
    const orderRef = db.doc(paths.order(orderId));
    const eventRef = db.collection(paths.orderEvents(orderId)).doc();

    const outcome = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(orderRef);
      if (!snapshot.exists) fail(AppErrorCode.ORDER_NOT_FOUND);

      const order = snapshot.data() as Order;

      if (!platform && caller.restaurantId !== order.restaurantId) fail(AppErrorCode.FORBIDDEN);

      // A courier may only fail the delivery they were actually sent on.
      // Belonging to the restaurant is not enough: closing somebody else's
      // order waives its commission and tells that customer their food is not
      // coming, and no driver should be able to do that to a colleague's run.
      if (caller.role === UserRole.RESTAURANT_COURIER && order.courier?.id !== caller.uid) {
        fail(AppErrorCode.FORBIDDEN);
      }

      if (order.status !== OrderStatus.OUT_FOR_DELIVERY) fail(AppErrorCode.TRANSITION_NOT_ALLOWED);

      tx.update(orderRef, {
        status: OrderStatus.DELIVERY_FAILED,
        deliveryFailure: { reason, note, at: now() },
        // The food never changed hands, so no commission is owed on it. The
        // settlement job reads this flag and skips the order.
        commissionWaived: true,
        updatedAt: now(),
      });

      tx.set(eventRef, {
        id: eventRef.id,
        from: OrderStatus.OUT_FOR_DELIVERY,
        to: OrderStatus.DELIVERY_FAILED,
        actor: platform ? OrderActor.PLATFORM : OrderActor.RESTAURANT,
        actorId: caller.uid,
        note: note ?? reason,
        at: now(),
      });

      return { customerId: order.customerId, code: order.code, restaurantId: order.restaurantId };
    });

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.ORDER_STATUS_CHANGED,
      targetType: 'order',
      targetId: orderId,
      restaurantId: outcome.restaurantId,
      reason: note ?? reason,
      oldValue: { status: OrderStatus.OUT_FOR_DELIVERY },
      newValue: { status: OrderStatus.DELIVERY_FAILED, reason },
    });

    /*
     * THE KITCHEN HEARS ABOUT IT.
     *
     * The order goes to the operator's desk below and it now sits in the
     * restaurant's own history rather than falling out of both of its lists —
     * but neither of those reaches the person standing in the kitchen at eight
     * in the evening, and they are the one with food that came back, a customer
     * who has not eaten, and a driver to talk to.
     *
     * Skipped when the restaurant reported it themselves: they were there.
     *
     * `.catch` on purpose. A notification that cannot be written must not undo
     * a status change that has already been committed and audited — the order
     * genuinely did fail, and losing that fact to a failed write would be far
     * worse than a missing banner.
     */
    if (!restaurantSide) {
      const owner = (await db.doc(paths.restaurant(outcome.restaurantId)).get()).data()
        ?.ownerUserId as string | undefined;

      if (owner) {
        await notify({
          userId: owner,
          role: UserRole.RESTAURANT_OWNER,
          restaurantId: outcome.restaurantId,
          orderId,
          type: NotificationType.RESTAURANT_DELIVERY_FAILED,
          params: { code: outcome.code, reason },
          link: '/panel',
        }).catch(() => undefined);
      }
    }

    // The customer is not notified — a failed delivery is a status, and the
    // order screen carries it. The operator IS, immediately, because this is
    // the case somebody can still do something about.

    // A delivery that went out and came back is one of the four things the
    // owner listed as "a problem reported on an order". It is also the one an
    // operator can still do something about — a wrong address can be corrected
    // and the food sent out again — so it goes to the desk immediately.
    await notifyOperators({
      type: NotificationType.OPS_ORDER_PROBLEM,
      orderId,
      restaurantId: outcome.restaurantId,
      params: { code: outcome.code, source: 'DELIVERY', reason },
      link: `${OPERATOR_ROOT}?order=${orderId}`,
    }).catch(() => undefined);

    return { ok: true };
  }),
);


/**
 * Hands an order to one of the restaurant's couriers.
 *
 * The assignment is what scopes everything else: from here the courier can see
 * this order and close it, and still cannot see any other. Assigning is also
 * what makes the restaurant's own screen useful — "who has it" is the question
 * a kitchen asks about a delivery that has been out too long.
 */
export const assignCourier = onCall(
  guard('assignCourier', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);

    const orderId = requireString(data, 'orderId', { max: 128 });
    // Null unassigns: a courier who called in sick should not still hold an
    // order nobody else can see.
    const courierId = optionalString(data, 'courierId', { max: 128 });

    if (!isRestaurantStaff(caller.role)) fail(AppErrorCode.FORBIDDEN);

    const orderRef = db.doc(paths.order(orderId));

    let courierName = '';
    if (courierId) {
      const courierSnapshot = await db.doc(paths.user(courierId)).get();
      if (!courierSnapshot.exists) fail(AppErrorCode.ACCOUNT_NOT_FOUND);

      const courier = courierSnapshot.data() as User;
      // Their own courier, and actually a courier. Assigning a stranger would
      // hand them a customer's address.
      if (courier.role !== UserRole.RESTAURANT_COURIER) fail(AppErrorCode.VALIDATION_FAILED);
      if (courier.restaurantId !== caller.restaurantId) fail(AppErrorCode.FORBIDDEN);

      courierName = courier.fullName;
    }

    const assigned = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(orderRef);
      if (!snapshot.exists) fail(AppErrorCode.ORDER_NOT_FOUND);

      const order = snapshot.data() as Order;
      if (order.restaurantId !== caller.restaurantId) fail(AppErrorCode.FORBIDDEN);
      // Once it is delivered or dead, reassigning changes nothing and only
      // muddies who was holding it.
      if (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLETED) {
        fail(AppErrorCode.TRANSITION_NOT_ALLOWED);
      }

      // Read out of the snapshot before anything is written, because the
      // driver who was holding this order a moment ago has to be told it has
      // left their phone — and after the update there is no record of them.
      const previousCourierId = order.courier?.id ?? null;

      tx.update(orderRef, {
        courier: courierId
          ? {
              id: courierId,
              name: courierName,
              assignedAt: now(),
              // The driver has not answered yet, and the gap between these two
              // is what tells an operator a delivery is sitting on a phone
              // nobody has picked up.
              acceptedAt: null,
            }
          : null,
        // A reassignment starts the operational clock again from nothing: the
        // alerts already raised were about the previous driver.
        alerts: null,
        updatedAt: now(),
      });

      return {
        code: order.code,
        restaurantName: order.restaurantName,
        address: order.address?.line ?? '',
        previousCourierId,
      };
    });

    /*
     * The driver who is no longer on this order.
     *
     * Their card disappears from the active list the instant the write lands —
     * the listener filters on `courier.id` — and a delivery that vanishes off a
     * phone with no explanation is how a driver ends up at a door for a bag
     * somebody else is already carrying. It is not a cancellation: the order is
     * alive and on its way, just not with them.
     */
    if (assigned.previousCourierId && assigned.previousCourierId !== courierId) {
      await notify({
        userId: assigned.previousCourierId,
        role: UserRole.RESTAURANT_COURIER,
        restaurantId: caller.restaurantId ?? null,
        orderId,
        type: NotificationType.COURIER_DELIVERY_UPDATED,
        params: { code: assigned.code, restaurant: assigned.restaurantName },
        link: '/courier/orders',
      });
    }

    // Handed to the same driver again: nothing about who is carrying it
    // changed, so "a delivery was assigned to you" would be a lie. What did
    // change is whatever the restaurant re-ran the assignment for, and the
    // details on the card are no longer the ones the driver memorised.
    if (courierId && assigned.previousCourierId === courierId) {
      await notify({
        userId: courierId,
        role: UserRole.RESTAURANT_COURIER,
        restaurantId: caller.restaurantId ?? null,
        orderId,
        type: NotificationType.COURIER_DELIVERY_UPDATED,
        params: { code: assigned.code, restaurant: assigned.restaurantName },
        link: `/courier/orders/${orderId}`,
      });
    } else if (courierId) {
      /*
       * One notification, whether or not the food is already on the pass.
       *
       * `courierPickupNotification` is asked rather than assumed, because the
       * kitchen marking an order READY asks it too — and if the two happen
       * within a minute of each other the driver must hear one buzz for one
       * bag. The order of the two events does not matter: whichever is second
       * gets a null back and says nothing.
       */
      const pickup = courierPickupNotification({
        assignedAtMs: Date.now(),
        readyAtMs: null,
        trigger: 'assigned',
      });

      if (pickup) {
        await notify({
          userId: courierId,
          role: UserRole.RESTAURANT_COURIER,
          restaurantId: caller.restaurantId ?? null,
          orderId,
          type: pickup,
          params: {
            code: assigned.code,
            restaurant: assigned.restaurantName,
            address: assigned.address,
          },
          link: `/courier/orders/${orderId}`,
        });
      }
    }

    return { ok: true };
  }),
);

/**
 * The driver says they have it.
 *
 * Assignment is the restaurant's decision and acceptance is the driver's, and
 * keeping them apart is what makes "this delivery was handed to a phone that is
 * face-down on a table" a thing the platform can see rather than a thing a
 * customer discovers forty minutes later. Nothing about the order's status
 * changes here: the food is still where it was, and a courier who taps this
 * button has only said they are on their way to it.
 */
export const acceptDelivery = onCall(
  guard('acceptDelivery', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const orderId = requireString(data, 'orderId', { max: 128 });

    if (caller.role !== UserRole.RESTAURANT_COURIER) fail(AppErrorCode.FORBIDDEN);

    const orderRef = db.doc(paths.order(orderId));

    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(orderRef);
      if (!snapshot.exists) fail(AppErrorCode.ORDER_NOT_FOUND);

      const order = snapshot.data() as Order;
      // Their own run, and nobody else's. Accepting a colleague's delivery
      // would clear the alert that says nobody has picked it up.
      if (order.courier?.id !== caller.uid) fail(AppErrorCode.FORBIDDEN);
      // Accepting twice is not an error worth showing anyone; it is the same
      // driver tapping the same button on a slow connection.
      if (order.courier.acceptedAt) return;

      tx.update(orderRef, { 'courier.acceptedAt': now(), updatedAt: now() });
    });

    return { ok: true };
  }),
);

/**
 * Gives the customer the six digits to read out at the door.
 *
 * Only ever returned to the customer, about their own order, and only when the
 * restaurant has asked for codes. The digits are hashed and thrown away, so a
 * refresh cannot get the same ones back — the screen says so rather than
 * spinning.
 */
export const issueDeliveryCode = onCall(
  guard('issueDeliveryCode', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const orderId = requireString(data, 'orderId', { max: 128 });

    const orderRef = db.doc(paths.order(orderId));
    const codeRef = db.doc(paths.deliveryCode(orderId));

    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) fail(AppErrorCode.ORDER_NOT_FOUND);

    const order = orderSnapshot.data() as Order;
    if (order.customerId !== caller.uid) fail(AppErrorCode.FORBIDDEN);
    if (order.status !== OrderStatus.OUT_FOR_DELIVERY) fail(AppErrorCode.TRANSITION_NOT_ALLOWED);

    // A code for a restaurant that does not use codes would be a number the
    // customer reads out to a courier who has nowhere to type it.
    const [restaurant, settings] = await Promise.all([
      db.doc(paths.restaurant(order.restaurantId)).get(),
      db.doc(paths.publicSettings()).get(),
    ]);

    if (
      !deliveryCodeRequired({
        settings: settings.data() as PublicSettings | undefined,
        restaurant: restaurant.data() as Restaurant | undefined,
      })
    ) {
      fail(AppErrorCode.VALIDATION_FAILED, 'codes-not-required');
    }

    const code = generateCode();

    const issued = await db.runTransaction(async (tx) => {
      const existing = await tx.get(codeRef);

      if (existing.exists) {
        const stored = existing.data() as DeliveryCode;
        // Already used: the food is at the door and this order is done with
        // codes. Issuing another would let a spent handover be replayed.
        if (stored.usedAt) fail(AppErrorCode.TRANSITION_NOT_ALLOWED);

        // A live code is not replaced. The customer refreshing their screen
        // must not invalidate the digits the courier is on their way to ask for.
        if ((stored.expiresAt?.toMillis?.() ?? 0) > Date.now()) {
          return null as string | null;
        }
      }

      tx.set(codeRef, {
        orderId,
        codeHash: hashCode(orderId, code),
        // A fresh code clears the attempt count: the old code is dead, so the
        // tries spent against it are no longer evidence of anything.
        attempts: 0,
        expiresAt: Timestamp.fromMillis(Date.now() + CODE_TTL_MINUTES * 60_000),
        usedAt: null,
        createdAt: now(),
      });

      return code;
    });

    return { ok: true, code: issued, unchanged: issued === null };
  }),
);

/**
 * The courier closes the order at the door.
 *
 * One transaction does the attempt count, the consumption of the code and the
 * status change together, so a double tap, a retried request or two couriers
 * with the same login cannot deliver one order twice.
 */
export const courierConfirmDelivery = onCall(
  guard('courierConfirmDelivery', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);

    const orderId = requireString(data, 'orderId', { max: 128 });
    const code = optionalString(data, 'code', { max: 12 });

    const orderRef = db.doc(paths.order(orderId));
    const codeRef = db.doc(paths.deliveryCode(orderId));
    const eventRef = db.collection(paths.orderEvents(orderId)).doc();

    // Read before the transaction: whether codes are required is a property of
    // the restaurant, and a transaction that reads it would be one more read
    // racing the write that matters.
    const orderPeek = await orderRef.get();
    if (!orderPeek.exists) fail(AppErrorCode.ORDER_NOT_FOUND);
    const peeked = orderPeek.data() as Order;

    const [restaurantSnapshot, settingsSnapshot] = await Promise.all([
      db.doc(paths.restaurant(peeked.restaurantId)).get(),
      db.doc(paths.publicSettings()).get(),
    ]);

    /*
     * The platform's policy first, the restaurant's switch second.
     *
     * `deliveryCodeRequired` resolves the two and is the same function the
     * customer's "show me my code" screen and the courier's screen read, so a
     * driver is never asked for a code the server will not take, and never
     * allowed to close an order the platform wanted a code for.
     */
    const codeRequired = deliveryCodeRequired({
      settings: settingsSnapshot.data() as PublicSettings | undefined,
      restaurant: restaurantSnapshot.data() as Restaurant | undefined,
    });

    const result = await db.runTransaction(async (tx) => {
      const [snapshot, codeSnapshot] = await Promise.all([
        tx.get(orderRef),
        codeRequired ? tx.get(codeRef) : Promise.resolve(null),
      ]);

      if (!snapshot.exists) fail(AppErrorCode.ORDER_NOT_FOUND);
      const order = snapshot.data() as Order;

      // The courier this order was given to, or the restaurant's own staff.
      // Not any courier who happens to know an order id.
      const assigned =
        caller.role === UserRole.RESTAURANT_COURIER && order.courier?.id === caller.uid;
      const staff =
        isRestaurantStaff(caller.role) && caller.restaurantId === order.restaurantId;

      if (!assigned && !staff) fail(AppErrorCode.FORBIDDEN);
      if (order.status !== OrderStatus.OUT_FOR_DELIVERY) fail(AppErrorCode.TRANSITION_NOT_ALLOWED);

      if (codeRequired) {
        if (!code || !/^\d{6}$/.test(code)) fail(AppErrorCode.VALIDATION_FAILED, 'code');
        if (!codeSnapshot?.exists) fail(AppErrorCode.DELIVERY_CODE_MISSING);

        const stored = codeSnapshot.data() as DeliveryCode;
        if (stored.usedAt) fail(AppErrorCode.TRANSITION_NOT_ALLOWED);
        if (stored.attempts >= MAX_ATTEMPTS) fail(AppErrorCode.RATE_LIMITED);
        if ((stored.expiresAt?.toMillis?.() ?? 0) <= Date.now()) {
          fail(AppErrorCode.DELIVERY_CODE_EXPIRED);
        }

        if (!equalHashes(stored.codeHash, hashCode(orderId, code))) {
          // The failed try is the only thing this branch writes. A wrong code
          // has to cost an attempt, or the limit means nothing.
          tx.update(codeRef, { attempts: FieldValue.increment(1) });
          return { ok: false as const, remaining: MAX_ATTEMPTS - stored.attempts - 1 };
        }

        tx.update(codeRef, { usedAt: now() });
      }

      /*
       * THE MONEY CHANGED HANDS AT THE DOOR, AND NOBODY WROTE IT DOWN.
       *
       * This wrote the status and the timestamp and stopped there. Its twin in
       * `updateOrderStatus` sets `paymentStatus` on the same transition — so an
       * order the *kitchen* closed was recorded as collected and an order the
       * *courier* closed was not, even though the courier is the one who
       * actually took the cash. Every delivery closed by a driver therefore sat
       * in the books as unpaid: the restaurant's settlement, the month's
       * takings and the operator's "problem orders" list were all wrong, in the
       * restaurant's favour on one screen and against it on another.
       *
       * Only for money owed at the door. An ONLINE_CARD order was paid before
       * the food was cooked and its status is PAID; overwriting that with
       * COLLECTED would erase the fact that the platform is holding the money
       * and owes it on, which is the single number the settlement is built out
       * of.
       */
      const paidAtDoor =
        order.paymentMethod === PaymentMethod.CASH_ON_DELIVERY ||
        order.paymentMethod === PaymentMethod.CARD_ON_DELIVERY;

      tx.update(orderRef, {
        status: OrderStatus.DELIVERED,
        deliveredAt: now(),
        ...(paidAtDoor ? { paymentStatus: PaymentStatus.COLLECTED } : {}),
        updatedAt: now(),
      });

      tx.set(eventRef, {
        id: eventRef.id,
        from: OrderStatus.OUT_FOR_DELIVERY,
        to: OrderStatus.DELIVERED,
        actor: OrderActor.RESTAURANT,
        actorId: caller.uid,
        // Records that a code was checked, never what it was.
        note: codeRequired ? 'delivery-code-verified' : null,
        at: now(),
      });

      return { ok: true as const, customerId: order.customerId, code: order.code };
    });

    if (!result.ok) fail(AppErrorCode.DELIVERY_CODE_INVALID, String(result.remaining));

    // Nothing is sent to the customer: the courier is standing at their door,
    // and a phone that buzzes to announce what its owner is looking at was one
    // of the seven order-status notifications the owner removed.

    return { ok: true };
  }),
);
