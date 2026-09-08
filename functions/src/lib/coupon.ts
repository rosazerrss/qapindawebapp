/**
 * QAPINDA — Giving a coupon back when the order it paid for dies.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `createOrder` claims a redemption and increments the campaign's `usedCount`
 * inside the order transaction. Nothing ever gave either of them back, and the
 * consequences ran in both directions:
 *
 *   • AGAINST THE PLATFORM. `PENDING_PAYMENT` is not an active status, so an
 *     account could open unpaid order after unpaid order, each one burning a
 *     slot of a campaign's total budget, and walk a launch offer to zero
 *     without spending a manat. The customers it was meant for then find a
 *     code that says "limit reached".
 *
 *   • AGAINST THE CUSTOMER. Somebody closes the bank page once, and their one
 *     welcome discount is gone for good — spent on an order that never
 *     existed, with no screen anywhere able to explain why.
 *
 * WHERE IT IS CALLED FROM
 * -----------------------
 * The three places an order can die after it was created: a cancellation or a
 * rejection in `updateOrderStatus`, the unanswered-kitchen sweep in
 * `expireStaleOrders`, and the unpaid sweep in `expirePendingPayments`.
 *
 * A `DELIVERY_FAILED` order does NOT release. The food was cooked and the trip
 * was made; the discount was consumed by a real order that went wrong, which is
 * a compensation question, not a coupon-accounting one.
 *
 * WHY IT IS SAFE TO RUN TWICE
 * ---------------------------
 * The redemption's document id is derived from (code, customer, order), so the
 * delete is idempotent. The decrement is not — so it is issued ONLY when the
 * redemption document was still there to delete, which is the same condition,
 * checked at the same instant, inside the same transaction. An order released
 * twice therefore decrements once.
 */

import type { Transaction, WriteBatch } from 'firebase-admin/firestore';

import { FieldValue, db } from './admin';
import { COLLECTIONS, couponRedemptionId, normaliseCouponCode, paths } from '../shared/collections';
import type { Order } from '../shared/models';

/**
 * Undoes the redemption an order claimed, if it claimed one.
 *
 * Transaction form: the caller must have already READ the redemption document
 * (Firestore refuses a read after a write), so this takes the snapshot rather
 * than fetching it. `releaseCouponRefs` builds the references to read.
 */
export function releaseCouponIn(
  tx: Transaction,
  order: Pick<Order, 'id' | 'customerId' | 'coupon'>,
  redemptionExists: boolean,
): void {
  const refs = releaseCouponRefs(order);
  if (!refs || !redemptionExists) return;

  tx.delete(refs.redemption);
  tx.update(refs.coupon, { usedCount: FieldValue.increment(-1) });
}

/**
 * The two documents a release touches, or null when the order used no coupon.
 *
 * Separated so a transaction can read the redemption before it writes anything,
 * and so a batch-based sweep can check existence with one `getAll`.
 */
export function releaseCouponRefs(
  order: Pick<Order, 'id' | 'customerId' | 'coupon'>,
): { redemption: FirebaseFirestore.DocumentReference; coupon: FirebaseFirestore.DocumentReference } | null {
  const code = order.coupon?.code;
  if (!code) return null;

  const normalised = normaliseCouponCode(code);
  if (!normalised) return null;

  return {
    redemption: db.doc(paths.couponRedemption(normalised, order.customerId, order.id)),
    coupon: db.collection(COLLECTIONS.coupons).doc(normalised),
  };
}

/**
 * Batch form, for the scheduled sweeps.
 *
 * The caller passes the redemption snapshots it already fetched — a sweep
 * handles up to a hundred orders at a time and one `getAll` for all of them is
 * one round trip, where a read per order inside the loop would be a hundred.
 */
export function releaseCouponInBatch(
  batch: WriteBatch,
  order: Pick<Order, 'id' | 'customerId' | 'coupon'>,
  redemptionExists: boolean,
): void {
  const refs = releaseCouponRefs(order);
  if (!refs || !redemptionExists) return;

  batch.delete(refs.redemption);
  batch.update(refs.coupon, { usedCount: FieldValue.increment(-1) });
}

/** The redemption id an order would have claimed. Diagnostics and tests. */
export function redemptionIdFor(
  order: Pick<Order, 'id' | 'customerId' | 'coupon'>,
): string | null {
  const code = order.coupon?.code;
  if (!code) return null;
  return couponRedemptionId(normaliseCouponCode(code), order.customerId, order.id);
}
