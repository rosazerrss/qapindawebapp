'use client';

/**
 * The order queue — the screen a restaurant actually keeps open all evening.
 *
 * It is live, and the countdown on a new order is real: when it runs out the
 * scheduled job expires the order, so a ticking clock is not decoration.
 *
 * Two tabs, because the board and the archive are different jobs. The board is
 * for the next five minutes and wants big cards and buttons; the history is for
 * "what did we do on Friday" and wants a table you can sort. Nothing moves an
 * order between them by hand — a delivered order simply stops being active.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import Link from 'next/link';
import { LifeBuoy, Printer } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import {
  DataTable,
  Drawer,
  Field,
  StatusBadge,
  Tabs,
  type Column,
} from '@/components/panel/ui';
import { orderAccentClass, orderTone, when } from '@/components/panel/status';
import { CancellationNote } from '@/components/panel/CancellationNote';
import { useReceiptPrinter } from '@/components/restaurant/Receipt';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Loading,
  Money,
  Select,
  Sheet,
  Textarea,
  cn,
} from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import { assignCourier, setServiceState, updateOrderStatus } from '@/firebase/callables';
import { getRestaurant, watchRestaurantOrders } from '@/services/catalog';
import { normaliseStations, type PrintStation } from '@/shared/printStations';
import { firestore } from '@/firebase/client';
import { COLLECTIONS } from '@/shared/collections';
import { nextStatusesFor } from '@/shared/orderState';
import {
  OrderCommissionState,
  formatBps,
  orderCommission,
} from '@/shared/pricing';
import {
  ACTIVE_ORDER_STATUSES,
  PAST_ORDER_STATUSES,
  CancellationReason,
  OrderActor,
  OrderStatus,
  ServiceState,
  UserRole,
} from '@/shared/enums';
import { formatPhone } from '@/shared/phone';
import type { Order, Restaurant, User } from '@/shared/models';
import { DeliveryHandover } from '@/components/restaurant/DeliveryHandover';

const REJECT_REASONS = [
  CancellationReason.RESTAURANT_TOO_BUSY,
  CancellationReason.ITEM_UNAVAILABLE,
  CancellationReason.ADDRESS_OUT_OF_RANGE,
  CancellationReason.RESTAURANT_CLOSED,
  CancellationReason.OTHER,
];

/**
 * The grace period `settleDeliveredOrders` waits before turning a delivered
 * order into a commission entry — `DEFAULT_AUTO_COMPLETE_MINUTES` in
 * `functions/src/orders/jobs.ts`.
 *
 * The platform can override it per deployment through `autoCompleteAfterMinutes`
 * in the public settings, which is why the sentence on screen says "about" and
 * not "exactly": promising a number the operator can change would be a lie the
 * owner would eventually catch.
 */
const AUTO_COMPLETE_MINUTES = 60;

/**
 * How much the restaurant has to write before it may turn an order down.
 *
 * The customer reads this sentence — it is the only explanation they get for a
 * meal that is not coming — so "yox" is not an answer. Five characters is a low
 * bar deliberately: it stops an empty box and a stray keystroke, not a terse
 * kitchen in the middle of a rush.
 */
/**
 * The pause lengths offered.
 *
 * Three, because a list of eight is a decision instead of a tap — and these are
 * pressed by somebody holding a pan. Fifteen covers a backlog, thirty a delivery
 * that has not arrived, an hour a staffing problem.
 */
const PAUSE_CHOICES = [15, 30, 60];

/**
 * Cooking times offered on acceptance.
 *
 * Four, spanning what a kitchen actually answers: a wrap in fifteen, a grill in
 * twenty-five, a full table in forty. Anything else is the profile's own
 * estimate, reached by pressing "Qəbul et" without choosing.
 */
const PREP_CHOICES = [15, 25, 40, 60];

const REJECT_NOTE_MIN = 5;

