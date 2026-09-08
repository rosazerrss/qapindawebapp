'use client';

/**
 * Five stars, read or write.
 *
 * The same component does both jobs on purpose. A rating shown on a menu page
 * and a rating being picked in a review form must look identical, or the person
 * writing the review cannot tell what they are about to publish. Passing
 * `onChange` is what turns the display into a picker — there is no `mode` prop
 * to get wrong.
 *
 * The read-only form is a single element with a text label rather than five
 * icons, because a screen reader announcing "star star star" five times is
 * worse than silence; the picker is a real radio group, because choosing a
 * rating with a keyboard has to work.
 */

import { Star } from 'lucide-react';

import { cn } from '@/components/ui';
import { useT } from '@/i18n';

const STARS = [1, 2, 3, 4, 5] as const;

export function RatingStars({
  value,
  size = 16,
  onChange,
  className,
}: {
  /** 0–5. Fractions are allowed for a display average and round to the nearest star. */
  value: number;
  size?: number;
  /** Supply this to make the stars selectable. */
  onChange?: (rating: number) => void;
  className?: string;
}) {
  const t = useT();
  const filled = Math.round(value);

  if (!onChange) {
    return (
      <span
        className={cn('inline-flex items-center gap-0.5', className)}
        role="img"
        aria-label={t('review.starsOf', { rating: value.toFixed(1) })}
      >
        {STARS.map((star) => (
          <Star
            key={star}
            size={size}
            aria-hidden
            className={cn(
              star <= filled ? 'fill-amber-400 text-amber-400' : 'fill-ink-100 text-ink-200',
            )}
          />
        ))}
      </span>
    );
  }

  return (
    <span
      className={cn('inline-flex items-center gap-1', className)}
      role="radiogroup"
      aria-label={t('review.ratingLabel')}
    >
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={star === filled}
          aria-label={t('review.starCount', { count: star })}
          onClick={() => onChange(star)}
          className="rounded-lg p-0.5 transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-brand-200"
        >
          <Star
            size={size}
            aria-hidden
            className={cn(
              star <= filled ? 'fill-amber-400 text-amber-400' : 'fill-ink-100 text-ink-300',
            )}
          />
        </button>
      ))}
    </span>
  );
}

export default RatingStars;
