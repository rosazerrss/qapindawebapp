import { describe, expect, it } from 'vitest';

import { CouponFunding, LedgerEntryType, OrderStatus } from '../shared/enums';
import {
  OrderCommissionState,
  SettlementDirection,
  calculateCommission,
  orderCommission,
  settlementAmountToShow,
  settlementDirection,
  settlementNetDue,
  summariseLedger,
  type LedgerRowInput,
} from '../shared/pricing';
import {
  commissionIdempotencyKey,
  couponRedemptionId,
  normaliseCouponCode,
  normaliseEmailKey,
  normalisePhoneKey,
  periodOf,
  platformDiscountIdempotencyKey,
  settlementId,
} from '../shared/collections';

const RATE = 1200; // 12.00%

describe('commission on a plain order', () => {
  it('is the rate applied to the food subtotal', () => {
    const result = calculateCommission({
      subtotal: 5000,
      restaurantFunded: 0,
      platformFunded: 0,
      commissionRateBps: RATE,
    });
    expect(result.base).toBe(5000);
    expect(result.amount).toBe(600);
    expect(result.netDue).toBe(600);
  });

  it('never touches the delivery fee', () => {
    // calculateCommission is only ever handed the subtotal — this test exists to
    // pin that contract down, because charging on delivery would quietly take a
    // cut of the restaurant's driving costs.
    const withoutDelivery = calculateCommission({
      subtotal: 5000,
      restaurantFunded: 0,
      platformFunded: 0,
      commissionRateBps: RATE,
    });
    const asIfDeliveryWereIncluded = calculateCommission({
      subtotal: 5300,
      restaurantFunded: 0,
      platformFunded: 0,
      commissionRateBps: RATE,
    });
    expect(withoutDelivery.amount).toBe(600);
    expect(asIfDeliveryWereIncluded.amount).toBe(636);
  });

  it('rounds to the nearest qəpik rather than drifting in floats', () => {
    const result = calculateCommission({
      subtotal: 1533,
      restaurantFunded: 0,
      platformFunded: 0,
      commissionRateBps: 1250,
    });
    expect(result.amount).toBe(192); // 191.625 → 192
    expect(Number.isInteger(result.amount)).toBe(true);
  });

  it('is zero at a zero rate', () => {
    expect(
      calculateCommission({ subtotal: 5000, restaurantFunded: 0, platformFunded: 0, commissionRateBps: 0 })
        .amount,
    ).toBe(0);
  });
});

describe('who paid for the discount changes who pays commission', () => {
  it('shrinks the base when the restaurant funded the discount', () => {
    // The restaurant genuinely sold for 40, so it owes commission on 40.
    const result = calculateCommission({
      subtotal: 5000,
      restaurantFunded: 1000,
      platformFunded: 0,
      commissionRateBps: RATE,
    });
    expect(result.base).toBe(4000);
    expect(result.amount).toBe(480);
    expect(result.platformFundedDiscount).toBe(0);
    expect(result.netDue).toBe(480);
  });

  it('keeps the base whole when the platform funded it, and owes the discount back', () => {
    // The customer paid 40, the platform put in 10, the restaurant received 50.
    const result = calculateCommission({
      subtotal: 5000,
      restaurantFunded: 0,
      platformFunded: 1000,
      commissionRateBps: RATE,
    });
    expect(result.base).toBe(5000);
    expect(result.amount).toBe(600);
    expect(result.platformFundedDiscount).toBe(1000);
    // The platform's invoice is 6.00 commission minus the 10.00 it fronted.
    expect(result.netDue).toBe(-400);
  });

  it('lets netDue go negative — the platform can owe the restaurant', () => {
    const result = calculateCommission({
      subtotal: 2000,
      restaurantFunded: 0,
      platformFunded: 1500,
      commissionRateBps: RATE,
    });
    expect(result.netDue).toBeLessThan(0);
  });

  it('treats the two fundings identically only when there is no discount', () => {
    const platform = calculateCommission({
      subtotal: 5000,
      restaurantFunded: 0,
      platformFunded: 0,
      commissionRateBps: RATE,
    });
    const restaurant = calculateCommission({
      subtotal: 5000,
      restaurantFunded: 0,
      platformFunded: 0,
      commissionRateBps: RATE,
    });
    expect(platform).toEqual(restaurant);
  });

  it('never produces a negative base, however large the discount', () => {
    const result = calculateCommission({
      subtotal: 1000,
      restaurantFunded: 9999,
      platformFunded: 0,
      commissionRateBps: RATE,
    });
    expect(result.base).toBe(0);
    expect(result.amount).toBe(0);
  });
});

