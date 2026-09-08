import { describe, expect, it } from 'vitest';

import { LedgerEntryType } from '../shared/enums';
import {
  SettlementDirection,
  calculateCommission,
  settlementDirection,
  settlementNetDue,
  summariseLedger,
  type LedgerRowInput,
} from '../shared/pricing';
import {
  formatIban,
  isAzerbaijaniIban,
  isValidIban,
  looksLikeCardNumber,
  normaliseIban,
} from '../shared/bank';
import {
  onlineCollectedIdempotencyKey,
  onlineRefundIdempotencyKey,
  normaliseReferenceKey,
  settlementPaymentIdempotencyKey,
} from '../shared/collections';

/**
 * The arithmetic that decides who owes whom.
 *
 * This is the one calculation in Qapında that cannot be checked by eye: the
 * same restaurant can owe money one month and be owed money the next, and the
 * difference is a sign buried in a sum of five figures. So every scenario the
 * business actually has is written down here — cash, online, mixed, refunded,
 * settled — with the ledger entries the server really writes.
 */

const RATE = 1200; // 12.00%

/** The entries `settleDeliveredOrders` posts for one cash order. */
function cashOrder(orderId: string, subtotal: number, total: number): LedgerRowInput[] {
  const commission = calculateCommission({
    subtotal,
    restaurantFunded: 0,
    platformFunded: 0,
    commissionRateBps: RATE,
  });

  return [
    {
      type: LedgerEntryType.COMMISSION,
      amount: commission.amount,
      orderId,
      orderTotal: total,
    },
  ];
}

/** The same order paid online: the platform is also holding the takings. */
function onlineOrder(orderId: string, subtotal: number, total: number): LedgerRowInput[] {
  return [
    ...cashOrder(orderId, subtotal, total),
    { type: LedgerEntryType.ONLINE_COLLECTED, amount: -total, orderId, orderTotal: null },
  ];
}

/** What `refundPayment` posts when money goes back to the customer. */
function refund(orderId: string, amount: number): LedgerRowInput {
  return { type: LedgerEntryType.ONLINE_COLLECTED, amount, orderId, orderTotal: null };
}

/** What `recordSettlementPayment` posts when the restaurant transfers to us. */
function paidByRestaurant(amount: number): LedgerRowInput {
  return { type: LedgerEntryType.PAYMENT_RECEIVED, amount: -amount, orderId: null };
}

/** …and when we transfer to the restaurant. */
function paidToRestaurant(amount: number): LedgerRowInput {
  return { type: LedgerEntryType.PAYMENT_RECEIVED, amount, orderId: null };
}

describe('a month of cash orders', () => {
  // Two 50 ₼ dinners with a 3 ₼ delivery fee. The restaurant took 106 ₼ at the
  // door, all of it theirs, and owes commission on the food alone.
  const entries = [...cashOrder('a', 5000, 5300), ...cashOrder('b', 5000, 5300)];
  const summary = summariseLedger(entries);

  it('bills commission on the food, not on the delivery fee', () => {
    expect(summary.commission).toBe(1200);
    expect(summary.grossSales).toBe(10600);
  });

  it('leaves the restaurant owing the platform', () => {
    const netDue = settlementNetDue(summary);
    expect(netDue).toBe(1200);
    expect(settlementDirection(netDue)).toBe(SettlementDirection.RESTAURANT_PAYS);
  });

  it('holds none of the customer money', () => {
    expect(summary.onlineCollected).toBe(0);
  });
});

describe('a month of online orders', () => {
  // The platform took 106 ₼ of the customers' money and the restaurant has been
  // paid nothing, so the platform owes the takings less its commission.
  const entries = [...onlineOrder('a', 5000, 5300), ...onlineOrder('b', 5000, 5300)];
  const summary = summariseLedger(entries);

  it('records the whole order total as money the platform is holding', () => {
    expect(summary.onlineCollected).toBe(10600);
    expect(summary.commission).toBe(1200);
  });

  it('leaves the platform owing the restaurant', () => {
    const netDue = settlementNetDue(summary);
    expect(netDue).toBe(1200 - 10600);
    expect(settlementDirection(netDue)).toBe(SettlementDirection.PLATFORM_PAYS);
    // What the restaurant is actually paid: its takings minus commission.
    expect(Math.abs(netDue)).toBe(9400);
  });
});

