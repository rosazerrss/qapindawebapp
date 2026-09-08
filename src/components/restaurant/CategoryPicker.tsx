'use client';

/**
 * Where a restaurant says what it cooks, in the platform's own words.
 *
 * The cuisine field next to this one is free text and stays free text — it is
 * how the shop describes itself. This is different: these are the eleven tiles
 * on the customer's home page, and ticking one is what puts the shop behind
 * that tile. So the control is a closed set of toggles rather than another box
 * to type in, and the limit is enforced here as well as on the server, because
 * a restaurant that finds out about the limit from an error message has already
 * lost the work of choosing.
 */

import { Check } from 'lucide-react';

import { cn } from '@/components/ui';
import { useT } from '@/i18n';
import {
  FOOD_CATEGORIES,
  MAX_RESTAURANT_CATEGORIES,
  type FoodCategoryId,
} from '@/shared/categories';

export function CategoryPicker({
  value,
  onChange,
}: {
  value: FoodCategoryId[];
  onChange: (next: FoodCategoryId[]) => void;
}) {
  const t = useT();
  const full = value.length >= MAX_RESTAURANT_CATEGORIES;

  const toggle = (id: FoodCategoryId) => {
    if (value.includes(id)) {
      onChange(value.filter((entry) => entry !== id));
      return;
    }
    if (full) return;
    onChange([...value, id]);
  };

  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink-700">
        {t('categories.title')}
      </legend>

      <div className="flex flex-wrap gap-2">
        {FOOD_CATEGORIES.map((category) => {
          const active = value.includes(category.id);

          return (
            <button
              key={category.id}
              type="button"
              role="switch"
              aria-checked={active}
              // A tile that cannot be ticked says so to a screen reader too,
              // rather than simply doing nothing when it is pressed.
              aria-disabled={!active && full ? true : undefined}
              onClick={() => toggle(category.id)}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition',
                active
                  ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
                  : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400',
                !active && full && 'cursor-not-allowed opacity-45 hover:border-ink-200',
              )}
            >
              <span aria-hidden className="text-base leading-none">
                {category.emoji}
              </span>
              {t(`categories.${category.id}`)}
              {active && <Check size={15} aria-hidden />}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-sm text-ink-400">
        {t('restaurantPanel.categoriesHint', { max: MAX_RESTAURANT_CATEGORIES })}
      </p>
    </fieldset>
  );
}
