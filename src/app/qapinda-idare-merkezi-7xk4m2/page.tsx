'use client';

/**
 * The platform overview.
 *
 * Two kinds of thing live here and they are kept apart on purpose:
 *
 *  - **Now** — restaurants waiting for a decision, orders in flight. These are
 *    live from Firestore, because they are things somebody must act on today.
 *  - **The period** — orders, turnover, commission, who is carrying the volume.
 *    These are computed on demand from the orders themselves for whatever range
 *    is selected.
 *
 * Mixing the two would produce the usual dashboard lie: a "today" number sitting
 * next to a "this month" number in identical boxes.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { AlertTriangle, ArrowRight, Percent, Receipt, Store, TrendingUp, Wallet } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import { RangePicker, shortDay, useDateRange } from '@/components/panel/DateRange';
import { Stat } from '@/components/panel/Stat';
import { ColumnChart, RankChart } from '@/components/ui/Chart';
import { Alert, Badge, Button, Card, Loading, Money } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { firestore } from '@/firebase/client';
import { platformReport } from '@/firebase/callables';
import { list, num } from '@/lib/stored';
import { COLLECTIONS } from '@/shared/collections';
import { ACTIVE_ORDER_STATUSES, RestaurantStatus } from '@/shared/enums';
import { formatBps, formatMinorUnits } from '@/shared/pricing';

interface Report {
  truncated: boolean;
  /**
   * How many orders the server could not read at all.
   *
   * `platformReport` sums each order inside its own try and counts what it had
   * to skip rather than taking the whole screen down with one malformed
   * document. That number is useless in a log nobody reads, so it is shown:
   * a report quietly missing orders is worse than one that says how many.
   */
  skipped?: number;
  totals: {
    placed: number;
    completed: number;
    cancelled: number;
    grossSales: number;
    commission: number;
    platformCredits: number;
    netCommission: number;
    averageOrder: number;
    cancelRateBps: number;
  };
  daily: Array<{ day: string; orders: number; revenue: number; commission: number }>;
  restaurants: Array<{ restaurantId: string; name: string; orders: number; revenue: number }>;
}

/**
 * How often the dashboard tiles re-count.
 *
 * Thirty seconds. A count is one read per thousand documents, so this is
 * cheaper by orders of magnitude than the live subscriptions it replaced, and a
 * number on an overview screen does not need to be true to the second.
 */
const COUNT_REFRESH_MS = 30_000;

