'use client';

/**
 * The footer.
 *
 * WHY IT IS ITS OWN FILE NOW, AND WHY IT NO LONGER HIDES ON A PHONE
 * -----------------------------------------------------------------
 * It used to be four lines inside `AppShell` carrying `hidden … sm:block`. On a
 * screen narrower than 640 pixels it was `display: none` — so on the devices
 * almost every customer of a food-delivery platform actually uses, there was no
 * route to the terms of use or the privacy policy from anywhere in the app.
 *
 * That is not only a usability problem. Those documents are what the customer
 * agreed to, and a platform that publishes them where its users cannot reach
 * them has not really published them.
 *
 * WHAT IT DELIBERATELY DOES NOT CONTAIN
 * -------------------------------------
 * No courier recruitment page: Qapında runs no fleet, and a "become a courier"
 * link would be an offer it cannot honour. No operator or admin link: those
 * panels are staff tools, and a public link to one is an invitation to try the
 * door. Both omissions are decisions, not gaps.
 *
 * Links that lead nowhere are also left out. `FAQ` and the partnership page
 * exist; "About us" and a contact page do not yet, so they are not listed —
 * a footer full of dead links reads worse than a short one.
 */

import Link from 'next/link';

import { useT } from '@/i18n';
import { cn } from '@/components/ui';

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-600">{title}</h2>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      {/*
        `min-h-9` rather than a bare anchor: a footer link on a telephone is
        tapped with a thumb, and a 16-pixel line of text is not a target.
      */}
      <Link
        href={href}
        className="inline-flex min-h-9 items-center text-[14px] text-ink-600 transition hover:text-brand-700"
      >
        {children}
      </Link>
    </li>
  );
}

export function SiteFooter({ className }: { className?: string }) {
  const t = useT();
  const year = new Date().getFullYear();

  return (
    <footer
      className={cn(
        'border-t border-card-edge bg-surface',
        /*
         * Room for the mobile tab bar.
         *
         * The bottom navigation is fixed, so without this the last row of links
         * sits underneath it and cannot be tapped at all — which would have
         * replaced one invisible footer with another.
         */
        'pb-28 pt-9 sm:pb-9',
        className,
      )}
    >
      <div className="mx-auto max-w-5xl px-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">
          <div className="col-span-2 flex flex-col gap-2 sm:col-span-1">
            <span className="text-[15px] font-semibold text-ink-900">{t('brand.name')}</span>
            <p className="max-w-[34ch] text-[13px] leading-relaxed text-ink-500">
              {t('footer.tagline')}
            </p>
          </div>

          <Column title={t('footer.forCustomers')}>
            <Row href="/legal/terms">{t('legal.terms')}</Row>
            <Row href="/legal/privacy">{t('legal.privacy')}</Row>
            <Row href="/legal/cookies">{t('legal.cookies')}</Row>
            <Row href="/account/settings/faq">{t('footer.faq')}</Row>
          </Column>

          <Column title={t('footer.forRestaurants')}>
            <Row href="/partner">{t('footer.partner')}</Row>
            <Row href="/login">{t('footer.panelLogin')}</Row>
          </Column>

          <Column title={t('footer.contact')}>
            <Row href="/account/support">{t('footer.support')}</Row>
            <Row href="/account/settings/feedback">{t('footer.feedback')}</Row>
          </Column>
        </div>

        {/*
          The copyright line. Plain, and not decorated — it is a legal notice,
          not a design element.
        */}
        <div className="mt-8 border-t border-row-edge pt-5 text-[13px] text-ink-500">
          © {year} {t('brand.name')}. {t('footer.rights')}
        </div>
      </div>
    </footer>
  );
}
