'use client';

/**
 * The browser's Firebase handle.
 *
 * Everything is lazy and guarded: the app must render — menus, restaurant
 * pages, the whole shopfront — even when the environment variables are missing,
 * so a misconfigured deploy shows a banner instead of a white screen.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

/**
 * The same public web config, as the query string the service worker reads.
 *
 * A service worker is a static file and cannot see the build's environment
 * variables, so it is handed them at registration time. Built here rather than
 * in `lib/push.ts` so there is exactly one place the Firebase web config is
 * spelled — a second copy is how a project ends up with a worker pointing at
 * the wrong project and no error anywhere.
 *
 * These values are public: they identify the project, they do not authorise
 * anything. The key that can actually send a notification lives only in the
 * Cloud Functions.
 */
export function serviceWorkerConfigQuery(): string {
  return new URLSearchParams({
    apiKey: config.apiKey ?? '',
    authDomain: config.authDomain ?? '',
    projectId: config.projectId ?? '',
    storageBucket: config.storageBucket ?? '',
    messagingSenderId: config.messagingSenderId ?? '',
    appId: config.appId ?? '',
  }).toString();
}

export const FUNCTIONS_REGION = process.env.NEXT_PUBLIC_FUNCTIONS_REGION ?? 'europe-west1';

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

let app: FirebaseApp | null = null;

export function firebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured) return null;
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(config);
    startAppCheck(app);
  }
  return app;
}

/**
 * APP CHECK — PROOF THAT THE CALLER IS THIS APP.
 *
 * Firebase authentication answers "who is this person"; it says nothing about
 * *what* is calling. Without App Check every callable in this project is a
 * public HTTP endpoint that anybody can drive from a script with an ordinary
 * customer account — and two of them are worth driving. `previewOrder` prices
 * a basket against a coupon code, so an unlimited caller can walk the whole
 * coupon space until it finds a live one; `startOnlinePayment` opens sessions
 * at the bank. Neither has a rate limit anywhere, and a rate limit is not the
 * fix — bots are cheap and IP addresses are cheaper.
 *
 * reCAPTCHA Enterprise issues a short-lived token that says "this really is a
 * browser on qapinda.az", and the functions refuse anything without one. There
 * is nothing secret in the site key; it is public by design, and it is the
 * paired server-side check that does the work.
 *
 * OFF UNTIL A KEY IS SET, DELIBERATELY.
 *
 * The key is a console step the owner has to take, and this code ships before
 * that step happens. Failing closed here would take the entire shopfront down
 * the moment it deployed with an empty variable; failing open leaves the app
 * exactly as it is today and switches protection on the moment the key is
 * pasted in. The server side is gated on its own variable in the same way, so
 * the two are turned on together.
 *
 * Wrapped in a try/catch because App Check is a *hardening* layer: a bad key,
 * a blocked reCAPTCHA script or an ad blocker must degrade to today's
 * behaviour rather than leave a customer unable to order dinner.
 */
function startAppCheck(instance: FirebaseApp): void {
  const siteKey = process.env.NEXT_PUBLIC_APPCHECK_SITE_KEY;
  if (!siteKey || typeof window === 'undefined') return;

  // A debug token lets `localhost` and CI past the domain check without
  // weakening production, where the variable is simply not set.
  const debugToken = process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN;
  if (debugToken) {
    (window as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
  }

  // Imported here rather than at the top of the file: the reCAPTCHA bundle is
  // a real download, and a deployment with no key should not pay for it.
  void import('firebase/app-check')
    .then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
      try {
        initializeAppCheck(instance, {
          provider: new ReCaptchaEnterpriseProvider(siteKey),
          // Refreshed in the background, so a token never expires mid-order.
          isTokenAutoRefreshEnabled: true,
        });
      } catch {
        // Already initialised, on a hot reload.
      }
    })
    .catch(() => {
      // Script blocked or offline. The app keeps working.
    });
}

export function firebaseAuth(): Auth | null {
  const instance = firebaseApp();
  return instance ? getAuth(instance) : null;
}

let db: Firestore | null = null;

/**
 * Firestore, configured to survive an unhelpful network.
 *
 * Firestore's default transport is a long-lived streaming connection. Plenty of
 * real networks — mobile operators with transparent proxies, corporate
 * firewalls, some public Wi-Fi — accept the connection and then never deliver
 * anything through it. The symptom is the worst kind: no error, no timeout, a
 * screen that says "Yüklənir…" forever.
 *
 * `experimentalAutoDetectLongPolling` makes the SDK notice that the stream is
 * not working and fall back to plain polling requests, which those networks do
 * pass. It costs a little latency on the first request and removes an entire
 * class of "it works on my machine" reports.
 *
 * `initializeFirestore` must run before anything calls `getFirestore`, which is
 * why every caller in the app goes through this function.
 *
 * THE LOCAL CACHE, AND WHY THE APP FELT LIKE IT RELOADED
 * ------------------------------------------------------
 * Every panel screen subscribes to its data when it mounts, and until the first
 * snapshot arrives from Google there is nothing to draw — so the screen showed
 * "Yüklənir…". Moving between two pages therefore blanked the second one every
 * time, even when its data had been on screen a minute earlier. Navigation was
 * already client-side; it did not FEEL client-side, because the content flashed
 * away and came back.
 *
 * `persistentLocalCache` keeps the documents this browser has already seen in
 * IndexedDB. `onSnapshot` then fires IMMEDIATELY from that cache — synchronously
 * on mount, before any network round trip — and fires again when the server
 * answers. The screen is filled in from the first frame and quietly corrects
 * itself, which is what people mean by an application that does not reload.
 *
 * It also carries the app through a tunnel: a courier whose phone loses signal
 * between two blocks still sees the delivery they are standing outside.
 *
 * `persistentMultipleTabManager` because restaurants genuinely do this — the
 * order board on one tab, the menu editor on another. Without it the second tab
 * fails to acquire the cache and falls back to memory, silently.
 *
 * WHAT IT DOES NOT CHANGE
 * -----------------------
 * The security rules. A cached document was one this account was allowed to
 * read when it was read; the cache is per-origin and per-browser, and nothing
 * enters it that the server did not already send to this signed-in user. Signing
 * out clears the Firestore instance along with the app.
 *
 * The `catch` matters more than it looks: a private window, a browser with
 * storage blocked, or a device out of disk all refuse persistence, and the
 * right answer to every one of them is the in-memory cache and a working app.
 */
export function firestore(): Firestore | null {
  const instance = firebaseApp();
  if (!instance) return null;

  if (!db) {
    try {
      db = initializeFirestore(instance, {
        experimentalAutoDetectLongPolling: true,
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch {
      /*
       * Two different failures land here and both have the same right answer.
       *
       * Either Firestore was already initialised (a hot reload, a second call
       * racing this one) — in which case the existing instance is the one to
       * use — or persistence was refused by the browser, which happens in a
       * private window, with site data blocked, or on a device out of space.
       * Falling back to a working in-memory instance is correct for both; the
       * app loses the instant-paint, not any function.
       */
      try {
        db = initializeFirestore(instance, { experimentalAutoDetectLongPolling: true });
      } catch {
        db = getFirestore(instance);
      }
    }
  }

  return db;
}

export function firebaseFunctions(): Functions | null {
  const instance = firebaseApp();
  return instance ? getFunctions(instance, FUNCTIONS_REGION) : null;
}

export function firebaseStorage(): FirebaseStorage | null {
  const instance = firebaseApp();
  return instance ? getStorage(instance) : null;
}
