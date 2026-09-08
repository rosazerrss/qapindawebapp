import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * THE SECURITY RULES, ASSERTED AS TEXT.
 *
 * WHY THIS IS NOT AN EMULATOR TEST, SAID PLAINLY
 * ----------------------------------------------
 * The real thing would run the Firestore emulator and try each read as each
 * role. That is the better test and it is not what this is: it needs a Java
 * runtime and a running emulator, which means it does not run on a laptop
 * without setup and does not run at all in the place this project is built. A
 * test that is usually skipped protects nothing.
 *
 * So this asserts the rules the way `indexes.test.ts` asserts queries — by
 * reading the file and checking that the decisions are still in it. It cannot
 * prove a rule *works*. It can prove that the ones deliberately written are
 * still there, and that is the failure actually worth catching: not "Firestore
 * evaluates this wrongly" but "somebody edited a line six months from now and
 * did not know what it was for".
 *
 * Every assertion below corresponds to a decision made once, for a reason, in
 * this project's history. The comment on each says which.
 */

const rules = readFileSync('firestore.rules', 'utf8');

/** The body of one `match /collection/{doc}` block, without its children. */
function blockFor(collection: string): string {
  const start = rules.indexOf(`match /${collection}/{`);
  expect(start, `no rule for ${collection}`).toBeGreaterThan(-1);

  // Walk braces from the block's opening one, so a nested `match` is included
  // and the next sibling collection is not.
  const open = rules.indexOf('{', rules.indexOf('\n', start));
  let depth = 0;

  for (let at = open; at < rules.length; at += 1) {
    if (rules[at] === '{') depth += 1;
    if (rules[at] === '}') {
      depth -= 1;
      if (depth === 0) return rules.slice(start, at + 1);
    }
  }

  throw new Error(`unbalanced braces in ${collection}`);
}

describe('firestore rules — the catch-all', () => {
  /**
   * The last rule in the file denies everything not named above it.
   *
   * Without it a collection nobody has written a rule for is not "closed", it
   * is simply unmatched — and a future feature that starts writing to a new
   * collection would find it silently unreachable, then get a `allow read,
   * write: if true` added in frustration. The deny-all is what makes adding a
   * rule the only way forward.
   */
  it('ends with a deny-all', () => {
    expect(rules).toContain('match /{document=**}');
    const tail = rules.slice(rules.indexOf('match /{document=**}'));
    expect(tail).toContain('allow read, write: if false');
  });

  it('never grants an unconditional write anywhere', () => {
    // `if true` on a write would hand the database to the internet. A read may
    // legitimately be public — the shopfront is — but a write never is.
    const writes = rules.match(/allow[^:]*write[^:]*:\s*if\s+true/g);
    expect(writes, 'an unconditional write exists').toBeNull();
  });
});

describe('firestore rules — money is never client-writable', () => {
  /**
   * Every financial collection is written by Cloud Functions alone.
   *
   * The admin SDK bypasses these rules entirely, so `allow write: if false`
   * costs the server nothing and removes the whole class of "a client edited
   * its own invoice".
   */
  it.each(['ledgerEntries', 'settlements', 'couponRedemptions', 'auditLogs'])(
    '%s is read-only to clients',
    (collection) => {
      expect(blockFor(collection)).toContain('allow write: if false');
    },
  );

  /**
   * The books belong to the admin, not to support.
   *
   * `PLATFORM_VIEW_LEDGER` was removed from the operator role because the
   * screens simply did not draw the finance pages for them — which is a
   * decision made in a browser, and a decision made in a browser is not a
   * rule. These two lines are the other half of that fix: an operator calling
   * the collection directly is refused by Firestore, not merely un-navigated.
   */
  it.each(['ledgerEntries', 'settlements'])('%s is not readable by an operator', (collection) => {
    const block = blockFor(collection);
    expect(block).toContain('isSuperAdmin()');
    expect(block, `${collection} still admits any platform role`).not.toMatch(
      /allow read: if isPlatform\(\)/,
    );
  });
});

