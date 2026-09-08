'use client';

/**
 * Restoran paneli → Bildirişlər.
 *
 * A page and not a sheet, and that is the whole point of the screen existing:
 * the bell used to open a modal over the panel, which locks the page behind it
 * and mounts a hundred rows on top of the live order listeners. On a busy
 * evening that froze the interface for several seconds. See
 * `NotificationInbox` and `notificationsPagePath` for the full argument.
 */

import { PanelShell } from '@/components/layout/PanelShell';
import { PageHeader } from '@/components/panel/ui';
import { NotificationInbox } from '@/components/notifications/NotificationInbox';
import { useT } from '@/i18n';

export default function RestaurantNotificationsPage() {
  const t = useT();

  return (
    <PanelShell kind="restaurant">
      <PageHeader title={t('notifications.title')} subtitle={t('notifications.pageHint')} backHref="/panel" />
      <NotificationInbox className="mx-auto max-w-3xl" />
    </PanelShell>
  );
}
