/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — how far away a restaurant is, and what that is worth.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * WHY DISTANCE IS THE RIGHT DEFAULT ORDER
 * ---------------------------------------
 * The shopfront used to lead with rating. That is the correct order for a
 * DIRECTORY and the wrong one for a delivery app: the best-rated kebab shop in
 * the city is useless to somebody who lives forty minutes from it, and on this
 * platform it is worse than useless, because every restaurant delivers with its
 * own couriers inside its own radius. A restaurant too far away is not a
 * mediocre option — it is not an option at all, and putting it at the top of
 * the list spends the customer's attention on something they cannot order.
 *
 * So once the customer has told us where they are, near comes first. Rating
 * still decides between two shops at a similar distance; it simply stops being
 * the first question.
 *
 * WHAT HAPPENS WITHOUT AN ADDRESS, WHICH IS MOST FIRST VISITS
 * -----------------------------------------------------------
 * Nothing is guessed. No IP lookup, no browser location prompt on a page
 * nobody asked it of. With no address the list stays in the order it has always
 * been — open first, then rating — and is limited to the city the customer
 * chose in the region picker. That is a complete, honest answer to "what can I
 * order", and it is what somebody browsing before they sign up should get.
 *
 * WHY A MISSING PIN SORTS LAST RATHER THAN FIRST
 * ----------------------------------------------
 * A restaurant whose owner never dropped a pin has `lat: null`. Its distance is
 * unknown, not zero — and a sort that treated unknown as zero would put every
 * unpinned restaurant above the one across the street. They go to the end of
 * the near-first list, still visible, still orderable, in their own rating
 * order.
 */

import { distanceMetres, type GeoPoint } from './geo';
import type { Restaurant } from './models';

/**
 * The distance from a customer's point to a restaurant, in metres.
 *
 * `null` when either end has no coordinates — which is a different answer from
 * a large number and is treated differently everywhere it is read.
 */
export function restaurantDistanceMetres(
  restaurant: Pick<Restaurant, 'lat' | 'lng'>,
  from: GeoPoint | null,
): number | null {
  if (!from) return null;
  if (typeof restaurant.lat !== 'number' || typeof restaurant.lng !== 'number') return null;
  if (!Number.isFinite(restaurant.lat) || !Number.isFinite(restaurant.lng)) return null;
  // (0, 0) is in the Atlantic — an uninitialised field, not a location. The
  // same guard `geo.ts` applies to an address.
  if (restaurant.lat === 0 && restaurant.lng === 0) return null;

  return distanceMetres(from, { lat: restaurant.lat, lng: restaurant.lng });
}

/**
 * "450 m", "1,2 km", "12 km".
 *
 * Below a kilometre in whole metres, because that is the range where the
 * difference between 300 and 900 matters to somebody deciding. Above it, one
 * decimal to ten kilometres and none beyond — "11,3 km" and "11 km" are the
 * same fact to a hungry person, and the extra digit only makes the card busier.
 *
 * A comma, not a point: this is written for Azerbaijani readers, and the whole
 * app writes money the same way.
 */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;

  const km = metres / 1000;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

/**
 * Ranks two restaurants for a customer standing at `from`.
 *
 * Three questions in order, and the order is the design:
 *
 *   1. CAN IT TAKE THE ORDER? A closed shop is never the best answer to "which
 *      one", however close it is. This is the rule the shopfront already had
 *      and it stays first.
 *   2. HOW FAR? Nearest first, once we know.
 *   3. HOW GOOD? The tie-breaker, and the only question when there is no
 *      address — which is the behaviour the platform had before this file.
 *
 * `openNow` is passed in rather than computed here because "open" depends on
 * the clock, and a comparator that reads the clock is a comparator whose answer
 * changes halfway through a sort.
 */
export function compareByProximity(
  a: { distance: number | null; open: boolean; rating: number; ratingCount: number },
  b: { distance: number | null; open: boolean; rating: number; ratingCount: number },
): number {
  const openGap = Number(b.open) - Number(a.open);
  if (openGap !== 0) return openGap;

  // Unknown distance is not zero. A restaurant with no pin sinks below every
  // measured one rather than floating to the top of the list.
  if (a.distance !== null || b.distance !== null) {
    if (a.distance === null) return 1;
    if (b.distance === null) return -1;
    if (a.distance !== b.distance) return a.distance - b.distance;
  }

  const ratingOf = (entry: { rating: number; ratingCount: number }) =>
    entry.ratingCount > 0 ? entry.rating : 0;

  return ratingOf(b) - ratingOf(a);
}
