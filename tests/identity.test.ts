import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  APPLE_PRIVATE_RELAY_DOMAIN,
  AUTH_SITUATION,
  isPopupDismissal,
  isPrivateRelayEmail,
  shouldRetryWithRedirect,
  usableEmail,
} from '../shared/identity';

/**
 * ONE CUSTOMER, ONE ACCOUNT — THE PARTS OF IT THAT ARE EASY TO LOSE.
 *
 * The rule is enforced by two locks, `phoneIndex` and `emailIndex`, and those
 * are covered where they are written. What is asserted here is the quieter
 * half: which strings are allowed to *become* a lock in the first place, and
 * whether the sign-in screen still has a route out of each situation where a
 * person legitimately ends up with the wrong door.
 */

describe('identity — an Apple relay address is not an email', () => {
  it('recognises the forwarding domain', () => {
    expect(isPrivateRelayEmail(`a1b2c3d4e5@${APPLE_PRIVATE_RELAY_DOMAIN}`)).toBe(true);
    // Case and stray whitespace come off tokens more often than one expects.
    expect(isPrivateRelayEmail(`  A1B2@${APPLE_PRIVATE_RELAY_DOMAIN.toUpperCase()}  `)).toBe(
      true,
    );
  });

  it('does not catch an ordinary address that merely contains the words', () => {
    // Matched on the domain, not by substring — otherwise somebody's real
    // address at a lookalike host would silently lose their email.
    expect(isPrivateRelayEmail('nurlan@privaterelay.appleid.com.example.net')).toBe(false);
    expect(isPrivateRelayEmail('privaterelay.appleid.com@gmail.com')).toBe(false);
    expect(isPrivateRelayEmail('nurlan@gmail.com')).toBe(false);
  });

  it('answers false for nothing at all rather than throwing', () => {
    expect(isPrivateRelayEmail(null)).toBe(false);
    expect(isPrivateRelayEmail(undefined)).toBe(false);
    expect(isPrivateRelayEmail('')).toBe(false);
    expect(isPrivateRelayEmail('not-an-email')).toBe(false);
  });

  /**
   * The decision itself.
   *
   * A relay address cannot collide with anything, so locking one can never
   * catch a duplicate — while it does occupy the slot the person's real
   * address needed. So it becomes no email at all.
   */
  it('keeps a real address and throws away a relay one', () => {
    expect(usableEmail('Nurlan@Gmail.com')).toBe('nurlan@gmail.com');
    expect(usableEmail(`x9y8@${APPLE_PRIVATE_RELAY_DOMAIN}`)).toBeNull();
    expect(usableEmail('  ')).toBeNull();
    expect(usableEmail(null)).toBeNull();
  });
});

describe('identity — the server is the copy that decides', () => {
  /**
   * The client applies the same test so the sign-up form does not prefill a
   * string nobody recognises. That is a courtesy. This is the rule: both places
   * a token's email can become a lock run it through `usableEmail` first.
   */
  it('filters the email in registerAccount and in linkEmail', () => {
    const account = readFileSync('functions/src/users/account.ts', 'utf8');
    expect(account).toContain("import { usableEmail } from '../shared/identity'");

    // registerAccount: both the typed address and the one off the token.
    expect(account).toContain("usableEmail(optionalEmail(data, 'email'))");
    expect(account).toContain('usableEmail(record.email)');

    // linkEmail refuses one outright rather than storing it.
    const link = account.slice(account.indexOf('export const linkEmail'));
    expect(link).toContain('usableEmail(optionalEmail(data');
    expect(link).toContain('fail(AppErrorCode.INVALID_EMAIL)');
  });
});

describe('identity — every sign-in situation has a way forward', () => {
  /** A blocked popup is the ordinary answer on a phone, not a failure. */
  it('retries with a redirect when the popup is refused', () => {
    expect(shouldRetryWithRedirect(AUTH_SITUATION.POPUP_BLOCKED)).toBe(true);
    expect(shouldRetryWithRedirect(AUTH_SITUATION.POPUP_UNSUPPORTED)).toBe(true);
    // But not for a real failure — retrying that one would loop.
    expect(shouldRetryWithRedirect(AUTH_SITUATION.NOT_ENABLED)).toBe(false);
    expect(shouldRetryWithRedirect(AUTH_SITUATION.DIFFERENT_CREDENTIAL)).toBe(false);
  });

  /** Closing the window is not an error and must not raise a red banner. */
  it('says nothing when the person shut the popup', () => {
    expect(isPopupDismissal(AUTH_SITUATION.POPUP_CLOSED)).toBe(true);
    expect(isPopupDismissal(AUTH_SITUATION.POPUP_CANCELLED)).toBe(true);
    expect(isPopupDismissal(AUTH_SITUATION.NOT_ENABLED)).toBe(false);
  });
});

describe('identity — the sign-in screen keeps the decisions it was given', () => {
  const page = readFileSync('src/app/login/page.tsx', 'utf8');

  /**
   * On a phone, a popup is frequently not available at all — iOS in-app
   * browsers block them, some without admitting it. Without the fallback the
   * Google button does nothing, silently, on the devices the orders come from.
   */
  it('falls back to a redirect', () => {
    expect(page).toContain('signInWithRedirect');
    expect(page).toContain('shouldRetryWithRedirect');
    // And reads what comes back: the redirect result is delivered exactly once,
    // and Apple's name is inside it.
    expect(page).toContain('getRedirectResult');
  });

  /**
   * Apple sends the name on the first authorisation ever and never again, so
   * an abandoned or reloaded sign-up destroys it permanently.
   */
  it('stashes the provider name against a reload', () => {
    expect(page).toContain('stashProviderName');
    expect(page).toContain('readStashedName');
    // And does not leave it behind for whoever uses this browser next.
    expect(page).toContain('clearStashedName');
  });

  /**
   * The email behind a Google account already signing in another way is one
   * person with one account, not two — so the screen sends them to the door
   * that works instead of opening a second one.
   */
  it('answers a credential clash by pointing at the phone', () => {
    expect(page).toContain('AUTH_SITUATION.DIFFERENT_CREDENTIAL');
    expect(page).toContain('auth.useYourPhoneInstead');
  });

  /**
   * And when the server refuses to register the new sign-in because the phone
   * or the email is already somebody's, the person is left signed in as an
   * identity that owns nothing. There has to be a door out of that screen.
   */
  it('offers a way out of a refused registration', () => {
    expect(page).toContain('setStranded');
    expect(page).toContain('auth.startOverWithPhone');
    // Signing out matters: leaving the half-made identity signed in would make
    // the next phone attempt a *link* to it, which is the write just refused.
    expect(page).toContain('signOut(auth)');
  });
});

describe('identity — the sentences exist in every language', () => {
  it.each(['az', 'en', 'ru'])('%s says all four', (lang) => {
    const dictionary = JSON.parse(
      readFileSync(`src/i18n/translations/${lang}.json`, 'utf8'),
    ) as { auth: Record<string, string> };

    for (const key of [
      'useYourPhoneInstead',
      'providerFailed',
      'popupBlocked',
      'startOverWithPhone',
      'providerDisabled',
    ]) {
      expect(dictionary.auth[key], `${lang}/${key}`).toBeTruthy();
    }
  });
});
