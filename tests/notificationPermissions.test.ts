import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  RESTAURANT_NOTIFICATION_ROLES,
  notificationReadableBy,
  notificationSwitchesFor,
  roleMayReceive,
  switchableTypesFor,
  hasPerTypeSwitches,
  type NotificationRef,
  type NotificationViewer,
} from '../shared/notifications';
import { NotificationType, UserRole } from '../shared/enums';

/**
 * Who may read whose notifications, executed.
 *
 * The table in the brief, as assertions — including every cell whose answer is
 * "no", because those are the cells that protect something. Two of them are the
 * reason this file exists at all: a customer's order notification carries the
 * restaurant that is cooking, and a courier's carries the restaurant they ride
 * for, so a rule written on `restaurantId` alone handed the kitchen both of
 * those inboxes.
 *
 *                          | own | restaurant staff | that courier | other courier | operator | admin
 *  customer's order        | yes |       NO         |     no       |      no       |    no    |  no
 *  restaurant's new order  | yes |      yes         |     no       |      no       |    no    |  no
 *  courier's cancellation  | yes |       NO         |    yes       |      NO       |    no    |  no
 *  operator's alert        | yes |       no         |     no       |      no       |   own    |  no
 *
 * "Own" means the account the notification is addressed to. Platform staff have
 * no clause of their own: an operator and an admin read their own notifications
 * like everybody else, and reach anyone else's through a callable that can
 * decide field by field.
 */

const RESTAURANT_ID = 'restaurant-1';
const OTHER_RESTAURANT_ID = 'restaurant-2';

const viewers = {
  customer: { uid: 'customer-1', role: UserRole.CUSTOMER, restaurantId: null },
  owner: { uid: 'owner-1', role: UserRole.RESTAURANT_OWNER, restaurantId: RESTAURANT_ID },
  manager: { uid: 'manager-1', role: UserRole.RESTAURANT_MANAGER, restaurantId: RESTAURANT_ID },
  staff: { uid: 'staff-1', role: UserRole.RESTAURANT_STAFF, restaurantId: RESTAURANT_ID },
  otherOwner: {
    uid: 'owner-2',
    role: UserRole.RESTAURANT_OWNER,
    restaurantId: OTHER_RESTAURANT_ID,
  },
  courier: { uid: 'courier-1', role: UserRole.RESTAURANT_COURIER, restaurantId: RESTAURANT_ID },
  otherCourier: {
    uid: 'courier-2',
    role: UserRole.RESTAURANT_COURIER,
    restaurantId: RESTAURANT_ID,
  },
  operator: { uid: 'operator-1', role: UserRole.OPERATOR, restaurantId: null },
  admin: { uid: 'admin-1', role: UserRole.SUPER_ADMIN, restaurantId: null },
  guest: { uid: null, role: null, restaurantId: null },
} satisfies Record<string, NotificationViewer>;

/** A customer's "your order is on its way" — carries the cooking restaurant. */
const customerOrder: NotificationRef = {
  userId: viewers.customer.uid,
  role: UserRole.CUSTOMER,
  restaurantId: RESTAURANT_ID,
};

/** "A new order arrived", written to the owner, read by whoever is on shift. */
const restaurantOrder: NotificationRef = {
  userId: viewers.owner.uid,
  role: UserRole.RESTAURANT_OWNER,
  restaurantId: RESTAURANT_ID,
};

/** "This delivery was cancelled" — carries the shop the driver rides for. */
const courierCancellation: NotificationRef = {
  userId: viewers.courier.uid,
  role: UserRole.RESTAURANT_COURIER,
  restaurantId: RESTAURANT_ID,
};

const operatorAlert: NotificationRef = {
  userId: viewers.operator.uid,
  role: UserRole.OPERATOR,
  restaurantId: RESTAURANT_ID,
};

describe("a customer's notification", () => {
  it('is readable by that customer', () => {
    expect(notificationReadableBy(viewers.customer, customerOrder)).toBe(true);
  });

  it('is NOT readable by the restaurant cooking the order', () => {
    // The hole this file was written for. The restaurant id on the document is
    // there so the operator's desk can find it, not so the kitchen can read the
    // customer's inbox.
    for (const viewer of [viewers.owner, viewers.manager, viewers.staff]) {
      expect(notificationReadableBy(viewer, customerOrder)).toBe(false);
    }
  });

  it('is readable by nobody else at all', () => {
    for (const viewer of [
      viewers.otherOwner,
      viewers.courier,
      viewers.otherCourier,
      viewers.operator,
      viewers.admin,
      viewers.guest,
    ]) {
      expect(notificationReadableBy(viewer, customerOrder)).toBe(false);
    }
  });
});

