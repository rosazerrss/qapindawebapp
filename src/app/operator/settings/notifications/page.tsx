'use client';

/**
 * Operator → Ayarlar → Bildirişlər.
 *
 * The screen the per-type switches were actually asked for: an operator's
 * screen is a queue, and an operator watching the late-delivery lane does not
 * want nine hundred "yeni sifariş" lines in their bell. `switchableTypesFor`
 * and `mayToggleType` decide which of the nine they may switch, and
 * `OPS_ORDER_PROBLEM` is deliberately not one of them — everything else in that
 * list is the platform noticing something, and that one is a person saying so.
 */

import { OperatorShell } from '@/components/panel/OperatorShell';
import { NotificationSettings } from '@/components/notifications/NotificationSettings';
import { useT } from '@/i18n';
import { OPERATOR_ROOT } from '@/shared/permissions';

export default function OperatorNotificationSettingsPage() {
  const t = useT();

  return (
    <OperatorShell
      title={t('notifications.settingsTitle')}
      subtitle={t('notifications.settingsHint')}
      backHref={`${OPERATOR_ROOT}/settings`}
    >
      <div className="mx-auto max-w-2xl">
        <NotificationSettings />
      </div>
    </OperatorShell>
  );
}
