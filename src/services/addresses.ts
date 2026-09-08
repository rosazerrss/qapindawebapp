'use client';

/**
 * A person's saved addresses.
 *
 * Read directly (the rules allow only the owner), written through a callable so
 * the address hash and the "only one default" rule stay server-side.
 */

import { collection, onSnapshot, orderBy, query, type Unsubscribe } from 'firebase/firestore';

import { firestore } from '@/firebase/client';
import { paths } from '@/shared/collections';
import type { Address } from '@/shared/models';

export function watchAddresses(uid: string, onChange: (list: Address[]) => void): Unsubscribe {
  const db = firestore();
  if (!db) {
    onChange([]);
    return () => undefined;
  }

  return onSnapshot(
    query(collection(db, paths.userAddresses(uid)), orderBy('createdAt', 'desc')),
    (snapshot) => onChange(snapshot.docs.map((entry) => entry.data() as Address)),
    () => onChange([]),
  );
}
