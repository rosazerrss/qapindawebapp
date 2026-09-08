'use client';

/**
 * What every floating surface in the app has in common.
 *
 * There are four of them — the customer `Sheet`, the panel's `ConfirmDialog`
 * and `Drawer`, and the command palette — plus the panel's mobile navigation.
 * They looked different from one another and behaved differently too: one
 * locked the page behind it, the others did not; all of them let the keyboard
 * walk straight out of the dialog and into the page underneath.
 *
 * So the chrome lives here once. A dialog gets its edge and its lift from the
 * three classes below and its behaviour from `useDialogChrome`, and "make the
 * dialogs read as separate from the page" is a change to this file and to the
 * tokens in `globals.css` rather than to a dozen screens.
 *
 * WHY THERE IS A STACK
 * --------------------
 * Dialogs genuinely nest here: the payments screen opens the refund
 * confirmation on top of an open drawer, and both are mounted at once as
 * siblings. Without a stack, two focus traps fight over the same Tab press —
 * the drawer's would keep hauling focus out of the confirmation sitting in
 * front of it — and one Escape would close both. Only the topmost dialog
 * listens; the page stays locked until the last one closes.
 */

import { useEffect, useRef } from 'react';

/**
 * The ground, the edge and the lift. Applied to the dialog surface itself.
 *
 * One class rather than a handful of utilities, and the difference matters:
 * the colour, the border and the shadow are defined together in `globals.css`
 * outside every cascade layer, so a `bg-white` or a `bg-canvas` written on the
 * same element cannot repaint the dialog the colour of the page. That is the
 * exact failure the white-on-white complaint kept coming back through.
 */
export const DIALOG_SURFACE = 'qp-dialog-surface';

/**
 * The same edge and lift for a floating surface that has no scrim under it.
 *
 * A dropdown, a toast, the cookie bar, the bar that follows an active order
 * down the page: they float, so they need to read as being in front of the
 * page, but they must not black out the screen behind them to say so. These
 * are the ones the owner meets most often — and the ones that were still
 * drawing themselves in `bg-white shadow-lg border-ink-200`, which on a white
 * page is very nearly nothing at all.
 */
export const POPOVER_SURFACE = 'qp-popover-surface';

/** The dimmed, blurred page behind it. */
export const DIALOG_SCRIM = 'absolute inset-0 qp-scrim motion-safe:animate-[qp-fade-in_160ms_ease-out]';

/** How the surface arrives: forward and up, or in from the edge for a drawer. */
export const DIALOG_ENTRANCE = 'motion-safe:animate-[qp-dialog-in_180ms_ease-out]';
export const DRAWER_ENTRANCE = 'motion-safe:animate-[qp-drawer-in_200ms_ease-out]';

/**
 * The gutter that keeps a dialog off the edge of the screen.
 *
 * On a phone too, which is the part that is usually skipped: a bottom sheet
 * flush against three edges of a white page is exactly the thing that cannot
 * be told apart from the page.
 */
export const DIALOG_GUTTER = 'p-3 sm:p-6';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The dialogs currently open, oldest first. Only the last one listens. */
const openDialogs: symbol[] = [];

/** The page's own overflow, remembered by the first dialog to lock it. */
let unlockedOverflow: string | null = null;

function lockPage(): void {
  if (openDialogs.length > 1) return;
  unlockedOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}

function unlockPage(): void {
  if (openDialogs.length > 0) return;
  document.body.style.overflow = unlockedOverflow ?? '';
  unlockedOverflow = null;
}

/**
 * Escape closes, Tab stays inside, the page behind does not scroll, and focus
 * goes back where it came from.
 *
 * Returns the ref to put on the dialog surface. Pass `active` rather than
 * mounting conditionally around the hook: every one of these components renders
 * `null` when closed, so the hook has to be told separately whether it is live.
 */
export function useDialogChrome<T extends HTMLElement>(
  active: boolean,
  onClose: () => void,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);

  /*
   * THE CLOSER IS HELD IN A REF, AND THAT IS WHAT MAKES THE DIALOGS TYPEABLE.
   *
   * Every caller writes `onClose={() => setThing(null)}` inline, so the function
   * is a NEW function on every render of the screen around it. With `onClose` in
   * the dependency list below, that made the whole effect tear down and run
   * again on every render — and a form inside a dialog re-renders on every
   * keystroke. Each letter therefore ran the cleanup, which returns focus to
   * whatever opened the dialog, and then re-ran the setup, which focuses the
   * first thing in the dialog: the close button in a `Drawer`'s header. Typing
   * one letter into the coupon name threw the caret onto the X, which is exactly
   * what was reported, and the same happened in every other dialog with a field
   * in it — the commission rate, the cancellation reason, the address sheet.
   *
   * The effect's real dependency is `active`: it exists to set up and tear down
   * the chrome when the dialog OPENS and CLOSES, and a re-rendered parent is
   * neither. So the latest closer is kept here and read at the moment Escape is
   * pressed, which is the only moment it is needed.
   */
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!active) return;

    const node = ref.current;
    const token = Symbol('dialog');
    // Where the keyboard was before this opened. Restored on close, because a
    // dialog that dumps focus back at the top of the document makes a keyboard
    // user find their place again after every confirmation.
    const opener = document.activeElement as HTMLElement | null;

    openDialogs.push(token);
    lockPage();

    /** Only what is actually reachable — a hidden tab's fields are not. */
    const reachable = (): HTMLElement[] =>
      Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );

    const first = reachable()[0];
    if (first) first.focus();
    else node?.focus();

    const onKey = (event: KeyboardEvent) => {
      // Nested dialogs: the one in front owns the keyboard.
      if (openDialogs[openDialogs.length - 1] !== token) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        close.current();
        return;
      }

      if (event.key !== 'Tab' || !node) return;

      const items = reachable();
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }

      const head = items[0];
      const tail = items[items.length - 1];
      const current = document.activeElement;

      if (!node.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? tail : head).focus();
      } else if (event.shiftKey && current === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && current === tail) {
        event.preventDefault();
        head.focus();
      }
    };

    // Capture, so a field inside the dialog that swallows Escape for its own
    // purposes cannot leave the dialog unclosable.
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('keydown', onKey, true);

      const at = openDialogs.indexOf(token);
      if (at >= 0) openDialogs.splice(at, 1);
      unlockPage();

      // Only if the opener is still on the page: a row that was deleted by the
      // very action this dialog confirmed no longer exists to focus.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [active]);

  return ref;
}

/** Exported for the tests that check nothing is left locked behind a dialog. */
export function openDialogCount(): number {
  return openDialogs.length;
}
