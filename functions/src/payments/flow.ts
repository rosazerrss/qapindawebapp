/**
 * QAPINDA — Online payment flow.
 *
 * THE ONE RULE
 * ------------
 * An order becomes paid because the provider told *this server* so, over a
 * signed callback this server verified, for an amount this server calculated.
 * Not because the customer arrived back on a success page. That page is a URL;
 * anybody can type it, and a marketplace that trusts it will hand out free food
 * within a week of launch.
 *
 * WHAT CAN GO WRONG, AND WHERE IT IS HANDLED
 * ------------------------------------------
 *  - The customer double-taps "pay" → one payment per basket, held by an
 *    idempotency key; the second tap gets the first payment's URL back.
 *  - Epoint sends the callback twice → the second is recorded as a duplicate
 *    and changes nothing, because the state machine refuses PAID → PAID.
 *  - The callback arrives before the customer's browser does → normal; the
 *    order is already paid when they land, and the page reads the order.
 *  - The callback never arrives → `expirePendingPayments` sweeps it, and the
 *    order goes back to unpaid rather than sitting forever in limbo.
 *  - The amount does not match → refused, recorded, and an operator can see it.
 *    Never marked paid "because the provider said success".
 *
 * WHAT IS NOT HERE
 * ----------------
 * Card numbers, CVVs, expiry dates. The customer types those on Epoint's page,
 * and nothing resembling one is ever accepted, stored or logged by Qapında.
 */

import { onCall } from 'firebase-functions/v2/https';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db, now, Timestamp } from '../lib/admin';
import { logger } from 'firebase-functions/v2';

