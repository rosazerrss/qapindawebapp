'use client';

/**
 * Operator → Bildirişlər.
 *
 * An operator's screen is a queue, and a modal over a queue is the worst of the
 * three cases: the live order list keeps updating behind a dialog that has
 * locked the page, and the operator cannot see the thing they are being told
 * about. So this is a page, like the other two.
 */

import { OperatorShell } from '@/components/panel/OperatorShell';
import { NotificationInbox } from '@/components/notifications/NotificationInbox';
import { useT } from '@/i18n';
import { OPERATOR_ROOT } from '@/shared/permissions';

export default function OperatorNotificationsPage() {
  const t = useT();

  return (
    <OperatorShell
      title={t('notifications.title')}
      subtitle={t('notifications.pageHint')}
      backHref={OPERATOR_ROOT}
    >
      <NotificationInbox className="mx-auto max-w-3xl" />
    </OperatorShell>
  );
}
