'use client';

/**
 * Complaints, seen from the admin panel.
 *
 * The queue itself is `ComplaintsQueue`, shared with the operator screen. The
 * admin keeps `customerContact`: an owner chasing a serious complaint may need
 * to reach the person who filed it, which is a decision the owner makes, not a
 * routine part of working the queue.
 */

import { PanelShell } from '@/components/layout/PanelShell';
import { ComplaintsQueue } from '@/components/panel/ComplaintsQueue';
import { useT } from '@/i18n';

export default function AdminComplaintsPage() {
  const t = useT();

  return (
    <PanelShell kind="admin">
      <ComplaintsQueue subtitle={t('complaintPanel.adminSubtitle')} customerContact />
    </PanelShell>
  );
}
