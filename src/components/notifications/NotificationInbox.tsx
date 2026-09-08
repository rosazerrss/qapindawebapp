'use client';

/**
 * The notifications, as a screen rather than as a modal.
 *
 * WHY THIS EXISTS
 * ---------------
 * The bell used to open a bottom sheet on every surface, including the four
 * staff panels, and on those it was the wrong shape. A modal locks the page
 * behind it, traps the keyboard, and mounts up to a hundred rows on top of a
 * screen that is already carrying the live order listeners — so pressing the
 * bell on a busy restaurant panel froze the interface for several seconds.
 *
 * The courier already read its notifications on a page and always had. This is
 * that same arrangement given to the restaurant, the operator and the admin,
 * with the body shared so the four cannot drift apart about what an unread
 * notification looks like or what "mark everything read" does.
 *
 * Each panel wraps it in its own shell — that is the only difference between
 * the three screens that use it, and it is the reason this is a component and
 * not a page.
 *
 * THE SETTINGS ARE NOT ON THIS SCREEN
 * -----------------------------------
 * Deliberately, and for the third time: the owner asked twice that the
 * switches stop being reachable from a working screen, because a control you
 * can reach while working is a control that gets pressed by accident — and the
 * accident here is a kitchen silencing the sound that tells it an order has
 * arrived. There is a link, and the link goes to Ayarlar → Bildirişlər.
 */

import { useRouter } from 'next/navigation';
import { Settings2 } from 'lucide-react';

import { NotificationList } from './NotificationList';
import { useNotifications } from './useNotifications';
import { useT } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { notificationSettingsPath } from '@/shared/permissions';
import type { AppNotification } from '@/shared/models';

export function NotificationInbox({ className }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const { role } = useAuth();
  const { notifications, unreadCount, loaded, failed, markRead, markAllRead } =
    useNotifications();

  const follow = (notification: AppNotification) => {
    markRead(notification);
    if (notification.link) router.push(notification.link);
  };

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => router.push(notificationSettingsPath(role))}
          className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
        >
          <Settings2 size={16} aria-hidden />
          {t('notifications.settingsTitle')}
        </button>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="min-h-11 rounded-lg px-2 text-sm font-medium text-brand-600 transition hover:bg-brand-50"
          >
            {t('notifications.markAllRead')}
          </button>
        )}
      </div>

      <NotificationList
        notifications={notifications}
        loaded={loaded}
        failed={failed}
        onOpen={follow}
      />
    </div>
  );
}
