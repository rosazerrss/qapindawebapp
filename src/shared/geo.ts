/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Distance, and the delivery circle.
 *
 * The restaurant draws a circle on the map in its own panel
 * (`src/components/restaurant/DeliveryMap.tsx`): a pin and a radius in metres.
 * That circle is a promise — "we drive this far" — and until now it was only a
 * picture. This file is the arithmetic that makes it real, and it is shared on
 * purpose: the checkout screen must mark an address as out of range using the
 * exact function the server refuses the order with, or the app and the server
 * end up disagreeing about the same address.
 *
 * Straight-line (great-circle) distance, not driving distance. That matches
 * what is drawn — a circle, not a road network — and it is the honest
 * measurement for a promise the restaurant made by dragging a radius slider.
 * A routing service could come later; it would change the number, not the
 * shape of this code.
 *
 * Distances are whole metres, like every other distance in this codebase.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** IUGG mean Earth radius, in metres. */
const EARTH_RADIUS_METRES = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function isFinitePoint(point: {
  lat: number | null | undefined;
  lng: number | null | undefined;
}): point is GeoPoint {
  return (
    typeof point.lat === 'number' &&
    typeof point.lng === 'number' &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    // (0, 0) is in the Atlantic. Nothing in Azerbaijan is there, and a stored
    // zero is far more likely to be an uninitialised field than a location —
    // treating it as one would put every address ~4000 km "out of range" and
    // read as the radius rule being broken.
    !(point.lat === 0 && point.lng === 0)
  );
}

/**
 * Great-circle distance between two points, in whole metres.
 *
 * Haversine rather than the flat-earth approximation: the approximation is
 * fine over a few kilometres and wrong in a way nobody notices until a
 * borderline address is refused, and "why was my order refused" is not a
 * question worth answering with "because of the map projection".
 */
