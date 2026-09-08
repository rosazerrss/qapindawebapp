/**
 * QAPINDA — What a courier's app is allowed to be about.
 *
 * A courier account belongs to exactly one restaurant and carries exactly the
 * deliveries handed to it. That sentence is the whole security model of the
 * courier app, and this file is the executable copy of it: the two status
 * buckets its screens are built from, and the predicate that answers "may this
 * account read this order?".
 *
 * WHY THE PREDICATE LIVES HERE RATHER THAN IN THE SCREEN
 * -----------------------------------------------------
 * The boundary that actually holds is `firestore.rules` — a courier who calls
 * the database directly, or edits an order id in a URL, is refused by the
 * server and not by a component. But a rule nobody can run is a rule nobody can
 * test, and "courier A cannot reach courier B's delivery" is precisely the
 * claim that has to be *asserted* rather than believed. So the rule's clause is
 * mirrored here, `tests/courierPermissions.test.ts` runs it against every pair
 * of actors, and the same file checks that `firestore.rules` still says it too.
 * Change one and change the other.
 *
 * NO STATUSES ARE INVENTED HERE
 * -----------------------------
 * Both buckets are drawn from `OrderStatus`, which the state machine in
 * `orderState.ts` owns. This file decides only which of those existing statuses
 * a driver's "active" and "past" lists are made of — never what an order may
 * become.
 */

import { OrderStatus, UserRole } from './enums';

/**
 * The deliveries that are still this driver's problem.
 *
 * It starts at ACCEPTED rather than at READY, and that is deliberate: a
 * restaurant assigns a driver while the food is still being cooked, and a
 * delivery that only appears once the kitchen presses "ready" is a delivery the
 * driver had no warning of. The card says which of the four it is, so nobody is
 * sent to a door for a bag that is still in the oven.
 *
 * PLACED is not here. An order the restaurant has not accepted yet may never
 * exist at all, and a driver who rides towards one is riding towards nothing.
 */
export const COURIER_ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
];

/**
 * The endings — every way a delivery stops being work.
 *
 * Six values, which matters: Firestore's `in` takes at most ten, so this list
 * can be passed to a query as it stands. DELIVERED and COMPLETED are the same
 * ending seen a few minutes apart (the settlement job promotes one to the
 * other), and the four unhappy ones are kept apart because "the customer
 * cancelled" and "nobody answered the door" are different facts about a
 * driver's evening.
 */
export const COURIER_HISTORY_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.EXPIRED,
  OrderStatus.DELIVERY_FAILED,
];

/** Which of the driver's two lists a status belongs in, if either. */
export function courierBucket(status: OrderStatus): 'active' | 'history' | null {
  if (COURIER_ACTIVE_STATUSES.includes(status)) return 'active';
  if (COURIER_HISTORY_STATUSES.includes(status)) return 'history';
  return null;
}

/** Whether this ending was a delivery that arrived. Drives ✓ against ✕. */
export function courierDeliveredWell(status: OrderStatus): boolean {
  return status === OrderStatus.DELIVERED || status === OrderStatus.COMPLETED;
}

/** Who is asking. `uid` and `role` come from the token, never from a form. */
export interface CourierViewer {
  uid: string | null;
  role: UserRole | null;
  /** The restaurant on the viewer's claim. Present but never sufficient. */
  restaurantId: string | null;
}

/** The two fields of an order that decide whether a courier may read it. */
export interface CourierOrderRef {
  restaurantId: string;
  /** The id of the driver carrying it, or null while nobody is. */
  courierId: string | null;
}

/**
 * Whether this courier account may read this order.
 *
 * The executable copy of the courier clause in the `orders` rule, and it is
 * narrower than "works for the restaurant" on purpose. Belonging to the shop
 * buys nothing: a courier reaches an order by being the person written on it
 * and by no other route, so a driver cannot read the colleague on the next
 * moped's run, and cannot read the address of an order nobody has been given
 * yet. This account rides around town on a personal phone that gets lost, sold
 * and handed on, and the customers it can reach must be the ones it was sent to.
 *
 * Says nothing about anybody else — a customer and the restaurant's own staff
 * have their own clauses in the rule. Ask this only about a courier.
 */
export function courierMayReadOrder(viewer: CourierViewer, order: CourierOrderRef): boolean {
  if (viewer.role !== UserRole.RESTAURANT_COURIER) return false;
  if (!viewer.uid) return false;
  // An unassigned order must never match an account with a missing uid, and a
  // driver from another restaurant must never match one whose id happens to be
  // null: both sides have to be a real, equal id.
  if (!order.courierId) return false;
  return order.courierId === viewer.uid;
}
