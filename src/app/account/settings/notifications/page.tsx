'use client';

/**
 * Hesabım → Ayarlar → Bildirişlər. The one place a customer's switches live.
 *
 * `NotificationSettings` is the same component the restaurant, the courier, the
 * operator and the admin see; what a customer gets out of it is decided by
 * `notificationSwitchesFor` in `shared/notifications.ts` and not here. That is
 * why there is no customer variant of the settings screen — five copies of a
 * settings page is five places for one of them to be got subtly wrong, and the
 * one people would complain about is whichever they used second.
 *
 * A customer who is not signed in has no preferences to set, so they are sent
 * to the door rather than shown a page of switches that write nowhere.
 */

import Link from 'next/link';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { NotificationSettings } from '@/components/notifications/NotificationSettings';
import { Button, EmptyState } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';

export default function CustomerNotificationSettingsPage() {
  const t = useT();
  const { firebaseUser, loading } = useAuth();

  return (
    <AppShell>
      <ScreenHeader title={t('notifications.settingsTitle')} fallbackHref="/account/settings" />

      {loading ? (
        <PageLoading label={t('common.loading')} />
      ) : !firebaseUser ? (
        <EmptyState
          title={t('notifications.signInForSettings')}
          hint={t('auth.guestHint')}
          action={
            <Link href="/login?next=/account/settings/notifications">
              <Button>{t('auth.signIn')}</Button>
            </Link>
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-500">{t('notifications.settingsHint')}</p>
          <NotificationSettings />
        </>
      )}
    </AppShell>
  );
}