export function distanceMetres(from: GeoPoint, to: GeoPoint): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return Math.round(2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Why an address could not be measured against a circle.
 *
 * Two very different situations, and they must not be folded together:
 *
 *  - `address-not-pinned` — the customer's address has no coordinates. Older
 *    addresses predate the map, and an address typed rather than pinned still
 *    saves with `lat: null`. This is REFUSED at checkout, not waved through:
 *    an unmeasurable address is exactly the one that turns into a courier
 *    driving to the next town. The customer is told to open the address and
 *    drop a pin, which is a thing they can actually do.
 *
 *  - `restaurant-not-pinned` — the RESTAURANT has no coordinates, so there is
 *    no circle to be outside of. This one is ALLOWED, deliberately: refusing
 *    would take a whole shop offline over a gap in its own profile that no
 *    customer can fix, and the platform would be punishing the wrong person.
 *    It is not silent — `createOrder` logs it, so the missing pin is visible
 *    to whoever looks — and it disappears the moment the restaurant drags its
 *    marker once.
 */
export type DeliveryRangeUnknownReason = 'address-not-pinned' | 'restaurant-not-pinned';

export type DeliveryRangeVerdict = 'inside' | 'outside' | 'unknown';

export interface DeliveryRange {
  verdict: DeliveryRangeVerdict;
  /** Null whenever the verdict is `unknown` — there was nothing to measure. */
  distanceMetres: number | null;
  radiusMetres: number;
  reason: DeliveryRangeUnknownReason | null;
}

export interface DeliveryOrigin {
  lat: number | null;
  lng: number | null;
  deliveryRadiusMeters: number;
}

export interface DeliveryDestination {
  lat: number | null;
  lng: number | null;
}

/**
 * Is this address inside the restaurant's circle?
 *
 * A point exactly ON the boundary is INSIDE. The radius is the promise the
 * restaurant made, and the honest reading of "we deliver within 5 km" is that
 * 5000 m is included — the alternative is refusing an order over a rounding
 * error in the fifth decimal place of a map pin.
 */
export function checkDeliveryRange(
  origin: DeliveryOrigin,
  destination: DeliveryDestination,
): DeliveryRange {
  const radiusMetres = Math.max(0, Math.round(origin.deliveryRadiusMeters || 0));

  if (!isFinitePoint(origin)) {
    return { verdict: 'unknown', distanceMetres: null, radiusMetres, reason: 'restaurant-not-pinned' };
  }
  if (!isFinitePoint(destination)) {
    return { verdict: 'unknown', distanceMetres: null, radiusMetres, reason: 'address-not-pinned' };
  }

  const metres = distanceMetres(origin, destination);
  return {
    verdict: metres <= radiusMetres ? 'inside' : 'outside',
    distanceMetres: metres,
    radiusMetres,
    reason: null,
  };
}

/**
 * The one question the UI asks: may this address be ordered to?
 *
 * `unknown` because the restaurant has no pin is a yes; `unknown` because the
 * address has no pin is a no. See `DeliveryRangeUnknownReason` for why the two
 * are answered differently — and note that this function and the server's
 * refusal in `createOrder` read the same verdict, so a screen can never offer
 * an order the server is about to refuse.
 */
export function mayDeliverTo(range: DeliveryRange): boolean {
  if (range.verdict === 'inside') return true;
  if (range.verdict === 'outside') return false;
  return range.reason === 'restaurant-not-pinned';
}


// ---------------------------------------------------------------------------
// Delivery zones
// ---------------------------------------------------------------------------

/**
 * ONE FEE FOR EVERY DISTANCE IS A FEE THAT IS WRONG TWICE.
 *
 * A restaurant with a five-kilometre radius and a single 2 ₼ fee overcharges the
 * flat across the road and loses money on the far edge of its circle — so in
 * practice it sets the fee for the far edge and the near customers, who are the
 * ones who order most often, quietly pay for somebody else's petrol.
 *
 * A zone is a distance band with its own fee and its own minimum. "0–2 km → 1 ₼,
 * 2–5 km → 2 ₼, minimum 15 ₼ beyond three" is now a thing a restaurant can say.
 *
 * WHAT MAKES THIS SAFE TO ADD
 * ---------------------------
 * Zones are optional and additive. A restaurant with none behaves exactly as
 * before — `deliveryFee` and `minOrderAmount` on the profile are the answer for
 * every distance — and every restaurant on the platform today has none. Nothing
 * needs migrating and nothing changes until somebody draws a band.
 *
 * They are also only ever consulted when the distance is actually known. An
 * address with no map pin, or a restaurant that never dropped one, falls back
 * to the flat fee rather than being refused or guessed at: the platform already
 * treats an unpinned restaurant as "deliver anywhere", and a delivery fee is not
 * the place to start punishing that.
 */
export interface DeliveryZone {
  /** Inclusive lower bound, in metres. The first zone starts at 0. */
  fromMetres: number;
  /** Exclusive upper bound. The last zone should match the delivery radius. */
  toMetres: number;
  fee: number;
  /**
   * The basket this zone needs before the restaurant will send anyone.
   *
   * Null means "use the restaurant's own minimum". A far zone usually raises
   * it — driving eight kilometres for a 6 ₼ order is a loss whatever the fee.
   */
  minOrderAmount: number | null;
}

/** The flat answer, for a restaurant that has drawn no bands. */
export interface DeliveryTerms {
  fee: number;
  minOrderAmount: number;
  /** Which band answered, for a screen that wants to say "0–2 km". */
  zone: DeliveryZone | null;
}

/**
 * What this delivery costs and what it must be worth.
 *
 * The zones are searched in order and the FIRST band containing the distance
 * wins, so overlapping bands are resolved rather than added up — a restaurant
 * that types 0–3 and 2–5 gets the 0–3 answer at 2.5 km instead of a refusal it
 * would have to debug.
 *
 * A distance past the last band falls back to the flat fee rather than being
 * free: a gap at the top of the list is a restaurant that has not finished
 * filling the form, and charging nothing is the one wrong answer.
 */
export function deliveryTermsFor(input: {
  zones?: DeliveryZone[] | null;
  distanceMetres: number | null;
  fee: number;
  minOrderAmount: number;
}): DeliveryTerms {
  const flat = { fee: input.fee, minOrderAmount: input.minOrderAmount, zone: null };

  if (!input.zones || input.zones.length === 0) return flat;
  if (input.distanceMetres === null || !Number.isFinite(input.distanceMetres)) return flat;

  const metres = input.distanceMetres;
  const zone = input.zones.find(
    (band) => metres >= band.fromMetres && metres < band.toMetres,
  );

  if (!zone) return flat;

  return {
    fee: zone.fee,
    minOrderAmount: zone.minOrderAmount ?? input.minOrderAmount,
    zone,
  };
}

/** The most a delivery can cost here — what a restaurant page shows before an address is known. */
export function widestDeliveryFee(zones: DeliveryZone[] | null | undefined, fallback: number): number {
  if (!zones || zones.length === 0) return fallback;
  return Math.max(...zones.map((zone) => zone.fee));
}

/** The cheapest, for "çatdırılma {{amount}}-dan" on a listing card. */
export function narrowestDeliveryFee(
  zones: DeliveryZone[] | null | undefined,
  fallback: number,
): number {
  if (!zones || zones.length === 0) return fallback;
  return Math.min(...zones.map((zone) => zone.fee));
}

/**
 * Are these bands usable? Returns the problem, or null.
 *
 * Checked in the panel before saving and on the server before storing, from
 * this one function, so a restaurant cannot end up with bands that leave a hole
 * its own customers fall through.
 */
export function checkDeliveryZones(zones: DeliveryZone[]): string | null {
  if (zones.length === 0) return null;
  if (zones.length > 5) return 'too-many';

  const sorted = [...zones].sort((a, b) => a.fromMetres - b.fromMetres);

  if (sorted[0].fromMetres !== 0) return 'must-start-at-zero';

  for (let index = 0; index < sorted.length; index += 1) {
    const zone = sorted[index];
    if (zone.toMetres <= zone.fromMetres) return 'empty-band';
    if (zone.fee < 0) return 'negative-fee';
    if (zone.minOrderAmount !== null && zone.minOrderAmount < 0) return 'negative-minimum';

    // No gaps. A hole between 2 km and 3 km is a customer quoted the flat fee
    // for no reason anybody can explain to them.
    const next = sorted[index + 1];
    if (next && next.fromMetres !== zone.toMetres) return 'gap';
  }

  return null;
}
