import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  MAX_COUPON_CUSTOMERS,
  addCouponCustomerTo,
  evaluateCoupon,
  removeCouponCustomerFrom,
} from '../shared/pricing';
import { CouponFunding, CouponType } from '../shared/enums';
import type { Coupon } from '../shared/models';

/**
 * QAPINDA — a coupon given to one named customer.
 *
 * "ADMİN İSTİFADEÇİLERE AYRI AYRILIQLDA ÖZEL KUPONLAR VERE BİLMELİDİR."
 *
 * The thing worth testing about a personal coupon is not that it appears in
 * the right list — that is a screen, and a screen can be wrong without anybody
 * losing money. It is that NOBODY ELSE CAN SPEND IT, and that the two edits
 * which could accidentally make it public are refused.
 *
 * Both of those are answered by pure functions in `/shared`, which is why they
 * live there: the callable that writes to Firestore carries the answer, it does
 * not decide it.
 */

const stamp = (millis: number) => ({ toMillis: () => millis }) as Coupon['validFrom'];

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    code: 'SHEXSIABC123',
    type: CouponType.FIXED,
    value: 500,
    fundedBy: CouponFunding.PLATFORM,
    platformShareBps: 10000,
    restaurantIds: [],
    allowedUserIds: ['aysel'],
    minSubtotal: 0,
    maxDiscount: null,
    firstOrderOnly: false,
    usageLimitTotal: 1,
    usageLimitPerCustomer: 1,
    usedCount: 0,
    active: true,
    validFrom: stamp(0),
    validUntil: stamp(Date.now() + 86_400_000),
    createdBy: 'admin',
    createdAt: stamp(0),
    ...overrides,
  } as Coupon;
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    customerId: 'aysel',
    restaurantId: 'rest-1',
    subtotal: 2000,
    deliveryFee: 300,
    isFirstOrder: false,
    redemptionsByCustomer: 0,
    nowMillis: Date.now(),
    ...overrides,
  } as Parameters<typeof evaluateCoupon>[1];
}