import { guard, fail } from '../lib/errors';
import { requireActiveUser, requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { notify, notifyOperators } from '../lib/notify';
import { asObject, requireString, sanitiseText, optionalInt } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { rebuildSettlement } from '../lib/settlement';
import {
  COLLECTIONS,
  onlineCollectedIdempotencyKey,
  onlineRefundIdempotencyKey,
  paths,
  periodOf,
} from '../shared/collections';
import {
  AuditAction,
  CancellationReason,
  LedgerEntryType,
  OrderActor,
  NotificationType,
  OrderStatus,
  TERMINAL_ORDER_STATUSES,
  PaymentMethod,
  PaymentStatus,
  UserRole,
} from '../shared/enums';
import { OPERATOR_ROOT, Permission } from '../shared/permissions';
import { formatMoney } from '../shared/pricing';
import {
  PaymentState,
  canMovePayment,
  orderPaymentStatusFor,
  type Payment,
} from '../shared/payments';
import type { Order } from '../shared/models';
import { releaseCouponIn, releaseCouponRefs } from '../lib/coupon';
import {
  createEpointPayment,
  decodePayload,
  epointConfig,
  readResult,
  refundEpointPayment,
  verifySignature,
} from './epoint';

const PROVIDER = 'epoint';

/**
 * The provider words that mean the money was taken, and the ones that mean it
 * was not. Lower-cased, because `readResult` normalises before it answers.
 *
 * Anything outside both lists is deliberately neither — see the note at the
 * call site. A payment provider's vocabulary grows; this system's reading of it
 * must fail towards "leave it alone and tell somebody", never towards
 * "terminal".
 */
const SUCCESS_STATUSES = ['success', 'succeeded', 'approved'];
const FAILURE_STATUSES = [
  'failed',
  'failure',
  'declined',
  'error',
  'cancelled',
  'canceled',
  'reversed',
  'expired',
];

/**
 * How long a customer has at the bank page.
 *
 * Long enough to find a card and answer a 3-D Secure SMS; short enough that an
 * abandoned attempt does not hold an order hostage all evening.
 */
const PAYMENT_TTL_MINUTES = 30;

/**
 * How long a claimed payment slot is respected before it can be taken over.
 *
 * It covers exactly one gap: the moment between claiming the slot and writing
 * the payment record, which is one HTTP call to Epoint. Ninety seconds is
 * generous for that and short enough that a request which died mid-call does
 * not leave the customer unable to pay for half an hour.
 */
const CLAIM_GRACE_MS = 90_000;

/**
 * The restaurant's window to answer, once payment clears.
 *
 * Mirrors the default `createOrder` uses. It is a constant rather than a read
 * of the settings document because this runs inside the callback transaction,
 * where an extra read is an extra way for the money to fail to land.
 */
const RESPONSE_WINDOW_MINUTES = 10;

function paymentsCollection() {
  return db.collection(COLLECTIONS.payments);
}

/**
 * Records that refunded money is no longer held on the restaurant's behalf.
 *
 * The entry is posted into the *current* period rather than the order's,
 * because that is when the money actually moved — and because the month the
 * order belongs to may already have been invoiced and paid, and a closed month
 * must not silently change.
 *
 * Idempotent by construction: the key carries the running refunded total, so a
 * retry of the same refund writes the same document while a genuine second
 * partial refund writes a new one.
 */
async function postOnlineRefundEntry(input: {
  paymentId: string;
  orderId: string;
  restaurantId: string;
  amount: number;
  refundedTotal: number;
  currency: string;
  actorId: string;
}): Promise<void> {
  const key = onlineRefundIdempotencyKey(input.paymentId, input.refundedTotal);
  const ref = db.doc(paths.ledgerEntry(key));
  if ((await ref.get()).exists) return;

  const order = (await db.doc(paths.order(input.orderId)).get()).data() as Order | undefined;

  /*
   * ONLY WHEN THE MONEY WAS BOOKED IN THE FIRST PLACE.
   *
   * This entry is POSITIVE — it reduces what the platform is holding for the
   * restaurant — and it is the opposite half of the negative `ONLINE_COLLECTED`
   * entry written when an order COMPLETES. But a refunded order is almost
   * always a CANCELLED one, and a cancelled order never completes, so the
   * negative half was never written.
   *
   * Posting the positive half alone left the restaurant owing the platform the
   * full value of an order it never cooked and was never paid for. Fifty-three
   * manats of somebody else's money, appearing as a debt on their monthly
   * statement, every time support did the right thing by a customer.
   *
   * So: if the counterpart is not on the books, there is nothing to reverse.
   * The customer still gets their money — that happens at the provider — and
   * the ledger stays a record of what actually moved between the two parties.
   */
  const collectedKey = onlineCollectedIdempotencyKey(input.orderId);
  const collected = await db.doc(paths.ledgerEntry(collectedKey)).get();
  if (!collected.exists) return;

  await ref.set({
    id: key,
    restaurantId: input.restaurantId,
    period: periodOf(new Date()),
    orderId: input.orderId,
    type: LedgerEntryType.ONLINE_COLLECTED,
    // Positive: it reduces what the platform is holding for the restaurant.
    amount: input.amount,
    currency: input.currency,
    description: `Onlayn ödənişin qaytarılması · ${order?.code ?? input.orderId}`,
    orderTotal: null,
    idempotencyKey: key,
    createdBy: input.actorId,
    createdAt: now(),
  });

  // The restaurant's screen should show the new balance the moment support
  // tells them the refund is done, not tomorrow morning after the roll-up.
  await rebuildSettlement(input.restaurantId, periodOf(new Date()));
}

/**
 * Opens a payment for an order and hands back the URL to send the customer to.
 *
 * The amount is read from the stored order, never from the request. A client
 * that sends its own total is sending a number nobody reads.
 */
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
export const startOnlinePayment = onCall(
  { minInstances: 1 },
  guard('startOnlinePayment', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const orderId = requireString(data, 'orderId', { max: 128 });

    const config = epointConfig();
    if (!config) fail(AppErrorCode.PAYMENT_NOT_CONFIGURED);

    const orderRef = db.doc(paths.order(orderId));

    /*
     * CLAIMING THE ONE ATTEMPT, ATOMICALLY.
     *
     * This check used to be a plain query: read the payments collection, see
     * no live attempt, then create one. Between that read and that write there
     * is a window, and a customer double-tapping "Kartla ödə" on a slow
     * connection lands two requests inside it. Both saw nothing, both opened
     * an Epoint session, and both could be paid — the same dinner charged
     * twice, with two captured payments the platform then has to unpick by
     * hand.
     *
     * The slot now lives on the order document and is taken inside a
     * transaction. Firestore will abort whichever request writes second, and
     * on its retry it sees the claim the winner left.
     */
    const claim = await db.runTransaction(async (tx) => {
      const orderSnapshot = await tx.get(orderRef);
      if (!orderSnapshot.exists) fail(AppErrorCode.ORDER_NOT_FOUND);

      const order = orderSnapshot.data() as Order;
      if (order.customerId !== caller.uid) fail(AppErrorCode.FORBIDDEN);
      if (order.paymentMethod !== PaymentMethod.ONLINE_CARD) fail(AppErrorCode.VALIDATION_FAILED);
      if (order.paymentStatus === PaymentStatus.PAID) fail(AppErrorCode.CONFLICT, 'already-paid');
      if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.EXPIRED) {
        fail(AppErrorCode.TRANSITION_NOT_ALLOWED);
      }

      const held = order.paymentClaim ?? null;

      if (held?.paymentId) {
        // Every read before any write — Firestore refuses the other order and
        // throws a bare INTERNAL when it happens.
        const paymentSnapshot = await tx.get(db.doc(paths.payment(held.paymentId)));
        const live = paymentSnapshot.data() as (Payment & { redirectUrl?: string }) | undefined;

        const usable =
          live &&
          (live.state === PaymentState.CREATED || live.state === PaymentState.PENDING) &&
          (live.expiresAt?.toMillis?.() ?? 0) > Date.now() &&
          Boolean(live.redirectUrl);

        // The same customer, refreshing or reopening the tab. Send them back to
        // the page they already have rather than opening a second one.
        if (usable && live) {
          return { reuse: true as const, paymentId: live.id, redirectUrl: live.redirectUrl! };
        }

        /*
         * A claim with no payment document behind it yet is the other half of
         * a double tap: the winner is at this moment waiting on Epoint and has
         * not written its record. Refusing is right — the customer sees one
         * error and one bank page, instead of two bank pages.
         *
         * The grace period is what stops a crashed attempt from locking the
         * order forever: after it, the slot is free to be taken again.
         */
        const claimedAtMs = held.claimedAt?.toMillis?.() ?? 0;
        if (!live && claimedAtMs > Date.now() - CLAIM_GRACE_MS) {
          fail(AppErrorCode.CONFLICT, 'payment-in-progress');
        }
      }

      const ref = paymentsCollection().doc();
      tx.update(orderRef, {
        paymentClaim: { paymentId: ref.id, claimedAt: now() },
        updatedAt: now(),
      });

      return {
        reuse: false as const,
        paymentId: ref.id,
        order,
      };
    });

    if (claim.reuse) {
      return { ok: true, redirectUrl: claim.redirectUrl, paymentId: claim.paymentId, reused: true };
    }

    const order = claim.order;
    const ref = db.doc(paths.payment(claim.paymentId));

    const created = await createEpointPayment(config, {
      orderCode: order.code,
      paymentId: ref.id,
      amount: order.pricing.total,
      description: `Qapinda ${order.code}`,
    });

    const payment = {
      id: ref.id,
      orderId,
      customerId: order.customerId,
      restaurantId: order.restaurantId,
      provider: PROVIDER,
      providerTransactionId: created.transactionId,
      providerBankTransactionId: null,
      // Frozen here. The callback is checked against this number, and a
      // mismatch is refused however confidently the provider reports success.
      amount: order.pricing.total,
      currency: order.pricing.currency,
      refundedAmount: 0,
      state: PaymentState.PENDING,
      providerStatus: null,
      failureReason: null,
      idempotencyKey: `${orderId}:${order.pricing.total}`,
      redirectUrl: created.redirectUrl,
      createdAt: now(),
      updatedAt: now(),
      confirmedAt: null,
      expiresAt: Timestamp.fromMillis(Date.now() + PAYMENT_TTL_MINUTES * 60_000),
    };

    await ref.set(payment);

    await db.doc(paths.order(orderId)).update({
      paymentStatus: PaymentStatus.PENDING,
      paymentId: ref.id,
      updatedAt: now(),
    });

    return { ok: true, redirectUrl: created.redirectUrl, paymentId: ref.id, reused: false };
  }),
);

