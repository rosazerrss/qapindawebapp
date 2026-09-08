import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  COURIER_ACTIVE_STATUSES,
  COURIER_HISTORY_STATUSES,
  courierBucket,
  courierDeliveredWell,
  courierMayReadOrder,
  type CourierOrderRef,
  type CourierViewer,
} from '../shared/courier';
import {
  notificationReadableBy,
  notificationSilenceable,
  roleMayReceive,
  switchableTypesFor,
  NOTIFICATION_SPEC,
} from '../shared/notifications';
import { NotificationType, OrderStatus, UserRole } from '../shared/enums';

/**
 * What a courier can reach, executed.
 *
 * The claim being asserted is the one the whole courier app rests on: this
 * account reaches the deliveries written onto it and nothing else — not the
 * colleague on the next moped's run, not another restaurant's orders, not
 * anybody else's history, and not anybody else's notifications. It has to be
 * asserted rather than believed, because the account rides around town on a
 * personal phone that gets lost, sold and handed to the next driver.
 *
 * Three layers are checked here, because all three have to agree:
 *   1. `shared/courier.ts`, the executable copy of the rule's courier clause;
 *   2. `firestore.rules`, the boundary that actually holds;
 *   3. `src/services/courier.ts`, whose queries have to carry the filter the
 *      rule requires — Firestore judges a list against the query, so a query
 *      missing it is refused outright rather than silently widened.
 */

const RESTAURANT = 'restaurant-1';
const OTHER_RESTAURANT = 'restaurant-2';

const courierA: CourierViewer = {
  uid: 'courier-a',
  role: UserRole.RESTAURANT_COURIER,
  restaurantId: RESTAURANT,
};
const courierB: CourierViewer = {
  uid: 'courier-b',
  role: UserRole.RESTAURANT_COURIER,
  restaurantId: RESTAURANT,
};
const courierElsewhere: CourierViewer = {
  uid: 'courier-c',
  role: UserRole.RESTAURANT_COURIER,
  restaurantId: OTHER_RESTAURANT,
};

const ordersOf = (courierId: string | null, restaurantId = RESTAURANT): CourierOrderRef => ({
  restaurantId,
  courierId,
});

describe('an order assigned to one courier', () => {
  it('is readable by that courier', () => {
    expect(courierMayReadOrder(courierA, ordersOf('courier-a'))).toBe(true);
  });

  it('is NOT readable by another courier at the same restaurant', () => {
    expect(courierMayReadOrder(courierB, ordersOf('courier-a'))).toBe(false);
  });

  it('is not readable by a courier at another restaurant', () => {
    expect(courierMayReadOrder(courierElsewhere, ordersOf('courier-a'))).toBe(false);
  });

  it('is not readable by a courier just because the restaurant matches', () => {
    // Working for the shop buys nothing. Only being written on the order does.
    expect(courierMayReadOrder(courierB, ordersOf(null))).toBe(false);
    expect(courierMayReadOrder(courierB, ordersOf('courier-a', OTHER_RESTAURANT))).toBe(false);
  });
});

describe('an order with nobody on it', () => {
  it('is readable by no courier at all', () => {
    expect(courierMayReadOrder(courierA, ordersOf(null))).toBe(false);
    expect(courierMayReadOrder(courierB, ordersOf(null))).toBe(false);
  });

  it('does not match an account whose own uid is missing', () => {
    const signedOut: CourierViewer = {
      uid: null,
      role: UserRole.RESTAURANT_COURIER,
      restaurantId: RESTAURANT,
    };
    expect(courierMayReadOrder(signedOut, ordersOf(null))).toBe(false);
  });
});

describe('the courier clause answers only about couriers', () => {
  it('says no for every other role, whatever the order says', () => {
    for (const role of Object.values(UserRole)) {
      if (role === UserRole.RESTAURANT_COURIER) continue;
      expect(
        courierMayReadOrder({ uid: 'courier-a', role, restaurantId: RESTAURANT }, ordersOf('courier-a')),
      ).toBe(false);
    }
  });
});

describe("a courier's history", () => {
  it('is built from statuses that do not overlap the active list', () => {
    const overlap = COURIER_ACTIVE_STATUSES.filter((status) =>
      COURIER_HISTORY_STATUSES.includes(status),
    );
    expect(overlap).toEqual([]);
  });

  it('fits in one Firestore `in` filter', () => {
    // Ten is the limit. A seventh ending added without splitting the query
    // would fail at the moment a driver opened their history, not here.
    expect(COURIER_HISTORY_STATUSES.length).toBeLessThanOrEqual(10);
    expect(COURIER_ACTIVE_STATUSES.length).toBeLessThanOrEqual(10);
  });

  it('files a delivered order as done and a cancelled one as not', () => {
    expect(courierBucket(OrderStatus.DELIVERED)).toBe('history');
    expect(courierBucket(OrderStatus.CANCELLED)).toBe('history');
    expect(courierBucket(OrderStatus.OUT_FOR_DELIVERY)).toBe('active');
    expect(courierDeliveredWell(OrderStatus.COMPLETED)).toBe(true);
    expect(courierDeliveredWell(OrderStatus.DELIVERY_FAILED)).toBe(false);
    expect(courierDeliveredWell(OrderStatus.CANCELLED)).toBe(false);
  });

  it('never shows an order the restaurant has not accepted yet', () => {
    expect(courierBucket(OrderStatus.PLACED)).toBeNull();
    expect(courierBucket(OrderStatus.PENDING_PAYMENT)).toBeNull();
  });
});

