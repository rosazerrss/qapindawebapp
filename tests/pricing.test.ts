import { describe, expect, it } from 'vitest';

import { ModifierSelection, ProductAvailability } from '../shared/enums';
import type { Product, Restaurant } from '../shared/models';
import {
  buildOrderItem,
  calculateTotals,
  deliveryFeeFor,
  formatBps,
  formatMinorUnits,
  formatMoney,
  parseMajorUnits,
  subtotalOf,
} from '../shared/pricing';

// A döner with one required size group and one free-for-all extras group.
const doner: Product = {
  id: 'p1',
  restaurantId: 'r1',
  categoryId: 'c1',
  name: 'Toyuq döner',
  description: '',
  price: 550, // 5.50 ₼
  imageUrl: null,
  availability: ProductAvailability.AVAILABLE,
  popular: true,
  sortOrder: 0,
  compareAtPrice: null,
  searchTokens: [],
  modifierGroups: [
    {
      id: 'g-size',
      name: 'Ölçü',
      selection: ModifierSelection.SINGLE,
      required: true,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: 'o-normal', name: 'Normal', priceDelta: 0, available: true },
        { id: 'o-large', name: 'Böyük', priceDelta: 150, available: true },
        { id: 'o-jumbo', name: 'Jumbo', priceDelta: 300, available: false },
      ],
    },
    {
      id: 'g-extra',
      name: 'Əlavələr',
      selection: ModifierSelection.MULTIPLE,
      required: false,
      minSelect: 0,
      maxSelect: 2,
      options: [
        { id: 'o-cheese', name: 'Pendir', priceDelta: 100, available: true },
        { id: 'o-sauce', name: 'Sous', priceDelta: 50, available: true },
        { id: 'o-fries', name: 'Kartof', priceDelta: 200, available: true },
      ],
    },
  ],
  createdAt: null as never,
  updatedAt: null as never,
};

const restaurant: Pick<
  Restaurant,
  'deliveryFee' | 'freeDeliveryThreshold' | 'minOrderAmount'
> = {
  deliveryFee: 300,
  freeDeliveryThreshold: 2500,
  minOrderAmount: 1000,
};

describe('building a line', () => {
  it('adds every chosen modifier into the unit price, then multiplies', () => {
    const result = buildOrderItem(
      { productId: 'p1', quantity: 2, selectedOptionIds: ['o-large', 'o-cheese'] },
      doner,
    );

    expect(result.ok).toBe(true);
    // (550 + 150 + 100) × 2
    expect(result.item?.lineTotal).toBe(1600);
    // The base price is frozen separately from the modifiers.
    expect(result.item?.unitPrice).toBe(550);
    expect(result.item?.modifiers).toHaveLength(2);
  });

  it('freezes the modifier names, not just their ids', () => {
    const result = buildOrderItem(
      { productId: 'p1', quantity: 1, selectedOptionIds: ['o-normal'] },
      doner,
    );
    // Renaming "Normal" tomorrow must not rewrite yesterday's receipt.
    expect(result.item?.modifiers[0]).toMatchObject({
      groupName: 'Ölçü',
      optionName: 'Normal',
      priceDelta: 0,
    });
  });

  it('rejects a missing product', () => {
    expect(buildOrderItem({ productId: 'x', quantity: 1, selectedOptionIds: [] }, undefined)).toMatchObject(
      { ok: false, error: 'product-not-found' },
    );
  });

  it('rejects a hidden or sold-out product', () => {
    for (const availability of [
      ProductAvailability.OUT_OF_STOCK_TODAY,
      ProductAvailability.HIDDEN,
    ]) {
      const result = buildOrderItem(
        { productId: 'p1', quantity: 1, selectedOptionIds: ['o-normal'] },
        { ...doner, availability },
      );
      expect(result).toMatchObject({ ok: false, error: 'product-unavailable' });
    }
  });

  it('rejects nonsense quantities', () => {
    for (const quantity of [0, -1, 1.5, 31, Number.NaN]) {
      const result = buildOrderItem({ productId: 'p1', quantity, selectedOptionIds: ['o-normal'] }, doner);
      expect(result, `quantity ${quantity}`).toMatchObject({ ok: false, error: 'invalid-quantity' });
    }
  });

  it('insists on a required group', () => {
    expect(
      buildOrderItem({ productId: 'p1', quantity: 1, selectedOptionIds: ['o-cheese'] }, doner),
    ).toMatchObject({ ok: false, error: 'modifier-required', detail: 'Ölçü' });
  });

  it('enforces the maximum number of extras', () => {
    expect(
      buildOrderItem(
        { productId: 'p1', quantity: 1, selectedOptionIds: ['o-normal', 'o-cheese', 'o-sauce', 'o-fries'] },
        doner,
      ),
    ).toMatchObject({ ok: false, error: 'modifier-too-many', detail: 'Əlavələr' });
  });

  it('refuses an option the restaurant turned off', () => {
    expect(
      buildOrderItem({ productId: 'p1', quantity: 1, selectedOptionIds: ['o-jumbo'] }, doner),
    ).toMatchObject({ ok: false, error: 'modifier-unavailable', detail: 'Jumbo' });
  });

  it('refuses an option id that belongs to no group — a stale or forged cart', () => {
    expect(
      buildOrderItem(
        { productId: 'p1', quantity: 1, selectedOptionIds: ['o-normal', 'o-free-caviar'] },
        doner,
      ),
    ).toMatchObject({ ok: false, error: 'modifier-unknown' });
  });

  it('ignores the price the browser thinks the product costs', () => {
    // The cart was opened when the döner was 4.00; it is 5.50 now.
    const result = buildOrderItem(
      { productId: 'p1', quantity: 1, selectedOptionIds: ['o-normal'] },
      doner,
    );
    expect(result.item?.lineTotal).toBe(550);
  });

  it('trims and caps a customer note', () => {
    const result = buildOrderItem(
      { productId: 'p1', quantity: 1, selectedOptionIds: ['o-normal'], note: `  ${'a'.repeat(400)}  ` },
      doner,
    );
    expect(result.item?.note).toHaveLength(200);

    const blank = buildOrderItem(
      { productId: 'p1', quantity: 1, selectedOptionIds: ['o-normal'], note: '   ' },
      doner,
    );
    expect(blank.item?.note).toBeNull();
  });
});

