'use client';

import { Check } from 'lucide-react';

import { useT } from '@/i18n';
import { Badge, cn } from '@/components/ui';
import { trackingStep } from '@/shared/orderState';
import { OrderStatus } from '@/shared/enums';

/**
 * The four-step tracker.
 *
 * `trackingStep` returns null for an unhappy ending, and the bar disappears
 * rather than pretending a cancelled order is 25% delivered.
 */
export function OrderStatusBar({ status }: { status: OrderStatus }) {
  const t = useT();
  const step = trackingStep(status);

  if (step === null) {
    const tone =
      status === OrderStatus.CANCELLED || status === OrderStatus.REJECTED ? 'danger' : 'warning';
    return <Badge tone={tone}>{t(`order.status.${status}`)}</Badge>;
  }

  const labels = [
    t('order.steps.placed'),
    t('order.steps.accepted'),
    t('order.steps.onTheWay'),
    t('order.steps.delivered'),
  ];

  return (
    <div>
      <div className="flex items-center">
        {labels.map((label, index) => {
          const done = index <= step;
          return (
            <div key={label} className="flex flex-1 items-center last:flex-none">
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition',
                  done ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-500',
                )}
              >
                {done ? <Check size={14} strokeWidth={3} /> : index + 1}
              </div>
              {index < labels.length - 1 && (
                <div
                  className={cn(
                    'mx-1 h-0.5 flex-1 rounded transition',
                    index < step ? 'bg-brand-600' : 'bg-ink-200',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/*
        THE LABELS SIT UNDER THEIR OWN DOT.

        This was a `justify-between` row of loose spans, which lines the first
        label up with the first dot, the last with the last, and nothing else
        with anything. It also let neighbouring words run into each other at
        320px — "Hazırlanır"/"Yolda" overlapped on the narrowest phones sold in
        this market.

        A grid with one equal column per step puts every label under its dot by
        construction, and centring inside the column keeps it there at any
        width. `break-words` is the last resort for a translation longer than
        its column: wrapped is legible, clipped is not.
      */}
      <div
        className="mt-2 grid text-[11px] text-ink-400"
        style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}
      >
        {labels.map((label, index) => (
          <span
            key={label}
            className={cn(
              'break-words px-0.5 text-center',
              // First and last hug their ends, so the row's outer edges line up
              // with the outer dots rather than floating inside them.
              index === 0 && 'text-left',
              index === labels.length - 1 && 'text-right',
              index <= step && 'font-medium text-ink-700',
            )}
          >
            {label}
          </span>
        ))}
      </div>

      {/*
        Announced, not just drawn.

        The status changes underneath a customer who is watching the page — that
        is the whole point of the screen — and a screen-reader user was told
        nothing at all when it did. `polite` waits for a pause rather than
        interrupting, which is right for "your order is on the way".
      */}
      <p aria-live="polite" className="mt-3 font-medium text-ink-900">
        {t(`order.status.${status}`)}
      </p>
    </div>
  );
}