describe('a mixed month', () => {
  // Three cash orders and one online one. The commission on all four is netted
  // against the single order's takings, which is the whole point of settling
  // the two directions in one figure rather than sending two invoices.
  const entries = [
    ...cashOrder('a', 5000, 5300),
    ...cashOrder('b', 5000, 5300),
    ...cashOrder('c', 5000, 5300),
    ...onlineOrder('d', 5000, 5300),
  ];
  const summary = summariseLedger(entries);

  it('counts every order once, however many entries it wrote', () => {
    expect(summary.orderCount).toBe(4);
    expect(summary.grossSales).toBe(4 * 5300);
  });

  it('nets the online takings against the whole month of commission', () => {
    const netDue = settlementNetDue(summary);
    expect(summary.commission).toBe(2400);
    expect(summary.onlineCollected).toBe(5300);
    expect(netDue).toBe(2400 - 5300);
    expect(settlementDirection(netDue)).toBe(SettlementDirection.PLATFORM_PAYS);
  });
});

describe('a platform-funded discount', () => {
  it('is owed back to the restaurant on top of the commission', () => {
    const commission = calculateCommission({
      subtotal: 5000,
      restaurantFunded: 0,
      platformFunded: 1000,
      commissionRateBps: RATE,
    });

    const summary = summariseLedger([
      { type: LedgerEntryType.COMMISSION, amount: commission.amount, orderId: 'a', orderTotal: 4300 },
      { type: LedgerEntryType.PLATFORM_DISCOUNT, amount: -1000, orderId: 'a', orderTotal: null },
    ]);

    expect(summary.commission).toBe(600);
    expect(summary.platformFundedDiscount).toBe(1000);
    // The platform funded ten manats of a discount and earned six of
    // commission, so it ends the month four manats down.
    expect(settlementNetDue(summary)).toBe(-400);
  });
});

describe('a refunded online order', () => {
  // The customer paid 53 ₼ online and was refunded in full. The platform is no
  // longer holding that money, so it must stop counting as takings owed.
  const entries = [...onlineOrder('a', 5000, 5300), refund('a', 5300)];
  const summary = summariseLedger(entries);

  it('stops counting refunded money as held on the restaurant behalf', () => {
    expect(summary.onlineCollected).toBe(0);
  });

  it('leaves only the commission, which the restaurant still owes', () => {
    // Whether that commission should also be waived is a separate decision — an
    // upheld complaint waives it before it is ever charged. What must not
    // happen is the platform paying out takings it has already sent back.
    expect(settlementNetDue(summary)).toBe(600);
    expect(settlementDirection(settlementNetDue(summary))).toBe(
      SettlementDirection.RESTAURANT_PAYS,
    );
  });

  it('handles a partial refund by the amount actually returned', () => {
    const partial = summariseLedger([...onlineOrder('b', 5000, 5300), refund('b', 2000)]);
    expect(partial.onlineCollected).toBe(3300);
    expect(settlementNetDue(partial)).toBe(600 - 3300);
  });
});

describe('a recorded payment', () => {
  it('brings a cash month to zero when the restaurant pays', () => {
    const owed = summariseLedger(cashOrder('a', 5000, 5300));
    expect(settlementNetDue(owed)).toBe(600);

    const settled = summariseLedger([...cashOrder('a', 5000, 5300), paidByRestaurant(600)]);
    expect(settled.paymentsReceived).toBe(600);
    expect(settlementNetDue(settled)).toBe(0);
    expect(settlementDirection(settlementNetDue(settled))).toBe(SettlementDirection.SETTLED);
  });

  it('brings an online month to zero when the platform pays out', () => {
    const owed = summariseLedger(onlineOrder('a', 5000, 5300));
    expect(settlementNetDue(owed)).toBe(-4700);

    const settled = summariseLedger([...onlineOrder('a', 5000, 5300), paidToRestaurant(4700)]);
    expect(settlementNetDue(settled)).toBe(0);
    expect(settlementDirection(settlementNetDue(settled))).toBe(SettlementDirection.SETTLED);
  });

  it('leaves a part payment still owing, in the same direction', () => {
    const partial = summariseLedger([...cashOrder('a', 5000, 5300), paidByRestaurant(200)]);
    expect(settlementNetDue(partial)).toBe(400);
    expect(settlementDirection(settlementNetDue(partial))).toBe(
      SettlementDirection.RESTAURANT_PAYS,
    );
  });
});

