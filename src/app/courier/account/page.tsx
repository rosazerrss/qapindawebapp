'use client';

/**
 * Hesabım — who this account is, and what it has done.
 *
 * Six facts and three doors, and the list of what is deliberately absent is as
 * much a part of the design: no earnings, no rates, no invoice, nothing about
 * what the restaurant makes on a delivery, and nothing at all about any
 * restaurant other than the one this account rides for. A courier account lives
 * on a personal phone that gets lost, sold and handed to the next driver, so
 * every fact this screen does not hold is a fact that cannot be lost with it.
 *
 * WHY THE RESTAURANT NAME HAS A FALLBACK
 * --------------------------------------
 * A courier is not restaurant staff — `ownsRestaurant()` in the rules
 * deliberately excludes the role — so the restaurant document is readable only
 * while the restaurant is ACTIVE, and that read can legitimately fail. Every
 * order the driver has ever carried already holds the name, so when the
 * document cannot be read the most recent of those answers instead, and only
 * when there is no answer at all does the screen say so.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronRight, History, Settings } from 'lucide-react';

import { Badge, Button, Card } from '@/components/ui';
import { CourierShell } from '@/components/courier/CourierShell';
import {
  useCourierActiveOrders,
  useCourierHistory,
} from '@/components/courier/useCourierData';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import { watchRestaurant } from '@/services/catalog';
import { COURIER_HISTORY_WINDOW } from '@/services/courier';
import { formatPhone } from '@/shared/phone';
import { AccountStatus } from '@/shared/enums';

export default function CourierAccountPage() {
  const t = useT();
  const { firebaseUser, profile, restaurantId, signOut } = useAuth();

  const active = useCourierActiveOrders();
  const history = useCourierHistory();

  const [restaurantName, setRestaurantName] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId) return;
    return watchRestaurant(
      restaurantId,
      (next) => setRestaurantName(next?.name ?? null),
      () => setRestaurantName(null),
    );
  }, [restaurantId]);

  // The name off the shop's own document when it can be read, and off the work
  // already done when it cannot. Derived during render — the orders arrive on
  // their own schedule, and copying them into state would be a render whose
  // only job is to catch up with another one.
  const nameFromOrders =
    active.orders?.[0]?.restaurantName ?? history.orders?.[0]?.restaurantName ?? null;
  const restaurant = restaurantName ?? nameFromOrders;

  const photoUrl = firebaseUser?.photoURL ?? null;
  const fullName = profile?.fullName ?? '';
  const status = profile?.accountStatus ?? AccountStatus.ACTIVE;

  // "100+" rather than a flat 100 once the history window is full: the number
  // would otherwise quietly stop counting and nobody would know it had.
  const doneCount =
    history.orders === null
      ? '—'
      : history.orders.length >= COURIER_HISTORY_WINDOW
        ? `${COURIER_HISTORY_WINDOW}+`
        : String(history.orders.length);

  return (
    <CourierShell title={t('account.title')}>
      <Card className="flex items-center gap-4 p-5">
        {/* A background image rather than an <img>: the photograph comes from
            whichever provider the driver signed in with, at a size nobody
            controls, and this is a 64-pixel circle either way. */}
        <span
          aria-hidden
          style={photoUrl ? { backgroundImage: `url(${photoUrl})` } : undefined}
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-50 bg-cover bg-center text-2xl font-semibold text-brand-700"
        >
          {!photoUrl && (fullName.trim().charAt(0) || '·')}
        </span>

        <div className="min-w-0">
          <p className="truncate text-xl font-semibold text-ink-900">{fullName}</p>
          <p className="mt-0.5 text-base text-ink-500">{t('roles.RESTAURANT_COURIER')}</p>
        </div>
      </Card>

      <Card className="mt-4 divide-y divide-row-edge p-1">
        <Fact
          label={t('kuryer.accountRestaurant')}
          value={restaurant ?? t('kuryer.accountRestaurantNone')}
        />
        <Fact
          label={t('kuryer.accountPhone')}
          value={profile?.phone ? formatPhone(profile.phone) : '—'}
        />
        <Fact
          label={t('kuryer.accountStatus')}
          value={
            <Badge tone={status === AccountStatus.ACTIVE ? 'success' : 'warning'}>
              {t(`status.${status}`)}
            </Badge>
          }
        />
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Count
          label={t('kuryer.dashboardActive')}
          value={active.orders === null ? '—' : String(active.orders.length)}
        />
        <Count label={t('kuryer.dashboardDone')} value={doneCount} />
      </div>

      <nav className="mt-4 space-y-3">
        <Row href="/courier/history" icon={History} label={t('kuryer.historyTitle')} />
        <Row href="/courier/notifications" icon={Bell} label={t('notifications.title')} />
        <Row href="/courier/settings" icon={Settings} label={t('nav.settings')} />
      </nav>

      <div className="mt-6">
        <p className="mb-2 text-sm text-ink-400">{t('kuryer.signOutHint')}</p>
        <Button size="lg" variant="secondary" fullWidth onClick={() => void signOut()}>
          {t('auth.signOut')}
        </Button>
      </div>
    </CourierShell>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
      <span className="text-base text-ink-500">{label}</span>
      <span className="text-right text-base font-medium text-ink-900">{value}</span>
    </div>
  );
}

function Count({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-card-edge bg-white p-4 shadow-sm">
      <p className="text-3xl font-bold tabular-nums text-ink-900">{value}</p>
      <p className="mt-1 text-sm text-ink-500">{label}</p>
    </div>
  );
}

function Row({ href, icon: Icon, label }: { href: string; icon: typeof Bell; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center gap-3 rounded-2xl border border-card-edge bg-white px-4 py-3 text-lg font-medium text-ink-900 shadow-sm transition hover:bg-ink-50"
    >
      <Icon size={22} className="shrink-0 text-ink-400" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight size={20} className="shrink-0 text-ink-300" aria-hidden />
    </Link>
  );
}
