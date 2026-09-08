/**
 * QAPINDA — "The food arrived and something was wrong."
 *
 * WHAT THIS CAN AND CANNOT DO, stated plainly
 * -------------------------------------------
 * This file is the customer's side: filing, and the queue. What an operator
 * then DOES about it — uphold or reject, refund or coupon, keep or waive the
 * commission — lives in `resolve.ts`, which is where the reasoning for each of
 * those three answers is written down.
 *
 * What the platform can do, it does:
 *  - put the problem in front of the restaurant immediately, with the reason
 *    and any photos, so they can ring the customer;
 *  - give the customer back what the platform is actually holding, or a coupon
 *    where it never held anything;
 *  - keep the record, so "this one is always cold" becomes visible.
 *
 * WHY THE COMMISSION IS SAFE TO RETURN
 * ------------------------------------
 * Commission is posted 60 minutes after delivery by `settleDeliveredOrders`.
 * A complaint filed inside that hour therefore usually arrives *before* any
 * ledger entry exists — and this function marks the order so the job skips it,
 * which is cheaper and cleaner than posting a charge and reversing it. If the
 * hour has already passed, a reversing entry is written instead, so the ledger
 * still adds up and still shows what happened.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, now } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { cleanOptional } from '../lib/moderation';
import { requireActiveUser } from '../lib/auth';
import { notify, notifyOperators } from '../lib/notify';
import {
  asObject,
  optionalString,
  optionalStringArray,
  requireEnum,
  requireString,
  sanitiseText,
} from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { COLLECTIONS, paths } from '../shared/collections';
import {
  ComplaintReason,
  ComplaintStatus,
  PaymentMethod,
  NotificationType,
  OrderStatus,
  RESTAURANT_ROLES,
  UserRole,
} from '../shared/enums';
import { OPERATOR_ROOT } from '../shared/permissions';
import { displayName } from '../shared/reviews';
import { isCapturedPayment, type Payment } from '../shared/payments';
import type { Complaint, Order, User } from '../shared/models';

/**
 * How long after delivery a complaint may be filed.
 *
 * Two days: long enough for somebody who ate late and complained the next
 * morning, short enough that the kitchen still remembers the order.
 */
const WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const DELIVERED_STATUSES: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.COMPLETED];

const REASONS = Object.values(ComplaintReason);

export const fileComplaint = onCall(
  guard('fileComplaint', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    const orderId = requireString(data, 'orderId', { max: 128 });
    const reason = requireEnum<ComplaintReason>(data, 'reason', REASONS);
    // The operator reading this and the restaurant it is about are both other
    // people, so the same rule applies here as to a support message.
    const rawDetail = optionalString(data, 'detail', { max: 600 });
    const detail = cleanOptional(rawDetail ? sanitiseText(rawDetail) : null);
    const photoUrls = optionalStringArray(data, 'photoUrls', { max: 4, maxLength: 500 });

    const orderRef = db.doc(paths.order(orderId));
    const complaintRef = db.doc(paths.complaint(orderId));

    const complaint = await db.runTransaction(async (transaction) => {
      const [orderSnapshot, existing] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(complaintRef),
      ]);

      if (!orderSnapshot.exists) fail(AppErrorCode.ORDER_NOT_FOUND);
      const order = orderSnapshot.data() as Order;

      if (order.customerId !== caller.uid) fail(AppErrorCode.FORBIDDEN);
      if (!DELIVERED_STATUSES.includes(order.status)) fail(AppErrorCode.COMPLAINT_NOT_ELIGIBLE);
      if (existing.exists) fail(AppErrorCode.COMPLAINT_ALREADY_FILED);

      const deliveredAt = order.deliveredAt?.toMillis?.() ?? order.completedAt?.toMillis?.() ?? 0;
      if (deliveredAt > 0 && Date.now() - deliveredAt > WINDOW_MS) {
        fail(AppErrorCode.COMPLAINT_WINDOW_CLOSED);
      }

      const record = {
        id: orderId,
        orderId,
        orderCode: order.code,
        restaurantId: order.restaurantId,
        restaurantName: order.restaurantName,
        customerId: caller.uid,
        // The restaurant is about to ring this person, so they get the real
        // name and number — unlike a review, which is public and shortened.
        customerName: (user as User).fullName,
        customerPhone: order.customerPhone,
        reason,
        detail: detail.text,
        filtered: detail.filtered,
        photoUrls,
        status: ComplaintStatus.OPEN,
        resolution: null,
        resolvedBy: null,
        resolvedAt: null,
        creditedAmount: 0,
        createdAt: now(),
      } as unknown as Complaint;

      transaction.set(complaintRef, record);
      transaction.update(orderRef, { complaintAt: now() });

      return record;
    });

    // Told, not asked: the restaurant should be reaching for the phone before
    // an operator has even opened the queue. Sent after the transaction, so a
    // retried transaction cannot produce two notifications for one complaint.
    const restaurantSnapshot = await db.doc(paths.restaurant(complaint.restaurantId)).get();
    const ownerUserId = (restaurantSnapshot.data() as { ownerUserId?: string } | undefined)
      ?.ownerUserId;

    if (ownerUserId) {
      await notify({
        userId: ownerUserId,
        role: UserRole.RESTAURANT_OWNER,
        restaurantId: complaint.restaurantId,
        orderId: complaint.orderId,
        type: NotificationType.COMPLAINT_FILED,
        params: { code: complaint.orderCode },
        link: '/panel/complaints',
      });
    }

    // A customer saying something went wrong is the plainest case of "a problem
    // reported on an order", and the one operational alert no setting may hide.
    await notifyOperators({
      type: NotificationType.OPS_ORDER_PROBLEM,
      orderId: complaint.orderId,
      restaurantId: complaint.restaurantId,
      params: { code: complaint.orderCode, source: 'CUSTOMER', reason: complaint.reason },
      link: `${OPERATOR_ROOT}?order=${complaint.orderId}`,
    }).catch(() => undefined);

    return { ok: true };
  }),
);