describe('a month of orders adds up', () => {
  it('sums the same whether totalled per order or in one go', () => {
    const orders = [
      { subtotal: 2500, restaurantFunded: 0, platformFunded: 0 },
      { subtotal: 4000, restaurantFunded: 400, platformFunded: 0 },
      { subtotal: 3300, restaurantFunded: 0, platformFunded: 500 },
      { subtotal: 1750, restaurantFunded: 0, platformFunded: 0 },
    ] as const;

    const results = orders.map((order) =>
      calculateCommission({ ...order, commissionRateBps: RATE }),
    );

    const commission = results.reduce((sum, result) => sum + result.amount, 0);
    const credited = results.reduce((sum, result) => sum + result.platformFundedDiscount, 0);
    const netDue = results.reduce((sum, result) => sum + result.netDue, 0);

    expect(commission).toBe(300 + 432 + 396 + 210);
    expect(credited).toBe(500);
    expect(netDue).toBe(commission - credited);
    expect(Number.isInteger(netDue)).toBe(true);
  });
});

describe('ids that make a retry harmless', () => {
  it('gives one commission key per order, and never collides across orders', () => {
    expect(commissionIdempotencyKey('o1')).toBe(commissionIdempotencyKey('o1'));
    expect(commissionIdempotencyKey('o1')).not.toBe(commissionIdempotencyKey('o2'));
    expect(commissionIdempotencyKey('o1')).not.toBe(platformDiscountIdempotencyKey('o1'));
  });

  it('gives one redemption document per coupon, customer and order', () => {
    expect(couponRedemptionId('ilk10', 'u1', 'o1')).toBe('ILK10_u1_o1');
    expect(couponRedemptionId('ILK10', 'u1', 'o1')).toBe(couponRedemptionId('ilk10', 'u1', 'o1'));
    expect(couponRedemptionId('ILK10', 'u1', 'o1')).not.toBe(couponRedemptionId('ILK10', 'u1', 'o2'));
  });

  it('gives one settlement per restaurant per month', () => {
    expect(settlementId('r1', '2026-08')).toBe('r1_2026-08');
    expect(settlementId('r1', '2026-08')).not.toBe(settlementId('r1', '2026-09'));
  });
});

