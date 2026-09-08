'use client';

/**
 * Hesabım → Ayarlar.
 *
 * It exists as a screen of its own rather than as a link straight to the
 * notification switches because the rule it enforces is structural, and the
 * owner stated it twice: settings are somewhere a person goes on purpose, never
 * something they trip over while they are checking where their food is. That is
 * also why Hesabım no longer carries its own shortcut to Bildirişlər — one door
 * to find beats four half-doors to mis-tap.
 *
 * Three entries now, and they are the three things a customer wants from a
 * settings screen: what the app is allowed to tell them, an answer to a
 * question, and what came of asking somebody.
 *
 * The courier's `/courier/settings` is the same screen for the same reason, and
 * this one is deliberately built to match it.
 */

import Link from 'next/link';
import { Bell, ChevronRight, HelpCircle, MessageSquareText } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { useT } from '@/i18n';

const ENTRIES = [
  {
    href: '/account/settings/notifications',
    icon: Bell,
    titleKey: 'notifications.title',
    hintKey: 'notifications.settingsHint',
  },
  {
    href: '/account/settings/faq',
    icon: HelpCircle,
    titleKey: 'faq.title',
    hintKey: 'faq.subtitle',
  },
  {
    href: '/account/settings/feedback',
    icon: MessageSquareText,
    titleKey: 'feedback.title',
    hintKey: 'feedback.subtitle',
  },
] as const;

export default function CustomerSettingsPage() {
  const t = useT();

  return (
    <AppShell>
      <ScreenHeader title={t('nav.settings')} fallbackHref="/account" />

      <nav className="space-y-3">
        {ENTRIES.map((entry) => {
          const Icon = entry.icon;
          return (
            <Link
              key={entry.href}
              href={entry.href}
              className="flex min-h-16 items-center gap-3 rounded-2xl border border-card-edge bg-white px-4 py-3 shadow-sm transition hover:bg-ink-50"
            >
              <Icon size={22} className="shrink-0 text-ink-400" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-medium text-ink-900">{t(entry.titleKey)}</span>
                <span className="mt-0.5 block text-sm text-ink-500">{t(entry.hintKey)}</span>
              </span>
              <ChevronRight size={20} className="shrink-0 text-ink-300" aria-hidden />
            </Link>
          );
        })}
      </nav>
    </AppShell>
  );
}
