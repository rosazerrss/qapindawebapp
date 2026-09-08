/* eslint-disable no-undef */

/**
 * QAPINDA — The worker that runs when nothing else does.
 *
 * This file is why a closed browser can still ring. It has to sit at the site
 * root under exactly this name: Firebase Cloud Messaging looks for
 * `/firebase-messaging-sw.js` and registers it itself, and a worker one folder
 * down has a scope that does not cover the app.
 *
 * WHERE THE CONFIGURATION COMES FROM
 * ----------------------------------
 * A service worker is a static file, so it cannot read the build's environment
 * variables. Rather than generate a copy of this file per environment — which
 * would mean a second place the Firebase keys live, and a build step that can
 * silently produce a stale one — the page passes the configuration on the query
 * string when it registers the worker, and it is read back out of
 * `self.location`. These values are the public web config; they are in the
 * page's own bundle already and are not secrets. The private key that can
 * actually *send* a notification never leaves the Cloud Functions.
 *
 * THE DOUBLE-BANNER TRAP, AND WHY THERE IS NO `onBackgroundMessage` HERE
 * ----------------------------------------------------------------------
 * The obvious thing to write is `onBackgroundMessage(payload => showNotification(...))`.
 * It is the first example in most tutorials and it is wrong for the way this
 * server sends.
 *
 * `functions/src/notifications/push.ts` sends a message carrying a real
 * `notification` block, because on iOS that is the only kind the operating
 * system will draw for an app that is not running. When such a message arrives,
 * the browser displays the banner **by itself**, before any code here runs.
 * Calling `showNotification` as well produces two identical banners for one
 * order — and the second one, having been drawn by hand, carries none of the
 * grouping the first one had.
 *
 * So this worker deliberately does not draw anything. Its whole job is the tap:
 * deciding which screen a notification opens, and reusing a window that is
 * already there rather than launching a third copy of the app.
 */

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

/** The public web config, handed over by the page at registration time. */
const params = new URL(self.location).searchParams;

const config = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

/*
 * Initialised only when the page actually supplied a project.
 *
 * A worker registered without configuration — a stale registration from an
 * older version of the site, say — would otherwise throw on every push and
 * take the click handler down with it. Failing quietly here leaves the browser
 * to draw the banner on its own, which is the whole delivery path anyway.
 */
if (config.projectId && config.messagingSenderId) {
  firebase.initializeApp(config);
  // Claims the messaging registration. Nothing is subscribed to: see the note
  // above about why this worker never draws a banner of its own.
  firebase.messaging();
}

/**
 * A new worker takes over immediately.
 *
 * Without these two, a restaurant that has had the tablet open all day keeps
 * running the version of this file it loaded this morning until every tab is
 * closed — which on a kitchen tablet is never. A fix shipped at noon would
 * reach them next week.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/**
 * The tap.
 *
 * Reuses an open window when there is one, because a restaurant tablet with the
 * panel already open should move to the order, not gain a second copy of the
 * app with its own listeners, its own sound and its own idea of what is unread.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data?.FCM_MSG?.data ?? event.notification.data ?? {};
  const target = data.link || '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windows) {
        // Same origin, already running: bring it forward and steer it.
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client && target !== '/') {
            await client.navigate(target).catch(() => undefined);
          }
          return;
        }
      }

      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});
