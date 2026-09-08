'use client';

/**
 * The shell behind both panels.
 *
 * A working console, not a shop. Dark rail on the left that never moves, a thin
 * bar on top for search and identity, and one scrolling column of content. The
 * navigation stays put while the content changes, so somebody working a shift
 * never has to re-find the thing they were doing.
 *
 * There is nothing from the customer app in here: no cart, no bottom tabs, no
 * partner strip. One mis-tap should never land a kitchen on a checkout screen.
 *
 * THE APPROVAL GATE
 * -----------------
 * A restaurant reaches the panel only once the platform has approved it. Until
 * then it sees a status screen, not a dashboard — a panel full of empty widgets
 * reads as broken, and an unapproved restaurant taking orders would be worse.
 *
 * The gate here decides what to *render*. The real boundary is elsewhere:
 * `createOrder` refuses a restaurant that is not ACTIVE, and the security rules
 * hide it from customers. Someone who forced past this screen finds nothing.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Banknote,
  BarChart3,
  Clock,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  ScrollText,
  Star,
  TriangleAlert,
  MessagesSquare,
  Settings,
  Store,
  Ticket,
  UtensilsCrossed,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import { Alert, Button, Card, Loading, cn } from '@/components/ui';
import { DIALOG_SCRIM, useDialogChrome } from '@/components/ui/overlay';
import { ToastProvider } from '@/components/panel/Toast';
import { NewOrderAlarm } from '@/components/restaurant/NewOrderAlarm';
import { CommandPalette, CommandTrigger } from '@/components/panel/CommandPalette';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { LogoMark } from './Logo';
import { getRestaurant } from '@/services/catalog';
import { RestaurantStatus, UserRole } from '@/shared/enums';
import {
  ADMIN_NAV,
  ADMIN_ROOT,
  NAV_GROUPS,
  OPERATOR_ROOT,
  RESTAURANT_NAV,
  visibleNav,
  type NavItem,
} from '@/shared/permissions';
import { isPlatformRole, isRestaurantRole } from '@/shared/permissions';
import type { Restaurant } from '@/shared/models';

const ICONS: Record<string, typeof Store> = {
  receipt: Receipt,
  utensils: UtensilsCrossed,
  wallet: Wallet,
  users: Users,
  settings: Settings,
  'layout-dashboard': LayoutDashboard,
  store: Store,
  ticket: Ticket,
  'scroll-text': ScrollText,
  chart: BarChart3,
  star: Star,
  alert: TriangleAlert,
  chat: MessagesSquare,
  'credit-card': CreditCard,
  banknote: Banknote,
  'key-round': KeyRound,
};

export function PanelShell({
  kind,
  children,
  title,
  subtitle,
  actions,
}: {
  kind: 'restaurant' | 'admin';
  children: ReactNode;
  /** Kept for the screens that still pass a plain title. */
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const { role, loading, identityLoading, firebaseUser, profile, restaurantId, signOut } = useAuth();

  /**
   * THIS GATE WAITS FOR THE ROLE, NOT MERELY FOR THE SIGN-IN.
   *
   * `loading` goes false the instant Firebase says somebody is signed in, which
   * is roughly a round trip before it says *who*. In that gap `role` is still
   * its CUSTOMER default — and every line below decides who belongs here by
   * reading `role`. Guarding on `loading` alone therefore threw the restaurant
   * owner off their own panel on every cold load: the redirect to /account
   * fired while the answer was still in flight, and by the time the real role
   * arrived the navigation had already happened.
   *
   * `identityLoading` is the answer to the question this screen is actually
   * asking. `CourierShell` waits on it for the same reason, and its comment
   * records the same bug being reported by a courier.
   */
  const identityKnown = !loading && !identityLoading;

  /**
   * An operator holds platform permissions but does not live here.
   *
   * `OPERATOR` passes `isPlatformRole`, so without this it would land in the
   * admin panel and find most of the sidebar missing — a panel that is mostly
   * absences reads as broken. It has a screen of its own instead, and this
   * sends it there. Nothing about the redirect is a security measure: the
   * security rules and every callable already refuse an operator the admin
   * actions, and this only decides which door it walks through.
   */
  const belongsOnOperatorScreen = kind === 'admin' && role === UserRole.OPERATOR;

  const allowed =
    (kind === 'admin' ? isPlatformRole(role) : isRestaurantRole(role)) &&
    !belongsOnOperatorScreen;

  const [restaurant, setRestaurant] = useState<Restaurant | null | undefined>(
    kind === 'restaurant' ? undefined : null,
  );
  const [collapsed, setCollapsed] = useState(false);
  // The drawer remembers *where* it was opened, not merely that it is open.
  // Navigating changes the pathname, which closes it by derivation — no effect
  // reaching in to reset state after the render that already happened.
  const [mobileNavAt, setMobileNavAt] = useState<string | null>(null);
  const mobileNav = mobileNavAt === pathname;
  const [palette, setPalette] = useState(false);

  // The drawer is a dialog like any other now: Escape closes it, Tab cannot
  // walk out of it into the page behind, and the page behind does not scroll.
  // `useCallback`, because the hook holds on to the closer for as long as the
  // drawer is open and a fresh function on every render would tear the
  // listener down and rebuild it each time.
  const closeMobileNav = useCallback(() => setMobileNavAt(null), []);
  const mobileNavSurface = useDialogChrome<HTMLDivElement>(mobileNav, closeMobileNav);

  useEffect(() => {
    if (kind !== 'restaurant' || !restaurantId) return;
    let cancelled = false;
    getRestaurant(restaurantId).then((found) => {
      if (!cancelled) setRestaurant(found);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, restaurantId]);

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    // Signed in — but who they are decides the next two lines, so wait for it.
    if (identityLoading) return;
    if (belongsOnOperatorScreen) router.replace(OPERATOR_ROOT);
    else if (!allowed) router.replace('/account');
  }, [loading, identityLoading, firebaseUser, allowed, belongsOnOperatorScreen, router, pathname]);

  // ⌘K / Ctrl+K anywhere in the panel. Escape is no longer handled here: the
  // drawer's own dialog chrome closes it, and the palette's does the same, so
  // a single Escape now closes exactly the thing in front rather than both.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!identityKnown || !firebaseUser || !allowed) return <Loading />;

  /*
   * The kitchen alarm, mounted for every restaurant screen rather than for the
   * order board alone: an owner editing the menu is exactly the person who
   * needs to be told an order is waiting.
   *
   * It is built here, ABOVE the loading gate, and rendered in every branch
   * below. Each panel screen mounts its own `PanelShell`, which re-reads the
   * restaurant on arrival — so an alarm rendered only after that read finished
   * was an alarm that unmounted, fell silent and restarted on every single
   * navigation. Mounting it as soon as the account is known closes that gap: it
   * needs `restaurantId`, which the session already has, and nothing else.
   */
  const alarm = kind === 'restaurant' ? <NewOrderAlarm /> : null;

  if (kind === 'restaurant') {
    if (restaurant === undefined) {
      return (
        <>
          {alarm}
          <Loading />
        </>
      );
    }

    if (restaurant && restaurant.status !== RestaurantStatus.ACTIVE) {
      return <PendingScreen restaurant={restaurant} onSignOut={() => void signOut()} />;
    }
  }

  const items: NavItem[] = visibleNav(kind === 'admin' ? ADMIN_NAV : RESTAURANT_NAV, role);

  const root = kind === 'admin' ? ADMIN_ROOT : '/panel';
  const workspace = kind === 'admin' ? t('panel.adminTag') : (restaurant?.name ?? t('panel.restaurantTag'));

  const nav = (
    <Sidebar
      items={items}
      root={root}
      pathname={pathname}
      collapsed={collapsed}
      workspace={workspace}
      kind={kind}
    />
  );

  return (
    <ToastProvider>
      {alarm}

      <div className="panel-canvas flex min-h-full bg-canvas">
        {/* --- The rail ------------------------------------------------- */}
        <aside
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-black/40 bg-ink-900 transition-[width] duration-200 lg:flex',
            collapsed ? 'w-[76px]' : 'w-[258px]',
          )}
        >
          {nav}

          <button
            onClick={() => setCollapsed((value) => !value)}
            className="mt-auto flex items-center gap-3 border-t border-white/10 px-5 py-3 text-sm text-white/50 transition hover:text-white"
            aria-label={collapsed ? t('panel.expand') : t('panel.collapse')}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && <span>{t('panel.collapse')}</span>}
          </button>
        </aside>

        {/* --- Mobile drawer -------------------------------------------- */}
        {mobileNav && (
          <div className="fixed inset-0 z-50 flex p-2 lg:hidden">
            <button
              aria-label={t('common.close')}
              tabIndex={-1}
              onClick={closeMobileNav}
              className={DIALOG_SCRIM}
            />
            {/* Inset and lifted like every other overlay in the app, so the
                rail reads as sitting on top of the screen rather than as the
                screen having slid sideways. */}
            <div
              ref={mobileNavSurface}
              role="dialog"
              aria-modal="true"
              aria-label={t('nav.primary')}
              tabIndex={-1}
              className="relative flex h-full w-[258px] flex-col overflow-hidden rounded-dialog bg-ink-900 shadow-dialog"
            >
              <button
                onClick={closeMobileNav}
                aria-label={t('common.close')}
                className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-lg text-white/60 hover:bg-white/10"
              >
                <X size={18} />
              </button>
              {nav}
            </div>
          </div>
        )}

        {/* --- The column ----------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-card-edge bg-surface/90 px-4 backdrop-blur">
            <button
              onClick={() => setMobileNavAt(pathname)}
              className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 lg:hidden"
              aria-label={t('common.menu')}
            >
              <MenuIcon size={18} />
            </button>

            <CommandTrigger onClick={() => setPalette(true)} />

            <div className="ml-auto flex items-center gap-2">
              {actions}

              <NotificationBell />

              <Link
                href="/"
                className="hidden rounded-lg px-2.5 py-1.5 text-xs text-ink-500 transition hover:bg-ink-100 hover:text-ink-900 sm:block"
              >
                {t('panel.toSite')}
              </Link>

              <div className="hidden items-center gap-2 border-l border-ink-200 pl-3 sm:flex">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white">
                  {(profile?.fullName ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-36 truncate text-xs">
                  <span className="block truncate font-medium text-ink-900">
                    {profile?.fullName}
                  </span>
                  <span className="block truncate text-ink-400">{t(`roles.${role}`)}</span>
                </span>
              </div>

              <button
                onClick={() => void signOut()}
                aria-label={t('auth.signOut')}
                className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 hover:text-danger"
              >
                <LogOut size={17} />
              </button>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
            {title && (
              <div className="mb-5">
                <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
                {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
              </div>
            )}
            {children}
          </main>
        </div>
      </div>

      {palette && (
        <CommandPalette onClose={() => setPalette(false)} items={items} kind={kind} />
      )}
    </ToastProvider>
  );
}

function Sidebar({
  items,
  root,
  pathname,
  collapsed,
  workspace,
  kind,
}: {
  items: NavItem[];
  root: string;
  pathname: string;
  collapsed: boolean;
  workspace: string;
  kind: 'admin' | 'restaurant';
}) {
  const t = useT();

  return (
    <>
      <div
        className={cn(
          'flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10',
          collapsed ? 'justify-center px-0' : 'px-5',
        )}
      >
        <LogoMark size={22} className="shrink-0 text-brand-500" />
        {!collapsed && (
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">{workspace}</span>
            <span className="block text-[11px] uppercase tracking-wider text-white/40">
              {kind === 'admin' ? t('panel.adminTag') : t('panel.restaurantTag')}
            </span>
          </span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (groupItems.length === 0) return null;

          return (
            <div key={group} className="mb-1">
              {!collapsed && (
                <p className="px-5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-white/30">
                  {t(`navGroup.${group}`)}
                </p>
              )}

              {groupItems.map((item) => {
                const Icon = ICONS[item.icon] ?? Store;
                const active =
                  item.href === root ? pathname === root : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? t(item.labelKey) : undefined}
                    className={cn(
                      'relative mx-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition',
                      collapsed && 'justify-center px-0',
                      active
                        ? 'bg-white/10 font-medium text-white'
                        : 'text-white/55 hover:bg-white/5 hover:text-white',
                    )}
                  >
                    {/* The accent marks *where you are*, and nothing else. */}
                    {active && (
                      <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-500" />
                    )}
                    <Icon size={18} className="shrink-0" />
                    {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
    </>
  );
}

