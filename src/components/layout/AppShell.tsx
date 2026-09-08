'use client';

/**
 * The customer shell: a header, the page, and a bottom bar on phones.
 *
 * The bottom bar is where the brief's "Hesabım" rule lives — it is always
 * visible, and what it shows depends on whether anyone is signed in. A guest
 * never hits a wall until checkout.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Home, Search, ReceiptText, User, ShoppingBag } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { isWorkAccount } from '@/shared/permissions';
import { useT } from '@/i18n';
import { cn } from '@/components/ui';
import { reportPathname } from '@/lib/navigationHistory';
import { Logo } from './Logo';
import { PartnerBar } from './PartnerBar';
import { SiteFooter } from './SiteFooter';

export function AppShell({
  children,
  /** Skips the padded container, for pages that paint their own full-width band. */
  bare = false,
}: {
  children: React.ReactNode;
  bare?: boolean;
}) {
  const pathname = usePathname();
  const t = useT();
  const { itemCount, hydrated } = useCart();
  /*
   * A work account has no cart, so it is given no way to one.
   *
   * Derived from the role during render — the same role the server reads from
   * the user document before it refuses `createOrder`. Until the identity is
   * known everybody looks like a customer, and showing the cart for that
   * moment is harmless; hiding it and putting it back would not be.
   */
  const { role, identityLoading } = useAuth();
  const showCart = identityLoading || !isWorkAccount(role);

  /*
   * THE FOOTER BELONGS ON THE PAGES A VISITOR BROWSES, AND NOWHERE ELSE.
   *
   * It exists so that the terms, the privacy policy and the cookie notice are
   * reachable from the public app — that is a real obligation, and it is met by
   * being on the pages a person who has not signed in actually sees.
   *
   * Inside the account it is noise, and on a phone it is worse than noise: four
   * columns of links unrolled under a list of saved addresses look like the page
   * broke. The same on the basket, on the order list and under search results,
   * where the screen has one job and the footer is competing with it.
   *
   * So it is an allow-list, not a block-list. A page added next year gets no
   * footer until somebody decides it should have one, which is the safe default
   * — the failure mode of forgetting to add a page here is a missing link, and
   * the failure mode of forgetting to exclude one is a broken-looking screen.
   */
  const showFooter =
    pathname === '/' ||
    pathname.startsWith('/restaurant/') ||
    pathname.startsWith('/legal') ||
    pathname === '/partner';

  // Feeds `ScreenHeader`'s back button: every distinct pathname AppShell
  // renders after the first is a real in-app navigation, worth going back to.
  useEffect(() => {
    reportPathname(pathname);
  }, [pathname]);

  const tabs = [
    { href: '/', icon: Home, label: t('nav.home') },
    { href: '/search', icon: Search, label: t('nav.search') },
    ...(showCart
      ? [{ href: '/cart', icon: ShoppingBag, label: t('nav.cart'), badge: itemCount }]
      : []),
    { href: '/orders', icon: ReceiptText, label: t('nav.myOrders') },
    { href: '/account', icon: User, label: t('nav.account') },
  ];

  return (
    <div className="flex min-h-full flex-col">
      {/* The partner band belongs on the shopfront and nowhere else.
          A customer deep in a menu or at the checkout is not the audience for
          "open a restaurant", and a strip that follows them there is noise. */}
      {pathname === '/' && <PartnerBar />}

      {/* Keyboard users land on the bottom bar's five tabs before the page
          content otherwise; this jumps straight past the chrome. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink-900 focus:shadow-card"
      >
        {t('common.skipToContent')}
      </a>

      <header className="sticky top-0 z-30 border-b border-card-edge bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <Link href="/" aria-label={t('brand.name')}>
            <Logo />
          </Link>

          {/* NO BELL, NO BADGE, NO PANEL.
              The owner has asked twice for the notification system to be off
              the customer's screens, and this header is where it lived. It is
              gone rather than hidden behind a flag: a customer's notifications
              are read in one place, Hesabım → Ayarlar → Bildirişlər, and the
              header of the shopfront is not a second one. The bell still
              belongs in the working panels, where somebody on a shift has to
              be told an order arrived — `PanelShell` and the operator header
              keep it. */}
          <div className="flex items-center gap-1">
            {showCart && (
              <Link
                href="/cart"
                className="relative rounded-xl p-2 text-ink-600 transition hover:bg-ink-100"
                aria-label={
                  hydrated && itemCount > 0
                    ? `${t('nav.cart')} — ${t('cart.itemCount', { count: itemCount })}`
                    : t('nav.cart')
                }
              >
                <ShoppingBag size={20} aria-hidden />
                {hydrated && itemCount > 0 && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white"
                  >
                    {itemCount}
                  </span>
                )}
              </Link>
            )}
            <Link
              href="/account"
              className="rounded-xl p-2 text-ink-600 transition hover:bg-ink-100"
              aria-label={t('nav.account')}
            >
              <User size={20} aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      {/* The bottom padding keeps the last row clear of the phone tab bar. */}
      <main
        id="main"
        className={cn('flex-1 pb-28 sm:pb-14', !bare && 'mx-auto w-full max-w-5xl px-4 pt-6')}
      >
        {children}
      </main>

      <nav
        aria-label={t('nav.primary')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-card-edge bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <div className="mx-auto flex max-w-5xl">
          {tabs.map((tab) => {
            const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
            const Icon = tab.icon;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px]',
                  active ? 'text-brand-600' : 'text-ink-400',
                )}
              >
                {/* The active tab is marked by a bar as well as by colour, so
                    the current page is legible without seeing red. */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-x-6 top-0 h-0.5 rounded-full',
                    active ? 'bg-brand-600' : 'bg-transparent',
                  )}
                />
                <Icon size={21} strokeWidth={active ? 2.3 : 1.8} aria-hidden />
                {tab.label}
                {hydrated && tab.badge ? (
                  <span
                    aria-hidden
                    className="absolute right-[22%] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white"
                  >
                    {tab.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>

      {showFooter && <SiteFooter />}
    </div>
  );
}
