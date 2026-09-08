/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — What a notification is, who may receive it, and what it may do.
 *
 * ONE TABLE, NOT A HUNDRED CALL SITES
 * -----------------------------------
 * Every question the notification system asks about a type — is it loud, is it
 * urgent, may a setting hide it, whose panel does it belong in — is answered by
 * `NOTIFICATION_SPEC` below and by nothing else. The alternative was tried and
 * is what this file exists to prevent: an exception written into the server, a
 * different exception written into the bell, and a courier who stops being told
 * that the order in their bag was cancelled because somebody muted "orders".
 *
 * SOUND AND VISIBILITY ARE DIFFERENT QUESTIONS
 * --------------------------------------------
 * Sound is always a preference. Anybody may work in silence, and a phone that
 * beeps in a customer's kitchen at midnight teaches them to turn the app off
 * altogether. Visibility is not always a preference: `silenceable: false` marks
 * the notifications that must reach the panel whatever the settings say, and a
 * cancelled delivery is the example the rule was written for — a courier who
 * muted their new-order sound is still driving to that address.
 *
 * EVERY SWITCH IS INDEPENDENT OF EVERY OTHER SWITCH
 * -------------------------------------------------
 * A person who turns one notification off has said one thing about one
 * notification. It must not quietly take a second one with it, and it must not
 * touch the order at all — the status machine never reads a preference, and
 * nothing in this file can change what an order does. So the per-type answers
 * live in `NotificationPrefs.types`, one key per type, and
 * `notificationTypeEnabled` answers each of them without looking at any other.
 *
 * WHAT A CUSTOMER IS AND IS NOT SENT
 * ----------------------------------
 * Not the progress of their order. There are no order-status notifications for
 * a customer at all — see the table below — because the order screen shows the
 * status live and is where the customer is already looking. Campaigns, new
 * restaurants, a support reply, a complaint's outcome and a refund are what
 * reaches a customer's bell.
 *
 * WHAT A ROLE'S SETTINGS SCREEN SHOWS IS ALSO DECIDED HERE
 * -------------------------------------------------------
 * `notificationSwitchesFor` is the list of rows, by the owner's own names for
 * them — `orderAccepted`, `newOrderSound`, `marketingOffers` — grouped into the
 * three cards the screen draws. Written here rather than in the component
 * because the callable validates against the same list: a switch no screen
 * shows is a switch no server accepts.
 *
 * DEFAULTS BELONG NEXT TO THE THING THEY DESCRIBE
 * ----------------------------------------------
 * Whether a type is on for a brand-new account is `defaultOn` on that type's
 * own row, not a second table somewhere else that can fall out of step. An
 * account that has never touched a switch stores nothing for it, which is what
 * lets a field added today behave correctly for an account created last year
 * without rewriting a single document — see `resolveNotificationPrefs`.
 *
 * Kept in `/shared` rather than in the UI because the server is what decides —
 * a preference honoured only by the screen that shows it is not a preference.
 */

import { NotificationType, UserRole } from './enums';

// ---------------------------------------------------------------------------
// Who a notification is for
// ---------------------------------------------------------------------------

/**
 * The five panels, which are also the five rows of the permission matrix.
 *
 * Coarser than `UserRole` on purpose: an owner, a manager and a kitchen account
 * all read the same restaurant notifications, and splitting them here would
 * mean writing the same three entries into every row of the table below.
 */
export type NotificationAudience =
  | 'CUSTOMER'
  | 'RESTAURANT'
  | 'COURIER'
  | 'OPERATOR'
  | 'ADMIN';

