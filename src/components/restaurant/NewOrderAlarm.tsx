'use client';

/**
 * The sound a kitchen cannot miss an order through.
 *
 * Mounted once by `PanelShell` for every restaurant screen, not by the order
 * board — an owner who wandered off to the menu editor is exactly the person
 * who needs to be told that an order is waiting, and a component that only
 * exists on one page would have gone quiet the moment they navigated.
 *
 * WHAT MAKES IT STOP
 * ------------------
 * The order leaving PLACED, and nothing else. This subscribes to the same live
 * query the board uses, so "Qəbul et" stops the alarm because the status
 * changed — not because a handler ran. A manager accepting from the till, a
 * courier screen, the expiry job at the end of the response window: all of them
 * stop it, on every device, because all of them change the same fact.
 * `decideNewOrderAlarm` in `/shared` is where that is decided and where it is
 * tested.
 *
 * WHY IT RENDERS NOTHING
 * ----------------------
 * The new-order column, its count and the notification centre already say what
 * is happening, and they say it whether or not the sound is on. This component
 * owns exactly one thing — whether the room is noisy — so that switching the
 * sound off cannot accidentally take a visible signal with it.
 *
 * WHY IT DOES RENDER SOMETHING AFTER ALL — AND ONLY THIS
 * ------------------------------------------------------
 * One thing, and it is the opposite of decoration: when the browser will not
 * make a noise, it says so. A restaurant that believes it is being warned about
 * new orders and is not is the worst state this product has, and it is the
 * state every unlocked-audio policy puts a freshly opened panel into. So a
 * blocked alarm is a strip across the top of the panel with a button on it, and
 * it stays there until the sound actually works.
 *
 * A note about `prefers-reduced-motion`: it is a request about MOTION, not
 * about sound, and an order alarm is not decoration. It is left alone here on
 * purpose; the switch for the sound is "Yeni sifariş səsi" in Ayarlar →
 * Bildirişlər, which is where a person who wants silence asks for it.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { BellOff, Volume2 } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { isFirebaseConfigured } from '@/firebase/client';
import {
  notificationSoundServerState,
  notificationSoundState,
  startNotificationAlarm,
  stopNotificationAlarm,
  subscribeToNotificationSoundState,
  unlockNotificationSound,
} from '@/lib/notificationSound';
import { useT } from '@/i18n';
import { watchRestaurantOrders } from '@/services/catalog';
import { OrderStatus } from '@/shared/enums';
import { newOrderAlarmEnabled } from '@/shared/notifications';
import { createAlarmMemory, decideNewOrderAlarm, type AlarmMemory } from '@/shared/newOrderAlarm';

/**
 * The one status that alarms.
 *
 * PLACED is "the customer has paid and the countdown is running". Everything
 * after it is somebody's problem in progress; only this one is nobody's yet.
 */
const PENDING_STATUSES: string[] = [OrderStatus.PLACED];

/*
 * WHY THE MEMORY IS A MODULE VARIABLE AND NOT A REF.
 *
 * Every restaurant screen mounts its own `PanelShell`, so this component is
 * destroyed and rebuilt on every navigation inside the panel. A `useRef` went
 * with it, which meant a walk to the menu editor and back handed the alarm a
 * blank memory and let orders that had already been dealt with count as new
 * again. The memory is a fact about the SHIFT, not about the screen, so it
 * lives where a screen change cannot reach it.
 *
 * Keyed by restaurant so that signing one account out and another in does not
 * inherit the first one's answered orders.
 */
let sessionMemory: { restaurantId: string | null; memory: AlarmMemory } = {
  restaurantId: null,
  memory: createAlarmMemory(),
};

function memoryFor(restaurantId: string | null): AlarmMemory {
  if (sessionMemory.restaurantId !== restaurantId) {
    sessionMemory = { restaurantId, memory: createAlarmMemory() };
  }
  return sessionMemory.memory;
}

export function NewOrderAlarm() {
  const t = useT();
  const { restaurantId, profile } = useAuth();

  /* The pending ids as state, because they arrive over time. */
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isFirebaseConfigured || !restaurantId) return;

    const unsubscribe = watchRestaurantOrders(restaurantId, PENDING_STATUSES, (orders) =>
      setPendingIds(orders.map((order) => order.id)),
    );

    return () => {
      unsubscribe();
      // Leaving the panel is not "the order was dealt with", but it is
      // certainly "stop making that noise in a tab nobody is watching".
      stopNotificationAlarm();
    };
  }, [restaurantId]);

  /*
   * The preference is read here rather than inside the subscription so that
   * turning "Yeni sifariş səsi" off stops the alarm at once — the profile is
   * live, so the switch arrives as a new profile and this effect runs again
   * without the listener being torn down and re-primed.
   */
  const soundEnabled = newOrderAlarmEnabled(profile?.notificationPrefs);

  useEffect(() => {
    if (decideNewOrderAlarm(memoryFor(restaurantId ?? null), pendingIds, soundEnabled)) {
      startNotificationAlarm();
    } else {
      stopNotificationAlarm();
    }
  }, [pendingIds, soundEnabled, restaurantId]);

  // Every unmount silences it, including the one that happens when a restaurant
  // account signs out. An alarm that outlives its panel is a browser tab that
  // has to be closed to be quietened.
  useEffect(() => stopNotificationAlarm, []);

  /*
   * Whether the browser would actually make the noise.
   *
   * `useSyncExternalStore` because the answer lives on an `AudioContext`, which
   * is a browser object with no React in it: the server has no audio at all and
   * says so, and the sound module tells this hook the moment its answer changes
   * — a first gesture, a resume that worked, a resume the browser refused.
   */
  const sound = useSyncExternalStore(
    subscribeToNotificationSoundState,
    notificationSoundState,
    notificationSoundServerState,
  );

  /*
   * Nothing to warn about when the restaurant has asked for silence, nothing
   * to warn about when the sound works — and, the point of this whole change,
   * nothing to warn about while the answer is `unknown`.
   *
   * `unknown` covers two situations that both used to produce the strip. The
   * first is the moment before the browser has been asked at all, which is
   * every server render and the first frame of every client one. The second is
   * a browser that has already been activated once and whose context happens to
   * be asleep — a reload, a tab that spent an hour in the background. Neither
   * is "the kitchen cannot hear its orders", and printing that at somebody who
   * pressed the button yesterday is what the complaint was about.
   */
  if (!soundEnabled || sound === 'ready' || sound === 'unknown') return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
    >
      <BellOff size={16} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{t('restaurantPanel.soundBlockedTitle')}</span>{' '}
        <span>
          {sound === 'unavailable'
            ? t('restaurantPanel.soundUnavailableBody')
            : t('restaurantPanel.soundBlockedBody')}
        </span>
      </span>

      {/*
        The button is the whole point of the strip: a browser only lets audio
        start from inside a real gesture, so the fix has to be something the
        person presses. There is nothing to press when the browser cannot make
        a sound at all, and offering one would be a promise the panel cannot
        keep.
      */}
      {sound === 'needsGesture' && (
        <button
          type="button"
          onClick={() => unlockNotificationSound()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-800"
        >
          <Volume2 size={15} aria-hidden />
          {t('restaurantPanel.enableSound')}
        </button>
      )}
    </div>
  );
}