function format(remaining: number): string {
  if (remaining <= 0) return '0:00';
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Minutes and seconds left before the response window closes.
 *
 * The clock is read inside the interval, never during render — rendering must
 * be a pure function of state, and `Date.now()` is not.
 */
function useCountdown(deadline: { toMillis?: () => number } | null | undefined): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const at = deadline?.toMillis?.();
    if (at === undefined) return;

    const timer = setInterval(() => setLabel(format(at - Date.now())), 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  // Derived rather than cleared in the effect: with no deadline there is no
  // countdown, whatever the last order on this card happened to show.
  return deadline?.toMillis ? label : null;
}

/**
 * How long the order queue may stay silent before the panel says so.
 *
 * Eight seconds: long enough that a slow connection is not called broken,
 * short enough that a kitchen is not left staring at a lie.
 */
const ORDERS_TIMEOUT_MS = 8000;

export default function RestaurantOrdersPage() {
  const t = useT();
  const { restaurantId } = useAuth();

  const [tab, setTab] = useState<'active' | 'past'>('active');
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [couriers, setCouriers] = useState<User[]>([]);
  const [rejecting, setRejecting] = useState<Order | null>(null);
  /** True while the "how long?" sheet is open. */
  const [pausing, setPausing] = useState(false);
  const [reason, setReason] = useState<string>(CancellationReason.RESTAURANT_TOO_BUSY);
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { print: printSlips, portal: receiptPortal } = useReceiptPrinter();

  /**
   * The slips this restaurant prints, and which of them print by themselves.
   *
   * Read from the restaurant document so a change in Ayarlar takes effect
   * without a reload. `normaliseStations` turns an absent field into an empty
   * list, and an empty list makes `useReceiptPrinter` print the single whole
   * receipt it printed before stations existed — a restaurant that has
   * configured nothing must not stop getting paper.
   */
  const stations = useMemo(() => normaliseStations(restaurant?.printStations), [restaurant]);

  /** Every station, for the button somebody presses by hand. */
  const printReceipt = useCallback(
    (order: Order) => printSlips(order, stations),
    [printSlips, stations],
  );

  /*
   * WHETHER THE QUEUE IS EMPTY, OR WHETHER WE JUST CANNOT SEE IT.
   *
   * This is the most dangerous instance of the missing-timeout bug in the whole
   * app. `onSnapshot` never fires on a dropped connection, `orders` stays null,
   * and the screen rendered a spinner — or, worse, the moment one empty answer
   * had arrived, "no active orders". A kitchen tablet on a hotel wifi shows an
   * empty queue while orders arrive on the server and nobody cooks them.
   *
   * So a connection that has not answered in eight seconds says so, loudly,
   * with a way to retry. An empty queue and an unreachable one must never look
   * the same on this screen.
   */
  const [ordersFailedKey, setOrdersFailedKey] = useState<string | null>(null);
  const [ordersAttempt, setOrdersAttempt] = useState(0);
  const ordersKey = `${restaurantId ?? ''}:${ordersAttempt}`;
  const ordersFailed = ordersFailedKey === ordersKey;

  useEffect(() => {
    if (!restaurantId) return;
    getRestaurant(restaurantId).then(setRestaurant);

    const timer = setTimeout(() => setOrdersFailedKey(ordersKey), ORDERS_TIMEOUT_MS);

    const stop = watchRestaurantOrders(restaurantId, ACTIVE_ORDER_STATUSES, (list) => {
      clearTimeout(timer);
      setOrders(list);
    });

    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [restaurantId, ordersAttempt, ordersKey]);

  // The team screen (`/panel/staff`) is where a courier is hired;
  // this only reads the same collection to fill the "who delivers this"
  // picker, filtered down to the role that can actually be assigned.
  useEffect(() => {
    const db = firestore();
    if (!db || !restaurantId) return;

    return onSnapshot(
      query(collection(db, COLLECTIONS.users), where('restaurantId', '==', restaurantId)),
      (snapshot) =>
        setCouriers(
          snapshot.docs
            .map((entry) => entry.data() as User)
            .filter((member) => member.role === UserRole.RESTAURANT_COURIER),
        ),
      () => setCouriers([]),
    );
  }, [restaurantId]);

  const advance = useCallback(
    async (order: Order, status: OrderStatus, note?: string, prepMinutes?: number) => {
      setBusy(order.id);
      setError(null);

      const result = await updateOrderStatus({
        orderId: order.id,
        status,
        note: note ?? null,
        reason: status === OrderStatus.REJECTED ? reason : null,
        // Only ever sent with an acceptance; the server ignores it otherwise.
        prepMinutes: status === OrderStatus.ACCEPTED ? (prepMinutes ?? null) : null,
      });

      setBusy(null);
      if (!result.ok) {
        setError(translateError(t, result.errorCode, result.errorDetail));
        return;
      }

      setRejecting(null);

      /*
       * Accepting is the moment the kitchen starts on the food, so it is the
       * moment the paper has to exist — printing it later means somebody has to
       * remember to. Only on acceptance: no other transition produces paper.
       *
       * Which slips depends on the stations. A restaurant that has ticked
       * "avtomatik çap" on its kitchen station and not on its counter one gets
       * the cook's ticket now and prints the customer's receipt when the bag is
       * packed — which is the actual working pattern in a kitchen.
       *
       * With no stations configured at all, `auto` is empty and `printSlips`
       * falls back to the single whole receipt, exactly as before.
       */
      if (status === OrderStatus.ACCEPTED) {
        const auto = stations.filter((station: PrintStation) => station.autoPrint);
        if (stations.length === 0 || auto.length > 0) printSlips(order, auto);
      }
    },
    [reason, t, printSlips, stations],
  );

  // Reopening the sheet must not carry the last refusal's words into the next
  // one — a customer receiving somebody else's explanation is worse than none.
  const openReject = (order: Order) => {
    setReason(CancellationReason.RESTAURANT_TOO_BUSY);
    setRejectNote('');
    setRejecting(order);
  };

  const rejectNoteReady = rejectNote.trim().length >= REJECT_NOTE_MIN;

  /*
   * Pausing asks how long; opening and closing do not.
   *
   * "Busy" without an end is how a kitchen loses an evening: it pauses for the
   * ten minutes it takes to clear a backlog and nobody presses the button
   * again. So PAUSED opens a short menu of durations, the shop comes back by
   * itself, and "until I say otherwise" is still there for the oven that broke.
   */
  const toggleService = async (next: ServiceState, pauseMinutes?: number | null) => {
    if (!restaurantId) return;

    if (next === ServiceState.PAUSED && pauseMinutes === undefined) {
      setPausing(true);
      return;
    }

    setPausing(false);
    const result = await setServiceState(restaurantId, next, pauseMinutes ?? null);

    if (result.ok) {
      setRestaurant((current) =>
        current ? { ...current, serviceState: next, pausedMinutes: pauseMinutes ?? null } : current,
      );
    }
  };

  const newOrders = (orders ?? []).filter((order) => order.status === OrderStatus.PLACED);
  // Typed arrays, so `includes` narrows against OrderStatus rather than a
  // literal union of the two members written inline.
  const COOKING: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.PREPARING];
  const OUTBOUND: OrderStatus[] = [OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY];

  const cooking = (orders ?? []).filter((order) => COOKING.includes(order.status));
  const outbound = (orders ?? []).filter((order) => OUTBOUND.includes(order.status));

  return (
    <PanelShell
      kind="restaurant"
      actions={
        restaurant && (
          <div className="flex gap-1 rounded-lg bg-ink-100 p-1">
            {[ServiceState.OPEN, ServiceState.PAUSED, ServiceState.CLOSED].map((state) => (
              <button
                key={state}
                onClick={() => void toggleService(state)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition',
                  // Colour carries meaning here on purpose — green open, red
                  // closed, grey paused — but never alone: the word is written
                  // on the button, and only the selected one is filled in.
                  restaurant.serviceState === state
                    ? state === ServiceState.OPEN
                      ? 'bg-success text-white'
                      : state === ServiceState.CLOSED
                        ? 'bg-danger text-white'
                        : 'bg-ink-400 text-white'
                    : 'text-ink-500 hover:text-ink-800',
                )}
              >
                {t(
                  state === ServiceState.OPEN
                    ? 'restaurantPanel.open'
                    : state === ServiceState.PAUSED
                      ? 'restaurantPanel.paused'
                      : 'restaurantPanel.closed',
                )}
              </button>
            ))}
          </div>
        )
      }
    >
      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <Tabs<'active' | 'past'>
        value={tab}
        onChange={setTab}
        counts={{ active: orders?.length }}
        options={[
          { value: 'active', label: t('order.activeOrders') },
          { value: 'past', label: t('order.pastOrders') },
        ]}
      />

      {tab === 'past' ? (
        <PastOrders restaurantId={restaurantId ?? null} onPrint={printReceipt} />
      ) : ordersFailed ? (
        <Alert tone="danger">
          <span className="block font-semibold">{t('restaurantPanel.queueOffline')}</span>
          <span className="mt-1 block">{t('restaurantPanel.queueOfflineBody')}</span>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => setOrdersAttempt((value) => value + 1)}
          >
            {t('common.retry')}
          </Button>
        </Alert>
      ) : orders === null ? (
        <Loading />
      ) : orders.length === 0 ? (
        <EmptyState title={t('restaurantPanel.noActiveOrders')} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Column title={t('restaurantPanel.newOrders')} count={newOrders.length} highlight>
            {newOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                busy={busy === order.id}
                onAdvance={advance}
                onPrint={printReceipt}
                onReject={() => openReject(order)}
                onDelivered={() => setError(null)}
              />
            ))}
          </Column>

          <Column title={t('restaurantPanel.inProgress')} count={cooking.length}>
            {cooking.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                busy={busy === order.id}
                onAdvance={advance}
                onPrint={printReceipt}
                onDelivered={() => setError(null)}
              />
            ))}
          </Column>

          <Column title={t('restaurantPanel.onTheWay')} count={outbound.length}>
            {outbound.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                busy={busy === order.id}
                onAdvance={advance}
                onPrint={printReceipt}
                onDelivered={() => setError(null)}
                couriers={couriers}
              />
            ))}
          </Column>
        </div>
      )}

      <Sheet
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title={t('restaurantPanel.reject')}
        footer={
          <Button
            variant="danger"
            fullWidth
            loading={busy === rejecting?.id}
            // The server stores whatever arrives here on `order.cancellation`
            // and the customer's order page prints it back, so an unwritten
            // explanation cannot be allowed to leave this button.
            disabled={!rejectNoteReady}
            onClick={() => rejecting && advance(rejecting, OrderStatus.REJECTED, rejectNote.trim())}
          >
            {t('restaurantPanel.reject')}
          </Button>
        }
      >
        <Select
          label={t('order.cancelReason')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        >
          {REJECT_REASONS.map((option) => (
            <option key={option} value={option}>
              {t(`order.reason.${option}`)}
            </option>
          ))}
        </Select>

        <div className="mt-4">
          <Textarea
            label={t('restaurantPanel.rejectNoteLabel')}
            placeholder={t('restaurantPanel.rejectNotePlaceholder')}
            value={rejectNote}
            onChange={(event) => setRejectNote(event.target.value)}
            maxLength={300}
            hint={t('restaurantPanel.rejectNoteHint')}
          />
        </div>

        <div className="mt-3">
          <Alert tone="warning">{t('restaurantPanel.rejectSeenByCustomer')}</Alert>
        </div>

        {!rejectNoteReady && (
          <p className="mt-3 text-sm text-danger">
            {t('restaurantPanel.rejectNoteTooShort', { count: REJECT_NOTE_MIN })}
          </p>
        )}
      </Sheet>

      {/* --- How long is this pause? ------------------------------------ */}
      <Sheet
        open={pausing}
        onClose={() => setPausing(false)}
        title={t('restaurantPanel.pauseHowLong')}
      >
        <p className="mb-4 text-sm text-ink-600">{t('restaurantPanel.pauseHint')}</p>

        <div className="space-y-2">
          {PAUSE_CHOICES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => void toggleService(ServiceState.PAUSED, minutes)}
              className="flex h-13 w-full items-center justify-between rounded-2xl border border-card-edge bg-surface px-4 text-base font-medium text-ink-800 transition hover:bg-ink-50"
            >
              <span>{t('restaurantPanel.pauseMinutes', { count: minutes })}</span>
              <span className="text-sm text-ink-400">{t('restaurantPanel.pauseAuto')}</span>
            </button>
          ))}

          {/* The oven that broke. Nothing re-opens this one. */}
          <button
            type="button"
            onClick={() => void toggleService(ServiceState.PAUSED, null)}
            className="flex h-13 w-full items-center justify-between rounded-2xl border border-card-edge bg-surface px-4 text-base font-medium text-ink-800 transition hover:bg-ink-50"
          >
            <span>{t('restaurantPanel.pauseIndefinite')}</span>
            <span className="text-sm text-ink-400">{t('restaurantPanel.pauseManual')}</span>
          </button>
        </div>
      </Sheet>

      {receiptPortal}
    </PanelShell>
  );
}

