'use client';

/**
 * The restaurant's line to Qapında.
 *
 * Two lanes, side by side, and the difference between them matters more than
 * it looks. An operator handles the day-to-day — a stuck order, a customer
 * who cannot be reached, a menu that will not save. The admin lane is for the
 * things an operator has no authority over and, deliberately, no sight of:
 * commission, invoices, the contract, an account problem, and a complaint
 * about an operator. Asking somebody to forward a complaint about themselves
 * is not a workflow, so `firestore.rules` and every callable keep operators
 * out of that lane rather than the screen keeping it off the menu.
 *
 * The notice that used to sit at the top of this page — "customers are not in
 * this chat, ring them yourself" — has gone, because it is no longer true.
 * Customers now have their own line to an operator, and a restaurant reading a
 * warning about a rule that has been reversed is worse than no notice at all.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { PanelShell } from '@/components/layout/PanelShell';
import { PartySupport } from '@/components/support/PartySupport';
import { PageHeader } from '@/components/panel/ui';
import { Loading } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';

/**
 * Split out because `useSearchParams` must sit under a Suspense boundary. The
 * order drawer links here with `?order=…&code=…`, so a ticket raised about a
 * specific order arrives at the operator already attached to it.
 */
function Tickets() {
  const params = useSearchParams();

  return (
    <PartySupport
      side="restaurant"
      orderId={params.get('order')}
      orderCode={params.get('code')}
    />
  );
}

export default function RestaurantSupportPage() {
  const t = useT();
  const { restaurantId } = useAuth();

  return (
    <PanelShell kind="restaurant">
      <PageHeader title={t('nav.support')} subtitle={t('support.restaurantSubtitle')} />

      <div className="mt-4">
        {restaurantId ? (
          <Suspense fallback={<Loading />}>
            <Tickets />
          </Suspense>
        ) : (
          <Loading />
        )}
      </div>
    </PanelShell>
  );
}
