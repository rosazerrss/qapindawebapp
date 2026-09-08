'use client';

/**
 * Hesabım → Ayarlar → Geri bildirim.
 *
 * WHAT LANDS HERE
 * ---------------
 * A support ticket an operator has closed. The owner asked for exactly that —
 * *"operator müşteri deteyini bağladıqdan sonra hemin yere düşsün"* — so the
 * customer can see how it ended and say whether it was handled well, without
 * going back into a conversation that is finished.
 *
 * WHY THE LIST EMPTIES ITSELF
 * ---------------------------
 * *"orada çox qalmasın ... bir müddet sonra silinsin"*. Each entry carries an
 * `expiresAt` and is genuinely deleted by `purgeExpiredSupportFeedback` on the
 * server. This screen also hides an entry the moment it expires, because the
 * job runs on a schedule and an entry can outlive its period by up to an hour —
 * hiding it in that window is the difference between the promise being true and
 * being nearly true. It is NOT the only thing standing between the entry and
 * the database, which is the trap: hiding without deleting would leave every
 * closed ticket piling up behind a screen that claims they are gone.
 *
 * The support ticket itself is never deleted. What expires is this prompt; the
 * rating a person leaves is written onto the ticket as they leave it.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquareText, Star } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Alert, Button, Card, EmptyState, cn } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale, translateError } from '@/i18n';
import { rateSupportFeedback } from '@/firebase/callables';
import { watchMyFeedback } from '@/services/feedback';
import {
  SUPPORT_FEEDBACK_MAX_RATING,
  SUPPORT_FEEDBACK_RETENTION_DAYS,
  supportFeedbackDaysLeft,
  supportFeedbackExpired,
} from '@/shared/feedback';
import type { SupportFeedback, TimestampLike } from '@/shared/models';

/** A Firestore timestamp, or a pending write that has no millis yet. */
function millisOf(value: TimestampLike | null | undefined): number {
  if (!value) return 0;
  return typeof value.toMillis === 'function' ? value.toMillis() : 0;
}

export default function FeedbackPage() {
  const { t, locale } = useLocale();
  const { firebaseUser, loading } = useAuth();

  /*
   * The snapshot carries the uid it belongs to, so "not loaded yet", "loaded
   * and empty" and "somebody else's, from before they signed out" stay
   * separable during render. One piece of state rather than three, because the
   * three would drift apart at exactly the moment an account changes — and
   * because nothing then has to be cleared by an effect.
   */
  const [snapshot, setSnapshot] = useState<{
    uid: string;
    entries: SupportFeedback[] | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    const uid = firebaseUser.uid;

    return watchMyFeedback(
      uid,
      (next) => setSnapshot({ uid, entries: next, failed: false }),
      () => setSnapshot({ uid, entries: [], failed: true }),
    );
  }, [firebaseUser]);

  const mine = firebaseUser && snapshot?.uid === firebaseUser.uid ? snapshot : null;
  const entries = mine?.entries ?? null;
  const failed = mine?.failed ?? false;

  /*
   * The clock this screen filters against, read once when it opens.
   *
   * An entry expires up to an hour before the sweep deletes it, and hiding it
   * in that window is what keeps "it disappears after two weeks" true. Read in
   * a state initialiser rather than during render: `Date.now()` in a render
   * body is a different answer every time React happens to re-render, and this
   * list does not need to re-filter itself second by second — the next snapshot
   * or the next visit is soon enough.
   */
  const [nowMs] = useState(() => Date.now());

  if (loading) {
    return (
      <AppShell>
        <PageLoading label={t('common.loading')} />
      </AppShell>
    );
  }

  if (!firebaseUser) {
    return (
      <AppShell>
        <ScreenHeader title={t('feedback.title')} fallbackHref="/account/settings" />
        <EmptyState
          title={t('feedback.signIn')}
          hint={t('auth.guestHint')}
          action={
            <Link href="/login?next=/account/settings/feedback">
              <Button size="sm">{t('auth.signIn')}</Button>
            </Link>
          }
        />
      </AppShell>
    );
  }

  const visible = entries?.filter(
    (entry) => !supportFeedbackExpired(millisOf(entry.expiresAt), nowMs),
  );

  return (
    <AppShell>
      <ScreenHeader
        title={t('feedback.title')}
        subtitle={t('feedback.subtitle')}
        fallbackHref="/account/settings"
      />

      {failed && (
        <div className="mb-4">
          <Alert tone="warning">{t('feedback.loadFailed')}</Alert>
        </div>
      )}

      {entries === null && !failed ? (
        <div
          className="space-y-2.5"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={t('common.loading')}
        >
          {[0, 1].map((row) => (
            <div key={row} className="h-32 animate-pulse rounded-2xl bg-ink-100" aria-hidden />
          ))}
        </div>
      ) : !visible || visible.length === 0 ? (
        <EmptyState
          title={t('feedback.empty')}
          hint={t('feedback.emptyHint')}
          action={
            <Link href="/account/support">
              <Button size="sm" variant="secondary">
                {t('account.help')}
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((entry) => (
            <FeedbackCard key={entry.id} entry={entry} nowMs={nowMs} locale={locale} />
          ))}
        </div>
      )}

      <p className="mt-8 flex items-start gap-2 rounded-2xl bg-ink-50 px-4 py-3.5 text-sm text-ink-600">
        <MessageSquareText size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
        {t('feedback.retentionNote', { days: SUPPORT_FEEDBACK_RETENTION_DAYS })}
      </p>
    </AppShell>
  );
}

