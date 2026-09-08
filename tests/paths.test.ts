import { describe, expect, it } from 'vitest';

import { paths } from '../shared/collections';

/**
 * A path is never built out of a missing id.
 *
 * This is the test for a crash the owner actually saw: four admin screens
 * throwing `Cannot read properties of undefined (reading 'indexOf')` out of a
 * promise, from deep inside the Firebase SDK, with nothing in the stack naming
 * the caller. That is what `ResourcePath.fromString(undefined)` looks like, and
 * everything that reaches it comes through this file.
 *
 * The rule these cases enforce is not "validate the input" for its own sake. It
 * is that a broken path must FAIL rather than be built:
 * `restaurants/undefined/private/business` is a perfectly legal document path,
 * so a caller that has lost an id ends up quietly subscribed to a document that
 * cannot exist — a screen that is wrong instead of a screen that is broken, and
 * the worse of the two by a long way.
 */

/** The builders that take a single id, and a value that is valid for each. */
const SINGLE: Array<[string, (value: string) => string, string]> = [
  ['user', paths.user, 'uid-1'],
  ['userAddresses', paths.userAddresses, 'uid-1'],
  ['userFavourites', paths.userFavourites, 'uid-1'],
  ['emailVerification', paths.emailVerification, 'uid-1'],
  ['restaurant', paths.restaurant, 'rest-1'],
  ['restaurantBusiness', paths.restaurantBusiness, 'rest-1'],
  ['order', paths.order, 'order-1'],
  ['orderEvents', paths.orderEvents, 'order-1'],
  ['orderPrivateMeta', paths.orderPrivateMeta, 'order-1'],
  ['deliveryCode', paths.deliveryCode, 'order-1'],
  ['review', paths.review, 'order-1'],
  ['complaint', paths.complaint, 'order-1'],
  ['payment', paths.payment, 'pay-1'],
  ['menuCategory', paths.menuCategory, 'cat-1'],
  ['product', paths.product, 'prod-1'],
  ['supportTicket', paths.supportTicket, 'ticket-1'],
  ['supportTicketMessages', paths.supportTicketMessages, 'ticket-1'],
  ['supportFeedback', paths.supportFeedback, 'ticket-1'],
  ['conversation', paths.conversation, 'rest-1'],
  ['conversationMessages', paths.conversationMessages, 'rest-1'],
  ['ledgerEntry', paths.ledgerEntry, 'entry-1'],
  ['notification', paths.notification, 'note-1'],
  ['auditLog', paths.auditLog, 'log-1'],
  ['idempotencyKey', paths.idempotencyKey, 'key-1'],
  ['deviceSignal', paths.deviceSignal, 'device-1'],
  ['coupon', paths.coupon, 'ILKSIFARIS'],
];

describe('path builders', () => {
  it.each(SINGLE)('%s builds the path it is asked for', (_name, build, value) => {
    const path = build(value);
    expect(path).toContain(value);
    // Never an empty segment: "a//b" is the other way a bad id reaches the SDK.
    expect(path).not.toContain('//');
    expect(path.split('/').every((segment) => segment.length > 0)).toBe(true);
  });

  it.each(SINGLE)('%s refuses an undefined id', (_name, build) => {
    // Exactly what the crash was: a component subscribing before the id it
    // needs has arrived.
    expect(() => build(undefined as unknown as string)).toThrow(/non-empty string/);
  });

  it.each(SINGLE)('%s refuses an empty id', (_name, build) => {
    expect(() => build('')).toThrow(/non-empty string/);
    expect(() => build('   ')).toThrow(/non-empty string/);
  });

  // The coupon is left out: its key is the normalised code, and normalising
  // removes a "/" rather than carrying it into the path.
  it.each(SINGLE.filter(([name]) => name !== 'coupon'))(
    '%s refuses an id with a slash in it',
    (_name, build) => {
      // A "/" would silently move the document somewhere else entirely, which
      // is how an id read out of user input becomes a path traversal.
      expect(() => build('a/b')).toThrow(/may not contain/);
    },
  );

  it('names the builder and the argument, so the caller can be found', () => {
    // The whole reason this throws rather than returning something broken: the
    // SDK's own error says nothing about which id was missing.
    expect(() => paths.restaurantBusiness(undefined as unknown as string)).toThrow(
      /paths\.restaurantBusiness\(\): "restaurantId"/,
    );
  });

  it('checks both halves of a two-part path', () => {
    expect(paths.userAddress('uid-1', 'addr-1')).toBe('users/uid-1/addresses/addr-1');
    expect(() => paths.userAddress('uid-1', undefined as unknown as string)).toThrow(
      /"addressId"/,
    );
    expect(() => paths.userAddress('', 'addr-1')).toThrow(/"uid"/);

    expect(paths.settlement('rest-1', '2026-09')).toBe('settlements/rest-1_2026-09');
    expect(() => paths.settlement('rest-1', '')).toThrow(/"period"/);

    expect(paths.couponRedemption('SALAM', 'cust-1', 'order-1')).toBe(
      'couponRedemptions/SALAM_cust-1_order-1',
    );
    expect(() => paths.couponRedemption('SALAM', '', 'order-1')).toThrow(/"customerId"/);
  });

  it('checks the value a key is actually built from, not the value passed in', () => {
    /*
     * The locks and the coupon are keyed by a NORMALISED value, and the
     * normalisers can empty a string that looked fine: a phone with no digits
     * in it, an email with nothing before the "@", a coupon code of punctuation.
     * Left unchecked, all of those would write to one shared document — a lock
     * held by every malformed input at once.
     */
    expect(paths.phoneLock('+994 50 123 45 67')).toBe('phoneIndex/994501234567');
    expect(() => paths.phoneLock('++')).toThrow(/non-empty string/);

    expect(paths.emailLock('A.B+tag@Gmail.com')).toBe('emailIndex/ab@gmail.com');
    expect(() => paths.emailLock('')).toThrow(/non-empty string/);

    expect(paths.coupon(' ilksifaris ')).toBe('coupons/ILKSIFARIS');
    expect(() => paths.coupon('!!!')).toThrow(/non-empty string/);
  });

  it('needs nothing at all for the one document that has no id', () => {
    expect(paths.publicSettings()).toBe('systemSettings/public');
  });
});
