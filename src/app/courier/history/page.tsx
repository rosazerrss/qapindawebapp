'use client';

/**
 * Keçmiş sifarişlər — this driver's own record.
 *
 * Their deliveries and nobody else's: the query filters on `courier.id`, which
 * is the same clause in `firestore.rules` that the active list leans on, so a
 * courier cannot reach a colleague's history by any route the app or the
 * network offers. What it is for is the ordinary human question at the end of a
 * shift — "how many did I do, and which one was the one that was cancelled".
 */

import { Alert, Button, EmptyState, Loading } from '@/components/ui';
import { CourierShell } from '@/components/courier/CourierShell';
import { CourierHistoryRow } from '@/components/courier/OrderCards';
import { useCourierHistory } from '@/components/courier/useCourierData';
import { COURIER_HISTORY_WINDOW } from '@/services/courier';
import { useT } from '@/i18n';

export default function CourierHistoryPage() {
  const t = useT();
  const { orders, failed, retry } = useCourierHistory();

  return (
    <CourierShell title={t('kuryer.historyTitle')}>
      {failed ? (
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
        <EmptyState title={t('kuryer.historyEmpty')} hint={t('kuryer.historyEmptyHint')} />
      ) : (
        <>
          <ul className="space-y-3">
            {orders.map((order) => (
              <CourierHistoryRow key={order.id} order={order} />
            ))}
          </ul>

          {/* Said out loud once the list is long enough to be a window rather
              than the whole record — otherwise "where is last month" has no
              answer on screen. */}
          {orders.length >= COURIER_HISTORY_WINDOW && (
            <p className="mt-4 text-center text-sm text-ink-400">
              {t('kuryer.historyWindowHint', { count: COURIER_HISTORY_WINDOW })}
            </p>
          )}
        </>
      )}
    </CourierShell>
  );
}
