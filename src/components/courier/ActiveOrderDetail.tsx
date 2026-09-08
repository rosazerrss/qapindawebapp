'use client';

/**
 * One delivery, open.
 *
 * Everything a driver needs between the pass and the door, in the order they
 * need it: which order this is, which kitchen it came out of, what money to
 * take, where it goes, what is in the bag, and then the two ways it can end.
 * Nothing about the restaurant's takings appears anywhere, and the only
 * personal data on screen is what it takes to hand a bag to a person —
 * their name, the address, the note they wrote about finding it, and a number
 * to ring when the door does not open.
 *
 * WHY EVERY LOADING STATE HERE HAS A THIRD ANSWER
 * ----------------------------------------------
 * This screen used to hang: a card asked whether its restaurant requires a
 * delivery code and drew a spinner until it knew. "Not read yet" and "could not
 * be read" were the same value — `undefined` straight out of
 * `restaurant?.requireDeliveryCode` — so a restaurant document the courier is
 * not allowed to read left the card spinning for as long as the driver was
 * willing to stare at it. Every load is three states, and the third one is a
 * sentence on screen.
 */

import { useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  Navigation,
  Phone,
  StickyNote,
  Store,
  Wallet,
} from 'lucide-react';

import { Alert, Badge, Button, Card, Money, cn } from '@/components/ui';
import { DeliveryHandover } from '@/components/restaurant/DeliveryHandover';
import { DestinationMap } from '@/components/restaurant/DestinationMap';
import { useT, translateError } from '@/i18n';
import { acceptDelivery, courierConfirmDelivery } from '@/firebase/callables';
import { formatPhone } from '@/shared/phone';
import { deliveryContact } from '@/shared/addressContact';
import { OrderStatus, PaymentMethod, isOnlinePayment } from '@/shared/enums';
import type { Order } from '@/shared/models';
import { OrderStatusBadge, useWhen } from './OrderCards';
import type { CodePolicy } from './useCourierData';
import { addressDetail } from '@/lib/address';

/**
 * What the driver has to collect, said in one sentence and one number.
 *
 * This is the line that goes wrong most expensively: a courier who hands over a
 * prepaid order and asks for 24 manat has stolen from a customer by accident,
 * and one who hands over a cash order and asks for nothing has paid for
 * somebody's dinner. So it is never a code word — it is "take this much, in
 * this form", or "take nothing".
 */
function PaymentInstruction({ order }: { order: Order }) {
  const t = useT();

  // Online is the only method whose money never passes through the driver's
  // hands, and an order only ever leaves PENDING_PAYMENT once the bank has
  // confirmed it to the server — so the method alone is the answer here.
  if (isOnlinePayment(order.paymentMethod)) {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-2xl bg-green-50 px-4 py-4">
        <Wallet size={24} className="mt-0.5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="text-lg font-semibold text-success">{t('kuryer.payPrepaid')}</p>
          <p className="mt-0.5 text-base text-ink-600">{t('kuryer.payPrepaidHint')}</p>
        </div>
      </div>
    );
  }

  const byCard = order.paymentMethod === PaymentMethod.CARD_ON_DELIVERY;

  return (
    <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-4">
      <div className="flex items-center gap-3">
        {byCard ? (
          <CreditCard size={24} className="shrink-0 text-warning" aria-hidden />
        ) : (
          <Banknote size={24} className="shrink-0 text-warning" aria-hidden />
        )}
        <p className="text-lg font-semibold text-warning">
          {byCard ? t('kuryer.payCard') : t('kuryer.payCash')}
        </p>
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums text-warning">
        <Money amount={order.pricing.total} />
      </p>
    </div>
  );
}

/**
 * "I have it."
 *
 * Assignment is the restaurant's decision and acceptance is the driver's, and
 * the gap between the two is the only thing that tells an operator a delivery
 * is sitting on a phone nobody has picked up. Nothing about the order moves:
 * the food is still where it was.
 */
