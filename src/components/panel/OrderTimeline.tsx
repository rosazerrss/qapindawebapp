'use client';

/**
 * An order's own history, drawn once for every panel that asks.
 *
 * "Where did this stall" is the question support is actually being asked when
 * somebody rings about a late order, and it is answered by which step has a
 * time against it and which does not. The admin panel and the operator screen
 * both need that answer, so the drawing lives here rather than in either of
 * them — two timelines that disagree about the steps would be two different
 * stories about the same order.
 */

import { useT } from '@/i18n';
import { cn } from '@/components/ui';
import { when } from './status';
import { OrderStatus } from '@/shared/enums';
import type { Order } from '@/shared/models';

/** The steps an order walks, and the field that records each one. */
const TIMELINE: Array<{ key: keyof Order; status: OrderStatus }> = [
  { key: 'placedAt', status: OrderStatus.PLACED },
  { key: 'acceptedAt', status: OrderStatus.ACCEPTED },
  { key: 'preparingAt', status: OrderStatus.PREPARING },
  { key: 'readyAt', status: OrderStatus.READY },
  { key: 'outForDeliveryAt', status: OrderStatus.OUT_FOR_DELIVERY },
  { key: 'deliveredAt', status: OrderStatus.DELIVERED },
  { key: 'completedAt', status: OrderStatus.COMPLETED },
];

/**
 * The endings that are not on the happy path.
 *
 * Kept as its own list rather than "anything not COMPLETED", because
 * `PENDING_PAYMENT` is also not on the list above and is not an ending — it is
 * a beginning that has not finished.
 */
const ENDINGS: OrderStatus[] = [
  OrderStatus.REJECTED,
  OrderStatus.CANCELLED,
  OrderStatus.EXPIRED,
  OrderStatus.PAYMENT_FAILED,
  OrderStatus.DELIVERY_FAILED,
];

/**
 * Steps that have happened carry their time; the rest are greyed. A step with
 * no timestamp was skipped or has not come yet — either way it says so rather
 * than pretending.
 */
export function OrderTimeline({ order }: { order: Order }) {
  const t = useT();

  return (
    <ol className="relative space-y-3 pl-5">
      <span className="absolute bottom-2 left-[5px] top-2 w-px bg-ink-100" aria-hidden />

      {TIMELINE.map((step) => {
        const stamp = order[step.key] as { toMillis?: () => number } | null;
        const reached = Boolean(stamp?.toMillis);

        return (
          <li key={step.status} className="relative">
            <span
              className={cn(
                'absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white',
                reached ? 'bg-brand-600' : 'bg-ink-200',
              )}
              aria-hidden
            />
            <p className={cn('text-sm', reached ? 'text-ink-900' : 'text-ink-400')}>
              {t(`order.status.${step.status}`)}
            </p>
            {reached && <p className="text-xs text-ink-400">{when(stamp)}</p>}
          </li>
        );
      })}

      {/*
        HOW IT ENDED, WHEN IT DID NOT END WELL.
        
        The list above is the happy path and only the happy path, so a cancelled
        order's timeline used to stop halfway down in grey dots and never say
        what had happened — the reader was left to infer "it just stopped". For
        the four bad endings there is no `*At` field of their own; the fact
        lives on `cancellation.at`, or on the order's `updatedAt` for a payment
        that failed.
        
        Drawn in danger colour and last, because it IS last: nothing follows a
        terminal status, and a timeline whose final entry is red says more
        plainly than any badge that the order is over.
      */}
      {ENDINGS.includes(order.status) && (
        <li className="relative">
          <span
            className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-white"
            aria-hidden
          />
          <p className="text-sm font-medium text-danger">{t(`order.status.${order.status}`)}</p>
          {order.cancellation?.reason && (
            <p className="text-xs text-danger/80">
              {t(`order.reason.${order.cancellation.reason}`)}
              {order.cancellation.note ? ` — ${order.cancellation.note}` : ''}
            </p>
          )}
          {when(order.cancellation?.at ?? order.updatedAt) && (
            <p className="text-xs text-ink-400">
              {when(order.cancellation?.at ?? order.updatedAt)}
            </p>
          )}
        </li>
      )}
    </ol>
  );
}
