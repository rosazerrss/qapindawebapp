'use client';

/**
 * A settings area, as an index of doors.
 *
 * WHY EVERY PANEL'S SETTINGS LOOK LIKE THIS NOW
 * ---------------------------------------------
 * "AYARLARA GİRDİKDƏ QARIŞIQLIQ OLMASIN — AYRICA PƏNCƏRƏLƏR AÇILSIN ONLARIN
 * DAXİLİNƏ GİRİB HƏRŞEY ETMƏK OLSUN." Settings screens grow by accretion: a
 * notification switch here, a bank account there, opening hours, and eventually
 * a button that deletes everything — all in one column under one Save. That is
 * unreadable, and worse, it makes one Save button responsible for settings the
 * person never looked at.
 *
 * So a settings screen is a list of cards, each naming one thing and opening a
 * page where only that thing can be changed. Every sub-page carries a ← Geri
 * back to this list. The same component is used by the admin, the restaurant,
 * the operator, the courier and the customer, so all five read the same way and
 * a new area is one entry in one array.
 */

import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui';

export interface SettingsEntry {
  href: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  /**
   * Marks the area that can destroy something.
   *
   * It is drawn apart from the rest and in the danger colour, because the one
   * thing that must never happen on a settings index is somebody opening the
   * reset by aiming for the row above it.
   */
  danger?: boolean;
}

export function SettingsIndex({ entries }: { entries: SettingsEntry[] }) {
  const ordinary = entries.filter((entry) => !entry.danger);
  const dangerous = entries.filter((entry) => entry.danger);

  return (
    <div className="max-w-2xl space-y-3">
      <Card className="divide-y divide-row-edge p-0">
        {ordinary.map((entry) => (
          <Row key={entry.href} entry={entry} />
        ))}
      </Card>

      {dangerous.length > 0 && (
        <Card className="divide-y divide-row-edge border-danger/30 p-0">
          {dangerous.map((entry) => (
            <Row key={entry.href} entry={entry} />
          ))}
        </Card>
      )}
    </div>
  );
}

/** One door. A whole row is the target, not just the words on it. */
function Row({ entry }: { entry: SettingsEntry }) {
  const Icon = entry.icon;

  return (
    <Link
      href={entry.href}
      className="flex min-h-16 items-center gap-3 px-4 py-3 transition first:rounded-t-2xl last:rounded-b-2xl hover:bg-ink-50"
    >
      <span
        className={
          entry.danger
            ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger'
            : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-500'
        }
      >
        <Icon size={18} aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={
            entry.danger
              ? 'block text-[15px] font-medium text-danger'
              : 'block text-[15px] font-medium text-ink-900'
          }
        >
          {entry.title}
        </span>
        {entry.description && (
          <span className="mt-0.5 block text-sm text-ink-400">{entry.description}</span>
        )}
      </span>

      <ChevronRight size={18} className="shrink-0 text-ink-300" aria-hidden />
    </Link>
  );
}
