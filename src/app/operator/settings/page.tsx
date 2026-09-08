'use client';

/**
 * Operator → Ayarlar.
 *
 * One entry today, and the place any future one goes — built to match the
 * courier's and the customer's Ayarlar rather than to be clever, because an
 * operator who has also been shown the customer app should not have to learn a
 * second shape for the same idea.
 *
 * It exists at all because the queue screen must stay a queue: no switches on
 * it, only the bell, the count, the list and "hamısını oxundu kimi işarələ".
 */

import Link from 'next/link';
import { Bell, ChevronRight } from 'lucide-react';

import { OperatorShell } from '@/components/panel/OperatorShell';
import { useT } from '@/i18n';
import { OPERATOR_ROOT } from '@/shared/permissions';

export default function OperatorSettingsPage() {
  const t = useT();

  return (
    <OperatorShell title={t('nav.settings')} backHref={OPERATOR_ROOT}>
      <nav className="mx-auto max-w-2xl space-y-3">
        <Link
          href={`${OPERATOR_ROOT}/settings/notifications`}
          className="flex min-h-16 items-center gap-3 rounded-2xl border border-card-edge bg-white px-4 py-3 shadow-sm transition hover:bg-ink-50"
        >
          <Bell size={22} className="shrink-0 text-ink-400" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-medium text-ink-900">
              {t('notifications.title')}
            </span>
            <span className="mt-0.5 block text-sm text-ink-500">
              {t('notifications.settingsHint')}
            </span>
          </span>
          <ChevronRight size={20} className="shrink-0 text-ink-300" aria-hidden />
        </Link>
      </nav>
    </OperatorShell>
  );
}
