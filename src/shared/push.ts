/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Push notifications that reach a closed browser.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * WHAT THIS REPLACES, AND WHY IT HAD TO
 * -------------------------------------
 * Until now `src/lib/push.ts` raised a system notification from the page, off a
 * Firestore listener the page already had. It was honest about its limit and
 * the limit was fatal: **the tab has to be open**. A restaurant tablet that
 * sleeps, a browser that is closed, a phone in a pocket — no sound, no banner,
 * no order. The kitchen finds out when the customer rings to ask where the food
 * is.
 *
 * For a marketplace whose whole promise is that an order reaches a kitchen in
 * seconds, that is not a missing feature. It is the product failing quietly,
 * which is the worst way for it to fail, because nobody is told.
 *
 * So there are now two paths, and they do not overlap:
 *
 *   tab in front of you   the page's own listener draws it, as it always did
 *   anything else         Firebase Cloud Messaging wakes the service worker
 *
 * WHY THE SERVER SENDS FROM A TRIGGER AND NOT FROM `notify()`
 * -----------------------------------------------------------
 * Every notification in this system is already a document, written with a
 * deterministic id so the same event can never be stored twice, and written
 * only after the recipient's role and preferences have been checked. All of
 * that work is done before the row exists.
 *
 * So push hangs off the row appearing, not off the forty call sites that cause
 * one. A trigger on the collection inherits the deduplication (a `create` fires
 * once, by construction), inherits the preference checks, and — the part that
 * matters most — covers the transactional writes too, which never pass through
 * `notify()` at all. Adding a "send push" line to each call site would have
 * missed those, and missed them silently.
 *
 * WHY NOT EVERY NOTIFICATION IS PUSHED
 * ------------------------------------
 * A notification is a record; a push is an interruption. A restaurant given a
 * banner for every rating change stops reading banners, and the one that says
 * "new order" arrives in a stream nobody looks at any more. `PUSHABLE` below is
 * the deliberately short list of things worth waking somebody for.
 */

import { NotificationType } from './enums';

/**
 * What a device is, from the server's point of view.
 *
 * Only ever used to decide what a delivery failure means and to let somebody
 * looking at a support ticket say "your iPhone has notifications off". Nothing
 * is branched on it.
 */
export const PushPlatform = {
  WEB: 'WEB',
  ANDROID: 'ANDROID',
  IOS: 'IOS',
} as const;
export type PushPlatform = (typeof PushPlatform)[keyof typeof PushPlatform];

/**
 * One device's registration with Firebase Cloud Messaging.
 *
 * Stored per device and not per account, because a restaurant has a tablet in
 * the kitchen, a tablet at the counter and the owner's telephone, and an order
 * has to ring on all three. The token is the document id: FCM issues one token
 * per browser-profile per device, so using it as the id makes re-registering
 * the same device an overwrite rather than a duplicate.
 */
export interface PushToken {
  /** The FCM registration token. Also the document id. */
  token: string;
  userId: string;
  platform: PushPlatform;
  /** Enough of the user agent to recognise a device in a support conversation. */
  device: string | null;
  createdAt: unknown;
  /** Refreshed whenever the app confirms the token is still the live one. */
  lastSeenAt: unknown;
}

/**
 * How long a token is trusted without being seen again.
 *
 * FCM tokens do not expire on a schedule; they are invalidated by events — the
 * app being uninstalled, site data cleared, the browser deciding to rotate
 * them. A token nobody has confirmed for two months belongs to a device that
 * has not opened Qapında in two months, and sending to it is a request that
 * fails and a row that never gets cleaned up. The app refreshes `lastSeenAt`
 * every time it starts, so a device in daily use never approaches this.
 */
export const PUSH_TOKEN_STALE_DAYS = 60;

/**
 * The FCM error codes that mean "this token is dead, delete the row".
 *
 * Anything else — a network blip, a quota answer, an internal error at Google
 * — must NOT delete a token: a transient failure that unregisters a
 * restaurant's kitchen tablet turns one missed banner into every missed banner
 * from then on, and nobody would connect the two.
 */
export const DEAD_TOKEN_CODES: readonly string[] = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
];

/**
 * WHAT IS WORTH WAKING A PERSON FOR.
 *
 * The test each one had to pass: if this arrives while the phone is in a
 * pocket, is there something to *do* about it right now? A new order is; a
 * rating is not. The rest still appear in the bell, where somebody reads them
 * when they choose to.
 *
 * The restaurant's list is the shortest and the most important. An order and a
 * cancellation are the two events where a delay costs money — the food is not
 * being cooked, or it is being cooked for nobody.
 */
export const PUSHABLE: readonly NotificationType[] = [
  // The restaurant. The reason this whole file exists.
  NotificationType.NEW_ORDER_FOR_RESTAURANT,
  NotificationType.ORDER_CANCELLED,

  // The customer, for the one moment they are actually waiting on. There is
  // deliberately no "being cooked" push: the owner cut those status messages
  // from the product, and this file does not reintroduce them by the back door.
  NotificationType.ORDER_ON_THE_WAY,
  NotificationType.REFUND_ISSUED,

  // Somebody is talking to you and is waiting for an answer.
  NotificationType.SUPPORT_MESSAGE,
  NotificationType.SUPPORT_TICKET_UPDATED,

  // The courier is carrying somebody's dinner and needs to know now.
  NotificationType.COURIER_ASSIGNED,
  NotificationType.COURIER_ORDER_READY,
  NotificationType.COURIER_ORDER_CANCELLED,

  // The platform is on fire and the operator is not looking at the screen.
  NotificationType.OPS_RESTAURANT_OFFLINE,
  NotificationType.OPS_ORDER_PROBLEM,
];

/** True when this kind of event earns an interruption. */
export function isPushable(type: NotificationType): boolean {
  return PUSHABLE.includes(type);
}

/**
 * The tag two notifications share when the newer should replace the older.
 *
 * A phone that has been in a pocket through six status changes of one order
 * should show *one* banner about that order, saying where it is now — not six
 * saying where it was. The tag is the subject, so the operating system collapses
 * them for us; without it a busy evening buries the notification tray.
 *
 * Different orders keep different tags, because those genuinely are different
 * things to know about.
 */
export function pushTag(input: {
  type: NotificationType;
  orderId?: string | null;
  restaurantId?: string | null;
}): string {
  const subject = input.orderId ?? input.restaurantId ?? 'general';
  // A new order must never be collapsed into an older banner about the same
  // order — it is the one the kitchen has not seen yet.
  if (input.type === NotificationType.NEW_ORDER_FOR_RESTAURANT) {
    return `order-new:${subject}`;
  }
  return `order:${subject}`;
}
