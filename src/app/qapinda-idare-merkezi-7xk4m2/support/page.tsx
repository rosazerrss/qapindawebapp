'use client';

/**
 * Support, seen from the admin panel.
 *
 * The inbox itself is `SupportInbox`, which the operator screen mounts too —
 * there is one implementation of "who is waiting" and both panels show it.
 * What differs is what comes back: `listSupportTickets` gives the admin all
 * three lanes and an operator only the two they work, and that filtering
 * happens on the server, so this page is genuinely only the shell around it.
 *
 * The one-off migration button sits here rather than in Ayarlar because this
 * is the screen whose data it changes. It carries every pre-ticket restaurant
 * thread into a ticket with its messages intact; it is idempotent, so pressing
 * it twice is safe, and it leaves the original conversations in place.
 */

import { useState } from 'react';
import { History } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import { SupportInbox } from '@/components/panel/SupportInbox';
import { useToast } from '@/components/panel/Toast';
import { Button } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { migrateSupportConversations } from '@/firebase/callables';

export default function AdminSupportPage() {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const migrate = async () => {
    setBusy(true);
    const result = await migrateSupportConversations();
    setBusy(false);

    if (!result.ok) {
      toast.show(translateError(t, result.errorCode, result.errorDetail), 'danger');
      return;
    }

    toast.show(
      t('support.migrationDone', {
        tickets: result.data?.migrated ?? 0,
        messages: result.data?.messagesCopied ?? 0,
      }),
    );
  };

  return (
    <PanelShell kind="admin">
      <SupportInbox subtitle={t('support.adminSubtitle')} />

      <div className="mt-6 border-t border-ink-200 pt-4">
        <p className="mb-2 text-sm text-ink-500">{t('support.migrationHint')}</p>
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void migrate()}>
          <History size={15} />
          {t('support.migrate')}
        </Button>
      </div>
    </PanelShell>
  );
}