describe('the ledger and the summary can never disagree', () => {
  it('nets to exactly the sum of every entry amount', () => {
    // The sign convention is the invariant: an amount is positive when the
    // restaurant owes the platform, so adding every entry up must give the same
    // answer as the named arithmetic. If this ever fails, one of the two is
    // decoding a sign the other way and a restaurant is being paid backwards.
    const entries = [
      ...cashOrder('a', 5000, 5300),
      ...onlineOrder('b', 7000, 7300),
      refund('b', 1000),
      { type: LedgerEntryType.PLATFORM_DISCOUNT, amount: -500, orderId: 'a', orderTotal: null },
      { type: LedgerEntryType.ADJUSTMENT, amount: -250, orderId: null },
      { type: LedgerEntryType.ADJUSTMENT, amount: 900, orderId: null },
      paidByRestaurant(300),
    ];

    const plainSum = entries.reduce((sum, entry) => sum + entry.amount, 0);
    expect(settlementNetDue(summariseLedger(entries))).toBe(plainSum);
  });

  it('produces whole qəpik, never a fraction', () => {
    const summary = summariseLedger([
      ...onlineOrder('a', 1533, 1833),
      { type: LedgerEntryType.ADJUSTMENT, amount: -17, orderId: null },
    ]);
    expect(Number.isInteger(settlementNetDue(summary))).toBe(true);
  });

  it('reads an entry written before orderTotal existed as zero, not NaN', () => {
    // Old commission entries carry no order total. Gross sales is then
    // understated, which is visible and dull; NaN would poison the invoice.
    const summary = summariseLedger([
      { type: LedgerEntryType.COMMISSION, amount: 600, orderId: 'legacy' },
    ]);
    expect(summary.grossSales).toBe(0);
    expect(settlementNetDue(summary)).toBe(600);
  });
});

describe('idempotency keys', () => {
  it('gives one online-takings entry per order', () => {
    expect(onlineCollectedIdempotencyKey('order-1')).toBe('online-collected:order-1');
    expect(onlineCollectedIdempotencyKey('order-1')).toBe(onlineCollectedIdempotencyKey('order-1'));
  });

  it('separates two partial refunds but not a retried one', () => {
    // Keyed by the running refunded total: retrying the first refund writes the
    // same document, while a genuine second refund writes a new one.
    expect(onlineRefundIdempotencyKey('pay-1', 2000)).toBe(
      onlineRefundIdempotencyKey('pay-1', 2000),
    );
    expect(onlineRefundIdempotencyKey('pay-1', 2000)).not.toBe(
      onlineRefundIdempotencyKey('pay-1', 5300),
    );
  });

  it('files one payment per bank reference, however it was typed', () => {
    const typed = settlementPaymentIdempotencyKey('r1', '2026-08', 'tr 4821/aug');
    const retyped = settlementPaymentIdempotencyKey('r1', '2026-08', 'TR-4821-AUG');
    expect(typed).toBe(retyped);
    expect(typed).not.toContain('/');
    expect(settlementPaymentIdempotencyKey('r1', '2026-08', 'TR4822')).not.toBe(typed);
  });

  it('never produces a key with a slash in it', () => {
    // A "/" would split the document path and write the entry somewhere else.
    expect(normaliseReferenceKey('a/b c-d')).toBe('ABCD');
  });
});

describe('bank details', () => {
  // The IBAN from the Azerbaijani example in the ISO 13616 registry.
  const AZ_IBAN = 'AZ21NABZ00000000137010001944';

  it('accepts a valid Azerbaijani IBAN however it is spaced', () => {
    expect(isValidIban(AZ_IBAN)).toBe(true);
    expect(isValidIban('az21 nabz 0000 0000 1370 1000 1944')).toBe(true);
    expect(isAzerbaijaniIban(AZ_IBAN)).toBe(true);
  });

  it('rejects a single mistyped character', () => {
    // The whole reason the check digits are verified: this is the typo that
    // otherwise sends a month of takings to nobody.
    expect(isValidIban('AZ21NABZ00000000137010001945')).toBe(false);
  });

  it('rejects a foreign IBAN as an Azerbaijani one while still parsing it', () => {
    expect(isValidIban('GB82WEST12345698765432')).toBe(true);
    expect(isAzerbaijaniIban('GB82WEST12345698765432')).toBe(false);
  });

  it('refuses anything shaped like a card number', () => {
    expect(looksLikeCardNumber('4169 7388 1234 5678')).toBe(true);
    expect(looksLikeCardNumber('4169738812345678')).toBe(true);
    expect(looksLikeCardNumber(AZ_IBAN)).toBe(false);
  });

  it('normalises and formats for reading against a statement', () => {
    expect(normaliseIban(' az21 nabz 0000 0000 1370 1000 1944 ')).toBe(AZ_IBAN);
    expect(formatIban(AZ_IBAN)).toBe('AZ21 NABZ 0000 0000 1370 1000 1944');
  });
});
