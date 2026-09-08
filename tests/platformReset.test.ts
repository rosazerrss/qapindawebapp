import { describe, expect, it } from 'vitest';

import { AppErrorCode } from '../shared/errors';
import { UserRole } from '../shared/enums';
import { COLLECTIONS } from '../shared/collections';
import { Permission, ROLE_PERMISSIONS, hasPermission } from '../shared/permissions';
import {
  PLATFORM_NAME,
  RESET_CHUNK,
  RESET_PROTECTED_COLLECTIONS,
  RESET_SCOPES,
  RESET_SCOPE_TARGETS,
  ResetScope,
  chunkSize,
  isProtectedCollection,
  isResetComplete,
  isResetScope,
  normaliseConfirmation,
  refuseReset,
  resetTargets,
  totalOf,
} from '../shared/reset';

/**
 * The test-data reset is the only thing in this system that permanently
 * destroys financial records, so what is tested here is not that it works —
 * it is everything that has to stop it.
 */

function request(overrides: Partial<Parameters<typeof refuseReset>[0]> = {}) {
  return {
    role: UserRole.SUPER_ADMIN,
    resetEnabled: true,
    confirmation: PLATFORM_NAME,
    scopes: [ResetScope.ORDERS] as string[],
    ...overrides,
  };
}

describe('reset scope', () => {
  it('deletes exactly the collections the owner asked for', () => {
    const all = resetTargets(RESET_SCOPES).map((target) => target.collection);

    expect(all.sort()).toEqual(
      [
        COLLECTIONS.orders,
        COLLECTIONS.payments,
        COLLECTIONS.paymentEvents,
        COLLECTIONS.ledgerEntries,
        COLLECTIONS.settlements,
        COLLECTIONS.complaints,
        COLLECTIONS.supportTickets,
        COLLECTIONS.supportFeedback,
        COLLECTIONS.reviews,
        COLLECTIONS.notifications,
        COLLECTIONS.couponRedemptions,
        COLLECTIONS.deliveryCodes,
        COLLECTIONS.idempotencyKeys,
      ].sort(),
    );
  });

  it('never touches an account, a lock, a restaurant, the settings or the log', () => {
    // The four the owner named by name, plus the two that would orphan an
    // account if they went: a deleted phone lock lets the number be claimed
    // by somebody else while the account it belongs to still exists.
    for (const kept of [
      COLLECTIONS.users,
      COLLECTIONS.phoneIndex,
      COLLECTIONS.emailIndex,
      COLLECTIONS.restaurants,
      COLLECTIONS.menuCategories,
      COLLECTIONS.products,
      COLLECTIONS.systemSettings,
      COLLECTIONS.auditLogs,
    ]) {
      expect(RESET_PROTECTED_COLLECTIONS).toContain(kept);
      expect(isProtectedCollection(kept)).toBe(true);
    }
  });

  it('has no scope, in any combination, that reaches a protected collection', () => {
    for (const scope of RESET_SCOPES) {
      for (const target of RESET_SCOPE_TARGETS[scope]) {
        expect(isProtectedCollection(target.collection)).toBe(false);
      }
    }

    for (const target of resetTargets(RESET_SCOPES)) {
      expect(isProtectedCollection(target.collection)).toBe(false);
    }
  });

  it('takes an order\'s event trail and private metadata with it', () => {
    const orders = resetTargets([ResetScope.ORDERS])[0];

    expect(orders.collection).toBe(COLLECTIONS.orders);
    // Firestore leaves subcollections behind, and an event trail whose order
    // is gone is unreachable by anything for ever.
    expect(orders.subcollections).toContain('events');
    expect(orders.subcollections).toContain('private');
  });

  it('takes a ticket\'s messages with it', () => {
    const tickets = resetTargets([ResetScope.SUPPORT]).find(
      (target) => target.collection === COLLECTIONS.supportTickets,
    );

    expect(tickets?.subcollections).toEqual(['messages']);
  });

  it('is a separate switch per group, and one switch takes only its own', () => {
    expect(resetTargets([ResetScope.REVIEWS]).map((target) => target.collection)).toEqual([
      COLLECTIONS.reviews,
    ]);

    // Money is one switch over two collections: an emptied ledger with the
    // settlements still standing is a half-state nobody would ask for.
    expect(resetTargets([ResetScope.LEDGER]).map((target) => target.collection)).toEqual([
      COLLECTIONS.ledgerEntries,
      COLLECTIONS.settlements,
    ]);
  });

  it('lists each collection once and in a fixed order', () => {
    const twice = resetTargets([ResetScope.PAYMENTS, ResetScope.PAYMENTS, ResetScope.ORDERS]);
    const names = twice.map((target) => target.collection);

    expect(new Set(names).size).toBe(names.length);
    // Scope order, not argument order — a report that counted one collection
    // twice would say more was deleted than existed.
    expect(names).toEqual([COLLECTIONS.orders, COLLECTIONS.payments, COLLECTIONS.paymentEvents]);
  });

  it('refuses a scope name it does not know', () => {
    expect(isResetScope('ORDERS')).toBe(true);
    expect(isResetScope('USERS')).toBe(false);
    expect(isResetScope(null)).toBe(false);
  });
});

