'use client';

/**
 * A phone field that types itself into `+994 50 123 45 67` as you go.
 *
 * Built on top of `Input` for the label/hint/error chrome, but the value and
 * change handling are its own: the text on screen is always the spaced form,
 * while the value the parent gets back is plain E.164 (`+994501234567`), which
 * is what every callable on the server expects.
 *
 * The person may start typing `0501234567`, `501234567`, `994501234567` or
 * `+994501234567` — all four settle on the same national number, because
 * every keystroke is re-derived from the digits alone, not from the shape of
 * what came before. The server is still the one that decides whether the
 * number is *valid* (`AZ_PHONE` in `functions/src/lib/validate.ts`); this
 * component only stops a ninth digit from becoming a tenth.
 */

import { forwardRef, useEffect, useRef, type ChangeEvent } from 'react';

import { Input, type FieldProps } from './index';

const COUNTRY_CODE = '994';
const PREFIX = '+994';
const NATIONAL_LENGTH = 9;
const GROUP_SIZES = [2, 3, 2, 2];

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Whatever digits were typed or pasted, reduced to the national number: the
 * leading country code or trunk zero is not part of it, and nine digits is
 * all a mobile or Baku landline number ever has.
 *
 * Returns how many leading characters were consumed by that stripped prefix
 * too, so a caret position measured before stripping can be corrected after.
 */
function stripToNational(rawDigits: string): { national: string; stripped: number } {
  if (rawDigits.startsWith(COUNTRY_CODE)) {
    return { national: rawDigits.slice(3, 3 + NATIONAL_LENGTH), stripped: 3 };
  }
  if (rawDigits.startsWith('0')) {
    return { national: rawDigits.slice(1, 1 + NATIONAL_LENGTH), stripped: 1 };
  }
  return { national: rawDigits.slice(0, NATIONAL_LENGTH), stripped: 0 };
}

/** `501234567` → `50 123 45 67`. Partial input formats as far as it goes. */
function formatNational(national: string): string {
  let out = '';
  let idx = 0;
  for (const size of GROUP_SIZES) {
    if (idx >= national.length) break;
    if (out.length > 0) out += ' ';
    out += national.slice(idx, idx + size);
    idx += size;
  }
  return out;
}

function toDisplay(national: string): string {
  return national.length > 0 ? `${PREFIX} ${formatNational(national)}` : PREFIX;
}

/** Where the caret lands inside `formatNational(national)` after `digitCount` digits. */
function caretOffsetForDigits(national: string, digitCount: number): number {
  let out = '';
  let idx = 0;
  for (const size of GROUP_SIZES) {
    if (idx >= national.length) break;
    if (out.length > 0) out += ' ';
    const groupStart = idx;
    const group = national.slice(idx, idx + size);
    out += group;
    idx += size;
    if (digitCount <= idx) {
      return out.length - group.length + (digitCount - groupStart);
    }
  }
  return out.length;
}

export interface PhoneInputProps
  extends Omit<FieldProps, 'value' | 'onChange' | 'type' | 'inputMode' | 'maxLength'> {
  /** Stored E.164, or '' for no number yet. */
  value: string;
  /** Fires with E.164 — '' while the national number is empty. */
  onChange: (e164: string) => void;
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onChange, ...rest },
  forwardedRef,
) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const { national } = stripToNational(digitsOnly(value));
  const display = toDisplay(national);

  // The formatted text replaces itself every keystroke, which would otherwise
  // always shove the caret to the end. This restores it to where the digit the
  // person just typed actually landed, once the new text is on screen.
  useEffect(() => {
    if (pendingCaret.current === null) return;
    const el = innerRef.current;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    el?.setSelectionRange(pos, pos);
  }, [display]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const selStart = event.target.selectionStart ?? raw.length;

    const rawDigits = digitsOnly(raw);
    const digitsBeforeCaret = digitsOnly(raw.slice(0, selStart)).length;

    const { national: nextNational, stripped } = stripToNational(rawDigits);
    const nationalDigitsBeforeCaret = Math.min(
      nextNational.length,
      Math.max(0, digitsBeforeCaret - stripped),
    );

    pendingCaret.current =
      nextNational.length > 0
        ? PREFIX.length + 1 + caretOffsetForDigits(nextNational, nationalDigitsBeforeCaret)
        : PREFIX.length;

    onChange(nextNational.length > 0 ? `${PREFIX}${nextNational}` : '');
  };

  return (
    <Input
      ref={(node) => {
        innerRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      value={display}
      onChange={handleChange}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      maxLength={PREFIX.length + 1 + GROUP_SIZES.length + NATIONAL_LENGTH - 1}
      {...rest}
    />
  );
});
