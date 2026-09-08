'use client';

/**
 * Restoran Paneli → Ayarlar → one area, on its own.
 *
 * The form lives in `../SettingsForm`, which is the only place that knows how
 * to load and save the restaurant; this page decides which part of it is on
 * screen and gives it a title and a way back.
 */

import { PanelShell } from '@/components/layout/PanelShell';
import { PageHeader } from '@/components/panel/ui';
import { RestaurantSettingsSection } from '../SettingsForm';
import { useT } from '@/i18n';

export default function Page() {
  const t = useT();

  return (
    <PanelShell kind="restaurant">
      <PageHeader
        title={t('restaurantPanel.sectionProfile')}
        subtitle={t('restaurantPanel.sectionProfileHint')}
        backHref="/panel/settings"
      />
      <RestaurantSettingsSection section="profile" />
    </PanelShell>
  );
}