/** Which panel a role works in. A courier is deliberately not RESTAURANT. */
export function roleAudience(role: UserRole | null | undefined): NotificationAudience | null {
  switch (role) {
    case UserRole.CUSTOMER:
      return 'CUSTOMER';
    case UserRole.RESTAURANT_OWNER:
    case UserRole.RESTAURANT_MANAGER:
    case UserRole.RESTAURANT_STAFF:
      return 'RESTAURANT';
    case UserRole.RESTAURANT_COURIER:
      return 'COURIER';
    case UserRole.OPERATOR:
      return 'OPERATOR';
    case UserRole.SUPER_ADMIN:
      return 'ADMIN';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// How loud, how urgent
// ---------------------------------------------------------------------------

/**
 * How much of the person's attention this is allowed to take.
 *
 * CRITICAL is not a synonym for "important". It means somebody is about to do
 * the wrong thing — drive to an address for an order that no longer exists,
 * leave a reported problem sitting unread — and it is the only level that
 * survives every switch in the settings screen.
 */
export const NotificationPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type NotificationPriority =
  (typeof NotificationPriority)[keyof typeof NotificationPriority];

/**
 * The two sounds.
 *
 * "A distinct sound for new and important events" — so there are exactly two,
 * and the difference between them is audible from the next room. More than two
 * would be a language nobody learns.
 */
export type NotificationTone = 'chime' | 'alert';

export interface NotificationSpec {
  priority: NotificationPriority;
  /** Whether this type makes a sound at all, before any preference is read. */
  sound: boolean;
  /**
   * Who, if anybody, may stop this reaching the panel.
   *
   * `false` means the notification is delivered and displayed whatever the
   * preferences say. Its *sound* can still be switched off — see the note at
   * the top of this file.
   *
   * A LIST rather than a bare boolean, because one type can be two different
   * promises to two different people. `ORDER_CANCELLED` is the example the
   * shape was written for: the restaurant asked to be able to switch it off,
   * and the customer whose dinner was cancelled must be told whatever their
   * settings say. One row of the table, two answers, and neither of them
   * written into a call site.
   */
  silenceable: boolean | NotificationAudience[];
  /**
   * Whether a switchable type is ON for an account that has never touched it.
   *
   * Only consulted for the types somebody may actually switch; a type nobody
   * can hide is always on. The owner's list is what these values are: a new
   * customer is told nothing until they ask for it, which is now the whole of
   * the rule rather than the exception to it.
   *
   * Absent means on, which is the safer default for anything added later —
   * a notification too many is the cheaper failure.
   */
  defaultOn?: boolean;
  /** The category switch, for the types that answer to one. */
  category?: NotificationCategory;
  /** Whose panels this type may ever appear in. The admin sees everything. */
  audience: NotificationAudience[];
}

/** The category switches, each of which covers a family rather than a type. */
export type NotificationCategory =
  | 'marketing'
  | 'reviewReminders'
  | 'support'
  | 'newRestaurants';

const CUSTOMER_ONLY: NotificationAudience[] = ['CUSTOMER'];
const RESTAURANT_ONLY: NotificationAudience[] = ['RESTAURANT'];
const COURIER_ONLY: NotificationAudience[] = ['COURIER'];
const OPERATIONS: NotificationAudience[] = ['OPERATOR'];
const ADMIN_ONLY: NotificationAudience[] = ['ADMIN'];

/**
 * Every notification type, and everything the system needs to know about it.
 *
 * A new type that is not listed here is a compile error, which is the point:
 * the table cannot fall behind the enum, so "we forgot to decide whether it
 * rings" is not a state this system can be in.
 */
export const NOTIFICATION_SPEC: Record<NotificationType, NotificationSpec> = {
  // --- The order -----------------------------------------------------------
  //
  // WHY THERE IS ONLY ONE ENTRY HERE
  // --------------------------------
  // There were eight, seven of them addressed to the customer: placed,
  // accepted, rejected, preparing, on the way, delivered, late. The owner
  // removed all seven. A customer follows their order on the order screen —
  // which updates live and is where they are already looking — and an app that
  // buzzes at every step of a delivery is an app whose notifications get
  // switched off at the operating system, taking the messages that matter with
  // them. They are gone from `NotificationType` itself, not merely defaulted
  // off, so that no call site can start sending one again by accident.
  //
  // What survives is the copy addressed to the KITCHEN, because a restaurant
  // that is already cooking has to hear that the order was called off.

  [NotificationType.ORDER_CANCELLED]: {
    priority: NotificationPriority.CRITICAL,
    sound: true,
    // The restaurant may switch this off — it is a line in their own queue and
    // they usually cancelled it themselves.
    silenceable: RESTAURANT_ONLY,
    defaultOn: true,
    audience: RESTAURANT_ONLY,
  },

  /**
   * A delivery came back.
   *
   * NOT silenceable, unlike the cancellation above, and the difference is who
   * caused it. A restaurant usually cancels its own orders, so hiding that
   * notification hides nothing it did not already know. A failed delivery is
   * the opposite: it is reported by a driver out in the city, about food the
   * kitchen made and a customer who has not eaten, and the kitchen is the last
   * to hear. Silencing that means finding out tomorrow.
   */
  [NotificationType.RESTAURANT_DELIVERY_FAILED]: {
    priority: NotificationPriority.CRITICAL,
    sound: true,
    silenceable: [],
    defaultOn: true,
    audience: RESTAURANT_ONLY,
  },

  // --- The kitchen --------------------------------------------------------

  [NotificationType.NEW_ORDER_FOR_RESTAURANT]: {
    priority: NotificationPriority.CRITICAL,
    sound: true,
    /*
     * Switchable, which it did not used to be.
     *
     * The old argument was that a restaurant hiding this would be hiding the
     * reason its orders keep expiring. That argument no longer holds, and the
     * reason it no longer holds is `NewOrderAlarm`: the panel's new-order
     * column and its alarm are driven by the ORDER — every order sitting in
     * PLACED — and not by this notification at all. So a kitchen that switches
     * the notification off still sees the order, still hears the alarm unless
     * they switch that off too, and still watches the same countdown.
     */
    silenceable: RESTAURANT_ONLY,
    defaultOn: true,
    audience: RESTAURANT_ONLY,
  },
  [NotificationType.RESTAURANT_APPROVED]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: false,
    audience: RESTAURANT_ONLY,
  },
  [NotificationType.RESTAURANT_REJECTED]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: false,
    audience: RESTAURANT_ONLY,
  },
  /*
   * "A restaurant has invited you to join its team."
   *
   * Addressed to the PERSON, and at the moment it is sent that person is still
   * a customer — so the audience is CUSTOMER, not RESTAURANT. Getting this
   * wrong would silence the one message the whole consent flow depends on.
   *
   * Not silenceable: it asks for a decision about the invited person's own
   * account. Somebody who has muted marketing has not agreed to be enrolled
   * without being told.
   */
  [NotificationType.RESTAURANT_INVITE]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: false,
    audience: CUSTOMER_ONLY,
  },
  /** The answer, back to the restaurant that asked. One type per outcome. */
  [NotificationType.RESTAURANT_INVITE_ACCEPTED]: {
    priority: NotificationPriority.NORMAL,
    sound: false,
    silenceable: false,
    audience: RESTAURANT_ONLY,
  },
  [NotificationType.RESTAURANT_INVITE_DECLINED]: {
    priority: NotificationPriority.NORMAL,
    sound: false,
    silenceable: false,
    audience: RESTAURANT_ONLY,
  },
  /** One of the four things the admin kept. Nobody else is told. */
  [NotificationType.RESTAURANT_APPLICATION_RECEIVED]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: true,
    defaultOn: true,
    audience: ADMIN_ONLY,
  },
  [NotificationType.COMPLAINT_FILED]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: false,
    // The restaurant's, not the operator's: the operator's copy of "somebody
    // reported a problem with an order" is OPS_ORDER_PROBLEM, raised by the
    // same call site, and two rows for one complaint is how a queue stops
    // being read.
    audience: RESTAURANT_ONLY,
  },
  [NotificationType.COMPLAINT_RESOLVED]: {
    priority: NotificationPriority.NORMAL,
    sound: false,
    silenceable: false,
    audience: ['CUSTOMER', 'RESTAURANT'],
  },

  // --- Support ------------------------------------------------------------

  // The operator keeps this one, because a ticket nobody opens is a customer
  // waiting on a queue that is not being worked. It is the operator's only
  // support notification: the replies and the status changes on a ticket they
  // are already holding are visible in the ticket itself.
  [NotificationType.SUPPORT_MESSAGE]: {
    priority: NotificationPriority.NORMAL,
    sound: true,
    silenceable: true,
    category: 'support',
    audience: ['CUSTOMER', 'RESTAURANT', 'OPERATOR'],
  },
  // A ticket's status changing is the same conversation as a reply to it, so it
  // answers to the same switch. Somebody who turned support notifications off
  // did not mean "except the ones that say RESOLVED".
  //
  // Not the operator's: they are the ones changing the status.
  [NotificationType.SUPPORT_TICKET_UPDATED]: {
    priority: NotificationPriority.NORMAL,
    sound: false,
    silenceable: true,
    category: 'support',
    audience: ['CUSTOMER', 'RESTAURANT'],
  },
  [NotificationType.SUPPORT_TICKET_ESCALATED]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: true,
    category: 'support',
    // The admin lane exists so a restaurant can complain about an operator.
    // An operator must not be able to see it, so it is not in their audience.
    audience: ['ADMIN'],
  },
  /**
   * Money going back to the customer.
   *
   * Its own type rather than a SYSTEM message, because SYSTEM is the generic
   * platform announcement: it is silenceable, and its category is `marketing`,
   * which is off by default. A refund routed through it would have been written
   * and then withheld from almost everybody — the one notification a person is
   * certainly waiting for, delivered to nobody.
   */
  [NotificationType.REFUND_ISSUED]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: false,
    audience: CUSTOMER_ONLY,
  },
  /*
   * An apology the person did not ask for and cannot be expected to find.
   *
   * Not silenceable, for the same reason a refund is not: this is the platform
   * telling somebody what it did about their complaint. A coupon nobody is told
   * about is a coupon nobody uses, which makes the apology worthless and the
   * restaurant's money spent for nothing.
   */
  [NotificationType.COMPENSATION_COUPON]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: false,
    audience: CUSTOMER_ONLY,
  },

  /**
   * The platform's own announcement — a campaign to a customer, a system
   * warning to the admin.
   *
   * The operator is no longer in the audience: an announcement is something to
   * read, and the operator's panel is a list of things to DO. The admin is,
   * because a warning about the platform is the admin's business by
   * definition.
   */
  [NotificationType.SYSTEM]: {
    priority: NotificationPriority.LOW,
    sound: false,
    silenceable: true,
    category: 'marketing',
    audience: ['CUSTOMER', 'RESTAURANT', 'COURIER', 'ADMIN'],
  },

  /**
   * A new restaurant in the customer's area.
   *
   * Its own category rather than `marketing`, because they are two different
   * questions: somebody may want to hear that the place across the road has
   * opened without wanting a coupon every Friday. Off for a new account —
   * nobody opts into either of these by accident.
   */
  [NotificationType.NEW_RESTAURANT_AVAILABLE]: {
    priority: NotificationPriority.LOW,
    sound: false,
    silenceable: true,
    defaultOn: false,
    category: 'newRestaurants',
    audience: CUSTOMER_ONLY,
  },

  /*
   * The courier has left with the food.
   *
   * Not silenceable, and that is the whole reason it is the one status message
   * that survived: it is not news, it is a request to be near the door. A
   * customer who muted it and then missed the knock has been failed by the
   * setting, not served by it. Its SOUND still follows the settings, because
   * working in silence is always allowed.
   */
  [NotificationType.ORDER_ON_THE_WAY]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: false,
    audience: CUSTOMER_ONLY,
  },

  /*
   * A favour being asked, so it is quiet, switchable, and off unless wanted.
   *
   * Sent once per order and never repeated. A second "how was it?" about a
   * dinner somebody has already decided not to rate is the reason people mute
   * an app for good.
   */
  [NotificationType.REVIEW_REMINDER]: {
    priority: NotificationPriority.LOW,
    sound: false,
    silenceable: true,
    defaultOn: false,
    category: 'reviewReminders',
    audience: CUSTOMER_ONLY,
  },

  /**
   * The one notification somebody asked for, so it is the one nothing may hide.
   *
   * A test that a muted preference could swallow would answer the question it
   * was pressed to ask with silence, which is exactly the outcome it exists to
   * distinguish from a broken system. Its SOUND still follows the settings,
   * because "does my phone make a noise" is half of what is being tested.
   */
  [NotificationType.NOTIFICATION_TEST]: {
    priority: NotificationPriority.NORMAL,
    sound: true,
    silenceable: false,
    audience: ['CUSTOMER', 'RESTAURANT', 'COURIER', 'OPERATOR', 'ADMIN'],
  },

  // --- The operator's desk ------------------------------------------------
  //
  // Eight, and every one of them is a situation that needs an operator to DO
  // something: a kitchen that has not answered, a refusal, a late order, a
  // cancellation, a reported problem, a shop shut during its own opening
  // hours, a courier out of contact, a delivery nobody has picked up.
  //
  // OPS_NEW_ORDER is gone. It fired for every order that was going perfectly
  // well, which is what turns a queue into wallpaper; the desk has a live
  // order list for that. All eight ring, all but one may be switched off per
  // type, and the exception is the one that says a human being has reported
  // that something went wrong.

  [NotificationType.OPS_RESTAURANT_NO_RESPONSE]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: true,
    audience: OPERATIONS,
  },
  [NotificationType.OPS_RESTAURANT_REJECTED]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: true,
    audience: OPERATIONS,
  },
  [NotificationType.OPS_RESTAURANT_LATE]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: true,
    audience: OPERATIONS,
  },
  [NotificationType.OPS_ORDER_CANCELLED]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: true,
    audience: OPERATIONS,
  },
  [NotificationType.OPS_ORDER_PROBLEM]: {
    priority: NotificationPriority.CRITICAL,
    sound: true,
    // The one operational alert that cannot be switched off. Everything else
    // here is the platform noticing something; this is a person saying so.
    silenceable: false,
    // The admin's too, and the only OPS alert that is: "a critical problem" is
    // on the short list the admin kept, and a reported problem is what that
    // means in this system.
    audience: ['OPERATOR', 'ADMIN'],
  },
  [NotificationType.OPS_RESTAURANT_OFFLINE]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: true,
    audience: OPERATIONS,
  },
  [NotificationType.OPS_COURIER_OFFLINE]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: true,
    audience: OPERATIONS,
  },
  [NotificationType.OPS_COURIER_NOT_ACCEPTED]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: true,
    audience: OPERATIONS,
  },

  // --- The courier's phone ------------------------------------------------
  //
  // Four of the five cannot be hidden: they are the job. The sound can be, and
  // that is the switch a driver actually wants — a phone that chirps in traffic
  // is a phone that gets put in a pocket and ignored.

  [NotificationType.COURIER_ASSIGNED]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: false,
    audience: COURIER_ONLY,
  },
  [NotificationType.COURIER_ORDER_READY]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    silenceable: false,
    audience: COURIER_ONLY,
  },
  [NotificationType.COURIER_DELIVERY_UPDATED]: {
    priority: NotificationPriority.HIGH,
    sound: true,
    // Not silenceable, for the same reason the cancellation is not: a driver
    // whose delivery has changed hands or changed details is still riding
    // towards the version of it they remember.
    silenceable: false,
    audience: COURIER_ONLY,
  },
  [NotificationType.COURIER_DELIVERY_LATE]: {
    priority: NotificationPriority.NORMAL,
    sound: true,
    // The only courier notification a driver may switch off entirely. It tells
    // them something they can already see on the clock.
    silenceable: true,
    audience: COURIER_ONLY,
  },
  [NotificationType.COURIER_ORDER_CANCELLED]: {
    priority: NotificationPriority.CRITICAL,
    sound: true,
    // The rule this whole distinction exists for. A courier who muted their
    // new-order sound is still driving to that address.
    silenceable: false,
    audience: COURIER_ONLY,
  },
};

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export interface NotificationPrefs {
  /** The master switch. Reaches only the silenceable types. */
  enabled: boolean;
  /** Whether anything makes a sound. Reaches every type, including critical. */
  sound: boolean;
  /** Whether the browser may raise a system notification while backgrounded. */
  push: boolean;
  /** Coupons and campaigns. Off by default — nobody opts in by accident. */
  marketing: boolean;
  /** "A new place opened near you". Off by default, for the same reason. */
  newRestaurants: boolean;
  /** "Rate your order" after delivery. */
  reviewReminders: boolean;
  /** Support replies and ticket status changes — the restaurant's chat lane. */
  support: boolean;
  /**
   * The repeating alarm a restaurant hears while an order sits unanswered.
   *
   * Its own field rather than a per-type sound, because it is not the
   * notification's sound: the alarm is bound to the ORDER, it repeats until the
   * order leaves PLACED, and it goes on doing that whether or not the kitchen
   * has switched the new-order notification off. Switching this off silences
   * the alarm and changes nothing else — the order still arrives, the column
   * still counts it, the notification is still written and still pushed.
   */
  newOrderSound: boolean;
  /**
   * Individual types this account has switched off, kept for accounts that
   * predate `types`.
   *
   * Still honoured on read — an operator who muted six kinds last month must
   * not find them all back on — and never written any more. `types` is what a
   * settings screen writes now, because a list of what is OFF cannot express a
   * type that is off by default and has been switched ON.
   */
  mutedTypes: NotificationType[];
  /**
   * Every per-type switch this account has actually touched.
   *
   * Sparse on purpose, and that sparseness is the whole migration story: a key
   * that is absent means "this account has never had an opinion", which
   * `notificationTypeEnabled` answers with the type's own `defaultOn`. So a
   * user document written a year ago, with no `types` map at all, behaves
   * exactly as the specification says a new account behaves — without anybody
   * rewriting a single stored document, and without the two ever disagreeing.
   */
  types: Partial<Record<NotificationType, boolean>>;
}

