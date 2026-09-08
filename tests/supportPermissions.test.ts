import { describe, expect, it } from 'vitest';

import {
  canOpenLane,
  canReachOut,
  lanesHandledBy,
  supportAccess,
  type SupportTicketRef,
  type SupportViewer,
} from '../shared/supportState';
import { SupportLane, SupportTicketStatus, UserRole } from '../shared/enums';
import { Permission, hasPermission } from '../shared/permissions';

/**
 * The permission matrix, executed.
 *
 * The table in the brief is reproduced here as assertions, because a
 * permission table that has never been run is a hope rather than a boundary.
 * Every cell of it appears below, including the ones whose answer is "no" —
 * those are the cells that actually protect something.
 *
 *              | customer | restaurant | courier | operator | admin
 *  own tickets |   yes    |    yes     |   no    |    —     |   —
 *  cust→op     |   open   |    no      |   no    | r/w/close| r/w/close
 *  rest→op     |   no     |    open    |   no    | r/w/close| r/w/close
 *  rest→admin  |   no     |    open    |   no    |   NO     | r/w/close
 *  every ticket|   no     |    no      |   no    |   no     |  yes
 *  escalate    |   no     |    no      |   no    |   yes    |   —
 */

const CUSTOMER_UID = 'customer-1';
const OTHER_CUSTOMER_UID = 'customer-2';
const RESTAURANT_ID = 'restaurant-1';
const OTHER_RESTAURANT_ID = 'restaurant-2';

const viewers = {
  customer: { role: UserRole.CUSTOMER, uid: CUSTOMER_UID, restaurantId: null },
  otherCustomer: { role: UserRole.CUSTOMER, uid: OTHER_CUSTOMER_UID, restaurantId: null },
  owner: { role: UserRole.RESTAURANT_OWNER, uid: 'owner-1', restaurantId: RESTAURANT_ID },
  manager: { role: UserRole.RESTAURANT_MANAGER, uid: 'manager-1', restaurantId: RESTAURANT_ID },
  staff: { role: UserRole.RESTAURANT_STAFF, uid: 'staff-1', restaurantId: RESTAURANT_ID },
  otherOwner: { role: UserRole.RESTAURANT_OWNER, uid: 'owner-2', restaurantId: OTHER_RESTAURANT_ID },
  courier: { role: UserRole.RESTAURANT_COURIER, uid: 'courier-1', restaurantId: RESTAURANT_ID },
  operator: { role: UserRole.OPERATOR, uid: 'operator-1', restaurantId: null },
  admin: { role: UserRole.SUPER_ADMIN, uid: 'admin-1', restaurantId: null },
} satisfies Record<string, SupportViewer>;

const RESTAURANT_ROLE_KEYS = ['owner', 'manager', 'staff'] as const;

function ticket(
  lane: SupportLane,
  overrides: Partial<SupportTicketRef> = {},
): SupportTicketRef {
  return {
    lane,
    status: SupportTicketStatus.OPEN,
    // A customer ticket about an order carries the restaurant too, which is
    // exactly the case the lane check in `supportAccess` has to survive.
    customerId: lane === SupportLane.CUSTOMER_TO_OPERATOR ? CUSTOMER_UID : null,
    restaurantId: RESTAURANT_ID,
    ...overrides,
  };
}

const customerLane = ticket(SupportLane.CUSTOMER_TO_OPERATOR);
const restaurantLane = ticket(SupportLane.RESTAURANT_TO_OPERATOR);
const adminLane = ticket(SupportLane.RESTAURANT_TO_ADMIN);