/**
 * Epoint's server-to-server callback. The only thing that can mark a payment paid.
 *
 * Public by necessity — Epoint has to be able to reach it without a Firebase
 * token — which is exactly why the signature check is the first thing that
 * happens and why nothing is trusted before it passes.
 */
export const epointCallback = onRequest(
  { cors: false, region: 'europe-west1' },
  async (request, response) => {
    const config = epointConfig();

    // Always 200. A provider that gets an error retries, and a retry storm
    // against a misconfigured endpoint helps nobody; the event is recorded and
    // an operator can see it.
    const done = (outcome: string): void => {
      response.status(200).send(outcome);
    };

    if (!config) {
      console.error('epoint callback with no configuration');
      done('not-configured');
      return;
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const data = typeof body.data === 'string' ? body.data : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';

    const signatureValid = data.length > 0 && verifySignature(config.privateKey, data, signature);

    // Written before anything is interpreted, valid or not. A forged callback
    // that leaves no trace is a forged callback nobody ever notices.
    const eventRef = db.collection(COLLECTIONS.paymentEvents).doc();

    if (!signatureValid) {
      await eventRef.set({
        id: eventRef.id,
        paymentId: null,
        orderId: null,
        provider: PROVIDER,
        signatureValid: false,
        outcome: 'rejected',
        raw: data.slice(0, 4000),
        at: now(),
      });
      done('bad-signature');
      return;
    }

    const payload = decodePayload(data);
    if (!payload) {
      await eventRef.set({
        id: eventRef.id,
        paymentId: null,
        orderId: null,
        provider: PROVIDER,
        signatureValid: true,
        outcome: 'rejected',
        raw: data.slice(0, 4000),
        at: now(),
      });
      done('bad-payload');
      return;
    }

    const result = readResult(payload);
    if (!result.paymentId) {
      await eventRef.set({
        id: eventRef.id,
        paymentId: null,
        orderId: null,
        provider: PROVIDER,
        signatureValid: true,
        outcome: 'unknown-order',
        raw: data.slice(0, 4000),
        at: now(),
      });
      done('no-order');
      return;
    }

    const paymentRef = paymentsCollection().doc(result.paymentId);

    const outcome = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(paymentRef);
      if (!snapshot.exists) return { outcome: 'unknown-order' as const, orderId: null };

      const payment = snapshot.data() as Payment;
      const orderRef = db.doc(paths.order(payment.orderId));
      const orderSnapshot = await tx.get(orderRef);
      const order = orderSnapshot.data() as Order | undefined;

      /*
       * THREE ANSWERS, NOT TWO.
       *
       * `succeeded` and "everything else is a failure" was wrong in one
       * direction that costs real money: a status the provider invents, or one
       * added later — `"pending"`, `"in_progress"`, an empty body from a proxy
       * — would be read as FAILED. FAILED is terminal, so an order would be
       * killed on a payment that had not actually failed, and if the money was
       * later taken there would be no path back to it.
       *
       * So an unrecognised status leaves the payment exactly where it is and
       * raises it as a problem instead. `expirePendingPayments` still clears it
       * after thirty minutes if nothing better arrives, which is the safe
       * default: nobody is charged for an order that never left PENDING.
       */
      const succeeded = SUCCESS_STATUSES.includes(result.status);
      const failed = FAILURE_STATUSES.includes(result.status);

      if (!succeeded && !failed) {
        return { outcome: 'unknown-status' as const, orderId: payment.orderId };
      }

      const next = succeeded ? PaymentState.PAID : PaymentState.FAILED;

      /*
       * THE ORDER MAY ALREADY BE DEAD.
       *
       * The sequence that produced this: the customer is on the bank page, the
       * restaurant rejects the order, and twenty seconds later the customer
       * finishes 3-D Secure. The money is taken and the callback arrives for an
       * order that is already REJECTED or CANCELLED or EXPIRED.
       *
       * The payment must still be recorded as PAID — it is real, the bank has
       * the money, and a payment record that says otherwise makes the refund
       * impossible to reconcile later. But the order must NOT be released into
       * the kitchen, and somebody has to give the money back. So the payment
       * moves, the order is marked REFUND_PENDING, and the operators are told.
       *
       * Before this, the payment simply went PAID beside a cancelled order and
       * nothing anywhere said the customer was out of pocket.
       */
      const orderIsDead =
        order !== undefined &&
        order.status !== OrderStatus.PENDING_PAYMENT &&
        TERMINAL_ORDER_STATUSES.includes(order.status);

      // The provider answering twice is normal. The second answer must not be
      // able to walk the payment backwards, or re-credit an order.
      if (!canMovePayment(payment.state, next)) {
        return { outcome: 'duplicate' as const, orderId: payment.orderId };
      }

      // The number the server calculated is the only one that counts. A
      // provider reporting success for the wrong amount is not a success — it
      // is the single most valuable bug an attacker could find here.
      if (succeeded && result.amount !== null && result.amount !== payment.amount) {
        tx.update(paymentRef, {
          state: PaymentState.FAILED,
          providerStatus: result.status,
          failureReason: 'amount-mismatch',
          updatedAt: now(),
        });
        return { outcome: 'rejected' as const, orderId: payment.orderId };
      }

      if (succeeded && result.currency && result.currency !== payment.currency) {
        tx.update(paymentRef, {
          state: PaymentState.FAILED,
          providerStatus: result.status,
          failureReason: 'currency-mismatch',
          updatedAt: now(),
        });
        return { outcome: 'rejected' as const, orderId: payment.orderId };
      }

      tx.update(paymentRef, {
        state: next,
        providerStatus: result.status,
        providerTransactionId: result.transactionId ?? payment.providerTransactionId,
        providerBankTransactionId: result.bankTransactionId,
        /*
         * What Epoint kept.
         *
         * Recorded here, on the only message that ever carries it, because the
         * money that reaches Qapında's account is the amount minus this — and
         * without it the ledger's gross figures can never be squared with the
         * provider's statement. Only written when the provider actually
         * reported one; `?? null` on a callback that says nothing keeps "we do
         * not know" distinct from "there was no fee".
         */
        providerFee: result.fee ?? null,
        failureReason: succeeded ? null : result.message,
        confirmedAt: succeeded ? now() : null,
        updatedAt: now(),
      });

      const orderUpdate: Record<string, unknown> = {
        paymentStatus: orderPaymentStatusFor(next),
        paidAt: succeeded ? now() : null,
        updatedAt: now(),
      };

      // The moment the money is confirmed the order becomes a real order: it
      // enters the restaurant's queue and its response clock starts. This is
      // the only place that happens, which is what makes "paid" and "in the
      // kitchen" impossible to get out of step.
      const releasing = succeeded && order?.status === OrderStatus.PENDING_PAYMENT;

      if (releasing) {
        orderUpdate.status = OrderStatus.PLACED;
        orderUpdate.responseDeadlineAt = Timestamp.fromMillis(
          Date.now() + RESPONSE_WINDOW_MINUTES * 60_000,
        );

        tx.set(db.collection(paths.orderEvents(payment.orderId)).doc(), {
          id: 'paid',
          from: OrderStatus.PENDING_PAYMENT,
          to: OrderStatus.PLACED,
          actor: 'SYSTEM',
          actorId: PROVIDER,
          note: 'payment-confirmed',
          at: now(),
        });
      }

      // A failed or abandoned online payment leaves an order nobody will ever
      // cook. Closing it is kinder than leaving it in a queue it cannot leave.
      if (!succeeded && order?.status === OrderStatus.PENDING_PAYMENT) {
        orderUpdate.status = OrderStatus.PAYMENT_FAILED;
      }

      // Money taken for an order that is already dead. The status stays as it
      // is — it is the truth of what happened — but the payment side records
      // that something has to be sent back, and the alert below makes sure a
      // person sees it.
      const strandedPayment = succeeded && orderIsDead;
      if (strandedPayment) {
        orderUpdate.paymentStatus = PaymentStatus.REFUND_PENDING;
      }

      tx.update(orderRef, orderUpdate);

      return {
        outcome: 'applied' as const,
        orderId: payment.orderId,
        paid: succeeded,
        releasing,
        stranded: strandedPayment,
        restaurantId: payment.restaurantId,
      };
    });

    await eventRef.set({
      id: eventRef.id,
      paymentId: result.paymentId,
      orderId: outcome.orderId,
      provider: PROVIDER,
      signatureValid: true,
      outcome: outcome.outcome,
      raw: data.slice(0, 4000),
      at: now(),
    });

    /*
     * The money changing hands, in the audit trail.
     *
     * `paymentEvents` above is the provider's own log — every message Epoint
     * ever sent, verbatim, for reconciliation. It is not an audit row: it is
     * not attributed to an actor, it is not in the collection anybody looks in
     * when they ask "what happened to this order", and it holds the provider's
     * raw payload rather than the decision the platform took.
     *
     * A duplicate callback is not written — it changed nothing.
     */
    if (outcome.outcome === 'applied') {
      await writeAudit({
        actorId: `system:${PROVIDER}`,
        actorRole: null,
        action: AuditAction.PAYMENT_STATUS_CHANGED,
        targetType: 'payment',
        targetId: result.paymentId ?? '',
        restaurantId: 'restaurantId' in outcome ? outcome.restaurantId : null,
        oldValue: { state: PaymentState.PENDING },
        newValue: {
          state: 'paid' in outcome && outcome.paid ? PaymentState.PAID : PaymentState.FAILED,
          providerStatus: result.status,
          orderId: outcome.orderId,
        },
        // No IP: the caller is Epoint's server, and recording it would suggest
        // it identified somebody. The signature is what identified this.
        ip: null,
      }).catch(() => undefined);
    }

    /*
     * A status neither list recognises. Nothing was changed, on purpose — but
     * silence here would mean a provider that started speaking a new dialect
     * looked exactly like a quiet afternoon.
     */
    if (outcome.outcome === 'unknown-status') {
      logger.error('unknown payment status from provider', {
        paymentId: result.paymentId,
        status: result.status,
      });
    }

    if (outcome.outcome === 'applied' && outcome.orderId) {
      const orderSnapshot = await db.doc(paths.order(outcome.orderId)).get();
      const order = orderSnapshot.data() as Order | undefined;

      if (order) {
        const paid = 'paid' in outcome && outcome.paid;

        /*
         * The customer is told nothing here.
         *
         * Whether the bank took the money is the order's own status, and the
         * order screen shows it live — including the failure, with the way to
         * try again. The two notifications this used to send were part of the
         * set the owner removed.
         */

        // A payment that failed is money the customer thinks they have spent.
        // It belongs on the operator's desk as a problem, not as a cancellation
        // nobody looks into.
        if (!paid) {
          await notifyOperators({
            type: NotificationType.OPS_ORDER_PROBLEM,
            orderId: order.id,
            restaurantId: order.restaurantId,
            params: { code: order.code, source: 'PAYMENT', reason: 'PAYMENT_FAILED' },
            link: `${OPERATOR_ROOT}?order=${order.id}`,
          }).catch(() => undefined);
        }

        // Money taken for an order that had already died. Nobody finds this on
        // their own: the customer sees a cancelled order and a card charge, and
        // no screen connects the two. It has to reach a person.
        if ('stranded' in outcome && outcome.stranded) {
          await notifyOperators({
            type: NotificationType.OPS_ORDER_PROBLEM,
            orderId: order.id,
            restaurantId: order.restaurantId,
            params: { code: order.code, source: 'PAYMENT', reason: 'PAID_AFTER_CANCEL' },
            link: `${OPERATOR_ROOT}?order=${order.id}`,
          }).catch(() => undefined);
        }

        // Only now does the kitchen hear about it — an order it was never told
        // about is an order it cannot start by mistake.
        if ('releasing' in outcome && outcome.releasing) {
          const restaurant = await db.doc(paths.restaurant(order.restaurantId)).get();
          const ownerUserId = (restaurant.data() as { ownerUserId?: string } | undefined)
            ?.ownerUserId;

          if (ownerUserId) {
            await notify({
              userId: ownerUserId,
              role: UserRole.RESTAURANT_OWNER,
              restaurantId: order.restaurantId,
              orderId: order.id,
              type: NotificationType.NEW_ORDER_FOR_RESTAURANT,
              params: { code: order.code, total: order.pricing.total },
              // `/restaurant/sifaris/:id` is not a route in this app — tapping the
          // notification landed on a 404. The board is where the order is.
          link: '/panel',
            });
          }

          // The operator's desk is not told that an order was paid for. Like
          // `createOrder`, it hears about trouble and not about an evening
          // going to plan — OPS_NEW_ORDER was removed for that reason.
        }
      }
    }

    done(outcome.outcome);
  },
);

