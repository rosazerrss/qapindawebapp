'use client';

/**
 * Restoran Paneli → Ayarlar → Bildirişlər.
 *
 * The switches used to be a section halfway down the shopfront settings form,
 * between the opening hours and the language picker. They are not a property of
 * the restaurant at all — they follow whoever is signed in, so a manager
 * working an evening shift can silence their own phone without changing
 * anything for the owner or for the kitchen account — and putting them in the
 * middle of a form somebody scrolls through to change a delivery radius is how
 * a kitchen ends up wondering why it stopped hearing orders.
 *
 * WHAT "YENİ SİFARİŞ SƏSİ" DOES AND DOES NOT DO
 * ---------------------------------------------
 * Switching it off stops the repeating alarm. It stops nothing else: the order
 * still lands in the panel, the new-order column still counts it, the
 * notification is still written and still listed in the bell, and push still
 * works if it is on. Silencing is not deleting, and the component says so on
 * screen rather than leaving a kitchen to find out.
 *
 * "TEST BİLDİRİŞİ GÖNDƏR" IS ON THIS PAGE FOR A REASON
 * ---------------------------------------------------
 * It is the question a restaurant actually has — "am I going to hear the next
 * order" — and the answer is only worth anything if the test goes the whole way
 * round: a real document written by the real server, delivered by the real
 * listener, drawn by the real bell. It does.
 */

import { PanelShell } from '@/components/layout/PanelShell';
import { PageHeader } from '@/components/panel/ui';
import { NotificationSettings } from '@/components/notifications/NotificationSettings';
import { useT } from '@/i18n';

export default function RestaurantNotificationSettingsPage() {
  const t = useT();

  return (
    <PanelShell kind="restaurant">
      <PageHeader
        title={t('notifications.settingsTitle')}
        subtitle={t('notifications.settingsHint')}
        backHref="/panel/settings"
      />
      <div className="max-w-2xl">
        <NotificationSettings />
      </div>
    </PanelShell>
  );
}
