import { describe, expect, it } from 'vitest';

import { CouponFunding, CouponType } from '../shared/enums';
import type { Coupon, TimestampLike } from '../shared/models';
import { evaluateCoupon, type CouponContext } from '../shared/pricing';

const HOUR = 3600_000;
const NOW = 1_700_000_000_000;

function ts(millis: number): TimestampLike {
  return {
    toMillis: () => millis,
    toDate: () => new Date(millis),
    seconds: Math.floor(millis / 1000),
    nanoseconds: 0,
  };
}

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    code: 'ILKSIFARIS',
    type: CouponType.FIXED,
    value: 400, // 4.00 ₼
    fundedBy: CouponFunding.PLATFORM,
    platformShareBps: 10000,
    restaurantIds: [],
    allowedUserIds: [],
    minSubtotal: 1000,
    maxDiscount: null,
    firstOrderOnly: false,
    usageLimitTotal: null,
    usageLimitPerCustomer: 1,
    usedCount: 0,
    active: true,
    validFrom: ts(NOW - 24 * HOUR),
    validUntil: ts(NOW + 24 * HOUR),
    createdBy: 'admin',
    createdAt: ts(NOW - 48 * HOUR),
    ...overrides,
  };
}

function context(overrides: Partial<CouponContext> = {}): CouponContext {
  return {
    subtotal: 2000,
    deliveryFee: 300,
    restaurantId: 'r1',
    isFirstOrder: true,
    redemptionsByCustomer: 0,
    customerId: 'c1',
    nowMillis: NOW,
    ...overrides,
  };
}

describe('discount arithmetic', () => {
  it('takes a fixed amount off the food', () => {
    const result = evaluateCoupon(coupon(), context());
    expect(result).toMatchObject({ valid: true, discount: 400, fundedBy: CouponFunding.PLATFORM });
  });

  it('never gives back more than the food cost', () => {
    const result = evaluateCoupon(coupon({ value: 5000 }), context({ subtotal: 1200 }));
    expect(result.discount).toBe(1200);
  });

  it('applies a percentage in basis points', () => {
    const result = evaluateCoupon(
      coupon({ type: CouponType.PERCENT, value: 2000 }), // 20%
      context({ subtotal: 2500 }),
    );
    expect(result.discount).toBe(500);
  });

  it('rounds a percentage to the nearest qəpik', () => {
    const result = evaluateCoupon(
      coupon({ type: CouponType.PERCENT, value: 1500 }), // 15%
      context({ subtotal: 1533 }),
    );
    expect(result.discount).toBe(230); // 229.95 → 230
  });

  it('honours the cap on a percentage coupon', () => {
    const result = evaluateCoupon(
      coupon({ type: CouponType.PERCENT, value: 5000, maxDiscount: 800 }),
      context({ subtotal: 10000 }),
    );
    expect(result.discount).toBe(800);
  });

  it('makes free delivery worth exactly the delivery fee', () => {
    expect(
      evaluateCoupon(coupon({ type: CouponType.FREE_DELIVERY }), context({ deliveryFee: 350 })).discount,
    ).toBe(350);
  });

  it('makes free delivery worth nothing when delivery was already free', () => {
    expect(
      evaluateCoupon(coupon({ type: CouponType.FREE_DELIVERY }), context({ deliveryFee: 0 })).discount,
    ).toBe(0);
  });
});

