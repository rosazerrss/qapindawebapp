'use client';

/**
 * The food categories, as a rail across the top of the shopfront.
 *
 * This is the first thing a hungry person uses, so it is the first thing under
 * the greeting and it is one tap deep. A rail rather than a dropdown, because
 * the options *are* the appetite: a closed menu labelled "Kateqoriya" asks the
 * customer to remember what we sell, and a row of pictures tells them.
 *
 * Every tile is a real 44px-plus target with the label under the picture, never
 * the picture alone — an emoji is not a name, and somebody who cannot see it
 * still has to know that this one is the kebab.
 *
 * A category with nothing in it is shown, muted, rather than hidden. Hiding it
 * would make the rail change shape as restaurants open and close through the
 * day, and a row that rearranges itself under the thumb is the opposite of
 * calm. It stays tappable so a shared link to an empty category still lands
 * somewhere that explains itself.
 */

import { visibleCategories, type FoodCategoryId } from '@/shared/categories';
import { cn } from '@/components/ui';
import { useT } from '@/i18n';

export function CategoryRail({
  selected,
  counts,
  onSelect,
  loading = false,
  chosen,
}: {
  selected: FoodCategoryId | null;
  /** How many restaurants are behind each tile right now. */
  counts: Map<FoodCategoryId, number> | null;
  onSelect: (next: FoodCategoryId | null) => void;
  loading?: boolean;
  /**
   * The platform's chosen categories, in order. Undefined means "all of them",
   * which is what a settings document that has never been touched says.
   */
  chosen?: string[] | null;
}) {
  const t = useT();

  if (loading) return <CategoryRailSkeleton label={t('common.loading')} />;

  // Nothing is dimmed while the whole catalogue is empty: eleven grey tiles at
  // once read as "this app is broken" rather than "nothing here today".
  const anyCounted = counts !== null && [...counts.values()].some((count) => count > 0);

  return (
    <div
      className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2"
      role="group"
      aria-label={t('categories.title')}
    >
      <Tile
        emoji="🍽️"
        label={t('categories.all')}
        active={selected === null}
        onClick={() => onSelect(null)}
      />

      {visibleCategories(chosen).map((category) => {
        const count = counts?.get(category.id) ?? 0;
        const active = selected === category.id;

        return (
          <Tile
            key={category.id}
            emoji={category.emoji}
            label={t(`categories.${category.id}`)}
            active={active}
            muted={anyCounted && count === 0 && !active}
            onClick={() => onSelect(active ? null : category.id)}
          />
        );
      })}
    </div>
  );
}

function Tile({
  emoji,
  label,
  active,
  muted = false,
  onClick,
}: {
  emoji: string;
  label: string;
  active: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border px-1 py-2.5 transition duration-200',
        active
          ? 'border-brand-600 bg-brand-50 shadow-sm'
          : 'border-transparent bg-white shadow-sm hover:border-ink-200',
        muted && !active && 'opacity-45',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-full text-[22px] leading-none transition duration-200',
          active ? 'bg-white' : 'bg-canvas group-hover:scale-105 motion-reduce:group-hover:scale-100',
        )}
      >
        {emoji}
      </span>
      <span
        className={cn(
          'w-full truncate text-center text-[11px] font-medium leading-tight',
          active ? 'text-brand-700' : 'text-ink-600',
        )}
      >
        {label}
      </span>
    </button>
  );
}

/** The rail's own shape while the catalogue is still arriving. */
export function CategoryRailSkeleton({ label }: { label: string }) {
  return (
    <div
      className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-card-edge bg-surface px-1 py-2.5 shadow-sm"
        >
          <span className="h-11 w-11 animate-pulse rounded-full bg-ink-100" aria-hidden />
          <span className="h-2.5 w-10 animate-pulse rounded bg-ink-100" aria-hidden />
        </div>
      ))}
    </div>
  );
}
