'use client';

/**
 * Where the restaurant is, and how far it will drive. Also where a customer
 * lives — the same component draws both, because they are the same question
 * asked from two sides, and the circle one of them drags is the circle the
 * other one has to fall inside.
 *
 * WHICH MAP
 * ---------
 * Google when a browser key is configured; OpenStreetMap when it is not. The
 * choice is made here, once, and nowhere else in the app knows it was made —
 * `maps/types.ts` holds the props both implementations answer to.
 *
 * The decision is a build-time one (`hasGoogleMaps()` reads a baked-in
 * environment variable), so the Google implementation carries a runtime
 * fallback of its own for the day the key stops being accepted. See the note
 * at the top of `GoogleDeliveryMap`.
 *
 * WHAT THE PIN IS FOR, IN BOTH CASES
 * ----------------------------------
 * It is not decoration and it is not a nicety on top of the written address.
 * The pin is what the server measures the delivery radius against. What is
 * drawn on this screen is exactly what will be enforced later, which is why
 * the circle is drawn at all: a restaurant owner should be able to SEE the
 * area they are committing to rather than guess at a number of kilometres.
 */

import { hasGoogleMaps } from '@/lib/googleMaps';

import { GoogleDeliveryMap } from './maps/GoogleDeliveryMap';
import { LeafletDeliveryMap } from './maps/LeafletDeliveryMap';
import type { DeliveryMapProps } from './maps/types';

export type { MapPoint } from './maps/types';

export function DeliveryMap(props: DeliveryMapProps) {
  return hasGoogleMaps() ? <GoogleDeliveryMap {...props} /> : <LeafletDeliveryMap {...props} />;
}
