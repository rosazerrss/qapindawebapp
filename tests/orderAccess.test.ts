import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { UserRole } from '../shared/enums';
import { accountHome, isWorkAccount, mayOrderFood } from '../shared/permissions';

/**
 * WHO MAY ORDER FOOD.
 *
 * The rule the owner asked for: a customer orders, and nobody else — not a
 * restaurant, not its manager, not the person on the till, not the driver, not
 * an operator, not the admin, and not a restaurant ordering from its own shop.
 *
 * It is worth being precise about what is asserted where. The predicate below
 * is executed for all seven roles, because it is the thing every layer asks.
 * The layers themselves are asserted by reading their source: a unit test
 * cannot run a Cloud Function or a security rule, and the failure this file
 * exists to prevent is not "the predicate is wrong" — it is somebody deleting
 * the one line that calls it, which is invisible to a test of the predicate
 * alone.
 */

const EVERY_ROLE = Object.values(UserRole);

describe('only a customer may order food', () => {
  it('allows the customer', () => {
    expect(mayOrderFood(UserRole.CUSTOMER)).toBe(true);
    expect(isWorkAccount(UserRole.CUSTOMER)).toBe(false);
  });

  it.each([
    UserRole.RESTAURANT_OWNER,
    UserRole.RESTAURANT_MANAGER,
    UserRole.RESTAURANT_STAFF,
    UserRole.RESTAURANT_COURIER,
    UserRole.OPERATOR,
    UserRole.SUPER_ADMIN,
  ])('refuses %s', (role) => {
    expect(mayOrderFood(role)).toBe(false);
    expect(isWorkAccount(role)).toBe(true);
  });

  it('covers every role there is, so a new one cannot be forgotten', () => {
    // Exactly one of the seven may order. If a role is added and this number
    // moves, somebody has to decide deliberately which side it is on.
    expect(EVERY_ROLE.filter((role) => mayOrderFood(role))).toEqual([UserRole.CUSTOMER]);
    expect(EVERY_ROLE).toHaveLength(7);
  });

  it('treats a signed-out visitor as neither', () => {
    // A guest fills a basket and signs in at the checkout; that flow must not
    // be mistaken for a work account and closed off.
    expect(isWorkAccount(null)).toBe(false);
    expect(isWorkAccount(undefined)).toBe(false);
    expect(mayOrderFood(null)).toBe(false);
  });
});

describe('every work role has somewhere of its own to be sent', () => {
  it.each([
    [UserRole.RESTAURANT_OWNER, '/panel'],
    [UserRole.RESTAURANT_MANAGER, '/panel'],
    [UserRole.RESTAURANT_STAFF, '/panel'],
    [UserRole.RESTAURANT_COURIER, '/courier'],
  ])('sends %s to %s', (role, path) => {
    expect(accountHome(role)).toBe(path);
  });

  it('sends the platform roles to their own panels, not to each other', () => {
    expect(accountHome(UserRole.OPERATOR)).not.toBe(accountHome(UserRole.SUPER_ADMIN));
  });

  it('leaves a customer on the shopfront', () => {
    expect(accountHome(UserRole.CUSTOMER)).toBe('/');
  });
});

describe('the server gate', () => {
  const source = readFileSync('functions/src/orders/create.ts', 'utf8');
  const auth = readFileSync('functions/src/lib/auth.ts', 'utf8');

  it('refuses a non-customer in createOrder and previewOrder', () => {
    expect(source).toContain("requireCustomerAccount(user, 'createOrder')");
    expect(source).toContain("requireCustomerAccount(user, 'previewOrder')");
  });

  it('checks the role before anything is read or priced', () => {
    // A gate that runs after the menu, the coupon counts and the pricing has
    // already been done is a gate that has already leaked what it guards.
    const gate = source.indexOf("requireCustomerAccount(user, 'createOrder')");
    const firstRead = source.indexOf('db.doc(paths.restaurant(restaurantId)).get()');
    expect(gate).toBeGreaterThan(-1);
    expect(firstRead).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstRead);
  });

  it('reads the role from the stored user document, not from the request', () => {
    // `requireActiveUser` re-reads users/{uid}; the guard takes that document.
    // A token can be an hour out of date, and the request body is whatever the
    // caller felt like sending.
    expect(auth).toContain('export function requireCustomerAccount(user: User');
    expect(auth).toContain('mayOrderFood(user.role)');
    expect(auth).not.toContain('mayOrderFood(caller.role)');
  });

  it('says why in the log and not on the screen', () => {
    expect(auth).toContain("logger.warn('work account attempted a customer action'");
    expect(auth).toContain('fail(AppErrorCode.WORK_ACCOUNT_CANNOT_ORDER)');
  });
});

