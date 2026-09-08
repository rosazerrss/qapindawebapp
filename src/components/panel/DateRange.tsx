'use client';

/**
 * One date-range control, shared by every report screen.
 *
 * Both panels ask the same question — "which days?" — so they ask it with the
 * same three buttons in the same place. A month, a year, or two typed dates.
 *
 * The hook returns a *derived* range and a stable `key` for it. Screens load on
 * the key rather than on the object, because the object is new on every render
 * and would re-fetch forever.
 */

import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';

import { Alert, Card, Input, Select, cn } from '@/components/ui';
import { useT } from '@/i18n';

export type RangeMode = 'month' | 'year' | 'custom';

export interface DateRange {
  from: number;
  to: number;
}

function monthRange(year: number, month: number): DateRange {
  return {
    from: new Date(year, month, 1, 0, 0, 0, 0).getTime(),
    to: new Date(year, month + 1, 0, 23, 59, 59, 999).getTime(),
  };
}

function yearRange(year: number): DateRange {
  return {
    from: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
    to: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
  };
}

function dayStart(value: string): number | null {
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0).getTime();
}

export function isoDay(millis: number): string {
  const date = new Date(millis);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** `2026-08-24` → `24 Avq` — short enough to sit under a bar. */
export function shortDay(day: string, months: string[]): string {
  const [, month, date] = day.split('-').map(Number);
  if (!month || !date) return day;
  return `${date} ${(months[month - 1] ?? '').slice(0, 3)}`;
}

export function useDateRange(initial: RangeMode = 'month') {
  const now = useMemo(() => new Date(), []);

  const [mode, setMode] = useState<RangeMode>(initial);
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [from, setFrom] = useState(() => isoDay(monthRange(now.getFullYear(), now.getMonth()).from));
  const [to, setTo] = useState(() => isoDay(now.getTime()));

  const range = useMemo<DateRange | null>(() => {
    if (mode === 'year') return yearRange(year);
    if (mode === 'month') return monthRange(year, month);

    const start = dayStart(from);
    const end = dayStart(to);
    if (start === null || end === null) return null;

    const finish = end + 24 * 60 * 60 * 1000 - 1;
    return finish <= start ? null : { from: start, to: finish };
  }, [mode, year, month, from, to]);

  return {
    range,
    key: range ? `${range.from}:${range.to}` : '',
    controls: {
      mode,
      setMode,
      month,
      setMonth,
      year,
      setYear,
      from,
      setFrom,
      to,
      setTo,
      years: [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2],
      valid: range !== null,
    },
  };
}

export type RangeControls = ReturnType<typeof useDateRange>['controls'];

export function RangePicker({ controls }: { controls: RangeControls }) {
  const t = useT();
  const months = t('sales.months').split('|');

  return (
    <Card className="mb-5 p-4">
      <div className="mb-3 flex items-center gap-2 text-ink-500">
        <CalendarRange size={17} />
        <span className="text-sm font-medium">{t('sales.range')}</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {(['month', 'year', 'custom'] as RangeMode[]).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => controls.setMode(entry)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm font-medium transition',
              controls.mode === entry
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300',
            )}
          >
            {t(`sales.${entry}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {controls.mode === 'month' && (
          <Select
            label={t('sales.month')}
            value={String(controls.month)}
            onChange={(event) => controls.setMonth(Number(event.target.value))}
          >
            {months.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </Select>
        )}

        {controls.mode !== 'custom' && (
          <Select
            label={t('sales.year')}
            value={String(controls.year)}
            onChange={(event) => controls.setYear(Number(event.target.value))}
          >
            {controls.years.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </Select>
        )}

        {controls.mode === 'custom' && (
          <>
            <Input
              type="date"
              label={t('sales.from')}
              value={controls.from}
              onChange={(event) => controls.setFrom(event.target.value)}
            />
            <Input
              type="date"
              label={t('sales.to')}
              value={controls.to}
              onChange={(event) => controls.setTo(event.target.value)}
            />
          </>
        )}
      </div>

      {!controls.valid && (
        <div className="mt-3">
          <Alert tone="warning">{t('sales.badRange')}</Alert>
        </div>
      )}
    </Card>
  );
}
