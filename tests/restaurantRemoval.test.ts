/**
 * Removing a restaurant.
 *
 * The whole risk here is asymmetric in the same way a deletion always is: an
 * over-cautious refusal costs an admin ten minutes, and an over-eager removal
 * ends a business's presence on the platform with no undo on any screen. So
 * these assert the guards, not the happy path.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import { RestaurantStatus } from '../shared/enums';

const remove = fs.readFileSync('functions/src/restaurants/remove.ts', 'utf8');

/**
 * The file with its prose taken out.
 *
 * Needed for the "no force flag" assertion below, which would otherwise match
 * the comment that explains why there is no force flag — a test that fails
 * because the code is well explained is a test nobody keeps.
 */
const code = remove.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('what stops a removal', () => {
  it('is the super admin’s alone — suspending is reversible, this is not', () => {
    expect(remove).toContain('caller.role !== UserRole.SUPER_ADMIN');
  });

  it('refuses while an order is still moving', () => {
    // Deleting a restaurant out from under a customer whose dinner is in a car
    // is the one outcome this callable must never produce.
    expect(remove).toContain("fail(AppErrorCode.CONFLICT, 'active-orders')");
    expect(remove).toContain('ACTIVE_ORDER_STATUSES');
  });

  it('refuses while a settlement still has a balance', () => {
    // Removing a debtor from every list is how a debt stops being chased.
    expect(remove).toContain('unsettled:');
    expect(remove).toContain('SettlementStatus.INVOICED');
    expect(remove).toContain('SettlementStatus.OVERDUE');
  });

  it('lets an empty open settlement through', () => {
    // A month that simply happened is not a debt. Without this every
    // restaurant would be permanently undeletable by its own blank invoice.
    expect(remove).toContain('netDue !== 0');
  });

  it('asks for the restaurant’s own name', () => {
    expect(remove).toContain('confirmName');
    expect(remove).toContain("fail(AppErrorCode.VALIDATION_FAILED, 'confirmName')");
  });

  it('offers no force flag anywhere', () => {
    // Both blockers are things a person can resolve in minutes; a bypass would
    // be used for both.
    expect(code).not.toMatch(/\bforce\b/i);
  });
});

describe('what a removal actually does', () => {
  it('never deletes the restaurant document', () => {
    // Every order, settlement, ledger entry and review points at its id.
    expect(code).not.toMatch(/ref\.delete\(\)/);
    expect(remove).toContain('RestaurantStatus.REMOVED');
  });

  it('deletes the menu', () => {
    expect(remove).toContain('COLLECTIONS.menuCategories');
    expect(remove).toContain('COLLECTIONS.products');
  });

  it('unlinks the staff rather than deleting their accounts', () => {
    // Real people with real numbers, some of whom are also customers here.
    expect(remove).toContain('role: UserRole.CUSTOMER');
    expect(remove).toContain('restaurantId: null');
    expect(code).not.toContain('auth.deleteUser');
  });

  it('revokes their claims, which is what actually locks them out', () => {
    expect(remove).toContain('setUserClaims');
    expect(remove).toContain('revokeRefreshTokens');
  });

  it('closes the shop as well as hiding it', () => {
    // Belt and braces against a cached page or a stale listener.
    expect(remove).toContain('ServiceState.CLOSED');
  });

  it('writes the batch in chunks', () => {
    // A restaurant with four hundred dishes exceeds Firestore's batch limit,
    // and that failure would land after the refusals had already passed.
    expect(remove).toContain('BATCH_LIMIT');
  });

  it('is audited under its own action', () => {
    expect(remove).toContain('AuditAction.RESTAURANT_REMOVED');
  });

  it('is idempotent', () => {
    // Two admins on the same list, or one slow connection.
    expect(remove).toContain('alreadyRemoved: true');
  });
});

describe('a removed restaurant is invisible and inert', () => {
  it('cannot take an order', () => {
    const create = fs.readFileSync('functions/src/orders/create.ts', 'utf8');
    // The check is positive — only ACTIVE passes — so a new status is refused
    // by default rather than needing to be added to a deny list.
    expect(create).toContain('restaurant.status !== RestaurantStatus.ACTIVE');
  });

  it('is not readable by a customer', () => {
    const rules = fs.readFileSync('firestore.rules', 'utf8');
    expect(rules).toContain("resource.data.status == 'ACTIVE' || ownsRestaurant(id)");
  });

  it('is not on the shopfront', () => {
    const catalog = fs.readFileSync('src/services/catalog.ts', 'utf8');
    expect(catalog).toContain("where('status', '==', RestaurantStatus.ACTIVE)");
  });

  it('has its own status rather than reusing SUSPENDED', () => {
    // Suspension is temporary and reversible; conflating the two would make a
    // removed restaurant look like one waiting to come back.
    expect(RestaurantStatus.REMOVED).toBe('REMOVED');
    expect(RestaurantStatus.REMOVED).not.toBe(RestaurantStatus.SUSPENDED);
  });
});
