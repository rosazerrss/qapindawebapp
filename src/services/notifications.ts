'use client';

/**
 * Reading the bell.
 *
 * EVERY QUERY HERE IS SHAPED BY THE SECURITY RULE, NOT BY WHAT IS CONVENIENT
 * -------------------------------------------------------------------------
 * Firestore judges a list against the query rather than against the documents
 * it would return, so a filter that is missing here is not a query that returns
 * too much — it is a query that is refused outright, and the bell goes silently
 * empty. The `notifications` rule has exactly two clauses, and there is exactly
 * one function below for each of them:
 *
 *   `watchMyNotifications`         → `userId == <me>`
 *   `watchRestaurantNotifications` → `restaurantId == <mine>`
 *                                     AND `role in [the three restaurant roles]`
 *
 * The role filter on the second is the privacy boundary, not a tidy-up: a
 * courier's notifications carry the restaurant they ride for, and without it
 * the kitchen would be reading every driver's phone. See `firestore.rules`.
 *
 * WHY A RESTAURANT RUNS BOTH
 * -------------------------
 * Restaurant notifications are addressed to the owner's account — that is who
 * `createOrder` writes them to — but the person on shift is usually a manager
 * or a kitchen account. So the panel subscribes to the shop's inbox as well as
 * to its own, and the two are merged by `notificationId`, which the server
 * guarantees is unique per event.
 */

import {
  collection,
  doc,
  limit as limitTo,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '@/firebase/client';
import { COLLECTIONS } from '@/shared/collections';
import { NotificationStatus, RESTAURANT_NOTIFICATION_ROLES } from '@/shared/notifications';
import type { AppNotification } from '@/shared/models';

/**
 * How far back the bell looks.
 *
 * Enough that a busy restaurant's morning is all there, small enough that a
 * phone on a bad connection is not downloading a year of history to draw a
 * badge. There is no "load more": a notification nobody has opened in fifty
 * events is not going to be opened.
 */
export const NOTIFICATION_WINDOW = 50;

/**
 * How many documents go into one batched write.
 *
 * Four hundred, not Firestore's five hundred: the limit counts operations
 * rather than documents, and leaving headroom means a field added to one of
 * these writes later cannot turn a working batch into a rejected one.
 */
const MAX_BATCH = 400;

function noop(): void {
  /* Nothing to unsubscribe from when Firebase is not configured. */
}

/**
 * Whether this string can be the second half of a document path.
 *
 * `doc(db, collection, id)` hands its extra segments straight to the Firebase
 * SDK's `ResourcePath.fromString`, which calls `.indexOf` on each of them — so
 * an `undefined` id does not produce a Firestore error naming the problem, it
 * produces `Cannot read properties of undefined (reading 'indexOf')` from inside
 * whatever promise was building the reference. Every write below is a LOG about
 * a notification, so a row that cannot say which notification it is is simply
 * not written: a bell that throws would take the panel with it, and a hole in
 * the delivery log is the cheaper failure.
 */
function usableId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.trim() !== '';
}

/** The person's own inbox. Every role has one; for most it is the only one. */
export function watchMyNotifications(
  uid: string,
  onChange: (notifications: AppNotification[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return noop;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.notifications),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc'),
      limitTo(NOTIFICATION_WINDOW),
    ),
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.data() as AppNotification)),
    // A refused query and an empty inbox are the same call to `onChange` and
    // are not the same thing. The bell shows nothing either way, but the caller
    // is told which it was so that a broken subscription can be reported rather
    // than read as "no news".
    (error) => {
      onChange([]);
      onError?.(error);
    },
  );
}

/**
 * The shop's inbox, for whoever is on shift.
 *
 * The role filter is what the rule requires and what makes this safe: it is the
 * difference between "the restaurant's notifications" and "everything with this
 * restaurant's id on it", and the second of those includes the customer's order
 * updates and every courier's phone.
 */
export function watchRestaurantNotifications(
  restaurantId: string,
  onChange: (notifications: AppNotification[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return noop;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.notifications),
      where('restaurantId', '==', restaurantId),
      where('role', 'in', RESTAURANT_NOTIFICATION_ROLES),
      orderBy('createdAt', 'desc'),
      limitTo(NOTIFICATION_WINDOW),
    ),
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.data() as AppNotification)),
    (error) => {
      onChange([]);
      onError?.(error);
    },
  );
}

