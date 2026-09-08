'use client';

/**
 * One active delivery, live.
 *
 * The id in this address came from a card the driver tapped, so it is already
 * an order they were given — but an address bar is a text field like any other,
 * and the `get` clause in the `orders` rule is what makes typing a colleague's
 * order id into it useless. A refusal arrives as a failed subscription and is
 * shown as what it honestly is: this order is not on your list.
 */

import { use } from 'react';
import Link from 'next/link';

import { EmptyState } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { CourierShell } from '@/components/courier/CourierShell';
import { ActiveOrderDetail } from '@/components/courier/ActiveOrderDetail';
import { CancellationNote } from '@/components/panel/CancellationNote';
import { useCourierOrder, useDeliveryCodePolicy } from '@/components/courier/useCourierData';
import { useT } from '@/i18n';
import { courierBucket } from '@/shared/courier';

export default function CourierOrderPage({ params }: PageProps<'/courier/orders/[orderId]'>) {
  const { orderId } = use(params);
  const t = useT();

  const { order, failed } = useCourierOrder(orderId);
  const codePolicy = useDeliveryCodePolicy();

  // A delivery that ended while this screen was open belongs in the history,
  // and the past view is the one that reads correctly for it. Derived during
  // render rather than pushed from an effect, which would be a redirect the
  // driver watches happen.
  const finished = order ? courierBucket(order.status) === 'history' : false;

  return (
    <CourierShell title={order?.code ?? t('kuryer.activeTitle')} backHref="/courier/orders">
      {failed || order === null ? (
        <EmptyState
          title={t('kuryer.orderNotFound')}
          hint={t('kuryer.orderNotFoundHint')}
          action={
            <Link
              href="/courier/orders"
              className="flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-base font-semibold text-white"
            >
              {t('kuryer.backToActive')}
            </Link>
          }
        />
      ) : order === undefined ? (
        <PageLoading label={t('common.loadingOrders')} />
      ) : finished ? (
        /*
          The order ended while the driver had it open — cancelled by the
          customer, rejected by the kitchen, expired. This is the moment the
          four panels have to agree, and the driver's half of that agreement
          used to be one word: the status, with no reason and nobody's name
          against it. The note below is the same block the restaurant, the
          operator and the admin see.
        */
        <div className="space-y-3">
          <EmptyState
            title={t(`order.status.${order.status}`)}
            hint={t('kuryer.historyEmptyHint')}
            action={
              <Link
                href={`/courier/history/${order.id}`}
                className="flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-base font-semibold text-white"
              >
                {t('kuryer.backToHistory')}
              </Link>
            }
          />
          <CancellationNote cancellation={order.cancellation} />
        </div>
      ) : (
        <ActiveOrderDetail order={order} codePolicy={codePolicy} />
      )}
    </CourierShell>
  );
}
