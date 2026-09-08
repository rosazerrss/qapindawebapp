'use client';

/**
 * Admin Panel → Ayarlar → one area, on its own.
 *
 * The form itself lives in `../SettingsForm`, which is the only place that
 * knows how to load and save the settings document; this page decides which
 * part of it is on screen and gives it a title and a way back.
 */

import { PanelShell } from '@/components/layout/PanelShell';
import { PageHeader } from '@/components/panel/ui';
import { AdminSettingsSection } from '../SettingsForm';
import { useT } from '@/i18n';
import { ADMIN_ROOT } from '@/shared/permissions';

export default function Page() {
  const t = useT();

  return (
    <PanelShell kind="admin">
      <PageHeader
        title={t('admin.settingsDanger')}
        subtitle={t('admin.settingsDangerHint')}
        backHref={`${ADMIN_ROOT}/settings`}
      />
      <AdminSettingsSection section="danger" />
    </PanelShell>
  );
}
