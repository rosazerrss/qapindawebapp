import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { OrderStatus } from '../shared/enums';
import { CUSTOMER_CANCEL_WINDOW_MS, customerCancelWindow } from '../shared/orderState';

/**
 * The first three minutes.
 *
 * "müşteri sifariş ederken eger sifariş qebul edilmeyibse 2-3 deqiqe erzinde
 * legv ede bilsin eger 3 deqiqe keçibse leğv ede bilmesin."
 *
 * Two conditions, and both are tested here: the clock, on both sides of the
 * boundary, and the kitchen's answer, which closes the window early whatever
 * the clock says.
 */

const PLACED_AT = Date.UTC(2026, 0, 1, 12, 0, 0);

describe('the window is three minutes', () => {
  it('is exactly that, and not a number somebody typed twice', () => {
    expect(CUSTOMER_CANCEL_WINDOW_MS).toBe(180_000);
  });

  it('is open the moment the order is placed', () => {
    const state = customerCancelWindow(OrderStatus.PLACED, PLACED_AT, PLACED_AT);
    expect(state.open).toBe(true);
    expect(state.open && state.msRemaining).toBe(CUSTOMER_CANCEL_WINDOW_MS);
  });

  it('is still open at two minutes fifty-nine', () => {
    const state = customerCancelWindow(OrderStatus.PLACED, PLACED_AT, PLACED_AT + 179_000);
    expect(state.open).toBe(true);
    expect(state.open && state.msRemaining).toBe(1000);
  });

  it('is still open one millisecond before the boundary', () => {
    const state = customerCancelWindow(
      OrderStatus.PLACED,
      PLACED_AT,
      PLACED_AT + CUSTOMER_CANCEL_WINDOW_MS - 1,
    );
    expect(state.open).toBe(true);
  });

  it('is closed exactly on the boundary', () => {
    // Three minutes have passed. The owner's rule says no.
    const state = customerCancelWindow(
      OrderStatus.PLACED,
      PLACED_AT,
      PLACED_AT + CUSTOMER_CANCEL_WINDOW_MS,
    );
    expect(state.open).toBe(false);
    expect(state.open === false && state.reason).toBe('expired');
  });

  it('is closed one millisecond after it', () => {
    const state = customerCancelWindow(
      OrderStatus.PLACED,
      PLACED_AT,
      PLACED_AT + CUSTOMER_CANCEL_WINDOW_MS + 1,
    );
    expect(state.open).toBe(false);
  });

  it('is closed an hour later, and says why', () => {
    const state = customerCancelWindow(OrderStatus.PLACED, PLACED_AT, PLACED_AT + 3_600_000);
    expect(state.open === false && state.reason).toBe('expired');
  });
});

describe('the kitchen closes it early', () => {
  it('refuses once the restaurant has accepted, even one second in', () => {
    const state = customerCancelWindow(OrderStatus.ACCEPTED, PLACED_AT, PLACED_AT + 1000);
    expect(state.open).toBe(false);
    expect(state.open === false && state.reason).toBe('accepted');
  });

  it.each([
    OrderStatus.PREPARING,
    OrderStatus.READY,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
  ])('refuses at %s however new the order is', (status) => {
    expect(customerCancelWindow(status, PLACED_AT, PLACED_AT + 1).open).toBe(false);
  });

  it('says "finished" rather than "accepted" for an order that already ended', () => {
    const state = customerCancelWindow(OrderStatus.CANCELLED, PLACED_AT, PLACED_AT + 1000);
    expect(state.open === false && state.reason).toBe('finished');
  });
});

describe('an online order the bank never confirmed', () => {
  it('can still be cancelled after three minutes', () => {
    // Nothing is cooking and no money has moved; closing the window would
    // strand the customer with an order they can neither pay for nor drop,
    // while it occupies their one active-order slot.
    const state = customerCancelWindow(
      OrderStatus.PENDING_PAYMENT,
      PLACED_AT,
      PLACED_AT + 3_600_000,
    );
    expect(state.open).toBe(true);
  });
});

describe('an order whose timestamp has not landed yet', () => {
  it('is treated as brand new rather than as expired', () => {
    // A Firestore server timestamp reads as null in the local echo of the
    // write. The order is milliseconds old, and the server re-measures against
    // the stored value before it cancels anything.
    const state = customerCancelWindow(OrderStatus.PLACED, null, PLACED_AT);
    expect(state.open).toBe(true);
  });
});

