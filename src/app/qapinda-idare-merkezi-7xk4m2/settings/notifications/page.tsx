'use client';

/**
 * Admin Panel → Ayarlar → Bildirişlər.
 *
 * The admin's own inbox, not the platform's. Everything on the settings page
 * this one hangs off changes what happens to other people — commission, timing,
 * whether the app is open at all; this changes only what the person signed in
 * right now hears, which is why it is a separate screen rather than another
 * section in that form. Pressing "Yadda saxla" on platform settings should
 * never be the thing that also saved somebody's notification switches.
 *
 * The per-type list is the part an admin actually comes here for: the platform
 * owner is the last line of support for everything in the system and is
 * therefore addressable by every notification in it, which without a switch per
 * kind would be an inbox nobody can read.
 */

import { PanelShell } from '@/components/layout/PanelShell';
import { PageHeader } from '@/components/panel/ui';
import { NotificationSettings } from '@/components/notifications/NotificationSettings';
import { useT } from '@/i18n';
import { ADMIN_ROOT } from '@/shared/permissions';

export default function AdminNotificationSettingsPage() {
  const t = useT();

  return (
    <PanelShell kind="admin">
      <PageHeader
        title={t('notifications.settingsTitle')}
        subtitle={t('notifications.settingsHint')}
        backHref={`${ADMIN_ROOT}/settings`}
      />
      <div className="max-w-2xl">
        <NotificationSettings />
      </div>
    </PanelShell>
  );
}
