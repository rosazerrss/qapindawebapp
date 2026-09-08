'use client';

/**
 * The bell, and the list behind it.
 *
 * One component in four places — the customer header, the restaurant and admin
 * panel bar, the operator's header — because a bell that behaves differently
 * depending on which panel you are in is four bells, and the one people would
 * complain about is whichever one they used second.
 *
 * THE PANEL HAS NO SETTINGS IN IT, AND THAT IS THE POINT
 * -----------------------------------------------------
 * It used to open the switches inline, and the owner asked twice for that to
 * stop: a control reachable from a screen somebody is working on is a control
 * that gets flipped by accident in the middle of a shift. What is left is the
 * list, the unread count, "hamısını oxundu kimi işarələ", and a LINK — it
 * navigates to Ayarlar → Bildirişlər for whichever panel this person works in,
 * closing the sheet on the way, and never expands anything in place.
 *
 * `notificationSettingsPath` is what decides where that is, so the five panels
 * cannot drift apart about it. The courier's header does not mount this at all:
 * it shows a count and a link to `/courier/notifications`, which is the same list
 * — `NotificationList` — with no settings anywhere near it.
 *
 * A SHEET FOR THE CUSTOMER, A PAGE FOR EVERYBODY WHO WORKS HERE
 * -------------------------------------------------------------
 * For the customer the sheet is right. The hardest case decides the shape —
 * somebody holding a phone in one hand — and a sheet coming up from the bottom
 * of the screen is where a thumb already is, while a dropdown anchored to a
 * 40-pixel button in the corner is a target for a mouse.
 *
 * On the four staff surfaces it was wrong, and badly so. A modal locks the page
 * behind it, traps the keyboard, and mounts up to a hundred rows on top of a
 * screen already carrying the live order listeners — so pressing the bell on a
 * busy restaurant panel froze the interface for several seconds. It was
 * reported exactly that way, and it was not one bug: the freeze had a second
 * cause in `useNotifications`, where confirming delivery fired one write per
 * notification and each write came back as a snapshot that re-rendered the
 * whole shell. That half is fixed there; this half is the shape.
 *
 * So on a panel the bell is a LINK. It carries the same unread badge, it goes
 * to that panel's Bildirişlər page, and it opens nothing in place. The courier
 * already worked this way and always had — `/courier/notifications` is a page —
 * so this is one existing decision applied to the rest rather than a new idea.
 * `notificationsPagePath` is what decides, so the five surfaces cannot drift.
 *
 * WHAT A ROW LOOKS LIKE IS NOT DECIDED HERE
 * ----------------------------------------
 * `NotificationList` draws the rows, because the courier app has a whole screen
 * that is nothing but this list and the two must not drift apart about what an
 * unread notification looks like.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Settings2 } from 'lucide-react';

import { Sheet, cn } from '@/components/ui';
import { useT } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { unlockNotificationSound } from '@/lib/notificationSound';
import { notificationSettingsPath, notificationsPagePath } from '@/shared/permissions';
import type { AppNotification } from '@/shared/models';
import { NotificationList } from './NotificationList';
import { useNotifications } from './useNotifications';

/** Light chrome for the panels' white bar, dark for the operator's header. */
export type BellTone = 'light' | 'dark';

export function NotificationBell({ tone = 'light' }: { tone?: BellTone }) {
  const t = useT();
  const router = useRouter();
  const { firebaseUser, role } = useAuth();
  const { notifications, unreadCount, loaded, failed, markRead, markAllRead } =
    useNotifications();

  const [open, setOpen] = useState(false);

  /*
   * A path means this role reads its notifications on a page; `null` means the
   * sheet. Only the customer gets `null`.
   */
  const page = notificationsPagePath(role);

  /*
   * Browsers refuse to make a sound until the person has touched the page, and
   * the refusal is silent. So the audio context is created from the first real
   * interaction anywhere in the app — not from the bell, which somebody may
   * never press, and not on load, where it would simply be denied.
   */
  useEffect(() => {
    const unlock = () => unlockNotificationSound();
    const options = { once: true, passive: true } as const;

    window.addEventListener('pointerdown', unlock, options);
    window.addEventListener('keydown', unlock, options);
    window.addEventListener('touchstart', unlock, options);

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  // A bell for nobody is a button that opens an empty box.
  if (!firebaseUser) return null;

  const openCentre = () => {
    // On a panel the bell navigates and never opens a modal over the screen
    // somebody is working on. See the note at the top of this file.
    if (page) {
      router.push(page);
      return;
    }
    setOpen(true);
  };

  /** Leaves the sheet and goes to the page. It never opens anything in place. */
  const openSettings = () => {
    setOpen(false);
    router.push(notificationSettingsPath(role));
  };

  const follow = (notification: AppNotification) => {
    markRead(notification);
    if (!notification.link) return;
    setOpen(false);
    router.push(notification.link);
  };

  return (
    <>
      <button
        type="button"
        onClick={openCentre}
        aria-label={
          unreadCount > 0
            ? `${t('notifications.title')} — ${t('notifications.unreadCount', { count: unreadCount })}`
            : t('notifications.title')
        }
        className={cn(
          // 44px, which is the minimum a thumb can be asked to hit, and the
          // reason this is not the 32px icon button the panel bar uses.
          'relative flex h-11 w-11 items-center justify-center rounded-xl transition',
          tone === 'dark'
            ? 'text-white/70 hover:bg-white/10 hover:text-white'
            : 'text-ink-500 hover:bg-ink-100 hover:text-ink-900',
        )}
      >
        <Bell size={20} aria-hidden />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Not merely closed on a panel — not mounted at all, so none of its
          chrome, its focus trap or its hundred rows exist on a screen that
          navigates instead. */}
      <Sheet
        open={open && !page}
        onClose={() => setOpen(false)}
        title={t('notifications.title')}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          {/* A link, not a toggle. The settings are a page somebody walks to. */}
          <button
            type="button"
            onClick={openSettings}
            className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-ink-500 hover:bg-ink-100 hover:text-ink-900"
          >
            <Settings2 size={16} aria-hidden />
            {t('notifications.settingsTitle')}
          </button>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="min-h-11 rounded-lg px-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
            >
              {t('notifications.markAllRead')}
            </button>
          )}
        </div>

        <NotificationList
          notifications={notifications}
          loaded={loaded}
          failed={failed}
          onOpen={follow}
        />
      </Sheet>
    </>
  );
}