export default function AdminDashboard() {
  const t = useT();
  const { range, key, controls } = useDateRange('month');
  const months = t('sales.months').split('|');

  // --- Live: what needs a person today ------------------------------------
  const [pending, setPending] = useState<number | null>(null);
  const [activeOrders, setActiveOrders] = useState<number | null>(null);
  // A refused subscription used to be reported as a zero, which is a number
  // somebody acts on: "nothing is waiting for approval today" is a very
  // different thing from "I could not find out". Both tiles now fall back to
  // the dash they already show while loading, and the strip says why.
  const [liveError, setLiveError] = useState(false);

  useEffect(() => {
    const db = firestore();
    if (!db) return;

    /*
     * COUNTED ON THE SERVER, NOT BY DOWNLOADING EVERYTHING AND MEASURING IT.
     *
     * These two tiles show a number. They used to get it by opening a live
     * subscription to every matching document and reading `snapshot.size` — so
     * displaying "48 active orders" streamed forty-eight whole orders, with
     * every customer's name, telephone number and address, into an admin's
     * browser and kept them in sync. At a thousand live orders that is a
     * thousand reads per page open, repeated for every change to any of them.
     *
     * `getCountFromServer` answers the same question for one read per thousand
     * documents and transfers no personal data at all.
     *
     * The cost of the change is that the numbers no longer update by
     * themselves. That is the right trade for a dashboard tile: it is refreshed
     * by the poll below, which is cheap because it is still a count.
     */
    let live = true;

    const load = async () => {
      try {
        const [pendingCount, orderCount] = await Promise.all([
          getCountFromServer(
            query(
              collection(db, COLLECTIONS.restaurants),
              where('status', '==', RestaurantStatus.PENDING_APPROVAL),
            ),
          ),
          getCountFromServer(
            query(collection(db, COLLECTIONS.orders), where('status', 'in', ACTIVE_ORDER_STATUSES)),
          ),
        ]);

        if (!live) return;
        setPending(pendingCount.data().count);
        setActiveOrders(orderCount.data().count);
      } catch {
        if (live) setLiveError(true);
      }
    };

    void load();
    const timer = setInterval(() => void load(), COUNT_REFRESH_MS);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  // --- The period ---------------------------------------------------------
  const [loaded, setLoaded] = useState<{
    key: string;
    report: Report | null;
    error: string | null;
  } | null>(null);

  /*
   * Bumped by the retry button, so pressing it re-runs the effect for the very
   * same range.
   *
   * The range's own key is the effect's dependency, which means asking for the
   * same dates twice is a no-op — exactly the wrong behaviour when the first
   * answer was "the figures did not load". A counter is the smallest thing that
   * makes "try again" mean something.
   */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!range) return;
    let cancelled = false;

    platformReport({ from: range.from, to: range.to }).then((result) => {
      if (cancelled) return;

      setLoaded(
        result.ok && result.data
          ? { key, report: result.data as unknown as Report, error: null }
          : { key, report: null, error: translateError(t, result.errorCode, result.errorDetail) },
      );
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, t, attempt]);

  const fresh = loaded?.key === key ? loaded : null;
  const report = fresh?.report ?? null;
  const error = fresh?.error ?? null;

  const money = (value: number) => `${formatMinorUnits(value)} ₼`;

  return (
    <PanelShell kind="admin" title={t('nav.dashboard')}>
      {/* --- Needs attention -------------------------------------------- */}
      {liveError && (
        <div className="mb-4">
          <Alert tone="danger">{t('errors.LIVE_UNAVAILABLE')}</Alert>
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Link href="/qapinda-idare-merkezi-7xk4m2/restaurants" className="group">
          <Card className="flex items-center gap-4 p-4 transition group-hover:shadow-md">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Store size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-500">{t('admin.pendingApprovals')}</p>
              <p className="flex items-center gap-2 text-2xl font-semibold tabular-nums text-ink-900">
                {pending ?? '—'}
                {pending !== null && pending > 0 && (
                  <Badge tone="warning">{t('admin.needsReview')}</Badge>
                )}
              </p>
            </div>
            <ArrowRight size={17} className="shrink-0 text-ink-300 group-hover:text-brand-600" />
          </Card>
        </Link>

        <Link href="/qapinda-idare-merkezi-7xk4m2/orders" className="group">
          <Card className="flex items-center gap-4 p-4 transition group-hover:shadow-md">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-600">
              <Receipt size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-500">{t('order.active')}</p>
              <p className="text-2xl font-semibold tabular-nums text-ink-900">
                {activeOrders ?? '—'}
              </p>
            </div>
            <ArrowRight size={17} className="shrink-0 text-ink-300 group-hover:text-brand-600" />
          </Card>
        </Link>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
        {t('admin.periodSection')}
      </h2>

      <RangePicker controls={controls} />

      {/* A failed period is not a broken screen: the dates are still there, the
          live tiles above are still live, and the one thing missing can be
          asked for again without a page reload. */}
      {error && (
        <div className="mb-4">
          <Alert tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{error}</span>
              <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                {t('common.retry')}
              </Button>
            </div>
          </Alert>
        </div>
      )}

      {range && !report && !error ? (
        <Loading />
      ) : report ? (
        <>
          {report.truncated && (
            <div className="mb-4">
              <Alert tone="warning">{t('sales.truncated')}</Alert>
            </div>
          )}

          {num(report.skipped) > 0 && (
            <div className="mb-4">
              <Alert tone="warning">
                {t('admin.reportSkipped', { count: num(report.skipped) })}
              </Alert>
            </div>
          )}

          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t('admin.grossVolume')}
              amount={report.totals.grossSales}
              tone="brand"
              icon={TrendingUp}
              hint={`${t('sales.averageOrder')}: ${money(report.totals.averageOrder)}`}
            />
            <Stat
              label={t('admin.completedOrders')}
              value={String(report.totals.completed)}
              icon={Receipt}
              hint={`${t('admin.placedOrders')}: ${report.totals.placed}`}
            />
            <Stat
              label={t('admin.netCommission')}
              amount={report.totals.netCommission}
              tone="success"
              icon={Wallet}
              hint={`${t('restaurantPanel.platformCredits')}: ${money(report.totals.platformCredits)}`}
            />
            <Stat
              label={t('admin.cancelRate')}
              value={formatBps(report.totals.cancelRateBps)}
              tone={report.totals.cancelRateBps > 1500 ? 'warning' : 'default'}
              icon={report.totals.cancelRateBps > 1500 ? AlertTriangle : Percent}
              hint={`${report.totals.cancelled} / ${report.totals.placed}`}
            />
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <ColumnChart
                title={t('admin.ordersPerDay')}
                data={list<Report['daily'][number]>(report.daily).map((entry) => ({
                  label: shortDay(entry.day, months),
                  value: num(entry.orders),
                  hint: money(num(entry.revenue)),
                }))}
                emptyLabel={t('sales.empty')}
              />
            </Card>

            <Card className="p-4">
              <ColumnChart
                title={t('admin.commissionPerDay')}
                data={list<Report['daily'][number]>(report.daily).map((entry) => ({
                  label: shortDay(entry.day, months),
                  value: num(entry.commission),
                }))}
                format={money}
                emptyLabel={t('sales.empty')}
              />
            </Card>
          </div>

          <Card className="mb-5 p-4">
            <RankChart
              title={t('admin.topRestaurants')}
              data={list<Report['restaurants'][number]>(report.restaurants).map((entry) => ({
                label: entry.name,
                value: num(entry.revenue),
                hint: `${num(entry.orders)}`,
              }))}
              format={money}
              max={8}
              emptyLabel={t('sales.empty')}
            />
          </Card>

          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm text-ink-500">{t('admin.settlements')}</p>
              <p className="mt-0.5 text-lg font-semibold text-ink-900">
                <Money amount={report.totals.commission} />
              </p>
            </div>
            <Link
              href="/qapinda-idare-merkezi-7xk4m2/finance"
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-700 transition hover:border-brand-300 hover:text-brand-700"
            >
              {t('nav.ledger')} <ArrowRight size={15} />
            </Link>
          </Card>
        </>
      ) : null}
    </PanelShell>
  );
}
