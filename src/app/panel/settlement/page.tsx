'use client';

/**
 * Hesablaşma — who pays whom, this month.
 *
 * A restaurant owner should never have to work out a sign. The page opens with
 * one sentence in words — "you owe the platform X" or "the platform owes you X"
 * — and everything below it exists to explain that sentence: the orders behind
 * it, the commission rate it was charged at, the online takings Qapında is
 * holding, and where the money is going to move.
 *
 * Nothing here is calculated in the browser. The figures come from
 * `getSettlement`, which derives them from the ledger, and the direction comes
 * from `settlementDirection` in the shared money code — the same function the
 * admin screen uses, so the two can never tell a different story.
 */

import { useEffect, useState } from 'react';
import { Banknote, Landmark, Percent, Receipt, Scale, Wallet } from 'lucide-react';

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
import { Alert, Button, Card, Input, Money } from '@/components/ui';
import { useToast } from '@/components/panel/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import {
  getSettlement,
  setPayoutDetails,
  type BankAccount,
  type LedgerRowDoc,
  type SettlementDoc,
} from '@/firebase/callables';
import { LedgerEntryType } from '@/shared/enums';
import { periodOf } from '@/shared/collections';
import { formatIban, isValidIban, looksLikeCardNumber, normaliseIban } from '@/shared/bank';
import {
  EMPTY_SETTLEMENT_SUMMARY,
  SettlementDirection,
  formatBps,
  settlementAmountToShow,
  settlementDirection,
  type SettlementSummary,
} from '@/shared/pricing';

/** The last twelve months, newest first. */
function recentPeriods(): string[] {
  const list: string[] = [];
  const today = new Date();
  for (let back = 0; back < 12; back += 1) {
    list.push(periodOf(new Date(today.getFullYear(), today.getMonth() - back, 15)));
  }
  return list;
}

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

interface Loaded {
  period: string;
  /** Every ledger row behind this month, so the totals can be opened up. */
  entries: LedgerRowDoc[];
  summary: SettlementSummary;
  netDue: number;
  status: string | null;
  rateBps: number | null;
  history: SettlementDoc[];
  payout: BankAccount | null;
  platformAccount: BankAccount | null;
}

