'use client';

/**
 * The orders still moving, right now.
 *
 * This is the operator's default screen and the reason the job exists: a
 * restaurant rings to say a driver has not turned up, and the answer is on this
 * list within one glance — which order, how long it has been sitting there,
 * which step it stopped on.
 *
 * WHAT AN OPERATOR CAN SEE, AND WHY IT IS NOW EVERYTHING
 * ------------------------------------------------------
 * This screen used to withhold the customer entirely — no name, no number, no
 * address, no dial button — on the reasoning that Qapında does not ring the
 * people who order food. That reasoning was sound while customer support did
 * not exist. It does now, by the owner's own decision, and an operator working
 * a customer's ticket who cannot see who the customer is, where the food was
 * going or what was in the bag is being asked to help with their eyes shut.
 *
 * So the drawer carries the whole order: the items with the options and the
 * notes attached to each, the address with the flat and the floor, the money
 * broken down including whose discount it was, the payment, the courier and
 * whether they accepted, the estimate the kitchen gave, why a delivery failed,
 * and the timeline. Everything the order knows about itself.
 *
 * What is still deliberately absent is anything about the customer that is not
 * about THIS order — their other orders, their account, their address book.
 * An operator answering a ticket needs the order in front of them, not a
 * profile of the person.
 *
 * The one destructive action here is the force-cancel, shared with the admin
 * panel, which demands a written reason and files it in the audit log under
 * this operator's name.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Ban, Phone } from 'lucide-react';

import {
  DataTable,
  Drawer,
  Field,
  PageHeader,
  SearchInput,
  StatusBadge,
  Toolbar,
  type Column,
} from '@/components/panel/ui';
import { ForceCancelDialog } from '@/components/panel/ForceCancelDialog';
import { OrderTimeline } from '@/components/panel/OrderTimeline';
import { orderTone, paymentTone, when, whenTime } from '@/components/panel/status';
import { CancellationLine, CancellationNote } from '@/components/panel/CancellationNote';
import { Badge, Button, Card, Money } from '@/components/ui';
import { useT, type Translate } from '@/i18n';
import { list, matches, num, text } from '@/lib/stored';
import { firestore } from '@/firebase/client';
import { COLLECTIONS } from '@/shared/collections';
import { CustomerOrderContext } from '@/components/panel/CustomerOrderContext';
import { ACTIVE_ORDER_STATUSES, OrderStatus } from '@/shared/enums';
import { isTerminal } from '@/shared/orderState';
import type { Order } from '@/shared/models';
import { formatPhone } from '@/shared/phone';
import { addressDetail } from '@/lib/address';

/**
 * How often the ages on screen are allowed to be wrong, in milliseconds.
 *
 * Half a minute: fine enough that "14 dəq" is never a minute stale by the time
 * it is read, coarse enough that an idle screen re-renders twice a minute
 * rather than sixty times.
 */
const TICK_MS = 30_000;

function subscribeToTick(onChange: () => void): () => void {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
}

/**
 * The clock, as something the component reads rather than something an effect
 * writes into state.
 *
 * The snapshot is deliberately rounded to the tick, because `useSyncExternalStore`
 * re-renders whenever the value changes and `Date.now()` changes on every call.
 */
function useTickingNow(): number {
  const snapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
  return useSyncExternalStore(subscribeToTick, snapshot, snapshot);
}