describe('when a coupon is refused', () => {
  it('refuses an unknown code', () => {
    expect(evaluateCoupon(null, context())).toMatchObject({
      valid: false,
      error: 'coupon-not-found',
      discount: 0,
    });
  });

  it('refuses a switched-off coupon', () => {
    expect(evaluateCoupon(coupon({ active: false }), context())).toMatchObject({
      error: 'coupon-inactive',
    });
  });

  it('refuses a coupon whose window has closed', () => {
    expect(
      evaluateCoupon(coupon({ validUntil: ts(NOW - HOUR) }), context()),
    ).toMatchObject({ error: 'coupon-expired' });
  });

  it('refuses a coupon whose window has not opened', () => {
    expect(
      evaluateCoupon(coupon({ validFrom: ts(NOW + HOUR) }), context()),
    ).toMatchObject({ error: 'coupon-not-started' });
  });

  it('refuses a coupon meant for another restaurant', () => {
    expect(
      evaluateCoupon(coupon({ restaurantIds: ['r2', 'r3'] }), context({ restaurantId: 'r1' })),
    ).toMatchObject({ error: 'coupon-wrong-restaurant' });

    expect(
      evaluateCoupon(coupon({ restaurantIds: ['r1', 'r2'] }), context({ restaurantId: 'r1' })).valid,
    ).toBe(true);
  });

  it('refuses a cart under the coupon minimum', () => {
    expect(
      evaluateCoupon(coupon({ minSubtotal: 2000 }), context({ subtotal: 1999 })),
    ).toMatchObject({ error: 'coupon-below-minimum' });

    expect(evaluateCoupon(coupon({ minSubtotal: 2000 }), context({ subtotal: 2000 })).valid).toBe(
      true,
    );
  });

  it('refuses a first-order coupon to a returning customer', () => {
    expect(
      evaluateCoupon(coupon({ firstOrderOnly: true }), context({ isFirstOrder: false })),
    ).toMatchObject({ error: 'coupon-first-order-only' });
  });

  it('refuses once the whole campaign is spent', () => {
    expect(
      evaluateCoupon(coupon({ usageLimitTotal: 100, usedCount: 100 }), context()),
    ).toMatchObject({ error: 'coupon-limit-reached' });

    expect(
      evaluateCoupon(coupon({ usageLimitTotal: 100, usedCount: 99 }), context()).valid,
    ).toBe(true);
  });

  it('refuses a second use by the same person', () => {
    // This count is per person — phone plus address — not per account, which
    // one new sign-up would defeat.
    expect(
      evaluateCoupon(coupon({ usageLimitPerCustomer: 1 }), context({ redemptionsByCustomer: 1 })),
    ).toMatchObject({ error: 'coupon-already-used' });

    expect(
      evaluateCoupon(coupon({ usageLimitPerCustomer: 3 }), context({ redemptionsByCustomer: 2 }))
        .valid,
    ).toBe(true);
  });

  it('yields no discount at all when it refuses', () => {
    const refusals = [
      evaluateCoupon(null, context()),
      evaluateCoupon(coupon({ active: false }), context()),
      evaluateCoupon(coupon({ validUntil: ts(NOW - HOUR) }), context()),
      evaluateCoupon(coupon({ firstOrderOnly: true }), context({ isFirstOrder: false })),
    ];
    for (const result of refusals) {
      expect(result.valid).toBe(false);
      expect(result.discount).toBe(0);
      expect(result.fundedBy).toBeUndefined();
    }
  });
});

describe('funding is always reported', () => {
  it('carries the funder through to the caller so settlement can use it', () => {
    expect(evaluateCoupon(coupon({ fundedBy: CouponFunding.PLATFORM }), context()).fundedBy).toBe(
      CouponFunding.PLATFORM,
    );
    expect(evaluateCoupon(coupon({ fundedBy: CouponFunding.RESTAURANT }), context()).fundedBy).toBe(
      CouponFunding.RESTAURANT,
    );
  });
});


