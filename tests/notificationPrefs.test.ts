import { describe, expect, it } from 'vitest';

import { NotificationType, UserRole } from '../shared/enums';
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_SPEC,
  defaultNotificationPrefs,
  mayToggleType,
  mergeNotificationPrefs,
  newOrderAlarmEnabled,
  notificationAllowed,
  notificationDedupeKey,
  notificationSoundEnabled,
  notificationSwitchesFor,
  notificationTypeEnabled,
  readNotificationPrefsRequest,
  resolveNotificationPrefs,
  roleMayReceive,
  switchableTypesFor,
  type NotificationPrefs,
  type NotificationPrefsPatch,
  type NotificationSwitch,
} from '../shared/notifications';

/**
 * The preferences, executed.
 *
 * Everything asserted here is something a person would report as a bug in the
 * same three words — "it stopped working" — and none of it is visible in a
 * screenshot. A customer who never asked to stop hearing that their order was
 * accepted; an account created last year finding six switches it never touched
 * silently changed; a kitchen whose orders stopped arriving because somebody
 * turned the sound off. Each of those is one line below.
 */

/** What a brand-new customer's switches say, by the owner's own names. */
const CUSTOMER_DEFAULTS: Array<['marketing' | 'newRestaurants' | 'reviewReminders', boolean]> = [
  ['marketing', false],
  ['newRestaurants', false],
  ['reviewReminders', true],
];

describe('a brand-new customer', () => {
  const fresh = resolveNotificationPrefs(undefined, UserRole.CUSTOMER);

  it('starts campaigns off and the review reminder on', () => {
    for (const [key, expected] of CUSTOMER_DEFAULTS) {
      expect(fresh[key], `${key} should default to ${expected}`).toBe(expected);
    }
  });

  /**
   * The removal, asserted rather than described.
   *
   * The owner's instruction was that a customer is not notified about the
   * progress of their order at all — they follow it on the order screen. The
   * seven types that used to say so were deleted from `NotificationType`, so
   * the strongest form of this test is that the enum does not contain them:
   * a future edit that reintroduces one fails here before it can reach a
   * customer's phone.
   */
  it('has no order-status notification of any kind left in the system', () => {
    const gone = [
      'ORDER_PLACED',
      'ORDER_ACCEPTED',
      'ORDER_REJECTED',
      'ORDER_PREPARING',
      'ORDER_OUT_FOR_DELIVERY',
      'ORDER_DELIVERED',
      'ORDER_DELAYED',
    ];
    const present = gone.filter((type) => Object.hasOwn(NOTIFICATION_SPEC, type));
    expect(present).toEqual([]);
  });

  it('is never in the audience of the one order type that remains', () => {
    // ORDER_CANCELLED survives for the KITCHEN, which may be mid-preparation.
    expect(roleMayReceive(UserRole.CUSTOMER, NotificationType.ORDER_CANCELLED)).toBe(false);
    expect(roleMayReceive(UserRole.RESTAURANT_OWNER, NotificationType.ORDER_CANCELLED)).toBe(true);
  });

  it('is still told about money and about answers to what they asked', () => {
    // What a customer keeps: a refund, a complaint's outcome, a support reply,
    // and the campaigns they switched on themselves.
    expect(notificationAllowed(fresh, NotificationType.REFUND_ISSUED, 'CUSTOMER')).toBe(true);
    expect(notificationAllowed(fresh, NotificationType.COMPLAINT_RESOLVED, 'CUSTOMER')).toBe(true);
    expect(notificationAllowed(fresh, NotificationType.SUPPORT_MESSAGE, 'CUSTOMER')).toBe(true);
    expect(
      notificationAllowed(fresh, NotificationType.NEW_RESTAURANT_AVAILABLE, 'CUSTOMER'),
    ).toBe(false);

    expect(mayToggleType(UserRole.CUSTOMER, NotificationType.REFUND_ISSUED)).toBe(false);
  });

  it('is offered no settings row for a notification that is never sent', () => {
    // A switch for something the system cannot send is worse than no switch:
    // it is a promise the app has already broken.
    const rows = notificationSwitchesFor(UserRole.CUSTOMER);
    for (const row of rows) {
      if (row.kind !== 'type' || !row.type) continue;
      expect(roleMayReceive(UserRole.CUSTOMER, row.type), `${row.key} is not sent`).toBe(true);
    }
    expect(rows.some((row) => row.group === 'orders')).toBe(false);
  });
});

