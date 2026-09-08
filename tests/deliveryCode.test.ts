/**
 * Does this delivery close with a code?
 *
 * WHOSE DECISION, AND WHAT HAPPENS WHEN NOBODY CAN ANSWER
 * -------------------------------------------------------
 * The restaurant's, with a platform override that is off by default.
 *
 * The asymmetry that matters is not "code or no code" — it is that three
 * places have to give the SAME answer: the customer's screen decides whether
 * to offer "kodu göstər", the courier's screen decides whether to show a code
 * box, and `courierConfirmDelivery` decides whether to accept the delivery.
 * Disagreement between them puts a driver at a door asking for six digits the
 * customer was never shown, holding food, unable to close the order.
 *
 * So every unreadable or missing input resolves DOWNWARDS, to the restaurant's
 * own flag and then to "no code" — because "no code" is a delivery that
 * completes and can be argued about afterwards, while "code required, none
 * issued" is a delivery that cannot complete at all.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  DELIVERY_CODE_POLICY,
  deliveryCodePolicyOf,
  deliveryCodeRequired,
  restaurantMayDisableCodes,
} from '../shared/deliveryCode';

describe('reading the platform policy', () => {
  it('leaves the decision to the restaurant when the field was never written', () => {
    // Every settings document on this platform right now.
    expect(deliveryCodePolicyOf({})).toBe(DELIVERY_CODE_POLICY.RESTAURANT_CHOICE);
  });

  it('leaves it to the restaurant for null, empty and anything unrecognised', () => {
    // Strict in this direction on purpose: an override that switched itself on
    // because a field was misspelled would silently disable every restaurant's
    // own switch, with nothing on any screen to explain why.
    for (const value of [null, '', 'yes', 'SOMETIMES', 'always', 'ALWAYS_ON']) {
      expect(deliveryCodePolicyOf({ deliveryCodePolicy: value })).toBe(
        DELIVERY_CODE_POLICY.RESTAURANT_CHOICE,
      );
    }
  });

  it('honours the one value that turns the override on', () => {
    expect(deliveryCodePolicyOf({ deliveryCodePolicy: 'ALWAYS' })).toBe(
      DELIVERY_CODE_POLICY.ALWAYS,
    );
  });
});

describe('resolving the platform against the restaurant', () => {
  const always = { deliveryCodePolicy: DELIVERY_CODE_POLICY.ALWAYS };
  const choice = { deliveryCodePolicy: DELIVERY_CODE_POLICY.RESTAURANT_CHOICE };

  it('requires a code under ALWAYS whatever the restaurant says', () => {
    expect(
      deliveryCodeRequired({ settings: always, restaurant: { requireDeliveryCode: false } }),
    ).toBe(true);
  });

  it('requires a code under the override even when the restaurant cannot be read', () => {
    expect(deliveryCodeRequired({ settings: always, restaurant: null })).toBe(true);
  });

  it('falls back to the restaurant when the settings cannot be read', () => {
    /*
     * NOT "require a code". The customer's screen offers "kodu göstər" from
     * this same answer, so a settings read that failed must not leave a driver
     * at a door asking for digits the customer was never shown.
     */
    expect(deliveryCodeRequired({ settings: null, restaurant: null })).toBe(false);
    expect(deliveryCodeRequired({ settings: undefined, restaurant: undefined })).toBe(false);
    expect(
      deliveryCodeRequired({ settings: null, restaurant: { requireDeliveryCode: true } }),
    ).toBe(true);
  });

  it('lets the restaurant decide under RESTAURANT_CHOICE', () => {
    expect(
      deliveryCodeRequired({ settings: choice, restaurant: { requireDeliveryCode: true } }),
    ).toBe(true);
    expect(
      deliveryCodeRequired({ settings: choice, restaurant: { requireDeliveryCode: false } }),
    ).toBe(false);
  });

  it('reads an unreadable restaurant as "no" only under RESTAURANT_CHOICE', () => {
    // The alternative is a driver stuck at a door unable to close an order for
    // a restaurant that never wanted codes.
    expect(deliveryCodeRequired({ settings: choice, restaurant: null })).toBe(false);
  });
});

describe('who may switch it off', () => {
  it('the restaurant, by default', () => {
    expect(restaurantMayDisableCodes({})).toBe(true);
    expect(restaurantMayDisableCodes({ deliveryCodePolicy: 'RESTAURANT_CHOICE' })).toBe(true);
  });

  it('nobody, while the platform override is on', () => {
    expect(restaurantMayDisableCodes({ deliveryCodePolicy: 'ALWAYS' })).toBe(false);
  });
});

describe('a new restaurant starts with codes on', () => {
  const onboarding = fs.readFileSync('functions/src/restaurants/onboarding.ts', 'utf8');

  it('on both creation paths — the application and the admin’s own form', () => {
    // Two call sites. One alone would mean restaurants created by an admin
    // behaved differently from ones that applied, which is the kind of
    // difference nobody finds until a dispute.
    expect(onboarding.match(/requireDeliveryCode: true/g)?.length ?? 0).toBe(2);
  });
});

describe('the customer is shown the code by the same rule', () => {
  const orderPage = fs.readFileSync('src/app/orders/[orderId]/page.tsx', 'utf8');

  it('gates the code panel on the resolved answer, not on the bare flag', () => {
    // Checking `restaurant.requireDeliveryCode` here while the server checked
    // something else is exactly how a driver ends up at a door asking for six
    // digits this screen never offered.
    expect(orderPage).toContain('deliveryCodeRequired({ settings, restaurant })');
  });
});

describe('the server consults the shared rule rather than the flag', () => {
  const delivery = fs.readFileSync('functions/src/orders/delivery.ts', 'utf8');
  const onboarding = fs.readFileSync('functions/src/restaurants/onboarding.ts', 'utf8');

  it('closes a delivery on the resolved answer', () => {
    expect(delivery).toContain('deliveryCodeRequired');
    // The bare flag must no longer be the thing that decides.
    expect(delivery).not.toMatch(/requireDeliveryCode\s*\)/);
  });

  it('issues a customer code on the same resolved answer', () => {
    // Two call sites: `issueDeliveryCode` and `courierConfirmDelivery`. One
    // alone would mean a customer with no code and a courier demanding one.
    expect(delivery.match(/deliveryCodeRequired\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('ignores a restaurant trying to lower it while the platform requires it', () => {
    expect(onboarding).toContain('restaurantMayDisableCodes');
  });
});
