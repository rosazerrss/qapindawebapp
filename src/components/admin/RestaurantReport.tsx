'use client';

/**
 * One restaurant's own figures, on the admin's restaurant detail.
 *
 * WHY IT CALLS THE RESTAURANT'S OWN ENDPOINTS
 * -------------------------------------------
 * The owner's rule, and it is the whole design of this file: two screens
 * disagreeing about one restaurant's money is worse than one screen missing
 * the number. So nothing here is computed in the browser. The period figures
 * come from `restaurantReport` — the exact callable behind the restaurant's own
 * Hesabat — and the settlement line comes from `getSettlement`, the exact
 * callable behind its Hesablaşma. An admin and a restaurant owner looking at
 * the same month are looking at the same arithmetic, run once, on the server.
 *
 * WHAT IS LIVE AND WHAT IS NOT
 * ----------------------------
 * The order list is a Firestore subscription, so a new order appears on the
 * admin's screen the moment the kitchen receives it — no refresh, no button.
 * The money cannot be: commission is derived from the ledger and the frozen
 * order snapshots by a callable, and there is no query a browser can subscribe
 * to that would produce it. So the totals are re-fetched on a cadence, and
 * additionally the moment the live subscription shows an order reaching a
 * terminal state — which is the only moment the totals can actually have moved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Receipt, Scale, TrendingUp, Wallet } from 'lucide-react';

import { Stat } from '@/components/panel/Stat';
import { StatusBadge, type StatusTone } from '@/components/panel/ui';
import { orderTone, when } from '@/components/panel/status';
import { Alert, Button, Card, Money, cn } from '@/components/ui';
import { InlineLoading } from '@/components/ui/loading';
import { useT, translateError } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { getSettlement, restaurantReport } from '@/firebase/callables';
import { watchLatestRestaurantOrders } from '@/services/catalog';
import { periodOf } from '@/shared/collections';
import { TERMINAL_ORDER_STATUSES } from '@/shared/enums';
import {
  SettlementDirection,
  formatBps,
  settlementAmountToShow,
  settlementDirection,
} from '@/shared/pricing';
import type { Order } from '@/shared/models';

/** How often the figures that can only come from a callable are re-asked. */
const REFRESH_MS = 60_000;

const PERIODS = [7, 30, 90] as const;
type PeriodDays = (typeof PERIODS)[number];

type Report = NonNullable<Awaited<ReturnType<typeof restaurantReport>>['data']>;

interface Loaded {
  /** What this answer was for, so a stale one is never shown beside a new period. */
  key: string;
  report: Report | null;
  netDue: number | null;
  settlementRateBps: number | null;
  error: string | null;
}

