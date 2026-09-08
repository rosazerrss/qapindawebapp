'use client';

/**
 * The courier's dashboard.
 *
 * The first thing a driver sees when they open the app, and it answers one
 * question: is there anything to do right now. Everything else on it is a door
 * to one of the five other screens, drawn as full-width targets because this is
 * used one-handed, outdoors, in a hurry.
 *
 * NOTIFICATION SETTINGS ARE NOT HERE, AND NEVER WILL BE
 * ----------------------------------------------------
 * The dashboard may say how many unread notifications there are and offer a way
 * to read them. Every switch that governs them — sound, push, what is delivered
 * at all — lives at Ayarlar → Bildirişlər, which is one place rather than two.
 * A setting that can be changed from a screen somebody is working is a setting
 * that gets changed by accident, and the accident here is a driver silencing
 * the phone that tells them a delivery was cancelled.
 */

import Link from 'next/link';
import { Bell, ChevronRight, History, ClipboardList, Settings, User } from 'lucide-react';

import { Alert, Button, Card } from '@/components/ui';
import { CourierShell, useCourierNotifications } from '@/components/courier/CourierShell';
import { useCourierActiveOrders } from '@/components/courier/useCourierData';
import { useT } from '@/i18n';

export default function CourierDashboardPage() {
  const t = useT();

  return (
    <CourierShell title={t('kuryer.title')}>
      <Dashboard />
    </CourierShell>
  );
}

/**
 * Inside the shell, because the notification count comes from the shell's own
 * subscription — one listener per screen, so a delivery rings once.
 */
function Dashboard() {
  const t = useT();
  const { orders, failed, retry } = useCourierActiveOrders();
  const { unreadCount } = useCourierNotifications();

  return (
    <>
      {failed ? (
        <Alert tone="danger">
          <span className="block text-lg font-semibold">{t('kuryer.loadFailed')}</span>
          <span className="mt-1 block text-base">{t('kuryer.loadFailedHint')}</span>
          <Button
            size="lg"
            variant="secondary"
            className="mt-3"
            onClick={retry}
          >
            {t('common.retry')}
          </Button>
        </Alert>
      ) : (
        <Card className="p-5">
          <p className="text-base text-ink-500">{t('kuryer.dashboardActive')}</p>
          {/* A dash rather than a nought while the first snapshot is still on
              its way: "0 deliveries" is an answer, and it must not be given
              before it is known. */}
          <p className="mt-1 text-5xl font-bold tabular-nums text-ink-900">
            {orders === null ? '—' : orders.length}
          </p>
          <p className="mt-2 text-base text-ink-500">{t('kuryer.dashboardHint')}</p>

          <Link
            href="/courier/orders"
            className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-lg font-semibold text-white transition hover:bg-brand-700"
          >
            {t('kuryer.activeTitle')}
            <ChevronRight size={20} aria-hidden />
          </Link>
        </Card>
      )}

      <nav className="mt-4 space-y-3">
        <Tile href="/courier/orders" icon={ClipboardList} label={t('kuryer.activeTitle')} />
        <Tile href="/courier/history" icon={History} label={t('kuryer.historyTitle')} />
        <Tile
          href="/courier/notifications"
          icon={Bell}
          label={t('notifications.title')}
          badge={unreadCount > 0 ? String(unreadCount > 99 ? '99+' : unreadCount) : null}
        />
        <Tile href="/courier/account" icon={User} label={t('account.title')} />
        <Tile href="/courier/settings" icon={Settings} label={t('nav.settings')} />
      </nav>
    </>
  );
}

/** One door. Full width, 64px tall, one label and at most one number. */
function Tile({
  href,
  icon: Icon,
  label,
  badge,
}: {
  href: string;
  icon: typeof Bell;
  label: string;
  badge?: string | null;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center gap-3 rounded-2xl border border-card-edge bg-white px-4 py-3 text-lg font-medium text-ink-900 shadow-sm transition hover:bg-ink-50"
    >
      <Icon size={22} className="shrink-0 text-ink-400" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && (
        <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-brand-600 px-2 text-sm font-semibold text-white">
          {badge}
        </span>
      )}
      <ChevronRight size={20} className="shrink-0 text-ink-300" aria-hidden />
    </Link>
  );
}
