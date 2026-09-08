'use client';

/**
 * The small set of building blocks every screen uses.
 *
 * Deliberately plain: a button, a field, a sheet, a spinner. Anything that
 * needs more than this is a screen, not a component.
 */

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { useT } from '@/i18n';
import {
  DIALOG_ENTRANCE,
  DIALOG_GUTTER,
  DIALOG_SCRIM,
  DIALOG_SURFACE,
  useDialogChrome,
} from './overlay';

export function cn(...inputs: Array<string | false | null | undefined>): string {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
  secondary: 'bg-white text-ink-900 border border-ink-200 hover:bg-ink-50',
  ghost: 'bg-transparent text-ink-700 hover:bg-ink-100',
  danger: 'bg-danger text-white hover:brightness-95',
  success: 'bg-success text-white hover:brightness-95',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-[15px]',
  lg: 'h-13 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, fullWidth, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // A loading button must not fire twice — that is how duplicate orders start.
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const FIELD =
  'w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-[15px] text-ink-900 ' +
  'placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 ' +
  'disabled:bg-ink-50 disabled:text-ink-400';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string | null;
}

export const Input = forwardRef<HTMLInputElement, FieldProps>(function Input(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const inputId = id ?? rest.name;
  return (
    <label className="block" htmlFor={inputId}>
      {label && <span className="mb-1.5 block text-sm font-medium text-ink-700">{label}</span>}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(FIELD, error && 'border-danger focus:border-danger focus:ring-red-100', className)}
        {...rest}
      />
      {error ? (
        <span className="mt-1.5 block text-sm text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-sm text-ink-400">{hint}</span>
      ) : null}
    </label>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string }
>(function Textarea({ label, hint, className, id, ...rest }, ref) {
  const fieldId = id ?? rest.name;
  return (
    <label className="block" htmlFor={fieldId}>
      {label && <span className="mb-1.5 block text-sm font-medium text-ink-700">{label}</span>}
      <textarea ref={ref} id={fieldId} className={cn(FIELD, 'min-h-20 resize-y', className)} {...rest} />
      {hint && <span className="mt-1.5 block text-sm text-ink-400">{hint}</span>}
    </label>
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string }
>(function Select({ label, hint, className, children, id, ...rest }, ref) {
  const fieldId = id ?? rest.name;
  return (
    <label className="block" htmlFor={fieldId}>
      {label && <span className="mb-1.5 block text-sm font-medium text-ink-700">{label}</span>}
      <select ref={ref} id={fieldId} className={cn(FIELD, 'appearance-none pr-9', className)} {...rest}>
        {children}
      </select>
      {hint && <span className="mt-1.5 block text-sm text-ink-400">{hint}</span>}
    </label>
  );
});

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

/** A single on/off toggle — a checkbox that reads as a checkbox to nobody. */
export function Switch({ checked, onChange, disabled, label, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-brand-600' : 'bg-ink-200',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      /*
       * Three signals, not one. `bg-surface` against the page's `--color-canvas`
       * is a colour difference that cannot be lost; `border-card-edge` is a real
       * line rather than the old `ink-100`, which was invisible against both;
       * and `shadow-card` lifts it. Any two of the three failing still leaves a
       * card with a visible edge, which is the whole point — a card whose only
       * boundary was a shadow is a card that vanishes on a cheap monitor.
       */
      className={cn('rounded-2xl border border-card-edge bg-surface shadow-card', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'brand' | 'progress' | 'success' | 'warning' | 'danger';
  children: ReactNode;
  className?: string;
}) {
  /*
   * `progress` is blue, and it is blue because the brand is red.
   *
   * An order that is being cooked and an order that was cancelled were both
   * drawn from the red family — one at brand strength, one at danger strength —
   * and across a counter, on a cheap screen, they are the same pill. Colour is
   * how a status is found in a list of forty; two states that mean opposite
   * things must not share a hue. Blue carries no other meaning in this app, so
   * it is free to mean "still moving".
   *
   * `brand` stays for the things that are genuinely about Qapında rather than
   * about an order's state.
   */
  const tones = {
    neutral: 'bg-ink-100 text-ink-700',
    brand: 'bg-brand-50 text-brand-700',
    progress: 'bg-blue-50 text-blue-700',
    success: 'bg-green-50 text-success',
    warning: 'bg-amber-50 text-warning',
    danger: 'bg-red-50 text-danger',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex items-center justify-center gap-3 py-16 text-ink-400"
    >
      <Spinner className="h-5 w-5" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink-200 px-6 py-14 text-center">
      <p className="font-medium text-ink-700">{title}</p>
      {hint && <p className="max-w-sm text-sm text-ink-400">{hint}</p>}
      {action}
    </div>
  );
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  children: ReactNode;
}) {
  const tones = {
    info: 'bg-ink-50 text-ink-700 border-ink-200',
    warning: 'bg-amber-50 text-warning border-amber-200',
    danger: 'bg-red-50 text-danger border-red-200',
    success: 'bg-green-50 text-success border-green-200',
  } as const;

  return (
    <div className={cn('rounded-xl border px-3.5 py-3 text-sm', tones[tone])} role="status">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet — the bottom drawer everything modal uses on a phone.
// ---------------------------------------------------------------------------

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();

  // Escape closes, Tab stays inside, and the page behind does not scroll.
  const surface = useDialogChrome<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-end justify-center sm:items-center',
        DIALOG_GUTTER,
      )}
    >
      <button aria-label={t('common.close')} className={DIALOG_SCRIM} onClick={onClose} tabIndex={-1} />
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        // The gutter above and the rounding here are what make this read as a
        // card in front of the page rather than as the bottom of it — on a
        // phone as much as on a desktop, which is where it used to be flush
        // against three white edges and invisible.
        className={cn(
          'relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-dialog sm:max-w-lg',
          DIALOG_SURFACE,
          DIALOG_ENTRANCE,
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-card-edge px-5 py-4">
            <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100"
              aria-label={t('common.close')}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path
                  d="m5 5 10 10M15 5 5 15"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-card-edge px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** 1250 → "12.50 ₼". The one place money becomes text on screen. */
export function Money({ amount, className }: { amount: number; className?: string }) {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const text = `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return (
    <span className={cn('tabular-nums', className)}>
      {text} <span className="text-[0.85em]">₼</span>
    </span>
  );
}
