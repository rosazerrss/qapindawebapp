'use client';

/**
 * The one subscription behind every bell in the product.
 *
 * The customer app, the restaurant panel, the courier's phone, the operator's
 * desk and the admin panel all mount the same `NotificationBell`, which calls
 * this. There is deliberately no per-panel variant: five copies of "listen,
 * count the unread ones, make a sound" is five places for the sound rules to be
 * got subtly differently, and the whole reason `shared/notifications.ts` exists
 * is that this went that way once already.
 *
 * WHAT THE EFFECT MAY AND MAY NOT DO
 * ----------------------------------
 * The list is state, because it arrives over time. Everything derivable from
 * it — the unread count, the ids to mark read, whether there is anything at all
 * — is computed during render rather than stored, so there is no second render
 * whose only job is to catch up with the first.
 *
 * THE SOUND IS DECIDED IN `shared/notificationRing.ts`, NOT HERE
 * -------------------------------------------------------------
 * A Firestore listener re-delivers its whole window on every reconnect, so
 * "the snapshot changed" is not the same question as "something happened".
 * `decideRing` holds the session's memory of which notification ids have
 * already been announced and answers with at most one tone per delivery; this
 * file only hands it what arrived and plays what it is told.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/i18n';
import { isFirebaseConfigured } from '@/firebase/client';
import { playNotificationTone } from '@/lib/notificationSound';
import { raisePushNotification } from '@/lib/push';
import {
  confirmNotificationsDelivered,
  markNotificationRead,
  markNotificationsRead,
  watchMyNotifications,
  watchRestaurantNotifications,
} from '@/services/notifications';
import { NotificationType } from '@/shared/enums';
import {
  NOTIFICATION_SPEC,
  NotificationDeliveryStatus,
  RESTAURANT_NOTIFICATION_ROLES,
  notificationPushEnabled,
} from '@/shared/notifications';
import { createRingMemory, decideRing, type RingCandidate } from '@/shared/notificationRing';
import type { AppNotification, TimestampLike } from '@/shared/models';

/** A Firestore timestamp, a pending write, or a document written by an older
 * deployment. Only the first of those can be sorted on. */
function millisOf(value: TimestampLike | null | undefined): number {
  if (!value) return 0;
  return typeof value.toMillis === 'function' ? value.toMillis() : 0;
}

/**
 * Which id this notification answers to, or nothing at all.
 *
 * `notificationId` and `id` are both written by the server and carry the same
 * string, and a document that predates one of them still has the other. A
 * document that has NEITHER — and rows written before both fields existed are
 * still sitting in Firestore — used to reach `doc(db, 'notifications',
 * undefined)`, which is not a Firestore error but a `TypeError` thrown from
 * inside the SDK's path parser, in an unawaited promise, on every panel screen
 * that mounts the bell. So the question is asked once, here, and a row that
 * cannot name itself is still SHOWN — it just takes no part in anything that
 * needs a path.
 */
