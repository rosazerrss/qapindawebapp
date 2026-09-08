'use client';

/**
 * One finished delivery.
 *
 * A record rather than a job: order code, restaurant, when it ended, what it
 * was worth, how it was paid and how it finished. No customer phone number, no
 * map and no address note — those are the details of a delivery in progress,
 * and a closed order is not a reason to keep somebody's address on a phone that
 * changes hands.
 */

import { use } from 'react';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';

import { Card, EmptyState, Money, cn } from '@/components/ui';
import { CancellationNote } from '@/components/panel/CancellationNote';
import { PageLoading } from '@/components/ui/loading';
import { CourierShell } from '@/components/courier/CourierShell';
import {
  OrderStatusBadge,
  finishedAtOf,
  usePaymentLabel,
  useWhen,
} from '@/components/courier/OrderCards';
import { useCourierOrder } from '@/components/courier/useCourierData';
import { useT } from '@/i18n';
import { courierDeliveredWell } from '@/shared/courier';
import type { Order } from '@/shared/models';

export default function CourierPastOrderPage({ params }: PageProps<'/courier/history/[orderId]'>) {
  const { orderId } = use(params);
  const t = useT();
  const { order, failed } = useCourierOrder(orderId);

  return (
    <CourierShell title={order?.code ?? t('kuryer.historyTitle')} backHref="/courier/history">
      {failed || order === null ? (
        <EmptyState
          title={t('kuryer.orderNotFound')}
          hint={t('kuryer.orderNotFoundHint')}
          action={
            <Link
              href="/courier/history"
              className="flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-base font-semibold text-white"
            >
              {t('kuryer.backToHistory')}
            </Link>
          }
        />
      ) : order === undefined ? (
        <PageLoading label={t('common.loadingOrders')} />
      ) : (
        <PastOrder order={order} />
      )}
    </CourierShell>
  );
}

function PastOrder({ order }: { order: Order }) {
  const t = useT();
  const when = useWhen();
  const payment = usePaymentLabel(order);
  const delivered = courierDeliveredWell(order.status);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-2xl font-bold text-ink-900">{order.code}</span>
        <OrderStatusBadge order={order} />
      </div>

      <p className="mt-1 text-lg font-medium text-ink-700">{order.restaurantName}</p>

      <dl className="mt-4 space-y-3 border-t border-card-edge pt-4 text-base">
        <Line label={t('order.placedAt')} value={when(order.placedAt)} />
        <Line label={t('kuryer.finishedAt')} value={when(finishedAtOf(order))} />
        <Line
          label={t('kuryer.orderAmount')}
          value={<Money amount={order.pricing.total} className="font-semibold text-ink-900" />}
        />
        <Line label={t('checkout.payment')} value={payment} />
      </dl>

      <p
        className={cn(
          'mt-5 flex items-center gap-2 border-t border-card-edge pt-4 text-lg font-semibold',
          delivered ? 'text-success' : 'text-danger',
        )}
      >
        {delivered ? <CheckCircle2 size={20} aria-hidden /> : <XCircle size={20} aria-hidden />}
        {t(`order.status.${order.status}`)}
      </p>

      {/* A driver whose delivery was cancelled used to be shown the word and
          nothing else. The reason and the person behind it are on the order
          document already; there was simply nothing rendering them here. */}
      <div className="mt-3">
        <CancellationNote cancellation={order.cancellation} />
      </div>
    </Card>
  );
}

/** One fact, on one line: what it is, and what it says. */
function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right text-ink-900">{value}</dd>
    </div>
  );
}
