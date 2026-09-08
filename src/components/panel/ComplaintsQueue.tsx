'use client';

/**
 * The complaint queue a platform account works through.
 *
 * A complaint closes on three answers, and they are kept apart on purpose:
 *
 *   1. UPHELD OR NOT — a judgement about what the customer said.
 *   2. WHAT THEY GET — money back where the platform is holding it, a coupon
 *      where it never held anything, or nothing.
 *   3. DOES THE RESTAURANT STILL PAY COMMISSION — normally yes.
 *
 * There is deliberately no fourth "looking into it" state; a queue with one is
 * a queue that grows.
 *
 * (2) and (3) used to be the same switch, which meant a restaurant that sent
 * out the wrong food was billed less for having done so. They are two
 * questions and they now have two answers.
 *
 * WHAT THIS SCREEN MAY OFFER IS NOT ITS OWN DECISION
 * --------------------------------------------------
 * Whether a refund is possible depends on what the payment provider actually
 * captured, which lives on the payment document and nowhere near a browser. So
 * `listComplaints` sends the answer down with each open row, and the buttons
 * here are drawn from `allowedKinds` in `shared/compensation.ts` — the same
 * function the callable refuses with. A screen that worked it out for itself
 * would eventually offer a refund on a cash order, which is promising somebody
 * money that does not exist. There is no delivery to reverse, either: the
 * order stays delivered, and everything here is added beside that fact.
 *
 * The written reason is mandatory because it is what the audit log records and
 * what a restaurant is told when it asks, months later, why its March invoice
 * was short one order.
 *
 * The admin panel and the operator screen mount the same queue. They differ in
 * exactly one thing — see `customerContact`.
 *
 * WHY THIS ONE POLLS WHERE EVERY OTHER OPERATOR PANEL SUBSCRIBES
 * -------------------------------------------------------------
 * The owner asked for an operator screen that never needs reloading, and every
 * other list on it is now a Firestore subscription. This one cannot be:
 * `complaints` is `allow read, write: if false` in `firestore.rules`, because
 * a complaint carries the complainant's real name and telephone number and
 * nothing on a browser is trusted with those. So the list comes from a
 * callable that strips what the caller may not see — and a callable that runs
 * once and never again is exactly the staleness being fixed. It therefore
 * re-runs on a timer, and again when the operator returns to the tab, which is
 * the moment a stale queue would actually be acted on.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Phone } from 'lucide-react';

import {
  ConfirmDialog,
  DataTable,
  Drawer,
  Field,
  PageHeader,
  SearchInput,
  StatusBadge,
  Tabs,
  Toolbar,
  type Column,
  type StatusTone,
} from './ui';
import { when } from './status';
import { CustomerOrderContext } from './CustomerOrderContext';
import { useToast } from './Toast';
import { Alert, Button, Card, Input, Money, Textarea, cn } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { listComplaints, resolveComplaint } from '@/firebase/callables';
import { list, matches, num, text } from '@/lib/stored';
import { useAuth } from '@/contexts/AuthContext';
import { ComplaintStatus, type ComplaintReason, type PaymentMethod } from '@/shared/enums';
import { formatMinorUnits, parseMajorUnits } from '@/shared/pricing';
import {
  CompensationKind,
  allowedKinds,
  checkCompensation,
  compensationCap,
  compensationFunding,
  mandatoryRefund,
} from '@/shared/compensation';
import { formatPhone } from '@/shared/phone';
import { SecureImage } from '@/components/ui/Img';

/**
 * How often the queue asks again, in milliseconds.
 *
 * A minute. Complaints arrive one at a time in the hour after a delivery, not
 * in bursts, so this is already more often than the list changes.
 */
const REFRESH_MS = 60_000;

/**
 * `listComplaints` answers over the callable wire, so its timestamps arrive as
 * plain JSON: the admin SDK serialises a Timestamp as `_seconds`, never as an
 * object with `toMillis()`.
 */
interface WireTimestamp {
  _seconds?: number;
  seconds?: number;
}

interface ComplaintRow {
  orderId: string;
  orderCode: string;
  restaurantId: string;
  restaurantName: string;
  customerName: string;
  customerPhone: string;
  reason: string;
  detail: string | null;
  /** True when the profanity filter masked something in the detail above. */
  filtered?: boolean;
  photoUrls: string[];
  status: string;
  resolution: string | null;
  creditedAmount: number;
  createdAt: WireTimestamp | null;
  resolvedAt: WireTimestamp | null;

