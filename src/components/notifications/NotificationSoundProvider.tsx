'use client';

/**
 * The audio, hoisted above the router.
 *
 * WHY IT IS HERE AND NOT IN THE PANEL
 * -----------------------------------
 * The restaurant panel has no layout of its own: every screen mounts its own
 * `PanelShell`, which mounts its own `NewOrderAlarm`. Walking from the order
 * board to the menu editor therefore destroys and rebuilds the whole of that
 * subtree. Anything the audio knew that lived inside it — that a gesture had
 * happened, that the context was awake — was forgotten on every step, and the
 * panel re-accused the browser of being muted each time. That is precisely the
 * complaint: "RESTORAN PANELİNDE HEREKET EDERKEN YUXARIDAN SES SÖNDÜRÜLÜB
 * YAZISI ÇIXIR".
 *
 * This component is mounted once by the ROOT layout, which no navigation
 * unmounts. It renders nothing and owns nothing itself; it just asks
 * `primeNotificationSound()` to start the one `AudioContext` for the session
 * and to listen for the first real interaction anywhere in the app. Both of
 * those already live in module scope, so hoisting the *mounting* is all that
 * was needed to make them survive a route change.
 *
 * It is mounted for every visitor, not only for restaurants: a customer's
 * order screen and a courier's phone play notification tones through the same
 * module, and a context primed at the top of the session is a context that is
 * already awake when the first tone arrives.
 */

import { useEffect } from 'react';

import { primeNotificationSound } from '@/lib/notificationSound';

export function NotificationSoundProvider() {
  useEffect(() => {
    // Deliberately never torn down. The context is a session-long singleton and
    // the gesture listener removes itself as soon as the sound is running; a
    // cleanup here would close audio that other screens are still using.
    primeNotificationSound();
  }, []);

  return null;
}