/**
 * What a restaurant sees before approval — and after suspension.
 *
 * It says which of the two it is, because "waiting" and "stopped" call for
 * completely different actions from the owner.
 */
function PendingScreen({
  restaurant,
  onSignOut,
}: {
  restaurant: Restaurant;
  onSignOut: () => void;
}) {
  const t = useT();
  const rejected = restaurant.status === RestaurantStatus.REJECTED;
  const suspended = restaurant.status === RestaurantStatus.SUSPENDED;

  return (
    <div className="panel-canvas flex min-h-full items-center justify-center bg-canvas px-4 py-10">
      <Card className="w-full max-w-md p-6 text-center">
        <span
          className={cn(
            'mx-auto flex h-14 w-14 items-center justify-center rounded-2xl',
            rejected || suspended ? 'bg-red-50 text-danger' : 'bg-amber-50 text-warning',
          )}
        >
          {rejected || suspended ? <XCircle size={26} /> : <Clock size={26} />}
        </span>

        <h1 className="mt-4 text-lg font-semibold text-ink-900">{restaurant.name}</h1>

        <p className="mt-2 text-ink-600">
          {rejected
            ? t('panel.rejectedBody')
            : suspended
              ? t('panel.suspendedBody')
              : t('panel.pendingBody')}
        </p>

        {!rejected && !suspended && (
          <div className="mt-4">
            <Alert tone="info">{t('panel.pendingHint')}</Alert>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <Link href="/">
            <Button variant="secondary" fullWidth>
              {t('panel.toSite')}
            </Button>
          </Link>
          <button onClick={onSignOut} className="py-2 text-sm text-ink-500 underline">
            {t('auth.signOut')}
          </button>
        </div>
      </Card>
    </div>
  );
}