/**
 * What an account gets before it has ever opened Settings.
 *
 * Marketing is off: nobody opts into campaigns by accident, and an app that
 * assumes otherwise teaches people to distrust its notifications. Push is off
 * for most roles because switching it on means asking the browser for
 * permission, and a permission prompt on first load is the fastest way to be
 * denied it forever. Everything else is on, because it was asked for.
 *
 * The per-type answers are NOT here. They live on each row of
 * `NOTIFICATION_SPEC` as `defaultOn`, next to the type they belong to, so that
 * adding a notification and deciding whether it is on by default is one edit in
 * one place rather than two edits in two files that can fall out of step.
 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  sound: true,
  push: false,
  marketing: false,
  newRestaurants: false,
  reviewReminders: true,
  support: true,
  newOrderSound: true,
  mutedTypes: [],
  types: {},
};

/**
 * The defaults for one role, where they differ from everybody else's.
 *
 * Only the restaurant differs today, and only on push: a kitchen that misses an
 * order loses money, so the preference starts on and waits for the browser
 * permission rather than the other way round. Nothing is raised by this on its
 * own — `requestPushPermission` is still only ever called from the switch the
 * person pressed — so a restaurant that never grants permission simply never
 * gets a browser banner, and no prompt appears uninvited.
 */
export function defaultNotificationPrefs(
  role: UserRole | null | undefined,
): NotificationPrefs {
  if (roleAudience(role) === 'RESTAURANT') {
    return { ...DEFAULT_NOTIFICATION_PREFS, push: true };
  }
  return DEFAULT_NOTIFICATION_PREFS;
}

