'use client';

/**
 * The month's invoices — both directions.
 *
 * Half of this table is money coming in (restaurants that took cash owe their
 * commission) and half is money going out (restaurants whose customers paid
 * online have been paid nothing yet). Netting the two into a single column
 * would hide which bank run is which, so every row says in words which way it
 * goes and the totals are kept apart as well as netted.
 *
 * An adjustment and a payment both post a *new* ledger entry rather than
 * editing anything — the ledger is append-only by construction, and the rules
 * give no client a write path to it at all. What the UI offers is the
 * correction, never the eraser.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import {
  ConfirmDialog,
  DataTable,
  Drawer,
  Field,
  FilterSelect,
  PageHeader,
  StatusBadge,
  Toolbar,
  type Column,
  type StatusTone,
} from '@/components/panel/ui';
import { Stat } from '@/components/panel/Stat';
import { useToast } from '@/components/panel/Toast';
import { Alert, Button, Input, Money, Select, Textarea } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import {
  adjustLedger,
  getSettlement,
  listSettlements,
  recordSettlementPayment,
  setSettlementStatus,
  type SettlementDoc,
} from '@/firebase/callables';
import { list, num, text } from '@/lib/stored';
import { periodOf } from '@/shared/collections';
import {
  SettlementPaymentDirection,
  SettlementPaymentMethod,
  SettlementStatus,
} from '@/shared/enums';
import { SettlementDirection, formatBps, settlementDirection } from '@/shared/pricing';

type Action = 'invoiced' | 'adjust' | 'payment';

/** The dialog reuses each button's own wording, so the two always agree. */
const ACTION_TITLE: Record<Action, string> = {
  invoiced: 'admin.markInvoiced',
  adjust: 'admin.adjust',
  payment: 'admin.recordPayment',
};

interface LedgerRow {
  id: string;
  type: string;
  amount: number;
  description: string;
}

function recentPeriods(): string[] {
  const list: string[] = [];
  const today = new Date();
  for (let back = 0; back < 12; back += 1) {
    list.push(periodOf(new Date(today.getFullYear(), today.getMonth() - back, 15)));
  }
  return list;
}

/** The shape the totals row takes before anything has loaded. */
const EMPTY_TOTALS = {
  commission: 0,
  credits: 0,
  onlineCollected: 0,
  grossSales: 0,
  owedToPlatform: 0,
  owedToRestaurants: 0,
  netDue: 0,
};

const TONE: Record<string, StatusTone> = {
  OPEN: 'neutral',
  INVOICED: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  WRITTEN_OFF: 'neutral',
};