  /*
   * Sent by `listComplaints` for open complaints only, and only to platform
   * staff. Absent everywhere else, which is why every read of them goes
   * through a default: a missing `refundable` means "no money to give back",
   * which is the safe reading.
   */
  paymentMethod?: string;
  /** Captured minus already refunded, in qəpik. */
  refundable?: number;
  total?: number;

  /** What was actually done, on a complaint that has been resolved. */
  compensation?: {
    kind: string;
    amount: number;
    couponCode: string | null;
    commissionWaived: boolean;
  } | null;
}

type Tab = 'OPEN' | 'RESOLVED' | 'ALL';

/** Seconds on the wire, millis in the formatter — one place to bridge the two. */
const wireWhen = (value: WireTimestamp | null | undefined): string => {
  const seconds = value?._seconds ?? value?.seconds;
  return seconds === undefined ? '' : when({ toMillis: () => seconds * 1000 });
};

function complaintTone(status: string): StatusTone {
  switch (status) {
    case ComplaintStatus.OPEN:
      // Amber, because it is waiting on a person rather than on a process.
      return 'warning';
    case ComplaintStatus.RESOLVED_CREDITED:
      return 'success';
    default:
      return 'neutral';
  }
}

export function ComplaintsQueue({
  subtitle,
  /**
   * Whether the complainant's own name and number are shown.
   *
   * Off by default, and the operator screen leaves it off. The platform does
   * not ring customers — support is with the restaurant — so putting a dial
   * button in front of an operator would only invite the one call the platform
   * has decided it does not make. The complaint's own words, its photos and
   * the order behind it are all still there, and they are what the decision
   * actually rests on.
   */
  customerContact = false,
}: {
  subtitle: string;
  customerContact?: boolean;
}) {
  const t = useT();
  const toast = useToast();
  // The ceiling is the caller's own, read from the role the server will also
  // read — so the number on screen is the number that will be enforced.
  const { role } = useAuth();
  const cap = compensationCap(role);

  const [complaints, setComplaints] = useState<ComplaintRow[] | null>(null);
  // A failed poll used to become an empty queue saying "no complaints", which
  // is the one sentence this screen must never say when it does not know.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('OPEN');
  const [term, setTerm] = useState('');
  const [detail, setDetail] = useState<ComplaintRow | null>(null);
  const [dialog, setDialog] = useState<{ complaint: ComplaintRow; upheld: boolean } | null>(null);
  const [resolution, setResolution] = useState('');
  /** What the customer gets. Reset every time the dialog opens. */
  const [kind, setKind] = useState<CompensationKind>(CompensationKind.NONE);
  /** Typed in manat, kept as text so a half-typed "1," survives a keystroke. */
  const [amountText, setAmountText] = useState('');
  const [waiveCommission, setWaiveCommission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Written as a callback on the promise rather than as an `await`, so the
  // state change is plainly what it is: an update arriving from an external
  // system, not a synchronous write during a render or an effect.
  const reload = useCallback(() => {
    listComplaints().then((result) => {
      if (!result.ok || !result.data) {
        setComplaints([]);
        setLoadError(translateError(t, result.errorCode, result.errorDetail));
        return;
      }

      setComplaints(list<ComplaintRow>(result.data.complaints));
      setLoadError(null);
    });
  }, [t]);

  useEffect(() => {
    reload();

    const timer = setInterval(reload, REFRESH_MS);
    window.addEventListener('focus', reload);

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', reload);
    };
  }, [reload]);

  const counts = useMemo(
    () => ({
      OPEN: (complaints ?? []).filter((entry) => entry.status === ComplaintStatus.OPEN).length,
    }),
    [complaints],
  );

  const rows = useMemo(() => {
    if (!complaints) return null;
    const needle = term.trim().toLowerCase();

    return complaints
      .filter((entry) =>
        tab === 'ALL'
          ? true
          : tab === 'OPEN'
            ? entry.status === ComplaintStatus.OPEN
            : entry.status !== ComplaintStatus.OPEN,
      )
      .filter((entry) =>
        // The customer's name is matched but never rendered unless
        // `customerContact` is on: a support ticket often arrives with a name
        // attached, and letting it find the row is not the same as putting the
        // name on screen.
        matches(needle, entry.orderCode, entry.restaurantName, entry.customerName),
      );
  }, [complaints, tab, term]);

  const decide = (complaint: ComplaintRow, upheld: boolean) => {
    setError(null);
    setResolution('');
    setWaiveCommission(false);
    setAmountText('');

    /*
     * The dialog opens on the answer this order actually needs.
     *
     * Where the food never came and the platform is holding the money, a
     * refund is the only lawful outcome, so it is preselected and the other
     * choices are not offered at all. Otherwise the starting point is
     * "nothing" — compensation should be a decision somebody makes, not a
     * default they forget to turn off.
     */
    const paymentMethod = (complaint.paymentMethod ?? '') as PaymentMethod;
    const refundable = num(complaint.refundable);

    if (upheld && mandatoryRefund(complaint.reason as ComplaintReason, paymentMethod, refundable)) {
      setKind(CompensationKind.REFUND);
      setAmountText(formatMinorUnits(refundable));
    } else {
      setKind(CompensationKind.NONE);
    }

    setDialog({ complaint, upheld });
  };

  /** What this order can offer, decided by the shared rules and nothing else. */
  const offerable = (complaint: ComplaintRow): CompensationKind[] =>
    allowedKinds((complaint.paymentMethod ?? '') as PaymentMethod, num(complaint.refundable));

  /** The typed manat as qəpik, or null while the text is not a number yet. */
  const amountMinor = useMemo(() => {
    if (!amountText.trim()) return null;
    try {
      return parseMajorUnits(amountText);
    } catch {
      return null;
    }
  }, [amountText]);

  /*
   * Whether this decision may be sent, answered by the same function the server
   * refuses with. Anything that fails here would fail there — the difference is
   * only that the operator finds out before the round trip, and with the reason
   * named rather than as a validator's field path.
   */
  const verdict = useMemo(() => {
    if (!dialog) return null;

    return checkCompensation({
      kind,
      amount: amountMinor ?? 0,
      reason: dialog.complaint.reason as ComplaintReason,
      role,
      paymentMethod: (dialog.complaint.paymentMethod ?? '') as PaymentMethod,
      refundableAmount: num(dialog.complaint.refundable),
      orderTotal: num(dialog.complaint.total),
    });
  }, [dialog, kind, amountMinor, role]);

  const run = async () => {
    if (!dialog) return;

    setBusy(true);
    setError(null);

    const result = await resolveComplaint({
      orderId: dialog.complaint.orderId,
      upheld: dialog.upheld,
      resolution: resolution.trim(),
      compensation: kind,
      amount: kind === CompensationKind.NONE ? 0 : (amountMinor ?? 0),
      waiveCommission,
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    /*
     * A refund has been DECIDED, not sent.
     *
     * `resolveComplaint` records the promise; the money leaves in
     * `refundPayment`, which is the one place that talks to the provider. So
     * the operator is told, in the toast, that the payment is still theirs to
     * finish — saying "refunded" here would be the platform believing its own
     * paperwork instead of the bank.
     */
    const done = result.data?.refundPending
      ? 'complaintPanel.doneRefundPending'
      : result.data?.couponCode
        ? 'complaintPanel.doneCoupon'
        : dialog.upheld
          ? 'complaintPanel.doneUpheld'
          : 'complaintPanel.doneRejected';

    toast.show(t(done, { code: result.data?.couponCode ?? '' }));

    setDialog(null);
    setDetail(null);
    setResolution('');
    // The row's status and everything hanging off it changed on the server; a
    // reload is cheaper and more honest than patching the copy held here.
    reload();
  };

  const columns: Column<ComplaintRow>[] = [
    {
      key: 'order',
      header: t('admin.orderId'),
      width: '110px',
      cell: (entry) => (
        <span className="font-mono font-semibold text-ink-900">{text(entry.orderCode)}</span>
      ),
      sortValue: (entry) => text(entry.orderCode),
    },
    {
      key: 'reason',
      header: t('complaintPanel.reason'),
      cell: (entry) => (
        <span className="block">
          <span className="block text-ink-900">{t(`complaintReason.${entry.reason}`)}</span>
          <span className="block text-xs text-ink-400">
            {customerContact
              ? `${text(entry.restaurantName)} · ${text(entry.customerName)}`
              : text(entry.restaurantName)}
          </span>
        </span>
      ),
      sortValue: (entry) => text(entry.reason),
    },
    {
      key: 'filed',
      header: t('complaintPanel.filedAt'),
      align: 'right',
      cell: (entry) => <span className="text-xs text-ink-500">{wireWhen(entry.createdAt)}</span>,
      sortValue: (entry) => entry.createdAt?._seconds ?? entry.createdAt?.seconds ?? 0,
    },
    {
      key: 'status',
      header: t('admin.status'),
      cell: (entry) => (
        <StatusBadge tone={complaintTone(entry.status)}>
          {t(`complaintStatus.${entry.status}`)}
        </StatusBadge>
      ),
      sortValue: (entry) => text(entry.status),
    },
  ];

  const tooShort = resolution.trim().length < 10;

  return (
    <>
      <PageHeader title={t('nav.complaints')} subtitle={subtitle} />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        counts={counts}
        options={[
          { value: 'OPEN', label: t('complaintStatus.OPEN') },
          { value: 'RESOLVED', label: t('complaintPanel.tabResolved') },
          { value: 'ALL', label: t('common.all') },
        ]}
      />

      <Toolbar>
        <SearchInput value={term} onChange={setTerm} />
      </Toolbar>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(entry) => entry.orderId}
        onRowClick={setDetail}
        error={loadError}
        emptyTitle={t('complaintPanel.none')}
      />

      {/* --- Detail ---------------------------------------------------- */}
      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? t(`complaintReason.${detail.reason}`) : ''}
        subtitle={detail ? `${detail.orderCode} · ${detail.restaurantName}` : undefined}
        footer={
          detail?.status === ComplaintStatus.OPEN ? (
            <div className="flex gap-2">
              <Button fullWidth onClick={() => decide(detail, true)}>
                {t('complaintPanel.uphold')}
              </Button>
              <Button variant="secondary" fullWidth onClick={() => decide(detail, false)}>
                {t('complaintPanel.reject')}
              </Button>
            </div>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-4">
            <StatusBadge tone={complaintTone(detail.status)}>
              {t(`complaintStatus.${detail.status}`)}
            </StatusBadge>

            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold text-ink-900">
                {t('complaintPanel.detail')}
              </h3>
              <p className="whitespace-pre-line text-sm text-ink-700">
                {detail.detail || t('complaintPanel.noDetail')}
              </p>
              {/* Said plainly, so the gap in the sentence reads as moderation
                  and not as the complainant losing their thread. */}
              {detail.filtered && (
                <p className="mt-2 text-xs text-ink-400">{t('support.filteredNote')}</p>
              )}
            </Card>

            {list<string>(detail.photoUrls).length > 0 && (
              <Card className="p-4">
                <h3 className="mb-2 text-sm font-semibold text-ink-900">
                  {t('complaintPanel.photos')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {list<string>(detail.photoUrls).map((url) => (
                    // Opens the original in a new tab — this is evidence, not a
                    // gallery, so a lightbox would only get in the way. The
                    // link is made by `SecureImage` and points at the blob it
                    // fetched, so the new tab shows our own origin rather than
                    // Google's bucket and a permanent public token.
                    <SecureImage
                      key={url}
                      src={url}
                      alt=""
                      className="h-20 w-20 rounded-xl border border-ink-200 object-cover"
                    />
                  ))}
                </div>
              </Card>
            )}

            <Card className="px-4 py-2">
              {customerContact && (
                <>
                  <Field label={t('admin.customer')}>{detail.customerName}</Field>
                  <Field label={t('auth.phone')}>
                    <a
                      href={`tel:${detail.customerPhone}`}
                      className="inline-flex items-center gap-1.5 text-brand-600 underline"
                    >
                      <Phone size={13} /> {formatPhone(detail.customerPhone)}
                    </a>
                  </Field>
                </>
              )}
              <Field label={t('admin.orderId')}>
                <span className="font-mono">{detail.orderCode}</span>
              </Field>
              <Field label={t('nav.restaurants')}>{detail.restaurantName}</Field>
              <Field label={t('complaintPanel.filedAt')}>{wireWhen(detail.createdAt)}</Field>
            </Card>

            {/*
              Only for the desk, never for the restaurant.
              
              `customerContact` is already the flag that separates the two —
              a restaurant sees its own complaint and not the customer's
              telephone number, and it certainly has no business seeing what
              that customer ordered from anybody else.
            */}
            {customerContact && <CustomerOrderContext orderId={detail.orderId} />}

            {detail.status !== ComplaintStatus.OPEN && (
              <Card className="px-4 py-2">
                <Field label={t('complaintPanel.resolution')}>
                  <span className="whitespace-pre-line">{detail.resolution ?? '—'}</span>
                </Field>
                <Field label={t('complaintPanel.compensationTitle')}>
                  {detail.compensation && detail.compensation.kind !== 'NONE' ? (
                    <span>
                      {t(`complaintPanel.kind.${detail.compensation.kind}`)} ·{' '}
                      <Money amount={num(detail.compensation.amount)} />
                      {detail.compensation.couponCode ? (
                        <span className="ml-1 font-mono">{detail.compensation.couponCode}</span>
                      ) : null}
                    </span>
                  ) : (
                    '—'
                  )}
                </Field>
                <Field label={t('complaintPanel.credited')}>
                  <Money amount={num(detail.creditedAmount)} />
                </Field>
                <Field label={t('complaintPanel.resolvedAt')}>{wireWhen(detail.resolvedAt)}</Field>
              </Card>
            )}

          </div>
        )}
      </Drawer>

      {/* --- Decision -------------------------------------------------- */}
      <ConfirmDialog
        open={Boolean(dialog)}
        title={dialog ? t(dialog.upheld ? 'complaintPanel.uphold' : 'complaintPanel.reject') : ''}
        body={
          dialog
            ? t(dialog.upheld ? 'complaintPanel.upholdWarning' : 'complaintPanel.rejectWarning', {
                code: dialog.complaint.orderCode,
                name: dialog.complaint.restaurantName,
              })
            : ''
        }
        confirmLabel={t('common.confirm')}
        tone={dialog?.upheld ? 'primary' : 'danger'}
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          // Both refusals are the server's too. Catching them here means the
          // operator learns before the round trip, and in words.
          if (tooShort || !verdict?.allowed) return;
          void run();
        }}
      >
        <Textarea
          label={t('complaintPanel.resolutionLabel')}
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
          maxLength={500}
          hint={t('admin.reasonAudited')}
        />

        {tooShort && <p className="text-xs text-ink-400">{t('admin.reasonTooShort')}</p>}

        {/* Compensation is only a question when the complaint is upheld. A
            rejected complaint that still pays out is not a rejection. */}
        {dialog?.upheld && (
          <div className="space-y-3 rounded-2xl border border-card-edge bg-subtle p-3">
            <p className="text-sm font-semibold text-ink-900">
              {t('complaintPanel.compensationTitle')}
            </p>

            {/* Said plainly rather than left for the operator to infer from a
                missing button: on a cash order the platform never held the
                money, so there is nothing to send back. */}
            <p className="text-xs text-ink-500">
              {t(
                offerable(dialog.complaint).includes(CompensationKind.REFUND)
                  ? 'complaintPanel.refundAvailable'
                  : 'complaintPanel.refundUnavailable',
              )}
            </p>

            <div className="flex flex-wrap gap-2">
              {offerable(dialog.complaint).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKind(option)}
                  className={cn(
                    'h-10 rounded-xl border px-3 text-sm font-medium transition',
                    kind === option
                      ? 'border-brand-600 bg-brand-50 text-brand-700'
                      : 'border-card-edge bg-surface text-ink-600 hover:bg-ink-50',
                  )}
                >
                  {t(`complaintPanel.kind.${option}`)}
                </button>
              ))}
            </div>

            {kind !== CompensationKind.NONE && (
              <>
                <Input
                  label={`${t('complaintPanel.compensationAmount')} (₼)`}
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  inputMode="decimal"
                  placeholder="3.00"
                  hint={
                    kind === CompensationKind.COUPON
                      ? t('complaintPanel.couponFundedBy', {
                          who: t(
                            `complaintPanel.funder.${compensationFunding(
                              dialog.complaint.reason as ComplaintReason,
                            )}`,
                          ),
                        })
                      : t('complaintPanel.refundHint')
                  }
                />

                {/* The ceiling, stated before it is hit rather than after. */}
                {cap !== null && (
                  <p className="text-xs text-ink-400">
                    {t('complaintPanel.operatorCap', { amount: formatMinorUnits(cap) })}
                  </p>
                )}
              </>
            )}

            {/* The commission is its own question, and its own checkbox. Left
                off by default: the restaurant did the work, and a mistake it
                made is not a reason for the platform to carry the cost. */}
            <label className="flex items-start gap-2.5 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={waiveCommission}
                onChange={(event) => setWaiveCommission(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand-600"
              />
              <span>
                {t('complaintPanel.waiveCommission')}
                <span className="mt-0.5 block text-xs text-ink-400">
                  {t('complaintPanel.waiveCommissionHint')}
                </span>
              </span>
            </label>
          </div>
        )}

        {/* The rule that was broken, named. "VALIDATION_FAILED" tells an
            operator nothing about what to change. */}
        {verdict && !verdict.allowed && (
          <Alert tone="warning">{t(`complaintPanel.blocked.${verdict.reason}`)}</Alert>
        )}

        {error && <Alert tone="danger">{error}</Alert>}
      </ConfirmDialog>
    </>
  );
}