/**
 * The moment the order stopped: delivered, completed, or called off.
 *
 * `completedAt` is preferred over `deliveredAt` for a settled order because it
 * is the later of the two, and the column is asking "when did this end".
 */
/**
 * The commission block on one order, for the restaurant's own eyes.
 *
 * "RESTORANLAR ÖZLƏRİ NƏ QƏDƏR KOMİSSİYA ÖDƏYİR GÖRMƏLİDİR — TAM ŞƏFFAF."
 * A monthly figure is a claim; this is the working behind it. Everything on
 * screen comes from `orderCommission` in the shared money code, which is the
 * same function the settlement screen and the platform's own reports use, so
 * there is no arithmetic here that could disagree with the invoice.
 *
 * A cancelled order is shown as costing nothing rather than hidden: an owner
 * scanning for "what did I pay on this one" needs an answer for every row, and
 * an absent row is a question.
 */
function OrderCommissionLines({ order }: { order: Order }) {
  const t = useT();
  const money = orderCommission(order);

  if (money.state === OrderCommissionState.NONE) {
    return (
      <div className="mt-3 border-t border-card-edge pt-3">
        <Field label={t('settlement.commission')}>
          <span className="text-ink-500">{t('settlement.commissionNoneOnOrder')}</span>
        </Field>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-card-edge pt-3">
      <Field label={t('settlement.commissionRate')}>{formatBps(money.rateBps)}</Field>
      <Field label={t('settlement.commissionBase')}>
        <Money amount={money.base} />
      </Field>
      <Field label={t('settlement.commission')}>
        <Money amount={money.amount} className="font-semibold" />
      </Field>
      {money.platformFundedDiscount > 0 && (
        <>
          <Field label={t('settlement.platformDiscounts')}>
            −<Money amount={money.platformFundedDiscount} />
          </Field>
          <Field label={t('settlement.commissionNet')}>
            <Money amount={money.netDue} className="font-semibold" />
          </Field>
        </>
      )}
      <p className="mt-1 text-xs text-ink-400">
        {money.state === OrderCommissionState.EXPECTED
          ? t('settlement.commissionExpectedHint')
          : t('settlement.commissionChargedHint')}
      </p>
    </div>
  );
}

function endedAt(order: Order): { toMillis?: () => number } | null {
  return order.completedAt ?? order.deliveredAt ?? order.cancellation?.at ?? order.updatedAt ?? null;
}

/**
 * Everything that has already happened.
 *
 * It carries its own subscription rather than widening the board's, so a
 * restaurant that never opens this tab never pays for the reads — and the
 * board's query stays the small live set it is tuned to be.
 */
function PastOrders({
  restaurantId,
  onPrint,
}: {
  restaurantId: string | null;
  onPrint: (order: Order) => void;
}) {
  const t = useT();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [detail, setDetail] = useState<Order | null>(null);

  useEffect(() => {
    if (!restaurantId) return;
    return watchRestaurantOrders(restaurantId, PAST_ORDER_STATUSES, setOrders);
  }, [restaurantId]);

  const columns: Column<Order>[] = [
    {
      key: 'code',
      header: t('admin.orderId'),
      width: '110px',
      cell: (order) => <span className="font-mono font-semibold text-ink-900">{order.code}</span>,
      sortValue: (order) => order.code,
    },
    {
      key: 'customer',
      header: t('admin.customer'),
      cell: (order) => order.customerName,
      sortValue: (order) => order.customerName,
    },
    {
      key: 'items',
      header: t('order.items'),
      align: 'right',
      cell: (order) => order.items.reduce((sum, item) => sum + item.quantity, 0),
      sortValue: (order) => order.items.reduce((sum, item) => sum + item.quantity, 0),
    },
    {
      key: 'total',
      header: t('cart.total'),
      align: 'right',
      cell: (order) => <Money amount={order.pricing.total} className="font-medium" />,
      sortValue: (order) => order.pricing.total,
    },
    {
      /*
       * What this order cost the restaurant.
       *
       * The owner asked to be able to answer "why is this month 200 manat"
       * order by order rather than from one total, so the figure is in the
       * table itself and not only behind a click. A cancelled order reads as a
       * dash: it was never charged, and printing a zero next to a number looks
       * like a number somebody could argue with.
       */
      key: 'commission',
      header: t('settlement.commission'),
      align: 'right',
      cell: (order) => {
        const money = orderCommission(order);
        if (money.state === OrderCommissionState.NONE) {
          return <span className="text-ink-300">—</span>;
        }
        return (
          <span className="whitespace-nowrap">
            <Money amount={money.amount} className="text-ink-700" />
            {money.state === OrderCommissionState.EXPECTED && (
              <span className="ml-1.5 text-xs text-ink-400">{t('settlement.commissionPending')}</span>
            )}
          </span>
        );
      },
      sortValue: (order) => orderCommission(order).amount,
    },
    {
      key: 'status',
      header: t('admin.status'),
      cell: (order) => (
        <div className="space-y-1">
          <StatusBadge tone={orderTone(order.status)}>
            {t(`order.status.${order.status}`)}
          </StatusBadge>
          {/* A refused order without its reason is the row an owner has to open
              to understand, and this table exists to be scanned. The badge is
              already danger-toned; the words are what make it readable. */}
          {order.cancellation && (
            <p className="max-w-56 truncate text-xs text-danger">
              {t(`order.reason.${order.cancellation.reason}`)}
              {order.cancellation.note && ` — ${order.cancellation.note}`}
            </p>
          )}
        </div>
      ),
      sortValue: (order) => order.status,
    },
    {
      key: 'ended',
      header: t('restaurantPanel.finishedAt'),
      align: 'right',
      cell: (order) => <span className="text-xs text-ink-500">{when(endedAt(order))}</span>,
      sortValue: (order) => endedAt(order)?.toMillis?.() ?? 0,
    },
    {
      key: 'print',
      header: t('receipt.print'),
      align: 'right',
      width: '140px',
      cell: (order) => (
        <Button
          variant="secondary"
          size="sm"
          // The row itself opens the drawer; without this the print button
          // would print *and* open a panel nobody asked for.
          onClick={(event) => {
            event.stopPropagation();
            onPrint(order);
          }}
        >
          <Printer size={15} />
          {t('receipt.print')}
        </Button>
      ),
    },
  ];

  return (
    <>
      {/* The one question an owner actually has about this tab is "where is my
          money", so it is answered above the table rather than in a help page. */}
      <p className="mb-4 text-sm text-ink-500">
        {t('restaurantPanel.pastMoneyNote', { minutes: AUTO_COMPLETE_MINUTES })}
      </p>

      <DataTable
        rows={orders}
        columns={columns}
        rowKey={(order) => order.id}
        onRowClick={setDetail}
        emptyTitle={t('restaurantPanel.noPastOrders')}
      />

      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.code ?? ''}
        subtitle={detail ? `${detail.customerName} · ${when(detail.placedAt)}` : undefined}
        footer={
          detail && (
            <Button variant="secondary" fullWidth onClick={() => onPrint(detail)}>
              <Printer size={16} />
              {t('receipt.print')}
            </Button>
          )
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={orderTone(detail.status)}>
                {t(`order.status.${detail.status}`)}
              </StatusBadge>
              <Badge tone="neutral">{t(`checkout.${detail.paymentMethod}`)}</Badge>
            </div>

            <Card className="px-4 py-2">
              <Field label={t('admin.customer')}>{detail.customerName}</Field>
              <Field label={t('auth.phone')}>
                <a href={`tel:${detail.customerPhone}`} className="text-brand-600 underline">
                  {/* Formatted, like every other number on every other screen.
                      The line directly beneath this one already used
                      `formatPhone`, so the same card showed one number grouped
                      and the other as a run of digits. */}
                  {formatPhone(detail.customerPhone) || detail.customerPhone}
                </a>
              </Field>
              {detail.address && (
                <Field label={t('account.addressLine')}>
                  <span className="whitespace-pre-line">{detail.address.line}</span>
                </Field>
              )}
              {/* Who the restaurant's own driver asks for, and rings. Shown
                  under the address rather than replacing the customer above:
                  both facts matter, and on most orders they are the same
                  person. */}
              {detail.address?.contactName && (
                <Field label={t('receipt.doorName')}>{detail.address.contactName}</Field>
              )}
              {detail.address?.phone && (
                <Field label={t('receipt.doorPhone')}>
                  <a href={`tel:${detail.address.phone}`} className="text-brand-600 underline">
                    {formatPhone(detail.address.phone)}
                  </a>
                </Field>
              )}
              <Field label={t('admin.placedAt')}>{when(detail.placedAt)}</Field>
              <Field label={t('restaurantPanel.finishedAt')}>{when(endedAt(detail))}</Field>
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink-900">{t('order.items')}</h3>
              <ul className="space-y-2">
                {detail.items.map((item, index) => (
                  <li
                    key={`${item.productId}-${index}`}
                    className="flex justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-ink-900">{item.quantity}×</span> {item.name}
                      {item.modifiers.length > 0 && (
                        <span className="block pl-5 text-xs text-ink-400">
                          {item.modifiers.map((modifier) => modifier.optionName).join(' · ')}
                        </span>
                      )}
                      {item.note && (
                        <span className="block pl-5 text-xs italic text-brand-600">{item.note}</span>
                      )}
                    </span>
                    <Money amount={item.lineTotal} className="shrink-0 text-ink-700" />
                  </li>
                ))}
              </ul>

              <div className="mt-3 border-t border-card-edge pt-3">
                <Field label={t('cart.subtotal')}>
                  <Money amount={detail.pricing.subtotal} />
                </Field>
                <Field label={t('home.deliveryFee')}>
                  <Money amount={detail.pricing.deliveryFee} />
                </Field>
                {detail.pricing.discount > 0 && (
                  <Field label={t('cart.discount')}>
                    −<Money amount={detail.pricing.discount} />
                  </Field>
                )}
                <Field label={t('cart.total')}>
                  <Money amount={detail.pricing.total} className="text-base font-semibold" />
                </Field>
              </div>

              {/*
                The commission on THIS order, spelled out.

                Not a total and not a percentage on its own: the rate the order
                froze at checkout, the amount it applies to, what that comes to,
                and anything Qapında funded and therefore owes back. An owner
                who can read this line for one order can add up a month for
                themselves — which is the only version of "transparent" that
                means anything.
              */}
              <OrderCommissionLines order={detail} />
            </Card>

            {detail.customerNote && <Alert tone="warning">{detail.customerNote}</Alert>}

            {/* Who cancelled it, not only why — the kitchen's first question
                about a cancelled order is whether the customer or the platform
                did it, and the panel never answered it before. */}
            <CancellationNote cancellation={detail.cancellation} />

            {/*
              A ticket about this order, opened from the order itself. The code
              travels in the link so the operator opens it already looking at
              the right one instead of asking which — the same trick the
              customer's order screen uses, for the same reason.
            */}
            <Link
              href={`/panel/support?order=${encodeURIComponent(detail.id)}&code=${encodeURIComponent(detail.code)}`}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm font-medium text-ink-800 transition hover:bg-ink-50"
            >
              <LifeBuoy size={15} aria-hidden />
              {t('support.orderProblem')}
            </Link>
          </div>
        )}
      </Drawer>
    </>
  );
}