export default function AdminFinancePage() {
  const t = useT();
  const toast = useToast();

  const [period, setPeriod] = useState(() => periodOf(new Date()));
  // Keyed by period, so changing the month shows a spinner without a
  // synchronous "clear the table" step first.
  const [loaded, setLoaded] = useState<{
    period: string;
    settlements: SettlementDoc[];
    totals: {
      commission: number;
      credits: number;
      onlineCollected: number;
      grossSales: number;
      owedToPlatform: number;
      owedToRestaurants: number;
      netDue: number;
    };
  } | null>(null);

  const [dialog, setDialog] = useState<{ row: SettlementDoc; action: Action } | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<string>(SettlementPaymentMethod.BANK_TRANSFER);
  const [busy, setBusy] = useState(false);

  // The ledger behind one row, opened on demand. A settlement is a summary; the
  // question "why is it this much" is only answerable from the entries.
  const [inspecting, setInspecting] = useState<SettlementDoc | null>(null);
  const [ledger, setLedger] = useState<{
    entries: LedgerRow[];
    rateBps: number | null;
  } | null>(null);
  // The drawer used to sit on "Yüklənir…" for ever when `getSettlement`
  // failed, because the only thing that ever cleared the null was success.
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  // The list's failure belongs on the table; an action's failure belongs in the
  // dialog the person is still looking at. They are never the same message.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const periods = useMemo(() => recentPeriods(), []);

  const reload = useCallback(async () => {
    const result = await listSettlements(period);

    if (!result.ok || !result.data) {
      setLoadError(translateError(t, result.errorCode, result.errorDetail));
      setLoaded({ period, settlements: [], totals: EMPTY_TOTALS });
      return;
    }

    setLoadError(null);
    setLoaded({
      period,
      settlements: list<SettlementDoc>(result.data.settlements),
      totals: result.data.totals ?? EMPTY_TOTALS,
    });
  }, [period, t]);

  const fresh = loaded?.period === period ? loaded : null;
  const rows = fresh?.settlements ?? null;
  const totals = fresh?.totals ?? EMPTY_TOTALS;

  useEffect(() => {
    // Every state update in the loader happens after an `await`, so nothing is
    // set synchronously during this effect. The rule cannot see past the async
    // boundary, so it is silenced here rather than the code contorted around it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const inspect = async (row: SettlementDoc) => {
    setInspecting(row);
    setLedger(null);
    setLedgerError(null);

    const result = await getSettlement({ restaurantId: row.restaurantId, period: row.period });

    if (!result.ok || !result.data) {
      setLedgerError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setLedger({
      entries: list<LedgerRow>(result.data.entries),
      rateBps: result.data.commissionRateBps,
    });
  };

  const open = (row: SettlementDoc, action: Action) => {
    setError(null);
    setAmount(
      // A payment is nearly always for the whole balance, so it is offered
      // filled in — and still editable, because a part payment happens.
      action === 'payment' ? (Math.abs(num(row.netDue)) / 100).toFixed(2) : '',
    );
    setDescription('');
    setReference('');
    setMethod(SettlementPaymentMethod.BANK_TRANSFER);
    setDialog({ row, action });
  };

  const run = async () => {
    if (!dialog) return;

    const { row, action } = dialog;

    setBusy(true);
    setError(null);

    let result;

    if (action === 'adjust') {
      // Signed: a minus means the platform owes the restaurant.
      const parsed = Number(amount.replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed === 0) {
        setBusy(false);
        setError(t('errors.VALIDATION_FAILED'));
        return;
      }

      result = await adjustLedger({
        restaurantId: row.restaurantId,
        period: row.period,
        amount: Math.round(parsed * 100),
        description,
      });
    } else if (action === 'payment') {
      const parsed = Number(amount.replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setBusy(false);
        setError(t('errors.VALIDATION_FAILED'));
        return;
      }

      result = await recordSettlementPayment({
        restaurantId: row.restaurantId,
        period: row.period,
        amount: Math.round(parsed * 100),
        // Which way the money went is read from the balance, not asked: the
        // restaurant pays when it owes, and the platform pays when it owes.
        direction:
          num(row.netDue) >= 0
            ? SettlementPaymentDirection.FROM_RESTAURANT
            : SettlementPaymentDirection.TO_RESTAURANT,
        method: method as SettlementPaymentMethod,
        reference,
        note: description.trim() ? description.trim() : null,
      });

      if (result.ok && result.data && !result.data.recorded) {
        setBusy(false);
        setError(t('admin.paymentAlreadyRecorded'));
        return;
      }
    } else {
      result = await setSettlementStatus({
        restaurantId: row.restaurantId,
        period: row.period,
        status: SettlementStatus.INVOICED,
        reason: `Admin: ${SettlementStatus.INVOICED}`,
      });
    }

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    toast.show(t(`admin.done_${action}`));
    setDialog(null);
    await reload();
  };

  const isAdjust = dialog?.action === 'adjust';
  const isPayment = dialog?.action === 'payment';
  const adjustReady = amount.trim().length > 0 && description.trim().length >= 10;
  const paymentReady = amount.trim().length > 0 && reference.trim().length >= 3;

  const columns: Column<SettlementDoc>[] = [
    {
      key: 'restaurant',
      header: t('admin.restaurant'),
      cell: (row) => (
        <span className="block">
          <span className="block font-medium text-ink-900">
            {text(row.restaurantName) || row.restaurantId}
          </span>
          <span className="block text-xs text-ink-400">{text(row.period)}</span>
        </span>
      ),
      sortValue: (row) => text(row.restaurantName),
    },
    {
      key: 'status',
      header: t('admin.status'),
      cell: (row) => (
        <StatusBadge tone={TONE[row.status] ?? 'neutral'}>{t(`status.${row.status}`)}</StatusBadge>
      ),
      sortValue: (row) => row.status,
    },
    {
      key: 'orders',
      header: t('sales.orderCount'),
      align: 'right',
      cell: (row) => num(row.orderCount),
      sortValue: (row) => num(row.orderCount),
    },
    {
      key: 'commission',
      header: t('restaurantPanel.commission'),
      align: 'right',
      cell: (row) => <Money amount={num(row.commissionAmount)} />,
      sortValue: (row) => num(row.commissionAmount),
    },
    {
      key: 'online',
      header: t('settlement.onlineHeld'),
      align: 'right',
      cell: (row) =>
        num(row.onlineCollected) > 0 ? (
          <Money amount={num(row.onlineCollected)} />
        ) : (
          <span className="text-ink-300">—</span>
        ),
      sortValue: (row) => num(row.onlineCollected),
    },
    {
      key: 'netDue',
      header: t('settlement.balance'),
      align: 'right',
      // Said in words on every row. A column of signed numbers is precisely
      // where a payout gets sent to a restaurant that owed money instead.
      cell: (row) => (
        <span className="block">
          <span
            className={
              num(row.netDue) < 0 ? 'font-semibold text-success' : 'font-semibold text-ink-900'
            }
          >
            <Money amount={Math.abs(num(row.netDue))} />
          </span>
          <span className="block text-xs text-ink-400">
            {num(row.netDue) > 0
              ? t('admin.restaurantPays')
              : num(row.netDue) < 0
                ? t('admin.platformPays')
                : t('settlement.shortSettled')}
          </span>
        </span>
      ),
      sortValue: (row) => num(row.netDue),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <span className="flex justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
          <Button size="sm" variant="secondary" onClick={() => void inspect(row)}>
            {t('admin.viewLedger')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => open(row, 'adjust')}>
            {t('admin.adjust')}
          </Button>
          {row.status !== SettlementStatus.PAID && row.status !== SettlementStatus.WRITTEN_OFF && (
            <>
              {row.status === SettlementStatus.OPEN && (
                <Button size="sm" variant="secondary" onClick={() => open(row, 'invoiced')}>
                  {t('admin.markInvoiced')}
                </Button>
              )}
              <Button size="sm" variant="success" onClick={() => open(row, 'payment')}>
                {t('admin.recordPayment')}
              </Button>
            </>
          )}
        </span>
      ),
    },
  ];

  return (
    <PanelShell kind="admin">
      <PageHeader title={t('nav.ledger')} subtitle={t('admin.ledgerSubtitle')} />

      <Toolbar>
        <span className="text-sm text-ink-500">{t('admin.period')}</span>
        <FilterSelect value={period} onChange={setPeriod} label={t('admin.period')}>
          {periods.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </FilterSelect>
      </Toolbar>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('restaurantPanel.commission')} amount={totals.commission} icon={Wallet} />
        <Stat
          label={t('settlement.onlineHeld')}
          amount={totals.onlineCollected}
          hint={t('admin.onlineCollectedHint')}
        />
        <Stat
          label={t('admin.owedToPlatform')}
          amount={totals.owedToPlatform}
          tone="brand"
          icon={ArrowDownLeft}
        />
        <Stat
          label={t('admin.owedToRestaurants')}
          amount={totals.owedToRestaurants}
          tone="success"
          icon={ArrowUpRight}
        />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        error={loadError}
        emptyTitle={t('admin.noSettlements')}
        emptyHint={t('admin.noSettlementsHint')}
      />

      {/* --- The entries behind one invoice --------------------------- */}
      <Drawer
        open={Boolean(inspecting)}
        onClose={() => setInspecting(null)}
        title={inspecting?.restaurantName ?? ''}
        subtitle={inspecting?.period}
      >
        {inspecting && (
          <>
            <Field label={t('settlement.grossSales')}>
              <Money amount={num(inspecting.grossSales)} />
            </Field>
            <Field
              label={
                ledger?.rateBps != null
                  ? t('settlement.commissionAt', { rate: formatBps(ledger.rateBps) })
                  : t('settlement.commission')
              }
            >
              <Money amount={num(inspecting.commissionAmount)} />
            </Field>
            <Field label={t('settlement.platformDiscounts')}>
              <Money amount={num(inspecting.platformFundedDiscount)} />
            </Field>
            <Field label={t('settlement.onlineHeld')}>
              <Money amount={num(inspecting.onlineCollected)} />
            </Field>
            <Field label={t('settlement.adjustments')}>
              <Money amount={num(inspecting.adjustments)} />
            </Field>
            <Field label={t('settlement.paymentsRecorded')}>
              <Money amount={num(inspecting.paymentsReceived)} />
            </Field>
            <Field
              label={
                settlementDirection(num(inspecting.netDue)) === SettlementDirection.PLATFORM_PAYS
                  ? t('admin.platformPays')
                  : t('admin.restaurantPays')
              }
            >
              <Money amount={Math.abs(num(inspecting.netDue))} />
            </Field>

            <h3 className="mt-5 mb-2 text-sm font-semibold text-ink-900">
              {t('admin.ledgerEntries')}
            </h3>

            {ledgerError ? (
              <Alert tone="danger">{ledgerError}</Alert>
            ) : ledger === null ? (
              <p className="text-sm text-ink-400">{t('common.loading')}</p>
            ) : ledger.entries.length === 0 ? (
              <p className="text-sm text-ink-400">{t('restaurantPanel.noEntries')}</p>
            ) : (
              <ul className="divide-y divide-row-edge">
                {ledger.entries.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-4 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink-800">
                        {text(entry.description) || '—'}
                      </span>
                      <span className="block text-xs text-ink-400">{t(`ledger.${entry.type}`)}</span>
                    </span>
                    <span className={num(entry.amount) < 0 ? 'text-success' : 'text-ink-900'}>
                      <Money amount={num(entry.amount)} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Drawer>

      {/* --- Action --------------------------------------------------- */}
      <ConfirmDialog
        open={Boolean(dialog)}
        title={dialog ? t(ACTION_TITLE[dialog.action]) : ''}
        body={dialog ? t(`admin.warn_${dialog.action}`, { name: dialog.row.restaurantName }) : ''}
        confirmLabel={t('common.confirm')}
        tone="primary"
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (isAdjust && !adjustReady) return;
          if (isPayment && !paymentReady) return;
          void run();
        }}
      >
        {isAdjust && (
          <>
            <Input
              label={t('admin.adjustAmount')}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="-12.50"
              hint={t('admin.adjustAmountHint')}
            />

            <Textarea
              label={t('admin.reasonRequired')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={300}
              hint={t('admin.reasonAudited')}
            />

            {description.trim().length < 10 && (
              <p className="text-xs text-ink-400">{t('admin.reasonTooShort')}</p>
            )}

            <Alert tone="info">{t('admin.adjustHint')}</Alert>
          </>
        )}

        {isPayment && dialog && (
          <>
            {/* Stated, never asked. The direction is a fact about the balance,
                and offering it as a choice is offering a way to get it wrong. */}
            <Alert tone="info">
              {num(dialog.row.netDue) >= 0
                ? t('admin.paymentFromRestaurant', { name: dialog.row.restaurantName })
                : t('admin.paymentToRestaurant', { name: dialog.row.restaurantName })}
            </Alert>

            <Input
              label={t('admin.paymentAmount')}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
            />

            <Input
              label={t('admin.paymentReference')}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              maxLength={100}
              hint={t('admin.paymentReferenceHint')}
            />

            <Select
              label={t('admin.paymentMethod')}
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              <option value={SettlementPaymentMethod.BANK_TRANSFER}>
                {t('settlementMethod.BANK_TRANSFER')}
              </option>
              <option value={SettlementPaymentMethod.CASH}>{t('settlementMethod.CASH')}</option>
              <option value={SettlementPaymentMethod.OFFSET}>{t('settlementMethod.OFFSET')}</option>
            </Select>

            <Textarea
              label={t('admin.noteOptional')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={300}
            />
          </>
        )}

        {error && <Alert tone="danger">{error}</Alert>}
      </ConfirmDialog>
    </PanelShell>
  );
}
