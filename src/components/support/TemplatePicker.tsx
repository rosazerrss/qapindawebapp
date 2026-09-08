'use client';

/**
 * A row of ready-written sentences.
 *
 * The same control on both sides of a support ticket, because it is answering
 * the same complaint from both: an empty box is a bad question. An operator
 * facing one retypes the same four sentences all shift, and a customer facing
 * one writes "problem var" and waits to be asked what the problem is.
 *
 * IT FILLS THE BOX. IT NEVER SENDS.
 * ---------------------------------
 * Picking a template hands the text to whoever is writing, and they send it —
 * after editing it, usually, because the sentence that helps is the one with
 * this person's detail in it. A picker that posted the message itself would be
 * a robot answering support tickets under the platform's name, which is the
 * opposite of what support is for.
 *
 * The chips are buttons and not a `<select>` on purpose: an operator scanning
 * twelve options while a customer waits should be able to see all twelve, and
 * a dropdown hides eleven of them behind a click.
 */

import { cn } from '@/components/ui';

export interface TemplateOption {
  /** The template's key. Handed back on pick; never shown. */
  key: string;
  /** The short label on the chip — the subject, not the whole sentence. */
  label: string;
}

export function TemplatePicker({
  label,
  hint,
  options,
  onPick,
  disabled = false,
  className,
}: {
  label: string;
  hint?: string;
  options: TemplateOption[];
  onPick: (key: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (options.length === 0) return null;

  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</p>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            disabled={disabled}
            onClick={() => onPick(option.key)}
            className={cn(
              'rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700',
              'transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {hint && <p className="mt-1.5 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