describe('the server decides, not the browser', () => {
  const source = readFileSync('functions/src/orders/status.ts', 'utf8');

  it('measures the window inside updateOrderStatus with its own clock', () => {
    expect(source).toContain('customerCancelWindow(');
    expect(source).toContain("order.placedAt?.toMillis?.() ?? null");
    expect(source).toContain('Date.now()');
    expect(source).toContain('fail(AppErrorCode.CANCEL_WINDOW_CLOSED)');
  });

  it('measures only the customer, leaving the restaurant and the platform alone', () => {
    expect(source).toContain('if (actor === OrderActor.CUSTOMER && to === OrderStatus.CANCELLED)');
  });

  it('never takes a time from the request payload', () => {
    expect(source).not.toContain("data, 'placedAt'");
    expect(source).not.toContain("data.now");
  });
});

describe('a cancelled online order does not strand the money', () => {
  const source = readFileSync('functions/src/orders/status.ts', 'utf8');

  it('asks the payment record whether the platform is holding anything', () => {
    // The order's own `paymentStatus` is a copy that can lag the provider's
    // callback; the payment document is the authority.
    expect(source).toContain('isCapturedPayment(payment.state)');
    expect(source).toContain('paths.payment(order.paymentId)');
  });

  it('marks it REFUND_PENDING rather than NOT_COLLECTED', () => {
    // NOT_COLLECTED on captured money is the sentence that loses it: the order
    // shows nothing owed, and the customer has neither food nor a refund.
    expect(source).toContain('PaymentStatus.REFUND_PENDING');
    expect(source).toContain('refundDue');
  });

  it('puts it on the operators’ desk, with the amount', () => {
    expect(source).toContain('NotificationType.OPS_ORDER_PROBLEM');
    expect(source).toContain('formatMoney(outcome.refundAmount)');
  });

  it('reads the payment before it writes anything', () => {
    const body = source.slice(source.indexOf('const outcome = await db.runTransaction'));
    const paymentRead = body.indexOf('paths.payment(order.paymentId)');
    const firstWrite = Math.min(
      ...['tx.set(', 'tx.update(', 'notifyIn(', 'auditIn(']
        .map((token) => body.indexOf(token))
        .filter((index) => index !== -1),
    );
    expect(paymentRead).toBeGreaterThan(-1);
    expect(paymentRead).toBeLessThan(firstWrite);
  });
});

describe('what the customer sees', () => {
  it('counts down on the button and states the reason when it is gone', () => {
    const page = readFileSync('src/app/orders/[orderId]/page.tsx', 'utf8');
    expect(page).toContain('customerCancelWindow(');
    expect(page).toContain("t('order.cancelWithin'");
    expect(page).toContain("t('order.cancelClosedExpired')");
    expect(page).toContain("t('order.cancelOnlyBeforeAccept')");
  });

  it('dials the restaurant without printing the number on the button', () => {
    const page = readFileSync('src/app/orders/[orderId]/page.tsx', 'utf8');
    // Older orders carry no snapshotted number, so the button is conditional.
    expect(page).toContain('order.restaurantPhone && (');
    expect(page).toContain('href={`tel:${order.restaurantPhone}`}');

    /*
     * The digits belong in the href and in the accessible label, not in the
     * button's text. A button says what pressing it does; the number is what
     * happens afterwards, and printing it made a wide control out of something
     * nobody reads off a screen to dial by hand.
     */
    expect(page).toContain("{t('order.callRestaurant')}");
    expect(page).not.toContain('formatPhone(order.restaurantPhone)');
  });

  it('has every sentence in all three languages, with double braces', () => {
    for (const locale of ['az', 'en', 'ru']) {
      const dictionary = JSON.parse(
        readFileSync(`src/i18n/translations/${locale}.json`, 'utf8'),
      ) as { order: Record<string, string>; errors: Record<string, string> };

      expect(dictionary.order.cancelWithin, locale).toContain('{{time}}');
      // No longer carries the number: the button names the action, and the
      // digits live in the `tel:` href.
      expect(dictionary.order.callRestaurant, locale).toBeTruthy();
      expect(dictionary.order.cancelClosedExpired, locale).toBeTruthy();
      expect(dictionary.order.refundPending, locale).toBeTruthy();
      expect(dictionary.errors.CANCEL_WINDOW_CLOSED, locale).toBeTruthy();
    }
  });
});
