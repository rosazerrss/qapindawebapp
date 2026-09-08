'use client';

/**
 * The courier app's frame.
 *
 * WHAT THIS APP IS
 * ----------------
 * The whole job is: see the order, collect it, deliver it, close it. So there
 * are six places to be and no seventh — a dashboard, the active deliveries, the
 * past ones, the notifications, the account, and the settings — and this file
 * is the only thing that knows about all of them. The person using it is
 * standing at a door, in whatever weather, usually behind schedule, holding a
 * phone in one hand: five bottom tabs a thumb can hit, a header that fits on a
 * small screen, and nothing that has to be scrolled to be found.
 *
 * THERE IS NO CHAT HERE, AND THERE IS NOTHING TO REMOVE
 * ----------------------------------------------------
 * A courier has no support lane in either direction — `supportAccess` in
 * `shared/supportState.ts` returns all-false for the role before any other
 * clause runs, the `supportTickets` rule has no clause a courier can match, and
 * `SUPPORT_MESSAGE` does not list COURIER in its audience. A driver with a
 * problem goes through the restaurant they ride for, which is the shop that
 * employs them and the only party that can do anything about it. Nothing in
 * this app links to a conversation, and nothing should be added that does.
 *
 * THE BELL IS A LINK, NOT A PANEL
 * -------------------------------
 * Deliberately not `NotificationBell`: that sheet carries a "settings" button,
 * and notification settings belong at Ayarlar → Bildirişlər and nowhere else.
 * What the header shows is the count and a way to the list.
 *
 * THE GUARD WAITS FOR `identityLoading`, NOT `loading`
 * ---------------------------------------------------
 * `loading` goes false the moment Firebase says somebody is signed in, which is
 * a round trip before the profile document and the decoded token arrive. In
 * that gap `role` is still its CUSTOMER default, so a guard on the role alone
 * throws the courier off their own app on every cold load.
 */

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Bell, ClipboardList, History, LayoutDashboard, Settings, User } from 'lucide-react';

import { cn } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import {
  useNotifications,
  type NotificationsState,
} from '@/components/notifications/useNotifications';
import { UserRole } from '@/shared/enums';

/**
 * The app's single notification subscription, handed down.
 *
 * The header needs the unread count, the dashboard shows it too, and the
 * Bildirişlər screen needs the whole list — but `useNotifications` holds the
 * session's memory of which notifications have already been announced, so a
 * second instance on the same screen would ring twice and raise two push
 * banners for one delivery. The shell mounts it once and everything below
 * reads that.
 */
const CourierNotificationsContext = createContext<NotificationsState | null>(null);

export function useCourierNotifications(): NotificationsState {
  const value = useContext(CourierNotificationsContext);
  if (!value) throw new Error('useCourierNotifications must be used inside CourierShell');
  return value;
}

/** The five destinations a thumb reaches without opening anything. */
const TABS = [
  { href: '/courier', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { href: '/courier/orders', icon: ClipboardList, labelKey: 'kuryer.activeTitle' },
  { href: '/courier/history', icon: History, labelKey: 'kuryer.historyTitle' },
  { href: '/courier/notifications', icon: Bell, labelKey: 'notifications.title' },
  { href: '/courier/account', icon: User, labelKey: 'account.title' },
] as const;

export function CourierShell({
  title,
  /**
   * Where the ← Geri control goes. Given on every screen somebody walks *into*
   * — an order, a settings page — and omitted on the five tabs, which already
   * have a way out along the bottom of the screen.
   */
  backHref,
  children,
}: {
  title: string;
  backHref?: string;
  children: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { firebaseUser, role, loading, identityLoading } = useAuth();
  const notifications = useNotifications();
  const unreadCount = notifications.unreadCount;

  const isCourier = role === UserRole.RESTAURANT_COURIER;

  useEffect(() => {
    if (loading || identityLoading) return;
    if (!firebaseUser) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!isCourier) router.replace('/');
  }, [loading, identityLoading, firebaseUser, isCourier, pathname, router]);

  const ready = !loading && !identityLoading && Boolean(firebaseUser) && isCourier;

  return (
    <div className="panel-canvas flex min-h-full flex-col bg-canvas">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-card-edge bg-surface px-3 py-3">
        {backHref && (
          <Link
            href={backHref}
            aria-label={t('common.back')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-100 active:bg-ink-200"
          >
            <ArrowLeft size={20} aria-hidden />
          </Link>
        )}

        <h1 className="min-w-0 flex-1 truncate px-1 text-xl font-semibold text-ink-900">{title}</h1>

        {/* The count, and a way to the list. Every switch that governs it lives
            at Ayarlar → Bildirişlər — never on a screen a driver is working. */}
        <Link
          href="/courier/notifications"
          aria-label={
            unreadCount > 0
              ? `${t('notifications.title')} — ${t('notifications.unreadCount', { count: unreadCount })}`
              : t('notifications.title')
          }
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-100"
        >
          <Bell size={20} aria-hidden />
          {unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        <Link
          href="/courier/settings"
          aria-label={t('nav.settings')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-100"
        >
          <Settings size={20} aria-hidden />
        </Link>
      </header>

      {/* The padding at the bottom is the height of the tab bar. Without it the
          last button on a long screen sits underneath it, which on a delivery
          screen is the "confirm" button. */}
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-28 pt-4">
        <CourierNotificationsContext.Provider value={notifications}>
          {ready ? children : <PageLoading />}
        </CourierNotificationsContext.Provider>
      </main>

      <nav
        aria-label={t('nav.primary')}
        className="fixed inset-x-0 bottom-0 z-10 border-t border-card-edge bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex max-w-lg">
          {TABS.map((tab) => {
            // `/courier` is a prefix of every other route, so only the exact
            // path may light it up; the rest own their whole subtree.
            const active =
              tab.href === '/courier' ? pathname === '/courier' : pathname.startsWith(tab.href);

            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition',
                    active ? 'text-brand-600' : 'text-ink-400 hover:text-ink-700',
                  )}
                >
                  <tab.icon size={22} aria-hidden />
                  <span className="w-full truncate text-center">{t(tab.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