describe("a restaurant's notification", () => {
  it('is readable by every staff role of that restaurant', () => {
    for (const viewer of [viewers.owner, viewers.manager, viewers.staff]) {
      expect(notificationReadableBy(viewer, restaurantOrder)).toBe(true);
    }
  });

  it('is not readable by another restaurant', () => {
    expect(notificationReadableBy(viewers.otherOwner, restaurantOrder)).toBe(false);
  });

  it('is not readable by the couriers who ride for it', () => {
    // A courier is a restaurant account and is deliberately not restaurant
    // staff — the same distinction the orders rule turns on.
    expect(notificationReadableBy(viewers.courier, restaurantOrder)).toBe(false);
  });

  it('is not readable by platform staff', () => {
    for (const viewer of [viewers.operator, viewers.admin, viewers.guest]) {
      expect(notificationReadableBy(viewer, restaurantOrder)).toBe(false);
    }
  });
});

describe("a courier's notification", () => {
  it('is readable by that courier', () => {
    expect(notificationReadableBy(viewers.courier, courierCancellation)).toBe(true);
  });

  it('is NOT readable by the restaurant they ride for', () => {
    // This account rides around town on a personal phone. The kitchen employs
    // the driver; it does not get to read the driver's messages.
    for (const viewer of [viewers.owner, viewers.manager, viewers.staff]) {
      expect(notificationReadableBy(viewer, courierCancellation)).toBe(false);
    }
  });

  it('is NOT readable by another courier at the same restaurant', () => {
    expect(notificationReadableBy(viewers.otherCourier, courierCancellation)).toBe(false);
  });

  it('is not readable by platform staff', () => {
    for (const viewer of [viewers.operator, viewers.admin, viewers.guest]) {
      expect(notificationReadableBy(viewer, courierCancellation)).toBe(false);
    }
  });
});

describe("an operator's alert", () => {
  it('is readable by the operator it was written for', () => {
    expect(notificationReadableBy(viewers.operator, operatorAlert)).toBe(true);
  });

  it('is readable by nobody else, the admin included', () => {
    for (const viewer of [
      viewers.admin,
      viewers.owner,
      viewers.manager,
      viewers.staff,
      viewers.courier,
      viewers.customer,
      viewers.guest,
    ]) {
      expect(notificationReadableBy(viewer, operatorAlert)).toBe(false);
    }
  });
});

describe('an account with no restaurant on it', () => {
  it('cannot read a notification that has no restaurant either', () => {
    // An empty claim must never match an empty field, or every account whose
    // restaurant is unset would read every unattached notification.
    const orphan: NotificationRef = {
      userId: 'someone-else',
      role: UserRole.RESTAURANT_OWNER,
      restaurantId: null,
    };
    const unattached: NotificationViewer = {
      uid: 'owner-3',
      role: UserRole.RESTAURANT_OWNER,
      restaurantId: null,
    };

    expect(notificationReadableBy(unattached, orphan)).toBe(false);
  });
});

describe('the rules file says the same thing', () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  const block = rules.slice(
    rules.indexOf('match /notifications/{notificationId}'),
    rules.indexOf('match /auditLogs/{logId}'),
  );

  it('narrows the restaurant clause to the restaurant roles', () => {
    for (const role of RESTAURANT_NOTIFICATION_ROLES) {
      expect(block).toContain(`'${role}'`);
    }
    // The role a restaurant must never be able to read through this clause.
    expect(block).not.toContain(`'${UserRole.RESTAURANT_COURIER}'`);
  });

  it('requires the tenant claim to be set as well as to match', () => {
    expect(block).toContain("restaurantId() != ''");
    expect(block).toContain('restaurantId() == resource.data.restaurantId');
  });

  it('lets a person write readAt alongside read', () => {
    // Asserted field by field rather than as one literal string: the allowed
    // list has grown since (the delivery log writes `status`,
    // `deliveryStatus`, `deliveredAt`, `title` and `body` through the same
    // clause), and a test that pins the exact spelling fails for a change that
    // is not a regression while saying nothing about the property that matters.
    const allowed = block.slice(block.indexOf('allow update'));
    for (const field of ['read', 'readAt']) {
      expect(allowed).toContain(`'${field}'`);
    }
    expect(allowed).toContain('onlyChanges([');
  });

  it('still lets nobody create or delete one', () => {
    expect(block).toContain('allow create, delete: if false;');
  });
});

