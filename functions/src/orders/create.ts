/**
 * QAPINDA — Placing an order.
 *
 * THE RULE: the browser sends a shopping list, never a bill.
 *
 * What arrives is product ids, quantities and chosen options. Every price is
 * re-read from Firestore and every total re-computed here. A cart that has been
 * open since lunchtime, or one edited in a developer console, produces the same
 * correct total either way — and if the price moved, the customer is told
 * rather than quietly charged.
 *
 * The whole thing commits in one transaction: the order, the coupon redemption,
 * the coupon counter and the idempotency claim either all land or none do.
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, now, minutesFromNow, FieldValue, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { cleanOptional } from '../lib/moderation';
import { requireActiveUser, requireCustomerAccount, requireNotUnderReview } from '../lib/auth';
import { notifyIn } from '../lib/notify';
import { readClaimIn, writeClaimIn } from '../lib/idempotency';
import {
  asObject,
  hashAddress,
  optionalString,
  requireEnum,
  requireString,
} from '../lib/validate';
import { recordDeviceSignal } from '../users/account';
import { AppErrorCode, COUPON_ERROR_TO_CODE, LINE_ERROR_TO_CODE } from '../shared/errors';
import {
  ACTIVE_ORDER_STATUSES,
  isOnlinePayment,
  FulfillmentType,
  NotificationType,
  OrderActor,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  RestaurantStatus,
  ServiceState,
  UserRole,
  V1_PAYMENT_METHODS,
} from '../shared/enums';
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  couponRedemptionId,
  normaliseCouponCode,
  orderIdempotencyKey,
  paths,
} from '../shared/collections';
import { buildOrderItem, calculateTotals, evaluateCoupon, formatMoney } from '../shared/pricing';
import { orderingIsOpen } from '../shared/maintenance';
import { checkDeliveryRange, mayDeliverTo } from '../shared/geo';
import { addressDeliverable, deliveryContact } from '../shared/addressContact';
import type {
  Address,
  Coupon,
  OrderItem,
  Product,
  PublicSettings,
  Restaurant,
  RestaurantBusiness,
} from '../shared/models';
import { epointConfig } from '../payments/epoint';

const MAX_LINES = 40;

/**
 * One order at a time.
 *
 * The owner's rule, and it fits how the marketplace actually works: every
 * restaurant delivers with its own courier, so a customer with two orders open
 * is two kitchens and two drivers converging on one door — and when something
 * goes wrong, nobody can say which order it was about. Finish one, then order
 * again.
 */
const MAX_ACTIVE_ORDERS = 1;

/**
 * How many orders may sit unpaid at the bank page at once.
 *
 * Three. Abandoning a payment and starting again is something a real person
 * does — a card declined, a wrong SMS code, a page closed by accident — so this
 * cannot be one. It also cannot be unbounded: see the note at the call site.
 */
const MAX_UNPAID_ORDERS = 3;

/**
 * The cancellation brake.
 *
 * A customer who orders and cancels repeatedly costs a restaurant real food and
 * a real courier run. Every marketplace ends up with some version of this rule;
 * ours is deliberately gentle and readable:
 *
 *  - only *the customer's own* cancellations count. An order the restaurant
 *    rejected, or one that expired because nobody answered, is not the
 *    customer's fault and must never be held against them;
 *  - it is a pause, not a ban — the window rolls, so it clears itself;
 *  - the number is small enough to catch abuse and large enough that a person
 *    having a bad week is not locked out.
 *
 * Support can lift it early by cancelling nothing: there is no flag to unset,
 * because there is no flag. That is the point — a rule with no state cannot
 * strand somebody through an oversight.
 */
const CANCEL_WINDOW_DAYS = 7;
const MAX_CUSTOMER_CANCELLATIONS = 3;
const DEFAULT_RESPONSE_WINDOW_MIN = 10;

interface CartLine {
  productId: string;
  quantity: number;
  selectedOptionIds: string[];
  note?: string | null;
}

function parseLines(input: unknown): CartLine[] {
  if (!Array.isArray(input) || input.length === 0) fail(AppErrorCode.CART_EMPTY);
  if (input.length > MAX_LINES) fail(AppErrorCode.VALIDATION_FAILED, 'items');

  return input.map((raw) => {
    const line = raw as Record<string, unknown>;
    if (typeof line.productId !== 'string' || !line.productId) {
      fail(AppErrorCode.VALIDATION_FAILED, 'productId');
    }
    if (typeof line.quantity !== 'number') fail(AppErrorCode.INVALID_QUANTITY);

    const options = Array.isArray(line.selectedOptionIds) ? line.selectedOptionIds : [];
    if (options.length > 30) fail(AppErrorCode.VALIDATION_FAILED, 'selectedOptionIds');

    return {
      productId: line.productId,
      quantity: line.quantity,
      selectedOptionIds: options.filter((id): id is string => typeof id === 'string'),
      // A per-item note reaches the kitchen printout, so it is moderated too.
      note: typeof line.note === 'string' ? cleanOptional(line.note).text : null,
    };
  });
}

