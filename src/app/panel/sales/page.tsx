'use client';

/**
 * Turnover.
 *
 * The question a restaurant actually asks is never "what is my net due" — it is
 * "how did last month go, and what sold". So the screen opens on the current
 * month, and the range is three taps at most.
 *
 * Everything below the range reacts to it. Nothing is cached across ranges,
 * because a stale total under a new heading is worse than a spinner.
 */

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Package, Printer, Receipt, TrendingUp, Wallet } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import { RangePicker, shortDay, useDateRange } from '@/components/panel/DateRange';
import { Stat } from '@/components/panel/Stat';
import { ColumnChart, RankChart } from '@/components/ui/Chart';
import { Alert, Button, Card, EmptyState, Loading, Money, cn } from '@/components/ui';
import { SalesReportPrint } from '@/components/panel/SalesReportPrint';
import { Field } from '@/components/panel/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import { restaurantReport } from '@/firebase/callables';
import { formatMinorUnits } from '@/shared/pricing';

interface Report {
  totals: {
    orderCount: number;
    itemsSold: number;
    grossSales: number;
    deliveryFees: number;
    discounts: number;
    commission: number;
    platformCredits: number;
    netToRestaurant: number;
    averageOrder: number;
    /*
     * How the kitchen is run, as opposed to how much it sold.
     *
     * Null rather than zero when there is nothing to measure — a restaurant
     * with no orders has not achieved a perfect acceptance rate, and a zero
     * would say it did.
     */
    acceptanceRate: number | null;
    rejectedCount: number;
    expiredCount: number;
    averageAnswerMinutes: number | null;
    averagePrepMinutes: number | null;
  };
  products: Array<{
    productId: string;
    name: string;
    quantity: number;
    revenue: number;
    orderCount: number;
  }>;
  daily: Array<{ day: string; revenue: number; orders: number }>;
  truncated: boolean;
}

