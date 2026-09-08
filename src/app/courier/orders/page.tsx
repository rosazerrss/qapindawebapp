'use client';

/**
 * Aktiv sifarişlər — the deliveries in this driver's hands.
 *
 * Only the orders assigned to this account, which is not a filter applied for
 * tidiness: `watchCourierActiveOrders` queries on `courier.id`, and the
 * security rules refuse any query on `orders` that does not. A courier account
 * rides around on a personal phone that gets lost, sold and handed to the next
 * driver, so what this screen can ever show is exactly the handful of
 * deliveries it was actually given.
 */

import { Alert, Button, EmptyState } from '@/components/ui';
import { Loading } from '@/components/ui';
import { CourierShell } from '@/components/courier/CourierShell';
import { CourierOrderSummary } from '@/components/courier/OrderCards';
import { useCourierActiveOrders } from '@/components/courier/useCourierData';
import { useT } from '@/i18n';

export default function CourierActiveOrdersPage() {
  const t = useT();
  const { orders, failed, retry } = useCourierActiveOrders();

  return (
    <CourierShell title={t('kuryer.activeTitle')}>
      {failed ? (
        // A refused or broken subscription is not an empty round. Saying "no
        // deliveries" to a driver whose query was rejected is how this went
        // unnoticed for as long as it did.
        <Alert tone="danger">
          <span className="block text-lg font-semibold">{t('kuryer.loadFailed')}</span>
          <span className="mt-1 block text-base">{t('kuryer.loadFailedHint')}</span>
          <Button
            size="lg"
            variant="secondary"
            className="mt-3"
            onClick={retry}
          >
            {t('common.retry')}
          </Button>
        </Alert>
      ) : orders === null ? (
        <Loading label={t('common.loadingOrders')} />
      ) : orders.length === 0 ? (
        <EmptyState title={t('kuryer.empty')} hint={t('kuryer.emptyHint')} />
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <CourierOrderSummary key={order.id} order={order} />
          ))}
        </div>
      )}
    </CourierShell>
  );
}
