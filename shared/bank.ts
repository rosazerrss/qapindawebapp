/**
 * QAPINDA — Bank details.
 *
 * The platform pays restaurants, and restaurants pay the platform, by bank
 * transfer. That is the whole of it: an account holder, an IBAN and a bank
 * name. No card number, no CVV, no expiry date is ever accepted or stored
 * anywhere in Qapında — card data is typed on the provider's own page and never
 * touches this system, and a payout form is not a reason to make an exception.
 *
 * `looksLikeCardNumber` exists because a form that says "account number" will
 * eventually have a card number typed into it by somebody being helpful. It is
 * refused rather than quietly stored.
 */

/** Uppercase, no spaces — the form people write IBANs in on paper. */
export function normaliseIban(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/** Grouped in fours, which is how a person checks one against a statement. */
export function formatIban(iban: string): string {
  return normaliseIban(iban).replace(/(.{4})/g, '$1 ').trim();
}

/**
 * The IBAN check digits, per ISO 13616.
 *
 * A typo in an IBAN sends money to nobody or, worse, to somebody. The mod-97
 * check catches almost every single-character slip at the moment it is typed,
 * which is the only moment anyone can still fix it cheaply.
 */
export function isValidIban(input: string): boolean {
  const iban = normaliseIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);

  // Worked through in chunks: the whole number is far past the safe integer
  // range, and doing this with `Number` would be exactly the floating-point
  // arithmetic about money this project forbids.
  let remainder = 0;
  for (const character of rearranged) {
    const value = character >= 'A' && character <= 'Z' ? character.charCodeAt(0) - 55 : character;
    remainder = Number(`${remainder}${value}`) % 97;
  }

  return remainder === 1;
}

/** Azerbaijani IBANs are 28 characters and start with AZ. */
export function isAzerbaijaniIban(input: string): boolean {
  const iban = normaliseIban(input);
  return iban.startsWith('AZ') && iban.length === 28 && isValidIban(iban);
}

/**
 * Whether a string looks like a payment card rather than an account.
 *
 * Deliberately blunt: thirteen to nineteen digits, however they are spaced. A
 * few genuine account numbers will be caught by it, and being told "that looks
 * like a card number" is a far better outcome than a card number sitting in a
 * database that was never designed to hold one.
 */
export function looksLikeCardNumber(input: string): boolean {
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{13,19}$/.test(digits);
}

/**
 * An IBAN reduced to what an audit trail actually needs.
 *
 * WHY THE AUDIT LOG MUST NOT HOLD THE WHOLE NUMBER
 * ------------------------------------------------
 * The payout IBAN is one of the two things worth stealing from this platform,
 * and `auditLogs` is readable by every operator — support staff, often
 * outsourced, often temporary. The ledger and the settlement documents were
 * deliberately narrowed to a super admin to keep bank details away from that
 * role; writing the full IBAN into an audit row handed it straight back
 * through a collection nobody thought of as financial.
 *
 * What an audit trail is FOR is answering "who changed this, when, and was it
 * the same account as last month". Neither question needs the digits:
 *
 *   • `AZ21…4519` is enough for a person to recognise the account on a
 *     statement, and useless for sending money anywhere;
 *   • a reader comparing two rows can still see that the number changed,
 *     because the visible ends and the length change with it.
 *
 * The real number stays in `restaurants/{id}/private/business`, where exactly
 * two roles can read it and the reason for each is written down.
 */
export function maskIban(input: string | null | undefined): string | null {
  if (!input) return null;

  const iban = normaliseIban(input);
  // Too short to mask meaningfully — showing four of six characters would
  // reveal most of it, so show none.
  if (iban.length < 10) return '••••';

  return `${iban.slice(0, 4)}••••${iban.slice(-4)}`;
}
