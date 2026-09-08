/**
 * QAPINDA — Putting right an order that already happened.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * WHY THIS IS NOT "CANCEL"
 * ------------------------
 * A delivered order is terminal, and the state machine keeps it that way on
 * purpose. "Cancel" means *this will not happen*; a delivered order already
 * did — the food was cooked, driven and handed over. Undoing it after the fact
 * would erase a cash payment the courier really took, erase work the restaurant
 * really did, and leave the platform unable to answer "what happened here?" the
 * next time the same customer and the same restaurant disagree.
 *
 * So an operator never reverses a delivery. What they do instead is compensate,
 * which is a *new* fact added to the record rather than an old one rewritten.
 *
 * THE THREE INSTRUMENTS, AND WHY THE MONEY DECIDES WHICH
 * ------------------------------------------------------
 * Only one question matters: is the platform holding this customer's money?
 *
 *  - PAID ONLINE — yes. The money is in Qapında's account, and a refund is
 *    possible, cheap and honest.
 *  - CASH OR CARD AT THE DOOR — no. It went from the customer's hand to the
 *    courier's and the platform never touched it. There is literally nothing to
 *    give back, so the only thing the platform can offer is value in future: a
 *    coupon.
 *
 * That is why a coupon is not a lesser refund; for half of all orders it is the
 * only instrument that exists.
 *
 * THE ONE HARD RULE
 * -----------------
 * When the food never arrived and the platform is holding the money, the
 * customer gets money back — not a coupon. Handing somebody a discount on a
 * future dinner while keeping what they paid for a dinner they never received
 * is keeping their money, whatever it is called on screen. `mandatoryRefund`
 * says so and the server enforces it.
 *
 * WHO PAYS
 * --------
 * Every reason a customer may file is about the food or its delivery, and both
 * belong to the restaurant — Qapında runs no fleet, so even "it came very late"
 * is the restaurant's courier. A compensation for those is therefore funded by
 * the restaurant: if the platform absorbed the cost of a kitchen's mistakes,
 * the kitchen would have no reason to stop making them. `OTHER` is the one
 * reason that names no cause, so it falls to the platform rather than blaming a
 * restaurant for something nobody has established.
 */

import { ComplaintReason, CouponFunding, PaymentMethod, UserRole } from './enums';
import type { MinorUnits } from './models';

/** What the customer is given. */
export const CompensationKind = {
  /** The complaint is answered, and nothing is owed. */
  NONE: 'NONE',
  /** Money back to the card it came from. Online orders only. */
  REFUND: 'REFUND',
  /** A personal coupon. The only instrument for money paid at the door. */
  COUPON: 'COUPON',
} as const;
export type CompensationKind = (typeof CompensationKind)[keyof typeof CompensationKind];

/**
 * The most one operator may hand out on one complaint, in qəpik.
 *
 * Ten manat covers the overwhelming majority of what actually goes wrong — a
 * missing side, a cold starter, a late delivery — and stops one support account
 * from being an unbounded liability. Above it, the decision is the admin's, who
 * has no ceiling because somebody has to be able to settle the genuinely bad
 * cases.
 */
export const OPERATOR_COMPENSATION_CAP: MinorUnits = 1000;

/**
 * May this role write off the platform's commission on an order?
 *
 * SEPARATE FROM THE COMPENSATION CAP, AND THAT IS THE POINT.
 *
 * The cap above bounds what an operator may GIVE a customer — ten manat, on a
 * complaint, with a reason. Waiving the commission is a different lever with no
 * ceiling at all: it is the platform's own revenue on that order, and it sat in
 * the same request body as the capped one, reachable by the same role.
 *
 * On a busy restaurant that is a larger number than the compensation ever gets
 * near, and unlike a coupon it leaves nothing for the customer — it is a
 * transfer from Qapında to the restaurant, decided by support.
 *
 * So it is an admin's decision. An operator who believes a restaurant should
 * not be billed says so on the complaint; somebody who can see the ledger
 * decides.
 */
export function mayWaiveCommission(role: UserRole): boolean {
  return role === UserRole.SUPER_ADMIN;
}

/** `null` means no ceiling. */
export function compensationCap(role: UserRole): MinorUnits | null {
  if (role === UserRole.SUPER_ADMIN) return null;
  if (role === UserRole.OPERATOR) return OPERATOR_COMPENSATION_CAP;
  // Anybody else has no business compensating at all; the callable refuses
  // them first, and a zero here means a bug cannot leak value either.
  return 0;
}

