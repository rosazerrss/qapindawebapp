/**
 * QAPINDA — What an operator does about an order that already happened.
 *
 * THE DECISION THIS FILE ENCODES
 * ------------------------------
 * A delivered order is terminal and stays terminal. An operator cannot cancel
 * it, un-deliver it or move it backwards, and no amount of "the customer is
 * angry" changes that: the food was cooked, driven and handed over, a cash
 * payment really did change hands at the door, and a platform that rewrites
 * those facts can never afterwards say what happened. Compensation is a new
 * fact written next to the old one, never an old one erased.
 *
 * So resolving a complaint is now three separate answers, not one:
 *
 *   1. IS IT UPHELD?  A judgement about the complaint. Recorded either way.
 *   2. WHAT DOES THE CUSTOMER GET?  Money back if the platform is holding it,
 *      a coupon if it never did, nothing if nothing is owed.
 *   3. DOES THE RESTAURANT STILL PAY COMMISSION?  Separate from (1), and the
 *      answer is normally yes.
 *
 * WHY (3) CHANGED
 * ---------------
 * Upholding a complaint used to hand the restaurant its commission back
 * automatically. Read plainly, that meant a kitchen that sent out the wrong
 * food was billed less for it, and the cost of its mistake fell on the
 * platform — which is exactly backwards, and gives a restaurant with sloppy
 * standards no reason to raise them. Commission is now kept by default and
 * waived only when the operator explicitly says so, for the case it is
 * actually for: the failure was not the restaurant's.
 *
 * WHY THE REFUND IS NOT DONE HERE
 * -------------------------------
 * Sending money back is an HTTP call to Epoint, and an HTTP call has no
 * business inside a Firestore transaction. `refundPayment` is the one place
 * money leaves, it writes its own ledger entry and its own audit row, and this
 * function's job is to record the decision and hand the operator straight to
 * it. What is written here is the promise; that function is the payment.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, now, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { notify } from '../lib/notify';
import { asObject, optionalInt, requireEnum, requireString, sanitiseText } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { COLLECTIONS, normaliseCouponCode, paths, periodOf } from '../shared/collections';
import {
  AuditAction,
  ComplaintStatus,
  CouponType,
  LedgerEntryType,
  NotificationType,
  PaymentMethod,
  UserRole,
} from '../shared/enums';
import { Permission } from '../shared/permissions';
import { formatMoney } from '../shared/pricing';
import { isCapturedPayment, type Payment } from '../shared/payments';
import {
  COMPENSATION_COUPON_DAYS,
  CompensationKind,
  checkCompensation,
  compensationCouponCode,
  compensationFunding,
  mayWaiveCommission,
} from '../shared/compensation';
import type { Complaint, Order } from '../shared/models';

const KINDS = Object.values(CompensationKind);

/** Maps a rejection from the shared rules onto something the panel can show. */
const COMPENSATION_ERROR: Record<string, AppErrorCode> = {
  'kind-not-available': AppErrorCode.VALIDATION_FAILED,
  'refund-required': AppErrorCode.VALIDATION_FAILED,
  'amount-required': AppErrorCode.VALIDATION_FAILED,
  'amount-over-cap': AppErrorCode.FORBIDDEN,
  'amount-over-order': AppErrorCode.VALIDATION_FAILED,
  'amount-over-captured': AppErrorCode.VALIDATION_FAILED,
};