describe('one switch never moves another', () => {
  /*
   * The requirement in the brief, said as an assertion: turning any one of the
   * customer's switches off leaves every other one exactly where it was. It is
   * checked by moving each switch in turn and comparing the whole row, so a
   * future change that couples two of them fails here rather than in somebody's
   * kitchen.
   */
  const switches = notificationSwitchesFor(UserRole.CUSTOMER);

  function snapshot(prefs: Partial<NotificationPrefs>): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const row of switches) {
      if (row.kind === 'type' && row.type) out[row.key] = notificationTypeEnabled(prefs, row.type);
      else if (row.kind === 'category' && row.category) {
        out[row.key] = resolveNotificationPrefs(prefs, UserRole.CUSTOMER)[row.category];
      } else if (row.flag) {
        out[row.key] = resolveNotificationPrefs(prefs, UserRole.CUSTOMER)[row.flag];
      }
    }
    return out;
  }

  const base = resolveNotificationPrefs(undefined, UserRole.CUSTOMER);
  const before = snapshot(base);

  for (const row of switches) {
    it(`moving "${row.key}" leaves the other switches alone`, () => {
      const target = before[row.key];

      const changed: NotificationPrefs =
        row.kind === 'type' && row.type
          ? { ...base, types: { ...base.types, [row.type]: !target } }
          : row.kind === 'category' && row.category
            ? { ...base, [row.category]: !target }
            : { ...base, [row.flag as keyof NotificationPrefs]: !target };

      const after = snapshot(changed);

      expect(after[row.key]).toBe(!target);
      for (const other of switches) {
        if (other.key === row.key) continue;
        // `sound` is the one row that can legitimately silence another control
        // — it is the sound switch — but it must never change what is DELIVERED,
        // which is what this map is made of.
        expect(after[other.key], `${row.key} moved ${other.key}`).toBe(before[other.key]);
      }
    });
  }

  it('turning a notification off does not touch the order it is about', () => {
    /*
     * There is no assertion to make here beyond the shape of the code, and that
     * is the point: `notificationAllowed` takes preferences and a type, and
     * returns whether to WRITE A NOTIFICATION. It has no order in its
     * arguments, cannot reach one, and is called by `notify()` only after the
     * status change has already been decided and committed. The separation is
     * structural rather than checked.
     */
    const off: NotificationPrefs = {
      ...resolveNotificationPrefs(undefined, UserRole.RESTAURANT_OWNER),
      types: { [NotificationType.ORDER_CANCELLED]: false },
    };
    expect(notificationAllowed(off, NotificationType.ORDER_CANCELLED, 'RESTAURANT')).toBe(false);
    // …and the kitchen is still told that a new order arrived, because that
    // does not answer to the switch they moved.
    expect(
      notificationAllowed(off, NotificationType.NEW_ORDER_FOR_RESTAURANT, 'RESTAURANT'),
    ).toBe(true);
  });
});

