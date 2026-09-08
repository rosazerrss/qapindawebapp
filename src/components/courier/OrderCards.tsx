'use client';

/**
 * The two rows a courier reads: one delivery to do, one delivery done.
 *
 * ALWAYS THE ORDER CODE, NEVER THE DOCUMENT ID
 * --------------------------------------------
 * `order.code` is the only identifier that appears anywhere in this app —
 * "#QPD-10482" is what the customer has, what the kitchen shouts across the
 * pass and what a driver reads out on the phone. The Firestore id exists to
 * build the link and for nothing else, and it is never rendered.
 *
 * WHAT IS DELIBERATELY NOT ON THESE CARDS
 * --------------------------------------
 * Nothing about the restaurant's finances: not the commission, not what the
 * kitchen earns, not what any of it settles to. The one number a driver needs
 * is what the order is worth at the door, because that is the sum they may have
 * to collect. And no personal data beyond what a delivery requires — the
 * summary card carries no phone number and no address at all, since the list is
 * the screen most likely to be read over somebody's shoulder.
 */

import Link from 'next/link';
import { CheckCircle2, ChevronRight, XCircle } from 'lucide-react';

import { Badge, Card, Money, cn } from '@/components/ui';
import { useLocale, useT } from '@/i18n';
import { formatDateTimeIn, orderAccentClass, orderBadgeTone } from '@/components/panel/status';
import { CancellationLine } from '@/components/panel/CancellationNote';
import { courierDeliveredWell } from '@/shared/courier';
import type { Order, TimestampLike } from '@/shared/models';

/** The panel's status tones, mapped onto the badge's. One vocabulary, two components. */
export function OrderStatusBadge({ order }: { order: Order }) {
  const t = useT();
  // The tone comes from `status.ts`, the one place that decides what colour a
  // state is — a driver's screen and the admin's list must never disagree
  // about what a cancelled order looks like.
  return (
    <Badge tone={orderBadgeTone(order.status)}>{t(`order.status.${order.status}`)}</Badge>
  );
}

/** The order's own words for how it is paid: "Qapıda nağd", "Onlayn kart". */
export function usePaymentLabel(order: Order): string {
  const t = useT();
  return t(`checkout.${order.paymentMethod}`);
}

/**
 * When a delivery ended.
 *
 * Four candidates, in the order they are trusted: an order that completed has a
 * `completedAt`, one that was handed over has a `deliveredAt`, one that was
 * cancelled carries the moment in its cancellation record, and `updatedAt` is
 * the last resort that every document has. Falling back rather than rendering a
 * blank matters here — the date is the only thing that tells two deliveries to
 * the same restaurant apart in a list.
 */
export function finishedAtOf(order: Order): TimestampLike | null {
  return order.completedAt ?? order.deliveredAt ?? order.cancellation?.at ?? order.updatedAt ?? null;
}

/** `TimestampLike` → "30 avq 2026, 21:35", in the reader's own language. */
export function useWhen(): (value: TimestampLike | null | undefined) => string {
  const { locale } = useLocale();
  return (value) => {
    const millis = value?.toMillis?.();
    if (millis === undefined) return '';
    return formatDateTimeIn(millis, locale);
  };
}

/**
 * One active delivery, as a card.
 *
 * The code first and biggest, because that is what everything else is filed
 * under; then the kitchen it came out of, the money, how it is paid, and where
 * the order has got to. The whole card is the link — a driver's thumb should
 * not have to find a button inside it.
 */
export function CourierOrderSummary({ order }: { order: Order }) {
  const t = useT();
  const payment = usePaymentLabel(order);

  return (
    // The status stripe down the left edge: on a phone held at a traffic light
    // the colour is read before any of the words are.
    <Card className={cn('p-4', orderAccentClass(order.status))}>
      <Link
        href={`/courier/orders/${order.id}`}
        className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <span className="font-mono text-2xl font-bold text-ink-900">{order.code}</span>
        <span className="mt-0.5 block text-lg font-medium text-ink-700">
          {order.restaurantName}
        </span>

        <span className="mt-3 block text-base text-ink-600">
          {t('kuryer.orderAmount')}:{' '}
          <span className="font-semibold text-ink-900">
            <Money amount={order.pricing.total} />
          </span>
        </span>
        <span className="mt-0.5 block text-base text-ink-600">
          {t('checkout.payment')}: <span className="text-ink-900">{payment}</span>
        </span>

        <span className="mt-3 flex items-center gap-2">
          <span className="text-base text-ink-600">{t('kuryer.statusLabel')}:</span>
          <OrderStatusBadge order={order} />
        </span>

        {/*
          A driver holding a phone in the street is the person who most needs
          the REASON and was the last to be given it: an order cancelled while
          they were on their way showed "Ləğv edildi" and nothing else, so they
          had no idea whether to turn round, ring the customer, or go back to
          the restaurant. `text-base` because this is read at arm's length on a
          bright street, not at a desk.
        */}
        <CancellationLine
          cancellation={order.cancellation}
          className="mt-2 text-base font-medium text-danger"
        />

        <span className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-lg font-semibold text-white">
          {t('kuryer.openOrder')}
          <ChevronRight size={20} aria-hidden />
        </span>
      </Link>
    </Card>
  );
}

/**
 * One finished delivery, as a row.
 *
 * A tick or a cross carries the ending as well as the words do, and the words
 * are there because colour and a glyph on their own are not an answer for
 * somebody who cannot see either.
 */
export function CourierHistoryRow({ order }: { order: Order }) {
  const t = useT();
  const when = useWhen();
  const delivered = courierDeliveredWell(order.status);

  return (
    <li>
      <Link
        href={`/courier/history/${order.id}`}
        className={cn(
          'flex items-center gap-3 rounded-2xl border border-card-edge bg-surface p-4 shadow-card transition hover:bg-subtle',
          orderAccentClass(order.status),
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-lg font-bold text-ink-900">{order.code}</span>
          <span className="mt-0.5 block truncate text-base text-ink-700">
            {order.restaurantName}
          </span>
          <span className="mt-0.5 block text-sm text-ink-400">{when(finishedAtOf(order))}</span>

          <span className="mt-1.5 flex items-center gap-2">
            <span className="text-base font-semibold text-ink-900">
              <Money amount={order.pricing.total} />
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1 text-sm font-medium',
                delivered ? 'text-success' : 'text-danger',
              )}
            >
              {delivered ? (
                <CheckCircle2 size={16} aria-hidden />
              ) : (
                <XCircle size={16} aria-hidden />
              )}
              {t(`order.status.${order.status}`)}
            </span>
          </span>

          {/* Why it ended, in the history list too — so a driver checking
              yesterday's failed delivery does not have to open it. */}
          <CancellationLine cancellation={order.cancellation} className="mt-1 text-sm text-danger" />
        </span>

        <ChevronRight size={20} className="shrink-0 text-ink-300" aria-hidden />
      </Link>
    </li>
  );
}
