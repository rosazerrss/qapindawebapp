/**
 * QAPINDA — the rate limiter.
 *
 * Unlike most of this suite, these are real behaviour tests rather than text
 * assertions: the in-memory limiter is pure enough to run, and a limiter that
 * is off by one is a limiter that either refuses a customer their dinner or
 * lets a script through. Both are worth catching here.
 *
 * The Firestore half cannot be run without an emulator and is asserted as text,
 * with the reason written next to it.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  BUDGETS,
  DEFAULT_BUDGET,
  allowInMemory,
  rateLimitDocId,
  resetInMemoryLimits,
  type Budget,
} from '../functions/src/lib/rateLimit';

const source = readFileSync('functions/src/lib/rateLimit.ts', 'utf8');

beforeEach(() => resetInMemoryLimits());

describe('the in-memory window', () => {
  const budget: Budget = { calls: 3, windowMs: 1_000 };

  it('allows exactly the budget and refuses the next call', () => {
    expect(allowInMemory('k', budget, 0)).toBe(true);
    expect(allowInMemory('k', budget, 10)).toBe(true);
    expect(allowInMemory('k', budget, 20)).toBe(true);
    expect(allowInMemory('k', budget, 30), 'the fourth call slipped through').toBe(false);
  });

  it('keeps refusing for the rest of the window', () => {
    for (let i = 0; i < 3; i += 1) allowInMemory('k', budget, i);
    expect(allowInMemory('k', budget, 500)).toBe(false);
    expect(allowInMemory('k', budget, 999)).toBe(false);
  });

  it('opens a fresh window once the old one has passed', () => {
    for (let i = 0; i < 5; i += 1) allowInMemory('k', budget, i);
    expect(allowInMemory('k', budget, 1_000), 'the window never reopened').toBe(true);
  });

  it('counts each caller separately', () => {
    for (let i = 0; i < 3; i += 1) allowInMemory('a', budget, i);
    expect(allowInMemory('a', budget, 4)).toBe(false);
    expect(allowInMemory('b', budget, 4), "one caller's flood refused another").toBe(true);
  });

  it('counts each function separately', () => {
    // The key `guard` builds is `${name}~${subject}`, so a customer who has
    // exhausted search must still be able to place their order.
    for (let i = 0; i < 3; i += 1) allowInMemory('searchMenu~u:1', budget, i);
    expect(allowInMemory('searchMenu~u:1', budget, 4)).toBe(false);
    expect(allowInMemory('createOrder~u:1', budget, 4)).toBe(true);
  });
});

describe('the durable window key', () => {
  it('changes when the window changes and not before', () => {
    const a = rateLimitDocId('previewOrder', 'u:1', 59_999, 60_000);
    const b = rateLimitDocId('previewOrder', 'u:1', 60_000, 60_000);
    expect(a).not.toBe(b);
    expect(rateLimitDocId('previewOrder', 'u:1', 0, 60_000)).toBe(a);
  });

  it('cannot be made to collide with another function', () => {
    // A document id may not contain `/`, and the separator must not be
    // forgeable out of a subject — an IPv6 address is a real subject here.
    const id = rateLimitDocId('previewOrder', 'ip:2001:db8::1', 0, 60_000);
    expect(id).not.toContain('/');
    expect(id.split('~')[0]).toBe('previewOrder');
    expect(rateLimitDocId('a~b', 'c', 0, 1_000)).not.toBe(rateLimitDocId('a', 'b~c', 0, 1_000));
  });
});

describe('the budgets are set where they matter', () => {
  it('caps the coupon oracle durably', () => {
    /*
     * `previewOrder` answers "is this coupon valid". Unlimited it is a free
     * guesser; limited only in memory it is a free guesser twenty times over,
     * because Cloud Run may be running twenty instances.
     */
    expect(BUDGETS.previewOrder?.durable, 'previewOrder must not be beatable by spreading').toBe(
      true,
    );
    expect(BUDGETS.previewOrder!.calls).toBeLessThanOrEqual(60);
  });

  it('makes anything that reaches a phone durable', () => {
    for (const name of ['sendTestNotification', 'fileComplaint', 'applyForRestaurant']) {
      expect(BUDGETS[name]?.durable, `${name} should be counted across instances`).toBe(true);
    }
  });

  it('leaves the kitchen enough room to work', () => {
    // A busy Friday is dozens of status moves and sold-out toggles a minute.
    // A limit that refuses those is more expensive than the attack it stops.
    expect(BUDGETS.updateOrderStatus!.calls).toBeGreaterThanOrEqual(120);
    expect(BUDGETS.setProductAvailability!.calls).toBeGreaterThanOrEqual(120);
    expect(DEFAULT_BUDGET.calls).toBeGreaterThanOrEqual(60);
  });
});

describe('the limiter is wired in one place and fails the safe way', () => {
  it('runs inside guard, so every callable is covered', () => {
    const errors = readFileSync('functions/src/lib/errors.ts', 'utf8');
    expect(errors).toContain('enforceRateLimit(name, request)');
    // Before the handler: a refused call must not pay for the reads first.
    expect(errors.indexOf('enforceRateLimit')).toBeLessThan(errors.indexOf('await handler('));
  });

  it('does not touch the payment callback', () => {
    // Epoint's callback is `onRequest` and does not go through `guard`.
    // Rate-limiting a payment provider is a way to lose money.
    const flow = readFileSync('functions/src/payments/flow.ts', 'utf8');
    expect(flow).toContain('export const epointCallback = onRequest(');
    expect(flow).not.toContain('enforceRateLimit');
  });

  it('allows the call when its own storage is unavailable', () => {
    // A hardening layer that becomes an outage when Firestore has a bad minute
    // is worse than no hardening layer.
    expect(source).toContain('FAIL OPEN');
    expect(source).toContain('return true;');
  });

  it('cannot grow without bound', () => {
    expect(source).toContain('MAX_KEYS');
    expect(source).toContain('evictIfFull');
  });

  it('is cleaned up by the daily prune', () => {
    const jobs = readFileSync('functions/src/orders/jobs.ts', 'utf8');
    expect(jobs).toContain("collection('rateLimits')");
    expect(jobs).toContain('pruned rate limit counters');
  });

  it('is closed to every client', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    expect(rules).toMatch(/match \/rateLimits\/\{key\} \{\s*allow read, write: if false;/);
  });
});
