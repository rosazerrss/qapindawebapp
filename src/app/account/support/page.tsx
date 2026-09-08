'use client';

/**
 * "Kömək" — the customer's support screen.
 *
 * WHAT CHANGED HERE
 * -----------------
 * This screen used to be answered questions and nothing else, because the
 * platform did not talk to customers at all: a problem went to the complaint
 * form and to the restaurant's own number. The owner has reversed that — *"həm
 * müştəri dəstəyi, həm də restoran dəstəyi aktiv olmalıdır"* — so a customer
 * can now raise a ticket with an operator, and the fastest way in is from the
 * order itself, which arrives here carrying its own id.
 *
 * The questions stayed. Most of what a customer wants at this moment is a fact
 * they can read in five seconds — who delivers, how payment works, how long
 * they have to leave a review — and making them wait for an operator to type
 * it back would be worse service, not better. Tickets sit above, the answers
 * below, and a person who finds their answer never opens a ticket at all.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { PartySupport } from '@/components/support/PartySupport';
import { ToastProvider } from '@/components/panel/Toast';
import { Card } from '@/components/ui';
import { useT } from '@/i18n';

interface FaqLink {
  href: string;
  labelKey: string;
}

interface FaqItem {
  questionKey: string;
  answerKey: string;
  link?: FaqLink;
}

interface FaqSection {
  titleKey: string;
  items: FaqItem[];
}

const SECTIONS: FaqSection[] = [
  {
    titleKey: 'helpCentre.sectionOrdering',
    items: [
      { questionKey: 'helpCentre.orderingActiveQ', answerKey: 'helpCentre.orderingActiveA' },
      { questionKey: 'helpCentre.orderingCancelQ', answerKey: 'helpCentre.orderingCancelA' },
      { questionKey: 'helpCentre.orderingChangeQ', answerKey: 'helpCentre.orderingChangeA' },
    ],
  },
  {
    titleKey: 'helpCentre.sectionDelivery',
    items: [
      { questionKey: 'helpCentre.deliveryWhoQ', answerKey: 'helpCentre.deliveryWhoA' },
      {
        questionKey: 'helpCentre.deliveryTrackQ',
        answerKey: 'helpCentre.deliveryTrackA',
        link: { href: '/orders', labelKey: 'helpCentre.linkMyOrders' },
      },
      { questionKey: 'helpCentre.deliveryLateQ', answerKey: 'helpCentre.deliveryLateA' },
    ],
  },
  {
    titleKey: 'helpCentre.sectionPayment',
    items: [
      { questionKey: 'helpCentre.paymentHowQ', answerKey: 'helpCentre.paymentHowA' },
      { questionKey: 'helpCentre.paymentRefundQ', answerKey: 'helpCentre.paymentRefundA' },
    ],
  },
  {
    titleKey: 'helpCentre.sectionProblems',
    items: [
      {
        questionKey: 'helpCentre.problemsHowQ',
        answerKey: 'helpCentre.problemsHowA',
        link: { href: '/orders', labelKey: 'helpCentre.linkMyOrders' },
      },
      { questionKey: 'helpCentre.problemsOutcomeQ', answerKey: 'helpCentre.problemsOutcomeA' },
    ],
  },
  {
    titleKey: 'helpCentre.sectionReviews',
    items: [
      { questionKey: 'helpCentre.reviewsWhoQ', answerKey: 'helpCentre.reviewsWhoA' },
      { questionKey: 'helpCentre.reviewsWindowQ', answerKey: 'helpCentre.reviewsWindowA' },
    ],
  },
  {
    titleKey: 'helpCentre.sectionAccount',
    items: [
      {
        questionKey: 'helpCentre.accountAddressQ',
        answerKey: 'helpCentre.accountAddressA',
        link: { href: '/account/addresses', labelKey: 'helpCentre.linkAddresses' },
      },
      { questionKey: 'helpCentre.accountLangQ', answerKey: 'helpCentre.accountLangA' },
      { questionKey: 'helpCentre.accountDeleteQ', answerKey: 'helpCentre.accountDeleteA' },
    ],
  },
];

/**
 * The ticket half of the screen.
 *
 * Split out because `useSearchParams` must sit under a Suspense boundary — the
 * order screen links here with `?order=…&code=…` so the ticket is stamped with
 * the order before an operator has to ask which one it is about.
 */
function SupportTickets() {
  const params = useSearchParams();

  return (
    <PartySupport
      side="customer"
      orderId={params.get('order')}
      orderCode={params.get('code')}
    />
  );
}

export default function HelpCentrePage() {
  const t = useT();

  return (
    <AppShell>
      <ScreenHeader title={t('helpCentre.title')} fallbackHref="/account" className="mb-1" />
      <p className="mb-6 pl-1 text-ink-500">{t('helpCentre.intro')}</p>

      <ToastProvider>
        <Suspense fallback={null}>
          <SupportTickets />
        </Suspense>
      </ToastProvider>

      <h2 className="mb-1 mt-8 text-lg font-semibold text-ink-900">{t('helpCentre.faqTitle')}</h2>

      {SECTIONS.map((section) => (
        <section key={section.titleKey} className="mt-6 first:mt-0">
          <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
            {t(section.titleKey)}
          </h2>
          <Card className="divide-y divide-row-edge">
            {section.items.map((item) => (
              <details key={item.questionKey} className="group px-4 py-4 first:rounded-t-2xl last:rounded-b-2xl">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-medium text-ink-800 marker:content-none [&::-webkit-details-marker]:hidden">
                  {t(item.questionKey)}
                  <ChevronDown
                    size={16}
                    aria-hidden
                    className="shrink-0 text-ink-300 transition group-open:rotate-180"
                  />
                </summary>
                <p className="mt-2.5 text-sm leading-relaxed text-ink-600">{t(item.answerKey)}</p>
                {item.link && (
                  <Link
                    href={item.link.href}
                    className="mt-2.5 inline-block text-sm font-medium text-brand-600 underline transition hover:text-brand-700"
                  >
                    {t(item.link.labelKey)}
                  </Link>
                )}
              </details>
            ))}
          </Card>
        </section>
      ))}
    </AppShell>
  );
}
