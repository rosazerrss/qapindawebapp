/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Online payment, provider-independent.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM EPOINT
 * -------------------------------------------
 * Epoint is the first provider, not the last. The order engine must not learn
 * Epoint's vocabulary, because the day a second provider is added — or the day
 * the first one is dropped — every place that spoke it would have to be found
 * and rewritten, and the places that were missed would fail quietly and about
 * money. So the rest of the system knows only what is in this file: a payment
 * has a state, an amount, a provider name and an opaque provider reference.
 *
 * WHAT THE STATES ARE FOR
 * -----------------------
 * A payment is not the order. The customer can abandon the bank page and come
 * back an hour later; the bank can answer twice, or answer after we gave up, or
 * answer for an order that has since been cancelled. Every one of those is a
 * normal Tuesday, and each needs a state it can legally be in.
 *
 * The one rule that is not negotiable: a payment becomes PAID only because the
 * provider said so *to the server*, over a signed callback the server verified.
 * A customer landing back on the success URL proves nothing — that URL is a
 * link anybody can type.
 */

import type { CurrencyCode, MinorUnits, TimestampLike } from './models';

/** The states a payment attempt can be in. */
export const PaymentState = {
  /** Created, customer not yet sent to the provider. */
  CREATED: 'CREATED',
  /** Customer is at the provider's page. Nothing is decided. */
  PENDING: 'PENDING',
  /** The provider confirmed it, to the server, with a valid signature. */
  PAID: 'PAID',
  /** The provider declined it. */
  FAILED: 'FAILED',
  /** The customer backed out at the provider. */
  CANCELLED: 'CANCELLED',
  /** Never answered. Set by the sweeper, not by anything a client can call. */
  EXPIRED: 'EXPIRED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentState = (typeof PaymentState)[keyof typeof PaymentState];

/** States after which the money question is settled and will not change. */
export const TERMINAL_PAYMENT_STATES: PaymentState[] = [
  PaymentState.FAILED,
  PaymentState.CANCELLED,
  PaymentState.EXPIRED,
  PaymentState.REFUNDED,
];

/**
 * Which moves are legal.
 *
 * Written down rather than left to each call site, for the same reason the
 * order has a state machine: a provider that answers twice, or answers late,
 * must not be able to walk a payment backwards from PAID into PENDING.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  [PaymentState.CREATED]: [
    PaymentState.PENDING,
    PaymentState.FAILED,
    PaymentState.CANCELLED,
    PaymentState.EXPIRED,
  ],
  [PaymentState.PENDING]: [
    PaymentState.PAID,
    PaymentState.FAILED,
    PaymentState.CANCELLED,
    PaymentState.EXPIRED,
  ],
  // Money that arrived can only ever go back out again.
  [PaymentState.PAID]: [PaymentState.REFUND_PENDING, PaymentState.PARTIALLY_REFUNDED],
  [PaymentState.REFUND_PENDING]: [
    PaymentState.REFUNDED,
    PaymentState.PARTIALLY_REFUNDED,
    // A refund the provider refuses leaves the money exactly where it was.
    PaymentState.PAID,
  ],
  [PaymentState.PARTIALLY_REFUNDED]: [PaymentState.REFUND_PENDING, PaymentState.REFUNDED],
  [PaymentState.FAILED]: [],
  [PaymentState.CANCELLED]: [],
  [PaymentState.EXPIRED]: [],
  [PaymentState.REFUNDED]: [],
};

export function canMovePayment(from: PaymentState, to: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * States in which the customer's money actually reached the platform.
 *
 * A refund does not undo that: the money arrived, and then some of it left
 * again. The settlement needs both facts separately — the takings the platform
 * is holding, and the refunds that reduced them — because netting them into one
 * number is how a month's figures stop matching the bank's.
 *
 * This is the *only* thing that may decide "the platform is holding this
 * order's money". The order's own `paymentStatus` is a denormalised copy that
 * can lag behind a callback, and settling money against a copy is how a
 * restaurant gets credited for a payment that never cleared.
 */
export const CAPTURED_PAYMENT_STATES: PaymentState[] = [
  PaymentState.PAID,
  PaymentState.REFUND_PENDING,
  PaymentState.PARTIALLY_REFUNDED,
  PaymentState.REFUNDED,
];

export function isCapturedPayment(state: PaymentState): boolean {
  return CAPTURED_PAYMENT_STATES.includes(state);
}

/**
 * `payments/{paymentId}` — one attempt to collect money for one order.
 *
 * An order can have several: the first attempt fails, the customer tries again.
 * Exactly one of them may ever reach PAID, and the order carries that one's id.
 */
export interface Payment {
  id: string;
  orderId: string;
  customerId: string;
  restaurantId: string;

  /** 'epoint' today. Never assumed anywhere outside the provider's own module. */
  provider: string;
  /** The provider's own id for this transaction, once it gives us one. */
  providerTransactionId: string | null;
  /** The bank's reference, which is what a customer's bank statement shows. */
  providerBankTransactionId: string | null;

  /** What the server calculated. The provider is checked against this, never the reverse. */
  amount: MinorUnits;
  currency: CurrencyCode;
  /** How much of `amount` has been sent back so far. */
  refundedAmount: MinorUnits;

  /**
   * WHAT THE PROVIDER KEPT.
   *
   * Epoint takes a service fee out of every transaction, so the money that
   * actually arrives in Qapında's account is less than the customer paid. The
   * books recorded only the gross — which meant the ledger and the provider's
   * own statement could never be reconciled, and the difference would be
   * written off every month as an unexplained shortfall.
   *
   * Recorded per payment rather than as a rate in a settings document, because
   * a rate is what a contract says and this is what the provider actually
   * charged: the two drift, and only one of them can be checked against a bank
   * statement.
   *
   * Null means the provider did not tell us, which is the honest state for
   * every payment taken before this field existed — and is deliberately not
   * zero, because "no fee" and "we do not know the fee" are different facts and
   * only one of them should ever appear in a reconciliation report.
   */
  providerFee?: MinorUnits | null;

  state: PaymentState;
  /** The provider's own status word, kept verbatim for support to read. */
  providerStatus: string | null;
  /** Why it failed, in the provider's words. Never shown raw to a customer. */
  failureReason: string | null;

  /**
   * Ties this attempt to one basket. A second `createPayment` for the same key
   * returns the first attempt instead of starting another one, so a double tap
   * cannot open two bank pages for one order.
   */
  idempotencyKey: string;

  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  /** When the provider confirmed it. Null until it does. */
  confirmedAt: TimestampLike | null;
  /** After this, the sweeper gives up on an unanswered attempt. */
  expiresAt: TimestampLike;
}

/**
 * `paymentEvents/{eventId}` — every message the provider ever sent us.
 *
 * Append-only, written before the payment is interpreted, and kept even when
 * the message is rejected as a duplicate or a forgery. When a customer says
 * they paid and the system says they did not, this is the only place the answer
 * can come from.
 */
export interface PaymentEvent {
  id: string;
  paymentId: string | null;
  orderId: string | null;
  provider: string;
  /** Whether the signature checked out. False rows are the interesting ones. */
  signatureValid: boolean;
  /** What we did with it: applied, ignored as duplicate, rejected. */
  outcome: 'applied' | 'duplicate' | 'rejected' | 'unknown-order';
  /** The provider's raw payload, as received. Never edited. */
  raw: string;
  at: TimestampLike;
}

/** Maps a payment's state onto the coarser status stored on the order. */
export function orderPaymentStatusFor(state: PaymentState): string {
  switch (state) {
    case PaymentState.PAID:
      return 'PAID';
    case PaymentState.FAILED:
      return 'FAILED';
    case PaymentState.CANCELLED:
      return 'CANCELLED';
    case PaymentState.EXPIRED:
      return 'EXPIRED';
    case PaymentState.REFUND_PENDING:
      return 'REFUND_PENDING';
    case PaymentState.REFUNDED:
      return 'REFUNDED';
    case PaymentState.PARTIALLY_REFUNDED:
      return 'PARTIALLY_REFUNDED';
    default:
      return 'PENDING';
  }
}