/** "8 dəq", "2 saat", "3 gün" — how long this order has been on the platform. */
function formatAge(t: Translate, placedAtMillis: number | undefined, now: number): string {
  if (placedAtMillis === undefined) return '—';

  const minutes = Math.max(0, Math.round((now - placedAtMillis) / 60_000));
  if (minutes < 60) return t('operator.ageMinutes', { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('operator.ageHours', { count: hours });

  return t('operator.ageDays', { count: Math.floor(hours / 24) });
}

/**
 * What the support desk watches: everything moving, and everything that failed
 * at the door. See the note on the query below.
 */
const OPERATOR_BOARD_STATUSES: OrderStatus[] = [
  ...ACTIVE_ORDER_STATUSES,
  OrderStatus.DELIVERY_FAILED,
];

export function LiveOrders() {
  const t = useT();
  const now = useTickingNow();

  const [orders, setOrders] = useState<Order[] | null>(null);
  // An operator whose subscription was refused must not be shown an empty
  // board: "nothing is moving" is the one reading of this screen that stops
  // somebody doing their job.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);

  useEffect(() => {
    const db = firestore();
    if (!db) return;

    /*
     * THE BOARD, PLUS THE FAILURES.
     *
     * The status filter is not only a convenience: the security rules are
     * evaluated against the QUERY, so this shape is what makes the read legal
     * and it is served by an index that already exists.
     *
     * `DELIVERY_FAILED` is on the board deliberately, even though the order has
     * stopped moving. It used to fall off the moment the courier marked it —
     * out of the active list, and into a history nobody watches — so the one
     * event on this platform that always needs a person left the operator's
     * screen at exactly the moment it started needing one. A customer with no
     * dinner is the definition of "live" for a support desk, whatever the
     * order's status field says.
     *
     * Six values, well inside the ten an `in` query allows.
     */
    return onSnapshot(
      query(
        collection(db, COLLECTIONS.orders),
        where('status', 'in', OPERATOR_BOARD_STATUSES),
        orderBy('placedAt', 'desc'),
        limit(200),
      ),
      (snapshot) => {
        setOrders(snapshot.docs.map((entry) => entry.data() as Order));
        setLoadError(null);
      },
      () => {
        setOrders([]);
        setLoadError(t('errors.LIST_UNAVAILABLE'));
      },
    );
  }, [t]);

  const rows = useMemo(() => {
    if (!orders) return null;
    const needle = term.trim().toLowerCase();

    return orders.filter((order) => matches(needle, order.code, order.restaurantName));
  }, [orders, term]);

  // The listener drops a cancelled order from the list on the next tick, so the
  // drawer would otherwise be left showing an order that is no longer there.
  const live = open ? (orders?.find((order) => order.id === open.id) ?? open) : null;

  const columns: Column<Order>[] = [
    {
      key: 'code',
      header: t('admin.orderId'),
      width: '120px',
      cell: (order) => (
        <span className="font-mono font-semibold text-ink-900">{text(order.code)}</span>
      ),
      sortValue: (order) => text(order.code),
    },
    {
      key: 'restaurant',
      header: t('nav.restaurants'),
      cell: (order) => text(order.restaurantName),
      sortValue: (order) => text(order.restaurantName),
    },
    {
      key: 'status',
      header: t('admin.status'),
      cell: (order) => (
        <>
          <StatusBadge tone={orderTone(order.status)}>
            {t(`order.status.${order.status}`)}
          </StatusBadge>
          {/* The operator's queue is where somebody decides which problem to
              pick up next, and "Ləğv edildi" on its own does not help them
              choose. A row that says "Şübhəli fırıldaq" is a row they open
              first. */}
          <CancellationLine cancellation={order.cancellation} />
        </>
      ),
      sortValue: (order) => order.status,
    },
    {
      key: 'age',
      header: t('operator.age'),
      align: 'right',
      cell: (order) => (
        <span className="text-ink-700">{formatAge(t, order.placedAt?.toMillis?.(), now)}</span>
      ),
      // Sorted by the moment it was placed, not by the printed words: "9 dəq"
      // and "10 dəq" do not sort as text in the order anyone expects.
      sortValue: (order) => order.placedAt?.toMillis?.() ?? 0,
    },
    {
      key: 'total',
      header: t('cart.total'),
      align: 'right',
      cell: (order) => <Money amount={num(order.pricing?.total)} className="font-medium" />,
      sortValue: (order) => num(order.pricing?.total),
    },
  ];

  return (
    <>
      <PageHeader title={t('operator.tabOrders')} subtitle={t('operator.ordersSubtitle')} />

      <Toolbar>
        <SearchInput value={term} onChange={setTerm} placeholder={t('operator.searchOrders')} />
      </Toolbar>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(order) => order.id}
        onRowClick={setOpen}
        error={loadError}
        emptyTitle={t('operator.noLiveOrders')}
        emptyHint={t('operator.noLiveOrdersHint')}
      />

      <Drawer
        open={Boolean(live)}
        onClose={() => setOpen(null)}
        title={live?.code ?? ''}
        subtitle={live ? `${live.restaurantName} · ${when(live.placedAt)}` : undefined}
        footer={
          live && !isTerminal(live.status) ? (
            <Button variant="danger" fullWidth onClick={() => setCancelling(live)}>
              <Ban size={16} /> {t('order.cancel')}
            </Button>
          ) : undefined
        }
      >
        {live && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={orderTone(live.status)}>
                {t(`order.status.${live.status}`)}
              </StatusBadge>
              <StatusBadge tone={paymentTone(live.paymentStatus)}>
                {t(`payment.${live.paymentStatus}`)}
              </StatusBadge>
              <Badge tone="neutral">{t(`checkout.${live.paymentMethod}`)}</Badge>
            </div>

            {/* Two calls, both one tap. The kitchen answers most questions;
                the customer is who an operator working a ticket needs. */}
            <div className="grid gap-2 sm:grid-cols-2">
              {live.restaurantPhone && (
                <a
                  href={`tel:${live.restaurantPhone}`}
                  className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-[15px] font-semibold text-white transition hover:bg-brand-700"
                >
                  <Phone size={17} aria-hidden />
                  {t('operator.callRestaurant')}
                </a>
              )}

              {/* The number the order says to ring — the door phone where one
                  was given, because food sent to an office should not have the
                  operator calling the account holder at home. */}
              {(live.address?.phone || live.customerPhone) && (
                <a
                  href={`tel:${live.address?.phone ?? live.customerPhone}`}
                  className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl border-2 border-brand-600 text-[15px] font-semibold text-brand-700 transition hover:bg-brand-50"
                >
                  <Phone size={17} aria-hidden />
                  {t('operator.callCustomer')}
                </a>
              )}
            </div>

            <Card className="px-4 py-2">
              <Field label={t('nav.restaurants')}>{text(live.restaurantName) || '—'}</Field>
              <Field label={t('admin.customer')}>{text(live.customerName) || '—'}</Field>
              <Field label={t('auth.phone')}>
                {live.customerPhone ? formatPhone(live.customerPhone) : '—'}
              </Field>
              <Field label={t('admin.placedAt')}>{when(live.placedAt)}</Field>
              <Field label={t('operator.age')}>
                {formatAge(t, live.placedAt?.toMillis?.(), now)}
              </Field>
              {/* The promise made to the customer. An operator fielding "where
                  is my food" needs the number the customer was given, not a
                  fresh guess. */}
              {live.estimatedDeliveryAt && (
                <Field label={t('order.estimatedArrival')}>
                  {whenTime(live.estimatedDeliveryAt)}
                  {live.prepMinutes ? ` · ${t('restaurantPanel.prepMinutes', { count: live.prepMinutes })}` : ''}
                </Field>
              )}
            </Card>

            {/* Where it was going, in full. The street alone is not an address:
                the flat and the floor are the half a driver actually needs, and
                an operator re-sending a failed delivery has to be able to read
                back what the customer wrote. */}
            {/*
              The rest of this customer's orders, one tap away.
              
              On the live board as well as on the complaints queue, because
              the question "is this the fourth time?" arrives on the phone
              before anybody has filed anything.
            */}
            <CustomerOrderContext orderId={live.id} />

            {live.address && (
              <Card className="px-4 py-2">
                <Field label={t('receipt.address')}>{text(live.address.line) || '—'}</Field>
                {addressDetail(live.address, t) && (
                  <Field label={t('receipt.addressDetail')}>
                    {addressDetail(live.address, t)}
                  </Field>
                )}
                {/* Who opens the door, and on which number. Shown even when it
                    is the account holder, because an operator taking a
                    complaint about a failed delivery needs to know WHICH of
                    the two was rung — "we called the number on the address"
                    and "we called the account holder" are different stories. */}
                {live.address.contactName && (
                  <Field label={t('receipt.doorName')}>{live.address.contactName}</Field>
                )}
                {live.address.phone && (
                  <Field label={t('receipt.doorPhone')}>{formatPhone(live.address.phone)}</Field>
                )}
                {live.address.note && (
                  <Field label={t('receipt.addressNote')}>{live.address.note}</Field>
                )}
              </Card>
            )}

            {/* Who is carrying it, and whether they have actually picked it up.
                "Assigned" and "accepted" are different facts, and the gap
                between them is the most common reason a restaurant rings. */}
            {live.courier && (
              <Card className="px-4 py-2">
                <Field label={t('operator.courier')}>{live.courier.name}</Field>
                <Field label={t('operator.courierAccepted')}>
                  {live.courier.acceptedAt ? when(live.courier.acceptedAt) : t('operator.notYet')}
                </Field>
              </Card>
            )}

            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink-900">{t('order.items')}</h3>
              <ul className="space-y-2">
                {list<(typeof live.items)[number]>(live.items).map((item, index) => (
                  <li
                    key={`${item.productId}-${index}`}
                    className="flex justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-ink-900">{item.quantity}×</span> {item.name}
                      {/* The options are half of what was ordered. Without them
                          "1× Dönər" tells an operator handling a wrong-item
                          complaint nothing at all. */}
                      {list<{ optionName?: string }>(item.modifiers).length > 0 && (
                        <span className="block pl-5 text-ink-500">
                          {list<{ optionName?: string }>(item.modifiers)
                            .map((modifier) => modifier.optionName)
                            .join(' · ')}
                        </span>
                      )}
                      {item.note && (
                        <span className="block pl-5 italic text-brand-600">{item.note}</span>
                      )}
                    </span>
                    <Money amount={num(item.lineTotal)} className="shrink-0 text-ink-700" />
                  </li>
                ))}
              </ul>

              <div className="mt-3 border-t border-card-edge pt-3">
                <Field label={t('cart.subtotal')}>
                  <Money amount={num(live.pricing?.subtotal)} />
                </Field>
                <Field label={t('home.deliveryFee')}>
                  <Money amount={num(live.pricing?.deliveryFee)} />
                </Field>
                {/* Shown only when there was one, with the code beside it: an
                    operator asked "why is this cheaper than the menu" needs the
                    answer on the same screen. */}
                {num(live.pricing?.discount) > 0 && (
                  <Field label={t('cart.discount')}>
                    <span>
                      −<Money amount={num(live.pricing?.discount)} />
                      {live.coupon?.code ? (
                        <span className="ml-1 font-mono text-xs text-ink-500">
                          {live.coupon.code}
                        </span>
                      ) : null}
                    </span>
                  </Field>
                )}
                <Field label={t('cart.total')}>
                  <Money amount={num(live.pricing?.total)} className="text-base font-semibold" />
                </Field>
              </div>

              {/* What the customer wrote for the kitchen. */}
              {live.customerNote && (
                <p className="mt-3 rounded-xl bg-subtle px-3 py-2 text-sm italic text-ink-700">
                  {live.customerNote}
                </p>
              )}
            </Card>

            {/* A delivery that went out and came back. The reason is the whole
                point of the record: a bad address can be corrected and the food
                sent again, and this is where an operator reads what happened. */}
            {live.deliveryFailure && (
              <Card className="p-4">
                <h3 className="mb-2 text-sm font-semibold text-danger">
                  {t('order.status.DELIVERY_FAILED')}
                </h3>
                <Field label={t('complaintPanel.reason')}>
                  {t(`deliveryFailure.${live.deliveryFailure.reason}`)}
                </Field>
                {live.deliveryFailure.note && (
                  <Field label={t('complaintPanel.detail')}>{live.deliveryFailure.note}</Field>
                )}
                <Field label={t('admin.placedAt')}>{when(live.deliveryFailure.at)}</Field>
              </Card>
            )}

            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink-900">{t('admin.timeline')}</h3>
              <OrderTimeline order={live} />
            </Card>

            {/* The same block, worded the same way, as the restaurant's panel,
                the admin's list and the courier's screen. */}
            <CancellationNote cancellation={live.cancellation} />
          </div>
        )}
      </Drawer>

      <ForceCancelDialog
        order={cancelling}
        onClose={() => setCancelling(null)}
        onCancelled={() => setOpen(null)}
      />
    </>
  );
}
