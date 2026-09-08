'use client';

/**
 * The order that is happening right now, pinned to the bottom of the screen.
 *
 * Waiting for food is a state of mind, not a page. Somebody who has ordered
 * opens the app to find out where it is, and making them go to Orders and pick
 * from a list to learn "the kitchen accepted it" is three taps for one word. So
 * the word comes to them.
 *
 * It is a bar and not a card because it must never be the page: the shopfront
 * stays browsable underneath, and the bar sits above the navigation, out of the
 * way of the thumb that is scrolling. Tapping it opens the detail in place,
 * because the three questions somebody asks while waiting all have answers
 * that should not be another screen away: what did I order, what do I tell the
 * courier at the door, and what is the restaurant's number.
 *
 * The delivery code is the top of that panel while the food is on the road. A
 * customer with a courier standing in front of them should not be scrolling
 * past a timeline to find six digits.
 *
 * It shows nothing at all when there is no live order, which is most of the
 * time. A bar that is always there stops being read — and "live" ends when the
 * food arrives, not when the settlement job gets round to the order.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronUp, Phone } from 'lucide-react';

import { Button, Money, cn } from '@/components/ui';
import { POPOVER_SURFACE } from '@/components/ui/overlay';
import { DeliveryCode } from '@/components/customer/DeliveryCode';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import { watchMyOrders, watchRestaurant } from '@/services/catalog';
import { whenTime } from '@/components/panel/status';
import { formatPhone } from '@/shared/phone';
import { ACTIVE_ORDER_STATUSES, OrderStatus } from '@/shared/enums';
import type { Order, Restaurant } from '@/shared/models';

/** The steps a customer sees, in order. Terminal states are handled apart. */
const JOURNEY: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
];

/** When each step actually happened, for the expanded view. */
function stampFor(order: Order, status: OrderStatus): string {
  switch (status) {
    case OrderStatus.PLACED:
      return whenTime(order.placedAt);
    case OrderStatus.ACCEPTED:
      return whenTime(order.acceptedAt);
    case OrderStatus.PREPARING:
      return whenTime(order.preparingAt);
    case OrderStatus.READY:
      return whenTime(order.readyAt);
    case OrderStatus.OUT_FOR_DELIVERY:
      return whenTime(order.outForDeliveryAt);
    case OrderStatus.DELIVERED:
      return whenTime(order.deliveredAt);
    default:
      return '';
  }
}

export function ActiveOrderBar() {
  const { firebaseUser } = useAuth();

  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    // The same live listener the orders page uses, so the bar can never be a
    // step behind what that screen says.
    return watchMyOrders(firebaseUser.uid, setOrders);
  }, [firebaseUser]);

  // One order at a time is the rule the server enforces, so the newest live one
  // is the only one there can be. Derived rather than stored: signing out must
  // not leave the previous person's order sitting on screen.
  //
  // "Still moving" is ACTIVE_ORDER_STATUSES, not "not terminal". DELIVERED is
  // neither: the food is at the door, and COMPLETED only arrives later when the
  // settlement job walks the order on. Asking `isTerminal` therefore left the
  // bar pinned to the home screen for minutes after the customer had eaten —
  // which is exactly what was reported.
  const active = firebaseUser
    ? ((orders ?? []).find((order) => ACTIVE_ORDER_STATUSES.includes(order.status)) ?? null)
    : null;

  if (!active) return null;

  // Keyed on the order so that a new order starts collapsed, and so the panel's
  // restaurant subscription is torn down with the order it belonged to.
  return <ActiveOrderPanel key={active.id} order={active} />;
}