/**
 * Where the customer's own screen asks "did it work?".
 *
 * Reads the stored payment — it does not ask the provider and it does not
 * believe the browser. If the callback has not landed yet the honest answer is
 * "still waiting", and the screen says so rather than guessing.
 */
export const paymentStatus = onCall(
  guard('paymentStatus', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const paymentId = requireString(data, 'paymentId', { max: 128 });

    const snapshot = await paymentsCollection().doc(paymentId).get();
    if (!snapshot.exists) fail(AppErrorCode.PAYMENT_NOT_FOUND);

    const payment = snapshot.data() as Payment;
    if (payment.customerId !== caller.uid) fail(AppErrorCode.FORBIDDEN);

    return {
      ok: true,
      state: payment.state,
      orderId: payment.orderId,
      amount: payment.amount,
    };
  }),
);

/**
 * Sends money back, and writes down that it did.
 *
 * A refund is not "set the total to zero". The order keeps the price it was
 * sold at, and the money movement is its own record — otherwise the month's
 * takings quietly disagree with the bank's, and nobody can say why.
 */
export const refundPayment = onCall(
  guard('refundPayment', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_ADJUST_LEDGER);

    const config = epointConfig();
    if (!config) fail(AppErrorCode.PAYMENT_NOT_CONFIGURED);

    const data = asObject(request.data);
    const paymentId = requireString(data, 'paymentId', { max: 128 });
    const reason = sanitiseText(requireString(data, 'reason', { min: 10, max: 300 }));
    const requested = optionalInt(data, 'amount', { min: 1, max: 10_000_000 });

    const paymentRef = paymentsCollection().doc(paymentId);

    // Claimed before the provider is called. If the process dies mid-refund,
    // the payment is left in REFUND_PENDING — visibly unfinished — rather than
    // in PAID, where a second operator would happily refund it again.
    const claim = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(paymentRef);
      if (!snapshot.exists) fail(AppErrorCode.PAYMENT_NOT_FOUND);

      const payment = snapshot.data() as Payment;
      if (!canMovePayment(payment.state, PaymentState.REFUND_PENDING)) {
        fail(AppErrorCode.TRANSITION_NOT_ALLOWED);
      }

      const remaining = payment.amount - payment.refundedAmount;
      const amount = requested ?? remaining;
      if (amount <= 0 || amount > remaining) fail(AppErrorCode.VALIDATION_FAILED, 'amount');
      if (!payment.providerTransactionId) fail(AppErrorCode.VALIDATION_FAILED, 'transaction');

      tx.update(paymentRef, { state: PaymentState.REFUND_PENDING, updatedAt: now() });

      return {
        amount,
        remaining,
        alreadyRefunded: payment.refundedAmount,
        currency: payment.currency,
        transactionId: payment.providerTransactionId,
        orderId: payment.orderId,
        restaurantId: payment.restaurantId,
        customerId: payment.customerId,
      };
    });

    /*
     * WHAT EPOINT ACTUALLY SAID.
     *
     * This code used to store `outcome.status` in `providerStatus` and never
     * look at it. A reply of `{"status":"failed"}` is not an exception — the
     * HTTP call succeeded, it is the refund that did not — so it fell straight
     * through: the payment was written REFUNDED, the reversing ledger entry was
     * posted, and the customer was sent a notification saying their money was
     * on its way back. It was not. The books then said the platform had
     * returned money it was still holding, and the only person who could have
     * noticed was the customer waiting for a transfer that never arrived.
     *
     * A refund is now only believed when the provider says `success`, in the
     * same words `createEpointPayment` already required of it. Anything else is
     * handled exactly like a thrown error: the payment goes back to PAID so the
     * operator can retry, nothing is written to the ledger, and nobody is told
     * a refund happened.
     */
    let providerStatus: string;
    try {
      const outcome = await refundEpointPayment(config, {
        transactionId: claim.transactionId,
        amount: claim.amount,
      });
      providerStatus = outcome.status;

      if (providerStatus.toLowerCase() !== 'success') {
        throw new Error(`epoint-refund-refused-${providerStatus}${
          outcome.message ? `:${outcome.message}` : ''
        }`);
      }
    } catch (error) {
      // The claim is released so the refund can be retried, and the failure is
      // stated rather than swallowed — an operator who thinks money went back
      // when it did not will tell a customer the same thing.
      await paymentRef.update({
        state: PaymentState.PAID,
        failureReason: 'refund-failed',
        providerStatus: error instanceof Error ? error.message.slice(0, 200) : 'refund-failed',
        updatedAt: now(),
      });
      console.error('epoint refund failed', error);
      fail(AppErrorCode.INTERNAL, 'refund-failed');
    }

    const fullyRefunded = claim.amount >= claim.remaining;
    const refundedTotal = claim.alreadyRefunded + claim.amount;

    await paymentRef.update({
      state: fullyRefunded ? PaymentState.REFUNDED : PaymentState.PARTIALLY_REFUNDED,
      refundedAmount: refundedTotal,
      providerStatus,
      updatedAt: now(),
    });

    await db.doc(paths.order(claim.orderId)).update({
      paymentStatus: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
      updatedAt: now(),
    });

    // Money that has gone back to the customer is money the platform is no
    // longer holding for the restaurant. Without this the settlement would keep
    // treating a refunded order as takings owed to the restaurant, and the
    // platform would pay out for a meal nobody ended up paying for.
    //
    // Positive, because it undoes a negative ONLINE_COLLECTED entry. It is
    // posted whether or not that entry exists yet: an order refunded before it
    // settles simply nets to zero when the settling job posts the other half.
    await postOnlineRefundEntry({
      paymentId,
      orderId: claim.orderId,
      restaurantId: claim.restaurantId,
      amount: claim.amount,
      refundedTotal,
      currency: claim.currency,
      actorId: caller.uid,
    });

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.LEDGER_ADJUSTED,
      targetType: 'payment',
      targetId: paymentId,
      restaurantId: claim.restaurantId,
      reason,
      newValue: { refunded: claim.amount, full: fullyRefunded },
    });

    await notify({
      userId: claim.customerId,
      role: UserRole.CUSTOMER,
      orderId: claim.orderId,
      type: NotificationType.REFUND_ISSUED,
      // Formatted here rather than in the dictionary: notifications are stored
      // as a key plus parameters and rendered long after the fact, and the
      // translation layer has no money formatter to turn qəpik into manat.
      params: { amount: formatMoney(claim.amount) },
      link: `/orders/${claim.orderId}`,
    });

    return { ok: true, refunded: claim.amount, full: fullyRefunded };
  }),
);

