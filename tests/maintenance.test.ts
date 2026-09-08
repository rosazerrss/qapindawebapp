import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { AppErrorCode } from '../shared/errors';
import {
  maintenanceBlocks,
  maintenanceStateOf,
  normaliseMaintenanceUntil,
  orderingIsOpen,
} from '../shared/maintenance';

/**
 * Maintenance mode: "qətiyyən heçkim sifariş etməməlidir".
 *
 * The predicate is a pure function, so most of this file is ordinary unit
 * testing. The two facts that actually matter, though, are not properties of a
 * function — they are properties of where the function is CALLED:
 *
 *   1. the flag is read from the settings document the server fetched, never
 *      from anything the caller sent, and
 *   2. nothing but order creation is gated on it, so a closed platform can
 *      still be repaired and the orders already in flight still finish.
 *
 * Neither can be checked without a database, and both are exactly the kind of
 * thing a later edit breaks silently. So they are pinned by reading the server
 * source — the same approach `tests/indexes.test.ts` takes for composite
 * indexes, and for the same reason: the alternative is finding out from a
 * customer.
 */

const createSource = readFileSync('functions/src/orders/create.ts', 'utf8');
const statusSource = readFileSync('functions/src/orders/status.ts', 'utf8');
const deliverySource = readFileSync('functions/src/orders/delivery.ts', 'utf8');

describe('the predicate', () => {
  it('refuses a new order while the platform is closed', () => {
    expect(orderingIsOpen({ maintenanceMode: true })).toBe(false);
  });

  it('allows a new order while the platform is open', () => {
    expect(orderingIsOpen({ maintenanceMode: false })).toBe(true);
  });

  it('treats a settings document written before the flag existed as open', () => {
    // Every deployment made before this feature shipped has no such field, and
    // a missing field closing the platform would be an outage caused by a
    // deploy rather than by a decision.
    expect(orderingIsOpen({})).toBe(true);
    expect(orderingIsOpen(null)).toBe(true);
    expect(orderingIsOpen(undefined)).toBe(true);
  });

  it('does not accept a truthy non-boolean as "closed"', () => {
    // The document is untrusted storage. Only an explicit `true` closes it.
    expect(orderingIsOpen({ maintenanceMode: 'true' as unknown as boolean })).toBe(true);
    expect(orderingIsOpen({ maintenanceMode: 1 as unknown as boolean })).toBe(true);
  });
});

describe('what the customer is told', () => {
  it('carries the admin"s own message and return time while closed', () => {
    const state = maintenanceStateOf({
      maintenanceMode: true,
      maintenanceMessage: '  Serverləri yeniləyirik  ',
      maintenanceUntil: 1_700_000_000_000,
    });

    expect(state).toEqual({
      on: true,
      message: 'Serverləri yeniləyirik',
      until: 1_700_000_000_000,
    });
  });

  it('shows nothing left over once the platform is open again', () => {
    // A message from the last outage on a working shopfront is worse than no
    // message: it says the platform is closed when it is not.
    const state = maintenanceStateOf({
      maintenanceMode: false,
      maintenanceMessage: 'Serverləri yeniləyirik',
      maintenanceUntil: 1_700_000_000_000,
    });

    expect(state).toEqual({ on: false, message: null, until: null });
  });

  it('treats an empty explanation as no explanation', () => {
    expect(maintenanceStateOf({ maintenanceMode: true, maintenanceMessage: '   ' }).message).toBe(
      null,
    );
  });
});

describe('the promised return time', () => {
  const now = 1_700_000_000_000;

  it('keeps a time in the near future', () => {
    expect(normaliseMaintenanceUntil(now + 3_600_000, now)).toBe(now + 3_600_000);
  });

  it('drops a time that has already passed', () => {
    // "We will be back at four" shown at five is worse than saying nothing.
    expect(normaliseMaintenanceUntil(now - 1, now)).toBe(null);
  });

  it('drops a time so far out it can only be a typo', () => {
    expect(normaliseMaintenanceUntil(now + 400 * 24 * 60 * 60 * 1000, now)).toBe(null);
  });

  it('drops anything that is not a finite number', () => {
    expect(normaliseMaintenanceUntil('tonight', now)).toBe(null);
    expect(normaliseMaintenanceUntil(Number.NaN, now)).toBe(null);
    expect(normaliseMaintenanceUntil(null, now)).toBe(null);
  });
});

describe('the server refuses, and refuses from its own copy of the flag', () => {
  it('gates createOrder on the settings document it read itself', () => {
    expect(createSource).toContain('orderingIsOpen(settingsSnap.data() as PublicSettings');
    expect(createSource).toContain('fail(AppErrorCode.PLATFORM_MAINTENANCE)');
  });

  it('gates previewOrder the same way, so the path closes before the last step', () => {
    // Two occurrences: one in `createOrder`, one in `previewOrder`.
    const gates = createSource.match(/orderingIsOpen\(settingsSnap\.data\(\)/g) ?? [];
    expect(gates).toHaveLength(2);
  });

  it('never reads the flag out of the request', () => {
    // The whole point of the gate. A client that posts `maintenanceMode: false`
    // must change nothing at all about whether its order is accepted.
    expect(createSource).not.toMatch(/data\.maintenanceMode/);
    expect(createSource).not.toMatch(/request\.data[^;]*maintenance/i);
  });

  it('has a sentence of its own for the refusal', () => {
    expect(AppErrorCode.PLATFORM_MAINTENANCE).toBe('PLATFORM_MAINTENANCE');
  });
});

describe('what stays open', () => {
  it('blocks new orders and nothing else', () => {
    expect(maintenanceBlocks('createOrder')).toBe(true);
    expect(maintenanceBlocks('previewOrder')).toBe(true);
    expect(maintenanceBlocks('orderStatusChange')).toBe(false);
    expect(maintenanceBlocks('panelAccess')).toBe(false);
    expect(maintenanceBlocks('signIn')).toBe(false);
  });

  it('leaves the order engine untouched, so orders in flight complete', () => {
    // The restaurant accepts, cooks and hands over; the courier delivers. None
    // of that may learn about maintenance mode, or a platform closed for an
    // hour would strand every order that was already cooking.
    expect(statusSource).not.toMatch(/maintenance/i);
    expect(deliverySource).not.toMatch(/maintenance/i);
  });

  it('leaves the panels untouched', () => {
    // A panel gated on this would be a platform that cannot be repaired while
    // it is closed, which is the one state in which repairing it is urgent.
    const shell = readFileSync('src/components/layout/PanelShell.tsx', 'utf8');
    const courier = readFileSync('src/components/courier/CourierShell.tsx', 'utf8');

    expect(shell).not.toMatch(/maintenance/i);
    expect(courier).not.toMatch(/maintenance/i);
  });
});
