'use client';

/**
 * Reading a single order, live.
 *
 * There is one caller: the support thread, which needs the order behind a
 * ticket so that an operator's quick replies can name the code and the amount
 * instead of asking the operator to look them up and retype them. Everything
 * else that reads orders — the customer's history, the restaurant's board, the
 * courier's runs, the operator's live list — already has a subscription of its
 * own shaped to its own query.
 *
 * A subscription rather than a one-off read, and for the reason the whole
 * operator screen is being rebuilt this way: an order attached to a ticket
 * changes status while the ticket is open, and a figure that was fetched once
 * is a figure that is wrong by the time it matters.
 *
 * The rules answer this as a `get`, so it is allowed for the customer, for the
 * restaurant, for the order's own courier — and for platform staff, who pass
 * `ownsRestaurant` for every restaurant. A reader who may not see it gets the
 * error callback, never a half-populated screen.
 */

import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

import { firestore } from '@/firebase/client';
import { paths } from '@/shared/collections';
import type { Order } from '@/shared/models';

export function watchOrder(
  orderId: string,
  onChange: (order: Order | null) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, paths.order(orderId)),
    (snapshot) => onChange(snapshot.exists() ? (snapshot.data() as Order) : null),
    () => onChange(null),
  );
}
