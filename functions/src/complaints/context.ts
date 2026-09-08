/**
 * QAPINDA — Everything an operator needs about the customer behind one order.
 *
 * WHY THIS EXISTS
 * ---------------
 * "Sifariş gəlmədi." An operator picking that up can see the one order in front
 * of them and nothing else, and almost every real question is about the rest:
 *
 *   Is this the first time, or the fourth this month?
 *   Did the previous three go to the same address?
 *   Was there an earlier failed delivery to that address, from a different
 *     restaurant, that nobody connected?
 *   Have we already refunded this person twice this week?
 *
 * Without those answers the operator is deciding on one data point, which is
 * how a platform both refuses a genuine customer and pays out repeatedly to a
 * dishonest one. So this returns the customer's recent orders, their failures,
 * their complaints and what has already been given back — assembled server-side
 * and in one call.
 *
 * THE SECURITY SHAPE, WHICH IS THE WHOLE DESIGN
 * ---------------------------------------------
 * The request names an ORDER. It never names a customer.
 *
 * That is the difference between "show me the context for the case I am
 * working" and "show me everything about any person I can name". The customer
 * id is read from the order document by the server, so an operator changing
 * what the browser sends can only ever change WHICH ORDER'S context they get —
 * and every order on this platform is already visible to them. There is no
 * request shape that yields a customer they could not otherwise reach.
 *
 * WHAT IS DELIBERATELY NOT RETURNED
 * ---------------------------------
 * The customer's saved addresses, their email, their other accounts' details,
 * their payment instruments. None of it is needed to judge a complaint, and a
 * support tool that returns everything about a person is a support tool that
 * leaks everything about a person the first time an operator account is
 * phished. What comes back is: orders, their outcomes, and what was paid or
 * refunded on them — which is what the decision actually turns on.
 *
 * The telephone number IS returned in full. This is the one screen where
 * masking it would be theatre: the operator is about to ring the customer back
 * about the order in front of them, and the number is already on that order.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requirePermission } from '../lib/auth';
import { asObject, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { COLLECTIONS, paths } from '../shared/collections';
import { FAILED_ORDER_STATUSES, OrderStatus, PaymentStatus } from '../shared/enums';
import { Permission } from '../shared/permissions';
import type { Complaint, Order } from '../shared/models';

/**
 * How far back to look.
 *
 * Twenty-five orders is several months for an ordinary customer and about a
 * fortnight for a heavy one — enough to see a pattern in either case, and
 * bounded so this stays one cheap query rather than a customer's whole life.
 */
const ORDER_WINDOW = 25;

/** One row on the operator's context list. */
type ContextOrder = {
  id: string;
  code: string;
  restaurantId: string;
  restaurantName: string;
  status: OrderStatus;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  total: number;
  /**
   * What has gone back to the customer on this order.
   *
   * Read from the PAYMENT, not the order: only an online order has a payment
   * to refund, and a cash order's zero here is a fact rather than a gap.
   */
  refundedAmount: number;
  placedAt: number | null;
  /** The address it went to, so a repeated bad address is visible at a glance. */
  addressLine: string | null;
  /** Who opened the door — often the actual explanation. */
  contactName: string | null;
  contactPhone: string | null;
  /** Set when the courier reported a failure, with their own words. */
  failureReason: string | null;
  failureNote: string | null;
  /** True when this order already has a complaint against it. */
  hasComplaint: boolean;
  /** The order the operator is actually working on. */
  isSubject: boolean;
};