function idOf(entry: AppNotification): string | null {
  const id = entry.notificationId ?? entry.id;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

export interface NotificationsState {
  /** Newest first, own inbox and shop inbox merged, never duplicated. */
  notifications: AppNotification[];
  unreadCount: number;
  /** True once the first snapshot has landed — an empty bell is not a loading one. */
  loaded: boolean;
  /** The subscription was refused or broke. Not the same as "no notifications". */
  failed: boolean;
  markRead: (notification: AppNotification) => void;
  markAllRead: () => void;
}

export function useNotifications(): NotificationsState {
  const { firebaseUser, profile, role, restaurantId } = useAuth();
  const { t } = useLocale();

  const uid = firebaseUser?.uid ?? null;
  const watchesShop =
    RESTAURANT_NOTIFICATION_ROLES.includes(role) && Boolean(restaurantId);

  /*
   * The two inboxes are held apart and merged during render.
   *
   * Merging them into one piece of state would mean each snapshot having to
   * subtract the other listener's documents before adding its own, and getting
   * that wrong shows up as a notification that flickers out of the list when
   * the other listener happens to fire.
   */
  const [mine, setMine] = useState<AppNotification[] | null>(null);
  const [shop, setShop] = useState<AppNotification[] | null>(null);
  const [failed, setFailed] = useState(false);

  // The session's memory of what has already been announced out loud. A ref
  // rather than state: changing it must never cause a render, and it must
  // survive every render it does not cause.
  const ring = useRef(createRingMemory());

  // The push preference and the translator are read at the moment a snapshot
  // arrives, not at the moment the listener was created — otherwise switching
  // language or turning push on would mean tearing down the subscription and
  // re-priming the ring memory, which would make the whole window ring again.
  const router = useRouter();

  /*
   * The router is carried in the ref alongside the rest.
   *
   * `announce` is a stable callback with an empty dependency list — it has to
   * be, because re-creating it would re-run the effect that subscribes to the
   * notification stream and re-announce everything already on screen. So
   * anything it needs from the render is read through this ref rather than
   * closed over, and the router is no different.
   */
  const push = useRef<{
    enabled: boolean;
    uid: string | null;
    translate: typeof t;
    navigate: (href: string) => void;
  }>({
    enabled: false,
    uid: null,
    translate: t,
    navigate: () => undefined,
  });

  useEffect(() => {
    push.current = {
      enabled: notificationPushEnabled(profile?.notificationPrefs),
      uid,
      translate: t,
      navigate: (href) => router.push(href),
    };
  }, [profile, router, t, uid]);

  /*
   * The ids this session has already reported as delivered.
   *
   * A ref, and not a piece of state, for the same reason the ring memory is
   * one: it must survive every render and cause none. Without it every snapshot
   * would re-issue the same confirmation write until the server's own echo came
   * back, which on a slow connection is a handful of pointless writes per
   * notification.
   */
  const confirmed = useRef(new Set<string>());

  /**
   * Everything a delivery of notifications does besides land in the list.
   *
   * One place, called by both listeners, so that a document arriving through
   * the shop's inbox rings exactly like the same document arriving through the
   * owner's own — `decideRing` is keyed on `notificationId`, so the pair
   * collapses to one sound rather than two.
   */
  const announce = useCallback((raw: AppNotification[]) => {
    // Retired types are dropped before anything is announced, for the same
    // reason they are dropped from the list below: their translation keys are
    // gone, and a browser banner reading `notifications.ORDER_DELIVERED.body`
    // is worse than no banner.
    const incoming = raw.filter(
      (entry) => Object.hasOwn(NOTIFICATION_SPEC, entry.type) && idOf(entry) !== null,
    );

    const candidates: RingCandidate[] = incoming.map((entry) => ({
      notificationId: idOf(entry) as string,
      type: entry.type,
      // The document's own frozen answer, never a live recomputation: somebody
      // who turns the sound off should not silence what they are already
      // looking at, and somebody who turns it on should not make it ring.
      //
      // The one exception is a new order, and it is not an exception to the
      // rule so much as a question of ownership: `NewOrderAlarm` is what makes
      // that noise, and it is a repeating alarm rather than a single chime. A
      // one-shot tone here as well would be a second sound on top of the first,
      // arriving in the same half-second and saying the same thing.
      soundEnabled:
        entry.soundEnabled === true && entry.type !== NotificationType.NEW_ORDER_FOR_RESTAURANT,
      orderId: entry.orderId,
      restaurantId: entry.restaurantId,
    }));

    // Read before `decideRing`, which is what makes both of these true: it
    // marks everything delivered as seen and flips `primed` on the way past.
    const fresh = new Set(
      candidates
        .filter((entry) => !ring.current.seen.has(entry.notificationId))
        .map((entry) => entry.notificationId),
    );
    const primed = ring.current.primed;

    const tone = decideRing(ring.current, candidates, Date.now());
    if (tone) playNotificationTone(tone);

    /*
     * "It reached a device" — recorded from the one place that can honestly say
     * so.
     *
     * Only for notifications addressed to the person signed in: a manager
     * reading the shop's inbox has not received the owner's copy, and the
     * security rule refuses that write anyway. The sentence goes with it,
     * rendered in the language this session is actually showing, because the
     * server ships without the dictionaries — the keys on the document remain
     * what every screen renders, so history still re-translates.
     */
    const pending: Array<{ notificationId: string; title: string; body: string }> = [];

    for (const entry of incoming) {
      const id = idOf(entry);
      if (!id) continue;
      if (entry.userId !== push.current.uid) continue;
      if (entry.deliveryStatus === NotificationDeliveryStatus.SENT) continue;
      if (confirmed.current.has(id)) continue;

      confirmed.current.add(id);
      pending.push({
        notificationId: id,
        title: push.current.translate(entry.titleKey, entry.params),
        body: push.current.translate(entry.bodyKey, entry.params),
      });
    }

    /*
     * Collected first, written once.
     *
     * This loop used to fire one `updateDoc` per notification, and every one of
     * those changed a document this very listener is subscribed to — so fifty
     * unconfirmed notifications became fifty writes, fifty snapshots, and fifty
     * re-renders of whatever mounts this hook. On the restaurant panel that is
     * the entire shell, on top of the live order listeners, and the result was
     * an interface that stopped responding for several seconds. One batch is
     * one write and one snapshot.
     */
    if (pending.length > 0) void confirmNotificationsDelivered(pending);

    // Push follows the same "new to this session" test as the sound, so a
    // reconnect cannot re-raise a banner the person already dismissed. It is
    // not gated on the tone: a silent notification may still be worth a banner
    // while the tab is in the background, which is the whole point of it.
    if (!primed || !push.current.enabled) return;

    for (const entry of incoming) {
      const id = idOf(entry);
      if (!id || !fresh.has(id)) continue;

      raisePushNotification({
        tag: id,
        title: push.current.translate(entry.titleKey, entry.params),
        body: push.current.translate(entry.bodyKey, entry.params),
        link: entry.link,
        /*
         * Client-side navigation, not `window.location`.
         *
         * Tapping a notification banner used to reload the whole application:
         * a white flash, every Firestore listener torn down and re-established,
         * the basket re-read, and a second or two of nothing on a phone. For a
         * restaurant tablet that is the moment a new order arrives — the worst
         * possible time to throw the screen away and rebuild it.
         *
         * `router.push` keeps the running app and swaps the route.
         */
        onOpen: (link) => push.current.navigate(link),
      });
    }
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !uid) return;

    return watchMyNotifications(
      uid,
      (next) => {
        setMine(next);
        setFailed(false);
        announce(next);
      },
      () => setFailed(true),
    );
  }, [uid, announce]);

  useEffect(() => {
    if (!isFirebaseConfigured || !uid || !watchesShop || !restaurantId) return;

    return watchRestaurantNotifications(
      restaurantId,
      (next) => {
        setShop(next);
        announce(next);
      },
      // A refused shop query must not blank the bell: the person still has
      // their own inbox, and reporting the failure is the caller's business.
      () => setShop([]),
    );
  }, [uid, watchesShop, restaurantId, announce]);

  /*
   * Signing out, or signing in as somebody else, must not leave the previous
   * account's notifications on screen for the instant before the new listener
   * answers. Derived from the current uid rather than cleared in an effect,
   * which would be exactly that instant.
   */
  const notifications = useMemo(() => {
    if (!uid) return [];

    const merged = new Map<string, AppNotification>();
    for (const entry of [...(mine ?? []), ...(shop ?? [])]) {
      /*
       * A notification of a kind this version no longer has is dropped.
       *
       * The customer's seven order-status types were removed, and the rows
       * written before that are still sitting in Firestore. Their `titleKey`
       * points at a translation that no longer exists, and `t()` answers a
       * missing key with the key itself — so leaving them in would put
       * "notifications.ORDER_ACCEPTED.title" on a customer's screen and count
       * it towards the unread badge. Nothing is deleted; it simply stops being
       * shown.
       */
      if (!Object.hasOwn(NOTIFICATION_SPEC, entry.type)) continue;
      // Keyed by the id when there is one, and by the row's own identity when
      // there is not: a document that cannot name itself must still be listed
      // rather than collapsed into every other nameless one.
      merged.set(idOf(entry) ?? `anonymous:${merged.size}`, entry);
    }

    return [...merged.values()].sort((a, b) => millisOf(b.createdAt) - millisOf(a.createdAt));
  }, [uid, mine, shop]);

  const unreadCount = notifications.filter((entry) => !entry.read).length;

  const markRead = useCallback(
    (notification: AppNotification) => {
      // Only your own. The rule permits the update only on a notification
      // addressed to you, so a manager tapping the owner's copy in the shop's
      // inbox would be making a write the server refuses — better not to make
      // it than to show a row that silently un-reads itself on the next
      // snapshot.
      if (!uid || notification.userId !== uid || notification.read) return;
      const id = idOf(notification);
      if (id) void markNotificationRead(id);
    },
    [uid],
  );

  const markAllRead = useCallback(() => {
    if (!uid) return;
    const ids = notifications
      .filter((entry) => !entry.read && entry.userId === uid)
      .map(idOf)
      .filter((id): id is string => id !== null);
    void markNotificationsRead(ids);
  }, [uid, notifications]);

  return {
    notifications,
    unreadCount,
    loaded: !uid || mine !== null,
    failed,
    markRead,
    markAllRead,
  };
}
