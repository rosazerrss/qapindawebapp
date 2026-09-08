/**
 * QAPINDA — Whether the kitchen should be hearing an alarm right now.
 *
 * WHY THIS IS BOUND TO THE ORDER AND NOT TO A CLICK
 * -------------------------------------------------
 * The first version stopped the sound in the handler behind "Qəbul et". It was
 * wrong in three ways at once and each of them costs a restaurant an order:
 *
 *   - a manager accepting the order on the till's tablet left the alarm ringing
 *     on the kitchen's screen, because that screen never saw the click;
 *   - an order expiring on its own left the alarm ringing forever, because
 *     nothing clicked at all;
 *   - a second tab of the same panel rang a second alarm.
 *
 * So the question this file answers is not "did somebody press accept" but "is
 * there an order sitting in PLACED". That is a fact about the ORDER, it arrives
 * on every device through the same live query, and it becomes false the instant
 * the status moves — whoever moved it, wherever they were, and whether or not
 * that device is the one making the noise.
 *
 * ONE ALARM, NOT ONE PER EVENT
 * ----------------------------
 * Two events for one order — the order document and its notification, or two
 * snapshots of the same second — must be one alarm. That falls out of the shape
 * of the answer: this returns a single boolean about the whole panel, so there
 * is nothing to double. `answered` is the second guard, for the case a listener
 * re-delivers a window that still contains an order somebody has since dealt
 * with: an id that has once left the pending set never rings again.
 *
 * SILENCING IS NOT DELETING
 * -------------------------
 * `soundEnabled` reaches this and nothing else. With the sound off the order
 * still arrives, the panel still counts it in the new-order column, the
 * notification is still written and still listed in the bell, and push still
 * works. The only thing that changes is that the room is quiet.
 *
 * Kept in `/shared` because it is decidable logic with no browser in it, and
 * logic that cannot be run in a test is logic nobody has checked.
 */

/** What one panel session remembers between snapshots. */
export interface AlarmMemory {
  /**
   * Every order id that has been in the pending set and has since left it.
   *
   * A re-delivery of an old snapshot cannot make one of these ring again, which
   * is what "that order never alarms again" means in a system where the
   * listener is free to hand back the same document at any time.
   */
  answered: Set<string>;
  /** The pending ids as of the last snapshot, so departures can be spotted. */
  pending: Set<string>;
}

export function createAlarmMemory(): AlarmMemory {
  return { answered: new Set(), pending: new Set() };
}

/**
 * How many answered ids one session remembers.
 *
 * A busy restaurant works a few hundred orders in an evening and the set is
 * only ids. Forgetting the oldest is safe for the same reason it is safe in the
 * ring memory: an order that fell out of this window fell out of the panel's
 * live query long before, so it cannot come back to ring.
 */
const REMEMBERED_ORDERS = 500;

/**
 * Reads one snapshot of the pending orders and answers with the alarm's state.
 *
 * Mutates `memory` — this is the session's record of which orders have been
 * dealt with — and returns whether the alarm should be sounding *now*. The
 * caller's job is only to make the world match that answer, which is what makes
 * a status change on another device stop the sound here: the next snapshot
 * simply does not contain the order any more.
 */
export function decideNewOrderAlarm(
  memory: AlarmMemory,
  pendingOrderIds: string[],
  soundEnabled: boolean,
): boolean {
  const incoming = new Set(pendingOrderIds);

  // Anything that was pending and is not any more has been dealt with — by this
  // device, by the till, by a courier screen, or by the expiry job. All four are
  // the same fact and none of them is a click.
  for (const id of memory.pending) {
    if (!incoming.has(id)) memory.answered.add(id);
  }
  memory.pending = incoming;

  while (memory.answered.size > REMEMBERED_ORDERS) {
    const oldest = memory.answered.values().next();
    if (oldest.done) break;
    memory.answered.delete(oldest.value);
  }

  // Read AFTER the memory is updated, so that a snapshot which both answers one
  // order and brings a new one still rings for the new one.
  if (!soundEnabled) return false;

  return pendingOrderIds.some((id) => !memory.answered.has(id));
}

// ---------------------------------------------------------------------------
// WHEN the ring repeats
// ---------------------------------------------------------------------------

/**
 * WHY THE REPEAT IS NOT A `setInterval`.
 *
 * It was one, and that is the second half of "zəng bəzən gecikir və ya heç
 * çalmır". Every browser clamps timers in a hidden tab to about one call a
 * minute, so a panel left open on the counter while somebody serves a customer
 * rang once and then went quiet for a minute at a time — which is most of a
 * restaurant's response window spent in silence.
 *
 * The audio clock is not throttled. So the bursts are SCHEDULED onto it, a
 * couple of minutes ahead, and a timer is used only to top the schedule up. A
 * timer that fires late — even a full minute late — then costs nothing, because
 * the rings it was going to arrange were already arranged. This is the same
 * trick a metronome uses, and the numbers below are chosen so that the worst
 * throttling a browser applies is still comfortably inside the horizon.
 *
 * These live in `/shared` rather than beside the oscillators because "does the
 * schedule still cover the next minute" is arithmetic, and arithmetic in a file
 * that needs an `AudioContext` to run is arithmetic nobody has tested.
 */