export default function RestaurantSalesPage() {
  const t = useT();
  const { restaurantId } = useAuth();
  const { range, key, controls } = useDateRange('month');

  const months = t('sales.months').split('|');

  // The loaded report carries the range it belongs to, so changing the range
  // shows the spinner by comparison rather than by clearing state in an effect.
  const [loaded, setLoaded] = useState<{
    key: string;
    report: Report | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!restaurantId || !range) return;
    let cancelled = false;

    restaurantReport({ restaurantId, from: range.from, to: range.to }).then((result) => {
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
    // `key` stands for the range; the range object is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, key, t]);

  const fresh = loaded?.key === key ? loaded : null;
  const report = fresh?.report ?? null;
  const error = fresh?.error ?? null;

  /*
   * The printable sheet is mounted only while printing.
   *
   * Not hidden-but-present: it is a second copy of every product row and every
   * day of the month, and keeping it in the tree would double the work of a
   * screen that already renders two charts and a table. It goes in when the
   * button is pressed and comes out when the browser says it is finished.
   */
  const [printing, setPrinting] = useState(false);
  const stopPrinting = useCallback(() => setPrinting(false), []);

  const money = (value: number) => `${formatMinorUnits(value)} ₼`;

  return (
    <PanelShell kind="restaurant" title={t('sales.title')}>
      <RangePicker controls={controls} />

      {/* Only once there is something to print. A button that produces a blank
          sheet is worse than no button. */}
      {report && range && (
        <div className="mb-4 flex justify-end">
          <Button variant="secondary" onClick={() => setPrinting(true)}>
            <Printer size={16} aria-hidden />
            {t('sales.printReport')}
          </Button>
        </div>
      )}

      {printing && report && range && (
        <SalesReportPrint
          restaurantId={restaurantId}
          report={report}
          range={range}
          onPrinted={stopPrinting}
        />
      )}

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
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

          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t('sales.grossSales')}
              amount={report.totals.grossSales}
              tone="brand"
              icon={TrendingUp}
            />
            <Stat
              label={t('sales.orderCount')}
              value={String(report.totals.orderCount)}
              icon={Receipt}
              hint={`${t('sales.averageOrder')}: ${money(report.totals.averageOrder)}`}
            />
            <Stat
              label={t('sales.itemsSold')}
              value={String(report.totals.itemsSold)}
              icon={Package}
            />
            <Stat
              label={t('sales.netToRestaurant')}
              amount={report.totals.netToRestaurant}
              tone="success"
              icon={Wallet}
              hint={`${t('sales.commission')}: ${money(report.totals.commission)}`}
            />
          </div>

          {/* PERFORMANCE, kept apart from the money.
              These three are the numbers a restaurant can act on tomorrow —
              how often it accepts, how quickly it answers, and how long it says
              the food takes. Shown together and after the takings, because a
              shop reads its revenue first and always will. */}
          <Card className="mb-5 p-4">
            <h2 className="mb-3 text-[15px] font-semibold text-ink-900">
              {t('sales.performance')}
            </h2>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('sales.acceptanceRate')}>
                {report.totals.acceptanceRate === null ? (
                  '—'
                ) : (
                  <span
                    className={cn(
                      'text-lg font-semibold tabular-nums',
                      report.totals.acceptanceRate >= 90
                        ? 'text-success'
                        : report.totals.acceptanceRate >= 75
                          ? 'text-warning'
                          : 'text-danger',
                    )}
                  >
                    {report.totals.acceptanceRate}%
                  </span>
                )}
              </Field>

              <Field label={t('sales.answerTime')}>
                {report.totals.averageAnswerMinutes === null
                  ? '—'
                  : t('restaurantPanel.prepMinutes', {
                      count: report.totals.averageAnswerMinutes,
                    })}
              </Field>

              <Field label={t('sales.prepTime')}>
                {report.totals.averagePrepMinutes === null
                  ? '—'
                  : t('restaurantPanel.prepMinutes', {
                      count: report.totals.averagePrepMinutes,
                    })}
              </Field>
            </div>

            {/* Said in numbers rather than implied by a percentage: "you
                refused four and let two time out" is a sentence somebody can
                do something with. */}
            {(report.totals.rejectedCount > 0 || report.totals.expiredCount > 0) && (
              <p className="mt-3 border-t border-card-edge pt-3 text-sm text-ink-600">
                {t('sales.performanceDetail', {
                  rejected: report.totals.rejectedCount,
                  expired: report.totals.expiredCount,
                })}
              </p>
            )}
          </Card>

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <ColumnChart
                title={t('sales.dailyRevenue')}
                data={report.daily.map((entry) => ({
                  label: shortDay(entry.day, months),
                  value: entry.revenue,
                  hint: `${entry.orders} ${t('sales.orderCount').toLowerCase()}`,
                }))}
                format={money}
                emptyLabel={t('sales.empty')}
              />
            </Card>

            <Card className="p-4">
              <RankChart
                title={t('sales.topProducts')}
                data={report.products.map((line) => ({
                  label: line.name,
                  value: line.quantity,
                }))}
                format={(value) => `${value} ${t('sales.pieces')}`}
                emptyLabel={t('sales.empty')}
              />
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-card-edge px-4 py-3">
              <BarChart3 size={17} className="text-ink-400" />
              <h2 className="font-medium text-ink-900">{t('sales.byProduct')}</h2>
            </div>

            {report.products.length === 0 ? (
              <div className="p-6">
                <EmptyState title={t('sales.empty')} />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-card-edge bg-ink-50 text-left text-ink-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">{t('sales.product')}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t('sales.quantity')}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t('sales.inOrders')}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t('sales.revenue')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-row-edge">
                    {report.products.map((line) => (
                      <tr key={line.productId} className="hover:bg-ink-50">
                        <td className="px-4 py-2.5 text-ink-800">{line.name}</td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink-900">
                          {line.quantity}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink-500">
                          {line.orderCount}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink-900">
                          <Money amount={line.revenue} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </PanelShell>
  );
}