describe('an account that predates the new fields', () => {
  /*
   * Exactly what a user document written before this work looked like: six
   * flags, a mute list, and no `types` map at all. It must keep every answer it
   * gave, gain the new ones as specified, and never be rewritten to say so.
   */
  const stored = {
    enabled: true,
    sound: false,
    push: true,
    marketing: true,
    reviewReminders: false,
    support: true,
    mutedTypes: [NotificationType.OPS_RESTAURANT_LATE],
  } as unknown as Partial<NotificationPrefs>;

  const resolved = resolveNotificationPrefs(stored, UserRole.OPERATOR);

  it('keeps every preference the person actually set', () => {
    expect(resolved.sound).toBe(false);
    expect(resolved.push).toBe(true);
    expect(resolved.marketing).toBe(true);
    expect(resolved.reviewReminders).toBe(false);
    expect(resolved.support).toBe(true);
  });

  it('still honours the old mute list', () => {
    expect(notificationTypeEnabled(resolved, NotificationType.OPS_RESTAURANT_LATE)).toBe(false);
    expect(notificationAllowed(resolved, NotificationType.OPS_RESTAURANT_LATE, 'OPERATOR')).toBe(
      false,
    );
  });

  it('fills the fields that did not exist yet with the specified defaults', () => {
    expect(resolved.newRestaurants).toBe(DEFAULT_NOTIFICATION_PREFS.newRestaurants);
    expect(resolved.newOrderSound).toBe(DEFAULT_NOTIFICATION_PREFS.newOrderSound);
    expect(resolved.types).toEqual({});
  });

  it('behaves for a customer exactly as a new account does', () => {
    const old = resolveNotificationPrefs(stored, UserRole.CUSTOMER);
    expect(notificationTypeEnabled(old, NotificationType.NEW_RESTAURANT_AVAILABLE)).toBe(false);
    expect(notificationAllowed(old, NotificationType.REFUND_ISSUED, 'CUSTOMER')).toBe(true);
  });

  it('does not lose a stored answer when a newer field is added beside it', () => {
    // The migration rule in one line: the stored object is laid OVER the
    // defaults, never the other way round.
    const explicit = resolveNotificationPrefs(
      { ...stored, types: { [NotificationType.NEW_RESTAURANT_AVAILABLE]: true } },
      UserRole.CUSTOMER,
    );
    expect(notificationTypeEnabled(explicit, NotificationType.NEW_RESTAURANT_AVAILABLE)).toBe(true);
    expect(explicit.sound).toBe(false);
  });
});

describe('the restaurant', () => {
  const fresh = defaultNotificationPrefs(UserRole.RESTAURANT_OWNER);

  it('starts with new orders, cancellations, chat, push and the alarm all on', () => {
    expect(notificationTypeEnabled(fresh, NotificationType.NEW_ORDER_FOR_RESTAURANT)).toBe(true);
    expect(notificationTypeEnabled(fresh, NotificationType.ORDER_CANCELLED)).toBe(true);
    expect(fresh.support).toBe(true);
    expect(fresh.push).toBe(true);
    expect(fresh.newOrderSound).toBe(true);
  });

  it('may switch a cancellation off where the customer may not', () => {
    expect(mayToggleType(UserRole.RESTAURANT_OWNER, NotificationType.ORDER_CANCELLED)).toBe(true);
    expect(mayToggleType(UserRole.CUSTOMER, NotificationType.ORDER_CANCELLED)).toBe(false);

    const muted: NotificationPrefs = {
      ...fresh,
      types: { [NotificationType.ORDER_CANCELLED]: false },
    };
    expect(notificationAllowed(muted, NotificationType.ORDER_CANCELLED, 'RESTAURANT')).toBe(false);
    // The same stored preference, read for the customer's panel, changes
    // nothing: one type, two promises.
    expect(notificationAllowed(muted, NotificationType.ORDER_CANCELLED, 'CUSTOMER')).toBe(true);
  });

  it('turning the sound off silences the sound and NOTHING else', () => {
    const quiet: NotificationPrefs = { ...fresh, newOrderSound: false };

    // No noise…
    expect(newOrderAlarmEnabled(quiet)).toBe(false);
    expect(notificationSoundEnabled(quiet, NotificationType.NEW_ORDER_FOR_RESTAURANT)).toBe(false);

    // …and everything else exactly as it was. The notification is still
    // written, so it is still listed in the bell, still stored as a record, and
    // still eligible for a browser banner.
    expect(notificationAllowed(quiet, NotificationType.NEW_ORDER_FOR_RESTAURANT, 'RESTAURANT'))
      .toBe(true);
    expect(notificationTypeEnabled(quiet, NotificationType.NEW_ORDER_FOR_RESTAURANT)).toBe(true);
    expect(quiet.push).toBe(true);
  });

  it('switching the notification off does not switch the alarm off', () => {
    // The two are separate promises on purpose: the alarm follows the ORDER, so
    // a kitchen that does not want a line in its bell still hears the order.
    const noNotification: NotificationPrefs = {
      ...fresh,
      types: { [NotificationType.NEW_ORDER_FOR_RESTAURANT]: false },
    };
    expect(newOrderAlarmEnabled(noNotification)).toBe(true);
  });
});