/** The roles whose settings screen lists every type separately. */
export const PER_TYPE_SWITCH_ROLES: UserRole[] = [UserRole.OPERATOR, UserRole.SUPER_ADMIN];

export function hasPerTypeSwitches(role: UserRole | null | undefined): boolean {
  return !!role && PER_TYPE_SWITCH_ROLES.includes(role);
}

/** Reads a stored preference, falling back to the default for that field. */
export function prefAllows(
  prefs: Partial<NotificationPrefs> | undefined | null,
  category: NotificationCategory,
): boolean {
  return prefs?.[category] ?? DEFAULT_NOTIFICATION_PREFS[category];
}

/** Everything the table says about a type. */
export function notificationSpec(type: NotificationType): NotificationSpec {
  return NOTIFICATION_SPEC[type];
}

export function notificationPriority(type: NotificationType): NotificationPriority {
  return NOTIFICATION_SPEC[type]?.priority ?? NotificationPriority.NORMAL;
}

/**
 * Whether a given panel is allowed to switch this type off.
 *
 * An unknown type — one written by an older deployment — is treated as not
 * silenceable. Showing one notification too many is the cheaper failure.
 */
export function notificationSilenceableFor(
  type: NotificationType,
  audience: NotificationAudience | null | undefined,
): boolean {
  const rule = NOTIFICATION_SPEC[type]?.silenceable ?? false;
  if (typeof rule === 'boolean') return rule;
  // No admin exception any more: the admin is an audience like the others, and
  // a type they are not in the audience of is not theirs to switch.
  return audience !== null && audience !== undefined && rule.includes(audience);
}

/** Which of the two sounds this type uses, if it makes one. */
export function notificationTone(type: NotificationType): NotificationTone {
  const priority = notificationPriority(type);
  return priority === NotificationPriority.HIGH || priority === NotificationPriority.CRITICAL
    ? 'alert'
    : 'chime';
}

/** Whether ANY setting, in any panel, is allowed to hide this type. */
export function notificationSilenceable(type: NotificationType): boolean {
  const rule = NOTIFICATION_SPEC[type]?.silenceable ?? false;
  return typeof rule === 'boolean' ? rule : rule.length > 0;
}

/**
 * Whether one per-type switch is on for this account.
 *
 * Three sources, in the order of how deliberate they are: what the person
 * actually set, then the legacy mute list, then the type's own default. Each
 * type is answered on its own — there is no path here by which switching one
 * off can change the answer for another, which is what "independent switches"
 * has to mean if it is to mean anything.
 */
export function notificationTypeEnabled(
  prefs: Partial<NotificationPrefs> | undefined | null,
  type: NotificationType,
): boolean {
  const explicit = prefs?.types?.[type];
  if (explicit !== undefined) return explicit;
  if (prefs?.mutedTypes?.includes(type)) return false;
  return NOTIFICATION_SPEC[type]?.defaultOn ?? true;
}

