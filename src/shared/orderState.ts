/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Order state machine.
 *
 * The single place that answers "may this actor move this order from A to B?".
 * Cloud Functions call it before every write; the UI calls the same function to
 * decide which buttons to render, so the two can never disagree.
 *
 * Two rules are enforced here rather than trusted to any caller:
 *   - A customer may cancel only while the restaurant has not accepted yet.
 *   - A restaurant may never mark an order as anything outside its own lane,
 *     and never touch an order belonging to a different restaurant (that part
 *     is the tenant check in the rules, this part is the lane check).
 */

import { OrderActor, OrderStatus, TERMINAL_ORDER_STATUSES } from './enums';

export interface Transition {
  to: OrderStatus;
  actors: OrderActor[];
  /** A written reason is mandatory — it ends up in the order and the audit log. */
  requiresReason?: boolean;
}

/**
 * Allowed moves out of each status.
 *
 * PENDING_PAYMENT and the refund states exist for the online-payment phase.
 * Nothing in V1 produces them, but leaving them in the machine means switching
 * online payment on later does not reshape stored orders.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, Transition[]> = {
  [OrderStatus.PENDING_PAYMENT]: [
    { to: OrderStatus.PLACED, actors: [OrderActor.SYSTEM] },
    { to: OrderStatus.PAYMENT_FAILED, actors: [OrderActor.SYSTEM] },
    { to: OrderStatus.CANCELLED, actors: [OrderActor.CUSTOMER, OrderActor.PLATFORM], requiresReason: true },
  ],

  [OrderStatus.PLACED]: [
    { to: OrderStatus.ACCEPTED, actors: [OrderActor.RESTAURANT, OrderActor.PLATFORM] },
    { to: OrderStatus.REJECTED, actors: [OrderActor.RESTAURANT, OrderActor.PLATFORM], requiresReason: true },
    // The customer's only window to cancel: before the kitchen commits.
    { to: OrderStatus.CANCELLED, actors: [OrderActor.CUSTOMER, OrderActor.PLATFORM], requiresReason: true },
    { to: OrderStatus.EXPIRED, actors: [OrderActor.SYSTEM] },
  ],

  [OrderStatus.ACCEPTED]: [
    { to: OrderStatus.PREPARING, actors: [OrderActor.RESTAURANT] },
    { to: OrderStatus.CANCELLED, actors: [OrderActor.RESTAURANT, OrderActor.PLATFORM], requiresReason: true },
  ],

  [OrderStatus.PREPARING]: [
    { to: OrderStatus.READY, actors: [OrderActor.RESTAURANT] },
    { to: OrderStatus.CANCELLED, actors: [OrderActor.PLATFORM], requiresReason: true },
  ],

  [OrderStatus.READY]: [
    { to: OrderStatus.OUT_FOR_DELIVERY, actors: [OrderActor.RESTAURANT] },
    // Pickup orders skip the road entirely.
    { to: OrderStatus.DELIVERED, actors: [OrderActor.RESTAURANT] },
    { to: OrderStatus.CANCELLED, actors: [OrderActor.PLATFORM], requiresReason: true },
  ],

  [OrderStatus.OUT_FOR_DELIVERY]: [
    { to: OrderStatus.DELIVERED, actors: [OrderActor.RESTAURANT] },
    // The courier went and could not hand it over. A reason is mandatory: this
    // is the record that later explains a complaint, a refund or a bad address.
    {
      to: OrderStatus.DELIVERY_FAILED,
      actors: [OrderActor.RESTAURANT, OrderActor.PLATFORM],
      requiresReason: true,
    },
    { to: OrderStatus.CANCELLED, actors: [OrderActor.PLATFORM], requiresReason: true },
  ],

  [OrderStatus.DELIVERED]: [
    { to: OrderStatus.COMPLETED, actors: [OrderActor.SYSTEM, OrderActor.PLATFORM] },
  ],

  // Terminal
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.REJECTED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.EXPIRED]: [],
  [OrderStatus.DELIVERY_FAILED]: [],
  [OrderStatus.PAYMENT_FAILED]: [],
  [OrderStatus.REFUND_PENDING]: [
    { to: OrderStatus.REFUNDED, actors: [OrderActor.PLATFORM, OrderActor.SYSTEM] },
  ],
  [OrderStatus.REFUNDED]: [],
};

export type TransitionRejection =
  | 'terminal-status'
  | 'transition-not-allowed'
  | 'actor-not-allowed'
  | 'reason-required';

export interface TransitionCheck {
  allowed: boolean;
  reason?: TransitionRejection;
  requiresReason: boolean;
}

/** The one authority on whether a status change may happen. */
export function checkTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
  note?: string | null,
): TransitionCheck {
  if (isTerminal(from)) {
    return { allowed: false, reason: 'terminal-status', requiresReason: false };
  }

  const transition = (ORDER_TRANSITIONS[from] ?? []).find((entry) => entry.to === to);
  if (!transition) {
    return { allowed: false, reason: 'transition-not-allowed', requiresReason: false };
  }

  const requiresReason = transition.requiresReason === true;

  if (!transition.actors.includes(actor)) {
    return { allowed: false, reason: 'actor-not-allowed', requiresReason };
  }
  if (requiresReason && !note?.trim()) {
    return { allowed: false, reason: 'reason-required', requiresReason };
  }

  return { allowed: true, requiresReason };
}

