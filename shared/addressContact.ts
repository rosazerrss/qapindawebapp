/**
 * QAPINDA — Who opens the door, and which number rings.
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * THE PROBLEM
 * -----------
 * The restaurant and its courier were being given the *account holder's*
 * telephone number. For most orders that is the right number and nobody
 * notices. For the ones where it is wrong it is badly wrong: food sent to a
 * parent's flat, to an office reception, to a friend who is actually home — the
 * driver stands in the street ringing somebody who is at work in another
 * district and cannot open the door. The order is then recorded as "customer
 * unreachable", and the person who ordered it finds out when they get home.
 *
 * So a delivery address now carries its own name and its own number, both
 * required, and that pair is what travels onto the order and what the
 * restaurant, the courier, the operator and the printed slip all show. The
 * account's phone remains the identity — it is what signs in and what the "one
 * customer, one account" rule is enforced on — and it is no longer what a
 * stranger is handed.
 *
 * WHY THE NUMBER HAS TO BE VERIFIED
 * ---------------------------------
 * Unverified, this field is a way to send an unwanted courier to any telephone
 * number in Baku: type somebody's number, order food to their street, and their
 * phone rings from a driver they have never heard of. It is also a way to make
 * a delivery fail on purpose — a mistyped digit and the food comes back.
 *
 * A number that has been proved once is proved for that address. It is NOT
 * re-proved per order: the address is the thing being verified, not the
 * delivery, and asking somebody for a code every time they order dinner is how
 * a checkout gets abandoned.
 *
 * WHEN NO MESSAGE IS SENT AT ALL
 * ------------------------------
 * If the number on the address is the account's own — already proved by SMS at
 * registration, and it is the common case — there is nothing to prove and no
 * message is sent. That is not an optimisation bolted on afterwards; it is the
 * correct answer, and it also happens to mean the platform pays for a message
 * only in the "somebody else's door" case, once per address, ever.
 */

/**
 * The code the person types back.
 *
 * Six digits, like every other code in this product and like every code an
 * Azerbaijani phone receives from a bank. Four would be guessable inside the
 * attempt limit; eight is a number people read back wrong.
 */
export const ADDRESS_CODE_LENGTH = 6;

/** How long a code is good for. Long enough to find the phone, not to leave. */
export const ADDRESS_CODE_TTL_MINUTES = 10;

/**
 * Wrong answers before the code is dead.
 *
 * Five. A six-digit code has a million values, so five guesses is nowhere near
 * a threat on its own — the limit exists so that an automated attempt against
 * one code cannot run for hours, and so that a person who is clearly reading
 * the wrong message is told so rather than left trying.
 */
export const ADDRESS_CODE_MAX_ATTEMPTS = 5;

/**
 * The wait before another message may be asked for.
 *
 * Sixty seconds. Every one of these costs the platform money and costs the
 * recipient an interruption, and "send it again" pressed four times in eight
 * seconds is a person who has not looked at their phone yet.
 */
export const ADDRESS_CODE_RESEND_SECONDS = 60;

/**
 * How many codes one account may ask for in a day, across all addresses.
 *
 * The cap that actually matters. Without it, an account is a free SMS gun
 * pointed at any number in the country: change the address's phone, ask for a
 * code, repeat. Ten is far above what an honest person needs — most people
 * verify one or two addresses in their life — and far below what is worth
 * doing to somebody.
 */
export const ADDRESS_CODE_DAILY_LIMIT = 10;

/**
 * A name a courier can read out at a door.
 *
 * Both halves, because "Elvin" at a block of forty flats identifies nobody, and
 * the whole point of this field is that the driver can say who they are looking
 * for. Two characters is the floor for each half — there are real short
 * surnames — and the check is on the *pair*, not on a spelling.
 */
export const CONTACT_NAME_MIN = 4;
export const CONTACT_NAME_MAX = 80;

export function isUsableContactName(value: string | null | undefined): boolean {
  const trimmed = (value ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length < CONTACT_NAME_MIN || trimmed.length > CONTACT_NAME_MAX) return false;

  // Two words, each of at least two letters. A single word is a first name, and
  // a first name at a block of flats is not an answer to "who am I asking for".
  const parts = trimmed.split(' ').filter((part) => part.length >= 2);
  return parts.length >= 2;
}

/**
 * Does this address's number need a code sent to it?
 *
 * `false` when it is the account's own verified number — that one was proved by
 * SMS at registration and proving it twice tells nobody anything. This is the
 * single most important line in the file for what the platform spends: the
 * common case sends no message at all.
 */
export function needsPhoneVerification(input: {
  addressPhone: string | null | undefined;
  accountPhone: string | null | undefined;
  accountPhoneVerified: boolean;
}): boolean {
  const address = (input.addressPhone ?? '').trim();
  if (!address) return false;

  if (!input.accountPhoneVerified) return true;

  const account = (input.accountPhone ?? '').trim();
  return account === '' || address !== account;
}

/**
 * Is this address ready to receive an order?
 *
 * The three questions asked at checkout, in one place, so the button on the
 * screen and the refusal on the server cannot disagree — a cart that lets
 * somebody press "order" and then refuses is worse than one that explains
 * first.
 */
export function addressDeliverable(address: {
  contactName?: string | null;
  phone?: string | null;
  phoneVerified?: boolean;
}): { ok: boolean; reason: 'NAME' | 'PHONE' | 'UNVERIFIED' | null } {
  if (!isUsableContactName(address.contactName)) return { ok: false, reason: 'NAME' };
  if (!(address.phone ?? '').trim()) return { ok: false, reason: 'PHONE' };
  if (address.phoneVerified !== true) return { ok: false, reason: 'UNVERIFIED' };
  return { ok: true, reason: null };
}

/**
 * The name and number the restaurant is shown for an order.
 *
 * Falls back to the account holder for every address saved before this existed.
 * Those are real rows sitting in Firestore right now, and an order to one of
 * them must still reach somebody rather than showing a restaurant an empty
 * line — so the old behaviour is what "no contact on the address" means, and
 * `addressDeliverable` is what stops new ones being saved that way.
 */
export function deliveryContact(input: {
  addressContactName?: string | null;
  addressPhone?: string | null;
  accountName: string;
  accountPhone: string;
}): { name: string; phone: string; fromAddress: boolean } {
  const name = (input.addressContactName ?? '').trim();
  const phone = (input.addressPhone ?? '').trim();

  if (name && phone) return { name, phone, fromAddress: true };
  return { name: input.accountName, phone: input.accountPhone, fromAddress: false };
}
