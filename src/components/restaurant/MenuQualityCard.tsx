'use client';

/**
 * What is wrong with this menu, in things that can be fixed this afternoon.
 *
 * WHY IT IS NOT A SCORE
 * ---------------------
 * A score is there, and it is deliberately the small number in the corner. An
 * owner told "your menu is 62%" learns nothing they can act on; an owner told
 * "eleven dishes have no photograph" has a job for the evening. So the counts
 * lead and the bar follows, and every line names a thing rather than a
 * quantity of virtue.
 *
 * WHY THERE IS NO CALLABLE BEHIND IT
 * ----------------------------------
 * The menu screen already holds the whole menu in memory — it is rendering it.
 * A server report would mean a function, a round trip and a number that is
 * right at the moment it was computed and wrong by the time somebody fixes a
 * dish. This recomputes on every keystroke of the editor and costs nothing.
 *
 * WHAT IS DELIBERATELY NOT COUNTED AGAINST THE MENU
 * -------------------------------------------------
 * Sold out and hidden. Running out of something is running a kitchen, and a
 * hidden dish is a decision somebody made — neither is neglect. They are shown
 * because an owner may have forgotten to switch one back on, and that is a
 * different sentence from "your menu is poor".
 */

import { AlertTriangle, Check, EyeOff, ImageOff, PackageX, Text } from 'lucide-react';

import { useT } from '@/i18n';
import { Card, cn } from '@/components/ui';
import { menuQuality } from '@/shared/badges';
import type { Product } from '@/shared/models';

export function MenuQualityCard({ products }: { products: Product[] }) {
  const t = useT();
  const quality = menuQuality(products);

  if (quality.total === 0) return null;

  const faults = [
    {
      key: 'missingImage',
      icon: ImageOff,
      count: quality.missingImage,
      /** The one that actually costs sales, so it is first and it is amber. */
      severe: true,
    },
    { key: 'missingDescription', icon: Text, count: quality.missingDescription, severe: false },
    { key: 'freeItems', icon: AlertTriangle, count: quality.freeItems, severe: true },
    { key: 'outOfStock', icon: PackageX, count: quality.outOfStock, severe: false },
    { key: 'hidden', icon: EyeOff, count: quality.hidden, severe: false },
  ].filter((fault) => fault.count > 0);

  return (
    <Card className="mb-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink-900">
            {t('restaurantPanel.menuQuality')}
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {t('restaurantPanel.menuQualityCount', { count: quality.total })}
          </p>
        </div>

        {/* The number, kept small and to one side. It is a summary, not the
            message — the message is the list underneath. */}
        <div className="shrink-0 text-right">
          <span
            className={cn(
              'text-2xl font-semibold tabular-nums',
              quality.score >= 85
                ? 'text-success'
                : quality.score >= 60
                  ? 'text-warning'
                  : 'text-danger',
            )}
          >
            {quality.score}
          </span>
          <span className="text-sm text-ink-400">/100</span>
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300',
            quality.score >= 85 ? 'bg-success' : quality.score >= 60 ? 'bg-warning' : 'bg-danger',
          )}
          style={{ width: `${quality.score}%` }}
        />
      </div>

      {faults.length === 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-success">
          <Check size={15} aria-hidden />
          {t('restaurantPanel.menuQualityPerfect')}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {faults.map((fault) => (
            <li key={fault.key} className="flex items-center gap-2 text-sm">
              <fault.icon
                size={15}
                className={fault.severe ? 'text-warning' : 'text-ink-400'}
                aria-hidden
              />
              <span className={fault.severe ? 'text-ink-800' : 'text-ink-600'}>
                {t(`restaurantPanel.menuFault.${fault.key}`, { count: fault.count })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
