'use client';

/**
 * What other people thought.
 *
 * The reviews are fetched when the sheet is first opened, not when the menu
 * page loads. Most visitors never open it, and a callable per menu view is a
 * bill for an answer nobody asked for.
 *
 * The headline average comes from the restaurant document rather than from the
 * fetched page: the list is capped at the newest 60 reviews, so averaging what
 * arrived here would quietly disagree with the number on the restaurant card.
 * The bar breakdown *is* computed from the fetched page, and says so — it is a
 * shape, not an audit.
 */

import { useEffect, useState } from 'react';

import { RatingStars } from './RatingStars';
import { EmptyState, Loading, Sheet, cn } from '@/components/ui';
import { whenDate } from '@/components/panel/status';
import { listReviews } from '@/firebase/callables';
import { useT, translateError, type Translate } from '@/i18n';

interface ReviewRow {
  id: string;
  orderCode: string;
  customerName: string;
  rating: number;
  tags: string[];
  comment: string | null;
  reply: string | null;
  createdAt: { _seconds: number } | null;
}

/**
 * A callable hands back a Firestore timestamp as `{ _seconds }`, not a `Date`.
 * Exported so the two panel screens format a review's date the same way.
 */
export function reviewDate(value: { _seconds: number } | null | undefined): string {
  if (!value?._seconds) return '';
  return whenDate({ toMillis: () => value._seconds * 1000 });
}

/** `TASTY` → "Yemək dadlı idi". Unknown tags fall back to the raw code. */
export function reviewTagLabel(t: Translate, tag: string): string {
  return t(`reviewTag.${tag}`);
}

export function ReviewsSheet({
  open,
  onClose,
  restaurantId,
  average,
  count,
}: {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  /** The restaurant's stored score — the same number shown on its card. */
  average: number;
  count: number;
}) {
  const t = useT();

  // One piece of state rather than three, tagged with the restaurant it
  // describes: nothing here is ever written outside the fetch callback, so the
  // sheet can never render a half-updated mixture of two restaurants.
  const [loaded, setLoaded] = useState<{
    restaurantId: string;
    reviews: ReviewRow[];
    breakdown: number[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    listReviews(restaurantId).then((result) => {
      if (cancelled) return;

      setLoaded({
        restaurantId,
        reviews: result.data?.reviews ?? [],
        breakdown: result.data?.breakdown ?? [0, 0, 0, 0, 0],
        error: result.ok ? null : translateError(t, result.errorCode, result.errorDetail),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [open, restaurantId, t]);

  const current = loaded?.restaurantId === restaurantId ? loaded : null;
  const reviews = current?.reviews ?? null;
  const breakdown = current?.breakdown ?? [0, 0, 0, 0, 0];
  const error = current?.error ?? null;

  // The widest bar sets the scale, so a restaurant with 200 five-star reviews
  // and 3 one-star ones still shows a visible sliver for the one star.
  const widest = Math.max(1, ...breakdown);

  return (
    <Sheet open={open} onClose={onClose} title={t('review.title')}>
      {count > 0 ? (
        <div className="flex items-center gap-5">
          <div className="text-center">
            <p className="text-4xl font-semibold tabular-nums text-ink-900">
              {average.toFixed(1)}
            </p>
            <RatingStars value={average} size={15} className="mt-1" />
            <p className="mt-1 text-xs text-ink-400">{t('review.count', { count })}</p>
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            {[5, 4, 3, 2, 1].map((star) => (
              <div key={star} className="flex items-center gap-2 text-xs text-ink-500">
                <span className="w-3 tabular-nums">{star}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                  <span
                    className="block h-full rounded-full bg-amber-400"
                    style={{ width: `${(breakdown[star - 1] / widest) * 100}%` }}
                  />
                </span>
                <span className="w-6 text-right tabular-nums">{breakdown[star - 1]}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        {reviews === null ? (
          <Loading label={t('common.loading')} />
        ) : error ? (
          <EmptyState title={error} />
        ) : reviews.length === 0 ? (
          <EmptyState title={t('review.empty')} hint={t('review.emptyHint')} />
        ) : (
          <ul className="divide-y divide-row-edge">
            {reviews.map((review) => (
              <li key={review.id} className="py-4 first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium text-ink-900">{review.customerName}</span>
                  <span className="shrink-0 text-xs text-ink-400">
                    {reviewDate(review.createdAt)}
                  </span>
                </div>

                <RatingStars value={review.rating} size={14} className="mt-1" />

                {review.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {review.tags.map((tag) => (
                      <span
                        key={tag}
                        className={cn(
                          'rounded-full px-2.5 py-1 text-xs font-medium',
                          review.rating >= 4
                            ? 'bg-green-50 text-success'
                            : 'bg-amber-50 text-warning',
                        )}
                      >
                        {reviewTagLabel(t, tag)}
                      </span>
                    ))}
                  </div>
                )}

                {review.comment && (
                  <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{review.comment}</p>
                )}

                {review.reply && (
                  <div className="mt-2.5 rounded-xl border-l-2 border-brand-200 bg-ink-50 px-3 py-2">
                    <p className="text-xs font-medium text-brand-700">{t('review.replyFrom')}</p>
                    <p className="mt-0.5 whitespace-pre-line text-sm text-ink-700">
                      {review.reply}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

export default ReviewsSheet;
