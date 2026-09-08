'use client';

/**
 * Admin Panel → Ayarlar.
 *
 * An index, not a form. Each card opens a screen where one thing is configured
 * and one Save button belongs to it — see `SettingsForm.tsx` for why the long
 * single column this replaced was a hazard rather than merely untidy.
 */

import { Bell, Building2, Clock, CreditCard, Landmark, LifeBuoy, Power, Trash2 } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import { PageHeader } from '@/components/panel/ui';
import { SettingsIndex, type SettingsEntry } from '@/components/panel/SettingsIndex';
import { useT } from '@/i18n';
import { ADMIN_ROOT } from '@/shared/permissions';

export default function AdminSettingsPage() {
  const t = useT();
  const root = `${ADMIN_ROOT}/settings`;

  const entries: SettingsEntry[] = [
    {
      href: `${root}/general`,
      icon: Building2,
      title: t('admin.settingsGeneral'),
      description: t('admin.settingsGeneralHint'),
    },
    {
      href: `${root}/timing`,
      icon: Clock,
      title: t('admin.settingsTiming'),
      description: t('admin.settingsTimingHint'),
    },
    {
      href: `${root}/payments`,
      icon: CreditCard,
      title: t('admin.settingsPayments'),
      description: t('admin.settingsPaymentsHint'),
    },
    {
      href: `${root}/bank`,
      icon: Landmark,
      title: t('admin.settingsBank'),
      description: t('admin.settingsBankHint'),
    },
    {
      href: `${root}/support`,
      icon: LifeBuoy,
      title: t('admin.settingsSupport'),
      description: t('admin.settingsSupportHint'),
    },
    {
      href: `${root}/platform`,
      icon: Power,
      title: t('admin.settingsPlatform'),
      description: t('admin.settingsPlatformHint'),
    },
    {
      // The admin's own inbox, not the platform's. Everything else here changes
      // what happens to other people; this changes only what the person signed
      // in right now hears.
      href: `${root}/notifications`,
      icon: Bell,
      title: t('notifications.settingsTitle'),
      description: t('notifications.settingsHint'),
    },
    {
      href: `${root}/danger`,
      icon: Trash2,
      title: t('admin.settingsDanger'),
      description: t('admin.settingsDangerHint'),
      danger: true,
    },
  ];

  return (
    <PanelShell kind="admin">
      <PageHeader title={t('nav.settings')} subtitle={t('admin.settingsSubtitle')} />
      <SettingsIndex entries={entries} />
    </PanelShell>
  );
}
