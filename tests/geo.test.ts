import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { checkDeliveryRange, distanceMetres, mayDeliverTo } from '../shared/geo';

/**
 * The delivery circle, measured.
 *
 * "MÜŞTERİ ÜNVAN DAXİL ETDİKDE RESTORANIN RADİUSU İÇERİSİNDEDİRSE SİFARİŞ EDE
 * BİLER YOXSA EDE BİLMEZ" — so the arithmetic that answers it is worth knowing
 * to be right, including at the boundary and including the two cases where
 * there is nothing to measure.
 */

// Two points in Baku, roughly 1.1 km apart along a meridian.
const FOUNTAIN_SQUARE = { lat: 40.3712, lng: 49.8378 };

describe('distanceMetres', () => {
  it('is zero from a point to itself', () => {
    expect(distanceMetres(FOUNTAIN_SQUARE, FOUNTAIN_SQUARE)).toBe(0);
  });

  it('measures a degree of latitude as about 111 km', () => {
    const north = { lat: FOUNTAIN_SQUARE.lat + 1, lng: FOUNTAIN_SQUARE.lng };
    expect(distanceMetres(FOUNTAIN_SQUARE, north)).toBeGreaterThan(111_000);
    expect(distanceMetres(FOUNTAIN_SQUARE, north)).toBeLessThan(111_400);
  });

  it('is symmetric', () => {
    const other = { lat: 40.4093, lng: 49.8671 };
    expect(distanceMetres(FOUNTAIN_SQUARE, other)).toBe(distanceMetres(other, FOUNTAIN_SQUARE));
  });

  it('does not confuse latitude with longitude', () => {
    // A degree of longitude at this latitude is much shorter than a degree of
    // latitude. Swapping the two is the classic haversine bug, and it would
    // quietly widen or narrow every delivery area on the platform.
    const north = { lat: FOUNTAIN_SQUARE.lat + 0.1, lng: FOUNTAIN_SQUARE.lng };
    const east = { lat: FOUNTAIN_SQUARE.lat, lng: FOUNTAIN_SQUARE.lng + 0.1 };
    expect(distanceMetres(FOUNTAIN_SQUARE, north)).toBeGreaterThan(
      distanceMetres(FOUNTAIN_SQUARE, east),
    );
  });
});

describe('the boundary', () => {
  const origin = { ...FOUNTAIN_SQUARE, deliveryRadiusMeters: 5000 };

  /** A point due north of the restaurant, `metres` away. */
  const northOf = (metres: number) => ({
    lat: FOUNTAIN_SQUARE.lat + metres / 111_195,
    lng: FOUNTAIN_SQUARE.lng,
  });

  it('lets an address inside the circle order', () => {
    const range = checkDeliveryRange(origin, northOf(2000));
    expect(range.verdict).toBe('inside');
    expect(mayDeliverTo(range)).toBe(true);
  });

  it('counts a point exactly on the boundary as inside', () => {
    // The radius is the promise the restaurant made by dragging the slider.
    // Refusing an order at exactly 5000 m would be refusing it over rounding.
    const exactly = northOf(5000);
    expect(distanceMetres(FOUNTAIN_SQUARE, exactly)).toBe(5000);

    const range = checkDeliveryRange(origin, exactly);
    expect(range.verdict).toBe('inside');
    expect(range.distanceMetres).toBe(5000);
    expect(mayDeliverTo(range)).toBe(true);
  });

  it('refuses one metre past it', () => {
    const range = checkDeliveryRange(origin, northOf(5001));
    expect(range.verdict).toBe('outside');
    expect(range.distanceMetres).toBe(5001);
    expect(mayDeliverTo(range)).toBe(false);
  });

  it('refuses an address in another city', () => {
    // Ganja, ~330 km away.
    const range = checkDeliveryRange(origin, { lat: 40.6828, lng: 46.3606 });
    expect(range.verdict).toBe('outside');
    expect(mayDeliverTo(range)).toBe(false);
  });

  it('reports the distance and the radius, so the customer can be told how far out', () => {
    const range = checkDeliveryRange(origin, northOf(7000));
    expect(range.radiusMetres).toBe(5000);
    expect(range.distanceMetres).toBe(7000);
  });
});