function ActiveOrderPanel({ order: active }: { order: Order }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);

  // Only to answer one question: does this restaurant ask for a code at the
  // door? Nothing else on this bar depends on it, so a restaurant that cannot
  // be read simply means no code panel — never a bar that will not open.
  useEffect(() => {
    return watchRestaurant(active.restaurantId, setRestaurant);
  }, [active.restaurantId]);

  const reached = JOURNEY.indexOf(active.status);
  const codeAtTheDoor =
    active.status === OrderStatus.OUT_FOR_DELIVERY && restaurant?.requireDeliveryCode === true;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 px-3 pb-2 md:bottom-4">
      <div className={cn('pointer-events-auto mx-auto max-w-2xl overflow-hidden rounded-2xl', POPOVER_SURFACE)}>
        {expanded && (
          <div className="max-h-[70vh] overflow-y-auto border-b border-card-edge px-4 pb-3 pt-4">
            {/* The code first, above everything: a customer opens this bar
                while the courier is at the door, and hunting for six digits
                under a timeline is the whole complaint. */}
            {codeAtTheDoor && <DeliveryCode orderId={active.id} />}

            {/* What they ordered, because the other reason to open this is to
                check whether the drink was actually on it. */}
            <h3 className="mb-1.5 mt-4 text-sm font-medium text-ink-700 first:mt-0">{t('order.items')}</h3>
            <ul className="mb-4 space-y-1.5">
              {active.items.map((item, index) => (
                <li key={`${item.productId}-${index}`} className="flex gap-2 text-sm">
                  <span className="min-w-6 font-medium tabular-nums text-ink-500">
                    {item.quantity}×
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-ink-900">{item.name}</span>
                    {item.modifiers.length > 0 && (
                      <span className="block text-xs text-ink-500">
                        {item.modifiers.map((modifier) => modifier.optionName).join(', ')}
                      </span>
                    )}
                  </span>
                  <span className="text-ink-700">
                    <Money amount={item.lineTotal} />
                  </span>
                </li>
              ))}
            </ul>

            <div className="mb-4 flex items-center justify-between border-t border-card-edge pt-2.5 text-sm font-medium text-ink-900">
              <span>{t('order.total')}</span>
              <Money amount={active.pricing.total} />
            </div>

            <ol className="space-y-2">
              {JOURNEY.map((step, index) => {
                const done = index <= reached;
                const stamp = stampFor(active, step);

                return (
                  <li key={step} className="flex items-center gap-3 text-sm">
                    <span
                      aria-hidden
                      className={cn(
                        'h-2.5 w-2.5 shrink-0 rounded-full',
                        done ? 'bg-brand-600' : 'bg-ink-200',
                      )}
                    />
                    <span className={done ? 'flex-1 text-ink-900' : 'flex-1 text-ink-400'}>
                      {t(`order.status.${step}`)}
                    </span>
                    {stamp && <span className="tabular-nums text-xs text-ink-400">{stamp}</span>}
                  </li>
                );
              })}
            </ol>

            {/* The answer to the question that made them open the app. Older
                orders carry no snapshotted number, so the button hides. */}
            {active.restaurantPhone && (
              <a
                href={`tel:${active.restaurantPhone}`}
                className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl border border-ink-200 text-[15px] font-medium text-ink-800 transition hover:bg-ink-50"
              >
                <Phone size={17} aria-hidden />
                {formatPhone(active.restaurantPhone)}
              </a>
            )}

            <Link href={`/orders/${active.id}`} className="mt-2 block">
              <Button fullWidth variant="secondary">
                {t('payment.viewOrder')}
                <ChevronRight size={16} aria-hidden />
              </Button>
            </Link>
          </div>
        )}

        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          {/* A quiet pulse, only while the order is still moving. It stops the
              moment the food is delivered, which is the point of it. */}
          <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75 motion-reduce:hidden" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-600" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink-900">
              {t(`order.status.${active.status}`)}
            </span>
            <span className="block truncate text-sm text-ink-500">{active.restaurantName}</span>
          </span>

          <ChevronUp
            size={18}
            aria-hidden
            className={cn(
              'shrink-0 text-ink-400 transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </button>
      </div>
    </div>
  );
}
