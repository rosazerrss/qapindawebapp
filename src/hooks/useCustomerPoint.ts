'use client';

/**
 * QAPINDA — where the customer is, for the purpose of ordering dinner.
 *
 * ONE ANSWER, USED BY EVERY SCREEN THAT SORTS RESTAURANTS
 * -------------------------------------------------------
 * The home page and the search screen both order restaurants, and both have to
 * agree about which address they are ordering them from. Two copies of "read
 * the addresses, pick the default one, take its coordinates" would drift apart
 * the first time one of them was corrected — and the symptom of that drift is a
 * grid whose order changes when a customer taps the search icon, which reads as
 * a bug in the list rather than as two rules.
 *
 * WHICH ADDRESS, WHEN THERE ARE SEVERAL
 * -------------------------------------
 * The default one, if it is pinned. Otherwise the newest pinned one — because
 * an account with a default that predates the map (older addresses have no
 * coordinates) should still get a near-first list from the address they added
 * last, rather than falling back to no answer at all.
 *
 * NOTHING IS GUESSED
 * ------------------
 * No IP lookup, and the browser is never asked for its location. A person
 * browsing before they have added an address gets the city they chose in the
 * region picker, in the order the platform has always used. Asking a stranger
 * for their coordinates on the first screen is how an app gets refused
 * permission permanently, and the answer it buys is a city-level guess we
 * already have.
 */

import { useEffect, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { watchAddresses } from '@/services/addresses';
import type { GeoPoint } from '@/shared/geo';
import type { Address } from '@/shared/models';

/** A pinned address, or nothing. `(0,0)` is an empty field, not the Atlantic. */
function pointOf(address: Address | undefined): GeoPoint | null {
  if (!address) return null;
  const { lat, lng } = address;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * The point to measure from, live, or `null` for a guest and for anybody whose
 * addresses carry no coordinates.
 */
export function useCustomerPoint(): GeoPoint | null {
  const { firebaseUser, profile } = useAuth();

  const uid = firebaseUser?.uid ?? null;
  const defaultAddressId = profile?.defaultAddressId ?? null;

  /*
   * The answer carries the uid it belongs to.
   *
   * Signing out — or signing in as somebody else — must not leave the previous
   * person's coordinates ordering this person's restaurants, and clearing them
   * with a `setState` in the effect body is a cascading render the project's
   * lint rule refuses (correctly: it is a second render to undo the first).
   *
   * Comparing during render answers it with no extra render at all: a stale
   * entry simply stops matching, and the hook reads null until the new
   * subscription speaks.
   */
  const [answer, setAnswer] = useState<{ uid: string; point: GeoPoint | null } | null>(null);

  useEffect(() => {
    if (!uid) return;

    return watchAddresses(uid, (list) => {
      const chosen =
        list.find((entry) => entry.id === defaultAddressId && pointOf(entry)) ??
        list.find((entry) => entry.isDefault && pointOf(entry)) ??
        // `watchAddresses` orders newest first, so this is the most recent
        // address that actually has a pin on it.
        list.find((entry) => pointOf(entry));

      setAnswer({ uid, point: pointOf(chosen) });
    });
  }, [uid, defaultAddressId]);

  return uid && answer?.uid === uid ? answer.point : null;
}
