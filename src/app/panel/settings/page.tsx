'use client';

/**
 * Restoran Paneli → Ayarlar.
 *
 * An index, not a form. Each card opens a screen where one thing is configured
 * and one Save button belongs to it — see `SettingsForm.tsx` for why the long
 * single column this replaced was a hazard rather than merely untidy.
 *
 * The language picker stays here rather than getting a page of its own: it is
 * one control, it saves nothing to the server, and burying a single dropdown
 * behind a door would be the opposite of what was asked for.
 */

import {
  Bell,
  Clock,
  CreditCard,
  Image as ImageIcon,
  KeyRound,
  MapPin,
  Printer,
  Store,
  Truck,
} from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import { PageHeader } from '@/components/panel/ui';
import { SettingsIndex, type SettingsEntry } from '@/components/panel/SettingsIndex';
import { LanguageMenu } from '@/components/customer/LanguageMenu';
import { Card } from '@/components/ui';
import { useT } from '@/i18n';

const ROOT = '/panel/settings';

export default function RestaurantSettingsIndexPage() {
  const t = useT();

  const entries: SettingsEntry[] = [
    {
      href: `${ROOT}/appearance`,
      icon: ImageIcon,
      title: t('restaurantPanel.sectionImages'),
      description: t('restaurantPanel.sectionImagesHint'),
    },
    {
      href: `${ROOT}/profile`,
      icon: Store,
      title: t('restaurantPanel.sectionProfile'),
      description: t('restaurantPanel.sectionProfileHint'),
    },
    {
      href: `${ROOT}/location`,
      icon: MapPin,
      title: t('restaurantPanel.sectionLocation'),
      description: t('restaurantPanel.sectionLocationHint'),
    },
    {
      href: `${ROOT}/printers`,
      icon: Printer,
      title: t('restaurantPanel.sectionPrinters'),
      description: t('restaurantPanel.sectionPrintersHint'),
    },
    {
      href: `${ROOT}/delivery`,
      icon: Truck,
      title: t('restaurantPanel.sectionDelivery'),
      description: t('restaurantPanel.sectionDeliveryHint'),
    },
    {
      href: `${ROOT}/payment`,
      icon: CreditCard,
      title: t('restaurant.paymentMethods'),
      description: t('restaurantPanel.sectionPaymentsHint'),
    },
    {
      href: `${ROOT}/handover-code`,
      icon: KeyRound,
      title: t('restaurantPanel.requireDeliveryCodeLabel'),
      description: t('restaurantPanel.requireDeliveryCodeHint'),
    },
    {
      href: `${ROOT}/hours`,
      icon: Clock,
      title: t('restaurant.openingHours'),
      description: t('restaurantPanel.sectionHoursHint'),
    },
    {
      // The account's own settings, not the restaurant's — they follow whoever
      // is signed in. They used to sit in the middle of a long form about
      // delivery radius and opening hours, which is exactly the screen a
      // kitchen accidentally silences itself from.
      href: `${ROOT}/notifications`,
      icon: Bell,
      title: t('notifications.settingsTitle'),
      description: t('notifications.settingsHint'),
    },
  ];

  return (
    <PanelShell kind="restaurant">
      <PageHeader title={t('nav.settings')} subtitle={t('restaurantPanel.settingsSubtitle')} />

      <div className="max-w-2xl space-y-3">
        <SettingsIndex entries={entries} />

        <Card className="flex items-center justify-between gap-3 p-4">
          <span className="min-w-0">
            <span className="block text-[15px] font-medium text-ink-900">
              {t('account.language')}
            </span>
            <span className="mt-0.5 block text-sm text-ink-400">
              {t('restaurantPanel.languageHint')}
            </span>
          </span>
          <LanguageMenu />
        </Card>
      </div>
    </PanelShell>
  );
}
