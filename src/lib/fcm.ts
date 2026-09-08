'use client';

/**
 * QAPINDA — Registering this device so a closed browser can still ring.
 *
 * WHAT THIS ADDS TO `push.ts`, AND WHY THEY ARE TWO FILES
 * -------------------------------------------------------
 * `push.ts` raises a banner from the page, off a Firestore listener the page
 * already has. It is the right mechanism while the tab exists, and it stays.
 * What it cannot do — and says so — is reach a tablet that has gone to sleep.
 *
 * This file is the other half: it hands Firebase Cloud Messaging a service
 * worker and asks it for a token, and the token is what the server sends to
 * when nothing of ours is running. The two never overlap, because `push.ts`
 * refuses to draw anything while the tab is visible and FCM's own banner is
 * drawn by the operating system only when it is not.
 *
 * NOTHING HERE ASKS FOR PERMISSION
 * --------------------------------
 * `requestPushPermission` in `push.ts` is still the only place that prompts,
 * and it is still only called from the switch in Settings. A permission prompt
 * on page load is the fastest way to be denied for ever — the browser remembers
 * "no" and there is no second chance on any device that person owns. So
 * everything below returns quietly when permission has not already been given.
 *
 * WHY IT RE-REGISTERS ON EVERY START
 * ----------------------------------
 * Two reasons, and the second is the one that is easy to miss. A token can be
 * rotated by the browser at any time, so the app has to ask for the current one
 * rather than trust what it saw last week. And `lastSeenAt` is the only
 * evidence that a device is still alive: FCM tokens are invalidated by events,
 * not by a clock, so "when did a running app last confirm this" is what
 * separates a kitchen tablet in daily use from a browser somebody cleared in
 * spring. `pruneStalePushTokens` reads exactly that.
 */

import { getMessaging, getToken, deleteToken, isSupported } from 'firebase/messaging';

import { firebaseApp, serviceWorkerConfigQuery } from '@/firebase/client';
import { registerPushToken, unregisterPushToken } from '@/firebase/callables';
import { PushPlatform } from '@/shared/push';

/**
 * The public half of the VAPID key pair.
 *
 * Created once in the Firebase console under Cloud Messaging → Web Push
 * certificates. Without it `getToken` refuses, and the whole path below turns
 * itself off rather than throwing — an unconfigured project should behave like
 * a browser that does not support push, not like a broken app.
 */
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? '';

/**
 * The shortest string that could be a real key.
 *
 * A VAPID public key is an uncompressed P-256 point in base64url — 87
 * characters, always starting with `B`. The check exists because the ordinary
 * way this goes wrong is not a missing value but a *placeholder* one: somebody
 * copies `NEXT_PUBLIC_FIREBASE_VAPID_KEY=BURAYA_ACAR` out of the instructions
 * and the file now has a non-empty value that is not a key.
 *
 * Without this the app registers a service worker, calls `getToken`, is refused
 * by the push service, swallows the error and reports nothing — so the setting
 * looks configured and no notification ever arrives. With it, an unconfigured
 * project behaves exactly like a browser that cannot do push, which is a state
 * the settings screen already explains in words.
 */
const VAPID_MIN_LENGTH = 80;

function vapidKeyLooksReal(): boolean {
  return VAPID_KEY.length >= VAPID_MIN_LENGTH && VAPID_KEY.startsWith('B');
}

/** Remembered so signing out can unregister the exact token it registered. */
let currentToken: string | null = null;

/** Everything that has to be true before there is any point trying. */
export async function fcmUsable(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!vapidKeyLooksReal()) return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!firebaseApp()) return false;

  // Safari below 16.4, most in-app browsers, and every desktop browser in a
  // private window answer false here. It is a fact about the device, not a
  // failure, and the settings screen says so rather than showing an error.
  return isSupported().catch(() => false);
}

/**
 * A short, human description of the device, for a support conversation.
 *
 * Deliberately coarse. This exists so somebody can be told "notifications are
 * off on your iPhone", not so the platform can tell two iPhones apart — a full
 * user-agent string is a fingerprint and is neither needed nor stored.
 */
function describeDevice(): { platform: PushPlatform; device: string } {
  const agent = navigator.userAgent;

  if (/android/i.test(agent)) return { platform: PushPlatform.ANDROID, device: 'Android' };
  if (/iphone|ipad|ipod/i.test(agent)) return { platform: PushPlatform.IOS, device: 'iPhone/iPad' };

  const browser = /edg\//i.test(agent)
    ? 'Edge'
    : /chrome/i.test(agent)
      ? 'Chrome'
      : /firefox/i.test(agent)
        ? 'Firefox'
        : /safari/i.test(agent)
          ? 'Safari'
          : 'Brauzer';

  return { platform: PushPlatform.WEB, device: browser };
}

/**
 * Registers the messaging worker.
 *
 * Registered by hand rather than left to Firebase, for one reason: the worker
 * is a static file and cannot read the build's environment, so the project
 * configuration has to reach it on the query string. Firebase's own automatic
 * registration would load it without one.
 *
 * `updateViaCache: 'none'` matters more than it looks. Without it the browser
 * may serve the worker from its HTTP cache for a day, so a fix shipped at noon
 * reaches a kitchen tablet tomorrow.
 */
async function messagingWorker(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.register(
      `/firebase-messaging-sw.js?${serviceWorkerConfigQuery()}`,
      { scope: '/', updateViaCache: 'none' },
    );
  } catch {
    // A worker cannot register over plain HTTP, in some private modes, or when
    // the browser has run out of storage. None of it is actionable here.
    return null;
  }
}

/**
 * Claims this device for the signed-in account.
 *
 * Safe to call on every start and safe to call twice: the server keys the row
 * on the token, so a repeat is an overwrite that moves `lastSeenAt` forward.
 * Returns the token when one was obtained, and null every other time —
 * including the ordinary cases of "permission not given" and "this browser
 * cannot", which are not errors and are not reported as any.
 */
export async function enablePushOnThisDevice(): Promise<string | null> {
  if (!(await fcmUsable())) return null;
  if (Notification.permission !== 'granted') return null;

  const registration = await messagingWorker();
  if (!registration) return null;

  try {
    const token = await getToken(getMessaging(firebaseApp()!), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return null;

    const { platform, device } = describeDevice();
    const result = await registerPushToken({ token, platform, device });
    if (!result.ok) return null;

    currentToken = token;
    return token;
  } catch {
    // `getToken` throws when the VAPID key does not match the project, when the
    // push service is unreachable, and when permission was revoked between the
    // check above and here. The app carries on without background delivery;
    // the in-page path still works while a tab is open.
    return null;
  }
}

/**
 * Stops this device from being sent to.
 *
 * Called when the switch is turned off and — this is the one that matters —
 * when somebody signs out. A token left registered keeps ringing a shared
 * tablet with the previous account's orders, and whoever reads them was never
 * entitled to them.
 *
 * The server row is removed first. If deleting the local token then fails, the
 * device simply stops being sent to, which is the outcome that was wanted;
 * doing it the other way round could leave a live row nobody can reach.
 */
export async function disablePushOnThisDevice(): Promise<void> {
  const token = currentToken;
  currentToken = null;

  if (token) await unregisterPushToken({ token }).catch(() => undefined);

  if (!(await fcmUsable())) return;

  await deleteToken(getMessaging(firebaseApp()!)).catch(() => undefined);
}
