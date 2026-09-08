import { describe, expect, it } from 'vitest';

import { OrderActor, OrderStatus, TERMINAL_ORDER_STATUSES } from '../shared/enums';
import {
  ORDER_TRANSITIONS,
  awaitingRestaurant,
  checkTransition,
  isTerminal,
  nextStatusesFor,
  trackingStep,
} from '../shared/orderState';

describe('the happy path', () => {
  it('walks placed → accepted → preparing → ready → out → delivered → completed', () => {
    const steps: Array<[OrderStatus, OrderStatus, OrderActor]> = [
      [OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderActor.RESTAURANT],
      [OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderActor.RESTAURANT],
      [OrderStatus.PREPARING, OrderStatus.READY, OrderActor.RESTAURANT],
      [OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY, OrderActor.RESTAURANT],
      [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED, OrderActor.RESTAURANT],
      [OrderStatus.DELIVERED, OrderStatus.COMPLETED, OrderActor.SYSTEM],
    ];

    for (const [from, to, actor] of steps) {
      expect(checkTransition(from, to, actor).allowed, `${from} → ${to}`).toBe(true);
    }
  });

  it('lets a pickup order jump from ready straight to delivered', () => {
    expect(
      checkTransition(OrderStatus.READY, OrderStatus.DELIVERED, OrderActor.RESTAURANT).allowed,
    ).toBe(true);
  });
});

describe('the customer cannot drive the kitchen', () => {
  it('refuses to let a customer accept their own order', () => {
    const result = checkTransition(OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderActor.CUSTOMER);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('actor-not-allowed');
  });

  it('refuses to let a customer mark an order delivered', () => {
    expect(
      checkTransition(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED, OrderActor.CUSTOMER)
        .allowed,
    ).toBe(false);
  });

  it('refuses to let a customer skip straight to completed', () => {
    const result = checkTransition(OrderStatus.PLACED, OrderStatus.COMPLETED, OrderActor.CUSTOMER);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('transition-not-allowed');
  });
});

describe('the customer cancellation window', () => {
  it('opens while the order is only PLACED', () => {
    expect(
      checkTransition(OrderStatus.PLACED, OrderStatus.CANCELLED, OrderActor.CUSTOMER, 'fikrimi dəyişdim')
        .allowed,
    ).toBe(true);
  });

  it('closes the moment the restaurant accepts', () => {
    for (const from of [
      OrderStatus.ACCEPTED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.OUT_FOR_DELIVERY,
    ]) {
      const result = checkTransition(from, OrderStatus.CANCELLED, OrderActor.CUSTOMER, 'səbəb');
      expect(result.allowed, `customer cancelling from ${from}`).toBe(false);
      expect(result.reason).toBe('actor-not-allowed');
    }
  });

  it('demands a written reason', () => {
    const blank = checkTransition(OrderStatus.PLACED, OrderStatus.CANCELLED, OrderActor.CUSTOMER, '   ');
    expect(blank.allowed).toBe(false);
    expect(blank.reason).toBe('reason-required');
    expect(blank.requiresReason).toBe(true);
  });
});

