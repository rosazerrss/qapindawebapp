'use client';

/**
 * What customers said, and the one chance to answer.
 *
 * A reply is written once and cannot be edited afterwards — that is the
 * server's rule, not this screen's, and the drawer says so before the button is
 * pressed. An editable reply would let a restaurant rewrite an apology into
 * something else after the customer had already read it.
 *
 * Only visible reviews arrive here: a review the platform has hidden is gone
 * from this list, so a restaurant cannot use its own panel to find out which
 * complaint was taken down.
 */

import { useEffect, useState } from 'react';
import { MessageSquare, Star } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import { DataTable, Drawer, PageHeader, type Column } from '@/components/panel/ui';
import { Stat } from '@/components/panel/Stat';
import { useToast } from '@/components/panel/Toast';
import { RatingStars } from '@/components/customer/RatingStars';
import { reviewDate, reviewTagLabel } from '@/components/customer/ReviewsSheet';
import { Alert, Badge, Button, Textarea } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import { listReviews, replyToReview } from '@/firebase/callables';
import { MAX_REVIEW_REPLY } from '@/shared/reviews';

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

export default function RestaurantReviewsPage() {
  const t = useT();
  const toast = useToast();
  const { restaurantId } = useAuth();

  const [reviews, setReviews] = useState<ReviewRow[] | null>(null);
  const [detail, setDetail] = useState<ReviewRow | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a reply lands. `listReviews` is a callable, not a live query,
  // so the only way the new reply appears in the table is to ask again.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!restaurantId) return;

    let cancelled = false;

    listReviews(restaurantId).then((result) => {
      if (!cancelled) setReviews(result.ok && result.data ? result.data.reviews : []);
    });

    return () => {
      cancelled = true;
    };
  }, [restaurantId, reloads]);

  // Averaged over what came back rather than read from the restaurant document,
  // so the tile and the table under it can never disagree by a decimal.
  const average =
    reviews && reviews.length > 0
      ? reviews.reduce((sum, row) => sum + row.rating, 0) / reviews.length
      : 0;

  const submit = async () => {
    if (!detail) return;

    setBusy(true);
    setError(null);

    const result = await replyToReview({ reviewId: detail.id, reply: reply.trim() });
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    toast.show(t('review.doneReplied'));
    setDetail(null);
    setReply('');
    setReloads((count) => count + 1);
  };

  const columns: Column<ReviewRow>[] = [
    {
      key: 'rating',
      header: t('filters.rating'),
      cell: (row) => <RatingStars value={row.rating} size={14} />,
      sortValue: (row) => row.rating,
    },
    {
      key: 'tags',
      header: t('review.tags'),
      cell: (row) =>
        row.tags.length === 0 ? (
          <span className="text-ink-300">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.tags.map((tag) => (
              <Badge key={tag} tone={row.rating >= 4 ? 'success' : 'warning'}>
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
          <span className="block truncate text-ink-800">
            {row.comment || <span className="text-ink-300">—</span>}
          </span>
          {row.reply ? (
            <span className="mt-0.5 block truncate text-xs text-brand-700">
              {t('review.replied')}
            </span>
          ) : (
            <span className="mt-0.5 block text-xs text-ink-400">{t('review.notReplied')}</span>
          )}
        </span>
      ),
      sortValue: (row) => row.comment ?? '',
    },
    {
      key: 'date',
      header: t('admin.createdAt'),
      align: 'right',
      cell: (row) => <span className="text-xs text-ink-500">{reviewDate(row.createdAt)}</span>,
      sortValue: (row) => row.createdAt?._seconds ?? 0,
    },
  ];

  return (
    <PanelShell kind="restaurant">
      <PageHeader title={t('nav.reviews')} subtitle={t('review.panelSubtitle')} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Stat
          label={t('review.averageRating')}
          value={reviews?.length ? average.toFixed(1) : '—'}
          icon={Star}
          tone="brand"
          hint={t('review.averageHint')}
        />
        <Stat
          label={t('review.totalReviews')}
          value={String(reviews?.length ?? 0)}
          icon={MessageSquare}
          hint={t('review.totalHint')}
        />
      </div>

      <DataTable
        rows={reviews}
        columns={columns}
        rowKey={(row) => row.id}
        onRowClick={(row) => {
          setError(null);
          setReply('');
          setDetail(row);
        }}
        emptyTitle={t('review.empty')}
        emptyHint={t('review.panelEmptyHint')}
      />

      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.customerName ?? ''}
        subtitle={detail ? `#${detail.orderCode} · ${reviewDate(detail.createdAt)}` : undefined}
        footer={
          detail && !detail.reply ? (
            <Button
              fullWidth
              loading={busy}
              disabled={reply.trim().length === 0}
              onClick={() => void submit()}
            >
              {t('review.sendReply')}
            </Button>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-4">
            <RatingStars value={detail.rating} size={20} />

            {detail.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {detail.tags.map((tag) => (
                  <Badge key={tag} tone={detail.rating >= 4 ? 'success' : 'warning'}>
                    {reviewTagLabel(t, tag)}
                  </Badge>
                ))}
              </div>
            )}

            {detail.comment && (
              <p className="whitespace-pre-line text-ink-800">{detail.comment}</p>
            )}

            {detail.reply ? (
              <div className="rounded-xl border-l-2 border-brand-200 bg-white px-3.5 py-3">
                <p className="text-xs font-medium text-brand-700">{t('review.yourReply')}</p>
                <p className="mt-1 whitespace-pre-line text-sm text-ink-700">{detail.reply}</p>
              </div>
            ) : (
              <>
                <Textarea
                  label={t('review.replyLabel')}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  maxLength={MAX_REVIEW_REPLY}
                  placeholder={t('review.replyPlaceholder')}
                  hint={t('review.replyOnce')}
                />
                <p className="text-xs text-ink-400">{t('review.replyPublic')}</p>
              </>
            )}

            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        )}
      </Drawer>
    </PanelShell>
  );
}