/**
 * Whether this role may ever be addressed by this type.
 *
 * The backend permission matrix in one function: a courier is never sent an
 * operator's alert, an operator is never sent the admin lane, and — since the
 * owner went through the table — the admin is not sent everything either.
 *
 * WHY THE ADMIN IS NO LONGER A SPECIAL CASE
 * -----------------------------------------
 * It used to return `true` here for any type at all, on the argument that the
 * person who owns the platform is the last line of support for all of it. In
 * practice that made the admin's bell the loudest thing in the system: every
 * operator alert, on every order, in every shop. The admin now keeps four
 * things — a restaurant application, an escalated ticket, a reported problem,
 * a system warning — and each of them says so on its own row of the table
 * above. Everything else is still legible to the admin through the panels that
 * show it; it just no longer rings.
 *
 * Checked in the callables and mirrored by the security rules, which is the
 * boundary that actually holds — this is what stops a wrong recipient being
 * written in the first place.
 */
export function roleMayReceive(
  role: UserRole | null | undefined,
  type: NotificationType,
): boolean {
  const audience = roleAudience(role);
  if (audience === null) return false;
  return (NOTIFICATION_SPEC[type]?.audience ?? []).includes(audience);
}

/** Every type a given role can receive — what its settings screen lists. */
export function switchableTypesFor(role: UserRole | null | undefined): NotificationType[] {
  return (Object.keys(NOTIFICATION_SPEC) as NotificationType[]).filter((type) =>
    roleMayReceive(role, type),
  );
}

/**
 * Whether this notification may be written for an account with `prefs`.
 *
 * Four gates, in order of how absolute they are: a type this panel may not
 * silence passes all of them; the master switch and the per-type switch reach
 * only the rest; and the category is the finest of the sieves.
 *
 * `audience` is optional and defaults to "whoever asked" — pass it wherever it
 * is known, because it is what makes one type two promises: a restaurant may
 * switch a cancellation off and a customer may not.
 */
export function notificationAllowed(
  prefs: Partial<NotificationPrefs> | undefined | null,
  type: NotificationType,
  audience?: NotificationAudience | null,
): boolean {
  const silenceable =
    audience === undefined
      ? notificationSilenceable(type)
      : notificationSilenceableFor(type, audience);
  if (!silenceable) return true;

  if ((prefs?.enabled ?? DEFAULT_NOTIFICATION_PREFS.enabled) === false) return false;
  if (!notificationTypeEnabled(prefs, type)) return false;

  const category = NOTIFICATION_SPEC[type]?.category;
  return category === undefined || prefAllows(prefs, category);
}

/**
 * Whether this notification should make a sound for an account with `prefs`.
 *
 * Deliberately independent of `notificationAllowed`: sound is a preference for
 * every type, including the ones that must always be shown. A courier working
 * in silence still sees the cancellation on screen.
 */
export function notificationSoundEnabled(
  prefs: Partial<NotificationPrefs> | undefined | null,
  type: NotificationType,
): boolean {
  if (!NOTIFICATION_SPEC[type]?.sound) return false;
  if ((prefs?.sound ?? DEFAULT_NOTIFICATION_PREFS.sound) === false) return false;
  if (!notificationTypeEnabled(prefs, type)) return false;

  // "Yeni sifariş səsi" owns every noise a new order makes, so that one switch
  // silences the kitchen rather than leaving a single chime behind the alarm
  // it just turned off.
  if (type === NotificationType.NEW_ORDER_FOR_RESTAURANT) {
    return prefs?.newOrderSound ?? DEFAULT_NOTIFICATION_PREFS.newOrderSound;
  }

  return true;
}

/** Whether the repeating new-order alarm may sound for an account. */
export function newOrderAlarmEnabled(
  prefs: Partial<NotificationPrefs> | undefined | null,
): boolean {
  if ((prefs?.sound ?? DEFAULT_NOTIFICATION_PREFS.sound) === false) return false;
  return prefs?.newOrderSound ?? DEFAULT_NOTIFICATION_PREFS.newOrderSound;
}

/** Whether the browser may raise a system notification for this account. */
export function notificationPushEnabled(
  prefs: Partial<NotificationPrefs> | undefined | null,
): boolean {
  return prefs?.push ?? DEFAULT_NOTIFICATION_PREFS.push;
}

/**
 * Fills in the defaults for an account that has never opened Settings.
 *
 * THIS IS WHERE AN OLD ACCOUNT IS KEPT WHOLE
 * ------------------------------------------
 * Every field added to `NotificationPrefs` arrives here as a fallback and
 * nowhere else, so a user document written before the field existed is read as
 * the specified default rather than as `undefined` — and is never rewritten to
 * say so. Nothing is migrated, nothing is backfilled, and a preference the
 * person did set survives every field added after it, because the stored object
 * is laid over the defaults rather than the other way round.
 *
 * `role` is optional because most callers have it and a few — the ring memory,
 * a test — genuinely do not. Passing it is what gets the restaurant its own
 * push default.
 */
export function resolveNotificationPrefs(
  prefs: Partial<NotificationPrefs> | undefined | null,
  role?: UserRole | null,
): NotificationPrefs {
  return {
    ...defaultNotificationPrefs(role),
    ...(prefs ?? {}),
    mutedTypes: prefs?.mutedTypes ?? [],
    types: { ...(prefs?.types ?? {}) },
  };
}

/**
 * What one settings screen is allowed to say in one request.
 *
 * Every field is optional, and "optional" here means exactly one thing:
 * ABSENT — the screen does not show that switch, so it has no opinion. It does
 * NOT mean `false`. The two are different sentences and the whole bug this
 * type exists to prevent came from writing code that could not tell them
 * apart: a request read with `data.marketing === true` turns "I did not
 * mention marketing" into "switch marketing off", and every switch the screen
 * did not send is quietly cleared on every save. That is what "I cannot turn
 * anything off" looks like from the outside — the switch the person moved is
 * overwritten a moment later by the defaults the erased fields fall back to.
 */
export type NotificationPrefsPatch = Partial<
  Pick<
    NotificationPrefs,
    | 'enabled'
    | 'sound'
    | 'push'
    | 'marketing'
    | 'newRestaurants'
    | 'reviewReminders'
    | 'support'
    | 'newOrderSound'
    | 'mutedTypes'
  >
> & {
  /** Only the per-type switches this screen renders. Absent keys are untouched. */
  types?: Partial<Record<NotificationType, boolean>>;
};

/** The plain boolean flags a patch may carry, in one list both sides read. */
export const NOTIFICATION_PREF_FLAGS = [
  'enabled',
  'sound',
  'push',
  'marketing',
  'newRestaurants',
  'reviewReminders',
  'support',
  'newOrderSound',
] as const satisfies ReadonlyArray<keyof NotificationPrefs>;

