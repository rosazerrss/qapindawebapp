'use client';

/**
 * Browser notifications, while the tab is in the background.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * -------------------------------
 * This is the Notification API and nothing else: the page, while it is open in
 * some tab somewhere, raising a system notification because a Firestore
 * listener it already has told it something arrived. It needs no server key, no
 * service worker and no Firebase Cloud Messaging configuration, and it works
 * today with what this project actually has.
 *
 * What it therefore cannot do is reach a phone whose browser is closed. That is
 * genuine push, it requires FCM — a VAPID key pair, a service worker registered
 * at the site root to receive `onBackgroundMessage`, a per-device token stored
 * against the user and refreshed, and a server that sends to those tokens
 * instead of only writing a Firestore document. None of that is stubbed out
 * here and nothing pretends to be it: `pushSupported()` reports what the
 * browser can do, the settings screen switches it on or off, and when the tab
 * is gone so is the notification.
 *
 * PERMISSION IS ASKED FOR ONCE, AND ONLY WHEN SOMEBODY ASKS FOR IT
 * ---------------------------------------------------------------
 * A permission prompt on page load is the fastest way to be denied forever —
 * the browser remembers "no" and there is no second chance, on any device that
 * person owns. So the prompt is raised from the switch in Settings and from
 * nowhere else, which is also why `DEFAULT_NOTIFICATION_PREFS.push` is false.
 */

/** Whether this browser can raise a system notification at all. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function pushPermission(): PushPermission {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission as PushPermission;
}

/*
 * The browser's answer, as something React can subscribe to.
 *
 * `Notification.permission` is a value on a global object with no event behind
 * it, and reading it straight in a render is a hydration mismatch waiting to
 * happen: the server has no `Notification` at all, so it renders "off" and the
 * browser renders whatever the person has already allowed. `useSyncExternalStore`
 * is the supported way to read a value that lives outside React — server
 * snapshot "unsupported", client snapshot the real thing — and the prompt below
 * tells the store when the answer changes, which is the only moment it can.
 */
const permissionListeners = new Set<() => void>();

export function subscribeToPushPermission(listener: () => void): () => void {
  permissionListeners.add(listener);
  return () => permissionListeners.delete(listener);
}

/** The server has no browser, so it has no permission either. */
export function pushPermissionServerSnapshot(): PushPermission {
  return 'unsupported';
}

/**
 * Asks the browser, from inside the click that wanted it.
 *
 * Returns what the browser decided rather than a bare boolean, because "denied"
 * and "dismissed" call for different words on screen: one is a decision the
 * person has to undo in the browser's own settings, the other is a question
 * they can be asked again.
 */
export async function requestPushPermission(): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission as PushPermission;

  try {
    return (await Notification.requestPermission()) as PushPermission;
  } catch {
    // Older Safari hands back a callback API rather than a promise, and some
    // embedded browsers refuse outright. Either way we have no permission.
    return pushPermission();
  } finally {
    // Whatever the answer was, anything showing the old one is now wrong.
    for (const listener of permissionListeners) listener();
  }
}

/**
 * Raises one, if the tab is in the background and everything else agrees.
 *
 * The foreground check is the point of the whole function: a system notification
 * for something the person is already looking at is the app talking over
 * itself. The bell is already showing it, in the panel they have open.
 *
 * `tag` is the notification's own id, so the same event can never stack two
 * banners — the browser replaces a notification that carries a tag it already
 * has, which is the same one-event-one-notification rule the server enforces
 * with the document id, spelt in the browser's vocabulary.
 */
export function raisePushNotification(input: {
  tag: string;
  title: string;
  body: string;
  /** Where tapping it should land. Opened in this tab, which is already ours. */
  link?: string | null;
  onOpen?: (link: string) => void;
}): void {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;

  try {
    const raised = new Notification(input.title, {
      body: input.body,
      tag: input.tag,
      // Never re-alert for a banner the browser is only replacing.
      silent: true,
    });

    raised.onclick = () => {
      window.focus();
      raised.close();
      if (input.link) input.onOpen?.(input.link);
    };
  } catch {
    // Constructing a Notification throws on Android Chrome, which insists on a
    // service worker registration for it. There is nothing to fall back to and
    // nothing worth telling the user — the bell already has the message.
  }
}
