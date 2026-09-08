'use client';

/**
 * Ayarlar → Bildirişlər. The one place a courier's notification switches live.
 *
 * `NotificationSettings` is the same component the customer, the restaurant,
 * the operator and the admin see; what a courier gets out of it is decided by
 * `shared/notifications.ts` and not here. That is why there is no courier
 * variant of the settings: `roleAudience` puts this account in the COURIER
 * panel, `switchableTypesFor` answers with the types it may receive, and none
 * of them is a chat notification — because a courier has no chat.
 *
 * What the switches can and cannot do is said on the screen by the component
 * itself: sound and push reach every type, and a cancelled delivery is shown
 * whatever the settings say, because a driver who muted their new-order sound
 * is still riding towards that address.
 */

import { CourierShell } from '@/components/courier/CourierShell';
import { NotificationSettings } from '@/components/notifications/NotificationSettings';
import { useT } from '@/i18n';

export default function CourierNotificationSettingsPage() {
  const t = useT();

  return (
    <CourierShell title={t('notifications.settingsTitle')} backHref="/courier/settings">
      <p className="mb-3 text-base text-ink-500">{t('notifications.settingsHint')}</p>
      <NotificationSettings />
    </CourierShell>
  );
}