describe('the restaurant stays in its lane', () => {
  it('may reject a new order, with a reason', () => {
    expect(
      checkTransition(OrderStatus.PLACED, OrderStatus.REJECTED, OrderActor.RESTAURANT, 'material bitib')
        .allowed,
    ).toBe(true);
    expect(
      checkTransition(OrderStatus.PLACED, OrderStatus.REJECTED, OrderActor.RESTAURANT).allowed,
    ).toBe(false);
  });

  it('may not cancel once the food is already being cooked', () => {
    const result = checkTransition(
      OrderStatus.PREPARING,
      OrderStatus.CANCELLED,
      OrderActor.RESTAURANT,
      'səbəb',
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('actor-not-allowed');
  });

  it('may not complete an order itself — only the system settles it', () => {
    expect(
      checkTransition(OrderStatus.DELIVERED, OrderStatus.COMPLETED, OrderActor.RESTAURANT).allowed,
    ).toBe(false);
  });

  it('may not expire an order to dodge the response window', () => {
    expect(
      checkTransition(OrderStatus.PLACED, OrderStatus.EXPIRED, OrderActor.RESTAURANT).allowed,
    ).toBe(false);
    expect(checkTransition(OrderStatus.PLACED, OrderStatus.EXPIRED, OrderActor.SYSTEM).allowed).toBe(
      true,
    );
  });
});

describe('the platform can rescue, but never rewrite', () => {
  it('may force-cancel at any live stage, with a reason', () => {
    for (const from of [
      OrderStatus.PLACED,
      OrderStatus.ACCEPTED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.OUT_FOR_DELIVERY,
    ]) {
      expect(
        checkTransition(from, OrderStatus.CANCELLED, OrderActor.PLATFORM, 'müştəri şikayət etdi')
          .allowed,
        `platform cancelling from ${from}`,
      ).toBe(true);
    }
  });

  it('cannot reopen a terminal order', () => {
    for (const from of TERMINAL_ORDER_STATUSES) {
      const result = checkTransition(from, OrderStatus.PLACED, OrderActor.PLATFORM, 'səbəb');
      expect(result.allowed, `reopening ${from}`).toBe(false);
      expect(result.reason).toBe('terminal-status');
    }
  });
});

describe('the machine is well formed', () => {
  it('has an entry for every status', () => {
    for (const status of Object.values(OrderStatus)) {
      expect(ORDER_TRANSITIONS[status], `no entry for ${status}`).toBeDefined();
    }
  });

  it('never points at a status that does not exist', () => {
    const known = new Set<string>(Object.values(OrderStatus));
    for (const transitions of Object.values(ORDER_TRANSITIONS)) {
      for (const transition of transitions) {
        expect(known.has(transition.to)).toBe(true);
        expect(transition.actors.length).toBeGreaterThan(0);
      }
    }
  });

  it('leaves every terminal status with no way out', () => {
    for (const status of TERMINAL_ORDER_STATUSES) {
      expect(isTerminal(status)).toBe(true);
      expect(ORDER_TRANSITIONS[status]).toHaveLength(0);
    }
  });

  it('never lets a transition demand a reason from one actor but not another', () => {
    // A "reason" that some actors can skip is not an audit trail.
    for (const transitions of Object.values(ORDER_TRANSITIONS)) {
      const byTarget = new Map<string, boolean>();
      for (const transition of transitions) {
        const previous = byTarget.get(transition.to);
        if (previous !== undefined) expect(previous).toBe(transition.requiresReason === true);
        byTarget.set(transition.to, transition.requiresReason === true);
      }
    }
  });
});

describe('what the UI is told', () => {
  it('offers the restaurant accept and reject on a new order', () => {
    const options = nextStatusesFor(OrderStatus.PLACED, OrderActor.RESTAURANT);
    expect(options).toContain(OrderStatus.ACCEPTED);
    expect(options).toContain(OrderStatus.REJECTED);
    expect(options).not.toContain(OrderStatus.EXPIRED);
  });

  it('offers the customer nothing but cancel, and only at the start', () => {
    expect(nextStatusesFor(OrderStatus.PLACED, OrderActor.CUSTOMER)).toEqual([
      OrderStatus.CANCELLED,
    ]);
    expect(nextStatusesFor(OrderStatus.ACCEPTED, OrderActor.CUSTOMER)).toEqual([]);
  });

  it('flags only PLACED as waiting on the restaurant', () => {
    expect(awaitingRestaurant(OrderStatus.PLACED)).toBe(true);
    expect(awaitingRestaurant(OrderStatus.ACCEPTED)).toBe(false);
  });

  it('maps the tracking bar to four rising steps and nothing on a bad ending', () => {
    expect(trackingStep(OrderStatus.PLACED)).toBe(0);
    expect(trackingStep(OrderStatus.PREPARING)).toBe(1);
    expect(trackingStep(OrderStatus.OUT_FOR_DELIVERY)).toBe(2);
    expect(trackingStep(OrderStatus.COMPLETED)).toBe(3);
    expect(trackingStep(OrderStatus.CANCELLED)).toBeNull();
    expect(trackingStep(OrderStatus.REJECTED)).toBeNull();
    expect(trackingStep(OrderStatus.EXPIRED)).toBeNull();
  });
});