describe('per-type switches reach exactly two roles', () => {
  it('is operator and admin, and nobody else', () => {
    expect(hasPerTypeSwitches(UserRole.OPERATOR)).toBe(true);
    expect(hasPerTypeSwitches(UserRole.SUPER_ADMIN)).toBe(true);

    for (const role of [
      UserRole.CUSTOMER,
      UserRole.RESTAURANT_OWNER,
      UserRole.RESTAURANT_MANAGER,
      UserRole.RESTAURANT_STAFF,
      UserRole.RESTAURANT_COURIER,
    ]) {
      expect(hasPerTypeSwitches(role)).toBe(false);
    }
  });

  it('never offers a role a switch for something it cannot receive', () => {
    for (const role of [UserRole.OPERATOR, UserRole.SUPER_ADMIN]) {
      for (const type of switchableTypesFor(role)) {
        expect(roleMayReceive(role, type)).toBe(true);
      }
    }
  });

  it('keeps the admin lane out of an operator list', () => {
    expect(switchableTypesFor(UserRole.OPERATOR)).not.toContain(
      NotificationType.SUPPORT_TICKET_ESCALATED,
    );
    expect(switchableTypesFor(UserRole.SUPER_ADMIN)).toContain(
      NotificationType.SUPPORT_TICKET_ESCALATED,
    );
  });
});

describe("the courier's bell is the courier's alone", () => {
  /*
   * The owner's report: "kuryer hesabında bildirişler kuryere göre ayrı olmalıdır
   * ve qarışmamalıdır". The rule and the predicate above already answer it for
   * the server; what they cannot answer is what the CLIENT subscribes to. A
   * courier whose bell also opened `watchRestaurantNotifications` would be
   * reading the shop's inbox — the query would be refused by the rule, so the
   * symptom would not be another driver's notifications on screen but a bell
   * that reports a broken subscription. Both are bugs, and both start in the
   * same line of `useNotifications`.
   *
   * So this reads the source, the way the rules block above is read: the shop
   * subscription must be gated on `RESTAURANT_NOTIFICATION_ROLES`, and that
   * list must not contain the courier.
   */
  const source = readFileSync('src/components/notifications/useNotifications.ts', 'utf8');
  const service = readFileSync('src/services/notifications.ts', 'utf8');

  it('does not count the courier as restaurant staff', () => {
    expect(RESTAURANT_NOTIFICATION_ROLES).not.toContain(UserRole.RESTAURANT_COURIER);
  });

  it('opens the shop inbox only for a role on that list', () => {
    expect(source).toContain('RESTAURANT_NOTIFICATION_ROLES.includes(role)');
    // And the second listener is guarded by that answer, not by "has a
    // restaurantId" — which every courier has.
    expect(source).toContain('watchesShop');
    expect(source).toMatch(/if \(!isFirebaseConfigured \|\| !uid \|\| !watchesShop/);
  });

  it('filters the shop query by role as well as by restaurant', () => {
    // Firestore judges a list against the QUERY: without the role clause the
    // query asks for every notification carrying this restaurant's id, which
    // includes every courier's, and the rule refuses the whole thing.
    expect(service).toContain("where('restaurantId', '==', restaurantId)");
    expect(service).toContain("where('role', 'in', RESTAURANT_NOTIFICATION_ROLES)");
  });

  it('keeps one courier out of another courier of the same shop', () => {
    expect(notificationReadableBy(viewers.otherCourier, courierCancellation)).toBe(false);
    expect(notificationReadableBy(viewers.courier, courierCancellation)).toBe(true);
  });

  it('never addresses a courier with a type they are not an audience for', () => {
    // A courier has no support lane at all, and no operator alert may reach
    // them: `notify()` checks `roleMayReceive` before it writes, so a type that
    // fails here cannot be written to a courier in the first place.
    for (const type of [
      NotificationType.SUPPORT_MESSAGE,
      NotificationType.NEW_ORDER_FOR_RESTAURANT,
      NotificationType.OPS_ORDER_PROBLEM,
    ]) {
      expect(roleMayReceive(UserRole.RESTAURANT_COURIER, type)).toBe(false);
    }
  });

  it('gives the courier only their own switches on the settings screen', () => {
    for (const row of notificationSwitchesFor(UserRole.RESTAURANT_COURIER)) {
      if (row.kind !== 'type' || !row.type) continue;
      expect(roleMayReceive(UserRole.RESTAURANT_COURIER, row.type)).toBe(true);
    }
  });
});
