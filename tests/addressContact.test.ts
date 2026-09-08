/**
 * Who opens the door, and which number rings.
 *
 * The costly decision in here is `needsPhoneVerification`. A false positive
 * sends an SMS the platform pays for and interrupts a customer who did nothing
 * wrong; a false negative marks a stranger's number as proved. The first block
 * below is about that one function.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  ADDRESS_CODE_DAILY_LIMIT,
  ADDRESS_CODE_LENGTH,
  ADDRESS_CODE_MAX_ATTEMPTS,
  addressDeliverable,
  deliveryContact,
  isUsableContactName,
  needsPhoneVerification,
} from '../shared/addressContact';

const MINE = '+994501112233';
const THEIRS = '+994559998877';

describe('deciding whether to spend an SMS', () => {
  it('sends nothing when the address carries the account’s own verified number', () => {
    expect(
      needsPhoneVerification({
        addressPhone: MINE,
        accountPhone: MINE,
        accountPhoneVerified: true,
      }),
    ).toBe(false);
  });

  it('sends one when the number belongs to somebody else', () => {
    expect(
      needsPhoneVerification({
        addressPhone: THEIRS,
        accountPhone: MINE,
        accountPhoneVerified: true,
      }),
    ).toBe(true);
  });

  it('sends one when the account’s own number was never proved', () => {
    // Otherwise an unverified account would launder its own number into a
    // "verified" address without a single message being sent.
    expect(
      needsPhoneVerification({
        addressPhone: MINE,
        accountPhone: MINE,
        accountPhoneVerified: false,
      }),
    ).toBe(true);
  });

  it('asks for nothing when the address has no number at all', () => {
    // There is nothing to prove. `addressDeliverable` is what refuses to let
    // such an address be ordered to — this function is only about messages.
    expect(
      needsPhoneVerification({
        addressPhone: '',
        accountPhone: MINE,
        accountPhoneVerified: true,
      }),
    ).toBe(false);
  });

  it('ignores surrounding whitespace on both sides', () => {
    expect(
      needsPhoneVerification({
        addressPhone: ` ${MINE} `,
        accountPhone: MINE,
        accountPhoneVerified: true,
      }),
    ).toBe(false);
  });
});

describe('a name a courier can read out at a door', () => {
  it('accepts a name and a surname', () => {
    expect(isUsableContactName('Elvin Məmmədov')).toBe(true);
  });

  it('accepts a short surname — they exist', () => {
    expect(isUsableContactName('Aygün Li')).toBe(true);
  });

  it('collapses repeated spaces rather than refusing them', () => {
    expect(isUsableContactName('Elvin   Məmmədov')).toBe(true);
  });

  it('refuses a single word — a first name identifies nobody at a block of flats', () => {
    expect(isUsableContactName('Elvin')).toBe(false);
  });

  it('refuses an initial standing in for a surname', () => {
    expect(isUsableContactName('Elvin M')).toBe(false);
  });

  it('refuses empty, whitespace and missing', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(isUsableContactName(value)).toBe(false);
    }
  });
});

describe('is this address ready to receive an order', () => {
  const good = { contactName: 'Elvin Məmmədov', phone: MINE, phoneVerified: true };

  it('says yes when all three answers are there', () => {
    expect(addressDeliverable(good)).toEqual({ ok: true, reason: null });
  });

  it('names the missing piece, so the screen can say which', () => {
    expect(addressDeliverable({ ...good, contactName: 'Elvin' }).reason).toBe('NAME');
    expect(addressDeliverable({ ...good, phone: '' }).reason).toBe('PHONE');
    expect(addressDeliverable({ ...good, phoneVerified: false }).reason).toBe('UNVERIFIED');
  });

  it('refuses an address saved before any of this existed', () => {
    // Real rows sitting in Firestore right now. They are refused rather than
    // silently falling back to the account holder, because that silent
    // fallback is the behaviour this whole feature exists to end.
    expect(addressDeliverable({}).ok).toBe(false);
  });

  it('treats a merely truthy phoneVerified as unverified', () => {
    // `phoneVerified !== true`, not a loose check: a string, a 1, or anything
    // else that turned up in an old document must not read as proved.
    expect(addressDeliverable({ ...good, phoneVerified: undefined }).ok).toBe(false);
  });
});

describe('the pair the restaurant and the courier are shown', () => {
  it('prefers the address when it carries both halves', () => {
    expect(
      deliveryContact({
        addressContactName: 'Nigar Əliyeva',
        addressPhone: THEIRS,
        accountName: 'Elvin Məmmədov',
        accountPhone: MINE,
      }),
    ).toEqual({ name: 'Nigar Əliyeva', phone: THEIRS, fromAddress: true });
  });

  it('falls back to the account holder for an address written before this existed', () => {
    // An order to one of those must still reach somebody rather than showing a
    // restaurant an empty line.
    expect(
      deliveryContact({
        addressContactName: null,
        addressPhone: null,
        accountName: 'Elvin Məmmədov',
        accountPhone: MINE,
      }),
    ).toEqual({ name: 'Elvin Məmmədov', phone: MINE, fromAddress: false });
  });

  it('falls back when only one half is present — half a contact is not a contact', () => {
    expect(
      deliveryContact({
        addressContactName: 'Nigar Əliyeva',
        addressPhone: '',
        accountName: 'Elvin Məmmədov',
        accountPhone: MINE,
      }).fromAddress,
    ).toBe(false);
  });
});

describe('the limits are the ones the server actually applies', () => {
  const server = fs.readFileSync('functions/src/users/addressPhone.ts', 'utf8');
  const create = fs.readFileSync('functions/src/orders/create.ts', 'utf8');
  const account = fs.readFileSync('functions/src/users/account.ts', 'utf8');

  it('keeps the numbers sane', () => {
    expect(ADDRESS_CODE_LENGTH).toBe(6);
    expect(ADDRESS_CODE_MAX_ATTEMPTS).toBeLessThanOrEqual(5);
    expect(ADDRESS_CODE_DAILY_LIMIT).toBeGreaterThan(1);
    expect(ADDRESS_CODE_DAILY_LIMIT).toBeLessThanOrEqual(20);
  });

  it('never writes the code to a log', () => {
    /*
     * The single most important assertion in this file. A verification code in
     * Cloud Logging is a verification code in whatever reads the logs, and
     * Cloud Logging is readable by every project member.
     *
     * The match is on the VALUE, not on the word: `logger.info('address code
     * sent')` is a message and is fine, while `{ code }`, `code:` and
     * `${code}` are the variable itself reaching a log and are not.
     */
    const logs = server.match(/logger\.\w+\([\s\S]*?\);/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);

    for (const line of logs) {
      expect(line).not.toMatch(/\bcode\s*[,}]/);
      expect(line).not.toMatch(/\bcode\s*:/);
      expect(line).not.toContain('${code}');
    }
  });

  it('stores a hash and not the code', () => {
    expect(server).toContain('codeHash');
    expect(server).toContain('createHash');
  });

  it('counts a wrong answer before refusing it', () => {
    expect(server).toContain("ref.update({ attempts: pending.attempts + 1 })");
  });

  it('re-reads the number from the address before marking it proved', () => {
    // Otherwise: ask for a code to your own number, receive it, change the
    // address to a stranger's number, submit the code.
    expect(server).toContain("fail(AppErrorCode.CONFLICT, 'phone-changed')");
  });

  it('applies the daily cap, not only the per-minute one', () => {
    expect(server).toContain('ADDRESS_CODE_DAILY_LIMIT');
    expect(server).toContain("fail(AppErrorCode.RATE_LIMITED, 'daily')");
  });

  it('refuses to place an order to an address with no proved contact', () => {
    expect(create).toContain('addressDeliverable');
    expect(create).toContain('ADDRESS_NOT_DELIVERABLE');
  });

  it('decides phoneVerified on the server and never takes it from the request', () => {
    expect(account).toContain('const phoneVerified =');
    expect(account).not.toContain("data.phoneVerified");
  });
});