/** A short, readable order number. Collisions do not matter: the id is the key. */
function orderCode(id: string): string {
  const digits = id.replace(/[^0-9]/g, '');
  const tail = (digits.length >= 4 ? digits : Date.now().toString()).slice(-4);
  return `QP-${tail}`;
}

/** Is the restaurant open right now, by its own opening hours (UTC+4)? */
function isOpenNow(restaurant: Restaurant, at: Date): boolean {
  const local = new Date(at.getTime() + 4 * 60 * 60 * 1000);
  const day = local.getUTCDay();
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();

  const today = restaurant.openingHours.find((entry) => entry.day === day);
  if (today && !today.closed && minutes >= today.opensAt && minutes < today.closesAt) return true;

  // A shift that started yesterday and runs past midnight.
  const yesterday = restaurant.openingHours.find((entry) => entry.day === (day + 6) % 7);
  if (yesterday && !yesterday.closed && yesterday.closesAt > 1440) {
    if (minutes < yesterday.closesAt - 1440) return true;
  }
  return false;
}

/**
 * ONE WARM INSTANCE ON THE CHECKOUT PATH.
 *
 * Cloud Functions scale to zero, so the first call after a quiet spell pays a
 * cold start — one and a half to four seconds while the container boots and
 * Node loads the bundle. On most of the ninety-nine callables here nobody
 * notices. On this one it lands at the exact moment somebody has decided to
 * spend money, which is the single worst place in the funnel to insert four
 * seconds of nothing.
 *
 * One instance is a few dollars a month and removes the cold start from the
 * path that earns the platform its commission.
 */
