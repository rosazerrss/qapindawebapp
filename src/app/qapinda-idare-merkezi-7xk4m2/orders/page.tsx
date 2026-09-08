'use client';

/**
 * Every order across the platform — the screen support sits on.
 *
 * Two things make it usable rather than merely complete:
 *
 *  - **Live.** Active orders arrive by subscription, so a support agent on the
 *    phone with a customer is looking at the same second the kitchen is.
 *  - **One row, one order, one click.** The row carries what you need to decide
 *    whether to open it; the drawer carries everything else, including the
 *    timeline that answers "where did this stall".
 *
 * The force-cancel is the only way an operator touches an order. It demands a
 * written reason, and that reason goes into the audit log under their name.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Ban, Phone } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import {
  DataTable,
  Drawer,
  Field,
  PageHeader,
  SearchInput,
  StatusBadge,
  Tabs,
  Toolbar,
  type Column,
} from '@/components/panel/ui';
import { ForceCancelDialog } from '@/components/panel/ForceCancelDialog';
import { OrderTimeline } from '@/components/panel/OrderTimeline';
import { orderTone, paymentTone, when } from '@/components/panel/status';
import { CancellationLine, CancellationNote } from '@/components/panel/CancellationNote';
import { Alert, Badge, Button, Card, Loading, Money } from '@/components/ui';
import { useT } from '@/i18n';
import { firestore } from '@/firebase/client';
import { list, matches, num } from '@/lib/stored';
import { COLLECTIONS } from '@/shared/collections';
import { ACTIVE_ORDER_STATUSES, FAILED_ORDER_STATUSES, OrderStatus } from '@/shared/enums';
import { isTerminal } from '@/shared/orderState';
import type { Order } from '@/shared/models';
import { formatPhone } from '@/shared/phone';

type Tab = 'active' | 'placed' | 'kitchen' | 'delivery' | 'done' | 'failed' | 'all';

const TAB_FILTER: Record<Tab, (order: Order) => boolean> = {
  active: (order) => !isTerminal(order.status),
  placed: (order) => order.status === OrderStatus.PLACED,
  kitchen: (order) =>
    order.status === OrderStatus.ACCEPTED || order.status === OrderStatus.PREPARING,
  delivery: (order) =>
    order.status === OrderStatus.READY || order.status === OrderStatus.OUT_FOR_DELIVERY,
  done: (order) =>
    order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLETED,
  /*
   * Everything that ended without the customer being fed — read from the
   * shared list rather than spelled out here.
   *
   * The three statuses this used to name left out the one an operator is most
   * often asked about: a delivery the courier could not complete. It was in
   * neither this tab nor "tamamlandı", so an admin looking for it found
   * nothing, and the only way to see it at all was the unfiltered "hamısı".
   */
  failed: (order) => FAILED_ORDER_STATUSES.includes(order.status),
  all: () => true,
};

/**
 * `useSearchParams` must sit under a Suspense boundary — the palette hands the
 * search term over in the URL, and without this the whole route would opt out
 * of static rendering.
 */
export default function AdminOrdersRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminOrdersPage />
    </Suspense>
  );
}