describe('only the named customer may spend a personal coupon', () => {
  it('lets the customer it was written for use it', () => {
    const result = evaluateCoupon(coupon(), context({ customerId: 'aysel' }));
    expect(result.valid).toBe(true);
    expect(result.discount).toBe(500);
  });

  it('refuses everybody else, whatever else is right about the order', () => {
    const result = evaluateCoupon(coupon(), context({ customerId: 'somebody-else' }));
    expect(result.valid).toBe(false);
    expect(result.error).toBe('coupon-not-for-customer');
    expect(result.discount).toBe(0);
  });

  it('refuses somebody who was taken off the coupon', () => {
    // The removal is a list edit; the refusal that follows from it is this.
    const after = removeCouponCustomerFrom(['aysel', 'rashad'], 'rashad');
    const result = evaluateCoupon(
      coupon({ allowedUserIds: after.allowedUserIds }),
      context({ customerId: 'rashad' }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('coupon-not-for-customer');
  });

  it('is enforced on the server, not by hiding the card', () => {
    /*
     * The screen filters `myCoupons` so a customer is not shown a coupon they
     * cannot use — but the refusal that matters happens where the order is
     * priced. If `createOrder` ever stopped calling `evaluateCoupon`, every
     * test above would still pass and the rule would be gone, so the call site
     * is asserted too.
     */
    const create = readFileSync('functions/src/orders/create.ts', 'utf8');
    expect(create).toContain('evaluateCoupon');

    const pricing = readFileSync('shared/pricing.ts', 'utf8');
    expect(pricing).toContain("'coupon-not-for-customer'");
  });

  it('treats a coupon with no names on it as open to everybody', () => {
    // Campaigns created before `allowedUserIds` existed have no such field, and
    // an ordinary campaign has it empty. Both mean "anybody".
    expect(evaluateCoupon(coupon({ allowedUserIds: [] }), context({ customerId: 'x' })).valid).toBe(
      true,
    );

    const legacy = coupon();
    delete (legacy as Partial<Coupon>).allowedUserIds;
    expect(evaluateCoupon(legacy, context({ customerId: 'x' })).valid).toBe(true);
  });
});

describe('adding a customer to a coupon', () => {
  it('adds them', () => {
    const change = addCouponCustomerTo(['aysel'], 'rashad');
    expect(change.changed).toBe(true);
    expect(change.allowedUserIds).toEqual(['aysel', 'rashad']);
    expect(change.error).toBeUndefined();
  });

  it('and then that customer can use it', () => {
    const change = addCouponCustomerTo(['aysel'], 'rashad');
    expect(
      evaluateCoupon(coupon({ allowedUserIds: change.allowedUserIds }), context({ customerId: 'rashad' }))
        .valid,
    ).toBe(true);
  });

  it('is silent about somebody who is already on it', () => {
    // Not an error: the admin's intent is already true, and a second audit
    // entry saying so would be noise in the log somebody reads later.
    const change = addCouponCustomerTo(['aysel'], 'aysel');
    expect(change.changed).toBe(false);
    expect(change.error).toBeUndefined();
    expect(change.allowedUserIds).toEqual(['aysel']);
  });

  it('REFUSES to add the first name to a public campaign', () => {
    /*
     * The dangerous edit. An empty list means "everybody", so adding one name
     * to a live public campaign takes it away from every other customer on the
     * platform in a single write.
     */
    const change = addCouponCustomerTo([], 'aysel');
    expect(change.error).toBe('coupon-is-public');
    expect(change.changed).toBe(false);
    expect(change.allowedUserIds).toEqual([]);
  });

  it('refuses to grow the list past its ceiling', () => {
    const full = Array.from({ length: MAX_COUPON_CUSTOMERS }, (_, index) => `customer-${index}`);
    const change = addCouponCustomerTo(full, 'one-too-many');
    expect(change.error).toBe('coupon-audience-full');
    expect(change.allowedUserIds).toHaveLength(MAX_COUPON_CUSTOMERS);
  });
});

describe('removing a customer from a coupon', () => {
  it('removes them and leaves the others alone', () => {
    const change = removeCouponCustomerFrom(['aysel', 'rashad', 'nigar'], 'rashad');
    expect(change.changed).toBe(true);
    expect(change.allowedUserIds).toEqual(['aysel', 'nigar']);
    expect(change.deactivate).toBe(false);
  });

  it('is silent about somebody who was never on it', () => {
    const change = removeCouponCustomerFrom(['aysel'], 'nobody');
    expect(change.changed).toBe(false);
    expect(change.allowedUserIds).toEqual(['aysel']);
  });

  it('ASKS FOR THE COUPON TO BE SWITCHED OFF when the last name comes off', () => {
    // Storing an empty list would leave the coupon active and valid for
    // everybody — the same public giveaway, arrived at from the other side.
    const change = removeCouponCustomerFrom(['aysel'], 'aysel');
    expect(change.changed).toBe(true);
    expect(change.allowedUserIds).toEqual([]);
    expect(change.deactivate).toBe(true);
  });
});

describe('the workflow around it', () => {
  it('is exposed as callables and wired into the client', () => {
    const index = readFileSync('functions/src/index.ts', 'utf8');
    for (const name of [
      'couponCustomers',
      'addCouponCustomer',
      'removeCouponCustomer',
      'grantCustomerCoupon',
    ]) {
      expect(index).toContain(name);
    }

    const callables = readFileSync('src/firebase/callables.ts', 'utf8');
    expect(callables).toContain('grantCustomerCoupon');
    expect(callables).toContain('addCouponCustomer');
  });

  it('carries the shared rule rather than repeating it', () => {
    const manage = readFileSync('functions/src/coupons/manage.ts', 'utf8');
    expect(manage).toContain('addCouponCustomerTo');
    expect(manage).toContain('removeCouponCustomerFrom');
    // The list is edited by phone number, so the number has to be validated as
    // one and resolved through the uniqueness lock rather than queried for.
    expect(manage).toContain('requirePhone');
    expect(manage).toContain('paths.phoneLock');
  });

  it('audits every grant and every removal', () => {
    const manage = readFileSync('functions/src/coupons/manage.ts', 'utf8');
    expect(manage).toContain('AuditAction.COUPON_CUSTOMER_ADDED');
    expect(manage).toContain('AuditAction.COUPON_CUSTOMER_REMOVED');
  });

  it('identifies a customer by phone and short name, never by legal name', () => {
    const manage = readFileSync('functions/src/coupons/manage.ts', 'utf8');
    // `displayName` is the function that turns "Aysel Məmmədova" into
    // "Aysel M." — the same one the public reviews use.
    expect(manage).toContain('displayName(');

    const screen = readFileSync('src/components/panel/CouponCustomers.tsx', 'utf8');
    expect(screen).toContain('formatPhone');
    // The row the screen renders carries a phone and a short name and has no
    // field a full legal name could arrive in, so there is nothing to leak.
    expect(screen).toContain('row.name');
    expect(screen).toContain('row.phone');
    expect(screen).not.toContain('row.fullName');
  });
});
