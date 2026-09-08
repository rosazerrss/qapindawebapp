/**
 * QAPINDA — Delivering a notification to a device that is not looking.
 *
 * WHY A TRIGGER AND NOT A LINE IN `notify()`
 * ------------------------------------------
 * Everything that decides whether somebody should be told has already run by
 * the time a notification document exists: the role matrix, the per-type
 * preferences, and the deterministic id that makes a repeat of the same event a
 * no-op. Hanging push off the document appearing inherits all three for free.
 *
 * It also catches what a line in `notify()` would have missed. Notifications
 * written inside a transaction never pass through `notify()` at all — they go
 * through `notifyIn`, because a transaction may not read once it has begun
 * writing. A restaurant's new-order alert is one of those. Adding "send a push"
 * to `notify()` would have shipped a push system that did not push the single
 * most important message in the product, and nothing would have looked wrong.
 *
 * WHAT THE SERVER IS ALLOWED TO KNOW HOW TO SAY
 * ---------------------------------------------
 * `PUSH_TEXT` is generated from the same three dictionaries the app ships, by
 * `scripts/generate-push-text.mjs`, and a test fails when it falls behind. The
 * rule that the sentences are written in exactly one place still holds; this is
 * a build artefact of that place, not a second copy of it.
 *
 * WHAT IS SENT, AND WHAT IS DELIBERATELY NOT
 * ------------------------------------------
 * The banner carries the order code and the amount, because that is what makes
 * it useful on a lock screen. It carries no name, no telephone number and no
 * address: a lock-screen notification is readable by whoever is holding the
 * phone, including the person who found it on a bus.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { getMessaging, type TokenMessage } from 'firebase-admin/messaging';

import { db, now, Timestamp } from '../lib/admin';
import { COLLECTIONS, paths } from '../shared/collections';
import { DEFAULT_LOCALE, type SupportedLocale } from '../shared/enums';
import { NotificationType } from '../shared/enums';
import { DEAD_TOKEN_CODES, PUSH_TOKEN_STALE_DAYS, isPushable, pushTag } from '../shared/push';
import { PUSH_TEXT } from '../generated/pushText';
import type { PushToken } from '../shared/push';
import type { User } from '../shared/models';

/**
 * How many devices one notification will be sent to.
 *
 * A restaurant legitimately has several — kitchen tablet, counter tablet, the
 * owner's phone. Twenty is far beyond that and is the signature of an account
 * whose tokens are not being cleaned up; sending to hundreds would turn one
 * order into a hundred requests.
 */
const MAX_DEVICES = 20;

/**
 * How long one delivery attempt may hold its claim.
 *
 * Longer than any send takes — a page of twenty devices is a few seconds — and
 * far shorter than a person's patience for an order alert that has not arrived.
 */
const CLAIM_STALE_MS = 2 * 60 * 1000;

/** `{{code}}` → the value. The same double-brace form the app's i18n uses. */
function fill(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? whole : String(value);
  });
}

/**
 * The sentence for this event, in the recipient's language.
 *
 * Falls back to Azerbaijani rather than to the key. A banner reading
 * `notifications.NEW_ORDER_FOR_RESTAURANT.title` on a kitchen tablet is worse
 * than one in the wrong language: the second is understood by most people in
 * Baku, and the first is understood by nobody.
 */
function sentenceFor(
  type: string,
  locale: string,
  params: Record<string, unknown>,
): { title: string; body: string } | null {
  const table = PUSH_TEXT[locale] ?? PUSH_TEXT[DEFAULT_LOCALE];
  const entry = table?.[type] ?? PUSH_TEXT[DEFAULT_LOCALE]?.[type];
  if (!entry) return null;

  return { title: fill(entry.title, params), body: fill(entry.body, params) };
}

/** Every live device belonging to this account. */
async function tokensFor(userId: string): Promise<PushToken[]> {
  const snapshot = await db
    .collection(COLLECTIONS.pushTokens)
    .where('userId', '==', userId)
    .limit(MAX_DEVICES)
    .get();

  return snapshot.docs.map((doc) => doc.data() as PushToken);
}