/** Is the platform holding this order's money right now? */
export function platformHoldsMoney(
  paymentMethod: PaymentMethod,
  capturedAmount: MinorUnits,
): boolean {
  return paymentMethod === PaymentMethod.ONLINE_CARD && capturedAmount > 0;
}

/**
 * Money back is compulsory here — a coupon would be keeping what they paid.
 *
 * Only one case: the food never came and the platform has the money. Everything
 * else is a judgement call the operator is allowed to make.
 */
export function mandatoryRefund(
  reason: ComplaintReason,
  paymentMethod: PaymentMethod,
  capturedAmount: MinorUnits,
): boolean {
  return (
    reason === ComplaintReason.NEVER_ARRIVED &&
    platformHoldsMoney(paymentMethod, capturedAmount)
  );
}

/** Which instruments this order can actually offer. */
export function allowedKinds(
  paymentMethod: PaymentMethod,
  capturedAmount: MinorUnits,
): CompensationKind[] {
  return platformHoldsMoney(paymentMethod, capturedAmount)
    ? [CompensationKind.NONE, CompensationKind.REFUND, CompensationKind.COUPON]
    : // No money was ever taken by the platform, so REFUND is not a choice that
      // was declined — it is a thing that does not exist for this order.
      [CompensationKind.NONE, CompensationKind.COUPON];
}

/**
 * Who pays for a compensation coupon, decided by the complaint's reason.
 *
 * Not an operator's choice, deliberately. Letting the person handing out the
 * money also decide whose money it is turns a rule into a negotiation, and the
 * restaurant is not in the room for it.
 */
export function compensationFunding(reason: ComplaintReason): CouponFunding {
  return reason === ComplaintReason.OTHER ? CouponFunding.PLATFORM : CouponFunding.RESTAURANT;
}

export type CompensationRejection =
  | 'kind-not-available'
  | 'refund-required'
  | 'amount-required'
  | 'amount-over-cap'
  | 'amount-over-order'
  | 'amount-over-captured';

export interface CompensationCheck {
  allowed: boolean;
  reason?: CompensationRejection;
}

/**
 * The one authority on whether this compensation may be given.
 *
 * Called by the panel to disable a button and by the callable to refuse a
 * request, so the screen and the server can never disagree about what an
 * operator is allowed to do.
 */
export function checkCompensation(input: {
  kind: CompensationKind;
  amount: MinorUnits;
  reason: ComplaintReason;
  role: UserRole;
  paymentMethod: PaymentMethod;
  /** What the provider actually captured, minus anything already refunded. */
  refundableAmount: MinorUnits;
  /** The order's total, which no compensation may exceed. */
  orderTotal: MinorUnits;
}): CompensationCheck {
  const { kind, amount, reason, role, paymentMethod, refundableAmount, orderTotal } = input;

  if (!allowedKinds(paymentMethod, refundableAmount).includes(kind)) {
    return { allowed: false, reason: 'kind-not-available' };
  }

  if (mandatoryRefund(reason, paymentMethod, refundableAmount) && kind !== CompensationKind.REFUND) {
    return { allowed: false, reason: 'refund-required' };
  }

  if (kind === CompensationKind.NONE) return { allowed: true };

  if (!Number.isInteger(amount) || amount <= 0) {
    return { allowed: false, reason: 'amount-required' };
  }

  // Never more than the order was worth. Compensation makes somebody whole; it
  // is not a prize for having had a bad evening.
  if (amount > orderTotal) return { allowed: false, reason: 'amount-over-order' };

  if (kind === CompensationKind.REFUND && amount > refundableAmount) {
    return { allowed: false, reason: 'amount-over-captured' };
  }

  const cap = compensationCap(role);
  if (cap !== null && amount > cap) return { allowed: false, reason: 'amount-over-cap' };

  return { allowed: true };
}

/**
 * How long a compensation coupon stays usable.
 *
 * Thirty days. Long enough to be a real apology rather than a token that
 * expires before the person next orders, short enough that the restaurant's
 * liability for one bad evening does not sit open on the books for a year.
 */
export const COMPENSATION_COUPON_DAYS = 30;

/**
 * The code a compensation coupon carries, derived from the order.
 *
 * Derived rather than random so that granting the same compensation twice — a
 * retried request, a double-clicked button — writes the same document instead
 * of a second coupon. `ÜZR` is what it is: an apology.
 */
export function compensationCouponCode(orderCode: string): string {
  return `UZR${orderCode.replace(/[^A-Z0-9]/gi, '').toUpperCase()}`;
}
