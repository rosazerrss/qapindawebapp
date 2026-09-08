'use client';

/**
 * One order, live.
 *
 * A Firestore listener rather than polling: when the kitchen presses "accept",
 * this screen changes within the second, and the customer stops wondering.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { LifeBuoy, Phone } from 'lucide-react';

import { watchPublicSettings } from '@/services/settings';
import { AppShell } from '@/components/layout/AppShell';
import { CancellationNote } from '@/components/panel/CancellationNote';
import { whenTime } from '@/components/panel/status';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { OrderStatusBar } from '@/components/customer/OrderStatusBar';
import { ComplaintForm } from '@/components/customer/ComplaintForm';
import { ReviewForm } from '@/components/customer/ReviewForm';
import { ReorderButton } from '@/components/customer/ReorderButton';
import { DeliveryCode } from '@/components/customer/DeliveryCode';
import { Alert, Button, Card, EmptyState, Money, Select, Sheet } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { useT, translateError } from '@/i18n';
import { updateOrderStatus } from '@/firebase/callables';
import { watchOrder, watchRestaurant } from '@/services/catalog';
import { customerCancelWindow } from '@/shared/orderState';
import { deliveryCodeRequired } from '@/shared/deliveryCode';
import { CancellationReason, OrderStatus, PaymentMethod, PaymentStatus } from '@/shared/enums';
import type { PublicSettings, Order, Restaurant } from '@/shared/models';
import { PayAgain } from '@/components/customer/PayAgain';

const CUSTOMER_REASONS = [
  CancellationReason.CUSTOMER_CHANGED_MIND,
  CancellationReason.DUPLICATE_ORDER,
  CancellationReason.OTHER,
];

export default function OrderPage({ params }: PageProps<'/orders/[orderId]'>) {
  const { orderId } = use(params);
  const t = useT();

  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  /*
   * The platform's settings, for one number: how long the cancel window is.
   *
   * A live subscription rather than a one-off read, because the document is
   * one row and the alternative — a stale copy in a screen somebody left open
   * — is a countdown that disagrees with the server that will judge it.
   */
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState<string>(CancellationReason.CUSTOMER_CHANGED_MIND);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [complaining, setComplaining] = useState(false);
  // Same reasoning as `justReviewed`: the listener will confirm `complaintAt`
  // shortly, but the sheet must not be re-openable in the meantime.
  const [justComplained, setJustComplained] = useState(false);
  // The listener will bring `reviewedAt` back from the server a moment later,
  // but the thank-you should replace the form the instant the review lands.
  const [justReviewed, setJustReviewed] = useState(false);

  /*
   * The clock the cancel button counts down.
   *
   * A tick per second while — and only while — the window can still be open.
   * It is the BROWSER's clock and it decides nothing: the server re-measures
   * against its own before it cancels anything, and a request that arrives
   * late is refused with `CANCEL_WINDOW_CLOSED` however much time this counter
   * thought was left. What it is for is telling the customer how long they
   * have, which is the difference between a button that vanishes and a button
   * that visibly runs out.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  const counting =
    order?.status === OrderStatus.PLACED || order?.status === OrderStatus.PENDING_PAYMENT;

  useEffect(() => watchPublicSettings(setSettings), []);

  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  useEffect(() => watchOrder(orderId, (next) => setOrder(next)), [orderId]);

  // Only used to read `requireDeliveryCode` — a public field on an ACTIVE
  // restaurant, so this is safe for the customer to read directly. Resolved
  // against the platform setting below by `deliveryCodeRequired`.
  const restaurantId = order?.restaurantId ?? null;
  useEffect(() => {
    if (!restaurantId) return;
    return watchRestaurant(restaurantId, setRestaurant);
  }, [restaurantId]);

  if (order === undefined) {
    return (
      <AppShell>
        <ScreenHeader fallbackHref="/orders" />
        <PageLoading />
      </AppShell>
    );
  }

  if (order === null) {
    return (
      <AppShell>
        <ScreenHeader fallbackHref="/orders" />
        <EmptyState
          title={t('errors.ORDER_NOT_FOUND')}
          action={
            <Link href="/orders" className="text-sm font-medium text-brand-600 underline">
              {t('order.myOrders')}
            </Link>
          }
        />
      </AppShell>
    );
  }

  /*
   * May this customer still cancel, and for how much longer?
   *
   * `customerCancelWindow` is the same shared function `updateOrderStatus`
   * calls before it cancels anything, so the button and the server can never
   * disagree about the rule — only about the clock, and the server's is the
   * one that counts.
   */
  const cancelWindow = customerCancelWindow(
    order.status,
    order.placedAt?.toMillis?.() ?? null,
    nowMs,
    // The platform's own window, which an admin can change. Until the settings
    // document arrives this is undefined and the shared default answers — the
    // countdown is briefly the old three minutes rather than briefly absent,
    // and the server re-measures against its own value regardless.
    settings?.customerCancelWindowMinutes,
  );
  const canCancel = cancelWindow.open;
  const cancelCountdown = cancelWindow.open ? formatRemaining(cancelWindow.msRemaining) : null;

  const reviewed = justReviewed || order.reviewedAt !== null;
  // Only a meal that actually arrived may be reviewed. The server refuses
  // anything else, so offering the button earlier would only promise something
  // the customer cannot have.
  const delivered =
    order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLETED;
  const canReview = delivered && !reviewed;

  const complained = justComplained || order.complaintAt !== null;

  const cancel = async () => {
    setBusy(true);
    setError(null);

    const result = await updateOrderStatus({
      orderId: order.id,
      status: OrderStatus.CANCELLED,
      reason,
      note: note.trim() || t(`order.reason.${reason}`),
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }
    setCancelling(false);
  };

  return (
    <AppShell>
      {/* Somebody who opened this from a push notification has no history to
          go back through; `ScreenHeader` falls back to the list itself, so
          the list is one tap away regardless. */}
      <ScreenHeader
        title={t('order.title', { code: order.code })}
        fallbackHref="/orders"
        className="mb-1"
      />
      <p className="mb-5 pl-1 text-ink-500">{order.restaurantName}</p>

      <Card className="p-4">
        <OrderStatusBar status={order.status} />

        {/*
          * WHEN IT WILL BE HERE.
          *
          * `estimatedDeliveryAt` has been written onto every order since the
          * platform launched and read by nothing — the customer's single most
          * asked question had an answer sitting in the database that no screen
          * ever showed. It appears from the moment the kitchen accepts, which
          * is when the number stops being a guess copied off the restaurant's
          * profile and becomes something the kitchen said.
          *
          * Not shown once the food has arrived: an estimate on a delivered
          * order is at best noise and at worst an argument.
          */}
        {order.estimatedDeliveryAt && !delivered && (
          <p className="mt-3 border-t border-card-edge pt-3 text-[15px] text-ink-700">
            {t('order.estimatedArrival')}{' '}
            <span className="font-semibold tabular-nums text-ink-900">
              {whenTime(order.estimatedDeliveryAt)}
            </span>
          </p>
        )}
      </Card>

      {/* Right under the status bar, because "where is my food" is the question
          this screen exists to answer and the phone is the answer to it.
          Older orders carry no snapshotted number, so the button hides. */}
      {/* An online order the bank never confirmed. Until it is paid it is
          invisible to the restaurant, so this is the only place the customer
          can learn that and do something about it. */}
      {order.paymentMethod === PaymentMethod.ONLINE_CARD &&
        (order.status === OrderStatus.PENDING_PAYMENT ||
          order.status === OrderStatus.PAYMENT_FAILED) && <PayAgain orderId={order.id} />}

      {/*
        The code, only when this delivery actually closes with one.
        
        Read through `deliveryCodeRequired`, which is the same function the
        courier's screen and `courierConfirmDelivery` read. The alternative —
        checking `restaurant.requireDeliveryCode` here and something else on
        the server — is how a driver ends up at a door asking for six digits
        this screen never offered.
      */}
      {order.status === OrderStatus.OUT_FOR_DELIVERY &&
        deliveryCodeRequired({ settings, restaurant }) && <DeliveryCode orderId={order.id} />}

      {/* The restaurant's own line, as a real call button.

          `restaurantPhone` is snapshotted onto the order when it is placed, so
          the number that rings is the one that took the order even if the shop
          changes it later — and orders placed before the field existed carry
          nothing, which is why this is behind a check rather than assumed.

          The number itself is NOT printed on the button. A button says what
          pressing it does; the digits are what happens afterwards, and putting
          them here made a wide button of a phone number nobody is going to
          read off a screen and dial by hand. It is still in the `tel:` href,
          where the dialler wants it, and in the label a screen reader
          announces. */}
      {order.restaurantPhone && (
        <a
          href={`tel:${order.restaurantPhone}`}
          aria-label={t('order.callNamed', { name: order.restaurantName })}
          className="mt-3 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-medium text-white transition hover:bg-brand-700"
        >
          <Phone size={19} aria-hidden />
          {t('order.callRestaurant')}
        </a>
      )}

      {/* Money the platform is holding for an order that no longer exists.
          The cancellation marked the payment REFUND_PENDING and told the
          operators; this is the customer's half of that sentence, so nobody is
          left wondering where their money went. */}
      {order.paymentStatus === PaymentStatus.REFUND_PENDING && (
        <div className="mt-3">
          <Alert tone="info">{t('order.refundPending')}</Alert>
        </div>
      )}

      {order.cancellation && (
        <div className="mt-3">
          {/*
            The shared block, not a hand-rolled Alert.
            
            This screen used to print the reason and the note and stop, so the
            customer could read "Digər — stok bitdi" without ever learning
            whether the restaurant, Qapında or they themselves had ended the
            order — which is the first thing anybody asks. `CancellationNote`
            answers all four questions and is the same component the restaurant,
            the courier, the operator and the admin read, so no two of them can
            describe one cancellation differently.
          */}
          <CancellationNote cancellation={order.cancellation} />
        </div>
      )}

      {/* Items --------------------------------------------------------- */}
      <Card className="mt-4 p-4">
        <h2 className="mb-3 font-medium text-ink-900">{t('order.items')}</h2>

        <ul className="space-y-3">
          {order.items.map((item, index) => (
            <li key={`${item.productId}-${index}`} className="flex justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] text-ink-900">
                  <span className="text-ink-400">{item.quantity}×</span> {item.name}
                </p>
                {item.modifiers.length > 0 && (
                  <p className="text-sm text-ink-500">
                    {item.modifiers.map((modifier) => modifier.optionName).join(' · ')}
                  </p>
                )}
                {item.note && <p className="text-sm italic text-ink-400">{item.note}</p>}
              </div>
              <span className="shrink-0 text-[15px] text-ink-700">
                <Money amount={item.lineTotal} />
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-2 border-t border-card-edge pt-3 text-[15px]">
          <div className="flex justify-between">
            <dt className="text-ink-500">{t('cart.subtotal')}</dt>
            <dd>
              <Money amount={order.pricing.subtotal} />
            </dd>
          </div>
          {order.pricing.discount > 0 && (
            <div className="flex justify-between text-success">
              <dt>
                {t('cart.discount')}
                {order.coupon && ` (${order.coupon.code})`}
              </dt>
              <dd>
                −<Money amount={order.pricing.discount} />
              </dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-500">{t('cart.deliveryFee')}</dt>
            <dd>
              <Money amount={order.pricing.deliveryFee} />
            </dd>
          </div>
          <div className="flex justify-between border-t border-card-edge pt-2 font-semibold">
            <dt>{t('order.total')}</dt>
            <dd>
              <Money amount={order.pricing.total} />
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-sm text-ink-400">{t(`checkout.${order.paymentMethod}`)}</p>
      </Card>

      {/* Address ------------------------------------------------------- */}
      {order.address && (
        <Card className="mt-4 p-4">
          <h2 className="mb-1.5 font-medium text-ink-900">{t('checkout.address')}</h2>
          <p className="text-[15px] text-ink-700">{order.address.line}</p>
          {order.address.note && <p className="text-sm text-ink-400">{order.address.note}</p>}
        </Card>
      )}

      {order.customerNote && (
        <Card className="mt-4 p-4">
          <h2 className="mb-1.5 font-medium text-ink-900">{t('checkout.note')}</h2>
          <p className="text-[15px] italic text-ink-600">{order.customerNote}</p>
        </Card>
      )}

      {/* Order again ---------------------------------------------------
          On a finished order only: a customer whose food is still on its way
          wants to know where it is, not to buy it twice. */}
      {delivered && (
        <div className="mt-4">
          <ReorderButton orderId={order.id} />
        </div>
      )}

      {/* Review -------------------------------------------------------- */}
      {canReview && (
        <Card className="mt-4 border-brand-100 bg-brand-50 p-4">
          <h2 className="font-medium text-ink-900">{t('review.rate')}</h2>
          <p className="mt-1 text-sm text-ink-600">{t('review.detailHint')}</p>
          <div className="mt-3">
            <Button fullWidth onClick={() => setReviewing(true)}>
              {t('review.rate')}
            </Button>
          </div>
        </Card>
      )}

      {delivered && reviewed && (
        <p className="mt-4 text-center text-sm text-ink-400">{t('review.thanks')}</p>
      )}

      {/* Complaint ----------------------------------------------------- */}
      {delivered && (
        <div className="mt-4">
          {complained ? (
            <Alert tone="info">{t('complaint.filed')}</Alert>
          ) : (
            // Quiet on purpose: it sits beside the review prompt, not in front
            // of it, because most delivered orders were simply fine.
            <Button variant="secondary" fullWidth onClick={() => setComplaining(true)}>
              {t('complaint.report')}
            </Button>
          )}
        </div>
      )}

      {/*
        Support ---------------------------------------------------------
        Available at every stage, not only after delivery, because the moment a
        customer most needs a person is while the order is still moving and
        something has gone wrong with it. The order id travels in the link, so
        the ticket arrives at the operator already attached to this order and
        nobody has to open with "which order?".

        Distinct from the complaint form above, which is a formal record about
        a delivered meal and can return the restaurant's commission. This is a
        conversation.
      */}
      <div className="mt-4">
        <Link
          href={`/account/support?order=${encodeURIComponent(order.id)}&code=${encodeURIComponent(order.code)}`}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-3 text-[15px] font-medium text-ink-800 transition hover:bg-ink-50"
        >
          <LifeBuoy size={16} aria-hidden />
          {t('support.orderProblem')}
        </Link>
      </div>

      {/* Actions ------------------------------------------------------- */}
      <div className="mt-5 space-y-2">
        {canCancel ? (
          <>
            <Button variant="secondary" fullWidth onClick={() => setCancelling(true)}>
              {t('order.cancelWithin', { time: cancelCountdown ?? '' })}
            </Button>
            <p className="text-center text-sm text-ink-400">{t('order.cancelWindowNote')}</p>
          </>
        ) : (
          // The button is gone, so the reason is stated in one sentence — and
          // which sentence depends on WHY it is gone. "The kitchen has already
          // accepted" and "three minutes have passed" are different facts, and
          // telling somebody the wrong one makes the rule look arbitrary.
          !order.completedAt &&
          !order.cancellation && (
            <p className="text-center text-sm text-ink-400">
              {cancelWindow.reason === 'expired'
                ? t('order.cancelClosedExpired')
                : t('order.cancelOnlyBeforeAccept')}
            </p>
          )
        )}
      </div>

      <Sheet
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={t('order.cancel')}
        footer={
          <Button variant="danger" fullWidth loading={busy} onClick={cancel}>
            {t('order.cancel')}
          </Button>
        }
      >
        <Select
          label={t('order.cancelReason')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        >
          {CUSTOMER_REASONS.map((option) => (
            <option key={option} value={option}>
              {t(`order.reason.${option}`)}
            </option>
          ))}
        </Select>

        <div className="mt-4">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('checkout.notePlaceholder')}
            maxLength={200}
            className="w-full rounded-xl border border-ink-200 px-3.5 py-2.5 text-[15px]"
          />
        </div>

        {error && (
          <div className="mt-3">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
      </Sheet>

      <Sheet open={reviewing} onClose={() => setReviewing(false)} title={t('review.formTitle')}>
        <ReviewForm
          orderId={order.id}
          restaurantName={order.restaurantName}
          onSubmitted={() => {
            setJustReviewed(true);
            setReviewing(false);
          }}
        />
      </Sheet>

      <Sheet
        open={complaining}
        onClose={() => setComplaining(false)}
        title={t('complaint.formTitle')}
      >
        <ComplaintForm
          orderId={order.id}
          onSubmitted={() => {
            setJustComplained(true);
            setComplaining(false);
          }}
        />
      </Sheet>
    </AppShell>
  );
}

/**
 * `2:41` — minutes and seconds, the way a countdown is read aloud.
 *
 * Rounded up rather than down, so the last second shows «0:01» and not «0:00»
 * on a button that still works.
 */
function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
