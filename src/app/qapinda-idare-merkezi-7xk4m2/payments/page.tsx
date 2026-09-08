'use client';

/**
 * Online payments — the reconciliation screen.
 *
 * "The bank says X manats cleared today, does the system agree?" is the
 * question this exists to answer, so it shows the whole picture for a window
 * rather than a filtered view of the happy path: a failed or expired attempt
 * is not an error state of this screen, it is exactly the kind of row an
 * operator opens the page to look at. Nothing here hides it or paints the
 * whole row as a fault — only the state badge carries the colour.
 *
 * What is deliberately absent: any card number, or anything that looks like
 * one. The server never stores one, and this screen never invents a column
 * for one or echoes a raw provider payload into view.
 *
 * A refund is the one action here, and it is audited exactly like every other
 * money-moving action in the panel: a written reason of real length, behind a
 * confirmation that states what will happen rather than asking "are you sure".
 */

import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import { RangePicker, useDateRange } from '@/components/panel/DateRange';
import { Stat } from '@/components/panel/Stat';
import {
  ConfirmDialog,
  DataTable,
  Drawer,
  Field,
  FilterSelect,
  PageHeader,
  SearchInput,
  StatusBadge,
  Toolbar,
  type Column,
} from '@/components/panel/ui';
import { paymentStateTone, when, whenExact } from '@/components/panel/status';
import { useToast } from '@/components/panel/Toast';
import { Alert, Button, Card, Money, Textarea } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { listPayments, refundPayment } from '@/firebase/callables';
import { list, matches, num, text } from '@/lib/stored';
import { formatMinorUnits } from '@/shared/pricing';
import { PaymentState } from '@/shared/payments';

/**
 * `listPayments` answers over the callable wire, so its timestamps arrive as
 * plain JSON: the admin SDK serialises a Timestamp as `_seconds`, never as an
 * object with `toMillis()`.
 */
interface WireTimestamp {
  _seconds?: number;
  seconds?: number;
}

interface PaymentRow {
  id: string;
  orderId: string;
  restaurantId: string;
  provider: string;
  providerTransactionId: string | null;
  providerBankTransactionId: string | null;
  amount: number;
  refundedAmount: number;
  currency: string;
  state: string;
  failureReason: string | null;
  createdAt: WireTimestamp | null;
  confirmedAt: WireTimestamp | null;
}

/** Seconds on the wire, millis in the formatter — one place to bridge the two. */
const wireWhen = (value: WireTimestamp | null | undefined): string => {
  const seconds = value?._seconds ?? value?.seconds;
  return seconds === undefined ? '' : when({ toMillis: () => seconds * 1000 });
};

const wireWhenExact = (value: WireTimestamp | null | undefined): string => {
  const seconds = value?._seconds ?? value?.seconds;
  return seconds === undefined ? '' : whenExact({ toMillis: () => seconds * 1000 });
};

const STATES = Object.values(PaymentState);

