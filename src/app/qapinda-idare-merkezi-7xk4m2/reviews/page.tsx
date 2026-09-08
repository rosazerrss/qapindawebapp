'use client';

/**
 * Review moderation.
 *
 * There is no "all reviews" screen and there cannot be one: reviews are queried
 * by restaurant, and a collection-wide listing would be an unbounded read that
 * grows with the marketplace. So the screen asks which restaurant first, and
 * everything else follows from that answer.
 *
 * HIDING IS NOT DELETING
 * ----------------------
 * `setReviewHidden` sets a flag and subtracts the rating from the restaurant's
 * average. The document stays, with the reason and the moderator recorded in
 * the audit log, so a customer who asks "why was my review removed" gets an
 * answer six months later. Nothing on this screen destroys anything.
 *
 * A hidden review also leaves this list, because `listReviews` returns only
 * visible ones. Un-hiding is therefore not done from here — it is an audit-log
 * question, deliberately harder than hiding.
 */

import { useEffect, useState } from 'react';
import { EyeOff } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import {
  ConfirmDialog,
  DataTable,
  FilterSelect,
  PageHeader,
  Toolbar,
  type Column,
} from '@/components/panel/ui';
import { useToast } from '@/components/panel/Toast';
import { RatingStars } from '@/components/customer/RatingStars';
import { reviewDate, reviewTagLabel } from '@/components/customer/ReviewsSheet';
import { Alert, Badge, Button, EmptyState, Textarea } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { listReviews, setReviewHidden } from '@/firebase/callables';
import { listRestaurants } from '@/services/catalog';
import { list, num, text } from '@/lib/stored';
import type { Restaurant } from '@/shared/models';

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

export default function AdminReviewsPage() {
  const t = useT();
  const toast = useToast();

  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [restaurantsError, setRestaurantsError] = useState<string | null>(null);
  const [restaurantId, setRestaurantId] = useState('');
  // Tagged with the restaurant it belongs to, so switching the filter shows a
  // loading table rather than the previous restaurant's reviews for a frame.
  const [loaded, setLoaded] = useState<{
    restaurantId: string;
    rows: ReviewRow[];
    error: string | null;
  } | null>(null);
  const [hiding, setHiding] = useState<ReviewRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // `listRestaurants` rejecting used to leave the picker permanently empty
    // with nothing said, which reads as "this platform has no restaurants".
    void listRestaurants()
      .then((found) => {
        if (cancelled) return;
        setRestaurants(found);
        setRestaurantsError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setRestaurants([]);
        setRestaurantsError(t('errors.LIST_UNAVAILABLE'));
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!restaurantId) return;

    let cancelled = false;

    void listReviews(restaurantId).then((result) => {
      if (cancelled) return;
      setLoaded({
        restaurantId,
        rows: result.ok && result.data ? list<ReviewRow>(result.data.reviews) : [],
        error: result.ok ? null : translateError(t, result.errorCode, result.errorDetail),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [restaurantId, t]);

  const fresh = loaded?.restaurantId === restaurantId ? loaded : null;
  const reviews = fresh?.rows ?? null;
  const reviewsError = fresh?.error ?? null;

  const hide = async () => {
    if (!hiding) return;

    setBusy(true);
    setError(null);

    const result = await setReviewHidden({
      reviewId: hiding.id,
      hidden: true,
      reason: reason.trim(),
    });
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    toast.show(t('review.doneHidden'));
    // Drop it locally rather than refetching: the server has already excluded
    // it from the next listing, and a refetch would only cost a round trip.
    setLoaded((current) =>
      current
        ? { ...current, rows: current.rows.filter((row) => row.id !== hiding.id) }
        : current,
    );
    setHiding(null);
    setReason('');
  };

  const columns: Column<ReviewRow>[] = [
    {
      key: 'rating',
      header: t('filters.rating'),
      cell: (row) => <RatingStars value={num(row.rating)} size={14} />,
      sortValue: (row) => num(row.rating),
    },
    {
      key: 'customer',
      header: t('admin.customer'),
      cell: (row) => (
        <span className="block">
          <span className="block text-ink-900">{text(row.customerName) || '—'}</span>
          <span className="block text-xs text-ink-400">#{text(row.orderCode)}</span>
        </span>
      ),
      sortValue: (row) => text(row.customerName),
    },
    {
      key: 'tags',
      header: t('review.tags'),
      cell: (row) =>
        list<string>(row.tags).length === 0 ? (
          <span className="text-ink-300">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {list<string>(row.tags).map((tag) => (
              <Badge key={tag} tone={num(row.rating) >= 4 ? 'success' : 'warning'}>
                {reviewTagLabel(t, tag)}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      key: 'comment',
      header: t('review.comment'),
      cell: (row) => (
        <span className="block max-w-md">
          <span className="block whitespace-pre-line text-ink-800">
            {row.comment || <span className="text-ink-300">—</span>}
          </span>
          {row.reply && (
            <span className="mt-1 block text-xs text-ink-400">
              {t('review.replyFrom')}: {row.reply}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'date',
      header: t('admin.createdAt'),
      align: 'right',
      cell: (row) => <span className="text-xs text-ink-500">{reviewDate(row.createdAt)}</span>,
      sortValue: (row) => row.createdAt?._seconds ?? 0,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <span className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setError(null);
              setReason('');
              setHiding(row);
            }}
          >
            <EyeOff size={15} /> {t('review.hide')}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <PanelShell kind="admin">
      <PageHeader title={t('nav.reviews')} subtitle={t('review.moderationSubtitle')} />

      {restaurantsError && (
        <div className="mb-4">
          <Alert tone="danger">{restaurantsError}</Alert>
        </div>
      )}

      <Toolbar>
        <FilterSelect
          value={restaurantId}
          onChange={setRestaurantId}
          label={t('admin.restaurant')}
        >
          <option value="">{t('review.chooseRestaurant')}</option>
          {(restaurants ?? []).map((restaurant) => (
            <option key={restaurant.id} value={restaurant.id}>
              {restaurant.name}
            </option>
          ))}
        </FilterSelect>
      </Toolbar>

      {restaurantId ? (
        <DataTable
          rows={reviews}
          columns={columns}
          rowKey={(row) => row.id}
          error={reviewsError}
          emptyTitle={t('review.empty')}
          emptyHint={t('review.moderationEmptyHint')}
        />
      ) : (
        <EmptyState
          title={t('review.chooseRestaurant')}
          hint={t('review.chooseRestaurantHint')}
        />
      )}

      <ConfirmDialog
        open={Boolean(hiding)}
        title={t('review.hide')}
        body={t('review.warnHide')}
        confirmLabel={t('review.hide')}
        busy={busy}
        onCancel={() => setHiding(null)}
        onConfirm={() => {
          if (reason.trim().length < 10) return;
          void hide();
        }}
      >
        <Textarea
          label={t('admin.reasonRequired')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          hint={t('admin.reasonAudited')}
        />

        {reason.trim().length < 10 && (
          <p className="text-xs text-ink-400">{t('admin.reasonTooShort')}</p>
        )}

        <p className="text-xs text-ink-400">{t('review.hideNotDelete')}</p>

        {error && <Alert tone="danger">{error}</Alert>}
      </ConfirmDialog>
    </PanelShell>
  );
}
