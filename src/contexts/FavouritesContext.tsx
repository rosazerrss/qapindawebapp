'use client';

/**
 * The customer's shortlist.
 *
 * The set of saved ids is kept live so a heart can render filled or empty
 * without a round trip. The toggle is optimistic — the heart fills the instant
 * it is tapped, and rolls back only if the server refuses.
 *
 * A guest has no favourites: the heart sends them to sign in rather than
 * pretending to save something that would vanish.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { collection, onSnapshot } from 'firebase/firestore';

import { firestore } from '@/firebase/client';
import { toggleFavourite as callToggle } from '@/firebase/callables';
import { useAuth } from './AuthContext';
import { favouriteId, paths } from '@/shared/collections';
import type { Favourite } from '@/shared/models';

type Kind = 'PRODUCT' | 'RESTAURANT';

interface FavouritesValue {
  /** Document ids: `p_{productId}` / `r_{restaurantId}`. */
  ids: Set<string>;
  items: Favourite[];
  loading: boolean;
  isSaved: (kind: Kind, targetId: string) => boolean;
  toggle: (kind: Kind, targetId: string) => Promise<{ ok: boolean; signInRequired?: boolean }>;
}

const FavouritesContext = createContext<FavouritesValue | null>(null);

export function FavouritesProvider({ children }: { children: ReactNode }) {
  const { firebaseUser } = useAuth();
  const [loadedItems, setLoadedItems] = useState<Favourite[]>([]);
  /** Set once the first snapshot lands, so `loading` can be derived. */
  const [received, setReceived] = useState(false);
  /** Ids currently mid-flight, so the heart can lead the network. */
  const [pending, setPending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const db = firestore();
    if (!db || !firebaseUser) return;

    return onSnapshot(
      collection(db, paths.userFavourites(firebaseUser.uid)),
      (snapshot) => {
        setLoadedItems(snapshot.docs.map((entry) => entry.data() as Favourite));
        setReceived(true);
      },
      () => setReceived(true),
    );
  }, [firebaseUser]);

  // Signing out clears the list by derivation, not by an effect.
  const items = firebaseUser ? loadedItems : [];
  const loading = Boolean(firebaseUser) && !received;

  const ids = useMemo(() => {
    const set = new Set(items.map((item) => item.id));
    // Overlay the optimistic state on top of what the server has told us.
    for (const [id, saved] of Object.entries(pending)) {
      if (saved) set.add(id);
      else set.delete(id);
    }
    return set;
  }, [items, pending]);

  const isSaved = useCallback(
    (kind: Kind, targetId: string) => ids.has(favouriteId(kind, targetId)),
    [ids],
  );

  const toggle = useCallback<FavouritesValue['toggle']>(
    async (kind, targetId) => {
      if (!firebaseUser) return { ok: false, signInRequired: true };

      const id = favouriteId(kind, targetId);
      const next = !ids.has(id);

      setPending((current) => ({ ...current, [id]: next }));

      const result = await callToggle({ kind, targetId });

      // The listener now holds the truth; drop the optimistic overlay either
      // way, so a refusal snaps the heart back rather than lying.
      setPending((current) => {
        const copy = { ...current };
        delete copy[id];
        return copy;
      });

      return { ok: result.ok };
    },
    [firebaseUser, ids],
  );

  const value = useMemo<FavouritesValue>(
    () => ({ ids, items, loading, isSaved, toggle }),
    [ids, items, loading, isSaved, toggle],
  );

  return <FavouritesContext.Provider value={value}>{children}</FavouritesContext.Provider>;
}

export function useFavourites(): FavouritesValue {
  const context = useContext(FavouritesContext);
  if (!context) throw new Error('useFavourites must be used inside FavouritesProvider');
  return context;
}
