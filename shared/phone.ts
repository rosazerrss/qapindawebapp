/**
 * QAPINDA — Phone number display.
 *
 * Numbers are stored E.164 (`+994501234567`) and typed in a dozen different
 * shapes by a dozen different people. Everywhere a number reaches a screen it
 * must read the same way: `+994 50 123 45 67` — country code, two-digit
 * operator code, then 3-2-2. This is the one place that grouping is decided.
 *
 * The server is the source of truth for what counts as a *valid* Azerbaijani
 * number (`AZ_PHONE` in `functions/src/lib/validate.ts`); this file only
 * decides how a shape that already looks like `+994` plus nine digits gets
 * spaced out for a human to read. A number that does not have that shape —
 * a foreign number, a placeholder, a legacy free-text value from before this
 * rule existed — is returned exactly as stored. Guessing at a shape it does
 * not have would risk truncating or reordering digits, which is worse than
 * printing them unformatted.
 */

const AZ_E164 = /^\+994(\d{9})$/;

/** `+994501234567` → `+994 50 123 45 67`. Anything else comes back unchanged. */
export function formatPhone(e164: string): string {
  const match = AZ_E164.exec(e164);
  if (!match) return e164;

  const digits = match[1];
  return `+994 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)}`;
}