export function RestaurantReport({
  restaurantId,
  restaurantName,
}: {
  restaurantId: string;
  restaurantName: string;
}) {
  const t = useT();
  const { firebaseUser, loading } = useAuth();

  const [days, setDays] = useState<PeriodDays>(30);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Bumped by the cadence and by the live subscription. Changing it is what
  // re-runs the fetch, so there is one path into the callables rather than two.
  const [refreshToken, setRefreshToken] = useState(0);
  const [orders, setOrders] = useState<Order[] | null | undefined>(undefined);

  const key = `${restaurantId}:${days}`;
  const period = periodOf(new Date());

  useEffect(() => {
    if (!restaurantId) return;
    return watchLatestRestaurantOrders(restaurantId, 12, setOrders);
  }, [restaurantId]);

  /*
   * How many of the live orders have finished.
   *
   * Derived during render rather than stored, and used below as an effect
   * dependency: when it changes, an order has just reached a state that moves
   * the takings, so the totals are worth asking for again straight away
   * instead of waiting out the minute.
   */
  const finishedCount = useMemo(
    () => (orders ?? []).filter((order) => TERMINAL_ORDER_STATUSES.includes(order.status)).length,
    [orders],
  );

  const load = useCallback(async () => {
    const to = Date.now();
    const from = to - days * 24 * 60 * 60 * 1000;

    const [report, settlement] = await Promise.all([
      restaurantReport({ restaurantId, from, to }),
      // The current month's settlement, which is literally the figure the
      // restaurant reads on its own Hesablaşma screen.
      getSettlement({ restaurantId, period }),
    ]);

    if (!report.ok || !report.data) {
      setLoaded({
        key: `${restaurantId}:${days}`,
        report: null,
        netDue: null,
        settlementRateBps: null,
        error: translateError(t, report.errorCode, report.errorDetail),
      });
      return;
    }

    setLoaded({
      key: `${restaurantId}:${days}`,
      report: report.data,
      // A failed settlement read is not a failed report: the period figures
      // still stand, and the month's balance simply shows as unavailable.
      netDue: settlement.ok && settlement.data ? settlement.data.computedNetDue : null,
      settlementRateBps:
        settlement.ok && settlement.data ? settlement.data.commissionRateBps : null,
      error: null,
    });
  }, [restaurantId, days, period, t]);

  useEffect(() => {
    // The session first: a callable fired before Firebase has restored the
    // token comes back UNAUTHENTICATED, and an admin would read that refusal
    // as the restaurant having no figures.
    if (loading || !firebaseUser) return;

    // Every state update happens after an `await`, past the boundary the rule
    // can see across.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, loading, firebaseUser, refreshToken, finishedCount]);

  useEffect(() => {
    const timer = setInterval(() => setRefreshToken((value) => value + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const current = loaded?.key === key ? loaded : null;
  const totals = current?.report?.totals ?? null;

  // The agreed rate if there is one, otherwise whatever the report was actually
  // charged at — never a default typed into this screen.
  const rateBps = current?.report?.commissionRateBps ?? current?.settlementRateBps ?? null;

  const direction = current?.netDue === null || current?.netDue === undefined
    ? null
    : settlementDirection(current.netDue);

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
            {t('admin.restaurantReport')}
          </h3>
          {/* Named, every time. This panel is opened from a list of dozens of
              restaurants, and a screenful of money with no name on it is the
              easiest way to act on the wrong shop. */}
          <p className="mt-0.5 truncate text-sm text-ink-600">
            {t('admin.restaurantReportFor', { name: restaurantName })}
          </p>
        </div>

        <div className="flex gap-1">
          {PERIODS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === days}
              onClick={() => setDays(option)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-sm transition',
                option === days
                  ? 'bg-brand-600 text-white'
                  : 'border border-ink-200 text-ink-600 hover:bg-ink-50',
              )}
            >
              {t('admin.lastDays', { count: option })}
            </button>
          ))}
        </div>
      </header>

      {current?.error ? (
        <Alert tone="danger">
          <span className="block">{current.error}</span>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => setRefreshToken((value) => value + 1)}
          >
            {t('common.retry')}
          </Button>
        </Alert>
      ) : !totals ? (
        <InlineLoading label={t('common.loading')} className="py-6" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              icon={Receipt}
              label={t('sales.orderCount')}
              value={String(totals.orderCount)}
              hint={t('admin.reportCompletedOnly')}
            />
            <Stat icon={TrendingUp} label={t('sales.grossSales')} amount={totals.grossSales} />
            <Stat
              icon={Wallet}
              label={t('settlement.commission')}
              amount={totals.commission}
              tone="brand"
              hint={
                rateBps === null
                  ? t('admin.reportRateDefault')
                  : t('admin.reportRate', { rate: formatBps(rateBps) })
              }
            />
            <Stat
              icon={Ban}
              label={t('admin.reportCancellations')}
              value={String(totals.failedCount)}
              tone={totals.failedCount > 0 ? 'warning' : 'default'}
              hint={t('admin.reportCancellationsHint')}
            />
            <Stat icon={Receipt} label={t('sales.averageOrder')} amount={totals.averageOrder} />
            <Stat
              icon={Scale}
              label={t('admin.reportSettlementNow')}
              amount={
                current?.netDue === null || current?.netDue === undefined
                  ? 0
                  : settlementAmountToShow(current.netDue)
              }
              tone={direction === SettlementDirection.RESTAURANT_PAYS ? 'warning' : 'success'}
              hint={
                direction === null
                  ? t('admin.reportSettlementUnavailable')
                  : direction === SettlementDirection.RESTAURANT_PAYS
                    ? t('admin.reportRestaurantOwes')
                    : direction === SettlementDirection.PLATFORM_PAYS
                      ? t('admin.reportPlatformOwes')
                      : t('admin.reportSettled')
              }
            />
          </div>

          <Card className="px-4 py-3">
            <p className="text-sm text-ink-500">{t('admin.reportConsistencyNote')}</p>
          </Card>

          {current?.report?.truncated && (
            <Alert tone="warning">{t('sales.truncated')}</Alert>
          )}
        </>
      )}

      {/* --- The live list ---------------------------------------------- */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
          {t('admin.reportRecentOrders')}
        </h4>

        {orders === undefined ? (
          <InlineLoading label={t('common.loading')} className="py-4" />
        ) : orders === null ? (
          // A failed subscription says so rather than spinning for ever.
          <Alert tone="warning">{t('errors.LIVE_UNAVAILABLE')}</Alert>
        ) : orders.length === 0 ? (
          <p className="rounded-xl border border-ink-200 px-3.5 py-3 text-sm text-ink-500">
            {t('admin.reportNoOrders')}
          </p>
        ) : (
          <ul className="divide-y divide-row-edge rounded-xl border border-ink-200">
            {orders.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block font-mono text-sm text-ink-900">{order.code}</span>
                  <span className="block text-xs text-ink-400">{when(order.placedAt)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  <StatusBadge tone={orderTone(order.status) as StatusTone}>
                    {t(`status.${order.status}`)}
                  </StatusBadge>
                  <span className="text-sm tabular-nums text-ink-900">
                    <Money amount={order.pricing.total} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