export default function RestaurantSettlementPage() {
  const t = useT();
  const toast = useToast();
  const { restaurantId } = useAuth();

  const [period, setPeriod] = useState(() => periodOf(new Date()));
  // The loaded figures carry the period they belong to, so switching months
  // shows the spinner by derivation instead of by clearing state in an effect.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The payout form is a draft until it is saved. `null` means "not edited
  // yet", which is what lets the saved details fill the fields without an
  // effect writing state on every render.
  const [draft, setDraft] = useState<{ accountHolder: string; iban: string; bankName: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);

  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;

    getSettlement({ restaurantId, period }).then((result) => {
      if (cancelled) return;

      if (!result.ok || !result.data) {
        setError(translateError(t, result.errorCode, result.errorDetail));
        setLoaded({
          period,
          entries: [],
          summary: EMPTY_SETTLEMENT_SUMMARY,
          netDue: 0,
          status: null,
          rateBps: null,
          history: [],
          payout: null,
          platformAccount: null,
        });
        return;
      }

      setError(null);
      setLoaded({
        period,
        entries: result.data.entries ?? [],
        summary: result.data.summary,
        netDue: result.data.computedNetDue,
        status: result.data.settlement?.status ?? null,
        rateBps: result.data.commissionRateBps,
        history: result.data.history,
        payout: result.data.payout,
        platformAccount: result.data.platformBankAccount,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [restaurantId, period, t, reloadToken]);

  const fresh = loaded?.period === period ? loaded : null;
  const summary = fresh?.summary ?? EMPTY_SETTLEMENT_SUMMARY;
  const netDue = fresh?.netDue ?? 0;
  const direction = settlementDirection(netDue);
  const owed = settlementAmountToShow(netDue);

  // The saved details are the starting point of the form; an edit takes over
  // from there. Derived during render — no effect copies one into the other.
  const payout = fresh?.payout ?? null;
  const form = draft ?? {
    accountHolder: payout?.accountHolder ?? '',
    iban: payout ? formatIban(payout.iban) : '',
    bankName: payout?.bankName ?? '',
  };

  const ibanTyped = form.iban.trim();
  const ibanLooksLikeCard = ibanTyped.length > 0 && looksLikeCardNumber(ibanTyped);
  const ibanInvalid = ibanTyped.length > 0 && !ibanLooksLikeCard && !isValidIban(ibanTyped);
  const canSave =
    form.accountHolder.trim().length >= 2 &&
    form.bankName.trim().length >= 2 &&
    ibanTyped.length > 0 &&
    !ibanLooksLikeCard &&
    !ibanInvalid;

  const savePayout = async () => {
    if (!restaurantId || !canSave) return;

    setSaving(true);
    setPayoutError(null);

    const result = await setPayoutDetails({
      restaurantId,
      accountHolder: form.accountHolder.trim(),
      iban: normaliseIban(form.iban),
      bankName: form.bankName.trim(),
    });

    setSaving(false);

    if (!result.ok) {
      setPayoutError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    toast.show(t('settlement.payoutSaved'));
    setDraft(null);
    setReloadToken((token) => token + 1);
  };

  const headline =
    direction === SettlementDirection.RESTAURANT_PAYS
      ? t('settlement.youOwe')
      : direction === SettlementDirection.PLATFORM_PAYS
        ? t('settlement.weOwe')
        : t('settlement.settled');

  /*
   * The commission rows for this month, newest first.
   *
   * Read straight off the ledger rather than off the orders: the ledger is the
   * record the invoice is built from, so a row here is a row that was actually
   * billed. Reading the orders instead would show what SHOULD have been billed,
   * and the whole point of this table is that the two can be compared.
   */
  const commissionRows = (fresh?.entries ?? []).filter(
    (row) => row.type === LedgerEntryType.COMMISSION,
  );

  const commissionColumns: Column<LedgerRowDoc>[] = [
    {
      key: 'order',
      header: t('admin.orderId'),
      // The order's code travels in the entry's description — "Komissiya · A7F3"
      // — because a ledger row has to be readable months after the order it
      // came from was archived.
      cell: (row) => <span className="font-medium text-ink-900">{row.description}</span>,
      sortValue: (row) => row.description,
    },
    {
      key: 'orderTotal',
      header: t('cart.total'),
      align: 'right',
      cell: (row) =>
        row.orderTotal === null ? (
          <span className="text-ink-300">—</span>
        ) : (
          <Money amount={row.orderTotal} />
        ),
      sortValue: (row) => row.orderTotal ?? 0,
    },
    {
      key: 'commission',
      header: t('settlement.commission'),
      align: 'right',
      cell: (row) => <Money amount={row.amount} className="font-medium" />,
      sortValue: (row) => row.amount,
    },
  ];

  const historyColumns: Column<SettlementDoc>[] = [
    {
      key: 'period',
      header: t('admin.period'),
      cell: (row) => <span className="font-medium text-ink-900">{row.period}</span>,
      sortValue: (row) => row.period,
    },
    {
      key: 'orders',
      header: t('sales.orderCount'),
      align: 'right',
      cell: (row) => row.orderCount,
      sortValue: (row) => row.orderCount,
    },
    {
      key: 'commission',
      header: t('settlement.commission'),
      align: 'right',
      cell: (row) => <Money amount={row.commissionAmount} />,
      sortValue: (row) => row.commissionAmount,
    },
    {
      key: 'balance',
      header: t('settlement.balance'),
      align: 'right',
      // Said in words on every row, not left as a minus sign: a table of signed
      // numbers is exactly where "who owes whom" gets misread.
      cell: (row) => (
        <span className={row.netDue < 0 ? 'text-success' : 'text-ink-900'}>
          <Money amount={Math.abs(row.netDue)} />
          <span className="ml-1.5 text-xs text-ink-400">
            {row.netDue > 0
              ? t('settlement.shortYouPay')
              : row.netDue < 0
                ? t('settlement.shortWePay')
                : t('settlement.shortSettled')}
          </span>
        </span>
      ),
      sortValue: (row) => row.netDue,
    },
    {
      key: 'status',
      header: t('admin.status'),
      cell: (row) => (
        <StatusBadge tone={settlementTone(row.status)}>{t(`status.${row.status}`)}</StatusBadge>
      ),
      sortValue: (row) => row.status,
    },
  ];

  return (
    <PanelShell kind="restaurant">
      <PageHeader title={t('settlement.title')} subtitle={t('settlement.subtitle')} />

      <Toolbar>
        <FilterSelect value={period} onChange={setPeriod} label={t('admin.period')}>
          {recentPeriods().map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </FilterSelect>

        {fresh?.status && (
          <StatusBadge tone={settlementTone(fresh.status)}>{t(`status.${fresh.status}`)}</StatusBadge>
        )}
      </Toolbar>

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {/* --- The one sentence ----------------------------------------- */}
      <Card className="mb-5 p-5">
        <p className="text-sm text-ink-500">{headline}</p>
        <p
          className={
            direction === SettlementDirection.PLATFORM_PAYS
              ? 'mt-1 text-3xl font-semibold text-success'
              : 'mt-1 text-3xl font-semibold text-ink-900'
          }
        >
          <Money amount={owed} />
        </p>
        <p className="mt-2 text-xs text-ink-400">{t('settlement.headlineHint')}</p>
      </Card>

      {/* --- Why it is that much -------------------------------------- */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label={t('sales.orderCount')} value={String(summary.orderCount)} icon={Receipt} />
        <Stat label={t('settlement.grossSales')} amount={summary.grossSales} icon={Wallet} />
        <Stat
          label={
            fresh?.rateBps !== null && fresh?.rateBps !== undefined
              ? t('settlement.commissionAt', { rate: formatBps(fresh.rateBps) })
              : t('settlement.commission')
          }
          amount={summary.commission}
          icon={Percent}
        />
        <Stat
          label={t('settlement.platformDiscounts')}
          amount={summary.platformFundedDiscount}
          tone="success"
        />
        <Stat
          label={t('settlement.onlineHeld')}
          amount={summary.onlineCollected}
          tone="success"
          icon={Banknote}
          hint={t('settlement.onlineHeldHint')}
        />
        <Stat label={t('settlement.adjustments')} amount={summary.adjustments} icon={Scale} />
        <Stat label={t('settlement.paymentsRecorded')} amount={summary.paymentsReceived} />
      </div>

      <div className="mb-5">
        <Alert tone="info">{t('settlement.explainer')}</Alert>
      </div>

      {/* --- Where the money goes ------------------------------------- */}
      <Card className="mb-5 p-5">
        <div className="flex items-center gap-2">
          <Landmark size={16} className="text-ink-300" />
          <h2 className="font-semibold text-ink-900">
            {direction === SettlementDirection.PLATFORM_PAYS
              ? t('settlement.whereYouGetPaid')
              : t('settlement.whereToPay')}
          </h2>
        </div>

        {direction === SettlementDirection.PLATFORM_PAYS ? (
          payout ? (
            <BankLines
              account={payout}
              labels={{
                holder: t('settlement.accountHolder'),
                iban: t('settlement.iban'),
                bank: t('settlement.bankName'),
                note: t('settlement.paymentNote'),
              }}
            />
          ) : (
            <p className="mt-3 text-sm text-ink-500">{t('settlement.payoutMissing')}</p>
          )
        ) : fresh?.platformAccount ? (
          <BankLines
            account={fresh.platformAccount}
            labels={{
              holder: t('settlement.accountHolder'),
              iban: t('settlement.iban'),
              bank: t('settlement.bankName'),
              note: t('settlement.paymentNote'),
            }}
          />
        ) : (
          <p className="mt-3 text-sm text-ink-500">{t('settlement.noPlatformAccount')}</p>
        )}
      </Card>

      {/* --- The restaurant's own account ----------------------------- */}
      <Card className="mb-5 p-5">
        <h2 className="font-semibold text-ink-900">{t('settlement.payoutTitle')}</h2>
        <p className="mt-1 text-sm text-ink-500">{t('settlement.payoutHint')}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Input
            label={t('settlement.accountHolder')}
            value={form.accountHolder}
            onChange={(event) => setDraft({ ...form, accountHolder: event.target.value })}
            maxLength={120}
          />
          <Input
            label={t('settlement.iban')}
            value={form.iban}
            onChange={(event) => setDraft({ ...form, iban: event.target.value })}
            maxLength={42}
            placeholder="AZ00 XXXX 0000 0000 0000 0000 0000"
            hint={t('settlement.ibanHint')}
          />
          <Input
            label={t('settlement.bankName')}
            value={form.bankName}
            onChange={(event) => setDraft({ ...form, bankName: event.target.value })}
            maxLength={120}
          />
        </div>

        {/* Told before the form is submitted, because a card number typed into
            a bank-details box is a mistake worth catching in the browser as
            well as on the server. */}
        {ibanLooksLikeCard && (
          <div className="mt-3">
            <Alert tone="danger">{t('settlement.cardNotAllowed')}</Alert>
          </div>
        )}
        {ibanInvalid && (
          <div className="mt-3">
            <Alert tone="warning">{t('settlement.ibanInvalid')}</Alert>
          </div>
        )}
        {payoutError && (
          <div className="mt-3">
            <Alert tone="danger">{payoutError}</Alert>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => void savePayout()} disabled={!canSave || saving}>
            {t('common.save')}
          </Button>
          {draft && (
            <Button variant="secondary" onClick={() => setDraft(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </Card>

      {/* --- Order by order ------------------------------------------- */}
      {/*
        The totals above, opened up.

        An owner asking "why is this month 200 manat" gets an answer here rather
        than a number to take on trust: one line per order, the price it sold
        for and the commission it carried, adding up to the figure in the tile.
        Only orders that were actually charged appear — a cancelled order never
        reaches the ledger at all, which is what makes this list safe to read as
        "everything I paid for".
      */}
      <h2 className="mb-2 font-semibold text-ink-900">{t('settlement.perOrderTitle')}</h2>
      <p className="mb-3 text-sm text-ink-500">{t('settlement.perOrderHint')}</p>
      <DataTable
        rows={fresh ? commissionRows : null}
        columns={commissionColumns}
        rowKey={(row) => row.id}
        emptyTitle={t('settlement.perOrderEmpty')}
        emptyHint={t('settlement.perOrderEmptyHint')}
      />

      <div className="h-6" />

      {/* --- The months behind this one ------------------------------- */}
      <h2 className="mb-2 font-semibold text-ink-900">{t('settlement.history')}</h2>
      <DataTable
        rows={fresh?.history ?? null}
        columns={historyColumns}
        rowKey={(row) => row.id}
        emptyTitle={t('settlement.noHistory')}
        emptyHint={t('settlement.noHistoryHint')}
      />
    </PanelShell>
  );
}

/** Bank details, laid out so they can be read straight into a transfer form. */
function BankLines({
  account,
  labels,
}: {
  account: BankAccount;
  labels: { holder: string; iban: string; bank: string; note: string };
}) {
  return (
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-ink-400">{labels.holder}</dt>
        <dd className="text-ink-900">{account.accountHolder}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-400">{labels.iban}</dt>
        {/* Grouped in fours: an IBAN is checked against a statement by eye. */}
        <dd className="font-mono text-ink-900">{formatIban(account.iban)}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-400">{labels.bank}</dt>
        <dd className="text-ink-900">{account.bankName}</dd>
      </div>
      {account.note && (
        <div>
          <dt className="text-xs text-ink-400">{labels.note}</dt>
          <dd className="text-ink-900">{account.note}</dd>
        </div>
      )}
    </dl>
  );
}
