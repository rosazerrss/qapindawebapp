'use client';

/**
 * The list of notifications, and one row of it.
 *
 * Extracted from `NotificationBell` so that a screen which is *only* the
 * notifications — the courier's Bildirişlər page — draws exactly the rows the
 * bell draws, rather than a second implementation that slowly stops agreeing
 * with it about what unread looks like.
 *
 * WHAT A ROW HAS TO SAY
 * ---------------------
 * A notification is stored as a translation key and a bag of parameters, never
 * as a finished sentence, so that somebody who switches the app to Russian sees
 * their old notifications in Russian too. Every row here is therefore built by
 * `t(titleKey, params)` at render time and by nothing else.
 *
 * Priority is legible without reading: an unread row carries a coloured spine
 * on its leading edge and a word for it, and CRITICAL — "somebody is about to
 * do the wrong thing" — is the only one that is red. Colour is never the sole
 * carrier; the label says it too.
 */

import { Badge, EmptyState, cn } from '@/components/ui';
import { useT, type Translate } from '@/i18n';
import { NotificationPriority } from '@/shared/notifications';
import type { AppNotification, TimestampLike } from '@/shared/models';

/** The spine down the leading edge, and the word that says the same thing. */
const PRIORITY_STYLE: Record<
  string,
  { spine: string; tone: 'neutral' | 'brand' | 'warning' | 'danger' }
> = {
  [NotificationPriority.CRITICAL]: { spine: 'bg-danger', tone: 'danger' },
  [NotificationPriority.HIGH]: { spine: 'bg-warning', tone: 'warning' },
  [NotificationPriority.NORMAL]: { spine: 'bg-brand-500', tone: 'brand' },
  [NotificationPriority.LOW]: { spine: 'bg-ink-200', tone: 'neutral' },
};

/**
 * Turns the enum values a notification carries into words.
 *
 * WHAT WAS ON SCREEN BEFORE
 * -------------------------
 *     Üç Qardaş — QP-4821 — CUSTOMER — ITEM_UNAVAILABLE
 *
 * The operator alerts are built on the server, where there is no dictionary and
 * no idea which language the reader has chosen, so they pass the raw enum:
 * `by: 'CUSTOMER'`, `reason: 'ITEM_UNAVAILABLE'`. The dictionary then
 * interpolates it verbatim, and the person who most needs to understand a
 * cancellation at a glance reads it in capitals, in English, in a language the
 * rest of the sentence is not in.
 *
 * Translating here rather than on the server is the right side of the line: the
 * server records WHAT HAPPENED and the screen decides how to say it, which is
 * also what makes the same stored notification readable in three languages.
 *
 * Anything that is not a known enum passes through untouched — a restaurant
 * name, an order code, a number of minutes.
 */
function readable(
  t: Translate,
  params: Record<string, string | number> | undefined,
): Record<string, string | number> | undefined {
  if (!params) return params;

  const NAMESPACES: Record<string, string> = {
    reason: 'order.reason',
    by: 'orderActor',
    actor: 'orderActor',
    status: 'order.status',
  };

  const out: Record<string, string | number> = { ...params };

  for (const [key, namespace] of Object.entries(NAMESPACES)) {
    const value = params[key];
    if (typeof value !== 'string') continue;
    // Enum-shaped only: `ITEM_UNAVAILABLE`, never a restaurant called "BOZBAŞ".
    if (!/^[A-Z][A-Z0-9_]*$/.test(value)) continue;

    const label = t(`${namespace}.${value}`);
    // `t()` returns the key when it has no entry, which is exactly the string
    // we must not show.
    if (label !== `${namespace}.${value}`) out[key] = label;
  }

  return out;
}

export function NotificationList({
  notifications,
  loaded,
  failed,
  onOpen,
  className,
}: {
  notifications: AppNotification[];
  /** True once the first snapshot has landed — an empty list is not a loading one. */
  loaded: boolean;
  /** The subscription was refused or broke. Never rendered as "no news". */
  failed: boolean;
  onOpen: (notification: AppNotification) => void;
  className?: string;
}) {
  const t = useT();

  if (failed) {
    return (
      <EmptyState title={t('notifications.loadFailed')} hint={t('notifications.loadFailedHint')} />
    );
  }

  if (!loaded) {
    return <p className="py-6 text-center text-sm text-ink-400">{t('common.loading')}</p>;
  }

  if (notifications.length === 0) {
    return <EmptyState title={t('notifications.empty')} hint={t('notifications.emptyHint')} />;
  }

  return (
    <ul className={cn('-mx-1 divide-y divide-row-edge', className)}>
      {notifications.map((notification) => (
        <NotificationRow
          key={notification.notificationId ?? notification.id}
          notification={notification}
          onOpen={() => onOpen(notification)}
        />
      ))}
    </ul>
  );
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: AppNotification;
  onOpen: () => void;
}) {
  const t = useT();
  const priority = PRIORITY_STYLE[notification.priority] ?? PRIORITY_STYLE.NORMAL;
  const unread = !notification.read;

  return (
    <li className="relative">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-ink-50',
          // Unread is a background as well as a weight, so the difference
          // survives a screenshot on a bad phone in daylight.
          unread && 'bg-brand-50/40',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'mt-1 h-9 w-1 shrink-0 rounded-full',
            unread ? priority.spine : 'bg-transparent',
          )}
        />

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'text-[15px] text-ink-900',
                unread ? 'font-semibold' : 'font-medium text-ink-600',
              )}
            >
              {t(notification.titleKey, readable(t, notification.params))}
            </span>
            {unread && notification.priority !== NotificationPriority.LOW && (
              <Badge tone={priority.tone}>
                {t(`notifications.priority.${notification.priority}`)}
              </Badge>
            )}
          </span>

          <span className="mt-0.5 block text-sm text-ink-500">
            {t(notification.bodyKey, readable(t, notification.params))}
          </span>

          <span className="mt-1 block text-xs text-ink-400">
            {formatWhen(notification.createdAt, t)}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * "Just now", "14 min", "3 h", then the date.
 *
 * Relative for as long as relative is the more useful answer — a courier wants
 * "4 minutes ago", not a clock time they have to subtract from. Past a day it
 * inverts and the date is what somebody is actually looking for.
 */
function formatWhen(
  createdAt: TimestampLike | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!createdAt || typeof createdAt.toMillis !== 'function') return '';

  const minutes = Math.max(0, Math.floor((Date.now() - createdAt.toMillis()) / 60_000));
  if (minutes < 1) return t('notifications.justNow');
  if (minutes < 60) return t('notifications.minutesAgo', { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('notifications.hoursAgo', { count: hours });

  return createdAt.toDate().toLocaleDateString();
}
