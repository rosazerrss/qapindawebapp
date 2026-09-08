'use client';

/**
 * The six digits from the SMS.
 *
 * WHY THIS IS NOT ONE TEXT FIELD
 * ------------------------------
 * It used to be, and one field is genuinely simpler. What it is not is
 * *legible*: a six-digit code typed into a single box gives no feedback about
 * how many digits are in and how many are left, and somebody reading a code off
 * a lock screen with one thumb loses their place. Six boxes answer both
 * questions without a word of instruction — how far along you are is the shape
 * of the thing.
 *
 * ONE REAL INPUT, SIX PAINTED BOXES
 * ---------------------------------
 * The classic version of this widget is six `<input>` elements with focus
 * juggled between them, and it breaks in all the ways focus juggling breaks:
 * iOS autofill fills the first box and drops the rest, paste lands entirely in
 * one box, backspace at an empty box goes nowhere, and a screen reader
 * announces six unlabelled fields.
 *
 * So there is exactly one input here, transparent and stretched across the
 * whole row, and the boxes are drawn underneath it. Autofill, paste, undo,
 * arrow keys, selection and the browser's own one-time-code handling all work
 * because they are working on an ordinary text field; the boxes are only ever a
 * picture of its value. The caret is hidden and drawn instead, so it can blink
 * in the right box rather than wherever the real caret happens to sit.
 */

import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/components/ui';

const LENGTH = 6;

export function OtpInput({
  value,
  onChange,
  /**
   * Fired the moment the sixth digit lands.
   *
   * Making the person type six digits and then reach for a button is asking
   * them to tell us something we already know. The button stays — it is the
   * way back from a mistyped code, and it is what a keyboard user presses —
   * but in the ordinary case the screen moves on by itself.
   */
  onComplete,
  disabled = false,
  /** Draws every box in the danger colour — a wrong code, shown on the code. */
  invalid = false,
  autoFocus = true,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  label: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  const digits = value.slice(0, LENGTH).split('');
  // The box the next digit will land in. Once six are in there is no next box,
  // so the highlight stays on the last one rather than falling off the end.
  const activeIndex = Math.min(digits.length, LENGTH - 1);

  useEffect(() => {
    if (autoFocus && !disabled) inputRef.current?.focus();
  }, [autoFocus, disabled]);

  /*
   * Fired from the value, not from the keystroke.
   *
   * A paste, an SMS autofill and six taps all arrive differently but all end
   * with the same six characters in `value`, and this is the one place that
   * sees all three. `fired` stops a re-render from submitting twice — and is
   * released when the code shrinks again, so correcting a digit and retyping it
   * still submits.
   */
  const fired = useRef(false);
  useEffect(() => {
    if (value.length < LENGTH) {
      fired.current = false;
      return;
    }
    if (fired.current) return;
    fired.current = true;
    onComplete?.(value);
  }, [value, onComplete]);

  return (
    <div className="relative">
      {/*
       * The real field: invisible, but present, focusable and full-width, so a
       * tap anywhere on the row lands on it. `opacity-0` rather than
       * `hidden` — a hidden input cannot be focused, and autofill skips it.
       */}
      <input
        ref={inputRef}
        id={inputId}
        aria-label={label}
        value={value}
        disabled={disabled}
        inputMode="numeric"
        // The one attribute that makes iOS and Android offer the code from the
        // SMS above the keyboard. Worth more than every other line here.
        autoComplete="one-time-code"
        // Not `type="number"`: it brings a spinner, accepts `e` and `-`, and on
        // some browsers refuses to report a partial value.
        type="text"
        pattern="\d*"
        maxLength={LENGTH}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, LENGTH))}
        // Always to the end. Without this, tapping the middle of the row puts
        // the caret in the middle of the value, and the next digit is inserted
        // somewhere the person is not looking.
        onSelect={(event) => {
          const target = event.target as HTMLInputElement;
          if (target.selectionStart !== value.length) {
            target.setSelectionRange(value.length, value.length);
          }
        }}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer text-transparent caret-transparent opacity-0 outline-none"
      />

      <div className="pointer-events-none flex items-center justify-between gap-2 sm:gap-3">
        {Array.from({ length: LENGTH }, (_, index) => {
          const digit = digits[index];
          const filled = digit !== undefined;
          const here = focused && index === activeIndex && !disabled;

          return (
            <div
              key={index}
              className={cn(
                // `flex-1` with a fixed aspect keeps six boxes on a 320px phone
                // without a horizontal scrollbar; the cap stops them from
                // becoming letterboxes on a wide screen.
                'relative flex aspect-[4/5] max-w-[4.25rem] flex-1 items-center justify-center',
                'rounded-2xl border bg-surface text-[1.6rem] font-semibold text-ink-900 tabular-nums',
                // Everything that moves, moves together and quickly. 150ms is
                // below the threshold where a highlight feels like it is
                // lagging behind the finger.
                'transition-[border-color,box-shadow,transform,background-color] duration-150 ease-out',
                invalid
                  ? 'border-danger shadow-[0_0_0_3px_rgb(180_50_31/0.16)]'
                  : here
                    ? // The lift is what the owner asked for: the box being
                      // typed into is nearer the reader than the other five.
                      '-translate-y-0.5 border-brand-500 shadow-[0_0_0_3px_rgb(180_50_31/0.14),0_8px_20px_-8px_rgb(38_36_35/0.35)]'
                    : filled
                      ? 'border-ink-300 shadow-[0_1px_2px_rgb(38_36_35/0.08)]'
                      : 'border-card-edge shadow-[0_1px_2px_rgb(38_36_35/0.05)]',
                disabled && 'opacity-60',
              )}
            >
              {filled ? (
                // Keyed on the digit so React remounts it and the entry
                // animation replays for each new character rather than only
                // for the first.
                <span key={digit} className="otp-digit">
                  {digit}
                </span>
              ) : here ? (
                <span className="otp-caret" />
              ) : (
                // A dot, not an empty box: it says "a character goes here"
                // without pretending to be a character.
                <span className="h-1 w-1 rounded-full bg-ink-300" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
