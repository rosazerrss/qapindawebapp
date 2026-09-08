'use client';

/**
 * The review composer.
 *
 * Stars first, then chips, then — optionally — prose. That order is deliberate:
 * the star count decides which chips are even offered, and most people will
 * never reach the text box at all.
 *
 * Rendered as the body of a `Sheet`, including its own submit button, so that
 * both screens that ask for a review open the identical thing.
 */

import { useState } from 'react';

import { RatingStars } from '@/components/customer/RatingStars';
import { Alert, Button, Textarea, cn } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { submitReview } from '@/firebase/callables';
import { MAX_REVIEW_COMMENT, MAX_REVIEW_TAGS, tagsForRating } from '@/shared/reviews';

export function ReviewForm({
  orderId,
  restaurantName,
  onSubmitted,
}: {
  orderId: string;
  restaurantName?: string | null;
  /** Called after the server has accepted the review. */
  onSubmitted?: (orderId: string) => void;
}) {
  const t = useT();

  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Zero means "not answered yet": until a star is tapped there is nothing to
  // offer chips for, and nothing the server would accept.
  const offered = rating === 0 ? [] : tagsForRating(rating);
  const capped = tags.length >= MAX_REVIEW_TAGS;

  const changeRating = (next: number) => {
    setRating(next);
    // Crossing the 4-star line swaps praise for complaint. Anything already
    // ticked that the new list does not contain is dropped here rather than
    // sent and silently discarded by the server — a chip the customer can no
    // longer see must not still be part of their review.
    setTags((current) => current.filter((tag) => tagsForRating(next).includes(tag)));
  };

  const toggleTag = (tag: string) => {
    setTags((current) => {
      if (current.includes(tag)) return current.filter((item) => item !== tag);
      if (current.length >= MAX_REVIEW_TAGS) return current;
      return [...current, tag];
    });
  };

  const submit = async () => {
    if (rating === 0) return;

    setBusy(true);
    setError(null);

    const result = await submitReview({
      orderId,
      rating,
      tags,
      comment: comment.trim() || null,
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    onSubmitted?.(orderId);
  };

  return (
    <div>
      {restaurantName && (
        <p className="mb-1 text-[15px] font-medium text-ink-900">{restaurantName}</p>
      )}
      <p className="text-sm text-ink-500">{t('review.ratingPrompt')}</p>

      <div className="mt-3 flex justify-center py-2">
        <RatingStars value={rating} size={36} onChange={changeRating} />
      </div>

      {offered.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-ink-700">
            {rating >= 4 ? t('review.tagsPositive') : t('review.tagsNegative')}
          </p>

          <div className="flex flex-wrap gap-2">
            {offered.map((tag) => {
              const selected = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={selected}
                  // Once the cap is reached the remaining chips stay visible but
                  // stop responding, so the limit is discovered by looking
                  // rather than by tapping and having nothing happen.
                  disabled={!selected && capped}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'rounded-full border px-3.5 py-1.5 text-sm transition',
                    selected
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
                    !selected && capped && 'cursor-not-allowed opacity-40 hover:bg-white',
                  )}
                >
                  {t(`reviewTag.${tag}`)}
                </button>
              );
            })}
          </div>

          <p className="mt-2 text-sm text-ink-400">
            {t('review.tagLimit', { max: MAX_REVIEW_TAGS })}
          </p>
        </div>
      )}

      {rating > 0 && (
        <div className="mt-4">
          <Textarea
            label={t('review.commentLabel')}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={MAX_REVIEW_COMMENT}
            placeholder={t('review.commentPlaceholder')}
            hint={t('review.commentOptional')}
          />
        </div>
      )}

      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div className="mt-5">
        <Button fullWidth loading={busy} disabled={rating === 0} onClick={submit}>
          {t('review.submit')}
        </Button>
      </div>
    </div>
  );
}
