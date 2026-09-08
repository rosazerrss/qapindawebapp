'use client';

/**
 * Restoran Paneli → Ayarlar → Printerlər.
 *
 * The slips this restaurant prints, and which of them print by themselves.
 * `PrintStationEditor` carries the honest note about what a browser can and
 * cannot do with printers; this page gives it a title and a way back.
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
        title={t('restaurantPanel.sectionPrinters')}
        subtitle={t('restaurantPanel.sectionPrintersHint')}
        backHref="/panel/settings"
      />
      <RestaurantSettingsSection section="printers" />
    </PanelShell>
  );
}
