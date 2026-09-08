'use client';

/**
 * A single figure.
 *
 * Not a chart: one number, its name, and at most one line of context. A chart
 * with one bar is a worse way of showing one number.
 */

import type { LucideIcon } from 'lucide-react';

import { Card, Money, cn } from '@/components/ui';

export function Stat({
  label,
  amount,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  /** Money in qəpik. Use this *or* `value`, never both. */
  amount?: number;
  value?: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: 'default' | 'brand' | 'success' | 'warning';
}) {
  const tones = {
    default: 'text-ink-900',
    brand: 'text-brand-700',
    success: 'text-success',
    warning: 'text-warning',
  } as const;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ink-500">{label}</p>
        {Icon && <Icon size={16} className="mt-0.5 shrink-0 text-ink-300" />}
      </div>

      <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums', tones[tone])}>
        {value !== undefined ? value : <Money amount={amount ?? 0} />}
      </p>

      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </Card>
  );
}