describe('an address with no coordinates', () => {
  const origin = { ...FOUNTAIN_SQUARE, deliveryRadiusMeters: 5000 };

  it('is never silently treated as inside', () => {
    const range = checkDeliveryRange(origin, { lat: null, lng: null });
    expect(range.verdict).toBe('unknown');
    expect(range.verdict).not.toBe('inside');
    expect(range.distanceMetres).toBeNull();
  });

  it('is refused, because an unmeasurable address is the one that goes wrong', () => {
    // The deliberate decision: an older address, or one typed rather than
    // pinned, cannot be checked against the circle — so it cannot be ordered
    // to until the customer drops a pin, which is a thing they can do.
    expect(mayDeliverTo(checkDeliveryRange(origin, { lat: null, lng: null }))).toBe(false);
    expect(checkDeliveryRange(origin, { lat: null, lng: null }).reason).toBe('address-not-pinned');
  });

  it('treats a stored (0, 0) as no coordinates rather than as the Atlantic', () => {
    const range = checkDeliveryRange(origin, { lat: 0, lng: 0 });
    expect(range.reason).toBe('address-not-pinned');
  });
});

describe('a restaurant with no pin', () => {
  it('has drawn no circle, so nothing is outside it', () => {
    // The other half of the deliberate decision, and it points the other way:
    // taking a shop offline over a gap in its own profile would punish it for
    // something no customer can fix. `createOrder` logs it instead.
    const range = checkDeliveryRange(
      { lat: null, lng: null, deliveryRadiusMeters: 5000 },
      FOUNTAIN_SQUARE,
    );
    expect(range.verdict).toBe('unknown');
    expect(range.reason).toBe('restaurant-not-pinned');
    expect(mayDeliverTo(range)).toBe(true);
  });
});

describe('the server is what enforces it', () => {
  const source = readFileSync('functions/src/orders/create.ts', 'utf8');

  it('refuses an out-of-range address in createOrder', () => {
    expect(source).toContain('checkDeliveryRange(restaurant, address)');
    expect(source).toContain('fail(AppErrorCode.ADDRESS_OUT_OF_RANGE');
    expect(source).toContain('fail(AppErrorCode.ADDRESS_LOCATION_MISSING)');
  });

  it('measures before it prices, so no coupon is spent on a refused order', () => {
    const check = source.indexOf('checkDeliveryRange(restaurant, address)');
    const commit = source.indexOf('await db.runTransaction');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(commit);
  });

  it('tells the checkout screen the same answer through previewOrder', () => {
    expect(source).toContain('deliveryRange');
    expect(source).toContain('deliverable: mayDeliverTo(deliveryRange)');
  });
});

describe('the customer is told before the checkout, not after', () => {
  it('marks an out-of-range address in the picker and on the restaurant page', () => {
    for (const file of ['src/app/checkout/page.tsx', 'src/app/restaurant/[handle]/RestaurantView.tsx']) {
      expect(readFileSync(file, 'utf8'), file).toContain('checkDeliveryRange(');
    }
  });

  it('has the sentence in all three languages', () => {
    for (const locale of ['az', 'en', 'ru']) {
      const dictionary = JSON.parse(
        readFileSync(`src/i18n/translations/${locale}.json`, 'utf8'),
      ) as { restaurant: Record<string, string>; checkout: Record<string, string> };

      expect(dictionary.restaurant.outOfRangeTitle, locale).toBeTruthy();
      expect(dictionary.checkout.blockedOutOfRange, locale).toBeTruthy();
      // Interpolation is `{{param}}`. A single brace ships as literal text.
      expect(dictionary.restaurant.outOfRangeBody).toContain('{{address}}');
      expect(dictionary.restaurant.outOfRangeBody).not.toMatch(/[^{]\{[^{]/);
    }
  });
});