/**
 * How long the customer has to change their mind.
 *
 * The owner's rule: "eger sifariş qebul edilmeyibse 2-3 deqiqe erzinde legv
 * ede bilsin eger 3 deqiqe keçibse leğv ede bilmesin." Three minutes from the
 * moment the order was placed, and only while the kitchen has not accepted it.
 *
 * Both halves matter and neither alone is enough. Without the clock, an order
 * sitting unanswered for twenty minutes could still be cancelled after the
 * kitchen has started cooking off a printed ticket; without the acceptance
 * test, a restaurant that answers in forty seconds would still be exposed for
 * another two minutes.
 */
export const CUSTOMER_CANCEL_WINDOW_MS = 3 * 60 * 1000;

/**
 * The same number in minutes, for the settings screen.
 *
 * The window is a business rule rather than a physical one, so it is now
 * settable — `PublicSettings.customerCancelWindowMinutes`. This constant is
 * what answers for a platform that has never changed it, and it is what every
 * caller falls back to when the settings document has not been read yet.
 */
export const CUSTOMER_CANCEL_WINDOW_MINUTES = 3;

/** Sane bounds, enforced identically by the panel and by the server. */
export const MIN_CANCEL_WINDOW_MINUTES = 1;
export const MAX_CANCEL_WINDOW_MINUTES = 30;

export type CancelWindowState =
  | { open: true; msRemaining: number }
  | { open: false; reason: 'accepted' | 'expired' | 'finished' };

/**
 * May the customer still cancel this order, and for how much longer?
 *
 * The SERVER's answer is the one that counts — `updateOrderStatus` calls this
 * with its own clock, and a request that arrives a second late is refused
 * however long the browser thinks it has. The screen calls the same function
 * only to decide whether to draw the button and what number to count down.
 *
 * `placedAtMs` of null means an order whose timestamp has not landed yet (a
 * Firestore server timestamp is null in the local echo of the write). Treated
 * as still open, because the order is at most milliseconds old — the server
 * re-measures against the stored value before anything is cancelled.
 */
export function customerCancelWindow(
  status: OrderStatus,
  placedAtMs: number | null,
  nowMs: number,
  /**
   * The platform's configured window, in minutes.
   *
   * Optional so that every existing caller keeps working unchanged and gets the
   * three minutes it always got. A caller that HAS read the settings passes
   * them, and the server always does — the customer's screen may be showing a
   * countdown from a stale settings document, and the server re-measures
   * against its own before anything is actually cancelled.
   */
  windowMinutes: number = CUSTOMER_CANCEL_WINDOW_MINUTES,
): CancelWindowState {
  const windowMs =
    Math.min(
      Math.max(Math.round(windowMinutes), MIN_CANCEL_WINDOW_MINUTES),
      MAX_CANCEL_WINDOW_MINUTES,
    ) *
    60 *
    1000;
  // The state machine decides what may move at all; this only narrows it.
  const allowedByMachine = (ORDER_TRANSITIONS[status] ?? []).some(
    (transition) =>
      transition.to === OrderStatus.CANCELLED && transition.actors.includes(OrderActor.CUSTOMER),
  );

  if (!allowedByMachine) {
    return { open: false, reason: isTerminal(status) ? 'finished' : 'accepted' };
  }

  /*
   * An online order the bank never confirmed is the one exception, and it is
   * not a loophole: PENDING_PAYMENT means no kitchen has been told, no food
   * has been touched and no money has moved. The three-minute brake exists to
   * protect a restaurant that is about to start cooking; there is nothing to
   * protect here, and closing the window would leave the customer holding an
   * order they cannot pay for and cannot get rid of — while it occupies their
   * one active-order slot.
   */
  if (status === OrderStatus.PENDING_PAYMENT) {
    return { open: true, msRemaining: windowMs };
  }

  if (placedAtMs === null) return { open: true, msRemaining: windowMs };

  const msRemaining = placedAtMs + windowMs - nowMs;
  return msRemaining > 0 ? { open: true, msRemaining } : { open: false, reason: 'expired' };
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

/** Statuses this actor may move the order to right now — drives the UI buttons. */
export function nextStatusesFor(from: OrderStatus, actor: OrderActor): OrderStatus[] {
  return (ORDER_TRANSITIONS[from] ?? [])
    .filter((transition) => transition.actors.includes(actor))
    .map((transition) => transition.to);
}

/** True while the restaurant still owes the customer an answer. */
export function awaitingRestaurant(status: OrderStatus): boolean {
  return status === OrderStatus.PLACED;
}

/** Progress for the customer's tracking screen: 0…4, or null on an unhappy ending. */
export function trackingStep(status: OrderStatus): number | null {
  switch (status) {
    case OrderStatus.PLACED:
      return 0;
    case OrderStatus.ACCEPTED:
    case OrderStatus.PREPARING:
      return 1;
    case OrderStatus.READY:
    case OrderStatus.OUT_FOR_DELIVERY:
      return 2;
    case OrderStatus.DELIVERED:
    case OrderStatus.COMPLETED:
      return 3;
    default:
      return null;
  }
}

/** Timestamp field written when an order arrives at a status. */
export const STATUS_TIMESTAMP_FIELD: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.ACCEPTED]: 'acceptedAt',
  [OrderStatus.PREPARING]: 'preparingAt',
  [OrderStatus.READY]: 'readyAt',
  [OrderStatus.OUT_FOR_DELIVERY]: 'outForDeliveryAt',
  [OrderStatus.DELIVERED]: 'deliveredAt',
  [OrderStatus.COMPLETED]: 'completedAt',
};
