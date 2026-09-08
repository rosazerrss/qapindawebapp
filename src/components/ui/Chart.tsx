'use client';

/**
 * Two chart shapes, and no more.
 *
 * A panel needs exactly two pictures: *how the days compare* (a column per day)
 * and *who is on top* (a ranked row per name). Everything else on these screens
 * is a number, and a number is better as a number.
 *
 * Rules followed here on purpose:
 *  - One series, one hue. There is no second scale on the same axis, ever, and
 *    no legend — the title says what the bars are.
 *  - Marks are thin, the tops are rounded 4px, and every bar is anchored to the
 *    baseline. A floating bar reads as a range, which these are not.
 *  - The grid is recessive: two hairlines, no box, no ticks on every value.
 *  - Only the extremes are labelled. A number over every column is noise; the
 *    hover carries the rest.
 */

import { useState } from 'react';

import { cn } from './index';

export interface Point {
  /** The x value — a date, a name. Shown under the bar and in the tooltip. */
  label: string;
  value: number;
  /** Optional second line in the tooltip, already formatted. */
  hint?: string;
}

function niceTop(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const scaled = max / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Columns over time.
 *
 * `format` turns a raw value into what the reader should see — manat, a count,
 * a percentage. The chart never guesses at units.
 */
export function ColumnChart({
  title,
  data,
  format = (value) => String(value),
  height = 160,
  emptyLabel,
}: {
  title: string;
  data: Point[];
  format?: (value: number) => string;
  height?: number;
  emptyLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const top = niceTop(Math.max(0, ...data.map((point) => point.value)));
  const peak = data.reduce(
    (best, point, index) => (point.value > (data[best]?.value ?? -1) ? index : best),
    0,
  );

  if (data.length === 0) {
    return (
      <figure className="w-full">
        <figcaption className="mb-3 text-sm font-medium text-ink-700">{title}</figcaption>
        <p className="py-8 text-center text-sm text-ink-400">{emptyLabel ?? '—'}</p>
      </figure>
    );
  }

  return (
    <figure className="w-full">
      <figcaption className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink-700">{title}</span>
        {/* One direct label: the peak. The rest is on hover. */}
        <span className="text-xs tabular-nums text-ink-400">
          {data[peak]?.label} · {format(data[peak]?.value ?? 0)}
        </span>
      </figcaption>

      <div className="relative" style={{ height }}>
        {/* Two recessive hairlines — the scale, not a cage. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-card-edge" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-card-edge" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-ink-200" />

        <span className="pointer-events-none absolute -top-0.5 left-0 -translate-y-full text-[10px] tabular-nums text-ink-300">
          {format(top)}
        </span>

        <div className="flex h-full items-end gap-[2px]">
          {data.map((point, index) => {
            const share = top > 0 ? point.value / top : 0;

            return (
              <div
                key={`${point.label}-${index}`}
                className="group relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover((current) => (current === index ? null : current))}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                role="img"
                aria-label={`${point.label}: ${format(point.value)}`}
              >
                {/* The hit target is the whole column; the mark is thin. */}
                <div
                  className={cn(
                    'w-full rounded-t transition-colors',
                    hover === index ? 'bg-brand-600' : 'bg-brand-500',
                    point.value === 0 && 'bg-ink-100',
                  )}
                  style={{ height: `${Math.max(share * 100, point.value > 0 ? 2 : 1)}%` }}
                />

                {hover === index && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs text-white shadow-lg">
                    <span className="block font-medium">{format(point.value)}</span>
                    <span className="block text-white/70">{point.label}</span>
                    {point.hint && <span className="block text-white/70">{point.hint}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Only the ends of the axis are written out. */}
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-ink-400">
        <span>{data[0]?.label}</span>
        {data.length > 1 && <span>{data[data.length - 1]?.label}</span>}
      </div>
    </figure>
  );
}

/**
 * A ranking: one row per name, longest first.
 *
 * Horizontal because the labels are words, and a word rotated 90° is a word
 * nobody reads.
 */
export function RankChart({
  title,
  data,
  format = (value) => String(value),
  max = 6,
  emptyLabel,
}: {
  title: string;
  data: Point[];
  format?: (value: number) => string;
  max?: number;
  emptyLabel?: string;
}) {
  const rows = [...data].sort((a, b) => b.value - a.value).slice(0, max);
  const top = Math.max(1, ...rows.map((row) => row.value));

  return (
    <figure className="w-full">
      <figcaption className="mb-3 text-sm font-medium text-ink-700">{title}</figcaption>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-400">{emptyLabel ?? '—'}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-sm text-ink-600" title={row.label}>
                {row.label}
              </span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${Math.max((row.value / top) * 100, 2)}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right text-sm tabular-nums text-ink-800">
                {format(row.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}
