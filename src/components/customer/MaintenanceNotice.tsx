'use client';

/**
 * "Qapında bağlıdır" — the notice a customer sees while the platform is closed.
 *
 * The switch itself lives in admin settings and the refusal lives on the
 * server (`shared/maintenance.ts`, `createOrder`, `previewOrder`). What is
 * here is only the half a customer meets: a sentence saying the platform is
 * closed, the admin's explanation if one was written, and when it is expected
 * back if the admin was willing to say.
 *
 * WHY IT IS WATCHED RATHER THAN FETCHED
 * -------------------------------------
 * The interesting moment is the one where the platform comes BACK. A customer
 * sitting on the shopfront with a closed notice should see it clear itself
 * when the admin flips the switch, not discover it by reloading — and the same
 * subscription is what pulls the checkout's ordering path open again.
 */

import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';

import { Alert } from '@/components/ui';
import { useT } from '@/i18n';
import { watchPublicSettings } from '@/services/settings';
import { maintenanceStateOf, type MaintenanceState } from '@/shared/maintenance';
import type { PublicSettings } from '@/shared/models';

const OPEN: MaintenanceState = { on: false, message: null, until: null };

/**
 * The platform's maintenance state, live.
 *
 * Returns the open state while the settings document has not arrived yet, and
 * on any failure to read it. That is the deliberate direction to fail in: this
 * is a screen hint, and a subscription that broke must never be able to close
 * a working platform. The server is what actually refuses orders, and the
 * server reads the document itself.
 */
export function useMaintenance(): MaintenanceState {
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  useEffect(() => watchPublicSettings(setSettings), []);

  return settings ? maintenanceStateOf(settings) : OPEN;
}

/** Formats the "back by" time the way a customer reads a time, or nothing. */
function backBy(until: number | null): string | null {
  if (until === null) return null;
  return new Date(until).toLocaleString('az-AZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The notice itself. Renders nothing at all while the platform is open, so it
 * can be dropped at the top of any customer screen without a condition.
 */
export function MaintenanceNotice({ className }: { className?: string }) {
  const t = useT();
  const maintenance = useMaintenance();

  if (!maintenance.on) return null;

  const until = backBy(maintenance.until);

  return (
    <div className={className}>
      <Alert tone="warning">
        <span className="flex gap-2.5">
          <Wrench size={17} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block font-medium">{t('maintenance.title')}</span>
            {/* The admin's own words come first when there are any: a reason
                somebody wrote beats a generic sentence every time. */}
            <span className="mt-0.5 block">{maintenance.message ?? t('maintenance.body')}</span>
            {until && <span className="mt-0.5 block">{t('maintenance.until', { time: until })}</span>}
          </span>
        </span>
      </Alert>
    </div>
  );
}