describe('one event, one notification', () => {
  /*
   * The server's deduplication is the document id, and the document id is a
   * pure function of the event. So "raised twice" and "raised once" are the same
   * write to the same document — there is no second row for a bell to show and
   * no second sound for a phone to make.
   */
  const key = (type: NotificationType) =>
    notificationDedupeKey({ type, recipientId: 'kitchen-1', subjectId: 'order-9' });

  it('one cancellation raised twice for one order is one notification', () => {
    expect(key(NotificationType.ORDER_CANCELLED)).toBe(key(NotificationType.ORDER_CANCELLED));
  });

  it('but two people, two orders or two kinds are genuinely different events', () => {
    expect(key(NotificationType.ORDER_CANCELLED)).not.toBe(
      key(NotificationType.NEW_ORDER_FOR_RESTAURANT),
    );

    expect(
      notificationDedupeKey({
        type: NotificationType.ORDER_CANCELLED,
        recipientId: 'customer-1',
        subjectId: 'order-9',
      }),
    ).not.toBe(
      notificationDedupeKey({
        type: NotificationType.ORDER_CANCELLED,
        recipientId: 'customer-2',
        subjectId: 'order-9',
      }),
    );

    expect(
      notificationDedupeKey({
        type: NotificationType.ORDER_CANCELLED,
        recipientId: 'customer-1',
        subjectId: 'order-9',
      }),
    ).not.toBe(
      notificationDedupeKey({
        type: NotificationType.ORDER_CANCELLED,
        recipientId: 'customer-1',
        subjectId: 'order-10',
      }),
    );
  });

  it('a legitimate repeat needs an occurrence to say so', () => {
    const monday = notificationDedupeKey({
      type: NotificationType.OPS_RESTAURANT_OFFLINE,
      recipientId: 'operator-1',
      subjectId: 'restaurant-3',
      occurrence: '2026-08-30',
    });
    const tuesday = notificationDedupeKey({
      type: NotificationType.OPS_RESTAURANT_OFFLINE,
      recipientId: 'operator-1',
      subjectId: 'restaurant-3',
      occurrence: '2026-08-31',
    });
    expect(monday).not.toBe(tuesday);
  });
});

describe('the test notification', () => {
  it('cannot be swallowed by a preference', () => {
    // A test that a muted setting could hide would answer "is it broken" with
    // silence — the one answer that cannot be told apart from a real fault.
    const everythingOff: NotificationPrefs = {
      ...resolveNotificationPrefs(undefined, UserRole.RESTAURANT_OWNER),
      enabled: false,
      sound: false,
    };
    expect(
      notificationAllowed(everythingOff, NotificationType.NOTIFICATION_TEST, 'RESTAURANT'),
    ).toBe(true);
    // Its sound still follows the settings, because "does my phone make a
    // noise" is half of what is being tested.
    expect(notificationSoundEnabled(everythingOff, NotificationType.NOTIFICATION_TEST)).toBe(false);
  });
});

