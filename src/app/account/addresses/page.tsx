'use client';

/**
 * "Ünvanlarım" — a page of its own rather than a sheet bolted onto Hesabım.
 *
 * Addresses are the thing a customer edits most after their first order (new
 * flat, office, parents' house), so they get room to breathe: a list, an edit
 * pencil on each, and one obvious way to add another.
 *
 * WHY "YENİ ÜNVAN ƏLAVƏ ET" IS PINNED TO THE BOTTOM
 * ------------------------------------------------
 * It is the only reason most people open this screen, and a button that
 * scrolls away under a list of six saved addresses is a button somebody has to
 * go looking for. It sits above the phone's tab bar, full width, on every
 * state of the page — including the empty one, where it is the only thing
 * there. The header no longer carries a second copy of it: two buttons that do
 * the same thing is a choice nobody wanted to make.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AddressForm, AddressRow } from '@/components/customer/AddressForm';
import { Alert, Button, EmptyState, Sheet } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import { deleteAddress } from '@/firebase/callables';
import { watchAddresses } from '@/services/addresses';
import type { Address } from '@/shared/models';

export default function AddressesPage() {
  const t = useT();
  const { firebaseUser, loading } = useAuth();

  const [loaded, setLoaded] = useState<Address[] | null>(null);
  const [editing, setEditing] = useState<Address | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    return watchAddresses(firebaseUser.uid, setLoaded);
  }, [firebaseUser]);

  const addresses = firebaseUser ? loaded : [];

  if (loading) {
    return (
      <AppShell>
        <PageLoading label={t('common.loading')} />
      </AppShell>
    );
  }

  if (!firebaseUser) {
    return (
      <AppShell>
        <ScreenHeader title={t('account.addresses')} fallbackHref="/account" />
        <EmptyState
          title={t('account.signInForAddresses')}
          hint={t('auth.guestHint')}
          action={
            <Link href="/login?next=/account/addresses">
              <Button size="sm">{t('auth.signIn')}</Button>
            </Link>
          }
        />
      </AppShell>
    );
  }

  const remove = async () => {
    if (!removing) return;

    setBusy(true);
    const result = await deleteAddress(removing.id);
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }
    setRemoving(null);
  };

  return (
    <AppShell>
      <ScreenHeader
        title={t('account.addresses')}
        fallbackHref="/account"
        subtitle={
          addresses && addresses.length > 0
            ? t('account.addressCount', { count: addresses.length })
            : undefined
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {addresses === null ? (
        <div className="space-y-2.5" role="status" aria-live="polite" aria-busy="true" aria-label={t('common.loading')}>
          {[0, 1].map((row) => (
            <div key={row} className="h-28 animate-pulse rounded-2xl bg-ink-100" aria-hidden />
          ))}
        </div>
      ) : addresses.length === 0 ? (
        <EmptyState title={t('checkout.noAddress')} hint={t('account.addressesHint')} />
      ) : (
        // The bottom padding clears the pinned button below, so the last
        // address in the list can always be scrolled out from under it.
        <div className="space-y-2.5 pb-24">
          {addresses.map((address) => (
            <AddressRow
              key={address.id}
              address={address}
              onEdit={() => setEditing(address)}
              onDelete={() => setRemoving(address)}
            />
          ))}
        </div>
      )}

      {/* Pinned, full width, above the phone's tab bar. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-card-edge bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] pt-3 backdrop-blur sm:pb-4">
        <div className="mx-auto max-w-5xl">
          <Button fullWidth size="lg" onClick={() => setAdding(true)}>
            <Plus size={18} aria-hidden /> {t('address.addNew')}
          </Button>
        </div>
      </div>

      {/* Keyed so editing a different address starts from that address. */}
      {adding && <AddressForm key="new" open onClose={() => setAdding(false)} />}
      {editing && (
        <AddressForm
          key={editing.id}
          open
          existing={editing}
          onClose={() => setEditing(null)}
        />
      )}

      <Sheet
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={t('common.delete')}
        footer={
          <Button variant="danger" fullWidth loading={busy} onClick={remove}>
            {t('common.delete')}
          </Button>
        }
      >
        <p className="text-ink-700">
          {removing?.label} — {removing?.line}
        </p>
        <p className="mt-2 text-sm text-ink-400">{t('account.deleteAddressHint')}</p>
      </Sheet>
    </AppShell>
  );
}