export const createOrder = onCall(
  { minInstances: 1 },
  guard('createOrder', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    /*
     * THE FIRST GATE: only a customer orders food.
     *
     * Checked here, before anything is read or priced, and checked against the
     * stored user document rather than anything the caller sent. Hiding the
     * button in the app is not security — this callable can be invoked
     * directly with a valid token, and a restaurant account that could reach
     * this line would be writing its own sales figures, earning its own
     * commission discount and spending customer coupons.
     */
    requireCustomerAccount(user, 'createOrder');
    // An account flagged for review can look, but not order — the flag exists
    // precisely because something about its ordering looked wrong.
    requireNotUnderReview(user);

    const data = asObject(request.data);

    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const clientRequestId = requireString(data, 'clientRequestId', { min: 8, max: 64 });
    const paymentMethod = requireEnum<PaymentMethod>(data, 'paymentMethod', V1_PAYMENT_METHODS);
    const onlinePayment = isOnlinePayment(paymentMethod);
    const addressId = requireString(data, 'addressId', { max: 128 });
    // The kitchen and the courier both read this, so it goes through the
    // filter like anything else one person writes for another.
    const customerNote = cleanOptional(optionalString(data, 'customerNote', { max: 300 })).text;
    const couponCodeRaw = optionalString(data, 'couponCode', { max: 40 });
    const couponCode = couponCodeRaw ? normaliseCouponCode(couponCodeRaw) : null;
    const deviceId = optionalString(data, 'deviceId', { max: 128 });
    const lines = parseLines(data.items);

    // -----------------------------------------------------------------------
    // Reads, all before the transaction: shop, menu, address, limits.
    // -----------------------------------------------------------------------

    const [restaurantSnap, businessSnap, addressSnap, settingsSnap] = await Promise.all([
      db.doc(paths.restaurant(restaurantId)).get(),
      db.doc(paths.restaurantBusiness(restaurantId)).get(),
      db.doc(`${paths.user(caller.uid)}/${SUBCOLLECTIONS.addresses}/${addressId}`).get(),
      db.doc(paths.publicSettings()).get(),
    ]);

    /*
     * THE PLATFORM GATE.
     *
     * Read from `publicSettings` — the document this server just fetched — and
     * never from anything in the request. Hiding the order button is a
     * courtesy to somebody looking at the screen; this is the line that means
     * a request assembled by hand, or replayed from a tab that was open before
     * the platform closed, is refused too.
     *
     * Checked before the restaurant is even looked at, so the customer is told
     * the platform is closed rather than being told their kebab shop is shut.
     */
    if (!orderingIsOpen(settingsSnap.data() as PublicSettings | undefined)) {
      fail(AppErrorCode.PLATFORM_MAINTENANCE);
    }

    if (!restaurantSnap.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
    const restaurant = restaurantSnap.data() as Restaurant;

    if (restaurant.status !== RestaurantStatus.ACTIVE) fail(AppErrorCode.RESTAURANT_NOT_ACTIVE);
    if (restaurant.serviceState === ServiceState.PAUSED) fail(AppErrorCode.RESTAURANT_PAUSED);
    if (restaurant.serviceState === ServiceState.CLOSED || !isOpenNow(restaurant, new Date())) {
      fail(AppErrorCode.RESTAURANT_CLOSED);
    }
    if (!restaurant.paymentMethods.includes(paymentMethod)) {
      fail(AppErrorCode.PAYMENT_METHOD_NOT_ACCEPTED);
    }

    // Two gates, not one. A restaurant may accept a method the platform has
    // switched off — during an outage, or before the merchant contract is
    // signed — and the platform's answer has to win.
    const platformMethods = (settingsSnap.data() as PublicSettings | undefined)
      ?.enabledPaymentMethods;
    if (platformMethods && !platformMethods.includes(paymentMethod)) {
      fail(AppErrorCode.PAYMENT_METHOD_NOT_ACCEPTED);
    }

    // And online payment additionally needs a configured provider. Taking the
    // order first and discovering that afterwards would leave a customer
    // holding an order they cannot pay for and cannot cancel.
    if (onlinePayment && !epointConfig()) fail(AppErrorCode.PAYMENT_NOT_CONFIGURED);

    if (!addressSnap.exists) fail(AppErrorCode.ADDRESS_NOT_FOUND);
    const address = addressSnap.data() as Address;

    /*
     * THE ADDRESS HAS TO KNOW WHO OPENS THE DOOR.
     *
     * A name, a number, and a number that has been proved. The checkout screen
     * applies exactly this function before it enables the button, so nobody
     * should meet this refusal — but the screen is a courtesy and this is the
     * enforcement, and the two cannot drift because they are the same function.
     *
     * The detail names which of the three is missing, so the screen can say
     * "telefonu təsdiqləyin" rather than "xəta baş verdi".
     *
     * Addresses saved before this existed have no contact at all. They are
     * refused here rather than quietly falling back to the account holder,
     * because a silent fallback is precisely the behaviour this whole feature
     * exists to end. What the customer sees is one prompt to complete an
     * address they already have, once.
     */
    const deliverable = addressDeliverable({
      contactName: address.contactName,
      phone: address.phone,
      phoneVerified: address.phoneVerified,
    });
    if (!deliverable.ok) fail(AppErrorCode.ADDRESS_NOT_DELIVERABLE, deliverable.reason ?? undefined);

    const contact = deliveryContact({
      addressContactName: address.contactName,
      addressPhone: address.phone,
      accountName: user.fullName,
      accountPhone: user.phone,
    });

    /*
     * THE DELIVERY CIRCLE, ENFORCED.
     *
     * The restaurant drew it in its own panel and the customer saw it on the
     * map; this is the line that makes it mean something. The owner's rule:
     * an address inside the radius may order, an address outside it may not.
     *
     * The checkout screen already marks an out-of-range address using this
     * same shared function, so a customer should never reach here and be
     * surprised — but the screen is a courtesy and this is the enforcement.
     */
    const range = checkDeliveryRange(restaurant, address);
    if (range.verdict === 'outside') {
      fail(AppErrorCode.ADDRESS_OUT_OF_RANGE, String(Math.round(range.distanceMetres! / 100) / 10));
    }
    if (range.reason === 'address-not-pinned') fail(AppErrorCode.ADDRESS_LOCATION_MISSING);
    if (range.reason === 'restaurant-not-pinned') {
      // Allowed, and recorded. See `shared/geo.ts`: a restaurant with no pin
      // has drawn no circle, and taking its orders offline would punish it for
      // a gap in its own profile that no customer can do anything about. The
      // log is what makes it visible to somebody who can fix it.
      logger.warn('restaurant has no map pin, delivery radius not enforced', { restaurantId });
    }

    const settings = settingsSnap.data() as PublicSettings | undefined;
    const business = businessSnap.data() as RestaurantBusiness | undefined;
    const commissionRateBps = business?.commissionRateBps ?? settings?.defaultCommissionRateBps ?? 1200;
    const responseWindowMinutes =
      business?.responseWindowMinutes ??
      settings?.defaultResponseWindowMinutes ??
      DEFAULT_RESPONSE_WINDOW_MIN;

    // A person with three orders already in flight is either a restaurant
    // themselves or a problem. Either way, a human should look.
    const activeOrders = await db
      .collection(COLLECTIONS.orders)
      .where('customerId', '==', caller.uid)
      .where('status', 'in', ACTIVE_ORDER_STATUSES)
      .limit(MAX_ACTIVE_ORDERS + 1)
      .get();
    if (activeOrders.size >= MAX_ACTIVE_ORDERS) fail(AppErrorCode.TOO_MANY_ACTIVE_ORDERS);

    /*
     * UNPAID ORDERS ARE COUNTED TOO, SEPARATELY.
     *
     * `PENDING_PAYMENT` is deliberately not an ACTIVE status — the kitchen is
     * never told about an order nobody has paid for, and that is right. But the
     * one-live-order rule was reading only the active list, so an account could
     * open unpaid orders in a loop: unbounded documents, unbounded payment
     * claims, and — before the fix in this same file — a coupon budget burned
     * to zero for free.
     *
     * A higher ceiling than the live-order rule, because abandoning a bank page
     * and trying again is ordinary behaviour. Three in flight is generous for a
     * person and useless for a script; they clear themselves after thirty
     * minutes when `expirePendingPayments` runs.
     */
    const unpaidOrders = await db
      .collection(COLLECTIONS.orders)
      .where('customerId', '==', caller.uid)
      .where('status', '==', OrderStatus.PENDING_PAYMENT)
      .limit(MAX_UNPAID_ORDERS + 1)
      .get();
    if (unpaidOrders.size >= MAX_UNPAID_ORDERS) fail(AppErrorCode.TOO_MANY_ACTIVE_ORDERS);

    // Recent cancellations, counted from the orders themselves rather than a
    // counter on the account: a counter drifts, and this one would be deciding
    // whether somebody may eat.
    /*
     * COUNTED BY TELEPHONE NUMBER, NOT BY ACCOUNT.
     *
     * `customerId` alone made this brake free to remove: delete the account,
     * register again on the same number, and the seven-day history is a fresh
     * uid with nothing in it. The telephone number is the thing a person
     * actually has to keep — it is what Firebase signs them in with, and what
     * the account locks are built on — so it is what the count follows.
     *
     * `customerPhone` is written onto every order at placement, so this needs
     * no join and no migration; orders placed before the field existed simply
     * do not match, which fails safe.
     *
     * The limit is raised because one number may legitimately span two accounts
     * over time and a stale order should not eat somebody's whole allowance.
     */
    const cancellationQuery = user.phone
      ? db.collection(COLLECTIONS.orders).where('customerPhone', '==', user.phone)
      : db.collection(COLLECTIONS.orders).where('customerId', '==', caller.uid);

    const recentCancellations = await cancellationQuery
      .where('status', '==', OrderStatus.CANCELLED)
      .where('placedAt', '>=', Timestamp.fromMillis(Date.now() - CANCEL_WINDOW_DAYS * 86_400_000))
      .limit(MAX_CUSTOMER_CANCELLATIONS + 20)
      .get();

    const byCustomer = recentCancellations.docs.filter(
      (doc) => (doc.data() as { cancellation?: { by?: string } }).cancellation?.by ===
        OrderActor.CUSTOMER,
    ).length;

    if (byCustomer >= MAX_CUSTOMER_CANCELLATIONS) fail(AppErrorCode.TOO_MANY_CANCELLATIONS);

    // Load exactly the products in the cart — never the whole menu.
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const productDocs = await db.getAll(
      ...productIds.map((productId) => db.doc(paths.product(productId))),
    );
    const products = new Map<string, Product>();
    for (const doc of productDocs) {
      if (!doc.exists) continue;
      const product = doc.data() as Product;
      // A product id from another restaurant's menu must not price here.
      if (product.restaurantId !== restaurantId) fail(AppErrorCode.CART_MIXED_RESTAURANTS);
      products.set(doc.id, product);
    }

    // -----------------------------------------------------------------------
    // Pricing — recomputed from the stored menu, not from the payload.
    // -----------------------------------------------------------------------

    const items: OrderItem[] = [];
    for (const line of lines) {
      const result = buildOrderItem(line, products.get(line.productId));
      if (!result.ok || !result.item) {
        fail(LINE_ERROR_TO_CODE[result.error!] ?? AppErrorCode.VALIDATION_FAILED, result.detail);
      }
      items.push(result.item);
    }

    // The distance decides which delivery band applies. `range` was measured
    // above against this very address; a restaurant with no bands ignores it.
    const distanceMetres = range.distanceMetres;

    const preliminary = calculateTotals({ items, restaurant, distanceMetres });
    if (preliminary.belowMinimum) fail(AppErrorCode.BELOW_MINIMUM_ORDER);

    /*
     * THE PRICE THE CUSTOMER WAS LOOKING AT WHEN THEY PRESSED THE BUTTON.
     *
     * A restaurant can edit its menu at any moment, including the seconds
     * between a customer reading a total and tapping "Sifariş ver". Without
     * this check the order is simply priced at the new number and the person
     * pays more than they agreed to — silently, and at the door, where the
     * argument is with a courier who had nothing to do with it.
     *
     * TWO THINGS WERE WRONG WITH THE OLD VERSION.
     *
     * First, it compared the *total* — which includes a delivery fee and a
     * discount the server computes itself — so it was checking the client's
     * arithmetic as much as the restaurant's prices. Second, and worse, it gave
     * up entirely whenever a coupon was present (`couponCode ? null : ...`), so
     * the one guard against a price change was switched off for every customer
     * using a coupon. Both of those together meant it effectively never fired.
     *
     * It now compares the SUBTOTAL: the items, at the prices the menu is
     * charging right now. That is the only number a restaurant can move, it is
     * unaffected by coupons and delivery fees, and it is exactly what the
     * customer's basket showed them.
     */
    if (typeof data.expectedSubtotal === 'number') {
      if (!Number.isInteger(data.expectedSubtotal)) {
        fail(AppErrorCode.VALIDATION_FAILED, 'expectedSubtotal');
      }
      if (data.expectedSubtotal !== preliminary.subtotal) fail(AppErrorCode.PRICE_CHANGED);
    }

    const addressFingerprint = hashAddress(address.city, address.line);

    // -----------------------------------------------------------------------
    // Coupon eligibility — counted per PERSON, not per account.
    // -----------------------------------------------------------------------

    let coupon: Coupon | null = null;
    let redemptionsByCustomer = 0;

    if (couponCode) {
      const couponSnap = await db.doc(paths.coupon(couponCode)).get();
      if (!couponSnap.exists) fail(AppErrorCode.COUPON_NOT_FOUND);
      coupon = couponSnap.data() as Coupon;

      // Three separate counts, because a per-account limit is one sign-up away
      // from being meaningless. The strictest wins.
      const [byAccount, byPhone, byAddress] = await Promise.all([
        db
          .collection(COLLECTIONS.couponRedemptions)
          .where('code', '==', couponCode)
          .where('customerId', '==', caller.uid)
          .count()
          .get(),
        db
          .collection(COLLECTIONS.couponRedemptions)
          .where('code', '==', couponCode)
          .where('phone', '==', user.phone)
          .count()
          .get(),
        db
          .collection(COLLECTIONS.couponRedemptions)
          .where('code', '==', couponCode)
          .where('addressHash', '==', addressFingerprint)
          .count()
          .get(),
      ]);

      redemptionsByCustomer = Math.max(
        byAccount.data().count,
        byPhone.data().count,
        byAddress.data().count,
      );
    }

    const couponResult = evaluateCoupon(coupon, {
      subtotal: preliminary.subtotal,
      deliveryFee: preliminary.deliveryFee,
      restaurantId,
      // The first-order test looks at completed orders, so an abandoned or
      // cancelled one cannot be used to farm the welcome discount.
      customerId: caller.uid,
      isFirstOrder: !user.hasCompletedOrder,
      redemptionsByCustomer,
      nowMillis: Date.now(),
    });

    if (couponCode && !couponResult.valid) {
      fail(COUPON_ERROR_TO_CODE[couponResult.error!] ?? AppErrorCode.COUPON_NOT_FOUND);
    }

    const pricing = calculateTotals({
      items,
      restaurant,
      couponDiscount: couponResult.discount,
      distanceMetres,
    });

    // -----------------------------------------------------------------------
    // Commit. One transaction: order, redemption, counter, idempotency claim.
    // -----------------------------------------------------------------------

    const idempotencyKey = orderIdempotencyKey(caller.uid, clientRequestId);
    const orderRef = db.collection(COLLECTIONS.orders).doc();
    const code = orderCode(orderRef.id);

    const result = await db.runTransaction(async (tx) => {
      // EVERY READ FIRST. Firestore refuses a transaction that reads after it
      // has written, and the refusal is an exception the caller sees as a bare
      // "something went wrong" — which is exactly what claiming the
      // idempotency key before re-reading the coupon used to produce. Orders
      // without a coupon never hit the second read, so the bug only ever
      // appeared for customers who had a coupon: the worst possible shape for
      // a bug, because it looks like the coupon is broken rather than the
      // order.
      const couponRef = coupon && couponResult.valid ? db.doc(paths.coupon(couponCode!)) : null;

      const [existingClaim, freshCoupon] = await Promise.all([
        readClaimIn(tx, idempotencyKey),
        couponRef ? tx.get(couponRef) : Promise.resolve(null),
      ]);

      if (existingClaim) {
        // The same submit arriving twice. Hand back the first order, not a second.
        return {
          duplicated: true,
          orderId: existingClaim.resultRef ?? null,
          code: null,
        };
      }

      // Checked against the copy read inside the transaction: a campaign that
      // ran out between the preview and the commit must not overspend.
      if (couponRef && freshCoupon) {
        if (!freshCoupon.exists) fail(AppErrorCode.COUPON_NOT_FOUND);
        const current = freshCoupon.data() as Coupon;
        if (!current.active) fail(AppErrorCode.COUPON_INACTIVE);
        if (current.usageLimitTotal !== null && current.usedCount >= current.usageLimitTotal) {
          fail(AppErrorCode.COUPON_LIMIT_REACHED);
        }
      }

      // ---- from here on, writes only ----
      writeClaimIn(tx, idempotencyKey, 'createOrder', orderRef.id);

      if (couponRef) {
        const redemptionRef = db.doc(
          paths.couponRedemption(couponCode!, caller.uid, orderRef.id),
        );
        tx.set(redemptionRef, {
          id: couponRedemptionId(couponCode!, caller.uid, orderRef.id),
          code: couponCode,
          customerId: caller.uid,
          orderId: orderRef.id,
          phone: user.phone,
          addressHash: addressFingerprint,
          deviceId,
          discountAmount: couponResult.discount,
          createdAt: now(),
        });
        tx.update(couponRef, { usedCount: FieldValue.increment(1) });
      }

      tx.set(orderRef, {
        id: orderRef.id,
        code,

        customerId: caller.uid,
        customerName: user.fullName,
        // The restaurant delivers with its own driver, so it needs the number.
        customerPhone: user.phone,

        restaurantId,
        restaurantName: restaurant.name,
        restaurantPhone: restaurant.publicPhone ?? '',

        fulfillment: FulfillmentType.DELIVERY,
        address: {
          label: address.label,
          line: address.line,
          note: address.note,
          city: address.city,
          lat: address.lat,
          lng: address.lng,
          // The details a pin cannot carry, frozen with the order so that
          // editing the address afterwards cannot rewrite where a courier was
          // sent. `?? null` rather than a spread: an address written before
          // these fields existed has `undefined`, and Firestore is configured
          // to drop undefined, which would leave the snapshot silently short.
          building: address.building ?? null,
          apartment: address.apartment ?? null,
          floor: address.floor ?? null,
          company: address.company ?? null,
          /*
           * WHO THE COURIER ASKS FOR, AND WHICH NUMBER RINGS.
           *
           * `deliveryContact` decides both, in one place shared with every
           * screen that displays them, so the restaurant's ticket, the
           * courier's card, the operator's panel and the printed slip cannot
           * disagree about who is at the door.
           */
          phone: contact.phone,
          contactName: contact.name,
          contactIsAccountHolder: !contact.fromAddress,
        },

        items,
        pricing,
        coupon:
          coupon && couponResult.valid
            ? {
                code: coupon.code,
                type: coupon.type,
                fundedBy: coupon.fundedBy,
                discountAmount: couponResult.discount,
                // Frozen with the order: who paid for this discount is a fact
                // about this order, not a setting that can be renegotiated.
                restaurantFunding: couponResult.funding?.restaurant ?? 0,
                platformFunding: couponResult.funding?.platform ?? 0,
              }
            : null,

        // Frozen now. A rate change tomorrow must not rewrite this invoice.
        commissionRateBps,
        commissionAmount: null,
        platformFundedDiscount: 0,

        paymentMethod,
        // Cash or card at the door owes the platform nothing up front. An
        // online order owes everything up front, and is not a real order until
        // the bank says so.
        paymentStatus: onlinePayment ? PaymentStatus.PENDING : PaymentStatus.DUE_ON_DELIVERY,
        paymentId: null,
        paidAt: null,

        // An unpaid online order must never reach the kitchen. It waits in
        // PENDING_PAYMENT until the verified callback moves it on — otherwise
        // a restaurant cooks for somebody who closed the bank page.
        status: onlinePayment ? OrderStatus.PENDING_PAYMENT : OrderStatus.PLACED,
        // The response clock only starts once the restaurant can actually see
        // the order. Starting it at checkout would expire orders while the
        // customer was still typing a card number.
        responseDeadlineAt: onlinePayment ? null : minutesFromNow(responseWindowMinutes),
        estimatedDeliveryAt: minutesFromNow(restaurant.estimatedMinutesMax),

        customerNote,
        cancellation: null,

        reviewedAt: null,
        complaintAt: null,
        placedAt: now(),
        acceptedAt: null,
        preparingAt: null,
        readyAt: null,
        outForDeliveryAt: null,
        deliveredAt: null,
        completedAt: null,
        updatedAt: now(),
      });

      tx.set(db.doc(`${orderRef.path}/${SUBCOLLECTIONS.orderEvents}/placed`), {
        id: 'placed',
        from: null,
        to: onlinePayment ? OrderStatus.PENDING_PAYMENT : OrderStatus.PLACED,
        actor: OrderActor.CUSTOMER,
        actorId: caller.uid,
        note: null,
        at: now(),
      });

      tx.set(db.doc(paths.orderPrivateMeta(orderRef.id)), {
        ip: request.rawRequest.ip ?? null,
        userAgent: request.rawRequest.headers['user-agent'] ?? null,
        deviceId,
        riskFlags: [],
      });

      // The restaurant's owner gets the ping; the panel also listens live.
      // Not for an unpaid online order: telling a kitchen about an order it
      // must not start is worse than telling it nothing.
      if (!onlinePayment) {
        notifyIn(tx, {
          userId: restaurant.ownerUserId,
          role: UserRole.RESTAURANT_OWNER,
          restaurantId,
          orderId: orderRef.id,
          type: NotificationType.NEW_ORDER_FOR_RESTAURANT,
          /*
           * FORMATTED HERE, NOT IN THE SENTENCE.
           *
           * This passed the raw integer — money is held in qəpik everywhere in
           * this codebase — and the sentence read "{{code}} — {{total}} qəpik".
           * So a 25 manat order rang the kitchen tablet as "2500 qəpik", which
           * is both wrong-looking and, for a second, alarming.
           *
           * `formatMoney` is the same function the receipt and the panel use, so
           * the banner, the ticket and the screen now say the identical figure.
           * Every other money notification in this codebase already did this;
           * this was the one that did not.
           */
          params: { code, total: formatMoney(pricing.total) },
          // The panel's board, which is where a new order actually appears. There
              // is no `/restaurant/sifaris/:id` route and there never was: that link
              // 404'd, so a kitchen tapping the notification landed nowhere.
              link: '/panel',
        });
      }

      return {
        duplicated: false,
        orderId: orderRef.id,
        code,
      };
    });

    /*
     * The operator's desk is NOT told about an order that is going normally.
     *
     * It used to be, on every single order, and the owner removed it: a queue
     * that rings for the orders going well is a queue nobody is still reading
     * when one of them goes wrong. The desk has a live order list for the
     * ordinary case; what reaches it as a notification is trouble — no answer
     * from the kitchen, a refusal, a late order, a cancellation, a reported
     * problem.
     */

    if (!result.duplicated) {
      // Fire and forget: a fingerprint that fails to write must not fail an order.
      void recordDeviceSignal(deviceId, caller.uid, user.phone);
      logger.info('order placed', {
        orderId: result.orderId,
        restaurantId,
        total: pricing.total,
      });
    }

    return {
      ok: true,
      orderId: result.orderId,
      code: result.code ?? code,
      total: pricing.total,
      duplicated: result.duplicated,
    };
  }),
);

