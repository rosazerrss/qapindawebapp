/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Roles and permissions.
 *
 * THE TENANT RULE
 * ---------------
 * A permission here answers "may this role do this kind of thing at all?".
 * It never answers "to whose data?". Every restaurant permission is additionally
 * scoped by `restaurantId`: holding MENU_EDIT lets you edit *your* menu, and the
 * caller's `restaurantId` claim is checked separately, both in Cloud Functions
 * and in Security Rules. A permission check alone is never enough authorisation
 * for a restaurant role — `canActOnRestaurant` must pass too.
 */

import { PLATFORM_ROLES, RESTAURANT_ROLES, UserRole } from './enums';

export const Permission = {
  // Menu
  MENU_VIEW: 'MENU_VIEW',
  MENU_EDIT: 'MENU_EDIT',
  MENU_TOGGLE_AVAILABILITY: 'MENU_TOGGLE_AVAILABILITY',

  // Orders
  ORDER_VIEW: 'ORDER_VIEW',
  ORDER_ACCEPT: 'ORDER_ACCEPT',
  ORDER_ADVANCE: 'ORDER_ADVANCE',
  ORDER_CANCEL: 'ORDER_CANCEL',
  ORDER_FORCE_CANCEL: 'ORDER_FORCE_CANCEL',

  // Restaurant settings
  RESTAURANT_VIEW_PROFILE: 'RESTAURANT_VIEW_PROFILE',
  RESTAURANT_EDIT_PROFILE: 'RESTAURANT_EDIT_PROFILE',
  RESTAURANT_TOGGLE_SERVICE: 'RESTAURANT_TOGGLE_SERVICE',
  RESTAURANT_MANAGE_STAFF: 'RESTAURANT_MANAGE_STAFF',
  RESTAURANT_VIEW_FINANCE: 'RESTAURANT_VIEW_FINANCE',
  /**
   * Setting the bank account the restaurant is paid into.
   *
   * Separate from viewing the money, and deliberately narrower: a manager who
   * can read the invoice still cannot redirect a payout to another account.
   */
  RESTAURANT_EDIT_PAYOUT: 'RESTAURANT_EDIT_PAYOUT',

  // Platform
  PLATFORM_VIEW_RESTAURANTS: 'PLATFORM_VIEW_RESTAURANTS',
  PLATFORM_APPROVE_RESTAURANT: 'PLATFORM_APPROVE_RESTAURANT',
  PLATFORM_SUSPEND_RESTAURANT: 'PLATFORM_SUSPEND_RESTAURANT',
  PLATFORM_SET_COMMISSION: 'PLATFORM_SET_COMMISSION',
  PLATFORM_VIEW_ORDERS: 'PLATFORM_VIEW_ORDERS',
  PLATFORM_VIEW_USERS: 'PLATFORM_VIEW_USERS',
  PLATFORM_CHANGE_USER_STATUS: 'PLATFORM_CHANGE_USER_STATUS',
  PLATFORM_CHANGE_USER_ROLE: 'PLATFORM_CHANGE_USER_ROLE',
  PLATFORM_MANAGE_COUPONS: 'PLATFORM_MANAGE_COUPONS',
  PLATFORM_VIEW_LEDGER: 'PLATFORM_VIEW_LEDGER',
  PLATFORM_ADJUST_LEDGER: 'PLATFORM_ADJUST_LEDGER',
  PLATFORM_MARK_SETTLEMENT_PAID: 'PLATFORM_MARK_SETTLEMENT_PAID',
  PLATFORM_MODERATE_REVIEWS: 'PLATFORM_MODERATE_REVIEWS',
  PLATFORM_RESOLVE_COMPLAINTS: 'PLATFORM_RESOLVE_COMPLAINTS',
  /** Working the two support lanes an operator is allowed to work. */
  PLATFORM_SUPPORT_CHAT: 'PLATFORM_SUPPORT_CHAT',
  /**
   * The restaurant → admin lane: commission, invoices, contracts, and a
   * complaint about an operator.
   *
   * Held by the admin alone, and that exclusion is the point. A lane whose
   * purpose includes "this operator handled us badly" cannot be readable by
   * operators, so it is a permission rather than a tab that is not rendered.
   */
  PLATFORM_ADMIN_SUPPORT: 'PLATFORM_ADMIN_SUPPORT',
  PLATFORM_VIEW_AUDIT: 'PLATFORM_VIEW_AUDIT',
  PLATFORM_EDIT_SETTINGS: 'PLATFORM_EDIT_SETTINGS',
  /**
   * Deleting the platform's test data before launch.
   *
   * Held by the super admin alone — `SUPER_ADMIN` is the only role built from
   * every permission, so a permission that appears in no other role's list is
   * a permission only the owner has. The callable additionally checks the role
   * by name rather than trusting this table, because a table is a thing that
   * can be edited and this action cannot be undone.
   */
  PLATFORM_RESET_DATA: 'PLATFORM_RESET_DATA',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const STAFF: Permission[] = [
  Permission.MENU_VIEW,
  Permission.MENU_TOGGLE_AVAILABILITY,
  Permission.ORDER_VIEW,
  Permission.ORDER_ACCEPT,
  Permission.ORDER_ADVANCE,
  Permission.RESTAURANT_VIEW_PROFILE,
];

const MANAGER: Permission[] = [
  ...STAFF,
  Permission.MENU_EDIT,
  Permission.ORDER_CANCEL,
  Permission.RESTAURANT_EDIT_PROFILE,
  Permission.RESTAURANT_TOGGLE_SERVICE,
];

/** The owner additionally sees the money and hires the staff. */
const OWNER: Permission[] = [
  ...MANAGER,
  Permission.RESTAURANT_MANAGE_STAFF,
  Permission.RESTAURANT_VIEW_FINANCE,
  Permission.RESTAURANT_EDIT_PAYOUT,
];

/**
 * A courier can see the orders handed to them and close them. Nothing else.
 *
 * No menu, no prices, no other orders, no takings. The list is short on
 * purpose: this account rides around town on somebody's personal phone, and
 * every permission it does not have is a permission that cannot be lost with
 * the phone.
 */
const COURIER: Permission[] = [Permission.ORDER_VIEW];

/** Support staff: can see everything operational, can touch almost nothing financial. */
const OPERATOR: Permission[] = [
  Permission.PLATFORM_VIEW_RESTAURANTS,
  Permission.PLATFORM_VIEW_ORDERS,
  Permission.PLATFORM_VIEW_USERS,
  Permission.PLATFORM_CHANGE_USER_STATUS,
  /*
   * PLATFORM_VIEW_LEDGER IS DELIBERATELY ABSENT.
   *
   * It used to be here, and the admin screens simply did not draw the finance
   * pages for an operator — which is a decision made in a browser, and a
   * decision made in a browser is not a rule. `listSettlements`, `listPayments`
   * and `platformReport` all answered an operator that asked them directly, so
   * every support account could read the platform's takings, every
   * restaurant's commission and every payment reference by calling the
   * function the panel would have called.
   *
   * Support work does not need the books. Whether one order was paid is on the
   * order, which an operator can already see; what the platform earned last
   * month is not a support question. Removing it here closes the callables and
   * the Firestore rules at once, because both read this list.
   */
  Permission.PLATFORM_VIEW_AUDIT,
  Permission.PLATFORM_RESOLVE_COMPLAINTS,
  Permission.PLATFORM_SUPPORT_CHAT,
  Permission.ORDER_VIEW,
  Permission.ORDER_FORCE_CANCEL,
  Permission.MENU_VIEW,
];

const SUPER_ADMIN: Permission[] = Object.values(Permission);

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.CUSTOMER]: [],
  [UserRole.RESTAURANT_STAFF]: STAFF,
  [UserRole.RESTAURANT_MANAGER]: MANAGER,
  [UserRole.RESTAURANT_OWNER]: OWNER,
  [UserRole.RESTAURANT_COURIER]: COURIER,
  [UserRole.OPERATOR]: OPERATOR,
  [UserRole.SUPER_ADMIN]: SUPER_ADMIN,
};

