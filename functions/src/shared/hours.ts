/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — When a restaurant is open.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The same twenty lines were written twice — once in `services/catalog.ts` for
 * the shopfront and once in `orders/jobs.ts` for the job that alerts an
 * operator about a shop closed during its own hours — and the two had already
 * begun to differ in how they handled a shift running past midnight. Two
 * answers to "is this restaurant open" is one answer too many: the customer's
 * screen offers an order the server refuses, or the operator is alerted about a
 * shop the customer can see is shut.
 *
 * TWO SHIFTS IN A DAY, WITHOUT A MIGRATION
 * ----------------------------------------
 * A kitchen that serves lunch 10:00–14:00 and dinner 17:00–02:00 could not say
 * so: the lookup took the FIRST row it found for a weekday and ignored the
 * rest, so a second row was silently dead. Nothing about the stored shape had
 * to change to fix it — `OpeningHours` was always a list — only the reading of
 * it. Every restaurant on the platform has exactly one row per day and behaves
 * exactly as before; a restaurant that adds a second row is now open twice.
 *
 * MIDNIGHT
 * --------
 * A shift that runs into the next day is written with `closesAt` past 1440 —
 * two in the morning is 1560, not 120. So "am I open now" also has to look at
 * YESTERDAY's rows, which is what stops a kitchen serving until two being
 * reported as shut from midnight every night.
 *
 * BAKU HAS NO DAYLIGHT SAVING, so the offset is a constant rather than a
 * timezone library. If that ever changes this is the one place to fix.
 */

import type { OpeningHours } from './models';

/** UTC+4, all year. */
const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;

/** Minutes in a day. A `closesAt` above this runs into tomorrow. */
export const MINUTES_IN_DAY = 1440;

export interface LocalMoment {
  /** 0 = Sunday … 6 = Saturday, in Baku. */
  day: number;
  /** Minutes since local midnight. */
  minutes: number;
}

/** Where in the week Baku is at this instant. */
export function bakuMoment(at: Date = new Date()): LocalMoment {
  const local = new Date(at.getTime() + BAKU_OFFSET_MS);
  return {
    day: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** Every shift written for one weekday. Usually one; may be two. */
export function shiftsFor(hours: OpeningHours[] | undefined | null, day: number): OpeningHours[] {
  return (hours ?? []).filter((entry) => entry.day === day && !entry.closed);
}

/**
 * Do the restaurant's own hours say it should be serving right now?
 *
 * Says nothing about `status` or `serviceState` — a suspended restaurant and a
 * paused one are shut for reasons that have nothing to do with the clock, and
 * mixing those in here is what made two copies of this function disagree.
 * Callers combine the two; see `isOpenNow` in `services/catalog.ts`.
 */
export function isOpenByHours(
  hours: OpeningHours[] | undefined | null,
  at: Date = new Date(),
): boolean {
  const { day, minutes } = bakuMoment(at);

  // Every shift today, not merely the first one written.
  for (const shift of shiftsFor(hours, day)) {
    if (minutes >= shift.opensAt && minutes < shift.closesAt) return true;
  }

  // A shift that started yesterday and has not finished. Two in the morning is
  // 1560 on yesterday's row, so it is still 1560 - 1440 = 120 minutes of today.
  const yesterday = (day + 6) % 7;
  for (const shift of shiftsFor(hours, yesterday)) {
    if (shift.closesAt > MINUTES_IN_DAY && minutes < shift.closesAt - MINUTES_IN_DAY) return true;
  }

  return false;
}

export type HoursProblem =
  | 'ends-before-it-starts'
  | 'too-long'
  | 'overlap'
  | 'too-many-shifts';

/**
 * What is wrong with one day's shifts, or null.
 *
 * Used by the panel before saving and by the server before storing, from this
 * one function, so a restaurant cannot be told its hours are fine by one and
 * refused by the other.
 */
export function checkDayShifts(shifts: OpeningHours[]): HoursProblem | null {
  const open = shifts.filter((shift) => !shift.closed);
  if (open.length === 0) return null;
  // Two is lunch and dinner. Three is a form nobody fills in correctly.
  if (open.length > 2) return 'too-many-shifts';

  for (const shift of open) {
    if (shift.closesAt <= shift.opensAt) return 'ends-before-it-starts';
    // A "shift" longer than a day is a typo, not a restaurant.
    if (shift.closesAt - shift.opensAt > MINUTES_IN_DAY) return 'too-long';
  }

  if (open.length === 2) {
    const [first, second] = [...open].sort((a, b) => a.opensAt - b.opensAt);
    // Overlapping shifts are not wrong so much as meaningless — and they make
    // "when does the lunch service end" unanswerable on the restaurant page.
    if (second.opensAt < first.closesAt) return 'overlap';
  }

  return null;
}
