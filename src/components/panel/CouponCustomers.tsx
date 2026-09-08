'use client';

/**
 * Who a coupon is actually for.
 *
 * The campaign screen used to answer that question with "8 named customers" —
 * a count, and a textarea of raw Firestore uids to change it with. Nobody knows
 * a uid, so in practice a personal coupon could be created and never edited
 * again. This is the missing half: the names, and a way to add and remove them
 * by the only identifier this platform actually runs on, a phone number.
 *
 * WHAT IT DOES NOT SHOW
 * ---------------------
 * Full legal names. The server sends back `displayName(fullName)` — "Aysel M."
 * — and the phone, and that is the whole of it. An admin screen is often on a
 * projector in an office; a list of customers' legal names is not something to
 * put there when the short name and the number identify them just as well.
 *
 * NOTHING HERE ENFORCES ANYTHING
 * ------------------------------
 * Removing somebody from this list does not stop them redeeming the coupon;
 * `evaluateCoupon`, inside `createOrder`, refusing their uid does. This screen
 * only edits the field that rule reads.
 */

import { useEffect, useState } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';

import { Alert, Button } from '@/components/ui';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { InlineLoading } from '@/components/ui/loading';
import { useT, translateError } from '@/i18n';
import {
  addCouponCustomer,
  couponCustomers,
  removeCouponCustomer,
  type CouponCustomerRow,
} from '@/firebase/callables';
import { formatPhone } from '@/shared/phone';

export function CouponCustomers({
  code,
  /** Called when the last customer was removed and the server switched it off. */
  onDeactivated,
}: {
  code: string;
  onDeactivated?: () => void;
}) {
  const t = useT();

  const [rows, setRows] = useState<CouponCustomerRow[] | null>(null);
  const [named, setNamed] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * A counter, bumped after every add and remove, that the fetch below depends
   * on. The read is written inline in the effect rather than behind a `load()`
   * helper because `react-hooks/set-state-in-effect` is an error here and it
   * reads a called function as a synchronous one — and it is right to be
   * suspicious: state must only be set from the callback, once the answer has
   * actually arrived.
   */
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let live = true;

    void couponCustomers(code).then((result) => {
      if (!live) return;

      if (!result.ok) {
        setRows([]);
        setError(translateError(t, result.errorCode, result.errorDetail));
        return;
      }

      setNamed(result.data?.named === true);
      setRows(result.data?.customers ?? []);
    });

    return () => {
      live = false;
    };
  }, [code, reloads, t]);

  const add = async () => {
    setBusy(true);
    setError(null);

    const result = await addCouponCustomer({ code, phone });
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setPhone('');
    setReloads((count) => count + 1);
  };

  const remove = async (customerId: string) => {
    setBusy(true);
    setError(null);

    const result = await removeCouponCustomer({ code, customerId });
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    if (result.data?.deactivated) onDeactivated?.();
    setReloads((count) => count + 1);
  };

  if (rows === null) return <InlineLoading label={t('common.loading')} className="py-4" />;

  // An open campaign is not a personal coupon with nobody on it, and saying so
  // is the difference between "add somebody here" and "do not touch this".
  if (!named) {
    return (
      <p className="rounded-xl border border-card-edge bg-subtle px-3.5 py-3 text-sm text-ink-500">
        {t('admin.couponEveryCustomerHint')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-row-edge overflow-hidden rounded-xl border border-card-edge bg-surface">
        {rows.map((row) => (
          <li key={row.uid} className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink-900">
                {row.name || t('admin.couponCustomerUnknown')}
              </span>
              <span className="block tabular-nums text-sm text-ink-500">
                {row.phone ? formatPhone(row.phone) : t('admin.couponCustomerDeleted')}
              </span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              aria-label={t('admin.couponRemoveCustomer')}
              title={t('admin.couponRemoveCustomer')}
              onClick={() => void remove(row.uid)}
            >
              <UserMinus size={15} />
            </Button>
          </li>
        ))}
      </ul>

      {/* Removing the last name would leave `allowedUserIds` empty, which means
          "everybody" — so the server switches the coupon off instead, and the
          admin is told that before they do it. */}
      {rows.length === 1 && <p className="text-xs text-ink-500">{t('admin.couponLastCustomerHint')}</p>}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <PhoneInput
            label={t('admin.couponAddCustomer')}
            value={phone}
            onChange={setPhone}
            hint={t('admin.couponAddCustomerHint')}
          />
        </div>
        <Button
          className="mb-6"
          disabled={busy || phone.length === 0}
          loading={busy}
          onClick={() => void add()}
        >
          <UserPlus size={15} /> {t('common.add')}
        </Button>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
