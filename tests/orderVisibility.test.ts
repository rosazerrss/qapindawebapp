/**
 * An order must be visible to somebody at every point in its life.
 *
 * THE BUG THIS FILE EXISTS FOR
 * ----------------------------
 * A delivery the courier could not complete left the restaurant's live queue —
 * it is no longer active — and never arrived in the restaurant's history,
 * because that query listed five statuses and `DELIVERY_FAILED` was not one of
 * them. The order was not hidden or archived. It was in neither of the two
 * lists the restaurant can see, and from the owner's side of the screen it had
 * stopped existing. The same hole was in the admin's "uğursuz" tab.
 *
 * The class of failure is what matters here: a hand-kept list of statuses that
 * is correct until somebody adds a status, and looks correct for ever after. So
 * the assertions below are about EVERY status being accounted for, not about
 * the one that was missing.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  ACTIVE_ORDER_STATUSES,
  FAILED_ORDER_STATUSES,
  OrderStatus,
  PAST_ORDER_STATUSES,
  QUEUE_EXCLUDED_ORDER_STATUSES,
} from '../shared/enums';

const ALL = Object.values(OrderStatus);

describe('every status is somewhere', () => {
  it('accounts for all of them across active and past', () => {
    const covered = new Set([
      ...ACTIVE_ORDER_STATUSES,
      ...PAST_ORDER_STATUSES,
      // Deliberately in neither queue, and named so that "neither" is a
      // decision somebody wrote down rather than an omission.
      ...QUEUE_EXCLUDED_ORDER_STATUSES,
    ]);
    const orphaned = ALL.filter((status) => !covered.has(status));

    // This is the assertion that would have caught the original bug, and the
    // one that will catch the next status somebody adds.
    expect(orphaned).toEqual([]);
  });

  it('excludes only the pre-payment placeholder from the queues', () => {
    // Anything else appearing here is an order nobody can find.
    expect(QUEUE_EXCLUDED_ORDER_STATUSES).toEqual([OrderStatus.PENDING_PAYMENT]);
  });

  it('keeps an order whose refund is in flight findable', () => {
    expect(PAST_ORDER_STATUSES).toContain(OrderStatus.REFUND_PENDING);
  });

  it('never puts one in both lists', () => {
    const both = ACTIVE_ORDER_STATUSES.filter((status) => PAST_ORDER_STATUSES.includes(status));
    expect(both).toEqual([]);
  });

  it('keeps both lists inside the ten a Firestore `in` query allows', () => {
    // Exceeding it does not fail loudly — the query throws at runtime, on
    // somebody's screen, in production.
    expect(ACTIVE_ORDER_STATUSES.length).toBeLessThanOrEqual(10);
    expect(PAST_ORDER_STATUSES.length).toBeLessThanOrEqual(10);
  });

  it('files a failed delivery as past, not active', () => {
    expect(PAST_ORDER_STATUSES).toContain(OrderStatus.DELIVERY_FAILED);
    expect(ACTIVE_ORDER_STATUSES).not.toContain(OrderStatus.DELIVERY_FAILED);
  });

  it('counts a failed delivery among the orders that went wrong', () => {
    expect(FAILED_ORDER_STATUSES).toContain(OrderStatus.DELIVERY_FAILED);
  });
});

describe('the screens read the shared lists rather than their own copies', () => {
  const restaurant = fs.readFileSync('src/app/panel/page.tsx', 'utf8');
  const adminOrders = fs.readFileSync(
    'src/app/qapinda-idare-merkezi-7xk4m2/orders/page.tsx',
    'utf8',
  );
  const operator = fs.readFileSync('src/app/operator/LiveOrders.tsx', 'utf8');

  it('the restaurant panel no longer keeps its own past-status list', () => {
    // The private copy is what went stale. Importing the shared one is the fix.
    expect(restaurant).not.toMatch(/const PAST_ORDER_STATUSES/);
    expect(restaurant).toContain('PAST_ORDER_STATUSES');
  });

  it('the admin’s failed tab filters on the shared list', () => {
    expect(adminOrders).toContain('FAILED_ORDER_STATUSES.includes(order.status)');
  });

  it('the operator’s board keeps failed deliveries on screen', () => {
    // A customer with no dinner is "live" for a support desk whatever the
    // order's status field says.
    expect(operator).toContain('OrderStatus.DELIVERY_FAILED');
    expect(operator).toContain('OPERATOR_BOARD_STATUSES');
  });
});

describe('the kitchen is told', () => {
  const delivery = fs.readFileSync('functions/src/orders/delivery.ts', 'utf8');

  it('notifies the restaurant when somebody else reported the failure', () => {
    expect(delivery).toContain('RESTAURANT_DELIVERY_FAILED');
    // Not when the restaurant reported it themselves — they were there.
    expect(delivery).toContain('if (!restaurantSide) {');
  });

  it('still notifies the operator', () => {
    expect(delivery).toContain('OPS_ORDER_PROBLEM');
  });

  it('never lets a failed notification undo a committed status change', () => {
    const block = delivery.slice(delivery.indexOf('if (!restaurantSide) {'));
    expect(block.slice(0, 900)).toContain('.catch(() => undefined)');
  });
});