/**
 * The queue.
 *
 * An operator gets every restaurant's; a restaurant gets only its own. The
 * scoping is decided here rather than trusted from the request, which is the
 * whole reason this is a callable and not a client query.
 */
export const listComplaints = onCall(
  guard('listComplaints', async (request) => {
    const { caller } = await requireActiveUser(request);

    const data = asObject(request.data);
    const status = optionalString(data, 'status', { max: 40 });

    const platform =
      caller.role === UserRole.SUPER_ADMIN || caller.role === UserRole.OPERATOR;

    let query = db.collection(COLLECTIONS.complaints).orderBy('createdAt', 'desc').limit(100);

    if (!platform) {
      /*
       * A COURIER IS NOT RESTAURANT STAFF, and this is the line that used to
       * forget it.
       *
       * The old test was "do you have a `restaurantId`" — and a courier does,
       * because `setRestaurantStaff` writes one. So a delivery account could
       * call this and receive every complaint the restaurant had ever
       * received: customer names, telephone numbers, what went wrong, and the
       * photographs. For orders it never delivered.
       *
       * That account lives on a personal telephone that gets lost, sold, and
       * handed to the next driver. `orders` and its notifications were both
       * rewritten to keep a courier to the orders it was actually given; this
       * file was missed.
       *
       * `isRestaurantStaff` is the same three-role list those fixes used.
       */
      if (!(RESTAURANT_ROLES as readonly UserRole[]).includes(caller.role)) {
        fail(AppErrorCode.FORBIDDEN);
      }
      if (!caller.restaurantId) fail(AppErrorCode.FORBIDDEN);
      query = db
        .collection(COLLECTIONS.complaints)
        .where('restaurantId', '==', caller.restaurantId)
        .orderBy('createdAt', 'desc')
        .limit(100);
    }

    const snapshot = await query.get();

    const rows = snapshot.docs
      .map((doc) => doc.data() as Complaint)
      .filter((complaint) => !status || complaint.status === status);

    /*
     * WHAT THE OPERATOR MAY OFFER, ANSWERED HERE.
     *
     * Whether this order can be refunded is not a property of the complaint —
     * it depends on the order's payment method and on what the provider
     * actually captured and has not already sent back. The panel must not work
     * that out for itself from a guess, because a screen that offers a refund
     * on a cash order is a screen that promises a customer money that does not
     * exist.
     *
     * So the two orders' documents are read here and folded into each row. Only
     * for platform staff and only for the ones still open: a restaurant has no
     * business knowing what the platform is holding, and a closed complaint has
     * no decision left to make. That keeps this to a handful of reads even when
     * the queue is long.
     */
    const open = platform
      ? rows.filter((complaint) => complaint.status === ComplaintStatus.OPEN)
      : [];

    const context = new Map<string, { paymentMethod: string; refundable: number; total: number }>();

    await Promise.all(
      open.map(async (complaint) => {
        const orderSnapshot = await db.doc(paths.order(complaint.orderId)).get();
        if (!orderSnapshot.exists) return;

        const order = orderSnapshot.data() as Order;

        const paymentSnapshot =
          order.paymentMethod === PaymentMethod.ONLINE_CARD && order.paymentId
            ? await db.doc(paths.payment(order.paymentId)).get()
            : null;
        const payment = paymentSnapshot?.data() as Payment | undefined;

        context.set(complaint.orderId, {
          paymentMethod: order.paymentMethod,
          refundable:
            payment && isCapturedPayment(payment.state)
              ? Math.max(payment.amount - payment.refundedAmount, 0)
              : 0,
          total: order.pricing.total,
        });
      }),
    );

    const complaints = rows.map((complaint) =>
      platform
        ? { ...complaint, ...(context.get(complaint.orderId) ?? {}) }
        : {
            // A restaurant sees who to call, but never the customer's other
            // orders or account — this is the one order's context.
            ...complaint,
            customerId: '',
            customerName: displayName(complaint.customerName),
          },
    );

    return { ok: true, complaints };
  }),
);
