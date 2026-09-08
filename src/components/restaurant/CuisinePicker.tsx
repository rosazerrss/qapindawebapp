'use client';

/**
 * What kind of kitchen this is — chosen, never typed.
 *
 * WHAT THIS REPLACES
 * ------------------
 * A text box. Twenty restaurants typed twenty spellings of the same four ideas,
 * the home page's filter row is built from the distinct values across every
 * restaurant, and it became a list of near-duplicates that filtered almost
 * nothing: tapping "Milli mətbəx" found the four shops that had spelled it
 * exactly that way and missed the rest.
 *
 * HOW IT DIFFERS FROM THE PICKER NEXT TO IT
 * -----------------------------------------
 * `CategoryPicker` is about DISHES — which of the round tiles on the home page
 * this shop belongs behind, up to five. This is about the KITCHEN — what the
 * restaurant *is*, up to three. The two look alike on purpose, because they are
 * the same kind of question, and the hint under each says which is which.
 *
 * THE OLD FREE TEXT IS SHOWN, NOT SILENTLY DISCARDED
 * --------------------------------------------------
 * A restaurant that typed its cuisines months ago opens this screen with
 * nothing ticked, because none of its stored words is an id. Dropping them
 * without a word would look like the platform had lost them, so they are shown
 * above the tiles as what is currently published, with one sentence saying they
 * will be replaced by whatever is ticked.
 */

import { Check } from 'lucide-react';

import { cn } from '@/components/ui';
import { useT } from '@/i18n';
import {
  CUISINE_IDS,
  MAX_RESTAURANT_CUISINES,
  isCuisineId,
  type CuisineId,
} from '@/shared/cuisines';

export function CuisinePicker({
  value,
  onChange,
  /**
   * What is stored on the restaurant right now, including free text.
   *
   * Passed separately from `value` because `value` holds only the ids the
   * picker can represent — the whole point of showing this is that the leftover
   * words are the ones it cannot.
   */
  stored = [],
}: {
  value: CuisineId[];
  onChange: (next: CuisineId[]) => void;
  stored?: string[];
}) {
  const t = useT();
  const full = value.length >= MAX_RESTAURANT_CUISINES;

  /** The words that predate the list and have no tile of their own. */
  const legacy = stored.filter((entry) => !isCuisineId(entry));

  const toggle = (id: CuisineId) => {
    if (value.includes(id)) {
      onChange(value.filter((entry) => entry !== id));
      return;
    }
    if (full) return;
    onChange([...value, id]);
  };

  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink-700">{t('cuisine.title')}</legend>

      {legacy.length > 0 && (
        <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('restaurantPanel.cuisineLegacy', { values: legacy.join(', ') })}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {CUISINE_IDS.map((id) => {
          const active = value.includes(id);

          return (
            <button
              key={id}
              type="button"
              role="switch"
              aria-checked={active}
              // A tile that cannot be ticked says so to a screen reader too,
              // rather than simply doing nothing when it is pressed.
              aria-disabled={!active && full ? true : undefined}
              onClick={() => toggle(id)}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition',
                active
                  ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
                  : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400',
                !active && full && 'cursor-not-allowed opacity-45 hover:border-ink-200',
              )}
            >
              {t(`cuisine.${id}`)}
              {active && <Check size={15} aria-hidden />}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-sm text-ink-400">
        {t('restaurantPanel.cuisineHint', { max: MAX_RESTAURANT_CUISINES })}
      </p>
    </fieldset>
  );
}