export function hasPermission(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

/**
 * May this account order food?
 *
 * ONLY A CUSTOMER MAY. Not a restaurant owner, not a manager, not the person
 * on the till, not the driver, not an operator, not the admin — and not a
 * restaurant ordering from its own shop, which is the case the owner asked
 * about by name.
 *
 * The reason is not tidiness. An order placed by a work account is an order
 * that earns a coupon, a first-order discount, a commission line and a row in
 * the sales figures; a shop that can order from itself can write its own
 * takings. Blocking the order is what closes all of those at once, which is
 * why this is asked at the one gate (`createOrder`) rather than defended
 * separately in the coupon, commission and statistics code.
 *
 * Written as "is the role CUSTOMER" rather than "is the role not one of these
 * six", so that a role added tomorrow starts out unable to order rather than
 * able to. A new work role must not become a customer by omission.
 */
export function mayOrderFood(role: UserRole | null | undefined): boolean {
  return role === UserRole.CUSTOMER;
}

/**
 * The opposite question, phrased the way the screens ask it: is this a work
 * account? A signed-out visitor is not — a guest fills a cart and signs in at
 * checkout, and that flow must stay open.
 */
export function isWorkAccount(role: UserRole | null | undefined): boolean {
  return !!role && !mayOrderFood(role);
}

export function isRestaurantRole(role: UserRole | null | undefined): boolean {
  return !!role && RESTAURANT_ROLES.includes(role);
}

export function isPlatformRole(role: UserRole | null | undefined): boolean {
  return !!role && PLATFORM_ROLES.includes(role);
}

/**
 * The tenant gate. A restaurant role may only act on the restaurant it belongs
 * to; a platform role may act on any. Anything else is a no.
 */
export function canActOnRestaurant(
  role: UserRole | null | undefined,
  callerRestaurantId: string | null | undefined,
  targetRestaurantId: string,
): boolean {
  if (isPlatformRole(role)) return true;
  if (!isRestaurantRole(role)) return false;
  return !!callerRestaurantId && callerRestaurantId === targetRestaurantId;
}

/** Both gates at once — what Cloud Functions actually call. */
export function authorise(
  role: UserRole | null | undefined,
  callerRestaurantId: string | null | undefined,
  permission: Permission,
  targetRestaurantId?: string,
): boolean {
  if (!hasPermission(role, permission)) return false;
  if (targetRestaurantId === undefined) return true;
  return canActOnRestaurant(role, callerRestaurantId, targetRestaurantId);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface NavItem {
  href: string;
  labelKey: string;
  icon: string;
  permission: Permission;
  /**
   * Which block of the sidebar this belongs to.
   *
   * Grouping is not decoration: a flat list of a dozen links forces the reader
   * to scan all of them every time. "Is this a daily job, a growth job, or a
   * settings job" is the question the groups answer before the label is read.
   */
  group: 'main' | 'growth' | 'management' | 'system';
}

/**
 * The restaurant panel's sidebar — real paths, no rewriting.
 *
 * These used to be written against a shorthand root and patched into their true
 * form inside `PanelShell`. Two spellings of one route is a trap: the rename to
 * English walked straight into it, turning a href into a path that resolved to
 * nothing. One spelling now, and it is the one the router uses.
 */
export const RESTAURANT_NAV: NavItem[] = [
  { href: '/panel', labelKey: 'nav.orders', icon: 'receipt', permission: Permission.ORDER_VIEW, group: 'main' },
  { href: '/panel/menu', labelKey: 'nav.menu', icon: 'utensils', permission: Permission.MENU_VIEW, group: 'main' },
  { href: '/panel/sales', labelKey: 'nav.sales', icon: 'chart', permission: Permission.RESTAURANT_VIEW_FINANCE, group: 'growth' },
  { href: '/panel/reports', labelKey: 'nav.finance', icon: 'wallet', permission: Permission.RESTAURANT_VIEW_FINANCE, group: 'growth' },
  { href: '/panel/settlement', labelKey: 'nav.settlement', icon: 'banknote', permission: Permission.RESTAURANT_VIEW_FINANCE, group: 'growth' },
  { href: '/panel/staff', labelKey: 'nav.staff', icon: 'users', permission: Permission.RESTAURANT_MANAGE_STAFF, group: 'management' },
  { href: '/panel/reviews', labelKey: 'nav.reviews', icon: 'star', permission: Permission.RESTAURANT_VIEW_PROFILE, group: 'growth' },
  { href: '/panel/complaints', labelKey: 'nav.complaints', icon: 'alert', permission: Permission.ORDER_VIEW, group: 'main' },
  { href: '/panel/support', labelKey: 'nav.support', icon: 'chat', permission: Permission.RESTAURANT_VIEW_PROFILE, group: 'management' },
  { href: '/panel/settings', labelKey: 'nav.settings', icon: 'settings', permission: Permission.RESTAURANT_VIEW_PROFILE, group: 'system' },
];

/**
 * Where the admin panel lives.
 *
 * Not `/admin`. That is deliberate, and it is worth being clear about what it
 * does and does not buy: an unguessable path stops automated scanners and idle
 * curiosity, and nothing more. The actual protection is that every admin
 * function re-reads the caller's role server-side and the security rules refuse
 * the data — someone who learned this path would still see an empty redirect.
 *
 * Changing it is a one-line edit here plus renaming the folder under
 * `src/app/`; nothing else refers to the literal path.
 */
export const ADMIN_ROOT = '/qapinda-idare-merkezi-7xk4m2';

/**
 * Where the operator works.
 *
 * An operator is not a junior admin sharing the admin panel with the owner —
 * it is a separate job with a separate screen, the way the courier has one.
 * The admin panel is full of controls an operator may never touch (commission,
 * roles, settings, payouts), and a screen that shows a person nine things they
 * cannot do is a screen that teaches them to ignore it.
 *
 * This path is plain and guessable on purpose: unlike the admin root, nothing
 * about it is meant to be quiet. The security rules and every callable still
 * re-check the caller's role, so an ordinary customer who types it in is
 * redirected out and would see nothing even if they were not.
 */
export const OPERATOR_ROOT = '/operator';

/**
 * The screen a platform account belongs on after signing in.
 *
 * One answer, used by the sign-in door and by the admin shell when it turns an
 * operator away, so the two can never disagree about where that person lives.
 */
export function platformHome(role: UserRole | null | undefined): string {
  return role === UserRole.OPERATOR ? OPERATOR_ROOT : ADMIN_ROOT;
}

/**
 * Ayarlar → Bildirişlər, for whichever panel this person works in.
 *
 * Every role has exactly one such page and no role has notification switches
 * anywhere else — the owner asked for that twice, and this function is what
 * makes it a single fact rather than five links written in five headers that
 * can drift. The bell's "Bildiriş ayarları" link, and any future one, asks
 * here.
 *
 * A signed-out visitor has no settings page, so the answer is the customer's:
 * the link is only ever rendered for somebody who is signed in, and sending a
 * guest to Hesabım is the same thing every other account link does.
 */
/**
 * Where this role READS its notifications.
 *
 * WHY THE PANELS HAVE A PAGE AND THE CUSTOMER HAS A SHEET
 * -------------------------------------------------------
 * The bell used to open a bottom sheet everywhere, and on the four staff
 * surfaces it was the wrong shape. A modal locks the page behind it, traps the
 * keyboard, and mounts a hundred rows on top of a screen that is already
 * carrying the live order listeners — so pressing it on a busy restaurant
 * panel froze the interface for several seconds. The customer's app has none of
 * that weight behind it and the sheet is right there.
 *
 * The courier already worked this way and always had: `/courier/notifications` is
 * a page, and the comment on it says why. This is that decision applied to the
 * other three panels rather than left as one screen's exception.
 *
 * `null` means "this role reads them in a sheet" — the customer, and nobody
 * else. A path means the bell is a link and never opens anything in place.
 */
export function notificationsPagePath(role: UserRole | null | undefined): string | null {
  switch (role) {
    case UserRole.RESTAURANT_OWNER:
    case UserRole.RESTAURANT_MANAGER:
    case UserRole.RESTAURANT_STAFF:
      return '/panel/notifications';
    case UserRole.RESTAURANT_COURIER:
      return '/courier/notifications';
    case UserRole.OPERATOR:
      return `${OPERATOR_ROOT}/notifications`;
    case UserRole.SUPER_ADMIN:
      return `${ADMIN_ROOT}/notifications`;
    default:
      return null;
  }
}

export function notificationSettingsPath(role: UserRole | null | undefined): string {
  switch (role) {
    case UserRole.RESTAURANT_OWNER:
    case UserRole.RESTAURANT_MANAGER:
    case UserRole.RESTAURANT_STAFF:
      return '/panel/settings/notifications';
    case UserRole.RESTAURANT_COURIER:
      return '/courier/settings/notifications';
    case UserRole.OPERATOR:
      return `${OPERATOR_ROOT}/settings/notifications`;
    case UserRole.SUPER_ADMIN:
      return `${ADMIN_ROOT}/settings/notifications`;
    default:
      return '/account/settings/notifications';
  }
}

/**
 * The screen this account belongs on — for every role, not only the platform's.
 *
 * Used by the customer screens when they turn a work account away: a courier
 * who taps a bookmarked `/cart` is not shown an empty cart, they are sent to
 * their own panel and told why. One answer in one place, so "where does this
 * person live" cannot be spelled five different ways in five components.
 */
export function accountHome(role: UserRole | null | undefined): string {
  switch (role) {
    case UserRole.RESTAURANT_OWNER:
    case UserRole.RESTAURANT_MANAGER:
    case UserRole.RESTAURANT_STAFF:
      return '/panel';
    case UserRole.RESTAURANT_COURIER:
      return '/courier';
    case UserRole.OPERATOR:
      return OPERATOR_ROOT;
    case UserRole.SUPER_ADMIN:
      return ADMIN_ROOT;
    default:
      return '/';
  }
}

export const ADMIN_NAV: NavItem[] = [
  { href: ADMIN_ROOT, labelKey: 'nav.dashboard', icon: 'layout-dashboard', permission: Permission.PLATFORM_VIEW_ORDERS, group: 'main' },
  { href: `${ADMIN_ROOT}/orders`, labelKey: 'nav.orders', icon: 'receipt', permission: Permission.PLATFORM_VIEW_ORDERS, group: 'main' },
  { href: `${ADMIN_ROOT}/restaurants`, labelKey: 'nav.restaurants', icon: 'store', permission: Permission.PLATFORM_VIEW_RESTAURANTS, group: 'main' },
  { href: `${ADMIN_ROOT}/users`, labelKey: 'nav.users', icon: 'users', permission: Permission.PLATFORM_VIEW_USERS, group: 'main' },
  { href: `${ADMIN_ROOT}/coupons`, labelKey: 'nav.coupons', icon: 'ticket', permission: Permission.PLATFORM_MANAGE_COUPONS, group: 'growth' },
  { href: `${ADMIN_ROOT}/reviews`, labelKey: 'nav.reviews', icon: 'star', permission: Permission.PLATFORM_MODERATE_REVIEWS, group: 'growth' },
  { href: `${ADMIN_ROOT}/complaints`, labelKey: 'nav.complaints', icon: 'alert', permission: Permission.PLATFORM_RESOLVE_COMPLAINTS, group: 'main' },
  { href: `${ADMIN_ROOT}/support`, labelKey: 'nav.support', icon: 'chat', permission: Permission.PLATFORM_SUPPORT_CHAT, group: 'main' },
  { href: `${ADMIN_ROOT}/finance`, labelKey: 'nav.ledger', icon: 'wallet', permission: Permission.PLATFORM_VIEW_LEDGER, group: 'management' },
  { href: `${ADMIN_ROOT}/payments`, labelKey: 'nav.payments', icon: 'credit-card', permission: Permission.PLATFORM_VIEW_LEDGER, group: 'management' },
  { href: `${ADMIN_ROOT}/audit`, labelKey: 'nav.audit', icon: 'scroll-text', permission: Permission.PLATFORM_VIEW_AUDIT, group: 'management' },
  // "It says my number is already registered, and it is not." The one screen
  // that can answer that — see `functions/src/users/locks.ts`.
  { href: `${ADMIN_ROOT}/account-locks`, labelKey: 'nav.accountLocks', icon: 'key-round', permission: Permission.PLATFORM_CHANGE_USER_STATUS, group: 'system' },
  { href: `${ADMIN_ROOT}/settings`, labelKey: 'nav.settings', icon: 'settings', permission: Permission.PLATFORM_EDIT_SETTINGS, group: 'system' },
];

export function visibleNav(items: NavItem[], role: UserRole | null | undefined): NavItem[] {
  return items.filter((item) => hasPermission(role, item.permission));
}

export const NAV_GROUPS = ['main', 'growth', 'management', 'system'] as const;