/**
 * Records that this notification actually reached a device.
 *
 * WHY THE BROWSER IS THE ONE THAT SAYS SO
 * ---------------------------------------
 * The server knows it wrote a document. It does not know that anybody ever
 * collected it, and the difference between those two facts is the entire
 * question behind "the restaurant says it never got the order". So the server
 * writes `pending` and this — running in a session that belongs to the
 * recipient, holding the document in its hand — is what moves it to `sent`.
 * A notification that stays `pending` all evening is the evidence.
 *
 * `title` and `body` travel with it because this is also the only part of the
 * system that owns the translations: the functions ship without the
 * dictionaries, so the sentence a person was really shown, in the language they
 * were really shown it in, can only be recorded from here. It is written
 * ALONGSIDE `titleKey`/`bodyKey`, never instead of them — the keys are what
 * every screen renders, which is why switching language re-translates history.
 *
 * Failure is silence, deliberately. This is a log, and a log that can break the
 * bell is worse than a log with a hole in it.
 */
export async function confirmNotificationsDelivered(
  entries: Array<{ notificationId: string; title: string; body: string }>,
): Promise<void> {
  const db = firestore();
  if (!db) return;

  const usable = entries.filter((entry) => usableId(entry.notificationId));
  if (usable.length === 0) return;

  /*
   * ONE WRITE, NOT FIFTY — AND THIS IS THE FIX FOR THE FROZEN PANEL.
   *
   * This used to confirm one notification per call, and every call was a
   * separate `updateDoc`. On a restaurant panel opened after a busy evening
   * that meant fifty individual writes going out at once — and every one of
   * them changed a document the panel is *subscribed to*, so every one came
   * back as a fresh snapshot, re-ran the announce path and re-rendered the
   * whole shell. Fifty renders of a screen that is already carrying the live
   * order listeners is not slow, it is a locked interface, and pressing the
   * bell in the middle of it was what people noticed.
   *
   * A batch is one write and therefore one snapshot. The window is fifty, well
   * inside `MAX_BATCH`, so the loop is really only there so that raising the
   * window later cannot quietly reintroduce the problem this comment is about.
   */
  for (let at = 0; at < usable.length; at += MAX_BATCH) {
    const batch = writeBatch(db);

    for (const entry of usable.slice(at, at + MAX_BATCH)) {
      batch.update(doc(db, COLLECTIONS.notifications, entry.notificationId), {
        deliveryStatus: 'sent',
        deliveredAt: serverTimestamp(),
        title: entry.title,
        body: entry.body,
      });
    }

    // A refused confirmation is not worth a broken screen: the notification is
    // on the page either way, and `deliveryStatus` is a diagnostic.
    await batch.commit().catch(() => undefined);
  }
}

/**
 * Marks one as read.
 *
 * `read` and `readAt` move together, because the model requires both and
 * because a flag with no timestamp behind it cannot answer "when". The security
 * rule permits exactly this pair and only on your own notification — a manager
 * may *see* the shop's inbox and cannot mark the owner's copy read, which is
 * why the caller checks ownership before offering the action.
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  const db = firestore();
  if (!db || !usableId(notificationId)) return;

  await updateDoc(doc(db, COLLECTIONS.notifications, notificationId), {
    read: true,
    readAt: serverTimestamp(),
    status: NotificationStatus.READ,
  }).catch(() => undefined);
}

/**
 * Marks a whole list read in one batch.
 *
 * One round trip rather than fifty, and atomic: "mark all as read" that leaves
 * half the badge behind is worse than one that does nothing. Chunked at
 * Firestore's 500-write limit, which the fifty-document window cannot reach
 * today but which costs nothing to be right about.
 */
export async function markNotificationsRead(notificationIds: string[]): Promise<void> {
  const db = firestore();
  const usable = notificationIds.filter(usableId);
  if (!db || usable.length === 0) return;

  for (let start = 0; start < usable.length; start += MAX_BATCH) {
    const batch = writeBatch(db);
    for (const id of usable.slice(start, start + MAX_BATCH)) {
      batch.update(doc(db, COLLECTIONS.notifications, id), {
        read: true,
        readAt: serverTimestamp(),
        status: NotificationStatus.READ,
      });
    }
    await batch.commit().catch(() => undefined);
  }
}