export type NotificationPrefFlag = (typeof NOTIFICATION_PREF_FLAGS)[number];

/**
 * Lays one screen's request over what is stored, and returns the whole object.
 *
 * WHY THIS IS A SHARED FUNCTION AND NOT SERVER CODE
 * ------------------------------------------------
 * `notificationPrefs` is one Firestore map, so writing it with three keys
 * erases the other five. That means every save is a read-modify-write, and a
 * read-modify-write is exactly the place where `false` gets mistaken for "not
 * provided". Putting the merge here — pure, with no database in sight — is
 * what makes "turn every switch off and read it back" a test that runs in
 * `npm test` rather than a thing somebody has to try on a phone.
 *
 * The rule is one line long and is the only rule: a key that is PRESENT wins,
 * whatever its value; a key that is ABSENT leaves the stored answer alone.
 * `false` is a value, not an absence, so it is written like any other.
 *
 * Permission is deliberately NOT decided here. Whether this role may switch
 * this type at all is `mayToggleType`, and the callable asks it before calling
 * this — a pure merge that silently dropped keys would be a second, quieter
 * place for the same class of bug to live.
 */
export function mergeNotificationPrefs(
  stored: Partial<NotificationPrefs> | undefined | null,
  patch: NotificationPrefsPatch | undefined | null,
  role?: UserRole | null,
): NotificationPrefs {
  const current = resolveNotificationPrefs(stored, role);
  const requested = patch ?? {};

  const next: NotificationPrefs = {
    ...current,
    // Rebuilt rather than spread from `current`, so that a caller handing us
    // the same object back cannot end up sharing it with the stored value.
    mutedTypes: [...current.mutedTypes],
    types: { ...current.types },
  };

  for (const flag of NOTIFICATION_PREF_FLAGS) {
    const value = requested[flag];
    // `typeof` rather than a truthiness test, on purpose: this is the exact
    // line that has to keep `false` and "absent" apart.
    if (typeof value === 'boolean') next[flag] = value;
  }

  if (Array.isArray(requested.mutedTypes)) {
    next.mutedTypes = [...new Set(requested.mutedTypes)];
  }

  if (requested.types) {
    for (const [type, value] of Object.entries(requested.types)) {
      if (typeof value === 'boolean') next.types[type as NotificationType] = value;
    }
  }

  return next;
}

/**
 * What went wrong with a settings request, in the two words the server needs.
 *
 * `invalid` becomes VALIDATION_FAILED and `forbidden` becomes FORBIDDEN; the
 * field is what the callable passes as the detail. Kept as data rather than as
 * a thrown error because this function is shared code and `shared/` may not
 * reach for the server's error machinery.
 */
export type NotificationPrefsRequestResult =
  | { ok: true; patch: NotificationPrefsPatch }
  | { ok: false; reason: 'invalid' | 'forbidden'; field: string };

/**
 * Reads one settings screen's raw payload into a patch, or refuses it.
 *
 * WHY THIS MOVED OUT OF THE CALLABLE
 * ----------------------------------
 * The rules it applies are the same ones the screen applies when it decides
 * which switches to draw — `mayToggleType`, `hasPerTypeSwitches`,
 * `roleMayReceive` — and the two were written twice, in two files, against the
 * same table. The admin's per-type list is the case where that costs something:
 * that screen posts a `types` map rather than the flat flags every other screen
 * posts, so it is the one path a divergence would break first, and it is the
 * one path nothing could test without a deployed function behind it.
 *
 * With the reading here, "turn every switch off for every role and read it
 * back" is an ordinary unit test over the code the callable actually runs,
 * rather than something somebody has to try on a phone after a deploy.
 *
 * The role is the caller's stored role, never anything the browser sent. An
 * absent field stays absent — see `NotificationPrefsPatch` for why that
 * distinction is the whole point.
 */
export function readNotificationPrefsRequest(
  data: Record<string, unknown>,
  role: UserRole | null | undefined,
): NotificationPrefsRequestResult {
  const patch: NotificationPrefsPatch = {};

  for (const flag of NOTIFICATION_PREF_FLAGS) {
    const value = data[flag];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'boolean') return { ok: false, reason: 'invalid', field: flag };
    patch[flag] = value;
  }

  if (data.mutedTypes !== undefined && data.mutedTypes !== null) {
    const requested = data.mutedTypes;
    if (!Array.isArray(requested) || requested.length > 100) {
      return { ok: false, reason: 'invalid', field: 'mutedTypes' };
    }

    // A role without per-type switches may still send an empty list — that is
    // what a screen which does not render them looks like on the wire — but
    // never a mute.
    if (requested.length > 0 && !hasPerTypeSwitches(role)) {
      return { ok: false, reason: 'forbidden', field: 'mutedTypes' };
    }

    for (const type of requested) {
      // An unknown string here is either an older client or somebody probing.
      // Either way it is not a type this system can honour, and silently
      // storing it would make the settings screen disagree with itself.
      if (typeof type !== 'string' || !Object.hasOwn(NOTIFICATION_SPEC, type)) {
        return { ok: false, reason: 'invalid', field: 'mutedTypes' };
      }
      if (!roleMayReceive(role, type as NotificationType)) {
        return { ok: false, reason: 'invalid', field: 'mutedTypes' };
      }
    }

    patch.mutedTypes = [...new Set(requested as NotificationType[])];
  }

  if (data.types !== undefined && data.types !== null) {
    const requested = data.types;
    if (typeof requested !== 'object' || Array.isArray(requested)) {
      return { ok: false, reason: 'invalid', field: 'types' };
    }

    const asked: Partial<Record<NotificationType, boolean>> = {};
    const keys = Object.keys(requested as Record<string, unknown>);
    if (keys.length > 100) return { ok: false, reason: 'invalid', field: 'types' };

    for (const key of keys) {
      const value = (requested as Record<string, unknown>)[key];
      if (typeof value !== 'boolean') return { ok: false, reason: 'invalid', field: 'types' };
      // `hasOwn` rather than `in`: `in` walks the prototype chain, so a payload
      // with a key of `constructor` or `toString` would pass a check that was
      // meant to ask "is this one of our notification types".
      if (!Object.hasOwn(NOTIFICATION_SPEC, key)) {
        return { ok: false, reason: 'invalid', field: 'types' };
      }
      // The one check that matters: may THIS role switch THIS type at all.
      if (!mayToggleType(role, key as NotificationType)) {
        return { ok: false, reason: 'forbidden', field: 'types' };
      }
      asked[key as NotificationType] = value;
    }

    patch.types = asked;
  }

  return { ok: true, patch };
}

// ---------------------------------------------------------------------------
// What a settings screen shows
// ---------------------------------------------------------------------------