/**
 * Gives up on attempts the provider never answered.
 *
 * Without this an abandoned bank page leaves the order PENDING forever: the
 * customer cannot retry, the restaurant cannot start cooking, and nobody is
 * told why. Expiring it puts the order back where a second attempt is possible.
 */
export const expirePendingPayments = onSchedule(
  { schedule: 'every 10 minutes', region: 'europe-west1', timeZone: 'Asia/Baku' },
  async () => {
    const stale = await paymentsCollection()
      .where('state', 'in', [PaymentState.CREATED, PaymentState.PENDING])
      .where('expiresAt', '<=', Timestamp.fromMillis(Date.now()))
      .limit(100)
      .get();

    for (const doc of stale.docs) {
      const payment = doc.data() as Payment;

      // Re-read inside the transaction: a callback landing in the same second
      // must win, because it is the one that carries the money.
      await db
        .runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          const current = fresh.data() as Payment;
          if (!canMovePayment(current.state, PaymentState.EXPIRED)) return;

          /*
           * THE ORDER HAS TO DIE WITH THE PAYMENT.
           *
           * This used to write `paymentStatus: EXPIRED` and stop there, leaving
           * the ORDER on PENDING_PAYMENT — a status that is neither active nor
           * finished. Nothing ever moved it again: the kitchen never saw it,
           * the customer's screen showed an order that was going nowhere, and
           * because "one live order per customer" counts anything not yet
           * terminal, that person could not place another order at all. One
           * abandoned bank page and the account was bricked.
           *
           * An order whose payment expired was never placed. EXPIRED is the
           * status the state machine already has for exactly that, and it is
           * terminal, so the queue, the customer's list and the live-order
           * check all agree from this moment on.
           */
          const orderRef = db.doc(paths.order(current.orderId));
          const orderSnapshot = await tx.get(orderRef);
          const order = orderSnapshot.data() as Order | undefined;

          /*
           * The coupon goes back with the order.
           *
           * This is the path that made an unreleased redemption expensive: an
           * order abandoned at the bank had already claimed its slot of a
           * campaign's budget, and nothing ever gave it back. Read before any
           * write, like everything else in this transaction.
           */
          const couponRefs =
            order && order.status === OrderStatus.PENDING_PAYMENT
              ? releaseCouponRefs(order)
              : null;
          const redemptionSnapshot = couponRefs ? await tx.get(couponRefs.redemption) : null;

          tx.update(doc.ref, { state: PaymentState.EXPIRED, updatedAt: now() });

          if (couponRefs && order) {
            releaseCouponIn(tx, order, redemptionSnapshot?.exists === true);
          }

          tx.update(orderRef, {
            paymentStatus: PaymentStatus.EXPIRED,
            // Only from PENDING_PAYMENT. A callback that landed a second before
            // this sweep may already have moved the order to PLACED, and an
            // order the kitchen is cooking must not be expired underneath it.
            ...(order?.status === OrderStatus.PENDING_PAYMENT
              ? {
                  status: OrderStatus.EXPIRED,
                  responseDeadlineAt: null,
                  cancellation: {
                    by: OrderActor.SYSTEM,
                    reason: CancellationReason.OTHER,
                    note: 'payment-expired',
                    at: now(),
                  },
                }
              : {}),
            updatedAt: now(),
          });

          if (order?.status === OrderStatus.PENDING_PAYMENT) {
            tx.set(db.collection(paths.orderEvents(current.orderId)).doc(), {
              from: OrderStatus.PENDING_PAYMENT,
              to: OrderStatus.EXPIRED,
              actor: OrderActor.SYSTEM,
              actorId: 'system',
              note: 'payment-expired',
              at: now(),
            });
          }
        })
        .catch((error) => console.error('expire payment failed', payment.id, error));
    }
  },
);