/**
 * Prices a cart without placing it — what the checkout screen shows.
 *
 * Deliberately the same code path as `createOrder`, so the number on the button
 * and the number in the order can never differ. It also validates the coupon,
 * which is why the coupon collection itself is unreadable by clients.
 */
export const previewOrder = onCall(
  guard('previewOrder', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    // The same gate as `createOrder`, for the same reason: a work account must
    // not be able to price a basket either, because the price it would be shown
    // is a price it can never pay — and because the coupon evaluation that runs
    // below is exactly the campaign arithmetic a restaurant must not reach.
    requireCustomerAccount(user, 'previewOrder');
    const data = asObject(request.data);

    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const couponCodeRaw = optionalString(data, 'couponCode', { max: 40 });
    const couponCode = couponCodeRaw ? normaliseCouponCode(couponCodeRaw) : null;
    const addressId = optionalString(data, 'addressId', { max: 128 });
    const lines = parseLines(data.items);

    const [restaurantSnap, settingsSnap] = await Promise.all([
      db.doc(paths.restaurant(restaurantId)).get(),
      db.doc(paths.publicSettings()).get(),
    ]);

    /*
     * The same platform gate as `createOrder`, and read the same way.
     *
     * A preview that priced a cart happily while the order behind it would be
     * refused is the "fails at the last step" behaviour the owner asked us to
     * avoid: the checkout screen learns here that the platform is closed, and
     * closes the ordering path rather than letting somebody fill in an address
     * and press a button that was never going to work.
     */
    if (!orderingIsOpen(settingsSnap.data() as PublicSettings | undefined)) {
      fail(AppErrorCode.PLATFORM_MAINTENANCE);
    }

    if (!restaurantSnap.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
    const restaurant = restaurantSnap.data() as Restaurant;

    const productIds = [...new Set(lines.map((line) => line.productId))];
    const productDocs = await db.getAll(
      ...productIds.map((productId) => db.doc(paths.product(productId))),
    );
    const products = new Map<string, Product>();
    for (const doc of productDocs) {
      if (!doc.exists) continue;
      const product = doc.data() as Product;
      if (product.restaurantId !== restaurantId) fail(AppErrorCode.CART_MIXED_RESTAURANTS);
      products.set(doc.id, product);
    }

    /*
     * The delivery circle, answered before the customer commits.
     *
     * `createOrder` refuses an address outside the radius; this tells the
     * checkout screen the same thing while there is still something the
     * customer can do about it — pick another address, or another restaurant.
     * The verdict is computed by the shared function the refusal uses, so the
     * two cannot disagree.
     */
    let deliveryRange: ReturnType<typeof checkDeliveryRange> | null = null;
    if (addressId) {
      const addressSnap = await db
        .doc(`${paths.user(caller.uid)}/${SUBCOLLECTIONS.addresses}/${addressId}`)
        .get();
      if (addressSnap.exists) {
        deliveryRange = checkDeliveryRange(restaurant, addressSnap.data() as Address);
      }
    }

    const items: OrderItem[] = [];
    const problems: Array<{ productId: string; code: string; detail?: string }> = [];

    for (const line of lines) {
      const result = buildOrderItem(line, products.get(line.productId));
      if (!result.ok || !result.item) {
        // A preview reports every problem at once rather than stopping at the
        // first, so the customer fixes their cart in one pass.
        problems.push({
          productId: line.productId,
          code: LINE_ERROR_TO_CODE[result.error!] ?? AppErrorCode.VALIDATION_FAILED,
          detail: result.detail,
        });
        continue;
      }
      items.push(result.item);
    }

    // Null until an address is chosen, which is exactly right: a basket priced
    // before the customer says where it is going gets the flat fee, and the
    // figure firms up the moment they pick one.
    const previewDistance = deliveryRange?.distanceMetres ?? null;

    const base = calculateTotals({ items, restaurant, distanceMetres: previewDistance });

    let couponError: string | null = null;
    let discount = 0;
    let fundedBy: string | null = null;

    if (couponCode) {
      const couponSnap = await db.doc(paths.coupon(couponCode)).get();
      const coupon = couponSnap.exists ? (couponSnap.data() as Coupon) : null;

      let redemptions = 0;
      if (coupon) {
        const counts = await Promise.all([
          db
            .collection(COLLECTIONS.couponRedemptions)
            .where('code', '==', couponCode)
            .where('customerId', '==', caller.uid)
            .count()
            .get(),
          db
            .collection(COLLECTIONS.couponRedemptions)
            .where('code', '==', couponCode)
            .where('phone', '==', user.phone)
            .count()
            .get(),
        ]);
        redemptions = Math.max(...counts.map((snapshot) => snapshot.data().count));
      }

      const evaluated = evaluateCoupon(coupon, {
        subtotal: base.subtotal,
        deliveryFee: base.deliveryFee,
        restaurantId,
        customerId: caller.uid,
        isFirstOrder: !user.hasCompletedOrder,
        redemptionsByCustomer: redemptions,
        nowMillis: Date.now(),
      });

      if (evaluated.valid) {
        discount = evaluated.discount;
        fundedBy = evaluated.fundedBy ?? null;
      } else {
        couponError = COUPON_ERROR_TO_CODE[evaluated.error!] ?? AppErrorCode.COUPON_NOT_FOUND;
      }
    }

    const pricing = calculateTotals({
      items,
      restaurant,
      couponDiscount: discount,
      distanceMetres: previewDistance,
    });

    return {
      ok: problems.length === 0,
      problems,
      items,
      pricing,
      couponError,
      // The funder is returned so the UI can say who is paying for the discount.
      couponFundedBy: fundedBy,
      addressId: addressId ?? null,
      // Null when no address was named. `deliverable` is the single answer the
      // screen acts on; the distance travels with it so the customer can be
      // told how far out they are rather than just "no".
      deliveryRange: deliveryRange
        ? {
            verdict: deliveryRange.verdict,
            reason: deliveryRange.reason,
            distanceMetres: deliveryRange.distanceMetres,
            radiusMetres: deliveryRange.radiusMetres,
            deliverable: mayDeliverTo(deliveryRange),
          }
        : null,
      open:
        restaurant.status === RestaurantStatus.ACTIVE &&
        restaurant.serviceState === ServiceState.OPEN &&
        isOpenNow(restaurant, new Date()),
    };
  }),
);
