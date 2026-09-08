'use client';

/**
 * When the kitchen is open — including the days it opens twice.
 *
 * WHY IT IS GROUPED BY DAY RATHER THAN BY ROW
 * -------------------------------------------
 * The stored shape is a flat list of `{ day, opensAt, closesAt, closed }`, and
 * the old form rendered it one row per entry, keyed by the weekday. That worked
 * only while a day could have exactly one row — which is precisely the
 * limitation being removed here. A restaurant serving lunch 10:00–14:00 and
 * dinner 17:00–02:00 has two entries for Tuesday, and two React children keyed
 * `2` is a bug rather than a feature.
 *
 * So the editor groups: seven days, each holding one or two shifts. The list it
 * hands back is still flat, because nothing downstream had to change — the
 * lookup in `shared/hours.ts` reads every row for a day rather than the first.
 *
 * TWO SHIFTS, NOT THREE
 * ---------------------
 * Two is lunch and dinner, which is the shape restaurants actually have. Three
 * is a form people fill in wrong, and every extra row is another chance to
 * leave an overlap that makes "when does lunch end" unanswerable on the
 * restaurant's own page.
 *
 * PAST MIDNIGHT
 * -------------
 * A closing time earlier than the opening time means tomorrow, and is stored as
 * minutes past 1440 — two in the morning is 1560. The conversion happens on the
 * way in, so nothing below this component ever has to think about it, and the
 * row says "(next day)" so the restaurant can see what it just agreed to.
 */

import { Plus, Trash2 } from 'lucide-react';

import { useT } from '@/i18n';
import { Alert, cn } from '@/components/ui';
import { MINUTES_IN_DAY, checkDayShifts } from '@/shared/hours';
import type { OpeningHours } from '@/shared/models';

const DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Minutes since midnight → "17:00". Past midnight wraps for display only. */
function toTime(minutes: number): string {
  const wrapped = minutes % MINUTES_IN_DAY;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

function fromTime(value: string, fallback: number): number {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return hours * 60 + minutes;
}

export function OpeningHoursEditor({
  hours,
  onChange,
}: {
  hours: OpeningHours[];
  onChange: (next: OpeningHours[]) => void;
}) {
  const t = useT();
  const dayNames = t('restaurantPanel.days').split('|');

  const shiftsOf = (day: number) => hours.filter((entry) => entry.day === day);

  /** Replaces every row for one day, leaving the other six untouched. */
  const setDay = (day: number, shifts: OpeningHours[]) => {
    onChange([...hours.filter((entry) => entry.day !== day), ...shifts]);
  };

  const patchShift = (day: number, index: number, patch: Partial<OpeningHours>) => {
    setDay(
      day,
      shiftsOf(day).map((shift, at) => (at === index ? { ...shift, ...patch } : shift)),
    );
  };

  return (
    <div className="space-y-3">
      {DAYS.map((day) => {
        const shifts = shiftsOf(day);
        const closed = shifts.length === 0 || shifts.every((shift) => shift.closed);
        const problem = checkDayShifts(shifts);

        return (
          <div
            key={day}
            className="rounded-2xl border border-card-edge bg-subtle p-3 shadow-[0_1px_2px_rgb(38_36_35/0.05)]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink-800">{dayNames[day]}</span>

              <label className="flex items-center gap-1.5 text-sm text-ink-500">
                <input
                  type="checkbox"
                  checked={!closed}
                  onChange={(event) => {
                    if (!event.target.checked) {
                      // Closed keeps ONE row rather than none: the times the
                      // restaurant had are still there when they re-open, which
                      // is what somebody closing for a public holiday expects.
                      setDay(day, [
                        { ...(shifts[0] ?? { opensAt: 600, closesAt: 1320 }), day, closed: true },
                      ]);
                      return;
                    }
                    setDay(day, [
                      { ...(shifts[0] ?? { opensAt: 600, closesAt: 1320 }), day, closed: false },
                    ]);
                  }}
                  className="h-4 w-4 accent-brand-600"
                />
                {t('restaurantPanel.open')}
              </label>
            </div>

            {!closed && (
              <div className="mt-2 space-y-2">
                {shifts.map((shift, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      value={toTime(shift.opensAt)}
                      onChange={(event) =>
                        patchShift(day, index, {
                          opensAt: fromTime(event.target.value, shift.opensAt),
                        })
                      }
                      className="rounded-lg border border-card-edge bg-surface px-2 py-1.5 text-sm"
                    />

                    <span className="text-ink-400">–</span>

                    <input
                      type="time"
                      value={toTime(shift.closesAt)}
                      onChange={(event) => {
                        const parsed = fromTime(event.target.value, shift.closesAt);
                        // Earlier than the opening means tomorrow. Converted
                        // here so nothing downstream deals in wall clocks.
                        patchShift(day, index, {
                          closesAt: parsed <= shift.opensAt ? parsed + MINUTES_IN_DAY : parsed,
                        });
                      }}
                      className="rounded-lg border border-card-edge bg-surface px-2 py-1.5 text-sm"
                    />

                    {shift.closesAt > MINUTES_IN_DAY && (
                      <span className="text-xs text-ink-400">
                        ({t('restaurantPanel.nextDay')})
                      </span>
                    )}

                    {/* Only the second shift can go. Removing the first would
                        leave a day open with no hours, which is not a state
                        anybody means. */}
                    {shifts.length > 1 && (
                      <button
                        type="button"
                        aria-label={t('restaurantPanel.removeShift')}
                        onClick={() => setDay(day, shifts.filter((_, at) => at !== index))}
                        className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-danger"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}

                {shifts.length < 2 && (
                  <button
                    type="button"
                    onClick={() =>
                      setDay(day, [
                        ...shifts,
                        // Starting after the first shift ends, so the default
                        // is already valid rather than an overlap to fix.
                        {
                          day,
                          opensAt: Math.min((shifts[0]?.closesAt ?? 840) + 120, 1380),
                          closesAt: Math.min((shifts[0]?.closesAt ?? 840) + 480, 1439),
                          closed: false,
                        },
                      ])
                    }
                    className={cn(
                      'flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium',
                      'text-brand-600 transition hover:bg-brand-50',
                    )}
                  >
                    <Plus size={15} /> {t('restaurantPanel.addShift')}
                  </button>
                )}

                {/* Named rather than left for the save to refuse: "overlap" is
                    a thing the restaurant can see and fix in one glance. */}
                {problem && (
                  <Alert tone="warning">{t(`restaurantPanel.hoursProblem.${problem}`)}</Alert>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
