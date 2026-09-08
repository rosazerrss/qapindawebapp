'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, Phone, Star, X } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { CancellationLine } from '@/components/panel/CancellationNote';
import { ReviewForm } from '@/components/customer/ReviewForm';
import { Badge, Button, Card, EmptyState, Money, Sheet, cn } from '@/components/ui';
import { OrderListSkeleton, PageLoading } from '@/components/ui/loading';
import { orderAccentClass, orderBadgeTone } from '@/components/panel/status';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import { pendingReviews } from '@/firebase/callables';
import { watchMyOrders } from '@/services/catalog';
import { isTerminal } from '@/shared/orderState';
import { PAST_ORDER_STATUSES } from '@/shared/enums';
import { dismissedReviews, rememberDismissedReviews } from '@/lib/dismissedReviews';
import { prefAllows } from '@/shared/notifications';
import type { Order } from '@/shared/models';

/**
 * "Sifarişlərim" is a bottom-bar destination, and the general rule is that a
 * tab does not get a back control. This screen is the exception, and it is the
 * owner's own call: people arrive here from a notification about one order as
 * often as they arrive by tapping the tab, and on that path the bottom bar is
 * not what they are looking at — they want out, and the browser's back button
 * takes them out of the app entirely.
 *
 * So the arrow stays, and it goes home rather than into history: from a
 * notification there is no history to return to.
 */
function Header({ title }: { title: string }) {
  const t = useT();

  return (
    <header className="mb-4 flex items-center gap-2">
      <Link
        href="/"
        aria-label={t('common.back')}
        className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-100"
      >
        <ArrowLeft size={19} aria-hidden />
      </Link>
      <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
    </header>
  );
}

interface PendingReview {
  orderId: string;
  orderCode: string;
  restaurantName: string;
}

/** How long to wait before saying the order list did not arrive. */
const ORDERS_TIMEOUT_MS = 8000;