export default function AdminPaymentsPage() {
  const t = useT();
  const toast = useToast();
  const { range, key, controls } = useDateRange('month');

  const [loaded, setLoaded] = useState<{
    key: string;
    payments: PaymentRow[];
    totals: { attempted: number; paid: number; refunded: number; failed: number };
    error: string | null;
  } | null>(null);

  const [state, setState] = useState('ALL');
  const [term, setTerm] = useState('');
  const [detail, setDetail] = useState<PaymentRow | null>(null);
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!range) return;
    let cancelled = false;

    listPayments({ from: range.from, to: range.to }).then((result) => {
      if (cancelled) return;

      setLoaded(
        result.ok && result.data
          ? {
              key,
              payments: list<PaymentRow>(result.data.payments),
              totals: result.data.totals ?? { attempted: 0, paid: 0, refunded: 0, failed: 0 },
              error: null,
            }
          : {
              key,
              payments: [],
              totals: { attempted: 0, paid: 0, refunded: 0, failed: 0 },
              error: translateError(t, result.errorCode, result.errorDetail),
            },
      );
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, t]);

  const fresh = loaded?.key === key ? loaded : null;
  const payments = fresh?.payments ?? null;
  const totals = fresh?.totals ?? { attempted: 0, paid: 0, refunded: 0, failed: 0 };
  const loadError = fresh?.error ?? null;

  const rows = (() => {
    if (!payments) return null;
    const needle = term.trim().toLowerCase();

    return payments
      .filter((payment) => state === 'ALL' || payment.state === state)
      .filter((payment) =>
        matches(
          needle,
          payment.orderId,
          payment.providerTransactionId,
          payment.providerBankTransactionId,
        ),
      );
  })();

  const refundable = (payment: PaymentRow) =>
    payment.state === PaymentState.PAID || payment.state === PaymentState.PARTIALLY_REFUNDED;


  const openRefund = (payment: PaymentRow) => {
    setError(null);
    setReason('');
    setRefunding(payment);
  };

  const runRefund = async () => {
    if (!refunding) return;

    setBusy(true);
    setError(null);

    const result = await refundPayment({ paymentId: refunding.id, reason });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    toast.show(t('admin.doneRefund'));
    setRefunding(null);
    setDetail(null);
    setReason('');

    // A payment's total, not the whole window, changed — refetch rather than
    // hand-patch one row and risk the totals drifting from the server's own.
    if (range) {
      const refreshed = await listPayments({ from: range.from, to: range.to });
      if (refreshed.ok && refreshed.data) {
        setLoaded({
          key,
          payments: list<PaymentRow>(refreshed.data.payments),
          totals: refreshed.data.totals ?? { attempted: 0, paid: 0, refunded: 0, failed: 0 },
          error: null,
        });
      }
    }
  };

  const columns: Column<PaymentRow>[] = [
    {
      key: 'order',
      header: t('admin.orderId'),
      cell: (payment) => (
        <span className="font-mono text-xs font-semibold text-ink-900">
          {text(payment.orderId)}
        </span>
      ),
      sortValue: (payment) => text(payment.orderId),
    },
    {
      key: 'amount',
      header: t('cart.total'),
      align: 'right',
      cell: (payment) => (
        <span className="block">
          <Money amount={num(payment.amount)} className="font-medium" />
          {num(payment.refundedAmount) > 0 && num(payment.refundedAmount) < num(payment.amount) && (
            <span className="block text-xs text-warning">
              {t('admin.partialRefund', {
                amount: `${formatMinorUnits(num(payment.refundedAmount))} ₼`,
              })}
            </span>
          )}
          {num(payment.refundedAmount) > 0 &&
            num(payment.refundedAmount) >= num(payment.amount) && (
              <span className="block text-xs text-ink-400">
                −<Money amount={num(payment.refundedAmount)} />
              </span>
            )}
        </span>
      ),
      sortValue: (payment) => num(payment.amount),
    },
    {
      key: 'state',
      header: t('admin.status'),
      cell: (payment) => (
        <StatusBadge tone={paymentStateTone(payment.state)}>
          {t(`payment.${payment.state}`)}
        </StatusBadge>
      ),
      sortValue: (payment) => text(payment.state),
    },
    {
      key: 'provider',
      header: t('admin.provider'),
      cell: (payment) => <span className="text-ink-700">{text(payment.provider) || '—'}</span>,
      sortValue: (payment) => text(payment.provider),
    },
    {
      key: 'created',
      header: t('admin.createdAt'),
      align: 'right',
      cell: (payment) => (
        <span className="whitespace-nowrap text-xs text-ink-500">{wireWhen(payment.createdAt)}</span>
      ),
      sortValue: (payment) => payment.createdAt?._seconds ?? payment.createdAt?.seconds ?? 0,
    },
    {
      key: 'confirmed',
      header: t('admin.confirmedAt'),
      align: 'right',
      cell: (payment) =>
        payment.confirmedAt ? (
          <span className="whitespace-nowrap text-xs text-ink-500">
            {wireWhen(payment.confirmedAt)}
          </span>
        ) : (
          <span className="text-ink-300">—</span>
        ),
      sortValue: (payment) => payment.confirmedAt?._seconds ?? payment.confirmedAt?.seconds ?? 0,
    },
    {
      key: 'bankRef',
      header: t('admin.bankReference'),
      cell: (payment) =>
        payment.providerBankTransactionId ? (
          <span className="font-mono text-xs text-ink-600">
            {payment.providerBankTransactionId}
          </span>
        ) : (
          <span className="text-ink-300">—</span>
        ),
    },
  ];

  return (
    <PanelShell kind="admin">
      <PageHeader title={t('nav.payments')} subtitle={t('admin.paymentsSubtitle')} />

      <RangePicker controls={controls} />

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label={t('admin.totalAttempted')} amount={totals.attempted} />
        <Stat label={t('admin.totalPaid')} amount={totals.paid} tone="success" />
        <Stat label={t('admin.totalRefunded')} amount={totals.refunded} tone="warning" />
        <Stat label={t('admin.totalFailed')} amount={totals.failed} />
      </div>

      <Toolbar>
        <SearchInput value={term} onChange={setTerm} placeholder={t('admin.searchPayments')} />
        <FilterSelect value={state} onChange={setState} label={t('admin.status')}>
          <option value="ALL">{t('common.all')}</option>
          {STATES.map((option) => (
            <option key={option} value={option}>
              {t(`payment.${option}`)}
            </option>
          ))}
        </FilterSelect>
      </Toolbar>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(payment) => payment.id}
        onRowClick={setDetail}
        error={loadError}
        emptyTitle={t('admin.noPayments')}
        emptyHint={t('admin.noPaymentsHint')}
      />

      {/* --- Detail ------------------------------------------------------ */}
      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.orderId ?? ''}
        subtitle={detail ? wireWhenExact(detail.createdAt) : undefined}
        footer={
          detail && refundable(detail) ? (
            <Button variant="danger" fullWidth onClick={() => openRefund(detail)}>
              <Undo2 size={16} /> {t('admin.refund')}
            </Button>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={paymentStateTone(detail.state)}>
                {t(`payment.${detail.state}`)}
              </StatusBadge>
            </div>

            <Card className="px-4 py-2">
              <Field label={t('admin.orderId')}>
                <span className="font-mono">{detail.orderId}</span>
              </Field>
              <Field label={t('cart.total')}>
                <Money amount={num(detail.amount)} />
              </Field>
              {num(detail.refundedAmount) > 0 && (
                <Field label={t('admin.refundedAmount')}>
                  <Money amount={num(detail.refundedAmount)} />
                </Field>
              )}
              <Field label={t('admin.provider')}>{text(detail.provider) || '—'}</Field>
              <Field label={t('admin.providerReference')}>
                <span className="font-mono text-xs">{detail.providerTransactionId ?? '—'}</span>
              </Field>
              <Field label={t('admin.bankReference')}>
                <span className="font-mono text-xs">
                  {detail.providerBankTransactionId ?? '—'}
                </span>
              </Field>
              <Field label={t('admin.createdAt')}>{wireWhenExact(detail.createdAt)}</Field>
              <Field label={t('admin.confirmedAt')}>
                {detail.confirmedAt ? wireWhenExact(detail.confirmedAt) : '—'}
              </Field>
            </Card>

            {detail.failureReason && (
              <Card className="p-4">
                <h3 className="mb-1 text-sm font-semibold text-danger">
                  {t('admin.failureReason')}
                </h3>
                <p className="text-sm text-ink-600">{detail.failureReason}</p>
              </Card>
            )}
          </div>
        )}
      </Drawer>

      {/* --- Refund -------------------------------------------------------- */}
      <ConfirmDialog
        open={Boolean(refunding)}
        title={t('admin.refund')}
        body={
          refunding
            ? t('admin.refundWarning', {
                orderId: refunding.orderId,
                amount: `${formatMinorUnits(num(refunding.amount) - num(refunding.refundedAmount))} ₼`,
              })
            : ''
        }
        confirmLabel={t('common.confirm')}
        busy={busy}
        onCancel={() => setRefunding(null)}
        onConfirm={() => {
          if (reason.trim().length < 10) return;
          void runRefund();
        }}
      >
        <Textarea
          label={t('admin.reasonRequired')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          hint={t('admin.reasonAudited')}
        />
        {reason.trim().length < 10 && (
          <p className="text-xs text-ink-400">{t('admin.reasonTooShort')}</p>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </ConfirmDialog>
    </PanelShell>
  );
}
