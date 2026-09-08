'use client';

/**
 * Legal texts.
 *
 * DRAFT, NOT LEGAL ADVICE. The wording lives in `src/content/legal` — one file
 * per language — and is written to describe this platform honestly. It still
 * has to be reviewed by a lawyer qualified in Azerbaijani law before the
 * platform takes a single real order. The banner at the top of the page says
 * so to the reader as well; do not remove it until a lawyer has signed off.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Alert, Card } from '@/components/ui';
import { getLegalDocument } from '@/content/legal';
import { fillLegalText, legalValues, watchPublicSettings } from '@/services/settings';
import { useLocale, useT } from '@/i18n';
import type { PublicSettings } from '@/shared/models';

export default function LegalPage({ params }: PageProps<'/legal/[document]'>) {
  const { document } = use(params);
  const { locale } = useLocale();
  const t = useT();

  /*
   * The operator's legal identity and the support contact, live.
   *
   * Without this the reader saw the raw `{{SUPPORT_PHONE}}` tokens the source
   * text carries on purpose — see `legalValues`. Watched rather than fetched
   * once, so an admin correcting the registered address does not leave a
   * customer reading the old one until they reload.
   */
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  useEffect(() => watchPublicSettings(setSettings), []);
  const values = legalValues(settings);

  const content = getLegalDocument(decodeURIComponent(document), locale);

  if (!content) {
    return (
      <AppShell>
        <ScreenHeader fallbackHref="/" className="mb-2" />
        <p className="text-ink-500">{t('errors.NOT_FOUND')}</p>
        <Link href="/" className="mt-3 inline-block text-brand-600 underline">
          {t('home.allRestaurants')}
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ScreenHeader title={content.title} fallbackHref="/" className="mb-1" />

      <p className="mb-4 text-xs text-ink-400">
        {content.version} · {content.effectiveDate}
      </p>

      <div className="mt-4 mb-5">
        <Alert tone="warning">
          <span className="font-semibold">{t('legal.draftBadge')}</span> {t('legal.draftNotice')}
        </Alert>
      </div>

      <Card className="space-y-6 p-5">
        <p className="text-[15px] leading-relaxed text-ink-700">
          {fillLegalText(content.intro, values)}
        </p>

        {content.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="mb-2 font-semibold text-ink-900">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mb-2 text-[15px] leading-relaxed text-ink-700">
                {fillLegalText(paragraph, values)}
              </p>
            ))}
          </section>
        ))}
      </Card>

      <p className="mt-4 text-xs text-ink-400">{t('legal.placeholderNote')}</p>
    </AppShell>
  );
}