/** One closed ticket: what it was, when it ended, and the stars. */
function FeedbackCard({
  entry,
  nowMs,
  locale,
}: {
  entry: SupportFeedback;
  nowMs: number;
  locale: string;
}) {
  const { t } = useLocale();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The rating shown is whatever this screen last sent, falling back to what is
   * stored. Derived rather than copied into state on mount: the entry is live,
   * so the server's confirmation arrives as a new `entry` and a copy taken once
   * would go on showing the optimistic value even if the write had failed.
   */
  const [sent, setSent] = useState<number | null>(null);
  const rating = sent ?? entry.rating ?? 0;

  const closedMs = millisOf(entry.closedAt);
  const daysLeft = supportFeedbackDaysLeft(millisOf(entry.expiresAt), nowMs);

  const rate = async (value: number) => {
    setSent(value);
    setSaving(true);
    setError(null);

    const result = await rateSupportFeedback({ feedbackId: entry.id, rating: value });
    setSaving(false);

    if (result.ok) return;

    // Back to whatever the server actually holds. A star left lit by a refused
    // write is a rating nobody recorded.
    setSent(null);
    setError(translateError(t, result.errorCode, result.errorDetail));
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink-900">{entry.subject}</p>
          <p className="mt-0.5 text-sm text-ink-500">
            {entry.orderCode
              ? t('feedback.aboutOrder', { code: entry.orderCode })
              : t('feedback.aboutGeneral')}
            {closedMs > 0 && ` · ${new Date(closedMs).toLocaleDateString(locale)}`}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-success">
          {t('feedback.closed')}
        </span>
      </div>

      <p className="mt-3 text-sm text-ink-600">
        {entry.rating === null && sent === null
          ? t('feedback.askRating')
          : t('feedback.thanks')}
      </p>

      <div className="mt-2 flex items-center gap-1" role="group" aria-label={t('feedback.askRating')}>
        {Array.from({ length: SUPPORT_FEEDBACK_MAX_RATING }, (unused, index) => index + 1).map(
          (value) => (
            <button
              key={value}
              type="button"
              disabled={saving}
              onClick={() => void rate(value)}
              aria-label={t('feedback.starLabel', { count: value })}
              aria-pressed={rating === value}
              className="flex h-11 w-11 items-center justify-center rounded-xl transition hover:bg-ink-100 disabled:opacity-50"
            >
              <Star
                size={22}
                aria-hidden
                strokeWidth={1.8}
                className={cn(
                  value <= rating ? 'fill-amber-400 text-amber-400' : 'text-ink-300',
                )}
              />
            </button>
          ),
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-400">{t('feedback.daysLeft', { days: daysLeft })}</p>
    </Card>
  );
}
