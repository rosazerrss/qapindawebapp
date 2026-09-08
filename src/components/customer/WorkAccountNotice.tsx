'use client';

/**
 * What a work account sees where the ordering flow used to be.
 *
 * A restaurant owner, a manager, somebody on the till, a driver, an operator
 * and the admin all have one thing in common here: they may not order food.
 * The rule is enforced by `createOrder` on the server, which reads the role
 * from the stored user document — this component exists so that nobody walks
 * the whole way to the checkout button before being told.
 *
 * It is a card rather than a silent redirect on purpose. Somebody who taps a
 * bookmarked /cart deserves a sentence explaining why their cart is not
 * there, not a mysterious bounce to a different screen; the way out to their
 * own panel is the one button on it, so the trip is one tap rather than
 * automatic.
 */

import Link from 'next/link';
import { Briefcase } from 'lucide-react';

import { Button, Card } from '@/components/ui';
import { useT } from '@/i18n';
import { accountHome } from '@/shared/permissions';
import type { UserRole } from '@/shared/enums';

export function WorkAccountNotice({ role }: { role: UserRole }) {
  const t = useT();

  return (
    <div className="mx-auto max-w-md py-6">
      <Card className="p-8 text-center">
        <span
          aria-hidden
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-500"
        >
          <Briefcase size={22} />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-ink-900">{t('workAccount.title')}</h1>
        <p className="mt-2.5 text-ink-500">{t('workAccount.orderBody')}</p>
        <div className="mt-6">
          <Link href={accountHome(role)} className="block">
            <Button fullWidth size="lg">
              {t('workAccount.goToPanel')}
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