describe('turning a switch OFF, and reading it back', () => {
  /*
   * THE BUG THIS EXISTS TO STOP HAPPENING AGAIN
   * -------------------------------------------
   * "bildirişler aktiv deaktiv etdikde xeta yaranır ... deaktiv etmek olmur".
   * Every save of `notificationPrefs` is a read-modify-write, because the whole
   * map is one Firestore field — and a read-modify-write is where `false` gets
   * mistaken for "not provided". The shipped server had done exactly that:
   * `marketing: data.marketing === true` reads an ABSENT field as `false`,
   * which meant every switch a screen did not send was cleared on every save
   * and the per-type map was erased outright. What the person sees is a switch
   * that flips back a moment after they move it.
   *
   * `mergeNotificationPrefs` is the one place that decision is now made, and it
   * is pure, so the whole thing can be executed here rather than tried on a
   * phone. Every role, every switch that role's screen shows, turned off and
   * read back through the same functions the settings screen reads with.
   */
  const ROLES = [
    UserRole.CUSTOMER,
    UserRole.RESTAURANT_OWNER,
    UserRole.RESTAURANT_MANAGER,
    UserRole.RESTAURANT_COURIER,
    UserRole.OPERATOR,
    UserRole.SUPER_ADMIN,
  ];

  /** Where one row of the settings screen currently sits. */
  function valueOf(prefs: NotificationPrefs, row: NotificationSwitch): boolean {
    if (row.kind === 'type' && row.type) return notificationTypeEnabled(prefs, row.type);
    if (row.kind === 'category' && row.category) return prefs[row.category];
    if (row.flag) return prefs[row.flag];
    throw new Error(`switch "${row.key}" moves nothing`);
  }

  /** The patch that row sends when somebody moves it. Exactly what the UI sends. */
  function patchFor(row: NotificationSwitch, next: boolean): NotificationPrefsPatch {
    if (row.kind === 'type' && row.type) return { types: { [row.type]: next } };
    if (row.kind === 'category' && row.category) {
      return { [row.category]: next } as NotificationPrefsPatch;
    }
    return { [row.flag as string]: next } as NotificationPrefsPatch;
  }

  for (const role of ROLES) {
    it(`${role} can switch every one of their notifications off`, () => {
      // Saved one at a time onto the same stored object, which is what actually
      // happens: one row, one write, and the next write starts from the last.
      let stored = resolveNotificationPrefs(undefined, role);
      const stuck: string[] = [];

      for (const row of notificationSwitchesFor(role)) {
        stored = mergeNotificationPrefs(stored, patchFor(row, false), role);
        if (valueOf(stored, row) !== false) stuck.push(row.key);
      }

      expect(stuck, `these would not switch off for ${role}`).toEqual([]);
    });

    it(`${role} can switch them all back on again`, () => {
      let stored = resolveNotificationPrefs(undefined, role);
      for (const row of notificationSwitchesFor(role)) {
        stored = mergeNotificationPrefs(stored, patchFor(row, false), role);
      }

      const stuck: string[] = [];
      for (const row of notificationSwitchesFor(role)) {
        stored = mergeNotificationPrefs(stored, patchFor(row, true), role);
        if (valueOf(stored, row) !== true) stuck.push(row.key);
      }

      expect(stuck, `these would not switch on for ${role}`).toEqual([]);
    });
  }

  it('switching one row off leaves every other row exactly where it was', () => {
    // The same independence the whole file is built on, asserted through the
    // MERGE this time rather than through the readers: the old server's bug was
    // not that it read a switch wrongly, it was that saving one switch wrote
    // the others.
    const role = UserRole.CUSTOMER;
    const rows = notificationSwitchesFor(role);
    const base = resolveNotificationPrefs(undefined, role);

    for (const moved of rows) {
      const after = mergeNotificationPrefs(base, patchFor(moved, false), role);
      for (const other of rows) {
        if (other.key === moved.key) continue;
        expect(valueOf(after, other), `${moved.key} moved ${other.key}`).toBe(
          valueOf(base, other),
        );
      }
    }
  });

  it('an absent field is left alone, and an explicit false is written', () => {
    const stored: NotificationPrefs = {
      ...resolveNotificationPrefs(undefined, UserRole.RESTAURANT_OWNER),
      sound: true,
      newOrderSound: true,
      types: { [NotificationType.ORDER_CANCELLED]: false },
    };

    // One field, sent as false. Everything else is absent and must survive —
    // including the per-type map, which the old code replaced wholesale.
    const next = mergeNotificationPrefs(stored, { sound: false }, UserRole.RESTAURANT_OWNER);

    expect(next.sound).toBe(false);
    expect(next.newOrderSound).toBe(true);
    expect(next.push).toBe(stored.push);
    expect(next.types[NotificationType.ORDER_CANCELLED]).toBe(false);
  });

  it('an empty patch changes nothing at all', () => {
    const stored = resolveNotificationPrefs(
      { marketing: true, sound: false, types: { [NotificationType.NEW_RESTAURANT_AVAILABLE]: true } },
      UserRole.CUSTOMER,
    );
    expect(mergeNotificationPrefs(stored, {}, UserRole.CUSTOMER)).toEqual(stored);
    expect(mergeNotificationPrefs(stored, null, UserRole.CUSTOMER)).toEqual(stored);
  });

  it('does not hand back the stored object for a caller to mutate', () => {
    const stored = resolveNotificationPrefs(undefined, UserRole.CUSTOMER);
    const next = mergeNotificationPrefs(stored, { marketing: true }, UserRole.CUSTOMER);

    next.types[NotificationType.NEW_RESTAURANT_AVAILABLE] = false;
    next.mutedTypes.push(NotificationType.SYSTEM);

    expect(stored.types).toEqual({});
    expect(stored.mutedTypes).toEqual([]);
  });

  it('the per-type list an operator sees can be switched off one kind at a time', () => {
    const role = UserRole.OPERATOR;
    let stored = resolveNotificationPrefs(undefined, role);

    const types = switchableTypesFor(role).filter((type) => mayToggleType(role, type));
    expect(types.length).toBeGreaterThan(0);

    for (const type of types) {
      stored = mergeNotificationPrefs(stored, { types: { [type]: false } }, role);
    }

    for (const type of types) {
      expect(notificationTypeEnabled(stored, type), `${type} would not switch off`).toBe(false);
      expect(notificationAllowed(stored, type, 'OPERATOR')).toBe(false);
    }
  });
});