/**
 * Money the platform owes back and has not sent.
 *
 * A cancelled online order goes to REFUND_PENDING, the operators are told once,
 * and until now that was the end of the machinery: if that one notification was
 * missed — a shift change, a tab nobody had open, a phone on silent — the money
 * simply stayed with Qapında and nothing ever mentioned it again. A refund that
 * depends on somebody having seen a single message is not a process.
 *
 * So the debt is re-raised on a schedule for as long as it exists, and the
 * message says how old it is. Nothing here moves money: sending it is
 * `refundPayment`, which talks to the provider and writes the ledger. This only
 * makes sure a person is still being asked.
 *
 * Two thresholds, because "an hour ago" and "since Tuesday" are different
 * problems. The first is a reminder; the second is a failure of the desk, and
 * it says so.
 */
const REFUND_REMINDER_MS = 60 * 60_000;
const REFUND_OVERDUE_MS = 24 * 60 * 60_000;

export const chaseUnfinishedRefunds = onSchedule(
  { schedule: 'every 60 minutes', region: 'europe-west1', timeZone: 'Asia/Baku' },
  async () => {
    const pending = await paymentsCollection()
      .where('state', '==', PaymentState.REFUND_PENDING)
      .limit(200)
      .get();

    if (pending.empty) return;

    for (const doc of pending.docs) {
      const payment = doc.data() as Payment;

      // How long it has been owed, measured from when it was claimed. A payment
      // with no timestamp at all is treated as brand new rather than as
      // infinitely overdue: a missing field must not manufacture an alarm.
      const since = payment.updatedAt?.toMillis?.() ?? Date.now();
      const age = Date.now() - since;
      if (age < REFUND_REMINDER_MS) continue;

      const owed = Math.max(payment.amount - payment.refundedAmount, 0);
      if (owed <= 0) continue;

      const hours = Math.floor(age / 3_600_000);

      await notifyOperators({
        type: NotificationType.OPS_ORDER_PROBLEM,
        orderId: payment.orderId,
        restaurantId: payment.restaurantId,
        params: {
          code: payment.orderId,
          source: 'PAYMENT',
          reason:
            age >= REFUND_OVERDUE_MS
              ? `REFUND_OVERDUE · ${formatMoney(owed)} · ${hours}s`
              : `REFUND_DUE · ${formatMoney(owed)} · ${hours}s`,
        },
        link: `${OPERATOR_ROOT}?order=${payment.orderId}`,
      }).catch(() => undefined);

      // Logged as well as notified, so the same debt is findable from the
      // console when somebody asks "why is the bank balance higher than the
      // ledger says it should be".
      console.warn('refund still owed', {
        paymentId: payment.id,
        orderId: payment.orderId,
        owed,
        hours,
      });
    }
  },
);

