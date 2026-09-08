/**
 * QAPINDA — What counts as an identity, and what only looks like one.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * THE RULE THIS FILE EXISTS TO PROTECT
 * ------------------------------------
 * One customer, one telephone, one email, one account. It is the owner's rule
 * and it is what makes coupon limits, cancellation limits and complaint
 * history mean anything at all: an account somebody can have two of is an
 * account that enforces nothing.
 *
 * The telephone half is straightforward — a number is verified by SMS and
 * locked in `phoneIndex`. The email half is where the rule quietly breaks, and
 * it breaks on Apple.
 *
 * WHY AN APPLE PRIVATE RELAY ADDRESS IS NOT AN EMAIL
 * --------------------------------------------------
 * "Sign in with Apple" offers "Hide My Email", and most people take it. Apple
 * then hands the app an address like `a1b2c3d4e5@privaterelay.appleid.com`. It
 * is real — mail sent to it reaches the person — and it is unique.
 *
 * And it is worthless as an identity, because it is unique *per app, per
 * person, forever*. It can never collide with anything, so locking it can
 * never catch a duplicate: the moment the same person signs in with Google
 * using their real address, they get a second account and the "one email"
 * rule has been enforced twice, correctly, on two addresses belonging to one
 * human being. A lock that cannot collide is not a lock.
 *
 * Worse, it takes the slot the real address would have occupied. The person
 * has an account whose email is a string they have never seen and cannot type,
 * and the day they want their receipts somewhere they read, the address they
 * give is refused as "already registered" — by their own other account.
 *
 * So a relay address is treated as *no email*: the account is created with
 * `email: null`, nothing is locked, and the person is asked for a real one if
 * they want to give one. Apple still authenticates them; the phone number is
 * still the identity, as it is for everybody else. Nothing is lost, because
 * nothing that could be relied on was ever there.
 *
 * This is enforced on the server. The client applies it too, so the sign-up
 * form does not prefill a box with a string the person will not recognise —
 * but the client's copy is a courtesy and the server's copy is the rule.
 */

/** Where Apple's "Hide My Email" addresses come from. */
export const APPLE_PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com';

/**
 * Is this one of Apple's forwarding addresses?
 *
 * Matched on the domain rather than by a substring, so an ordinary address
 * that merely contains the words — `privaterelay.appleid.com.example.net` — is
 * not caught by it.
 */
export function isPrivateRelayEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return email.slice(at + 1).trim().toLowerCase() === APPLE_PRIVATE_RELAY_DOMAIN;
}

/**
 * The address worth storing and locking, or `null`.
 *
 * Everything that reads an email off an auth token goes through this, so the
 * decision above is made in exactly one place and cannot be forgotten by the
 * next thing that needs an email.
 */
export function usableEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  if (isPrivateRelayEmail(trimmed)) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Which door somebody came through
// ---------------------------------------------------------------------------

/** Firebase's provider ids, named once so no screen spells them itself. */
export const PROVIDER_ID = {
  PHONE: 'phone',
  GOOGLE: 'google.com',
  APPLE: 'apple.com',
} as const;
export type ProviderId = (typeof PROVIDER_ID)[keyof typeof PROVIDER_ID];

/**
 * The sign-in errors that are a *situation*, not a fault.
 *
 * Firebase reports these as ordinary exceptions with English messages meant
 * for a developer. Each one below is something a person did that makes sense
 * and that the screen has to answer with a sentence and a way forward, not
 * with a red string. They are named here so the sign-in screen and its tests
 * agree on the list.
 */
export const AUTH_SITUATION = {
  /**
   * The email behind this Google/Apple account already signs in another way.
   *
   * The person is not doing anything wrong: they made the account with their
   * telephone months ago and are now pressing the Google button, which is the
   * obvious thing to do. Creating a second account here is exactly what the
   * one-account rule forbids, so the screen sends them to the door that
   * already works.
   */
  DIFFERENT_CREDENTIAL: 'auth/account-exists-with-different-credential',
  /** The popup was blocked — the usual answer on a phone. Redirect instead. */
  POPUP_BLOCKED: 'auth/popup-blocked',
  /** Some in-app browsers refuse popups without saying they blocked one. */
  POPUP_UNSUPPORTED: 'auth/operation-not-supported-in-this-environment',
  /** The person closed it. Not an error, and not worth a red banner. */
  POPUP_CLOSED: 'auth/popup-closed-by-user',
  POPUP_CANCELLED: 'auth/cancelled-popup-request',
  /** The provider is not switched on in the Firebase console yet. */
  NOT_ENABLED: 'auth/operation-not-allowed',
} as const;

/** True when the failure means "try the redirect instead of a popup". */
export function shouldRetryWithRedirect(code: string): boolean {
  return code === AUTH_SITUATION.POPUP_BLOCKED || code === AUTH_SITUATION.POPUP_UNSUPPORTED;
}

/** True when the person simply shut the window. Say nothing. */
export function isPopupDismissal(code: string): boolean {
  return code === AUTH_SITUATION.POPUP_CLOSED || code === AUTH_SITUATION.POPUP_CANCELLED;
}