export const resolveComplaint = onCall(
  guard('resolveComplaint', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_RESOLVE_COMPLAINTS);

    const data = asObject(request.data);
    const orderId = requireString(data, 'orderId', { max: 128 });
    const upheld = data.upheld === true;
    const resolution = sanitiseText(requireString(data, 'resolution', { min: 10, max: 500 }));

    const kind = requireEnum<CompensationKind>(data, 'compensation', KINDS);
    const amount = optionalInt(data, 'amount', { min: 0, max: 10_000_000 }) ?? 0;

    /*
     * Commission is kept unless somebody deliberately says otherwise, and the
     * flag is read on its own rather than inferred from `upheld`. Those are two
     * different questions — "was the customer right?" and "should the
     * restaurant still be billed?" — and collapsing them is what produced the
     * old behaviour where being right about the food meant the restaurant paid
     * less for having got it wrong.
     */
    const waiveCommission = data.waiveCommission === true;

    /*
     * Waiving is an admin's lever, not an operator's — see the reasoning on
     * `mayWaiveCommission`. Checked here, before anything is read, so the
     * refusal is cheap and unambiguous rather than a silently ignored flag.
     */
    if (waiveCommission && !mayWaiveCommission(caller.role)) {
      fail(AppErrorCode.FORBIDDEN, 'waive-commission');
    }

    const complaintRef = db.doc(paths.complaint(orderId));
    const orderRef = db.doc(paths.order(orderId));

    // Read before the transaction, because what may be given depends on what
    // the provider actually captured — and the payment record is the only
    // honest answer to that.
    const [complaintPeek, orderPeek] = await Promise.all([complaintRef.get(), orderRef.get()]);
    if (!complaintPeek.exists) fail(AppErrorCode.COMPLAINT_NOT_FOUND);
    if (!orderPeek.exists) fail(AppErrorCode.ORDER_NOT_FOUND);

    const complaintPeeked = complaintPeek.data() as Complaint;
    const order = orderPeek.data() as Order;

    const paymentSnapshot =
      order.paymentMethod === PaymentMethod.ONLINE_CARD && order.paymentId
        ? await db.doc(paths.payment(order.paymentId)).get()
        : null;
    const payment = paymentSnapshot?.data() as Payment | undefined;

    // What is genuinely still refundable: captured, minus whatever has already
    // gone back. A partially refunded order must not be refunded twice.
    const refundableAmount =
      payment && isCapturedPayment(payment.state)
        ? Math.max(payment.amount - payment.refundedAmount, 0)
        : 0;

    const check = checkCompensation({
      kind,
      amount,
      reason: complaintPeeked.reason,
      role: user.role,
      paymentMethod: order.paymentMethod,
      refundableAmount,
      orderTotal: order.pricing.total,
    });

    if (!check.allowed) {
      fail(COMPENSATION_ERROR[check.reason!] ?? AppErrorCode.VALIDATION_FAILED, check.reason);
    }

    /*
     * The coupon is written before the transaction, and outside it.
     *
     * Its code is derived from the order code, so writing it twice writes the
     * same document rather than a second coupon — which is what makes a retried
     * request safe. If the transaction below then fails, what is left behind is
     * a coupon nobody was told about: harmless, and visible in the audit. The
     * other order — transaction first, coupon after — can leave a complaint
     * marked "compensated" with no coupon behind it, and that is a promise to a
     * customer that the platform silently did not keep.
     */
    let couponCode: string | null = null;

    if (kind === CompensationKind.COUPON) {
      couponCode = normaliseCouponCode(compensationCouponCode(complaintPeeked.orderCode));
      const fundedBy = compensationFunding(complaintPeeked.reason);

      await db.doc(paths.coupon(couponCode)).set(
        {
          code: couponCode,
          type: CouponType.FIXED,
          value: amount,
          fundedBy,
          // FIXED funding is one side or the other, never a share, so the
          // basis-point split is not consulted — but it is stored on every
          // coupon so nothing downstream has to branch before reading it.
          platformShareBps: 0,
          // Tied to the restaurant whose order went wrong when they are paying
          // for it. A restaurant-funded apology spendable at a competitor would
          // be one restaurant buying another's customer a dinner.
          restaurantIds: fundedBy === 'RESTAURANT' ? [complaintPeeked.restaurantId] : [],
          // The whole point: this belongs to one person.
          allowedUserIds: [complaintPeeked.customerId],
          minSubtotal: 0,
          maxDiscount: null,
          firstOrderOnly: false,
          usageLimitTotal: 1,
          usageLimitPerCustomer: 1,
          usedCount: 0,
          active: true,
          validFrom: now(),
          validUntil: Timestamp.fromMillis(
            Date.now() + COMPENSATION_COUPON_DAYS * 24 * 60 * 60_000,
          ),
          createdBy: caller.uid,
          createdAt: now(),
        },
        // Merged rather than replaced: a retry must not reset `usedCount` on a
        // coupon the customer has already spent.
        { merge: true },
      );
    }

    const outcome = await db.runTransaction(async (transaction) => {
      const [complaintSnapshot, orderSnapshot] = await Promise.all([
        transaction.get(complaintRef),
        transaction.get(orderRef),
      ]);

      if (!complaintSnapshot.exists) fail(AppErrorCode.COMPLAINT_NOT_FOUND);
      const complaint = complaintSnapshot.data() as Complaint;
      if (complaint.status !== ComplaintStatus.OPEN) fail(AppErrorCode.COMPLAINT_ALREADY_RESOLVED);

      const current = orderSnapshot.data() as Order;
      let credited = 0;

      if (waiveCommission) {
        const commission = current.commissionAmount;

        if (commission === null) {
          // Not settled yet. Marking the order excludes it from the settlement
          // job, so no charge is ever raised — the cheapest possible refund.
          transaction.update(orderRef, { commissionWaived: true, updatedAt: now() });
        } else if (commission > 0) {
          // Already charged. A reversing entry, never an edit of the original:
          // a ledger that can be rewritten is not a ledger.
          const entryRef = db.collection(COLLECTIONS.ledgerEntries).doc();

          transaction.set(entryRef, {
            id: entryRef.id,
            restaurantId: complaint.restaurantId,
            orderId,
            period: periodOf(new Date()),
            type: LedgerEntryType.ADJUSTMENT,
            amount: -commission,
            currency: current.pricing.currency,
            description: `Şikayət ${complaint.orderCode} — komissiya geri qaytarıldı`,
            orderTotal: null,
            idempotencyKey: `complaint-commission:${orderId}`,
            createdBy: caller.uid,
            createdAt: now(),
          });

          credited = commission;
        }
      }

      transaction.update(complaintRef, {
        status: upheld ? ComplaintStatus.RESOLVED_CREDITED : ComplaintStatus.REJECTED,
        resolution,
        resolvedBy: caller.uid,
        resolvedAt: now(),
        creditedAmount: credited,
        // The whole answer, kept on the complaint so that "what was actually
        // done about this?" is one read rather than a hunt through the ledger,
        // the coupons and the payments.
        compensation: {
          kind,
          amount: kind === CompensationKind.NONE ? 0 : amount,
          couponCode,
          commissionWaived: waiveCommission,
          by: caller.uid,
          at: now(),
        },
      });

      return { complaint, credited };
    });

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.COMPLAINT_RESOLVED,
      targetType: 'complaint',
      targetId: orderId,
      newValue: { upheld, commissionWaived: waiveCommission, credited: outcome.credited },
      reason: resolution,
      restaurantId: outcome.complaint.restaurantId,
    });

    // A second row, deliberately, whenever value actually moved. "An operator
    // resolved a complaint" and "an operator gave away 8 ₼ of a restaurant's
    // money" are different things to be able to search for.
    if (kind !== CompensationKind.NONE) {
      await writeAudit({
        actorId: caller.uid,
        actorRole: user.role,
        action: AuditAction.COMPENSATION_GRANTED,
        targetType: 'complaint',
        targetId: orderId,
        newValue: {
          kind,
          amount,
          couponCode,
          fundedBy: compensationFunding(outcome.complaint.reason),
          customerId: outcome.complaint.customerId,
        },
        reason: resolution,
        restaurantId: outcome.complaint.restaurantId,
      });
    }

    await notify({
      userId: outcome.complaint.customerId,
      role: UserRole.CUSTOMER,
      orderId,
      type: NotificationType.COMPLAINT_RESOLVED,
      params: { code: outcome.complaint.orderCode },
      link: `/orders/${orderId}`,
    });

    // Told separately, and told plainly. A coupon the customer never hears
    // about is the restaurant's money spent on nothing.
    if (kind === CompensationKind.COUPON && couponCode) {
      await notify({
        userId: outcome.complaint.customerId,
        role: UserRole.CUSTOMER,
        orderId,
        type: NotificationType.COMPENSATION_COUPON,
        params: { amount: formatMoney(amount), code: couponCode },
        link: '/account/coupons',
      });
    }

    return {
      ok: true,
      credited: outcome.credited,
      couponCode,
      /*
       * The refund itself has NOT happened.
       *
       * This is the flag the panel reads to send the operator straight on to
       * `refundPayment`, which is the one place money actually leaves. Saying
       * "refunded" here would be the same lie the payment code used to tell.
       */
      refundPending: kind === CompensationKind.REFUND,
      refundAmount: kind === CompensationKind.REFUND ? amount : 0,
      paymentId: order.paymentId ?? null,
    };
  }),
);
