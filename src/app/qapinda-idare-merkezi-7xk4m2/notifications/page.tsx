'use client';

/**
 * Admin → Bildirişlər.
 *
 * The same screen the restaurant reads, in the admin's shell. Sharing the body
 * is what stops the two disagreeing about what an unread notification looks
 * like — which is exactly how the bell ended up behaving differently in
 * different panels before it was made one component.
 */

import { PanelShell } from '@/components/layout/PanelShell';
import { PageHeader } from '@/components/panel/ui';
import { NotificationInbox } from '@/components/notifications/NotificationInbox';
import { useT } from '@/i18n';
import { ADMIN_ROOT } from '@/shared/permissions';

export default function AdminNotificationsPage() {
  const t = useT();

  return (
    <PanelShell kind="admin">
      <PageHeader title={t('notifications.title')} subtitle={t('notifications.pageHint')} backHref={ADMIN_ROOT} />
      <NotificationInbox className="mx-auto max-w-3xl" />
    </PanelShell>
  );
}
