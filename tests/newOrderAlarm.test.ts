import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  ALARM_HORIZON_SECONDS,
  ALARM_INTERVAL_SECONDS,
  ALARM_TOP_UP_MS,
  alarmBurstsToSchedule,
  alarmSoundState,
  createAlarmMemory,
  decideNewOrderAlarm,
} from '../shared/newOrderAlarm';

/**
 * The kitchen alarm, executed.
 *
 * Every case below is a way a restaurant loses an order, and none of them is
 * visible on a screenshot: an alarm that never starts, an alarm that never
 * stops, two alarms for one order, and an alarm that a manager on the till
 * cannot silence from where they are standing. The last one is why the alarm is
 * bound to the order's status rather than to a click, and it is the assertion
 * this file exists for.
 */

describe('the new-order alarm', () => {
  it('rings while an order is waiting', () => {
    const memory = createAlarmMemory();
    expect(decideNewOrderAlarm(memory, ['order-1'], true)).toBe(true);
  });

  it('is silent when nothing is waiting', () => {
    const memory = createAlarmMemory();
    expect(decideNewOrderAlarm(memory, [], true)).toBe(false);
  });

  it('stops the moment the order leaves the pending state', () => {
    /*
     * "Qəbul et" is not in this test, and that is the whole point. The panel
     * does not tell the alarm that somebody pressed a button; the order simply
     * stops being PLACED, and the next snapshot does not contain it. That is
     * why a manager accepting on the till silences the kitchen's screen too.
     */
    const memory = createAlarmMemory();
    expect(decideNewOrderAlarm(memory, ['order-1'], true)).toBe(true);
    expect(decideNewOrderAlarm(memory, [], true)).toBe(false);
  });

  it('never rings again for an order that has been dealt with', () => {
    // A Firestore listener re-delivers its window freely. An old snapshot that
    // still contains an answered order must not restart the alarm.
    const memory = createAlarmMemory();
    decideNewOrderAlarm(memory, ['order-1'], true);
    decideNewOrderAlarm(memory, [], true);

    expect(decideNewOrderAlarm(memory, ['order-1'], true)).toBe(false);
  });

  it('keeps ringing for a second order while the first is answered', () => {
    const memory = createAlarmMemory();
    decideNewOrderAlarm(memory, ['order-1'], true);
    expect(decideNewOrderAlarm(memory, ['order-2'], true)).toBe(true);
  });

  it('is one alarm however many events arrive for one order', () => {
    /*
     * Two events for the same order ring once. It is a single boolean about the
     * whole panel rather than a queue of sounds, so there is nothing to double:
     * re-delivering the same order, twice in a row, is still "yes, ring".
     */
    const memory = createAlarmMemory();
    expect(decideNewOrderAlarm(memory, ['order-1'], true)).toBe(true);
    expect(decideNewOrderAlarm(memory, ['order-1'], true)).toBe(true);
    expect(decideNewOrderAlarm(memory, ['order-1', 'order-1'], true)).toBe(true);
  });

  it('is silent when the sound is switched off, and the orders are still there', () => {
    /*
     * Silencing is not deleting. The alarm goes quiet; the pending ids this was
     * asked about are untouched, and everything drawn from them — the new-order
     * column, its count, the notification in the bell, the stored record — is
     * drawn from the orders themselves and not from this answer.
     */
    const memory = createAlarmMemory();
    const pending = ['order-1', 'order-2'];

    expect(decideNewOrderAlarm(memory, pending, false)).toBe(false);
    expect(pending).toEqual(['order-1', 'order-2']);

    // And switching it back on, with the same orders still waiting, rings.
    expect(decideNewOrderAlarm(memory, pending, true)).toBe(true);
  });

  it('an order answered while the sound was off does not ring when it comes back on', () => {
    const memory = createAlarmMemory();
    decideNewOrderAlarm(memory, ['order-1'], false);
    decideNewOrderAlarm(memory, [], false);

    expect(decideNewOrderAlarm(memory, ['order-1'], true)).toBe(false);
  });
});