describe("a courier's notifications", () => {
  const notificationFor = (uid: string) => ({
    userId: uid,
    role: UserRole.RESTAURANT_COURIER,
    restaurantId: RESTAURANT,
  });

  it('are readable by that courier', () => {
    expect(notificationReadableBy(courierA, notificationFor('courier-a'))).toBe(true);
  });

  it('are NOT readable by another courier at the same restaurant', () => {
    expect(notificationReadableBy(courierB, notificationFor('courier-a'))).toBe(false);
  });

  it('are NOT readable by the restaurant they ride for', () => {
    expect(
      notificationReadableBy(
        { uid: 'owner-1', role: UserRole.RESTAURANT_OWNER, restaurantId: RESTAURANT },
        notificationFor('courier-a'),
      ),
    ).toBe(false);
  });
});

describe('a courier is never sent a chat notification', () => {
  it('is not in the audience of any support type', () => {
    for (const type of [
      NotificationType.SUPPORT_MESSAGE,
      NotificationType.SUPPORT_TICKET_UPDATED,
      NotificationType.SUPPORT_TICKET_ESCALATED,
    ]) {
      expect(roleMayReceive(UserRole.RESTAURANT_COURIER, type)).toBe(false);
      expect(NOTIFICATION_SPEC[type].audience).not.toContain('COURIER');
    }
  });

  it('is offered no support switch in its settings', () => {
    const types = switchableTypesFor(UserRole.RESTAURANT_COURIER);
    expect(types).not.toContain(NotificationType.SUPPORT_MESSAGE);
    expect(types).not.toContain(NotificationType.SUPPORT_TICKET_UPDATED);
    expect(types).not.toContain(NotificationType.SUPPORT_TICKET_ESCALATED);
  });
});

describe('the three notifications a delivery actually needs', () => {
  it('reach a courier and cannot be hidden by a setting', () => {
    for (const type of [
      NotificationType.COURIER_ASSIGNED,
      NotificationType.COURIER_DELIVERY_UPDATED,
      NotificationType.COURIER_ORDER_CANCELLED,
    ]) {
      expect(roleMayReceive(UserRole.RESTAURANT_COURIER, type)).toBe(true);
      expect(notificationSilenceable(type)).toBe(false);
    }
  });

  it('reach nobody else', () => {
    for (const role of Object.values(UserRole)) {
      if (role === UserRole.RESTAURANT_COURIER || role === UserRole.SUPER_ADMIN) continue;
      expect(roleMayReceive(role, NotificationType.COURIER_DELIVERY_UPDATED)).toBe(false);
    }
  });
});

describe('the rules file says the same thing', () => {
  const rules = readFileSync('firestore.rules', 'utf8');

  it('lets a courier reach an order only by being written on it', () => {
    // Both spellings of the same predicate: `get` is answered against the
    // document and has to survive an order with no courier at all; `list` is
    // answered against the query and has to be a plain equality Firestore can
    // match to a `where`.
    expect(rules).toContain("uid() == resource.data.courier.id");
    expect(rules).toContain("resource.data.get('courier', null) != null");
  });

  it('keeps the courier out of the three roles that act for a restaurant', () => {
    const staff = rules.match(/function isRestaurantStaff\(\) \{[\s\S]*?\}/)?.[0] ?? '';
    expect(staff).not.toContain('RESTAURANT_COURIER');
    expect(staff).toContain('RESTAURANT_OWNER');
  });

  it('gives a courier no clause anywhere at all — support included', () => {
    // A courier has no support lane in either direction, so the role never
    // needs naming in the rules. If it ever appears, something granted it
    // access to a collection this account has no business in.
    expect(rules).not.toMatch(/'RESTAURANT_COURIER'/);
  });

  it("keeps the restaurant out of a driver's inbox", () => {
    expect(rules).toContain("resource.data.role in [");
  });
});

describe('the courier service asks the questions the rule can answer', () => {
  const source = readFileSync('src/services/courier.ts', 'utf8');

  it('filters every order query on the signed-in courier', () => {
    const queries = source.match(/collection\(db, COLLECTIONS\.orders\)[\s\S]*?\)/g) ?? [];
    expect(queries.length).toBeGreaterThan(1);
    for (const query of queries) {
      expect(query).toContain("where('courier.id', '==', courierId)");
    }
  });

  it('sorts the history on a field every order has', () => {
    // Firestore drops documents that have no value for the sorted field, and
    // `completedAt` is null on a cancelled order — sorting on it would have
    // hidden exactly the half of the history this screen exists to show.
    expect(source).toContain("orderBy('placedAt', 'desc')");
    expect(source).not.toContain("orderBy('completedAt'");
  });
});

describe('both courier queries have an index', () => {
  const declared = (
    JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as {
      indexes: Array<{
        collectionGroup: string;
        fields: Array<{ fieldPath: string; order?: string }>;
      }>;
    }
  ).indexes;

  it('declares courier.id + status + placedAt DESC on orders', () => {
    const match = declared.find(
      (index) =>
        index.collectionGroup === 'orders' &&
        index.fields.length === 3 &&
        index.fields[0].fieldPath === 'courier.id' &&
        index.fields[1].fieldPath === 'status' &&
        index.fields[2].fieldPath === 'placedAt' &&
        index.fields[2].order === 'DESCENDING',
    );
    // One index serves the active list and the history alike: they differ only
    // in which statuses the `in` filter names.
    expect(match).toBeDefined();
  });
});