describe('identity keys close the duplicate-account loopholes', () => {
  it('reduces a phone number to its digits, however it was typed', () => {
    const forms = ['+994501234567', '+994 50 123 45 67', '994-50-123-45-67'];
    const keys = forms.map(normalisePhoneKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('994501234567');
  });

  it('treats case, dots and +tags on Gmail as one inbox', () => {
    const forms = [
      'Ali.Mammadov@Gmail.com',
      'alimammadov@gmail.com',
      'ali.mammadov+qapinda@gmail.com',
      'ALIMAMMADOV@GOOGLEMAIL.COM',
    ];
    const keys = forms.map(normaliseEmailKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('alimammadov@gmail.com');
  });

  it('strips +tags but keeps dots on other providers, where dots matter', () => {
    expect(normaliseEmailKey('ali.mammadov+x@mail.ru')).toBe('ali.mammadov@mail.ru');
    expect(normaliseEmailKey('ali.mammadov@mail.ru')).not.toBe(normaliseEmailKey('alimammadov@mail.ru'));
  });

  it('keeps two genuinely different people apart', () => {
    expect(normaliseEmailKey('ali@gmail.com')).not.toBe(normaliseEmailKey('vali@gmail.com'));
    expect(normalisePhoneKey('+994501234567')).not.toBe(normalisePhoneKey('+994501234568'));
  });

  it('produces an id Firestore will accept — no slashes', () => {
    expect(normaliseEmailKey('we/ird@example.com')).not.toContain('/');
    expect(normaliseCouponCode('ilk/10 %')).toBe('ILK10');
  });
});

describe('the settlement period', () => {
  it('uses Baku time, not UTC', () => {
    // 22:30 UTC on 31 August is already 02:30 on 1 September in Baku.
    expect(periodOf(new Date('2026-08-31T22:30:00Z'))).toBe('2026-09');
    expect(periodOf(new Date('2026-08-31T18:30:00Z'))).toBe('2026-08');
  });

  it('pads the month', () => {
    expect(periodOf(new Date('2026-01-15T09:00:00Z'))).toBe('2026-01');
  });
});


describe('commission when both sides funded the discount', () => {
  it('drops the base by the restaurant half and credits back the platform half', () => {
    // 50.00 ₼ of food, 10.00 ₼ off, split 6/4 between restaurant and platform.
    const result = calculateCommission({
      subtotal: 5000,
      restaurantFunded: 600,
      platformFunded: 400,
      commissionRateBps: RATE,
    });

    // The restaurant sold for 44.00 ₼, so that is what it pays commission on.
    expect(result.base).toBe(4400);
    expect(result.amount).toBe(528);
    // And Qapında hands its own 4.00 ₼ share back.
    expect(result.platformFundedDiscount).toBe(400);
    expect(result.netDue).toBe(128);
  });

  it('matches the old single-funder behaviour exactly', () => {
    const restaurantOnly = calculateCommission({
      subtotal: 5000,
      restaurantFunded: 1000,
      platformFunded: 0,
      commissionRateBps: RATE,
    });
    expect(restaurantOnly.base).toBe(4000);
    expect(restaurantOnly.netDue).toBe(480);

    const platformOnly = calculateCommission({
      subtotal: 5000,
      restaurantFunded: 0,
      platformFunded: 1000,
      commissionRateBps: RATE,
    });
    expect(platformOnly.base).toBe(5000);
    expect(platformOnly.netDue).toBe(600 - 1000);
  });
});

/**
 * The scenarios the owner asked for, said in money rather than in basis points.
 *
 * Every one of these is a sentence somebody would use on the phone — "a hundred
 * manat order at ten per cent", "we cancelled it before it went out", "we
 * renegotiated the rate last week" — and each is a place where getting the
 * arithmetic wrong costs a real restaurant real money.
 */
describe('one order, end to end, in manats', () => {
  /** 100 ₼ of food, no delivery fee, no discount. */
  const HUNDRED_MANAT = 10_000;

  it('100 ₼ at 10% delivered is 10 ₼ to the platform and 90 ₼ to the restaurant', () => {
    const order = {
      status: OrderStatus.DELIVERED,
      pricing: { subtotal: HUNDRED_MANAT },
      commissionRateBps: 1000,
      commissionAmount: null,
    };

    const view = orderCommission(order);

    expect(view.state).toBe(OrderCommissionState.EXPECTED);
    expect(view.amount).toBe(1_000); // 10.00 ₼
    expect(view.netDue).toBe(1_000);
    expect(HUNDRED_MANAT - view.netDue).toBe(9_000); // 90.00 ₼ stays with the kitchen
  });

  it('the same order, once completed, reports the figure that was actually billed', () => {
    const view = orderCommission({
      status: OrderStatus.COMPLETED,
      pricing: { subtotal: HUNDRED_MANAT },
      commissionRateBps: 1000,
      commissionAmount: 1_000,
      platformFundedDiscount: 0,
    });

    expect(view.state).toBe(OrderCommissionState.CHARGED);
    expect(view.amount).toBe(1_000);
  });

  it('cancelled before delivery is zero commission, not a smaller one', () => {
    for (const status of [
      OrderStatus.CANCELLED,
      OrderStatus.REJECTED,
      OrderStatus.EXPIRED,
      OrderStatus.DELIVERY_FAILED,
      OrderStatus.PAYMENT_FAILED,
    ]) {
      const view = orderCommission({
        status,
        pricing: { subtotal: HUNDRED_MANAT },
        commissionRateBps: 1000,
        commissionAmount: null,
      });

      expect(view.state, `${status} should carry no commission`).toBe(OrderCommissionState.NONE);
      expect(view.amount, `${status} should be free`).toBe(0);
    }
  });

  it('an order still in the kitchen has no commission yet either', () => {
    // It may still be cancelled. A figure on screen before the food has left
    // the building is a bill for a meal nobody has eaten.
    for (const status of [OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.PREPARING]) {
      expect(
        orderCommission({
          status,
          pricing: { subtotal: HUNDRED_MANAT },
          commissionRateBps: 1000,
          commissionAmount: null,
        }).amount,
      ).toBe(0);
    }
  });

  it('a commission waived after an upheld complaint is zero', () => {
    const view = orderCommission({
      status: OrderStatus.DELIVERED,
      pricing: { subtotal: HUNDRED_MANAT },
      commissionRateBps: 1000,
      commissionAmount: null,
      commissionWaived: true,
    });

    expect(view.state).toBe(OrderCommissionState.NONE);
    expect(view.amount).toBe(0);
  });

  it('changing the rate today does not move what an old order was billed', () => {
    // The rate lives on the order, frozen at checkout. `setCommissionRate`
    // writes the restaurant's document and nothing else, which is exactly why
    // this reads the order's own snapshot and never the restaurant's.
    const placedAtTenPercent = {
      status: OrderStatus.COMPLETED,
      pricing: { subtotal: HUNDRED_MANAT },
      commissionRateBps: 1000,
      commissionAmount: 1_000,
      platformFundedDiscount: 0,
    };

    // The platform now charges 20%. The order does not care.
    expect(orderCommission(placedAtTenPercent).amount).toBe(1_000);
    expect(orderCommission(placedAtTenPercent).rateBps).toBe(1000);

    // And a delivered-but-unbilled order still uses ITS OWN frozen rate.
    expect(
      orderCommission({ ...placedAtTenPercent, status: OrderStatus.DELIVERED, commissionAmount: null })
        .amount,
    ).toBe(1_000);
  });

  it('a platform-funded discount leaves the base whole and is owed back', () => {
    const view = orderCommission({
      status: OrderStatus.DELIVERED,
      pricing: { subtotal: HUNDRED_MANAT },
      commissionRateBps: 1000,
      commissionAmount: null,
      coupon: {
        fundedBy: CouponFunding.PLATFORM,
        discountAmount: 1_000,
        restaurantFunding: 0,
        platformFunding: 1_000,
      },
    });

    // Commission on the full 100 ₼ — the restaurant was made whole — and the
    // 10 ₼ Qapında funded comes straight back off what it owes.
    expect(view.amount).toBe(1_000);
    expect(view.platformFundedDiscount).toBe(1_000);
    expect(view.netDue).toBe(0);
  });

  it('a restaurant-funded discount shrinks the base it is charged on', () => {
    const view = orderCommission({
      status: OrderStatus.DELIVERED,
      pricing: { subtotal: HUNDRED_MANAT },
      commissionRateBps: 1000,
      commissionAmount: null,
      coupon: {
        fundedBy: CouponFunding.RESTAURANT,
        discountAmount: 2_000,
        restaurantFunding: 2_000,
        platformFunding: 0,
      },
    });

    expect(view.base).toBe(8_000); // it sold for 80 ₼
    expect(view.amount).toBe(800); // and pays 8 ₼
  });
});

/**
 * The three payment methods, each reaching the ledger it should.
 *
 * Written against `summariseLedger` rather than against the jobs that post the
 * entries, because the sign convention is the thing that goes wrong: an entry
 * with the right value and the wrong sign is a month's invoice pointing the
 * wrong way, and nothing else in the system would notice.
 */
describe('each payment method reaches the right ledger', () => {
  const COMMISSION = 1_000; // 10 ₼ on a 100 ₼ order
  const ORDER_TOTAL = 10_000;

  /** What `settleDeliveredOrders` writes for an order paid at the door. */
  const atTheDoor: LedgerRowInput[] = [
    {
      type: LedgerEntryType.COMMISSION,
      amount: COMMISSION,
      orderId: 'order-1',
      orderTotal: ORDER_TOTAL,
    },
  ];

  /** The same order, paid online: the platform is holding the money. */
  const online: LedgerRowInput[] = [
    ...atTheDoor,
    {
      type: LedgerEntryType.ONLINE_COLLECTED,
      amount: -ORDER_TOTAL,
      orderId: 'order-1',
      orderTotal: null,
    },
  ];

  it('cash at the door: the restaurant has been paid and owes the commission', () => {
    const summary = summariseLedger(atTheDoor);

    expect(summary.orderCount).toBe(1);
    expect(summary.grossSales).toBe(ORDER_TOTAL);
    expect(summary.commission).toBe(COMMISSION);
    expect(summary.onlineCollected).toBe(0);
    expect(settlementNetDue(summary)).toBe(COMMISSION);
    expect(settlementDirection(settlementNetDue(summary))).toBe(
      SettlementDirection.RESTAURANT_PAYS,
    );
  });

  it('card at the door settles exactly as cash does — the money never came here', () => {
    // There is no ONLINE_COLLECTED entry for a card tapped on the courier's
    // terminal, and that is the whole difference between the two.
    expect(summariseLedger(atTheDoor)).toEqual(summariseLedger(atTheDoor));
    expect(settlementNetDue(summariseLedger(atTheDoor))).toBe(COMMISSION);
  });

  it('online: the platform holds the takings and owes them back, less commission', () => {
    const summary = summariseLedger(online);

    expect(summary.commission).toBe(COMMISSION);
    expect(summary.onlineCollected).toBe(ORDER_TOTAL);

    const netDue = settlementNetDue(summary);
    expect(netDue).toBe(COMMISSION - ORDER_TOTAL); // −90 ₼
    expect(settlementDirection(netDue)).toBe(SettlementDirection.PLATFORM_PAYS);
    expect(settlementAmountToShow(netDue)).toBe(9_000); // 90 ₼ owed to the kitchen
  });

  it('a refund reverses the online takings and leaves the history intact', () => {
    /*
     * `postOnlineRefundEntry` writes a POSITIVE ONLINE_COLLECTED entry: the
     * money went back to the customer, so the platform is no longer holding it.
     * The original entry is never edited — the bank statement and the ledger
     * have to be readable against each other line by line — so the month shows
     * both movements and nets to nothing.
     */
    const refunded: LedgerRowInput[] = [
      ...online,
      {
        type: LedgerEntryType.ONLINE_COLLECTED,
        amount: ORDER_TOTAL,
        orderId: 'order-1',
        orderTotal: null,
      },
    ];

    const summary = summariseLedger(refunded);

    expect(summary.onlineCollected).toBe(0);
    // The commission is a separate question, answered by the complaint flow or
    // by an adjustment — a refund on its own does not silently un-bill it.
    expect(summary.commission).toBe(COMMISSION);
    expect(settlementNetDue(summary)).toBe(COMMISSION);
    // One order, however many entries it produced.
    expect(summary.orderCount).toBe(1);
  });

  it('a full refund plus a commission reversal leaves the month at nothing', () => {
    const reversed: LedgerRowInput[] = [
      ...online,
      { type: LedgerEntryType.ONLINE_COLLECTED, amount: ORDER_TOTAL, orderId: 'order-1' },
      // An operator's adjustment is what un-bills the commission, and it is
      // signed the other way: negative reduces what the restaurant owes.
      { type: LedgerEntryType.ADJUSTMENT, amount: -COMMISSION, orderId: 'order-1' },
    ];

    expect(settlementNetDue(summariseLedger(reversed))).toBe(0);
    expect(settlementDirection(0)).toBe(SettlementDirection.SETTLED);
  });

  it('a platform-funded discount is a credit, never a second commission', () => {
    const summary = summariseLedger([
      ...atTheDoor,
      { type: LedgerEntryType.PLATFORM_DISCOUNT, amount: -1_000, orderId: 'order-1' },
    ]);

    expect(summary.platformFundedDiscount).toBe(1_000);
    expect(summary.commission).toBe(COMMISSION);
    expect(settlementNetDue(summary)).toBe(0);
  });
});