/**
 * Removes a token FCM has told us is dead.
 *
 * Only for the codes in `DEAD_TOKEN_CODES`. A network failure or a quota answer
 * must never delete one: unregistering a restaurant's kitchen tablet because of
 * a transient error turns one missed banner into every missed banner from then
 * on, and nobody would ever connect the two events.
 */
async function forget(token: string, reason: string): Promise<void> {
  await db
    .collection(COLLECTIONS.pushTokens)
    .doc(token)
    .delete()
    .catch(() => undefined);
  logger.info('push token removed', { reason });
}

/**
 * Sends one notification to every device its recipient has registered.
 *
 * Exported so `sendTestNotification` can use the same path: a test button that
 * exercises a different code path is a test button that passes while the real
 * thing is broken.
 */
export async function pushToUser(input: {
  userId: string;
  type: string;
  params?: Record<string, unknown>;
  orderId?: string | null;
  restaurantId?: string | null;
  link?: string | null;
  locale?: SupportedLocale;
}): Promise<{ sent: number; failed: number }> {
  const tokens = await tokensFor(input.userId);
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  const locale =
    input.locale ??
    ((await db
      .doc(paths.user(input.userId))
      .get()
      .then((snapshot) => (snapshot.data() as User | undefined)?.locale)
      .catch(() => undefined)) ||
      DEFAULT_LOCALE);

  const sentence = sentenceFor(input.type, locale, input.params ?? {});
  if (!sentence) {
    logger.warn('push: no sentence for type', { type: input.type });
    return { sent: 0, failed: 0 };
  }

  const tag = pushTag({
    type: input.type as NotificationType,
    orderId: input.orderId ?? null,
    restaurantId: input.restaurantId ?? null,
  });

  const messaging = getMessaging();
  let sent = 0;
  let failed = 0;

  await Promise.all(
    tokens.map(async (device) => {
      /*
       * A `notification` block AND a `data` block, deliberately.
       *
       * The notification block is what lets the operating system draw the
       * banner while the app is not running — on iOS it is the only thing that
       * can. The data block is what the service worker and the mobile app read
       * to decide where a tap should land. Sending only data would mean a
       * silent push on a closed iPhone, which is no push at all.
       */
      const message: TokenMessage = {
        token: device.token,
        notification: { title: sentence.title, body: sentence.body },
        data: {
          type: input.type,
          orderId: input.orderId ?? '',
          restaurantId: input.restaurantId ?? '',
          link: input.link ?? '',
          tag,
        },
        webpush: {
          notification: {
            tag,
            // The newer banner about one order replaces the older one rather
            // than stacking under it — six notifications about one delivery is
            // how a tray becomes unreadable.
            renotify: input.type === NotificationType.NEW_ORDER_FOR_RESTAURANT,
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-72.png',
          },
          fcmOptions: input.link ? { link: input.link } : undefined,
        },
        android: {
          priority: 'high',
          notification: { tag, channelId: 'qapinda-orders', sound: 'default' },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              // Collapses on the phone the same way, using the same subject.
              'thread-id': tag,
            },
          },
        },
      };

      try {
        await messaging.send(message);
        sent += 1;
      } catch (error) {
        failed += 1;
        const code = (error as { code?: string }).code ?? '';
        if (DEAD_TOKEN_CODES.includes(code)) {
          await forget(device.token, code);
        } else {
          logger.error('push send failed', { code });
        }
      }
    }),
  );

  return { sent, failed };
}

/**
 * A notification was stored. Wake the devices that care.
 *
 * Never throws upward. A push that fails must not retry the trigger: the
 * notification itself is already safely written and visible in the app, and a
 * retry storm over a dead token would cost far more than the banner is worth.
 */