/**
 * The server's own reading of a settings request, executed.
 *
 * WHY THIS BLOCK EXISTS SEPARATELY FROM THE ONE ABOVE
 * ---------------------------------------------------
 * Everything above drives `mergeNotificationPrefs`, which is the second half of
 * what `updateNotificationPrefs` does. The first half — turning the raw JSON a
 * browser posted into a patch, and refusing what this role may not set — used
 * to live inside the callable, where nothing could reach it. That is exactly
 * where the admin's and the operator's screens differ from everyone else's:
 * they post a `types` map rather than the flat flags, so theirs is the one path
 * a divergence between the screen's rules and the server's would break first.
 *
 * `readNotificationPrefsRequest` is now that first half, shared and pure, so
 * the whole callable can be run here: raw payload in, stored preferences out,
 * for every role and every switch its screen actually draws.
 */
describe('the callable path, from raw payload to stored preferences', () => {
  const ROLES = [
    UserRole.CUSTOMER,
    UserRole.RESTAURANT_OWNER,
    UserRole.RESTAURANT_MANAGER,
    UserRole.RESTAURANT_STAFF,
    UserRole.RESTAURANT_COURIER,
    UserRole.OPERATOR,
    UserRole.SUPER_ADMIN,
  ];

  /**
   * One save, exactly as the callable performs it.
   *
   * Reads the payload with the server's reader and lays the result over what is
   * stored with the server's merge. A refusal is thrown, because that is what
   * `fail` does inside the callable and it is what the screen sees as an error.
   */
  function save(
    stored: NotificationPrefs,
    payload: Record<string, unknown>,
    role: UserRole,
  ): NotificationPrefs {
    const read = readNotificationPrefsRequest(payload, role);
    if (!read.ok) throw new Error(`${read.reason}:${read.field}`);
    return mergeNotificationPrefs(stored, read.patch, role);
  }

  /** What one row of the settings screen posts when somebody moves it. */
  function payloadFor(row: NotificationSwitch, next: boolean): Record<string, unknown> {
    if (row.kind === 'type' && row.type) return { types: { [row.type]: next } };
    if (row.kind === 'category' && row.category) return { [row.category]: next };
    return { [row.flag as string]: next };
  }

  function valueOf(prefs: NotificationPrefs, row: NotificationSwitch): boolean {
    if (row.kind === 'type' && row.type) return notificationTypeEnabled(prefs, row.type);
    if (row.kind === 'category' && row.category) return prefs[row.category];
    if (row.flag) return prefs[row.flag];
    throw new Error(`switch "${row.key}" moves nothing`);
  }

  for (const role of ROLES) {
    it(`${role}: every switch on the screen goes off, and stays off`, () => {
      let stored = resolveNotificationPrefs(undefined, role);
      const rows = notificationSwitchesFor(role);
      // The per-type card the operator and the admin also get, which is the
      // half the flat-flag screens never exercise.
      const types = switchableTypesFor(role).filter((type) => mayToggleType(role, type));

      expect(rows.length + types.length, `${role} has no switches at all`).toBeGreaterThan(0);

      for (const row of rows) stored = save(stored, payloadFor(row, false), role);
      for (const type of types) stored = save(stored, { types: { [type]: false } }, role);

      const stuck: string[] = [];
      for (const row of rows) if (valueOf(stored, row) !== false) stuck.push(row.key);
      for (const type of types) {
        if (notificationTypeEnabled(stored, type) !== false) stuck.push(type);
      }

      expect(stuck, `these would not switch off for ${role}`).toEqual([]);
    });

    it(`${role}: and every one of them comes back on again`, () => {
      let stored = resolveNotificationPrefs(undefined, role);
      const rows = notificationSwitchesFor(role);
      const types = switchableTypesFor(role).filter((type) => mayToggleType(role, type));

      for (const row of rows) stored = save(stored, payloadFor(row, false), role);
      for (const type of types) stored = save(stored, { types: { [type]: false } }, role);

      for (const row of rows) stored = save(stored, payloadFor(row, true), role);
      for (const type of types) stored = save(stored, { types: { [type]: true } }, role);

      const stuck: string[] = [];
      for (const row of rows) if (valueOf(stored, row) !== true) stuck.push(row.key);
      for (const type of types) {
        if (notificationTypeEnabled(stored, type) !== true) stuck.push(type);
      }

      expect(stuck, `these would not switch on for ${role}`).toEqual([]);
    });
  }

  it('the admin posts a types map and the server accepts every key on their screen', () => {
    /*
     * The admin's per-type list is no longer the whole enum.
     *
     * It used to be — the admin was addressable by every notification in the
     * system — and the owner cut it down to the four things that need the
     * person who owns the platform: an application, an escalation, a reported
     * problem, a system warning. What this test now guards is the property
     * that made it worth writing: whatever the screen offers, the server
     * accepts. A row the callable would refuse is a switch that silently does
     * nothing.
     */
    const role = UserRole.SUPER_ADMIN;
    const types = switchableTypesFor(role).filter((type) => mayToggleType(role, type));
    expect(types.length).toBeGreaterThan(0);

    for (const type of types) {
      const read = readNotificationPrefsRequest({ types: { [type]: false } }, role);
      expect(read.ok, `the admin's screen offers ${type} but the server refuses it`).toBe(true);
    }
  });

  it('refuses a type this role was never going to be sent', () => {
    const read = readNotificationPrefsRequest(
      { types: { [NotificationType.OPS_ORDER_PROBLEM]: false } },
      UserRole.CUSTOMER,
    );
    expect(read).toEqual({ ok: false, reason: 'forbidden', field: 'types' });
  });

  it('refuses a type nobody may hide', () => {
    // A refund is the one message a customer is certainly waiting for.
    const read = readNotificationPrefsRequest(
      { types: { [NotificationType.REFUND_ISSUED]: false } },
      UserRole.CUSTOMER,
    );
    expect(read.ok).toBe(false);
  });

  it('refuses a key that is not a notification type, prototype tricks included', () => {
    for (const key of ['NOT_A_TYPE', 'constructor', 'toString']) {
      const read = readNotificationPrefsRequest({ types: { [key]: false } }, UserRole.SUPER_ADMIN);
      expect(read, `"${key}" was accepted as a notification type`).toEqual({
        ok: false,
        reason: 'invalid',
        field: 'types',
      });
    }
  });

  it('leaves out what the screen did not send', () => {
    const read = readNotificationPrefsRequest({ sound: false }, UserRole.CUSTOMER);
    expect(read.ok && read.patch).toEqual({ sound: false });
  });

  it('refuses a mute list from a role that has no per-type switches', () => {
    const read = readNotificationPrefsRequest(
      { mutedTypes: [NotificationType.NEW_RESTAURANT_AVAILABLE] },
      UserRole.CUSTOMER,
    );
    expect(read).toEqual({ ok: false, reason: 'forbidden', field: 'mutedTypes' });
  });

  it('accepts the empty mute list a screen without that control posts', () => {
    const read = readNotificationPrefsRequest({ mutedTypes: [] }, UserRole.CUSTOMER);
    expect(read.ok).toBe(true);
  });

  it('refuses a switch that is not a boolean', () => {
    expect(readNotificationPrefsRequest({ sound: 'yes' }, UserRole.CUSTOMER)).toEqual({
      ok: false,
      reason: 'invalid',
      field: 'sound',
    });
    expect(
      readNotificationPrefsRequest({ types: { ORDER_ACCEPTED: 'no' } }, UserRole.CUSTOMER),
    ).toEqual({ ok: false, reason: 'invalid', field: 'types' });
  });
});