export default function MyOrdersPage() {
  const t = useT();
  const { firebaseUser, profile, loading } = useAuth();
  const [loadedOrders, setLoadedOrders] = useState<Order[] | null>(null);
  // Null means "the customer has not picked a tab yet", which is what lets the
  // default be derived rather than assigned: somebody with nothing in flight
  // lands on their history instead of on an empty panel. Once they tap, their
  // choice sticks even as orders move between the two lists.
  const [tab, setTab] = useState<'active' | 'past' | null>(null);
  const [pending, setPending] = useState<PendingReview[]>([]);
  const [reviewing, setReviewing] = useState<PendingReview | null>(null);
  // The prompt is a nudge, not the page: it is fetched once per visit rather
  // than kept in sync, so a slow or failing call never delays the order list.
  const askedForPending = useRef(false);

  /*
   * The same missing timeout as everywhere else `onSnapshot` is used without
   * one: a dropped connection means the callback never fires, `orders` stays
   * null, and this screen renders its skeleton for ever. A customer waiting on
   * dinner is precisely the person who should not be left looking at a page
   * that is still thinking.
   */
  const [ordersFailedKey, setOrdersFailedKey] = useState<string | null>(null);
  const [ordersAttempt, setOrdersAttempt] = useState(0);
  const ordersKey = `${firebaseUser?.uid ?? ''}:${ordersAttempt}`;
  const ordersFailed = ordersFailedKey === ordersKey;

  useEffect(() => {
    if (!firebaseUser) return;

    const timer = setTimeout(() => setOrdersFailedKey(ordersKey), ORDERS_TIMEOUT_MS);

    const stop = watchMyOrders(firebaseUser.uid, (list) => {
      clearTimeout(timer);
      setLoadedOrders(list);
    });

    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [firebaseUser, ordersAttempt, ordersKey]);

  useEffect(() => {
    if (!firebaseUser || loadedOrders === null || askedForPending.current) return;
    // "Rate your order" is one of the three things Settings can switch off, and
    // a switch that silenced the notification while the card kept appearing
    // would be no switch at all. Asking is also pointless when it is off.
    if (!prefAllows(profile?.notificationPrefs, 'reviewReminders')) return;
    askedForPending.current = true;

    let cancelled = false;
    void pendingReviews().then((result) => {
      if (cancelled || !result.ok || !result.data) return;
      /*
       * Filtered against what this browser has already waved away.
       *
       * Done on arrival rather than at render, so the card is never drawn for
       * a single frame before the dismissed ones are removed from it.
       */
      const dismissed = dismissedReviews();

      setPending(
        result.data.pending
          .filter((entry) => !dismissed.has(entry.orderId))
          .map((entry) => ({
            orderId: entry.orderId,
            orderCode: entry.orderCode,
            restaurantName: entry.restaurantName,
          })),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [firebaseUser, profile, loadedOrders]);

  // Dropping the entry locally is what makes the card shrink — and vanish —
  // the moment the server accepts the review, with nothing re-fetched.
  const onReviewed = (orderId: string) => {
    setPending((current) => current.filter((entry) => entry.orderId !== orderId));
    setReviewing(null);
  };

  /**
   * "Not now."
   *
   * The card is a nudge, and a nudge with no way to close it is nagging. The
   * dismissed order ids are remembered in this browser so the SAME orders do
   * not ask again on the next visit — and a new delivered order still brings
   * the card back, because that is a new question rather than the one already
   * answered.
   *
   * Deliberately local. Storing it on the account would mean a write, a rule
   * and a field for something that is a preference about a banner, and losing
   * it when somebody changes phone is not a failure worth engineering against.
   */
  const dismissPending = () => {
    rememberDismissedReviews(pending.map((entry) => entry.orderId));
    setPending([]);
  };

  // A signed-out visitor has no orders — derived, so signing out cannot leave
  // the previous person's list on screen for a frame.
  const orders = useMemo(() => (firebaseUser ? loadedOrders : []), [firebaseUser, loadedOrders]);

  const { active, past } = useMemo(() => {
    const list = orders ?? [];
    /*
     * DELIVERED belongs in the history, and this used to be `isTerminal`.
     *
     * It is not terminal in the state machine — `settleDeliveredOrders` turns
     * it into COMPLETED after a grace period so the commission can be worked
     * out — but that is an accounting fact, and a customer holding the food
     * does not care about it. Under the old test the order sat in "Aktiv" for
     * twenty minutes after it arrived, which reads as "still on its way".
     *
     * `PAST_ORDER_STATUSES` is the same list the restaurant's and the admin's
     * history read, so all three now agree about when an order is over.
     */
    return {
      active: list.filter((order) => !PAST_ORDER_STATUSES.includes(order.status)),
      past: list.filter((order) => PAST_ORDER_STATUSES.includes(order.status)),
    };
  }, [orders]);

  if (loading) {
    return (
      <AppShell>
        <PageLoading />
      </AppShell>
    );
  }

  if (!firebaseUser) {
    return (
      <AppShell>
        <Header title={t('order.myOrders')} />
        <EmptyState
          title={t('auth.guestHint')}
          action={
            <Link href="/login?next=/orders" className="text-sm font-medium text-brand-600 underline">
              {t('auth.signIn')}
            </Link>
          }
        />
      </AppShell>
    );
  }

  const current = tab ?? (active.length === 0 && past.length > 0 ? 'past' : 'active');
  const shown = current === 'active' ? active : past;

  return (
    <AppShell>
      <Header title={t('order.myOrders')} />

      {pending.length > 0 && (
        <Card className="mb-4 border-brand-100 bg-brand-50 p-4">
          <div className="flex items-center gap-2">
            <Star size={18} className="shrink-0 text-brand-600" aria-hidden />
            <h2 className="min-w-0 flex-1 font-semibold text-ink-900">
              {t('review.pendingTitle', { count: pending.length })}
            </h2>
            {/* 44px, because it sits beside a heading on a phone and a smaller
                target is one somebody misses and then presses "rate" instead. */}
            <button
              type="button"
              onClick={dismissPending}
              aria-label={t('common.close')}
              className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-400 transition hover:bg-brand-100 hover:text-ink-700"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          <p className="mt-1 text-sm text-ink-600">{t('review.pendingHint')}</p>

          <ul className="mt-3 space-y-2">
            {pending.map((entry) => (
              <li
                key={entry.orderId}
                className="flex items-center gap-3 rounded-xl border border-card-edge bg-surface px-3.5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink-900">{entry.restaurantName}</p>
                  <p className="text-sm text-ink-400">{entry.orderCode}</p>
                </div>
                <Button size="sm" onClick={() => setReviewing(entry)}>
                  {t('review.rate')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-4 flex gap-2" role="tablist" aria-label={t('order.myOrders')}>
        {(['active', 'past'] as const).map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={current === option}
            onClick={() => setTab(option)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm transition',
              current === option
                ? 'bg-brand-600 text-white'
                : 'border border-ink-200 bg-white text-ink-600',
            )}
          >
            {option === 'active' ? t('order.activeOrders') : t('order.pastOrders')}
            {` (${option === 'active' ? active.length : past.length})`}
          </button>
        ))}
      </div>

      {orders === null && ordersFailed ? (
        // Not "you have no orders" — we could not find out. Those two sentences
        // want opposite reactions from the reader.
        <EmptyState
          title={t('home.loadFailed')}
          hint={t('home.loadFailedHint')}
          action={
            <Button variant="secondary" onClick={() => setOrdersAttempt((value) => value + 1)}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : orders === null ? (
        <OrderListSkeleton />
      ) : shown.length === 0 ? (
        <EmptyState title={t('order.noOrders')} />
      ) : (
        <div className="space-y-2.5">
          {shown.map((order) => (
            // The card is a plain container, not a link: the call button lives
            // inside it, and an anchor nested in an anchor is neither valid
            // HTML nor reliably clickable. The link covers the details instead.
            <Card
              key={order.id}
              // One block per order, and the block says what state it is in
              // before anything on it has been read — see `orderAccentClass`.
              className={cn('p-4 transition hover:shadow-md', orderAccentClass(order.status))}
            >
              <Link
                href={`/orders/${order.id}`}
                className="flex items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-900">{order.restaurantName}</span>
                    <span className="text-sm text-ink-400">{order.code}</span>
                  </div>

                  <p className="mt-1 text-sm text-ink-500">
                    {order.items.length} × {t('order.items').toLowerCase()} ·{' '}
                    <Money amount={order.pricing.total} />
                  </p>

                  <div className="mt-2">
                    {/* The tone comes from the one table that decides what
                        colour a state is, so this list, the restaurant's board,
                        the courier's phone and the admin's table all show a
                        cancelled order the same way. */}
                    <Badge tone={orderBadgeTone(order.status)}>
                      {t(`order.status.${order.status}`)}
                    </Badge>

                    {/* WHY, not just THAT.
                        A list of orders where three say "Ləğv edildi" and
                        nothing else makes the customer open all three to find
                        out which one the restaurant refused and which one they
                        cancelled themselves. */}
                    <CancellationLine cancellation={order.cancellation} />
                  </div>
                </div>
                <ChevronRight size={18} className="shrink-0 text-ink-300" />
              </Link>

              {/* Orders placed before the phone was snapshotted have none, and
                  a tel: link to nothing is worse than no button at all. */}
              {!isTerminal(order.status) && order.restaurantPhone && (
                <a
                  href={`tel:${order.restaurantPhone}`}
                  /*
                    The LABEL names the restaurant; the BUTTON does not.
                    
                    "Üç Qardaş Restoran restoranına zəng et" wrapped onto two
                    lines and said the name twice — once in the button and once
                    in the card heading directly above it. A screen reader has
                    no heading above it, though, so the accessible name keeps the
                    restaurant and the visible text drops it.
                  */
                  aria-label={t('order.callNamed', { name: order.restaurantName })}
                  className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-[15px] font-medium text-white transition hover:bg-brand-700"
                >
                  <Phone size={17} aria-hidden />
                  {t('order.callRestaurant')}
                </a>
              )}
            </Card>
          ))}
        </div>
      )}

      <Sheet
        open={reviewing !== null}
        onClose={() => setReviewing(null)}
        title={t('review.formTitle')}
      >
        {reviewing && (
          // Keyed by order so reopening the sheet for a different order starts
          // from an empty form rather than the previous order's stars.
          <ReviewForm
            key={reviewing.orderId}
            orderId={reviewing.orderId}
            restaurantName={reviewing.restaurantName}
            onSubmitted={onReviewed}
          />
        )}
      </Sheet>
    </AppShell>
  );
}