/**
 * The three cards, in the order they are read.
 *
 * Named here rather than in the component because the server validates against
 * the same list: a switch that no screen shows is a switch no callable accepts.
 */
export type NotificationGroup = 'general' | 'orders' | 'campaigns' | 'sound' | 'types';

/**
 * One row on the settings screen.
 *
 * `key` is the owner's own name for the switch — `orderAccepted`,
 * `newOrderSound` — and it is what the translations and the tests are written
 * against. What it actually moves is one of three things, and the `kind` says
 * which: a single notification type, a whole category, or one of the plain
 * account flags.
 */
export interface NotificationSwitch {
  key: string;
  group: NotificationGroup;
  kind: 'type' | 'category' | 'flag';
  type?: NotificationType;
  category?: NotificationCategory;
  flag?: 'enabled' | 'sound' | 'push' | 'newOrderSound';
}

/*
 * The customer's screen has no "orders" card any more.
 *
 * It used to carry five switches — accepted, preparing, on the way, delivered,
 * late — and all five notifications are gone, so the rows went with them: a
 * settings screen that offers to switch something off that is never sent is
 * worse than no screen at all. What is left is what a customer can still be
 * sent: campaigns, new restaurants, a reminder to rate an order, and the two
 * plain flags.
 */
const CUSTOMER_SWITCHES: NotificationSwitch[] = [
  { key: 'marketingOffers', group: 'campaigns', kind: 'category', category: 'marketing' },
  { key: 'newRestaurants', group: 'campaigns', kind: 'category', category: 'newRestaurants' },
  { key: 'reviewReminders', group: 'campaigns', kind: 'category', category: 'reviewReminders' },
  { key: 'sound', group: 'sound', kind: 'flag', flag: 'sound' },
  { key: 'pushNotification', group: 'sound', kind: 'flag', flag: 'push' },
];

const RESTAURANT_SWITCHES: NotificationSwitch[] = [
  {
    key: 'newOrderNotification',
    group: 'orders',
    kind: 'type',
    type: NotificationType.NEW_ORDER_FOR_RESTAURANT,
  },
  { key: 'orderCancelled', group: 'orders', kind: 'type', type: NotificationType.ORDER_CANCELLED },
  { key: 'chatMessage', group: 'orders', kind: 'category', category: 'support' },
  { key: 'marketingOffers', group: 'campaigns', kind: 'category', category: 'marketing' },
  { key: 'newOrderSound', group: 'sound', kind: 'flag', flag: 'newOrderSound' },
  { key: 'sound', group: 'sound', kind: 'flag', flag: 'sound' },
  { key: 'pushNotification', group: 'sound', kind: 'flag', flag: 'push' },
];

const COURIER_SWITCHES: NotificationSwitch[] = [
  {
    key: 'deliveryLate',
    group: 'orders',
    kind: 'type',
    type: NotificationType.COURIER_DELIVERY_LATE,
  },
  { key: 'marketingOffers', group: 'campaigns', kind: 'category', category: 'marketing' },
  { key: 'sound', group: 'sound', kind: 'flag', flag: 'sound' },
  { key: 'pushNotification', group: 'sound', kind: 'flag', flag: 'push' },
];

/**
 * Platform staff get the per-type list instead of a hand-written one.
 *
 * An operator's screen is a queue of nine kinds and the owner asked for each of
 * them to be switchable; writing nine rows here would be writing the enum out
 * twice. `group: 'types'` is the component's cue to render
 * `switchableTypesFor()` in full.
 */
const PLATFORM_SWITCHES: NotificationSwitch[] = [
  // The master switch is platform staff's alone, and it is in a card of its own
  // rather than among the others because it is not like the others: it reaches
  // every switchable type at once. A customer does not get it — every switch on
  // their screen has to be independent of every other, and a master switch is
  // by definition the opposite of that.
  { key: 'enabled', group: 'general', kind: 'flag', flag: 'enabled' },
  { key: 'sound', group: 'sound', kind: 'flag', flag: 'sound' },
  { key: 'pushNotification', group: 'sound', kind: 'flag', flag: 'push' },
];

/** Every switch this role's settings screen shows, in reading order. */
export function notificationSwitchesFor(role: UserRole | null | undefined): NotificationSwitch[] {
  switch (roleAudience(role)) {
    case 'CUSTOMER':
      return CUSTOMER_SWITCHES;
    case 'RESTAURANT':
      return RESTAURANT_SWITCHES;
    case 'COURIER':
      return COURIER_SWITCHES;
    case 'OPERATOR':
    case 'ADMIN':
      return PLATFORM_SWITCHES;
    default:
      return [];
  }
}

/**
 * Whether this role is allowed to set this per-type switch at all.
 *
 * The server's answer to a hand-written request, and the reason the screen and
 * the callable cannot disagree: a customer posting
 * `types: { OPS_ORDER_PROBLEM: false }` is asking to mute something they were
 * never going to be sent, and a customer posting
 * `types: { ORDER_REJECTED: false }` is asking to hide something nobody may
 * hide. Both are refused here.
 */
export function mayToggleType(
  role: UserRole | null | undefined,
  type: NotificationType,
): boolean {
  if (!roleMayReceive(role, type)) return false;
  return notificationSilenceableFor(type, roleAudience(role));
}

// ---------------------------------------------------------------------------
// The notification log
// ---------------------------------------------------------------------------

/**
 * The read lifecycle, as the log spells it.
 *
 * Two values, because a notification is either waiting to be read or has been.
 * Anything richer would be a state machine nobody drives.
 */
export const NotificationStatus = {
  UNREAD: 'UNREAD',
  READ: 'READ',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

/**
 * Whether the thing ever got anywhere.
 *
 * The reason this field exists is the sentence "the restaurant says it never
 * got the order", and the only way it can help answer that is by being capable
 * of saying no. So:
 *
 *   pending — written and stored. Nobody's browser has collected it yet, which
 *             is the normal state of a notification for an account that is not
 *             signed in anywhere at this moment.
 *   sent    — a session belonging to the recipient actually received it. This
 *             is written by that session and by nothing else.
 *   failed  — the server could not complete the write on its first attempt and
 *             recorded the fact on the retry.
 */
export const NotificationDeliveryStatus = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
} as const;
export type NotificationDeliveryStatus =
  (typeof NotificationDeliveryStatus)[keyof typeof NotificationDeliveryStatus];

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * THE RULE THIS WHOLE FILE IS BUILT AROUND: ONE EVENT, ONE NOTIFICATION.
 *
 * A notification's document id is a pure function of the event that caused it —
 * never a random id — so writing the same event twice writes the same document
 * twice and leaves one row on screen. That makes deduplication structural
 * rather than a guess: a retried transaction, a scheduled job that runs over
 * the same order again, or two Cloud Function instances racing the same webhook
 * all converge on one document, because none of them can invent a second id.
 *
 * The client leans on the same fact. A Firestore listener re-delivers documents
 * freely — a reconnect replays the whole window — so the sound layer remembers
 * the ids it has already rung and a repeat of a known id is silent. Both ends
 * therefore agree on what "the same notification" means, and they agree because
 * they are looking at the same string.
 *
 * `occurrence` is how a notification is allowed to legitimately repeat. A
 * restaurant that is shut during its opening hours should be reported once a
 * day, not once every fifteen minutes, so that alert passes the date — and the
 * job may then run as often as it likes.
 */