/** Seconds from the start of one burst to the start of the next. */
export const ALARM_INTERVAL_SECONDS = 5;

/** How far ahead of the audio clock bursts are scheduled. */
export const ALARM_HORIZON_SECONDS = 120;

/**
 * How often the schedule is topped up, in milliseconds.
 *
 * Well under the horizon on purpose: a hidden tab may hold this back to once a
 * minute, and even two consecutive minutes of throttling leave the schedule
 * covered.
 */
export const ALARM_TOP_UP_MS = 20_000;

/** A hair in front of "now", so a burst is never scheduled into the past. */
const ALARM_LEAD_SECONDS = 0.05;

export interface AlarmSchedule {
  /** Audio-clock times, in seconds, at which a burst should start. */
  times: number[];
  /** The clock time the schedule now reaches — the next burst after the last. */
  scheduledUntil: number;
}

/**
 * The bursts that still have to be booked to keep the alarm covered.
 *
 * `scheduledUntil` is where the previous call left off; pass 0 when the alarm
 * has just started or has just been re-synced after the tab came back. The
 * cadence is preserved across calls — a top-up does not restart the rhythm — and
 * a schedule that has fallen behind the clock (a context that was suspended for
 * a while and then resumed) is picked up from the present rather than replayed.
 */
export function alarmBurstsToSchedule(
  now: number,
  scheduledUntil: number,
  horizonSeconds: number = ALARM_HORIZON_SECONDS,
  intervalSeconds: number = ALARM_INTERVAL_SECONDS,
): AlarmSchedule {
  const times: number[] = [];
  const earliest = now + ALARM_LEAD_SECONDS;
  const horizon = now + horizonSeconds;

  let at = scheduledUntil > earliest ? scheduledUntil : earliest;

  while (at <= horizon) {
    times.push(at);
    at += intervalSeconds;
  }

  return { times, scheduledUntil: at };
}

/**
 * Whether a sound played right now would actually be heard.
 *
 * Four answers rather than a boolean, because the restaurant has to be told
 * something different in each case: `ready` needs no words, `needsGesture` is
 * fixed by one tap on a button the panel can show, `unavailable` is a browser
 * that will not make a noise at all — which is a warning, not a prompt — and
 * `unknown` is the panel keeping its mouth shut. Silence that nobody knows
 * about is the worst outcome, so the panel renders something for the middle
 * two; it renders NOTHING for `unknown`.
 *
 * WHY `unknown` EXISTS AT ALL
 * ---------------------------
 * The owner's complaint, in capitals: "SES SÖNDÜRÜLÜB YAZISI ÇIXIR ... BİRDEFE
 * AKTİV ETDİKDE BES ETSİN ÇIXMASIN". The strip was coming back on every screen
 * because the old answer had no way to say "I have not asked the browser yet"
 * — an unasked browser and a refusing browser both came out as `needsGesture`,
 * so a freshly rendered panel accused every browser of being muted before it
 * had tried to make a sound. `probed` is that missing distinction.
 *
 * `activatedBefore` is the other half. Once somebody has pressed the button in
 * this browser the fact is remembered (in `localStorage`, by the caller), and
 * from then on a context that happens to be asleep — a reload, a tab that was
 * in the background — is not something to nag about: the very next click
 * anywhere in the app resumes it, silently. So it reports `unknown` rather
 * than asking a second time for a permission that was already given.
 */
export type AlarmSoundState = 'unknown' | 'ready' | 'needsGesture' | 'unavailable';

export function alarmSoundState(input: {
  /** False when the browser has no `AudioContext` at all, or refused to build one. */
  supported: boolean;
  /** Whether a user gesture has already unlocked audio in this session. */
  unlocked: boolean;
  /** The context's own state, or null when there is not one yet. */
  contextState: 'suspended' | 'running' | 'closed' | 'interrupted' | null;
  /**
   * Whether the browser has actually been asked yet. Before it has, nothing at
   * all is claimed — `supported` and `contextState` are defaults, not answers.
   */
  probed: boolean;
  /** Whether this browser has been through the activation once already. */
  activatedBefore: boolean;
}): AlarmSoundState {
  // An unasked browser is not a muted one. Nothing is said until we know.
  if (!input.probed) return 'unknown';

  if (!input.supported) return 'unavailable';
  if (input.contextState === 'closed') return 'unavailable';

  if (input.unlocked && input.contextState === 'running') return 'ready';

  // Suspended after an unlock is what a backgrounded tab looks like on most
  // platforms, and on some it never comes back on its own. For a browser that
  // has never been activated that is worth a prompt; for one that has, the
  // next interaction resumes it and the person has already done their part.
  if (input.activatedBefore) return 'unknown';

  return 'needsGesture';
}