describe('firestore rules — coupons cannot be enumerated', () => {
  /**
   * A readable coupon collection is a list of live discount codes.
   *
   * Codes are validated by a callable that answers "is this one valid for
   * you", never by letting a browser read the collection and pick.
   */
  it('is readable only by a super admin, and writable by nobody', () => {
    /*
     * `isSuperAdmin()`, not `isPlatform()`.
     *
     * An operator does not hold `PLATFORM_MANAGE_COUPONS`, and a readable
     * collection would hand them every unreleased campaign code before it
     * launched — the leak this block warns about for customers, one role up.
     * The callables were already closed to them; the rule was not.
     */
    const block = blockFor('coupons');
    expect(block).toContain('allow read: if isSuperAdmin()');
    expect(block).not.toContain('isPlatform()');
    expect(block).toContain('allow write: if false');
    // A customer must never be able to read the collection: their own coupons
    // come from `myCoupons`, which answers for one account.
    expect(block).not.toContain('signedIn()');
  });
});

describe('firestore rules — a complaint is not public', () => {
  /**
   * Complaints carry the complainant's real name and telephone number.
   *
   * They are served through `listComplaints`, which strips what the caller may
   * not see; the collection itself is closed so there is no second route.
   */
  it('is closed to clients entirely', () => {
    expect(blockFor('complaints')).toContain('allow read, write: if false');
  });
});

describe('firestore rules — the courier sees their own orders and nothing else', () => {
  /**
   * A courier is a restaurant account that is NOT restaurant staff.
   *
   * `isRestaurantStaff()` lists the three roles that may act for the
   * restaurant, and RESTAURANT_COURIER is deliberately not among them — so a
   * courier reaches an order only by being the one written on it. This is the
   * same distinction that had to be fixed in `actorFor()` on the server, where
   * a matching `restaurantId` alone was letting drivers close orders.
   */
  it('reaches an order through the courier field, not the restaurant id', () => {
    const block = blockFor('orders');
    expect(block).toContain('uid() == resource.data.courier.id');
    // The defensive read: most orders have no courier, and reaching into a
    // null field is an error, which Firestore treats as a denial for every
    // reader — including the customer who would have passed on an earlier
    // clause.
    expect(block).toContain("get('courier', null)");
  });

  /**
   * And can read what happened to it.
   *
   * The events subcollection listed two readers — the customer and the
   * restaurant — while its parent admitted three. Nothing visibly broke,
   * because no courier screen draws a timeline yet; it was a clause left out
   * by forgetting rather than by decision, which is exactly what this file is
   * for.
   */
  it('can read the timeline of an order it is carrying', () => {
    const events = rules.slice(rules.indexOf('match /events/{eventId}'));
    const block = events.slice(0, events.indexOf('match /private'));
    expect(block).toContain('order.courier.id == uid()');
  });
});

describe('firestore rules — a customer owns their own data', () => {
  it('keeps addresses private to their owner', () => {
    const block = blockFor('users');
    expect(block).toContain('match /addresses/{addressId}');
    expect(block).toContain('uid() == userId');
  });

  /**
   * Fraud signals are the platform's, not the restaurant's.
   *
   * A restaurant seeing a customer's device history and IP addresses is a
   * different product from the one this is.
   */
  it('keeps device and fraud signals away from every client', () => {
    // Stricter than "platform only": not even an admin reads these from a
    // browser. They are written and read by Cloud Functions, which bypass
    // these rules entirely, so closing the collection costs nothing.
    expect(blockFor('deviceSignals')).toContain('allow read, write: if false');
  });
});

describe('firestore rules — notifications are the one field a client may write', () => {
  /**
   * Marking your own notification read is a client write, and the only one.
   *
   * Everything else about a notification — that it exists, what it says, who
   * it is for — is the server's. The rule is narrow on purpose: a client that
   * could write the body could write itself a message from Qapında.
   */
  it('is scoped to the recipient and to the fields it may touch', () => {
    const block = blockFor('notifications');
    expect(block).toContain('uid()');

    // Creating or deleting one is the server's alone: a client that could
    // create a notification could write itself a message from Qapında.
    expect(block).toContain('allow create, delete: if false');

    // And an update may only move the status, never the words. `changed()` is
    // the helper that pins each field it is allowed to touch.
    expect(block).toContain("changed('status')");
    expect(block).toContain("changed('title')");
  });
});