describe('the rules layer', () => {
  const rules = readFileSync('firestore.rules', 'utf8');

  it('lets no client create, update or delete an order', () => {
    expect(rules).toContain('allow create, update, delete: if false;');
  });

  it('states the role rule in the comments, so the silence is legible', () => {
    // `create: if false` refuses everybody, which is stronger than a role
    // clause — but a reader has to be told that is deliberate, or the next
    // person "fixes" it by adding one.
    const orders = rules.slice(rules.indexOf('match /orders/{orderId}'));
    expect(orders).toContain('only a CUSTOMER');
    expect(orders).toContain('createOrder');
  });
});

describe('exactly one place writes an order document', () => {
  it('is createOrder', () => {
    // Blocking order creation is what closes coupons, first-order discounts,
    // commission and the sales figures to a work account all at once. That
    // only holds while there is one door.
    const files = [
      'functions/src/orders/create.ts',
      'functions/src/orders/status.ts',
      'functions/src/orders/jobs.ts',
      'functions/src/orders/delivery.ts',
      'functions/src/payments/flow.ts',
    ];

    const creators = files.filter((file) =>
      readFileSync(file, 'utf8').includes('collection(COLLECTIONS.orders).doc()'),
    );

    expect(creators).toEqual(['functions/src/orders/create.ts']);
  });
});

describe('a work phone cannot become a customer account', () => {
  const source = readFileSync('functions/src/users/account.ts', 'utf8');

  it('asks who holds the phone lock before refusing', () => {
    expect(source).toContain('isWorkAccount(holderRole)');
    expect(source).toContain('fail(AppErrorCode.WORK_PHONE_NOT_CUSTOMER)');
  });

  it('still refuses a second customer account on the same number', () => {
    // The standing rule — one phone, one email, one account — is unchanged.
    // All that is new is which sentence the person is shown.
    expect(source).toContain('fail(AppErrorCode.PHONE_ALREADY_REGISTERED)');
  });

  it('does every read before it writes the locks', () => {
    const body = source.slice(
      source.indexOf('const existingRole = await db.runTransaction'),
      source.indexOf('await setUserClaims'),
    );
    const lastRead = body.lastIndexOf('tx.get(');
    const firstWrite = Math.min(
      ...['tx.set(', 'tx.update(', 'tx.delete(']
        .map((token) => body.indexOf(token))
        .filter((index) => index !== -1),
    );

    expect(lastRead).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(lastRead).toBeLessThan(firstWrite);
  });
});

describe('the app hides what the server refuses', () => {
  it('gives a work account no cart, no checkout and no add button', () => {
    const files = [
      'src/app/cart/page.tsx',
      'src/app/checkout/page.tsx',
      'src/app/restaurant/[handle]/RestaurantView.tsx',
      'src/components/layout/AppShell.tsx',
    ];

    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).toContain('isWorkAccount(');
    }
  });

  it('has a translated sentence for the refusal in all three languages', () => {
    for (const locale of ['az', 'en', 'ru']) {
      const dictionary = JSON.parse(
        readFileSync(`src/i18n/translations/${locale}.json`, 'utf8'),
      ) as { errors: Record<string, string>; workAccount: Record<string, string> };

      expect(dictionary.errors.WORK_ACCOUNT_CANNOT_ORDER, locale).toBeTruthy();
      expect(dictionary.errors.WORK_PHONE_NOT_CUSTOMER, locale).toBeTruthy();
      expect(dictionary.workAccount.title, locale).toBeTruthy();
      // Never the raw gRPC word. The customer has done nothing wrong.
      expect(dictionary.errors.WORK_ACCOUNT_CANNOT_ORDER).not.toContain('PERMISSION_DENIED');
    }
  });
});
