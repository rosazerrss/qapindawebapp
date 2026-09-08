'use client';

/**
 * The − [n] + control that changes how many of one dish are in the cart.
 *
 * It exists as its own component so the menu and the cart page cannot drift
 * apart: the same shape, the same icons, the same labels wherever a quantity is
 * edited. Every label names the dish, because on a menu of thirty rows "add one"
 * on its own tells a screen-reader user nothing about which row they are on.
 *
 * The buttons are 44px so a thumb hits them, and state is never carried by
 * colour alone — the count is a number, the last-one step swaps the minus for a
 * bin icon, and an unavailable control says why in its tooltip.
 */

import { Minus, Plus, Trash2 } from 'lucide-react';

import { cn } from '@/components/ui';
import { useT } from '@/i18n';

export function QuantityStepper({
  name,
  quantity,
  onDecrease,
  onIncrease,
  max = 30,
  disabled = false,
  disabledReason,
  increaseLabel,
  className,
}: {
  /** The dish, spelled out in every accessible label. */
  name: string;
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
  max?: number;
  disabled?: boolean;
  /** Shown as the tooltip on a control the customer cannot use right now. */
  disabledReason?: string;
  /**
   * Overrides the + label for a dish whose plus opens the options sheet instead
   * of adding straight away — saying "add one" there would be a lie.
   */
  increaseLabel?: string;
  className?: string;
}) {
  const t = useT();

  const atMax = quantity >= max;
  const removes = quantity === 1;
  const increaseBlocked = disabled || atMax;

  const increaseTitle = disabled ? disabledReason : atMax ? t('cart.maxQuantity') : undefined;

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-0.5 rounded-xl border border-ink-200 bg-white p-0.5',
        className,
      )}
    >
      <button
        type="button"
        onClick={onDecrease}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        aria-label={
          removes ? t('cart.removeLine', { name }) : t('cart.decrease', { name })
        }
        className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-700 transition hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {removes ? <Trash2 size={16} aria-hidden /> : <Minus size={16} aria-hidden />}
      </button>

      {/* Announced on change so the count is not something you can only see. */}
      <span className="min-w-6 text-center text-sm font-semibold tabular-nums text-ink-900">
        <span aria-live="polite">{quantity}</span>
        <span className="sr-only"> {t('cart.inCart', { name, count: quantity })}</span>
      </span>

      <button
        type="button"
        onClick={onIncrease}
        disabled={increaseBlocked}
        title={increaseTitle}
        aria-label={increaseLabel ?? t('cart.increase', { name })}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-700 transition hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={16} aria-hidden />
      </button>
    </div>
  );
}

/**
 * The + shown before a dish is in the cart at all. Same 44px target and the
 * same disabled explanation, but on its own it is one button rather than a
 * group, so it does not pretend to show a quantity of zero.
 */
export function AddButton({
  name,
  onClick,
  disabled = false,
  disabledReason,
  label,
  className,
}: {
  name: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  /** Defaults to "add one"; the options case passes "open the options" instead. */
  label?: string;
  className?: string;
}) {
  const t = useT();

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      aria-label={label ?? t('restaurant.addOne', { name })}
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700 transition',
        'hover:border-brand-300 hover:bg-brand-100 disabled:cursor-not-allowed disabled:border-ink-200 disabled:bg-white disabled:text-ink-400 disabled:opacity-60',
        className,
      )}
    >
      <Plus size={18} aria-hidden />
    </button>
  );
}