describe('who may open which lane', () => {
  it('a customer opens their own lane and nothing else', () => {
    expect(canOpenLane(UserRole.CUSTOMER, SupportLane.CUSTOMER_TO_OPERATOR)).toBe(true);
    expect(canOpenLane(UserRole.CUSTOMER, SupportLane.RESTAURANT_TO_OPERATOR)).toBe(false);
    expect(canOpenLane(UserRole.CUSTOMER, SupportLane.RESTAURANT_TO_ADMIN)).toBe(false);
  });

  it('a restaurant opens both of its lanes and never the customer one', () => {
    for (const key of RESTAURANT_ROLE_KEYS) {
      const role = viewers[key].role;
      expect(canOpenLane(role, SupportLane.RESTAURANT_TO_OPERATOR), key).toBe(true);
      expect(canOpenLane(role, SupportLane.RESTAURANT_TO_ADMIN), key).toBe(true);
      expect(canOpenLane(role, SupportLane.CUSTOMER_TO_OPERATOR), key).toBe(false);
    }
  });

  it('a courier opens nothing at all', () => {
    for (const lane of Object.values(SupportLane)) {
      expect(canOpenLane(UserRole.RESTAURANT_COURIER, lane), lane).toBe(false);
    }
  });

  it('platform staff raise no tickets of their own', () => {
    for (const lane of Object.values(SupportLane)) {
      expect(canOpenLane(UserRole.OPERATOR, lane), lane).toBe(false);
      expect(canOpenLane(UserRole.SUPER_ADMIN, lane), lane).toBe(false);
    }

    // What they may do instead is start a restaurant thread themselves, and
    // the callable restricts that to the restaurant → operator lane.
    expect(canReachOut(UserRole.OPERATOR)).toBe(true);
    expect(canReachOut(UserRole.SUPER_ADMIN)).toBe(true);
    expect(canReachOut(UserRole.CUSTOMER)).toBe(false);
    expect(canReachOut(UserRole.RESTAURANT_OWNER)).toBe(false);
    expect(canReachOut(UserRole.RESTAURANT_COURIER)).toBe(false);
  });
});

describe('the customer → operator lane', () => {
  it('is readable and answerable by the customer who raised it', () => {
    expect(supportAccess(viewers.customer, customerLane)).toEqual({
      read: true,
      reply: true,
      close: false,
      escalate: false,
    });
  });

  it('is invisible to every other customer', () => {
    expect(supportAccess(viewers.otherCustomer, customerLane).read).toBe(false);
  });

  it('is invisible to the restaurant named on it', () => {
    // The ticket carries `restaurantId` so an operator can see who cooked the
    // meal. That must not turn into the restaurant reading the customer's side.
    for (const key of RESTAURANT_ROLE_KEYS) {
      expect(supportAccess(viewers[key], customerLane).read, key).toBe(false);
    }
  });

  it('is worked by the operator and by the admin', () => {
    expect(supportAccess(viewers.operator, customerLane)).toEqual({
      read: true,
      reply: true,
      close: true,
      escalate: true,
    });
    expect(supportAccess(viewers.admin, customerLane)).toEqual({
      read: true,
      reply: true,
      close: true,
      escalate: false,
    });
  });
});

describe('the restaurant → operator lane', () => {
  it('is readable and answerable by that restaurant, in all three roles', () => {
    for (const key of RESTAURANT_ROLE_KEYS) {
      expect(supportAccess(viewers[key], restaurantLane), key).toEqual({
        read: true,
        reply: true,
        close: false,
        escalate: false,
      });
    }
  });

  it('is invisible to another restaurant — the tenant boundary', () => {
    expect(supportAccess(viewers.otherOwner, restaurantLane).read).toBe(false);
  });

  it('is invisible to customers', () => {
    expect(supportAccess(viewers.customer, restaurantLane).read).toBe(false);
    expect(supportAccess(viewers.otherCustomer, restaurantLane).read).toBe(false);
  });

  it('is worked by the operator and by the admin', () => {
    expect(supportAccess(viewers.operator, restaurantLane).reply).toBe(true);
    expect(supportAccess(viewers.operator, restaurantLane).close).toBe(true);
    expect(supportAccess(viewers.admin, restaurantLane).close).toBe(true);
  });
});

describe('the restaurant → admin lane', () => {
  it('is readable and answerable by the restaurant that raised it', () => {
    expect(supportAccess(viewers.owner, adminLane).read).toBe(true);
    expect(supportAccess(viewers.owner, adminLane).reply).toBe(true);
  });

  it('is completely invisible to an operator', () => {
    // The whole reason this lane exists is that a restaurant may be
    // complaining about an operator. Not one of the four abilities is granted.
    expect(supportAccess(viewers.operator, adminLane)).toEqual({
      read: false,
      reply: false,
      close: false,
      escalate: false,
    });

    // And the operator's queue never even asks for it.
    expect(lanesHandledBy(UserRole.OPERATOR)).toEqual([
      SupportLane.CUSTOMER_TO_OPERATOR,
      SupportLane.RESTAURANT_TO_OPERATOR,
    ]);
    expect(lanesHandledBy(UserRole.OPERATOR)).not.toContain(SupportLane.RESTAURANT_TO_ADMIN);

    // Which is also a permission the operator does not hold.
    expect(hasPermission(UserRole.OPERATOR, Permission.PLATFORM_ADMIN_SUPPORT)).toBe(false);
    expect(hasPermission(UserRole.SUPER_ADMIN, Permission.PLATFORM_ADMIN_SUPPORT)).toBe(true);
  });

  it('is handled by the admin', () => {
    expect(supportAccess(viewers.admin, adminLane)).toEqual({
      read: true,
      reply: true,
      close: true,
      escalate: false,
    });
    expect(lanesHandledBy(UserRole.SUPER_ADMIN)).toContain(SupportLane.RESTAURANT_TO_ADMIN);
  });

  it('is invisible to customers and to another restaurant', () => {
    expect(supportAccess(viewers.customer, adminLane).read).toBe(false);
    expect(supportAccess(viewers.otherOwner, adminLane).read).toBe(false);
  });
});