describe('who pays for the discount', () => {
  it('hands the whole discount to the platform when the platform funds it', () => {
    const result = evaluateCoupon(coupon({ fundedBy: CouponFunding.PLATFORM }), context());
    expect(result.funding).toEqual({ restaurant: 0, platform: 400 });
  });

  it('hands the whole discount to the restaurant when the restaurant funds it', () => {
    const result = evaluateCoupon(
      coupon({ fundedBy: CouponFunding.RESTAURANT, restaurantIds: ['r1'] }),
      context(),
    );
    expect(result.funding).toEqual({ restaurant: 400, platform: 0 });
  });

  it('splits a shared discount by the agreed share', () => {
    const result = evaluateCoupon(
      coupon({ fundedBy: CouponFunding.SHARED, platformShareBps: 4000, value: 1000 }),
      context({ subtotal: 5000 }),
    );
    // 10.00 ₼ off, Qapında pays 40% of it.
    expect(result.funding).toEqual({ restaurant: 600, platform: 400 });
  });

  it('never loses a qəpik to rounding — the halves always add back up', () => {
    for (const discount of [1, 3, 7, 33, 99, 101, 333, 999]) {
      const result = evaluateCoupon(
        coupon({ fundedBy: CouponFunding.SHARED, platformShareBps: 3333, value: discount }),
        context({ subtotal: 100_000 }),
      );
      const { restaurant, platform } = result.funding!;
      expect(restaurant + platform).toBe(discount);
      expect(restaurant).toBeGreaterThanOrEqual(0);
      expect(platform).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('coupons addressed to named customers', () => {
  it('lets the named customer use it', () => {
    const result = evaluateCoupon(coupon({ allowedUserIds: ['c1', 'c2'] }), context({ customerId: 'c1' }));
    expect(result.valid).toBe(true);
  });

  it('refuses everybody else, even holding the right code', () => {
    const result = evaluateCoupon(coupon({ allowedUserIds: ['c1'] }), context({ customerId: 'c9' }));
    expect(result).toMatchObject({ valid: false, error: 'coupon-not-for-customer', discount: 0 });
  });

  it('stays open to everyone when no customer is named', () => {
    const result = evaluateCoupon(coupon({ allowedUserIds: [] }), context({ customerId: 'anyone' }));
    expect(result.valid).toBe(true);
  });
});

/**
 * Coupons written before a field existed.
 *
 * This is not a hypothetical. Coupons created before `allowedUserIds` and
 * `platformShareBps` were added are sitting in the live database right now,
 * and reading a missing field as though the type guaranteed it took the whole
 * checkout down: a customer applying an old coupon got "something went wrong"
 * and no way past it. A stored document is not a TypeScript type, and these
 * tests exist so that lesson stays learned.
 */
describe('coupons stored before the newer fields existed', () => {
  /** Exactly what an old document looks like: the new keys are simply absent. */
  function legacyCoupon(overrides: Partial<Coupon> = {}): Coupon {
    const full = coupon(overrides) as unknown as Record<string, unknown>;
    delete full.allowedUserIds;
    delete full.platformShareBps;
    return full as unknown as Coupon;
  }

  it('still applies, instead of taking checkout down', () => {
    const result = evaluateCoupon(legacyCoupon(), context());
    expect(result).toMatchObject({ valid: true, discount: 400 });
  });

  it('treats a missing customer list as open to everyone', () => {
    const result = evaluateCoupon(legacyCoupon(), context({ customerId: 'anybody' }));
    expect(result.valid).toBe(true);
  });

  it('prices an old platform-funded coupon exactly as before', () => {
    const result = evaluateCoupon(
      legacyCoupon({ fundedBy: CouponFunding.PLATFORM }),
      context(),
    );
    expect(result.funding).toEqual({ restaurant: 0, platform: 400 });
  });

  it('prices an old restaurant-funded coupon exactly as before', () => {
    const result = evaluateCoupon(
      legacyCoupon({ fundedBy: CouponFunding.RESTAURANT, restaurantIds: ['r1'] }),
      context(),
    );
    expect(result.funding).toEqual({ restaurant: 400, platform: 0 });
  });

  it('never produces a NaN discount from a missing share', () => {
    // NaN would flow into the order total and corrupt the amount charged.
    const result = evaluateCoupon(legacyCoupon({ fundedBy: CouponFunding.SHARED }), context());
    expect(Number.isFinite(result.funding!.restaurant)).toBe(true);
    expect(Number.isFinite(result.funding!.platform)).toBe(true);
    expect(result.funding!.restaurant + result.funding!.platform).toBe(result.discount);
  });

  it('survives a missing restaurant list too', () => {
    const stripped = coupon() as unknown as Record<string, unknown>;
    delete stripped.restaurantIds;
    const result = evaluateCoupon(stripped as unknown as Coupon, context());
    expect(result.valid).toBe(true);
  });
});
