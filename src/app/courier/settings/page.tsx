'use client';

/**
 * Ayarlar — one entry today, and the place any future one goes.
 *
 * It exists as its own screen rather than as a link straight to the
 * notification settings because the rule it enforces is structural: settings
 * are somewhere a driver goes on purpose, never something they can trip over
 * while working an order.
 */

import Link from 'next/link';
import { Bell, ChevronRight } from 'lucide-react';

import { CourierShell } from '@/components/courier/CourierShell';
import { useT } from '@/i18n';

export default function CourierSettingsPage() {
  const t = useT();

  return (
    <CourierShell title={t('nav.settings')} backHref="/courier">
      <nav className="space-y-3">
        <Link
          href="/courier/settings/notifications"
          className="flex min-h-16 items-center gap-3 rounded-2xl border border-card-edge bg-white px-4 py-3 shadow-sm transition hover:bg-ink-50"
        >
          <Bell size={22} className="shrink-0 text-ink-400" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-medium text-ink-900">
              {t('notifications.title')}
            </span>
            <span className="mt-0.5 block text-sm text-ink-500">{t('kuryer.settingsHint')}</span>
          </span>
          <ChevronRight size={20} className="shrink-0 text-ink-300" aria-hidden />
        </Link>
      </nav>
    </CourierShell>
  );
}