describe('couriers have no support at all', () => {
  it('cannot read, reply to, close or escalate a ticket in any lane', () => {
    for (const lane of Object.values(SupportLane)) {
      // Including a ticket belonging to the very restaurant they ride for,
      // which is the case a "restaurant account" check would have let through.
      expect(supportAccess(viewers.courier, ticket(lane)), lane).toEqual({
        read: false,
        reply: false,
        close: false,
        escalate: false,
      });
    }

    expect(lanesHandledBy(UserRole.RESTAURANT_COURIER)).toEqual([]);
  });
});

describe('a closed ticket', () => {
  it('stays readable and stops accepting writes, for every role', () => {
    for (const lane of Object.values(SupportLane)) {
      const closed = ticket(lane, { status: SupportTicketStatus.CLOSED });

      for (const key of ['customer', 'owner', 'operator', 'admin'] as const) {
        const access = supportAccess(viewers[key], closed);
        if (!access.read) continue;
        expect(access.reply, `${key} @ ${lane}`).toBe(false);
        expect(access.close, `${key} @ ${lane}`).toBe(false);
        expect(access.escalate, `${key} @ ${lane}`).toBe(false);
      }
    }
  });

  it('is still readable by the party who raised it — retained, not hidden', () => {
    expect(
      supportAccess(viewers.customer, {
        ...customerLane,
        status: SupportTicketStatus.CLOSED,
      }).read,
    ).toBe(true);
    expect(
      supportAccess(viewers.owner, { ...adminLane, status: SupportTicketStatus.CLOSED }).read,
    ).toBe(true);
  });
});

describe('escalation', () => {
  it('belongs to the operator alone', () => {
    expect(supportAccess(viewers.operator, customerLane).escalate).toBe(true);
    expect(supportAccess(viewers.operator, restaurantLane).escalate).toBe(true);

    // The admin has nobody above them, and a party never escalates.
    expect(supportAccess(viewers.admin, customerLane).escalate).toBe(false);
    expect(supportAccess(viewers.customer, customerLane).escalate).toBe(false);
    expect(supportAccess(viewers.owner, restaurantLane).escalate).toBe(false);
    expect(supportAccess(viewers.courier, restaurantLane).escalate).toBe(false);
  });
});

describe('only the admin sees every ticket', () => {
  it('holds for all three lanes at once', () => {
    const everyLane = Object.values(SupportLane).map((lane) => ticket(lane));

    expect(everyLane.every((entry) => supportAccess(viewers.admin, entry).read)).toBe(true);
    expect(everyLane.every((entry) => supportAccess(viewers.operator, entry).read)).toBe(false);
    expect(everyLane.every((entry) => supportAccess(viewers.owner, entry).read)).toBe(false);
    expect(everyLane.every((entry) => supportAccess(viewers.customer, entry).read)).toBe(false);
    expect(everyLane.some((entry) => supportAccess(viewers.courier, entry).read)).toBe(false);
  });
});

describe('the ticket a customer opened about an order', () => {
  it('does not become readable by the restaurant it names', () => {
    const aboutOrder = ticket(SupportLane.CUSTOMER_TO_OPERATOR, {
      restaurantId: RESTAURANT_ID,
      customerId: CUSTOMER_UID,
    });

    expect(supportAccess(viewers.owner, aboutOrder).read).toBe(false);
    expect(supportAccess(viewers.customer, aboutOrder).read).toBe(true);
    expect(supportAccess(viewers.operator, aboutOrder).read).toBe(true);
  });
});
