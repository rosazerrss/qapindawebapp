/**
 * QAPINDA — Deciding whether a notification is allowed to make a sound.
 *
 * WHY THIS IS NOT "THE SNAPSHOT CHANGED, SO PLAY THE SOUND"
 * --------------------------------------------------------
 * That was the first version, and it rang the same order four times in a row.
 * A Firestore listener is not an event stream: it delivers the whole window it
 * is watching, and it delivers it again on every reconnect, on every local
 * write, and whenever the SDK decides to re-emit from cache. A driver on a
 * flaky mobile connection therefore heard "new delivery" once for the delivery
 * and three more times for the network.
 *
 * So the question this file answers is not "did anything change" but "is this
 * document new *to this session*, and is it a new *moment*". Two gates:
 *
 *   1. ONE RING PER NOTIFICATION. Every document carries `notificationId`,
 *      which is `notificationDedupeKey` of the event that caused it — the same
 *      string the server used to make the write idempotent. Remember the ids
 *      this session has already seen, and a re-delivery of any of them is
 *      silent. The two ends of the system therefore agree on what "the same
 *      notification" is, because they are comparing the same string.
 *
 *   2. ONE RING PER MOMENT. "Your order is ready" and "this delivery is yours"
 *      arriving together is one thing happening, and a phone that buzzes twice
 *      for one bag is a phone that gets put in a pocket. The server already
 *      collapses that pair through `courierPickupNotification`; this collapses
 *      whatever still arrives together, by subject and within
 *      `SIMULTANEOUS_EVENT_WINDOW_MS`.
 *
 * And a third rule that is not a gate but a starting condition: the first
 * snapshot of a session never rings. It is the person's existing history — the
 * notifications that were already on screen before they opened the panel — and
 * announcing all of it at once is the loudest possible way to say nothing.
 *
 * Kept in `/shared` rather than beside the bell because it is decidable
 * business logic with no browser in it, and logic that cannot be run in a test
 * is logic nobody has checked.
 */

import type { NotificationType } from './enums';
import {
  SIMULTANEOUS_EVENT_WINDOW_MS,
  notificationTone,
  type NotificationTone,
} from './notifications';

/** The little a stored notification has to say for the sound to be decided. */
export interface RingCandidate {
  /** The dedupe key the server wrote. One ring per one of these, ever. */
  notificationId: string;
  type: NotificationType;
  /**
   * Whether this one rings, frozen at write time against the settings that
   * were in force then.
   *
   * Not recomputed here on purpose: somebody who switches the sound off should
   * not silence the notification they are already looking at, and somebody who
   * switches it on should not make yesterday's ring.
   */
  soundEnabled: boolean;
  /** What it is about — the order, or the restaurant. The "moment" it belongs to. */
  orderId?: string | null;
  restaurantId?: string | null;
}

/**
 * What one session remembers.
 *
 * Deliberately a plain mutable object rather than React state: it must survive
 * re-renders untouched, and a value that causes a render every time a snapshot
 * arrives would be a render loop wearing a hat.
 */
export interface RingMemory {
  /** False until the first snapshot has landed. Nothing rings before it does. */
  primed: boolean;
  /** Every `notificationId` this session has already been shown. */
  seen: Set<string>;
  /** Insertion order for `seen`, so the oldest can be forgotten first. */
  order: string[];
  /** When each subject last rang, so one moment cannot ring twice. */
  lastRangAt: Map<string, number>;
}

/**
 * How many ids a session remembers.
 *
 * A tab left open for a week must not grow a set forever, and forgetting the
 * oldest is safe: a notification that fell out of this window fell out of the
 * listener's window long before, so it cannot be re-delivered to ring again.
 */
const REMEMBERED_IDS = 500;

export function createRingMemory(): RingMemory {
  return { primed: false, seen: new Set(), order: [], lastRangAt: new Map() };
}

function remember(memory: RingMemory, id: string): void {
  if (memory.seen.has(id)) return;
  memory.seen.add(id);
  memory.order.push(id);

  while (memory.order.length > REMEMBERED_IDS) {
    const oldest = memory.order.shift();
    if (oldest !== undefined) memory.seen.delete(oldest);
  }
}

/**
 * What a notification is *about*, for the purpose of "is this one moment".
 *
 * The order, when there is one, so that "ready" and "assigned to you" for the
 * same bag collapse. Failing that the restaurant, and failing that the
 * notification's own id — which makes it its own moment, which is the right
 * answer for something that is about nothing else.
 */
function subjectOf(candidate: RingCandidate): string {
  return candidate.orderId || candidate.restaurantId || candidate.notificationId;
}

/**
 * The loudest of the two tones wins when several land together.
 *
 * A cancelled delivery arriving in the same breath as a support reply must
 * sound like a cancelled delivery.
 */
function loudest(tones: NotificationTone[]): NotificationTone {
  return tones.includes('alert') ? 'alert' : 'chime';
}

/**
 * Reads one snapshot and answers with the single sound it earns, if any.
 *
 * At most one tone per delivery, never a queue of them: two sounds overlapping
 * is not twice the information, it is noise. Mutates `memory` — this is the
 * session's record of what it has already said out loud, and a caller that
 * ignored the return value would still be right to have called it.
 */
export function decideRing(
  memory: RingMemory,
  delivered: RingCandidate[],
  nowMs: number,
): NotificationTone | null {
  // The first snapshot is history, not news. Learn it and stay quiet.
  if (!memory.primed) {
    memory.primed = true;
    for (const candidate of delivered) remember(memory, candidate.notificationId);
    return null;
  }

  const fresh = delivered.filter((candidate) => !memory.seen.has(candidate.notificationId));

  // Recorded before anything else is decided, so that a candidate rejected for
  // being silent can never come back and ring on the next re-delivery.
  for (const candidate of delivered) remember(memory, candidate.notificationId);

  const audible = fresh.filter((candidate) => candidate.soundEnabled);
  if (audible.length === 0) return null;

  const ringing: RingCandidate[] = [];
  const subjectsRungNow = new Set<string>();

  for (const candidate of audible) {
    const subject = subjectOf(candidate);

    // Already rang for this bag a moment ago — whether in this same snapshot or
    // in the one a few seconds before it, which is how the kitchen marking an
    // order ready lands separately from the driver being put on it.
    const previous = memory.lastRangAt.get(subject);
    if (subjectsRungNow.has(subject)) continue;
    if (previous !== undefined && nowMs - previous < SIMULTANEOUS_EVENT_WINDOW_MS) continue;

    subjectsRungNow.add(subject);
    ringing.push(candidate);
  }

  if (ringing.length === 0) return null;

  for (const subject of subjectsRungNow) memory.lastRangAt.set(subject, nowMs);

  // Old subjects are dropped once they can no longer suppress anything, so a
  // long shift does not accumulate a map of every order ever delivered.
  for (const [subject, at] of memory.lastRangAt) {
    if (nowMs - at >= SIMULTANEOUS_EVENT_WINDOW_MS) memory.lastRangAt.delete(subject);
  }

  return loudest(ringing.map((candidate) => notificationTone(candidate.type)));
}