export const customerOrderContext = onCall(
  guard('customerOrderContext', async (request) => {
    const { caller } = await requireActiveUser(request);
    // The same permission that lets an operator see the orders board at all.
    // This adds no reach — it only assembles what they can already read.
    requirePermission(caller, Permission.PLATFORM_VIEW_ORDERS);

    const data = asObject(request.data);
    const orderId = requireString(data, 'orderId', { max: 128 });

    const subjectSnap = await db.doc(paths.order(orderId)).get();
    if (!subjectSnap.exists) fail(AppErrorCode.ORDER_NOT_FOUND);
    const subject = subjectSnap.data() as Order;

    /*
     * THE CUSTOMER ID COMES FROM THE ORDER, NOT FROM THE REQUEST.
     *
     * The one line that makes this callable safe. A `customerId` accepted from
     * the caller would turn a support tool into a directory of every customer
     * on the platform, searchable by anybody who ever held an operator login.
     */
    const customerId = subject.customerId;

    const [ordersSnap, complaintsSnap, paymentsSnap] = await Promise.all([
      db
        .collection(COLLECTIONS.orders)
        .where('customerId', '==', customerId)
        .orderBy('placedAt', 'desc')
        .limit(ORDER_WINDOW)
        .get(),
      db
        .collection(COLLECTIONS.complaints)
        .where('customerId', '==', customerId)
        .orderBy('createdAt', 'desc')
        .limit(ORDER_WINDOW)
        .get(),
      /*
       * What this customer has actually been paid back.
       *
       * The single figure most likely to change an operator's mind, and the one
       * they cannot see anywhere else without opening every order in turn.
       * Cash orders have no payment document and contribute nothing, which is
       * correct: the platform never held that money and never sent any back.
       */
      db
        .collection(COLLECTIONS.payments)
        .where('customerId', '==', customerId)
        .limit(ORDER_WINDOW * 2)
        .get(),
    ]);

    /** orderId → what has been refunded on it. */
    const refunds = new Map<string, number>();
    for (const doc of paymentsSnap.docs) {
      const payment = doc.data() as { orderId?: string; refundedAmount?: number };
      if (!payment.orderId) continue;
      refunds.set(payment.orderId, (refunds.get(payment.orderId) ?? 0) + (payment.refundedAmount ?? 0));
    }

    const complained = new Set(
      complaintsSnap.docs.map((doc) => (doc.data() as Complaint).orderId),
    );

    /*
     * The subject order is forced into the list.
     *
     * It is normally in the window anyway, but "normally" is not good enough
     * for the one row the operator came here about: a customer who has ordered
     * thirty times since a complaint was filed last month would otherwise open
     * a context screen that does not contain the order they are looking at.
     */
    const docs = ordersSnap.docs.some((doc) => doc.id === orderId)
      ? ordersSnap.docs
      : [subjectSnap, ...ordersSnap.docs];

    const orders: ContextOrder[] = docs.map((doc) => {
      const order = doc.data() as Order;
      return {
        id: order.id,
        code: order.code,
        restaurantId: order.restaurantId,
        restaurantName: order.restaurantName,
        status: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        total: order.pricing?.total ?? 0,
        refundedAmount: refunds.get(order.id) ?? 0,
        placedAt: order.placedAt?.toMillis?.() ?? null,
        addressLine: order.address?.line ?? null,
        contactName: order.address?.contactName ?? null,
        contactPhone: order.address?.phone ?? null,
        failureReason: order.deliveryFailure?.reason ?? null,
        failureNote: order.deliveryFailure?.note ?? null,
        /*
         * Why a cancelled order was cancelled.
         *
         * The delivery-failure reason was already carried and the cancellation
         * reason was not, so an operator reading a ticket could see why a
         * driver could not hand an order over but not why an order never left
         * the kitchen. Both are the same question asked of a different ending.
         *
         * No `by` and no timestamp: this list answers "what has happened to
         * this customer lately", and the detail belongs on the order itself.
         */
        cancelReason: order.cancellation?.reason ?? null,
        cancelNote: order.cancellation?.note ?? null,
        hasComplaint: complained.has(order.id),
        isSubject: order.id === orderId,
      };
    });

    /*
     * The summary.
     *
     * Counted here rather than on the screen so that every operator sees the
     * same arithmetic, and so that "how many of this customer's orders went
     * wrong" cannot come out differently in two places. The refund total is the
     * figure that actually changes a decision: three refunds in a fortnight is
     * a different conversation from a first one.
     */
    const failed = orders.filter((order) => FAILED_ORDER_STATUSES.includes(order.status));
    const refunded = orders.reduce((sum, order) => sum + order.refundedAmount, 0);

    return {
      ok: true,
      customer: {
        // Named from the ORDER's frozen snapshot rather than from the account,
        // so an anonymised customer still shows as the person the order was
        // placed by rather than as a blank row an operator cannot make sense of.
        name: subject.customerName,
        phone: subject.customerPhone,
      },
      summary: {
        orderCount: orders.length,
        failedCount: failed.length,
        complaintCount: complaintsSnap.size,
        refundedTotal: refunded,
        /** True when the window filled up — "at least this many", not "exactly". */
        truncated: ordersSnap.size >= ORDER_WINDOW,
      },
      orders,
    };
  }),
);