function Column({
  title,
  count,
  highlight,
  children,
}: {
  title: string;
  count: number;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    // Each column is its own panel with its own edge. Three unbordered stacks
    // side by side on a page the same colour as the cards read as one long list
    // of everything, which is exactly what "neyin harda oldugu bilinsin" is
    // complaining about.
    <section className="rounded-2xl border border-card-edge bg-subtle p-3">
      <h2
        className={cn(
          'mb-3 flex items-center gap-2 px-1 font-medium',
          highlight && count > 0 ? 'text-brand-700' : 'text-ink-700',
        )}
      >
        {title}
        <Badge tone={highlight && count > 0 ? 'brand' : 'neutral'}>{count}</Badge>
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function OrderCard({
  order,
  busy,
  onAdvance,
  onPrint,
  onReject,
  onDelivered,
  couriers,
}: {
  order: Order;
  busy: boolean;
  onAdvance: (order: Order, status: OrderStatus, note?: string, prepMinutes?: number) => void;
  onPrint: (order: Order) => void;
  onReject?: () => void;
  /** Called after the handover form moves the order on its own. */
  onDelivered: () => void;
  /** Only passed for READY/OUT_FOR_DELIVERY orders — the two statuses a courier may be assigned on. */
  couriers?: User[];
}) {
  const t = useT();
  const countdown = useCountdown(order.responseDeadlineAt);

  // The buttons come from the shared state machine, so the panel can never
  // offer a step the server would then refuse.
  // On the road: "Delivered" is the ordinary next step, and "could not deliver"
  // sits under it as the other ending.
  const handingOver = order.status === OrderStatus.OUT_FOR_DELIVERY;

  // DELIVERY_FAILED is not offered among the plain steps — it has its own
  // control, because it demands a reason and cannot be undone.
  const options = nextStatusesFor(order.status, OrderActor.RESTAURANT).filter(
    (status) =>
      status !== OrderStatus.REJECTED &&
      status !== OrderStatus.CANCELLED &&
      status !== OrderStatus.DELIVERY_FAILED,
  );

  // The time question belongs on the one card where accepting is the decision.
  const accepting = options.includes(OrderStatus.ACCEPTED);

  const labels: Partial<Record<OrderStatus, string>> = {
    [OrderStatus.ACCEPTED]: t('restaurantPanel.accept'),
    [OrderStatus.PREPARING]: t('restaurantPanel.startPreparing'),
    [OrderStatus.READY]: t('restaurantPanel.markReady'),
    [OrderStatus.OUT_FOR_DELIVERY]: t('restaurantPanel.handToDriver'),
    [OrderStatus.DELIVERED]: t('restaurantPanel.markDelivered'),
  };

  return (
    // The status stripe: which of the three columns an order is in says a lot,
    // but a rejected or cancelled one sitting among live orders has to be
    // findable without reading every card.
    <Card className={cn('p-4', orderAccentClass(order.status))}>
      <div className="flex items-baseline justify-between">
        <span className="font-semibold text-ink-900">{order.code}</span>
        {countdown && order.status === OrderStatus.PLACED && (
          <Badge tone={countdown.startsWith('0:') ? 'danger' : 'warning'}>{countdown}</Badge>
        )}
      </div>

      <p className="mt-0.5 text-sm text-ink-500">{order.customerName}</p>
      <a href={`tel:${order.customerPhone}`} className="text-sm text-brand-600 underline">
        {formatPhone(order.customerPhone) || order.customerPhone}
      </a>

      {/*
        An order that died while it was on the board says why, on the board.
        
        A card can be cancelled underneath the kitchen — by the customer inside
        their window, or by an operator — and until now the only sign was the
        edge stripe turning red. Somebody who had already started cooking got a
        colour and no sentence, and had to find the order again in history to
        learn whether the customer changed their mind or the platform stepped in.
      */}
      {order.cancellation && (
        <CancellationNote cancellation={order.cancellation} className="mt-3 rounded-xl border border-danger/40 bg-red-50 px-3 py-2.5 text-sm text-danger" />
      )}

      <ul className="mt-3 space-y-1.5 border-t border-card-edge pt-3">
        {order.items.map((item, index) => (
          <li key={`${item.productId}-${index}`} className="text-sm">
            <span className="font-medium text-ink-900">{item.quantity}×</span> {item.name}
            {item.modifiers.length > 0 && (
              <span className="block pl-5 text-ink-500">
                {item.modifiers.map((modifier) => modifier.optionName).join(' · ')}
              </span>
            )}
            {item.note && <span className="block pl-5 italic text-brand-600">{item.note}</span>}
          </li>
        ))}
      </ul>

      {order.customerNote && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-sm text-warning">
          {order.customerNote}
        </p>
      )}

      {order.address && (
        <p className="mt-2 text-sm text-ink-500">
          {order.address.line}
          {order.address.note && ` — ${order.address.note}`}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-card-edge pt-3">
        <span className="text-sm text-ink-500">{t(`checkout.${order.paymentMethod}`)}</span>
        <span className="font-semibold text-ink-900">
          <Money amount={order.pricing.total} />
        </span>
      </div>

      {couriers && <CourierAssignment order={order} couriers={couriers} />}

      {/* Its own row above the decisions: a slip that came out crumpled or was
          lost under the counter is reprinted often, and it must never sit close
          enough to "Accept" to be hit by mistake. */}
      <div className="mt-3 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPrint(order)}
          aria-label={t('receipt.printOrder', { code: order.code })}
        >
          <Printer size={15} />
          {t('receipt.print')}
        </Button>
      </div>

      {handingOver && <DeliveryHandover orderId={order.id} onDone={onDelivered} />}

      {/*
        * ACCEPTING IS ALSO A PROMISE ABOUT TIME.
        *
        * The customer is told when their food will arrive, and this is the one
        * moment anybody knows: the kitchen is looking at the ticket. Three taps
        * rather than a form, because this is pressed with one hand between two
        * pans — and "Qəbul et" on its own is still there, using the
        * restaurant's own profile estimate, so a rush is never blocked by a
        * question.
        */}
      {accepting && (
        <div className="mt-3 rounded-2xl border border-card-edge bg-subtle p-3">
          <p className="text-sm font-medium text-ink-800">{t('restaurantPanel.prepHowLong')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PREP_CHOICES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                disabled={busy}
                onClick={() => onAdvance(order, OrderStatus.ACCEPTED, undefined, minutes)}
                className="h-10 rounded-xl border border-card-edge bg-surface px-3 text-sm font-medium text-ink-800 transition hover:bg-ink-50 disabled:opacity-60"
              >
                {t('restaurantPanel.prepMinutes', { count: minutes })}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-1 flex gap-2">
        {onReject && (
          <Button variant="secondary" size="sm" onClick={onReject} disabled={busy}>
            {t('restaurantPanel.reject')}
          </Button>
        )}
        {options.map((status) => (
          <Button
            key={status}
            size="sm"
            fullWidth
            loading={busy}
            onClick={() => onAdvance(order, status)}
          >
            {labels[status] ?? t(`order.status.${status}`)}
          </Button>
        ))}
      </div>
    </Card>
  );
}

/**
 * Who is carrying this order, or a picker to say.
 *
 * Only ever offered on READY and OUT_FOR_DELIVERY — see `assignCourier`,
 * which refuses a delivered or completed order for the same reason: past
 * that point reassigning changes nothing and only muddies who was holding it.
 */
function CourierAssignment({ order, couriers }: { order: Order; couriers: User[] }) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assign = async (courierId: string) => {
    setSaving(true);
    setError(null);

    const result = await assignCourier({ orderId: order.id, courierId: courierId || null });

    setSaving(false);
    if (!result.ok) setError(translateError(t, result.errorCode, result.errorDetail));
  };

  return (
    <div className="mt-3 border-t border-card-edge pt-3">
      {order.courier && (
        <p className="mb-1.5 text-sm font-medium text-ink-700">
          {t('restaurantPanel.courierAssigned', { name: order.courier.name })}
        </p>
      )}

      <Select
        label={t('restaurantPanel.courierLabel')}
        value={order.courier?.id ?? ''}
        disabled={saving}
        onChange={(event) => void assign(event.target.value)}
      >
        <option value="">{t('restaurantPanel.courierUnassign')}</option>
        {couriers.map((courier) => (
          <option key={courier.uid} value={courier.uid}>
            {courier.fullName}
          </option>
        ))}
      </Select>

      {couriers.length === 0 && (
        <p className="mt-1.5 text-sm text-ink-400">{t('restaurantPanel.noCouriers')}</p>
      )}

      {error && (
        <p className="mt-1.5 text-sm text-danger">{error}</p>
      )}
    </div>
  );
}