describe('the production guard', () => {
  it('refuses while the settings flag is off', () => {
    expect(refuseReset(request({ resetEnabled: false }))).toBe(AppErrorCode.RESET_NOT_ENABLED);
  });

  it('refuses when the flag has never been set at all', () => {
    // Which is the state of every deployment until somebody turns it on.
    expect(refuseReset(request({ resetEnabled: undefined }))).toBe(
      AppErrorCode.RESET_NOT_ENABLED,
    );
  });

  it('wants the flag to be a real boolean true, not something truthy', () => {
    for (const nearly of ['true', 1, {}, 'yes']) {
      expect(refuseReset(request({ resetEnabled: nearly }))).toBe(
        AppErrorCode.RESET_NOT_ENABLED,
      );
    }
  });

  it('allows the reset once every gate is satisfied', () => {
    expect(refuseReset(request())).toBeNull();
  });
});

describe('the role check', () => {
  it('refuses everybody who is not a super admin', () => {
    for (const role of [
      UserRole.OPERATOR,
      UserRole.RESTAURANT_OWNER,
      UserRole.RESTAURANT_MANAGER,
      UserRole.RESTAURANT_STAFF,
      UserRole.RESTAURANT_COURIER,
      UserRole.CUSTOMER,
      null,
      undefined,
    ]) {
      expect(refuseReset(request({ role }))).toBe(AppErrorCode.FORBIDDEN);
    }
  });

  it('refuses an operator before it even looks at the flag', () => {
    // An operator with the flag on and the name typed perfectly still gets
    // FORBIDDEN, not RESET_NOT_ENABLED: who you are is decided first.
    expect(refuseReset(request({ role: UserRole.OPERATOR, resetEnabled: true }))).toBe(
      AppErrorCode.FORBIDDEN,
    );
  });
});

describe('the permission', () => {
  it('belongs to the super admin and to nobody else', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[]) {
      expect(hasPermission(role, Permission.PLATFORM_RESET_DATA)).toBe(
        role === UserRole.SUPER_ADMIN,
      );
    }
  });

  it('is not held by an operator, who is otherwise the closest thing to it', () => {
    expect(ROLE_PERMISSIONS[UserRole.OPERATOR]).not.toContain(Permission.PLATFORM_RESET_DATA);
  });
});

describe('the typed confirmation', () => {
  it('refuses anything that is not the platform name', () => {
    for (const typed of ['', 'sil', 'Qapinda?', 'qapind']) {
      expect(refuseReset(request({ confirmation: typed }))).toBe(
        AppErrorCode.RESET_CONFIRMATION_MISMATCH,
      );
    }
  });

  it('accepts the name however the keyboard spelled it', () => {
    for (const typed of ['Qapında', 'qapında', 'QAPINDA', 'Qapinda', '  Qapinda  ']) {
      expect(refuseReset(request({ confirmation: typed }))).toBeNull();
    }
  });

  it('folds the Azerbaijani letters rather than demanding them', () => {
    expect(normaliseConfirmation('Qapında')).toBe(normaliseConfirmation('Qapinda'));
    expect(normaliseConfirmation('ƏŞÇĞÖÜ')).toBe('escgou');
  });
});

