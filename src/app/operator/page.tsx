'use client';

/**
 * The operator's screen.
 *
 * An operator is not a junior admin. The admin panel belongs to the person who
 * owns the platform — commission, roles, payouts, settings — and putting an
 * operator inside it means showing them a dozen doors they may not open and
 * hoping they do not try. So the operator has a screen of its own, the way the
 * courier does: its own address, its own header, and only the four things the
 * job is actually made of.
 *
 * Four tabs, in the order the work arrives:
 *   1. the orders moving right now,
 *   2. the restaurants behind them,
 *   3. the support threads those restaurants opened,
 *   4. the complaints waiting on a decision.
 *
 * WHAT IS DELIBERATELY ABSENT — AND WHAT NO LONGER IS
 * ---------------------------------------------------
 * There is still no way to *ring* a customer from here: no customer name on
 * the order list, no number in the drawer, no dial button. What has changed is
 * the support tab. Customers now have a written line to an operator — the
 * owner asked for it in as many words — so an operator answers a customer's
 * ticket in the ticket, where the whole exchange is on the record, rather than
 * on a phone call nobody can look up afterwards.
 *
 * The strip of figures above the tabs is not decoration either. This screen
 * used to be tabs on flat white with nothing to anchor them, which is exactly
 * what the owner complained about; the counts give the operator the one thing
 * a queue screen owes them, which is how much is waiting.
 *
 * WHY THE ROLE CHECK HERE IS NOT THE SECURITY
 * -------------------------------------------
 * It is a redirect, nothing more. Every tab below reads through the security
 * rules, which grant `OPERATOR` exactly what `shared/permissions.ts` says it
 * has, and every action goes through a callable that re-checks the caller's
 * role server-side. Someone who forced their way onto this URL would be looking
 * at four empty panels.
 *
 * A SUPER_ADMIN may open this screen — it is the only way to see what an
 * operator sees — and keeps the full admin panel. An operator who goes to the
 * admin root is sent back here by `PanelShell`.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut, MessagesSquare, Receipt, Settings, Store, TriangleAlert } from 'lucide-react';

import { LogoMark } from '@/components/layout/Logo';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ComplaintsQueue } from '@/components/panel/ComplaintsQueue';
import { SupportInbox } from '@/components/panel/SupportInbox';
import { ToastProvider } from '@/components/panel/Toast';
import { cn } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import { OPERATOR_ROOT } from '@/shared/permissions';
import { UserRole } from '@/shared/enums';
import { LiveOrders } from './LiveOrders';
import { Overview } from './Overview';
import { Roster } from './Roster';

type Tab = 'orders' | 'restaurants' | 'support' | 'complaints';

const TABS: Array<{ value: Tab; labelKey: string; icon: typeof Receipt }> = [
  { value: 'orders', labelKey: 'operator.tabOrders', icon: Receipt },
  { value: 'restaurants', labelKey: 'operator.tabRestaurants', icon: Store },
  { value: 'support', labelKey: 'operator.tabSupport', icon: MessagesSquare },
  { value: 'complaints', labelKey: 'operator.tabComplaints', icon: TriangleAlert },
];

export default function OperatorPage() {
  const t = useT();
  const router = useRouter();
  const { firebaseUser, profile, role, loading, identityLoading, signOut } = useAuth();

  const allowed = role === UserRole.OPERATOR || role === UserRole.SUPER_ADMIN;

  const [tab, setTab] = useState<Tab>('orders');

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace(`/login?next=${encodeURIComponent(OPERATOR_ROOT)}`);
      return;
    }
    /*
     * `allowed` is read off the role, and the role is not known yet while
     * `identityLoading` is true — it is CUSTOMER by default, which fails the
     * test and bounces the operator to the shopfront on every cold load. The
     * courier screen and the panel shell wait on the same flag, for the same
     * reason, and both comments record the same bug being reported.
     */
    if (identityLoading) return;
    if (!allowed) router.replace('/');
  }, [loading, identityLoading, firebaseUser, allowed, router]);

  if (loading || identityLoading || !firebaseUser || !allowed) return <PageLoading />;

  return (
    <ToastProvider>
      <div className="min-h-full bg-canvas">
        <header className="sticky top-0 z-30 border-b border-ink-200 bg-white">
          <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
            <LogoMark size={22} className="shrink-0 text-brand-600" />

            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-ink-900">
                {t('operator.title')}
              </h1>
              <p className="truncate text-xs text-ink-400">
                {profile?.fullName} · {t(`roles.${role}`)}
              </p>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1">
              <NotificationBell />

              {/* The only way into Ayarlar from here, and deliberately the only
                  thing about settings that appears on this screen at all: the
                  queue stays a queue. */}
              <Link
                href={`${OPERATOR_ROOT}/settings`}
                aria-label={t('nav.settings')}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
              >
                <Settings size={19} aria-hidden />
              </Link>
            </div>

            <button
              onClick={() => void signOut()}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-ink-500 transition hover:bg-ink-100 hover:text-danger"
            >
              <LogOut size={16} aria-hidden />
              <span className="hidden sm:inline">{t('auth.signOut')}</span>
            </button>
          </div>

          {/*
            The tabs live in the header rather than in the page body, because
            this screen has no sidebar to come back to: they are the whole
            navigation an operator has, and they must not scroll away.
          */}
          <nav
            aria-label={t('nav.primary')}
            className="no-scrollbar mx-auto flex w-full max-w-[1400px] gap-1 overflow-x-auto px-2 sm:px-4"
          >
            {TABS.map((entry) => {
              const Icon = entry.icon;
              const active = entry.value === tab;

              return (
                <button
                  key={entry.value}
                  onClick={() => setTab(entry.value)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm transition',
                    active
                      ? 'font-medium text-ink-900 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-600'
                      : 'text-ink-500 hover:text-ink-800',
                  )}
                >
                  <Icon size={16} aria-hidden />
                  {t(entry.labelKey)}
                </button>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
          <Overview />

          {tab === 'orders' && <LiveOrders />}
          {tab === 'restaurants' && <Roster />}
          {tab === 'support' && <SupportInbox subtitle={t('operator.supportSubtitle')} />}
          {tab === 'complaints' && (
            <ComplaintsQueue subtitle={t('operator.complaintsSubtitle')} />
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