export const deliverPush = onDocumentCreated(
  { document: 'notifications/{notificationId}', region: 'europe-west1' },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const type = data.type as NotificationType;
    if (!isPushable(type)) return;

    /*
     * ONE BANNER PER NOTIFICATION, EVEN WHEN THE TRIGGER RUNS TWICE.
     *
     * A Firestore trigger is AT LEAST once, not exactly once. Google will run
     * this function again for the same document when the first run times out,
     * crashes, or is lost to an infrastructure hiccup — and the first run may
     * well have sent the push before dying. Nothing here checked, so the second
     * run sent it again.
     *
     * What that looks like in the product: a customer's phone buzzing twice for
     * one order, or a kitchen tablet chiming twice for one ticket and the staff
     * looking for a second order that does not exist. It is rare and it is the
     * kind of rare that is never reproduced on demand and never believed when
     * reported.
     *
     * The claim is a transaction because two runs can be in flight at the same
     * moment; a read-then-write outside one would let both see "not sent" and
     * both proceed, which is the identical bug wearing a check.
     *
     * WHY THE CLAIM EXPIRES
     * ---------------------
     * A claim that never expires turns "sent twice" into "never sent": a run
     * that claimed and then died before sending would block every retry for
     * ever, and for a new-order alert that is the worse failure of the two.
     * After `CLAIM_STALE_MS` an unfinished claim is assumed dead and may be
     * taken again — long enough that a slow send is not overtaken, short enough
     * that a genuine retry is not left waiting.
     *
     * `pushSentAt`, once written, is permanent: that one is a completed send
     * and is never re-claimed.
     */
    const ref = event.data?.ref;
    if (!ref) return;

    const claimed = await db
      .runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const current = snapshot.data();
        if (!current) return false;
        if (current.pushSentAt) return false;

        const claimedMs = (current.pushClaimedAt as { toMillis?: () => number } | undefined)
          ?.toMillis?.();
        if (typeof claimedMs === 'number' && Date.now() - claimedMs < CLAIM_STALE_MS) {
          return false;
        }

        tx.update(ref, { pushClaimedAt: now() });
        return true;
      })
      .catch(() => {
        // A failed claim must not stop the notification being delivered at all.
        // Falling through to send risks the duplicate this guards against; not
        // sending risks silence. Silence on an order alert is the worse one, so
        // the transaction failing is treated as "go ahead".
        return true;
      });

    if (!claimed) {
      logger.info('deliverPush skipped: already claimed', {
        notificationId: event.params.notificationId,
      });
      return;
    }

    try {
      const result = await pushToUser({
        userId: data.recipientId as string,
        type,
        params: (data.params ?? {}) as Record<string, unknown>,
        orderId: (data.orderId ?? null) as string | null,
        restaurantId: (data.restaurantId ?? null) as string | null,
        link: (data.link ?? null) as string | null,
      });

      if (result.sent > 0) {
        /*
         * The delivery log, and why it is written here.
         *
         * `deliveryStatus` starts at `pending` and has until now only ever been
         * moved by a page that drew the notification. That left the case the
         * field exists for — "the restaurant says the order never reached
         * them" — answerable only when somebody had the app open. Recording the
         * push means the answer now covers the closed tablet too.
         */
        await ref.update({ pushSentAt: now(), pushDeviceCount: result.sent }).catch(() => undefined);
      }
    } catch (error) {
      logger.error('deliverPush failed', {
        notificationId: event.params.notificationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

/**
 * Sweeps up tokens for devices that stopped coming back.
 *
 * A token is refreshed every time the app starts, so anything untouched for two
 * months belongs to an uninstalled app, a cleared browser or a device that is
 * gone. They are harmless but not free: every one is a request FCM refuses on
 * every notification, and the count is what eventually pushes an account past
 * `MAX_DEVICES` so that a *live* device stops being sent to.
 */
export const pruneStalePushTokens = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeZone: 'Asia/Baku' },
  async () => {
    const cutoff = Timestamp.fromMillis(
      Date.now() - PUSH_TOKEN_STALE_DAYS * 24 * 60 * 60 * 1000,
    );

    const stale = await db
      .collection(COLLECTIONS.pushTokens)
      .where('lastSeenAt', '<', cutoff)
      .limit(500)
      .get();

    if (stale.empty) return;

    const batch = db.batch();
    for (const doc of stale.docs) batch.delete(doc.ref);
    await batch.commit();

    logger.info('stale push tokens pruned', { count: stale.size });
  },
);