function AcceptDelivery({ order }: { order: Order }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (order.courier?.acceptedAt) {
    return (
      <p className="mt-4 flex items-center gap-2 text-base font-medium text-success">
        <CheckCircle2 size={18} aria-hidden />
        {t('kuryer.accepted')}
      </p>
    );
  }

  const accept = async () => {
    setBusy(true);
    setError(null);

    const result = await acceptDelivery(order.id);
    setBusy(false);

    // No local "accepted" flag on success: the listener carries the order back
    // with `courier.acceptedAt` set, and a screen that remembers its own answer
    // is a screen that can disagree with the server.
    if (!result.ok) setError(translateError(t, result.errorCode, result.errorDetail));
  };

  return (
    <div className="mt-4">
      <p className="mb-2 text-base text-ink-600">{t('kuryer.acceptHint')}</p>
      <Button size="lg" fullWidth variant="secondary" loading={busy} onClick={() => void accept()}>
        {t('kuryer.acceptDelivery')}
      </Button>
      {error && (
        <div className="mt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </div>
  );
}

export function ActiveOrderDetail({
  order,
  codePolicy,
}: {
  order: Order;
  codePolicy: CodePolicy;
}) {
  const t = useT();
  const when = useWhen();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onTheWay = order.status === OrderStatus.OUT_FOR_DELIVERY;
  // Unknown counts as "offer the box": the courier can leave it empty if the
  // shop does not use codes, and the server refuses either way if it must.
  const codeOffered = codePolicy !== false;
  const codeRequired = codePolicy === true;

  const confirm = async () => {
    setBusy(true);
    setError(null);

    const result = await courierConfirmDelivery({
      orderId: order.id,
      code: code.length === 6 ? code : null,
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }
    // The listener moves this order into the history the moment its status
    // passes OUT_FOR_DELIVERY — nothing left to do here.
  };

  const mapsHref =
    order.address?.lat != null && order.address?.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${order.address.lat},${order.address.lng}`
      : null;

  /*
   * "Bina A, mənz. 12, mərt. 3, Qapında MMC" — whatever of it exists.
   *
   * Derived during render from the snapshot rather than assembled anywhere
   * else: this is a photograph of the address as it was when the order was
   * placed, and every piece of it is optional.
   */
  const detail = addressDetail(order.address, t);

  const contact = deliveryContact({
    addressContactName: order.address?.contactName,
    addressPhone: order.address?.phone,
    accountName: order.customerName,
    accountPhone: order.customerPhone,
  });

  const deliveryPhone = contact.phone;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-2xl font-bold text-ink-900">{order.code}</span>
        <OrderStatusBadge order={order} />
      </div>

      {/* Which kitchen this came out of, and how to reach it. A driver working
          a shop with two brands on one licence, or picking up two orders in a
          row, needs this before anything else on the screen. */}
      <p className="mt-1 flex items-center gap-2 text-lg font-medium text-ink-700">
        <Store size={18} className="shrink-0 text-ink-400" aria-hidden />
        {order.restaurantName}
      </p>
      {order.restaurantPhone && (
        <a
          href={`tel:${order.restaurantPhone}`}
          className="mt-1 inline-flex min-h-11 items-center gap-2 text-base text-brand-700 underline"
        >
          <Phone size={16} aria-hidden />
          {formatPhone(order.restaurantPhone)}
        </a>
      )}

      <p className="mt-1 text-base text-ink-500">
        {t('order.placedAt')}: {when(order.placedAt)}
      </p>

      {/* Whether a code is coming is the one thing a courier must know before
          they knock, not after — so it sits with the order code, before
          anything else. "We could not find out" is a third answer here, and
          saying it plainly beats a spinner that never resolves. */}
      <div className="mt-2">
        <Badge tone={codePolicy === true || codePolicy === 'unknown' ? 'warning' : 'neutral'}>
          {codePolicy === true
            ? t('kuryer.codeRequired')
            : codePolicy === false
              ? t('kuryer.codeNotRequired')
              : codePolicy === 'loading'
                ? t('common.loading')
                : t('kuryer.codeUnknownShort')}
        </Badge>
      </div>

      <PaymentInstruction order={order} />

      <AcceptDelivery order={order} />

      {/* --- Where it goes ------------------------------------------------ */}
      <div className="mt-5 border-t border-card-edge pt-4">
        {/*
          WHO TO ASK FOR AT THE DOOR.
          
          The address's own contact when it has one, the account holder
          otherwise. `deliveryContact` decides that in one place shared with the
          printed slip, the restaurant's ticket and the operator's panel, so
          none of the four can disagree about who is at the door.
          
          When the two differ the account holder is named underneath in small
          type, because "the order was placed by X for Y" is exactly what a
          driver needs when nobody answers.
        */}
        <p className="text-base text-ink-500">{t('kuryer.customerLabel')}</p>
        <p className="text-xl font-semibold text-ink-900">{contact.name}</p>
        {contact.fromAddress && contact.name !== order.customerName && (
          <p className="text-base text-ink-500">
            {t('kuryer.orderedBy', { name: order.customerName })}
          </p>
        )}

        <p className="mt-2 text-base text-ink-500">{t('kuryer.addressLabel')}</p>
        <p className="text-lg leading-snug text-ink-800">{order.address?.line}</p>

        {/* Bina, mənzil, mərtəbə, şirkət — the part of the journey that starts
            where the map ends. Joined into one line rather than four rows: the
            driver is reading this at a door, in the dark, one-handed. */}
        {detail && (
          <p className="mt-1 text-lg font-medium leading-snug text-ink-900">{detail}</p>
        )}

        {order.address?.note && (
          <p className="mt-1 text-lg leading-snug text-ink-600">{order.address.note}</p>
        )}

        {/* Older orders, and addresses typed before the map existed, carry no
            coordinates — then the written line is all there is. */}
        {order.address?.lat != null && order.address?.lng != null && (
          <DestinationMap
            lat={order.address.lat}
            lng={order.address.lng}
            label={order.address.line}
          />
        )}

        {mapsHref && (
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl border-2 border-ink-200 text-lg font-semibold text-ink-800 transition hover:bg-ink-50"
          >
            <Navigation size={20} aria-hidden />
            {t('kuryer.navigate')}
          </a>
        )}
      </div>

      {/* The number for THIS delivery.
          An address can carry its own — an order sent to a parent's flat or to
          an office reception should ring whoever opens the door, not whoever
          has the app. The account's number is the fallback, and every order
          placed before addresses had a phone falls back to it. */}
      <a
        href={`tel:${deliveryPhone}`}
        aria-label={`${t('kuryer.call')} ${deliveryPhone}`}
        className="mt-3 flex h-16 w-full items-center justify-center gap-2.5 rounded-2xl bg-brand-600 text-xl font-semibold text-white transition hover:bg-brand-700 active:bg-brand-800"
      >
        <Phone size={22} aria-hidden />
        {formatPhone(deliveryPhone)}
      </a>

      {/* --- What is in the bag ------------------------------------------- */}
      <div className="mt-5 border-t border-card-edge pt-4">
        <h2 className="text-base font-medium text-ink-500">{t('order.items')}</h2>
        <ul className="mt-2 space-y-2.5">
          {order.items.map((item, index) => (
            <li key={`${item.productId}-${index}`} className="flex gap-3">
              <span className="min-w-9 text-lg font-bold tabular-nums text-ink-900">
                {item.quantity}×
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg leading-snug text-ink-900">{item.name}</span>
                {item.modifiers.length > 0 && (
                  <span className="block text-base leading-snug text-ink-600">
                    {item.modifiers.map((modifier) => modifier.optionName).join(', ')}
                  </span>
                )}
                {/* The customer wrote this about this dish specifically —
                    "no onions" is the difference between a delivery and a
                    complaint, and it must not be buried. */}
                {item.note && (
                  <span className="mt-0.5 block text-base italic leading-snug text-ink-700">
                    {item.note}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {/* The order total, and nothing else about money. What the restaurant
            earns, what the platform takes and what any of it settles to is
            none of this account's business. */}
        <p className="mt-3 flex items-center justify-between border-t border-card-edge pt-3 text-lg font-semibold text-ink-900">
          <span>{t('order.total')}</span>
          <Money amount={order.pricing.total} />
        </p>
      </div>

      {order.customerNote && (
        <div className="mt-4 flex gap-3 rounded-2xl bg-ink-50 px-4 py-3.5">
          <StickyNote size={20} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
          <span>
            <span className="block text-base font-medium text-ink-500">
              {t('kuryer.customerNote')}
            </span>
            <span className="mt-0.5 block text-lg leading-snug text-ink-900">
              {order.customerNote}
            </span>
          </span>
        </div>
      )}

      {/* --- Closing it --------------------------------------------------- */}
      {!onTheWay ? (
        <p className="mt-5 rounded-xl bg-ink-50 px-4 py-3.5 text-base text-ink-600">
          {t('kuryer.pickupOnly')}
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {codePolicy === 'unknown' && (
            <div className="flex gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-base text-warning">
              <AlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden />
              <span>{t('kuryer.codeUnknown')}</span>
            </div>
          )}

          {codeOffered && (
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label={t('kuryer.codeInputLabel')}
              className={cn(
                'w-full rounded-2xl border-2 border-ink-200 px-4 py-4 text-center text-4xl font-bold',
                'tracking-[0.4em] tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100',
              )}
            />
          )}

          <Button
            size="lg"
            fullWidth
            loading={busy}
            // Only a policy we are sure of may disable the button. Under
            // 'unknown' the courier must always be able to try, and be told by
            // the server if a code was needed after all.
            disabled={codeRequired && code.length !== 6}
            onClick={() => void confirm()}
          >
            {codeRequired ? t('kuryer.confirmWithCode') : t('kuryer.confirmDelivered')}
          </Button>

          {error && <Alert tone="danger">{error}</Alert>}

          <DeliveryHandover orderId={order.id} onDone={() => setError(null)} />
        </div>
      )}
    </Card>
  );
}