function AdminOrdersPage() {
  const t = useT();
  const params = useSearchParams();

  const [tab, setTab] = useState<Tab>('active');
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [orders, setOrders] = useState<Order[] | null>(null);
  // A refused or dropped subscription has to say so. Setting the list to empty
  // and saying nothing tells a support agent the platform is quiet, which is
  // the worst possible lie to tell somebody on the phone with a customer.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);

  // Active orders are a small live set; history is a capped recent window.
  // Loading "everything" would be a lie on a busy platform anyway.
  const live = tab === 'active' || tab === 'placed' || tab === 'kitchen' || tab === 'delivery';

  useEffect(() => {
    const db = firestore();
    if (!db) return;

    const base = collection(db, COLLECTIONS.orders);
    const built = live
      ? query(
          base,
          where('status', 'in', ACTIVE_ORDER_STATUSES),
          orderBy('placedAt', 'desc'),
          limit(200),
        )
      : query(base, orderBy('placedAt', 'desc'), limit(300));

    return onSnapshot(
      built,
      (snapshot) => {
        setOrders(snapshot.docs.map((entry) => entry.data() as Order));
        setLoadError(null);
      },
      () => {
        setOrders([]);
        setLoadError(t('errors.LIST_UNAVAILABLE'));
      },
    );
  }, [live, t]);

  const counts = useMemo(() => {
    const all = orders ?? [];
    return {
      active: all.filter(TAB_FILTER.active).length,
      placed: all.filter(TAB_FILTER.placed).length,
      kitchen: all.filter(TAB_FILTER.kitchen).length,
      delivery: all.filter(TAB_FILTER.delivery).length,
    } as Partial<Record<Tab, number>>;
  }, [orders]);

  const rows = useMemo(() => {
    if (!orders) return null;
    const needle = term.trim().toLowerCase();

    // Every field defensively: an order written before a rename is still an
    // order the desk has to be able to find, and a missing name must not throw
    // inside the filter and take the whole table down with it.
    return orders
      .filter(TAB_FILTER[tab])
      .filter((order) =>
        matches(
          needle,
          order.code,
          order.customerName,
          order.customerPhone,
          order.restaurantName,
        ),
      );
  }, [orders, tab, term]);

  const columns: Column<Order>[] = [
    {
      key: 'code',
      header: t('admin.orderId'),
      width: '120px',
      cell: (order) => <span className="font-mono font-semibold text-ink-900">{order.code}</span>,
      sortValue: (order) => order.code,
    },
    {
      key: 'customer',
      header: t('admin.customer'),
      cell: (order) => (
        <span className="block">
          <span className="block text-ink-900">{order.customerName}</span>
          <span className="block text-xs text-ink-400">{formatPhone(order.customerPhone)}</span>
        </span>
      ),
      sortValue: (order) => order.customerName,
    },
    {
      key: 'restaurant',
      header: t('nav.restaurants'),
      cell: (order) => order.restaurantName,
      sortValue: (order) => order.restaurantName,
    },
    {
      key: 'payment',
      header: t('admin.payment'),
      cell: (order) => (
        <span className="block">
          <span className="block text-ink-700">{t(`checkout.${order.paymentMethod}`)}</span>
          <span className="block text-xs text-ink-400">
            {t(`payment.${order.paymentStatus}`)}
          </span>
        </span>
      ),
    },
    {
      key: 'total',
      header: t('cart.total'),
      align: 'right',
      cell: (order) => <Money amount={num(order.pricing?.total)} className="font-medium" />,
      sortValue: (order) => num(order.pricing?.total),
    },
    {
      key: 'status',
      header: t('admin.status'),
      cell: (order) => (
        <>
          <StatusBadge tone={orderTone(order.status)}>
            {t(`order.status.${order.status}`)}
          </StatusBadge>
          <CancellationLine cancellation={order.cancellation} />
        </>
      ),
      sortValue: (order) => order.status,
    },
    {
      key: 'placed',
      header: t('admin.placedAt'),
      align: 'right',
      cell: (order) => <span className="text-xs text-ink-500">{when(order.placedAt)}</span>,
      sortValue: (order) => order.placedAt?.toMillis?.() ?? 0,
    },
  ];

  return (
    <PanelShell kind="admin">
      <PageHeader title={t('nav.orders')} subtitle={t('admin.ordersSubtitle')} />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        counts={counts}
        options={[
          { value: 'active', label: t('order.active') },
          { value: 'placed', label: t('restaurantPanel.newOrders') },
          { value: 'kitchen', label: t('restaurantPanel.inProgress') },
          { value: 'delivery', label: t('restaurantPanel.onTheWay') },
          { value: 'done', label: t('admin.tabDone') },
          { value: 'failed', label: t('admin.tabFailed') },
          { value: 'all', label: t('common.all') },
        ]}
      />

      <Toolbar>
        <SearchInput value={term} onChange={setTerm} placeholder={t('search.hintOrders')} />
      </Toolbar>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(order) => order.id}
        onRowClick={setOpen}
        error={loadError}
        emptyTitle={t('admin.noOrders')}
        emptyHint={t('admin.noOrdersHint')}
      />

      {/* --- Detail ---------------------------------------------------- */}
      <Drawer
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open?.code ?? ''}
        subtitle={open ? `${open.restaurantName} · ${when(open.placedAt)}` : undefined}
        footer={
          open && !isTerminal(open.status) ? (
            <Button variant="danger" fullWidth onClick={() => setCancelling(open)}>
              <Ban size={16} /> {t('order.cancel')}
            </Button>
          ) : undefined
        }
      >
        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={orderTone(open.status)}>
                {t(`order.status.${open.status}`)}
              </StatusBadge>
              <StatusBadge tone={paymentTone(open.paymentStatus)}>
                {t(`payment.${open.paymentStatus}`)}
              </StatusBadge>
              <Badge tone="neutral">{t(`checkout.${open.paymentMethod}`)}</Badge>
            </div>

            <Card className="px-4 py-2">
              <Field label={t('admin.customer')}>{open.customerName}</Field>
              <Field label={t('auth.phone')}>
                <a href={`tel:${open.customerPhone}`} className="inline-flex items-center gap-1.5 text-brand-600 underline">
                  <Phone size={13} /> {formatPhone(open.customerPhone)}
                </a>
              </Field>
              {open.address && (
                <Field label={t('account.addressLine')}>
                  <span className="whitespace-pre-line">{open.address.line}</span>
                </Field>
              )}
              {/* Who is carrying it, and whether they have answered. Assignment
                  is the restaurant's decision and acceptance is the driver's,
                  and the gap between the two is the only thing that tells the
                  desk a delivery is sitting on a phone nobody has picked up.
                  A name and a state — there is no courier conversation to open,
                  because a courier has no chat. */}
              {open.courier && (
                <Field label={t('admin.courier')}>
                  {open.courier.name}
                  <span className="ml-1.5 text-xs text-ink-400">
                    {open.courier.acceptedAt
                      ? `· ${t('admin.courierAccepted')} ${when(open.courier.acceptedAt)}`
                      : `· ${t('admin.courierNotAccepted')}`}
                  </span>
                </Field>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink-900">{t('order.items')}</h3>
              <ul className="space-y-2">
                {list<(typeof open.items)[number]>(open.items).map((item, index) => (
                  <li key={`${item.productId}-${index}`} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-ink-900">{item.quantity}×</span> {item.name}
                      {list<{ optionName: string }>(item.modifiers).length > 0 && (
                        <span className="block pl-5 text-xs text-ink-400">
                          {list<{ optionName: string }>(item.modifiers)
                            .map((modifier) => modifier.optionName)
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                    <Money amount={num(item.lineTotal)} className="shrink-0 text-ink-700" />
                  </li>
                ))}
              </ul>

              <div className="mt-3 border-t border-card-edge pt-3">
                <Field label={t('cart.subtotal')}>
                  <Money amount={num(open.pricing?.subtotal)} />
                </Field>
                <Field label={t('home.deliveryFee')}>
                  <Money amount={num(open.pricing?.deliveryFee)} />
                </Field>
                {num(open.pricing?.discount) > 0 && (
                  <Field label={t('cart.discount')}>
                    −<Money amount={num(open.pricing?.discount)} />
                  </Field>
                )}
                <Field label={t('cart.total')}>
                  <Money amount={num(open.pricing?.total)} className="text-base font-semibold" />
                </Field>
              </div>
            </Card>

            {open.customerNote && (
              <Alert tone="warning">{open.customerNote}</Alert>
            )}

            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink-900">{t('admin.timeline')}</h3>
              <OrderTimeline order={open} />
            </Card>

            {/* `by` used to be printed as the stored enum — "PLATFORM" — which
                is a value, not a word. It is translated now, here and in the
                three other panels, by the one component that renders it. */}
            <CancellationNote cancellation={open.cancellation} />
          </div>
        )}
      </Drawer>

      <ForceCancelDialog
        order={cancelling}
        onClose={() => setCancelling(null)}
        onCancelled={() => setOpen(null)}
      />
    </PanelShell>
  );
}