describe('a new order RINGS, it does not chime', () => {
  /*
   * "RESTORANA SİFARİŞ GELDİKDE ZİL SESİ KİMİ ÇIXSIN BİLDİRİŞ SESİ KİMİ
   * ÇIXMASIN". The sound itself is Web Audio and cannot be executed here — but
   * what the alarm CALLS can be, and the regression worth catching is the easy
   * one: somebody simplifying `startNotificationAlarm` back to
   * `playNotificationTone('alert')`, which is the ordinary notification tone
   * and is exactly what the owner asked for it not to be.
   */
  const source = readFileSync('src/lib/notificationSound.ts', 'utf8');
  const alarm = source.slice(source.indexOf('function burst('));

  it('drives the alarm with the ring and not with a notification tone', () => {
    expect(alarm).toContain('ring(audio,');
    expect(alarm).not.toContain("playNotificationTone('alert')");
    expect(alarm).not.toContain("playNotificationTone('chime')");
  });

  it('is a two-tone ring rather than one steady note', () => {
    // A steady tone disappears into a kitchen's own noise within a second. Two
    // alternating pitches is what makes a bell a bell — and what makes this
    // audibly different from either notification tone.
    expect(source).toContain('RING_HIGH_HZ');
    expect(source).toContain('RING_LOW_HZ');

    const high = Number(/const RING_HIGH_HZ = (\d+)/.exec(source)?.[1]);
    const low = Number(/const RING_LOW_HZ = (\d+)/.exec(source)?.[1]);
    expect(high).toBeGreaterThan(low);
  });

  it('rings twice, then leaves a gap long enough to live with', () => {
    // A burst, a pause, then again — the cadence of a telephone. Continuous
    // ringing gets muted within a week, and a muted alarm is no alarm.
    const burst = source.slice(source.indexOf('function burst('));
    expect(burst.slice(0, burst.indexOf('\n}')).match(/ring\(audio,/g)?.length).toBe(2);

    const ringSeconds = Number(/const RING_SECONDS = ([\d.]+)/.exec(source)?.[1]);
    const gapSeconds = Number(/const RING_GAP_SECONDS = ([\d.]+)/.exec(source)?.[1]);

    const burstSeconds = ringSeconds * 2 + gapSeconds;
    expect(burstSeconds).toBeGreaterThan(0);
    // There has to be actual silence between bursts, or it is a siren.
    expect(ALARM_INTERVAL_SECONDS - burstSeconds).toBeGreaterThan(1.5);
  });

  it('still refuses to make any noise before the page has been touched', () => {
    // Browsers block audio until a gesture, silently. The ring is held to the
    // same `unlocked` gate as everything else here, so a blocked context is
    // silence rather than an exception inside a Firestore listener.
    const ring = source.slice(
      source.indexOf('export function playNewOrderRing'),
      source.indexOf('function scheduleAhead'),
    );
    expect(ring).toContain('if (!unlocked) return;');
  });
});

describe('the alarm keeps ringing in a tab nobody is looking at', () => {
  /*
   * "ARXA PLANDA OLDUQDADA ... ZENG ÇALINMALIDIR."
   *
   * A hidden tab clamps `setInterval` to roughly one call a minute, so an
   * interval-driven ring is minutes late — which is most of a restaurant's
   * response window spent in silence. The bursts are therefore booked onto the
   * audio clock, which is not throttled, and the timer only tops the booking
   * up. Every number below is what makes that safe.
   */

  it('books the first burst almost immediately', () => {
    const { times } = alarmBurstsToSchedule(10, 0);
    expect(times[0]).toBeGreaterThanOrEqual(10);
    expect(times[0]).toBeLessThan(10.2);
  });

  it('books far enough ahead to survive a throttled timer', () => {
    const { times } = alarmBurstsToSchedule(0, 0);
    const last = times[times.length - 1];

    // The top-up may be held back to about a minute in a hidden tab, and two
    // consecutive minutes of that must still land inside what is booked.
    expect(last).toBeGreaterThan((ALARM_TOP_UP_MS / 1000) * 2);
    expect(ALARM_HORIZON_SECONDS).toBeGreaterThan((ALARM_TOP_UP_MS / 1000) * 2);
  });

  it('keeps the cadence exactly', () => {
    const { times } = alarmBurstsToSchedule(0, 0);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index] - times[index - 1]).toBeCloseTo(ALARM_INTERVAL_SECONDS, 6);
    }
  });

  it('a top-up carries on from where the last one stopped, without a double ring', () => {
    const first = alarmBurstsToSchedule(0, 0);
    const second = alarmBurstsToSchedule(20, first.scheduledUntil);

    // Nothing booked twice: the second call starts after the first one ended.
    expect(second.times[0]).toBeCloseTo(first.scheduledUntil, 6);
    expect(second.times[0] - first.times[first.times.length - 1]).toBeCloseTo(
      ALARM_INTERVAL_SECONDS,
      6,
    );
  });

  it('books nothing when the schedule already reaches past the horizon', () => {
    const { times } = alarmBurstsToSchedule(0, ALARM_HORIZON_SECONDS + 1);
    expect(times).toEqual([]);
  });

  it('picks up from the present when the clock has run past the schedule', () => {
    // A context that was suspended and then resumed: everything booked is in
    // the past, and replaying it would be a burst of rings all at once.
    const { times } = alarmBurstsToSchedule(500, 100);
    expect(times[0]).toBeGreaterThanOrEqual(500);
  });

  it('resumes the context and rebuilds the schedule when the tab comes back', () => {
    const source = readFileSync('src/lib/notificationSound.ts', 'utf8');

    expect(source).toContain("addEventListener('visibilitychange'");
    expect(source).toContain('resyncAlarm');
    // The repeat must not be an interval that RINGS. A timer that only books
    // may be late; a timer that rings is the bug the owner reported.
    expect(source).not.toContain('setInterval(');
  });

  it('cancels what it has already booked when the order is accepted', () => {
    // Bursts are scheduled minutes ahead, so "stop" has to mean "cancel the
    // scheduled ones" — otherwise a panel carries on ringing at an order that
    // a manager accepted on the till two minutes ago.
    const source = readFileSync('src/lib/notificationSound.ts', 'utf8');
    const stop = source.slice(source.indexOf('export function stopNotificationAlarm'));
    expect(stop).toContain('silenceVoices()');
  });
});