describe('the selection itself', () => {
  it('refuses a reset with nothing selected', () => {
    expect(refuseReset(request({ scopes: [] }))).toBe(AppErrorCode.VALIDATION_FAILED);
  });

  it('refuses a payload carrying a scope that does not exist', () => {
    expect(refuseReset(request({ scopes: [ResetScope.ORDERS, 'USERS'] }))).toBe(
      AppErrorCode.VALIDATION_FAILED,
    );
  });
});

describe('batching', () => {
  it('never asks for more than the budget has left', () => {
    expect(chunkSize(1000, 200)).toBe(200);
    expect(chunkSize(60, 200)).toBe(60);
    expect(chunkSize(0, 200)).toBe(0);
    // A budget that has been overspent must not turn into a negative limit,
    // which Firestore would reject outright.
    expect(chunkSize(-5, 200)).toBe(0);
  });

  it('is finished only when every selected collection is empty', () => {
    expect(isResetComplete({ orders: 0, payments: 0 })).toBe(true);
    expect(isResetComplete({ orders: 0, payments: 3 })).toBe(false);
    // Nothing selected is trivially finished, and must not report otherwise.
    expect(isResetComplete({})).toBe(true);
  });

  it('adds a report up the way the screen shows it', () => {
    expect(totalOf({ orders: 12, payments: 4, reviews: 0 })).toBe(16);
    expect(totalOf({})).toBe(0);
  });

  /**
   * The property that matters most: a run that is interrupted and started
   * again finishes the job and does nothing else.
   *
   * Modelled on the shape of the callable's own loop — read a bounded chunk,
   * delete it, stop when the budget is spent — over a store that also holds
   * the collections no scope may touch.
   */
  it('finishes an interrupted run, and a repeat run deletes nothing more', () => {
    const store: Record<string, number> = {
      [COLLECTIONS.orders]: 1103,
      [COLLECTIONS.reviews]: 47,
      // Never selected, and therefore never touched.
      [COLLECTIONS.users]: 260,
      [COLLECTIONS.restaurants]: 12,
      [COLLECTIONS.auditLogs]: 88,
    };

    const scopes = [ResetScope.ORDERS, ResetScope.REVIEWS];
    const budgetPerRun = 500;

    /** One invocation: spends its budget across the selected collections. */
    const invoke = () => {
      let spent = 0;
      const deleted: Record<string, number> = {};

      for (const target of resetTargets(scopes)) {
        let taken = 0;
        while (spent < budgetPerRun) {
          const size = chunkSize(budgetPerRun - spent, RESET_CHUNK);
          const available = Math.min(size, store[target.collection] ?? 0);
          if (available === 0) break;
          store[target.collection] -= available;
          spent += available;
          taken += available;
        }
        deleted[target.collection] = taken;
      }

      const remaining: Record<string, number> = {};
      for (const target of resetTargets(scopes)) {
        remaining[target.collection] = store[target.collection] ?? 0;
      }

      return { deleted, remaining, done: isResetComplete(remaining), spent };
    };

    const first = invoke();
    expect(first.done).toBe(false);
    expect(first.spent).toBe(budgetPerRun);
    expect(first.remaining[COLLECTIONS.orders]).toBe(603);

    const second = invoke();
    expect(second.done).toBe(false);

    const third = invoke();
    expect(third.done).toBe(true);
    expect(third.remaining).toEqual({ [COLLECTIONS.orders]: 0, [COLLECTIONS.reviews]: 0 });

    // Pressing it again on an empty platform is a no-op rather than an error.
    const again = invoke();
    expect(again.spent).toBe(0);
    expect(again.done).toBe(true);
    expect(totalOf(again.deleted)).toBe(0);

    // And through all four runs, nothing outside the selection moved.
    expect(store[COLLECTIONS.users]).toBe(260);
    expect(store[COLLECTIONS.restaurants]).toBe(12);
    expect(store[COLLECTIONS.auditLogs]).toBe(88);
  });
});
