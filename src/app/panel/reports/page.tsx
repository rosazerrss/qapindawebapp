'use client';

/**
 * What the restaurant owes, and why.
 *
 * Every figure is shown with the entries behind it — the commission per order,
 * the platform-funded discounts credited back. A restaurant should never have
 * to take a number on trust, and the ledger is what makes that possible.
 */

import { useEffect, useState } from 'react';
import { Percent, Scale, Wallet } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import { Stat } from '@/components/panel/Stat';
import {
  DataTable,
  FilterSelect,
  PageHeader,
  StatusBadge,
  Toolbar,
  type Column,
  type StatusTone,
} from '@/components/panel/ui';
import { Alert, Card, Money } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import { getSettlement } from '@/firebase/callables';
import { LedgerEntryType } from '@/shared/enums';
import { periodOf } from '@/shared/collections';
import { formatBps } from '@/shared/pricing';

interface LedgerRow {
  id: string;
  type: string;
  amount: number;
  description: string;
  period: string;
}

/** The last twelve months, newest first. */
function recentPeriods(): string[] {
  const list: string[] = [];
  const now = new Date();
  for (let back = 0; back < 12; back += 1) {
    list.push(periodOf(new Date(now.getFullYear(), now.getMonth() - back, 15)));
  }
  return list;
}

/**
 * Settlement state colours. This lives here rather than in `panel/status`
 * because the restaurant reads its own account: "invoiced" is a neutral fact to
 * the platform but a thing to act on for the restaurant.
 */
function settlementTone(status: string): StatusTone {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'OVERDUE':
      return 'danger';
    case 'INVOICED':
      return 'warning';
    default:
      return 'neutral';
  }
}

export default function RestaurantFinancePage() {
  const t = useT();
  const { restaurantId } = useAuth();

  const [period, setPeriod] = useState(() => periodOf(new Date()));
  // The loaded data carries the period it belongs to. Switching months then
  // shows the spinner by *derivation* rather than by clearing state first.
  const [loaded, setLoaded] = useState<{
    period: string;
    entries: LedgerRow[];
    netDue: number;
    status: string | null;
    rateBps: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;

    getSettlement({ restaurantId, period }).then((result) => {
      if (cancelled) return;

      if (!result.ok || !result.data) {
        setError(translateError(t, result.errorCode, result.errorDetail));
        setLoaded({ period, entries: [], netDue: 0, status: null, rateBps: null });
        return;
      }

      setError(null);
      setLoaded({
        period,
        entries: result.data.entries as unknown as LedgerRow[],
        netDue: result.data.computedNetDue,
        status: (result.data.settlement?.status as string) ?? null,
        rateBps: result.data.commissionRateBps,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [restaurantId, period, t]);

  const fresh = loaded?.period === period ? loaded : null;
  const entries = fresh?.entries ?? null;
  const netDue = fresh?.netDue ?? 0;
  const status = fresh?.status ?? null;
  const rateBps = fresh?.rateBps ?? null;

  const commission = (entries ?? [])
    .filter((entry) => entry.type === LedgerEntryType.COMMISSION)
    .reduce((sum, entry) => sum + entry.amount, 0);

  const credits = (entries ?? [])
    .filter((entry) => entry.type === LedgerEntryType.PLATFORM_DISCOUNT)
    .reduce((sum, entry) => sum + -entry.amount, 0);

  const columns: Column<LedgerRow>[] = [
    {
      key: 'description',
      header: t('restaurantPanel.ledgerEntry'),
      cell: (entry) => <span className="text-ink-800">{entry.description}</span>,
      sortValue: (entry) => entry.description,
    },
    {
      key: 'type',
      header: t('restaurantPanel.ledgerType'),
      cell: (entry) => <span className="text-ink-500">{t(`ledger.${entry.type}`)}</span>,
      sortValue: (entry) => entry.type,
    },
    {
      key: 'amount',
      header: t('restaurantPanel.amount'),
      align: 'right',
      cell: (entry) => (
        // A negative entry is money coming back to the restaurant, so it reads
        // green rather than as a smaller debt.
        <span className={entry.amount < 0 ? 'text-success' : 'text-ink-900'}>
          <Money amount={entry.amount} />
        </span>
      ),
      sortValue: (entry) => entry.amount,
    },
  ];

  return (
    <PanelShell kind="restaurant">
      <PageHeader
        title={t('restaurantPanel.financeTitle')}
        subtitle={t('restaurantPanel.financeSubtitle')}
      />

      <Toolbar>
        <FilterSelect value={period} onChange={setPeriod} label={t('admin.period')}>
          {recentPeriods().map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </FilterSelect>

        {status && (
          <StatusBadge tone={settlementTone(status)}>{t(`status.${status}`)}</StatusBadge>
        )}
      </Toolbar>

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label={t('restaurantPanel.commission')} amount={commission} icon={Percent} />
        <Stat
          label={t('restaurantPanel.platformCredits')}
          amount={-credits}
          tone="success"
          icon={Wallet}
        />
        <Stat
          label={netDue >= 0 ? t('restaurantPanel.netDue') : t('restaurantPanel.netDueNegative')}
          amount={Math.abs(netDue)}
          tone={netDue >= 0 ? 'brand' : 'success'}
          icon={Scale}
        />
      </div>

      <div className="mb-4">
        <Alert tone="info">{t('restaurantPanel.commissionExplainer')}</Alert>
      </div>

      <DataTable
        rows={entries}
        columns={columns}
        rowKey={(entry) => entry.id}
        emptyTitle={t('restaurantPanel.noEntries')}
        emptyHint={t('restaurantPanel.noEntriesHint')}
        footer={
          entries && entries.length > 0 ? (
            <div className="flex items-center justify-between gap-4 border-t border-ink-200 bg-ink-50 px-4 py-3 font-semibold text-ink-900">
              <span>{t('restaurantPanel.netDue')}</span>
              <span className="tabular-nums">
                <Money amount={netDue} />
              </span>
            </div>
          ) : null
        }
      />

      {/* The rate the platform actually agreed with *this* restaurant — read
          from its own record, not a number typed into the page. */}
      {rateBps !== null && (
        <Card className="mt-4 px-4 py-3">
          <p className="text-xs text-ink-400">
            {t('restaurantPanel.yourRate', { rate: formatBps(rateBps) })}
          </p>
        </Card>
      )}
    </PanelShell>
  );
}