/**
 * The payments an operator can look at.
 *
 * Reconciliation is the job this serves: "the bank says 240 manats today, does
 * the system agree?". So it answers with the whole picture for a window —
 * amounts, states, provider references — rather than a filtered view of the
 * happy path. A mismatch is only findable if the failures are visible too.
 */
export const listPayments = onCall(
  guard('listPayments', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_VIEW_LEDGER);

    const data = asObject(request.data);
    const from = optionalInt(data, 'from', { min: 0 }) ?? Date.now() - 7 * 24 * 60 * 60_000;
    const to = optionalInt(data, 'to', { min: 0 }) ?? Date.now();

    const snapshot = await paymentsCollection()
      .where('createdAt', '>=', Timestamp.fromMillis(from))
      .where('createdAt', '<=', Timestamp.fromMillis(to))
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    const payments = snapshot.docs.map((doc) => {
      const payment = doc.data() as Payment;
      return {
        id: payment.id,
        orderId: payment.orderId,
        restaurantId: payment.restaurantId,
        provider: payment.provider,
        providerTransactionId: payment.providerTransactionId,
        providerBankTransactionId: payment.providerBankTransactionId,
        amount: payment.amount,
        refundedAmount: payment.refundedAmount,
        // Null on everything taken before the fee was recorded, and the desk
        // needs to see that rather than a fabricated zero.
        providerFee: payment.providerFee ?? null,
        currency: payment.currency,
        state: payment.state,
        failureReason: payment.failureReason,
        createdAt: payment.createdAt,
        confirmedAt: payment.confirmedAt,
      };
    });

    // The totals a reconciliation actually starts from: what we expected to
    // collect, what the provider confirmed, and what went back out again.
    const totals = payments.reduce(
      (sum, payment) => ({
        attempted: sum.attempted + payment.amount,
        paid: sum.paid + (payment.state === PaymentState.PAID ? payment.amount : 0),
        // What the provider kept, so the desk can compare "we collected X" with
        // "the bank credited X minus fees" instead of investigating the gap
        // every month.
        providerFees: sum.providerFees + (payment.providerFee ?? 0),
        refunded: sum.refunded + payment.refundedAmount,
        failed:
          sum.failed +
          (payment.state === PaymentState.FAILED || payment.state === PaymentState.EXPIRED
            ? payment.amount
            : 0),
      }),
      { attempted: 0, paid: 0, providerFees: 0, refunded: 0, failed: 0 },
    );

    return { ok: true, payments, totals };
  }),
);