describe('a silence nobody knows about', () => {
  /*
   * The worst outcome in the product: the restaurant believes it is being
   * warned about new orders and is not. Every state that is not `ready` has to
   * be something the panel can put on screen.
   */

  it('says nothing at all until the browser has actually been asked', () => {
    // The whole of "SES SÖNDÜRÜLÜB YAZISI ÇIXIR": an unasked browser used to
    // come out as a muted one, so the strip was on screen before anything had
    // tried to make a sound.
    expect(
      alarmSoundState({
        supported: true,
        unlocked: false,
        contextState: null,
        probed: false,
        activatedBefore: false,
      }),
    ).toBe('unknown');
  });

  it('asks for a gesture when the page has not been touched', () => {
    expect(
      alarmSoundState({
        supported: true,
        unlocked: false,
        contextState: null,
        probed: true,
        activatedBefore: false,
      }),
    ).toBe('needsGesture');
  });

  it('asks for a gesture when the context is asleep after a background spell', () => {
    expect(
      alarmSoundState({
        supported: true,
        unlocked: true,
        contextState: 'suspended',
        probed: true,
        activatedBefore: false,
      }),
    ).toBe('needsGesture');
  });

  it('never asks twice in a browser that has already been activated', () => {
    // "BİRDEFE AKTİV ETDİKDE BES ETSİN ÇIXMASIN". A reload leaves the context
    // suspended until the next click; that is not news, and it is certainly not
    // a second request for a permission the person already gave.
    for (const contextState of ['suspended', null] as const) {
      expect(
        alarmSoundState({
          supported: true,
          unlocked: false,
          contextState,
          probed: true,
          activatedBefore: true,
        }),
      ).toBe('unknown');
    }
  });

  it('still warns an activated browser that cannot make a sound at all', () => {
    // Remembering an activation must never hide a browser that has gone from
    // "will ring" to "cannot ring" — that is the one thing worth interrupting
    // a shift for.
    expect(
      alarmSoundState({
        supported: false,
        unlocked: true,
        contextState: null,
        probed: true,
        activatedBefore: true,
      }),
    ).toBe('unavailable');
  });

  it('reports a browser that cannot make a sound at all', () => {
    expect(
      alarmSoundState({
        supported: false,
        unlocked: false,
        contextState: null,
        probed: true,
        activatedBefore: false,
      }),
    ).toBe('unavailable');
    expect(
      alarmSoundState({
        supported: true,
        unlocked: true,
        contextState: 'closed',
        probed: true,
        activatedBefore: false,
      }),
    ).toBe('unavailable');
  });

  it('is quiet about it only when the sound genuinely works', () => {
    expect(
      alarmSoundState({
        supported: true,
        unlocked: true,
        contextState: 'running',
        probed: true,
        activatedBefore: true,
      }),
    ).toBe('ready');
  });

  it('is rendered by the panel rather than only recorded', () => {
    const panel = readFileSync('src/components/restaurant/NewOrderAlarm.tsx', 'utf8');
    expect(panel).toContain('notificationSoundState');
    expect(panel).toContain('restaurantPanel.soundBlockedTitle');
    expect(panel).toContain('restaurantPanel.enableSound');
    // The button has to be a real gesture — that is the only thing a browser
    // will start audio from.
    expect(panel).toContain('unlockNotificationSound()');
  });
  it('remembers one activation for the whole browser, not for one screen', () => {
    const sound = readFileSync('src/lib/notificationSound.ts', 'utf8');
    // localStorage, so a reload does not re-ask; and the write sits in
    // `unlockNotificationSound` so every route to an unlock counts.
    expect(sound).toContain('localStorage');
    expect(sound).toContain('rememberActivation');

    // The context is started above the router, by a provider the root layout
    // mounts — not by the panel, which is rebuilt on every navigation.
    const layout = readFileSync('src/app/layout.tsx', 'utf8');
    expect(layout).toContain('NotificationSoundProvider');
    const provider = readFileSync(
      'src/components/notifications/NotificationSoundProvider.tsx',
      'utf8',
    );
    expect(provider).toContain('primeNotificationSound');
  });

  it('shows nothing while the answer is unknown', () => {
    const panel = readFileSync('src/components/restaurant/NewOrderAlarm.tsx', 'utf8');
    expect(panel).toContain("sound === 'unknown'");
  });
});
