'use client';

/**
 * Geri bildirim — the customer's closed support tickets, live.
 *
 * Read directly rather than through a callable: the entries change while the
 * screen is open (an operator closes a second ticket; the rating this person
 * just left comes back confirmed) and a subscription is what makes that show
 * without a refresh.
 *
 * The query filters on `userId` because Firestore evaluates the read rule
 * against the QUERY, not against the documents it would return — a query
 * without that clause is refused outright, whatever it would have matched.
 */

import {
  collection,
  limit as limitTo,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';

import { firestore } from '@/firebase/client';
import { COLLECTIONS } from '@/shared/collections';
import type { SupportFeedback } from '@/shared/models';

/**
 * How many entries the screen carries.
 *
 * Nothing here lives longer than `SUPPORT_FEEDBACK_RETENTION_DAYS`, so this is
 * a ceiling on "closed tickets in a fortnight" rather than on history. Fifty is
 * far past what any one customer produces and keeps a broken retention job from
 * turning into an unbounded read.
 */
const WINDOW = 50;

export function watchMyFeedback(
  uid: string,
  onChange: (entries: SupportFeedback[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return () => undefined;
  }

  return onSnapshot(
    query(
      collection(db, COLLECTIONS.supportFeedback),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc'),
      limitTo(WINDOW),
    ),
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.data() as SupportFeedback)),
    // An empty list and a refused query look identical on screen unless the
    // caller is told which it was, and a screen that cannot tell them apart
    // shows "heç nə yoxdur" over a broken subscription.
    (error) => {
      onChange([]);
      onError?.(error);
    },
  );
}
