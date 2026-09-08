'use client';

/**
 * Bildirişlər — the driver's inbox, and nothing else.
 *
 * There is no settings button on this screen. Every switch lives at Ayarlar →
 * Bildirişlər, which is the whole point of that page existing: a control that
 * can be reached from a screen somebody is working is a control that gets
 * pressed by accident, and the accident here is a driver silencing the phone
 * that tells them a delivery was cancelled.
 *
 * A courier is never sent a chat notification, because a courier has no chat.
 * `SUPPORT_MESSAGE` does not list COURIER in its audience and `roleMayReceive`
 * is checked before any notification is written, so there is no path by which
 * one could arrive here.
 */

import { useRouter } from 'next/navigation';

import { CourierShell, useCourierNotifications } from '@/components/courier/CourierShell';
import { NotificationList } from '@/components/notifications/NotificationList';
import { useT } from '@/i18n';
import type { AppNotification } from '@/shared/models';

export default function CourierNotificationsPage() {
  const t = useT();

  return (
    <CourierShell title={t('notifications.title')}>
      <Inbox />
    </CourierShell>
  );
}

/** Inside the shell: the list it draws is the shell's own subscription. */
function Inbox() {
  const t = useT();
  const router = useRouter();
  const { notifications, unreadCount, loaded, failed, markRead, markAllRead } =
    useCourierNotifications();

  const follow = (notification: AppNotification) => {
    markRead(notification);
    if (notification.link) router.push(notification.link);
  };

  return (
    <>
      {unreadCount > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-base text-ink-500">
            {t('notifications.unreadCount', { count: unreadCount })}
          </span>
          <button
            type="button"
            onClick={markAllRead}
            className="min-h-11 rounded-lg px-2 text-base font-medium text-brand-600 hover:bg-brand-50"
          >
            {t('notifications.markAllRead')}
          </button>
        </div>
      )}

      <NotificationList
        notifications={notifications}
        loaded={loaded}
        failed={failed}
        onOpen={follow}
      />
    </>
  );
}