describe('the delivery fee', () => {
  it('is charged below the free-delivery threshold', () => {
    expect(deliveryFeeFor(restaurant, 2499)).toBe(300);
  });

  it('is waived at exactly the threshold and above', () => {
    expect(deliveryFeeFor(restaurant, 2500)).toBe(0);
    expect(deliveryFeeFor(restaurant, 9999)).toBe(0);
  });

  it('is always charged when the restaurant sets no threshold', () => {
    expect(deliveryFeeFor({ deliveryFee: 300, freeDeliveryThreshold: null, minOrderAmount: 0, deliveryZones: null }, 100000)).toBe(300);
  });
});

describe('order totals', () => {
  const items = [
    buildOrderItem({ productId: 'p1', quantity: 2, selectedOptionIds: ['o-large'] }, doner).item!,
  ];

  it('adds the delivery fee and subtracts the discount', () => {
    const totals = calculateTotals({ items, restaurant, couponDiscount: 200 });
    expect(totals.subtotal).toBe(1400); // (550 + 150) × 2
    expect(totals.deliveryFee).toBe(300);
    expect(totals.discount).toBe(200);
    expect(totals.total).toBe(1500);
    expect(totals.currency).toBe('AZN');
  });

  it('never lets a discount push the total below zero', () => {
    const totals = calculateTotals({ items, restaurant, couponDiscount: 999999 });
    expect(totals.total).toBe(0);
    expect(totals.discount).toBe(1700); // capped at subtotal + delivery
  });

  it('ignores a negative discount', () => {
    expect(calculateTotals({ items, restaurant, couponDiscount: -500 }).discount).toBe(0);
  });

  it('keeps the three discount sources apart while still summing them', () => {
    const totals = calculateTotals({
      items,
      restaurant,
      couponDiscount: 200,
      restaurantDiscount: 100,
      platformDiscount: 50,
    });

    expect(totals.couponDiscount).toBe(200);
    expect(totals.restaurantDiscount).toBe(100);
    expect(totals.platformDiscount).toBe(50);
    expect(totals.discount).toBe(350);
    expect(totals.total).toBe(1350); // 1400 + 300 − 350
  });

  it('caps the three together, not just each on its own', () => {
    // Each is individually plausible; together they exceed the order.
    const totals = calculateTotals({
      items,
      restaurant,
      couponDiscount: 1000,
      restaurantDiscount: 1000,
      platformDiscount: 1000,
    });

    expect(totals.discount).toBe(1700); // subtotal + delivery
    expect(totals.total).toBe(0);
  });

  it('measures the minimum against the food, not the delivery fee', () => {
    const small = [
      buildOrderItem({ productId: 'p1', quantity: 1, selectedOptionIds: ['o-normal'] }, doner).item!,
    ];
    // 5.50 of food + 3.00 delivery is over 10.00, but the food alone is not.
    expect(calculateTotals({ items: small, restaurant }).belowMinimum).toBe(true);
    expect(calculateTotals({ items, restaurant }).belowMinimum).toBe(false);
  });

  it('sums an empty cart to zero rather than throwing', () => {
    expect(subtotalOf([])).toBe(0);
  });
});

describe('money formatting', () => {
  it('renders minor units with two decimals', () => {
    expect(formatMinorUnits(1250)).toBe('12.50');
    expect(formatMinorUnits(5)).toBe('0.05');
    expect(formatMinorUnits(0)).toBe('0.00');
    expect(formatMinorUnits(-350)).toBe('-3.50');
    expect(formatMoney(1250)).toBe('12.50 ₼');
  });

  it('parses what a restaurant types, in either separator', () => {
    expect(parseMajorUnits('12')).toBe(1200);
    expect(parseMajorUnits('12.5')).toBe(1250);
    expect(parseMajorUnits('12,50')).toBe(1250);
    expect(parseMajorUnits(' 0.05 ')).toBe(5);
  });

  it('refuses anything that is not a clean amount', () => {
    for (const bad of ['', 'abc', '12.345', '-5', '1.2.3', '12 ₼']) {
      expect(() => parseMajorUnits(bad), bad).toThrow();
    }
  });

  it('round-trips a parsed amount back to the same string', () => {
    for (const value of ['0.01', '7.00', '19.99', '250.00']) {
      expect(formatMinorUnits(parseMajorUnits(value))).toBe(value);
    }
  });

  it('renders basis points as a percentage', () => {
    expect(formatBps(1200)).toBe('12%');
    expect(formatBps(1250)).toBe('12.50%');
    expect(formatBps(0)).toBe('0%');
  });
});
