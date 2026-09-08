'use client';

/**
 * The customer behind one order, for whoever is deciding what to do about it.
 *
 * WHY IT IS COLLAPSED BY DEFAULT
 * ------------------------------
 * Most complaints do not need it. An operator reading "the soup was cold" does
 * not need this customer's last twenty-five orders, and putting them on screen
 * unasked buries the complaint itself under a table. It opens when somebody has
 * a question the one order cannot answer — "is this the fourth time?" — and it
 * costs a round trip only then.
 *
 * WHAT IT IS FOR
 * --------------
 * Both directions, and that is deliberate. Three failed deliveries to the same
 * address, from three different restaurants, is a customer whose address is
 * wrong and who deserves help fixing it rather than another refusal. Three
 * refunds in a fortnight, all to different addresses, is a different
 * conversation. Neither is visible from a single order, and an operator
 * deciding on one data point makes both mistakes.
 *
 * THE REQUEST NAMES AN ORDER, NEVER A CUSTOMER
 * --------------------------------------------
 * `customerOrderContext` reads the customer id from the order document
 * server-side. That is what stops this being a directory: an operator changing
 * what the browser sends can only change WHICH ORDER'S context they see, and
 * every order is already on their board. See the note at the top of
 * `functions/src/complaints/context.ts`.
 */

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, MapPin, Receipt } from 'lucide-react';

import { Alert, Card, Loading, Money, cn } from '@/components/ui';
import { CancellationLine } from './CancellationNote';
import { StatusBadge } from '@/components/panel/ui';
import { orderTone } from '@/components/panel/status';
import { useT, translateError } from '@/i18n';
import { customerOrderContext, type CustomerContext } from '@/firebase/callables';
import { formatPhone } from '@/shared/phone';

export function CustomerOrderContext({ orderId }: { orderId: string }) {
  const t = useT();

  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<CustomerContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);

    // Loaded once per order. Re-opening the same panel is free, which matters
    // because an operator comparing two things opens and closes it repeatedly.
    if (context || loading) return;

    setLoading(true);
    setError(null);

    const result = await customerOrderContext({ orderId });
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setContext(result.data);
  };

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-ink-50"
      >
        <Receipt size={15} className="shrink-0 text-ink-400" aria-hidden />
        <span className="min-w-0 flex-1 text-sm font-medium text-ink-800">
          {t('complaintPanel.contextTitle')}
        </span>
        {open ? (
          <ChevronUp size={16} className="shrink-0 text-ink-400" aria-hidden />
        ) : (
          <ChevronDown size={16} className="shrink-0 text-ink-400" aria-hidden />
        )}
      </button>

      {open && (
        <div className="border-t border-row-edge px-4 py-3">
          {loading && <Loading />}
          {error && <Alert tone="danger">{error}</Alert>}

          {context && (
            <div className="space-y-4">
              {/*
                The summary first, because it is the part that changes a
                decision. Counted on the server so two operators looking at the
                same customer cannot arrive at different arithmetic.
              */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label={t('complaintPanel.contextOrders')}
                  value={`${context.summary.orderCount}${context.summary.truncated ? '+' : ''}`}
                />
                <Stat
                  label={t('complaintPanel.contextFailed')}
                  value={String(context.summary.failedCount)}
                  tone={context.summary.failedCount > 0 ? 'warning' : undefined}
                />
                <Stat
                  label={t('complaintPanel.contextComplaints')}
                  value={String(context.summary.complaintCount)}
                  tone={context.summary.complaintCount > 1 ? 'warning' : undefined}
                />
                <Stat
                  label={t('complaintPanel.contextRefunded')}
                  value={<Money amount={context.summary.refundedTotal} />}
                  tone={context.summary.refundedTotal > 0 ? 'warning' : undefined}
                />
              </div>

              <p className="text-sm text-ink-500">
                {context.customer.name}
                {context.customer.phone ? ` · ${formatPhone(context.customer.phone)}` : ''}
              </p>

              <ul className="divide-y divide-row-edge">
                {context.orders.map((order) => (
                  <li
                    key={order.id}
                    className={cn(
                      '-mx-2 space-y-1 rounded-lg px-2 py-2.5',
                      // The order the operator came here about, marked so they
                      // can find it in a list of twenty-five.
                      order.isSubject && 'bg-brand-50',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-ink-900">
                        {order.code}
                      </span>
                      <StatusBadge tone={orderTone(order.status)}>
                        {t(`order.status.${order.status}`)}
                      </StatusBadge>
                      {/* The delivery-failure reason was already shown below;
                          a cancellation was not, so an operator reading a
                          ticket saw why one kind of bad ending happened and
                          not the other. */}
                      <CancellationLine
                        cancellation={
                          order.cancelReason
                            ? { reason: order.cancelReason, note: order.cancelNote ?? null }
                            : null
                        }
                        className="w-full text-xs text-danger"
                      />
                      {order.hasComplaint && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                          <AlertTriangle size={10} aria-hidden />
                          {t('complaintPanel.contextHadComplaint')}
                        </span>
                      )}
                      <span className="ml-auto text-sm text-ink-600">
                        <Money amount={order.total} />
                      </span>
                    </div>

                    <p className="text-sm text-ink-500">
                      {order.restaurantName}
                      {order.placedAt
                        ? ` · ${new Date(order.placedAt).toLocaleDateString()}`
                        : ''}
                    </p>

                    {/*
                      The address, and the name at the door.

                      On screen for one reason: three failures to the same line
                      is a wrong address, and that pattern is invisible unless
                      the addresses are next to each other.
                    */}
                    {order.addressLine && (
                      <p className="flex items-start gap-1.5 text-sm text-ink-500">
                        <MapPin size={12} className="mt-1 shrink-0" aria-hidden />
                        <span className="min-w-0">
                          {order.addressLine}
                          {order.contactName ? ` · ${order.contactName}` : ''}
                        </span>
                      </p>
                    )}

                    {order.failureReason && (
                      <p className="text-sm text-warning">
                        {t(`deliveryFailure.${order.failureReason}`)}
                        {order.failureNote ? ` — ${order.failureNote}` : ''}
                      </p>
                    )}

                    {order.refundedAmount > 0 && (
                      <p className="text-sm text-ink-600">
                        {t('complaintPanel.contextRefunded')}:{' '}
                        <Money amount={order.refundedAmount} />
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'warning';
}) {
  return (
    <div className="rounded-xl bg-ink-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
      <p className={cn('text-base font-semibold', tone === 'warning' ? 'text-warning' : 'text-ink-900')}>
        {value}
      </p>
    </div>
  );
}