export function notificationDedupeKey(input: {
  type: NotificationType;
  /** Who it is for. Two people notified about one order are two events. */
  recipientId: string;
  /** What it is about: an order id, a restaurant id, a ticket id. */
  subjectId?: string | null;
  /** The bucket within which this event may only happen once. */
  occurrence?: string | null;
}): string {
  return [input.type, input.subjectId ?? '-', input.occurrence ?? '-', input.recipientId]
    .map(dedupeSegment)
    .join('~');
}

/**
 * Makes one segment safe to put in a Firestore document id.
 *
 * A document id may not contain a forward slash and may not be `.` or `..`;
 * everything the callers pass is already an enum name, a uid or a generated
 * document id, so this is a guard against a future caller rather than a
 * transformation anything relies on today.
 */
function dedupeSegment(value: string): string {
  const cleaned = value.replace(/[/~\s]+/g, '_');
  return cleaned.length > 0 ? cleaned : '-';
}

// ---------------------------------------------------------------------------
// "Ready" and "assigned to you" at the same moment
// ---------------------------------------------------------------------------

/**
 * How close together two events have to be to count as one.
 *
 * A minute. A kitchen that finishes an order and hands it to a driver does both
 * within a few seconds, and the driver's phone must buzz once — two buzzes for
 * one bag is how people learn to ignore the buzzing. Ten minutes later they are
 * genuinely two events, and the driver has been doing something else in between.
 */
export const SIMULTANEOUS_EVENT_WINDOW_MS = 60_000;

/**
 * The one notification a courier gets when an order is theirs and ready.
 *
 * Called from both sides — the moment a courier is assigned, and the moment the
 * kitchen marks the order ready — and returns null when the other side has
 * already said it. So whichever happens second stays quiet, and the driver is
 * told once whichever order the two events arrive in.
 */
export function courierPickupNotification(input: {
  /** When this courier was put on the order, if they have been. */
  assignedAtMs: number | null;
  /** When the kitchen marked it ready, if it has. */
  readyAtMs: number | null;
  /** Which of the two just happened. */
  trigger: 'assigned' | 'ready';
}): NotificationType | null {
  const { assignedAtMs, readyAtMs, trigger } = input;

  if (trigger === 'assigned') {
    // Nobody to tell about a pickup that has not been assigned to them.
    if (assignedAtMs === null) return null;
    return NotificationType.COURIER_ASSIGNED;
  }

  // Ready, with no courier on it: whoever gets assigned later is told then.
  if (assignedAtMs === null || readyAtMs === null) return null;

  // Assigned a moment ago — that notification already said the order is ready,
  // so this one would be the second buzz for one bag.
  if (readyAtMs - assignedAtMs < SIMULTANEOUS_EVENT_WINDOW_MS) return null;

  return NotificationType.COURIER_ORDER_READY;
}

// ---------------------------------------------------------------------------
// Who may READ a notification that has already been written
// ---------------------------------------------------------------------------

/**
 * The roles whose notifications belong to a restaurant rather than to a person.
 *
 * A courier is deliberately absent, and that absence is the whole point of this
 * constant existing. Every courier notification carries the `restaurantId` of
 * the shop the driver rides for — it has to, because the operator's desk finds
 * it by that field — so a rule that let a restaurant read "its" notifications
 * by `restaurantId` alone handed the kitchen every message sent to every driver
 * on the payroll. Same for a customer's order notifications, which carry the
 * restaurant that is cooking. The role on the document, not the restaurant id,
 * is what says whose notification it is.
 *
 * Mirrored verbatim in `firestore.rules`. Change one and change the other; the
 * matrix in `tests/notificationPermissions.test.ts` is what notices if not.
 */
export const RESTAURANT_NOTIFICATION_ROLES: UserRole[] = [
  UserRole.RESTAURANT_OWNER,
  UserRole.RESTAURANT_MANAGER,
  UserRole.RESTAURANT_STAFF,
];

/** Who is asking. `uid` is the signed-in account; null role means a guest. */
export interface NotificationViewer {
  uid: string | null;
  role: UserRole | null;
  /** The restaurant on the viewer's custom claim, never one they sent us. */
  restaurantId: string | null;
}

/** The three fields of a stored notification that decide who may read it. */
export interface NotificationRef {
  userId: string;
  role: UserRole | null;
  restaurantId: string | null;
}

/**
 * Whether this account may read this notification.
 *
 * The executable copy of the `notifications` read rule. The rule is the
 * boundary that actually holds — this is what the bell's queries are built to
 * satisfy and what the permission matrix is asserted against, so that "the
 * courier's phone is private from the kitchen" is a claim somebody has run.
 *
 * Two readers, and no third:
 *
 *   1. the person it is addressed to, and
 *   2. staff of the restaurant it belongs to — but only for the notifications
 *      that are the restaurant's own business, which is what the role check is
 *      for. An owner, a manager and a kitchen account share one inbox because
 *      "a new order arrived" is addressed to the shop rather than to whichever
 *      account happened to be named on it.
 *
 * Platform staff are not a third reader. An operator or an admin sees their own
 * notifications here like anybody else; what they are entitled to see of other
 * people's goes through the callables, which can decide field by field.
 */
export function notificationReadableBy(
  viewer: NotificationViewer,
  notification: NotificationRef,
): boolean {
  if (!viewer.uid) return false;
  if (viewer.uid === notification.userId) return true;

  const viewerIsRestaurantStaff =
    !!viewer.role && RESTAURANT_NOTIFICATION_ROLES.includes(viewer.role);
  if (!viewerIsRestaurantStaff) return false;

  // An empty claim must never match an empty field: a notification written
  // without a restaurant would otherwise be readable by every account whose
  // own restaurant is unset.
  if (!viewer.restaurantId || viewer.restaurantId !== notification.restaurantId) return false;

  return !!notification.role && RESTAURANT_NOTIFICATION_ROLES.includes(notification.role);
}
