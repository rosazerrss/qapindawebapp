'use client';

/**
 * Everything the courier app reads.
 *
 * EVERY QUERY HERE CARRIES `courier.id == me`, AND THAT IS NOT AN OPTIMISATION
 * ---------------------------------------------------------------------------
 * Firestore judges a list against the *query*, not against the documents it
 * would return. The `orders` rule lets a courier through on one clause only —
 * `uid() == resource.data.courier.id` — so a query that does not say so is not
 * a query that returns too much: it is refused outright, and the screen goes
 * silently empty. Adding a status filter widens nothing; dropping the courier
 * filter breaks everything. There is deliberately no function in this file that
 * can be called without a courier id.
 *
 * WHY THE HISTORY IS SORTED BY `placedAt` AND NOT BY WHEN IT ENDED
 * ---------------------------------------------------------------
 * Firestore drops every document that has no value for the field being sorted
 * on. `completedAt` is written when an order completes and stays null on one
 * that was cancelled — so a history sorted by it would have quietly hidden
 * exactly the half of the list the driver most often goes looking for. Every
 * order has a `placedAt`, so that is the sort, and the *displayed* date is
 * still the ending. It also means the history is served by the same composite
 * index the active list already uses.
 *
 * A REFUSED SUBSCRIPTION IS NOT AN EMPTY ONE
 * ------------------------------------------
 * Each function reports the two outcomes separately, because a driver who is
 * told they have nothing to do when in fact the app is broken simply goes home.
 */

import {
  collection,
  doc,
  limit as limitTo,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '@/firebase/client';
import { COLLECTIONS, paths } from '@/shared/collections';
import { COURIER_ACTIVE_STATUSES, COURIER_HISTORY_STATUSES } from '@/shared/courier';
import type { Order } from '@/shared/models';

/**
 * How far back the history goes.
 *
 * A driver's own deliveries, not the restaurant's — a busy month is a few
 * hundred, and nobody scrolls past the first screen looking for one. There is
 * no "load more" for the same reason the bell has none: this is a record to
 * check, not an archive to browse.
 */
export const COURIER_HISTORY_WINDOW = 100;

function noop(): void {
  /* Nothing to unsubscribe from when Firebase is not configured. */
}

/**
 * The deliveries this driver is carrying right now.
 *
 * Newest first, which is also the order they were handed over in.
 */
export function watchCourierActiveOrders(
  courierId: string,
  onChange: (orders: Order[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return noop;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.orders),
      where('courier.id', '==', courierId),
      where('status', 'in', COURIER_ACTIVE_STATUSES),
      orderBy('placedAt', 'desc'),
      limitTo(80),
    ),
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.data() as Order)),
    (error) => {
      onChange([]);
      onError?.(error);
    },
  );
}

/** The deliveries this driver has finished, well or badly. Never anyone else's. */
export function watchCourierHistory(
  courierId: string,
  onChange: (orders: Order[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return noop;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.orders),
      where('courier.id', '==', courierId),
      where('status', 'in', COURIER_HISTORY_STATUSES),
      orderBy('placedAt', 'desc'),
      limitTo(COURIER_HISTORY_WINDOW),
    ),
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.data() as Order)),
    (error) => {
      onChange([]);
      onError?.(error);
    },
  );
}

/**
 * One delivery, live, by its document id.
 *
 * Reached from a card the driver tapped, so the id came from a query that had
 * already proved this order is theirs — but the URL is a text field like any
 * other, and the `get` clause in the rule is what makes typing somebody else's
 * id into it useless. A refusal arrives here as an error, not as a missing
 * document, and the screen says so rather than claiming the order was deleted.
 */
export function watchCourierOrder(
  orderId: string,
  onChange: (order: Order | null) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange(null);
    return noop;
  }

  return onSnapshot(
    doc(db, paths.order(orderId)),
    (snapshot) => onChange(snapshot.exists() ? (snapshot.data() as Order) : null),
    (error) => {
      onChange(null);
      onError?.(error);
    },
  );
}
