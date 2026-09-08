'use client';

/**
 * "Bu müştəriyə kupon ver".
 *
 * The owner's line was "ADMİN İSTİFADEÇİLERE AYRI AYRILIQLDA ÖZEL KUPONLAR
 * VERE BİLMELİDİR" — one customer at a time, not a campaign. The natural place
 * for that is the customer's own row, because the person doing it has just
 * finished reading a complaint about that customer's order; sending them to the
 * campaign screen to paste a Firestore uid into a textarea, which was the only
 * way before this, is not a workflow anybody would use twice.
 *
 * TWO ROUTES, ONE DIALOG
 * ----------------------
 * Either the customer is added to a personal coupon that already exists — a
 * standing "sorry" coupon the platform keeps — or a coupon is made here and
 * now for them alone. Both end in the same place: the customer's uid on the
 * coupon's `allowedUserIds`, which is the field `evaluateCoupon` refuses
 * everybody else against. Nothing here decides a discount; the server does,
 * at checkout, every time.
 *
 * WHAT IT SHOWS ABOUT THE CUSTOMER
 * --------------------------------
 * The phone and the short display name — "Aysel M." — and never the full legal
 * name. The admin already knows who they are looking at; the dialog does not
 * need to put a legal name on a screen that is often shared.
 */

import { useEffect, useState } from 'react';
import { Ticket } from 'lucide-react';

import { Alert, Button, Input, Money, Select, Sheet, cn } from '@/components/ui';
import { InlineSpinner } from '@/components/panel/ui';
import { useT, translateError } from '@/i18n';
import { grantCustomerCoupon, listCoupons } from '@/firebase/callables';
import { list, text } from '@/lib/stored';
import { CouponType } from '@/shared/enums';
import { parseMajorUnits } from '@/shared/pricing';
import { displayName } from '@/shared/reviews';
import { formatPhone } from '@/shared/phone';

/** The subset of a coupon row this dialog needs to offer one. */
interface PersonalCoupon {
  code: string;
  type: string;
  value: number;
  minSubtotal: number;
  customerCount: number;
}

export interface GrantCouponTarget {
  uid: string;
  phone: string;
  fullName: string;
}

/** How long a coupon made here is good for, unless the admin says otherwise. */
const DEFAULT_DAYS = '30';

export function GrantCouponDialog({
  target,
  onClose,
  onGranted,
}: {
  target: GrantCouponTarget | null;
  onClose: () => void;
  onGranted: (code: string) => void;
}) {
  const t = useT();

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [existing, setExisting] = useState<PersonalCoupon[] | null>(null);
  const [chosen, setChosen] = useState('');

  const [type, setType] = useState<string>(CouponType.FIXED);
  const [value, setValue] = useState('5.00');
  const [minSubtotal, setMinSubtotal] = useState('10.00');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [reason, setReason] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = target !== null;

  /*
   * The personal coupons that already exist, loaded when the dialog opens.
   *
   * Filtered here rather than server-side because `listCoupons` is the one
   * campaign read the admin screens share, and "which of these is a personal
   * coupon" is answerable from what it already returns: a coupon with names on
   * it. A public campaign must never appear in this list — adding a name to one
   * would take it away from everybody else, and the server refuses it anyway.
   */
  useEffect(() => {
    if (!open) return;

    let live = true;

    // Nothing is cleared before the fetch: a list left over from the last time
    // this dialog was opened is still the right list, and clearing it here
    // would be a setState inside an effect body, which this codebase treats as
    // an error rather than a style preference.
    void listCoupons().then((result) => {
      if (!live) return;
      if (!result.ok) {
        setExisting([]);
        return;
      }

      setExisting(
        (result.data?.coupons ?? [])
          .filter((coupon) => coupon.active === true)
          .map((coupon) => ({
            code: text(coupon.code),
            type: text(coupon.type),
            value: Number(coupon.value ?? 0),
            minSubtotal: Number(coupon.minSubtotal ?? 0),
            customerCount: list(coupon.allowedUserIds).length,
          }))
          .filter((coupon) => coupon.customerCount > 0),
      );
    });

    return () => {
      live = false;
    };
  }, [open]);

  const reset = () => {
    setMode('new');
    setChosen('');
    setType(CouponType.FIXED);
    setValue('5.00');
    setMinSubtotal('10.00');
    setMaxDiscount('');
    setDays(DEFAULT_DAYS);
    setReason('');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!target) return;

    setBusy(true);
    setError(null);

    if (mode === 'existing') {
      const result = await grantCustomerCoupon({ customerId: target.uid, code: chosen, reason });
      setBusy(false);

      if (!result.ok) {
        setError(translateError(t, result.errorCode, result.errorDetail));
        return;
      }

      onGranted(result.data?.code ?? '');
      close();
      return;
    }

    let amount: number;
    let minimum: number;
    let cap: number | null = null;

    try {
      // A percentage is basis points; everything else is money in qəpik. The
      // same conversion the campaign screen does, because the server stores the
      // same field either way.
      amount =
        type === CouponType.PERCENT
          ? Math.round(Number(value) * 100)
          : type === CouponType.FREE_DELIVERY
            ? 0
            : parseMajorUnits(value);
      minimum = parseMajorUnits(minSubtotal || '0');
      if (maxDiscount.trim()) cap = parseMajorUnits(maxDiscount);
    } catch {
      setBusy(false);
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }

    const now = Date.now();
    const result = await grantCustomerCoupon({
      customerId: target.uid,
      type,
      value: amount,
      minSubtotal: minimum,
      maxDiscount: cap,
      validFrom: now,
      validUntil: now + Number(days) * 24 * 60 * 60 * 1000,
      reason,
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    onGranted(result.data?.code ?? '');
    close();
  };

  const valid =
    mode === 'existing'
      ? chosen.length > 0
      : Number(days) > 0 && (type === CouponType.FREE_DELIVERY || Number(value) > 0);

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('admin.grantCouponTitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={!valid} onClick={() => void submit()}>
            <Ticket size={15} /> {t('admin.grantCouponConfirm')}
          </Button>
        </div>
      }
    >
      {target && (
        <div className="space-y-4">
          {/* Phone and short name. Never the full legal name — see the note at
              the top of the file. */}
          <div className="rounded-xl border border-card-edge bg-subtle px-4 py-3">
            <p className="font-medium text-ink-900">{displayName(target.fullName)}</p>
            <p className="tabular-nums text-sm text-ink-600">{formatPhone(target.phone)}</p>
          </div>

          <div className="flex gap-2" role="tablist">
            {(['new', 'existing'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={mode === option}
                onClick={() => setMode(option)}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm transition',
                  mode === option
                    ? 'bg-brand-600 text-white'
                    : 'border border-card-edge bg-surface text-ink-600',
                )}
              >
                {t(option === 'new' ? 'admin.grantCouponNew' : 'admin.grantCouponExisting')}
              </button>
            ))}
          </div>

          {mode === 'existing' ? (
            existing === null ? (
              <InlineSpinner />
            ) : existing.length === 0 ? (
              <Alert tone="info">{t('admin.grantCouponNoneExisting')}</Alert>
            ) : (
              <Select
                label={t('admin.grantCouponPick')}
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
              >
                <option value="">{t('admin.grantCouponPickNone')}</option>
                {existing.map((coupon) => (
                  <option key={coupon.code} value={coupon.code}>
                    {coupon.code} ·{' '}
                    {coupon.type === CouponType.PERCENT
                      ? `${coupon.value / 100}%`
                      : coupon.type === CouponType.FREE_DELIVERY
                        ? t('admin.FREE_DELIVERY')
                        : `${(coupon.value / 100).toFixed(2)} ₼`}{' '}
                    · {t('admin.grantCouponHolders', { count: coupon.customerCount })}
                  </option>
                ))}
              </Select>
            )
          ) : (
            <>
              <Select
                label={t('admin.couponType')}
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                {[CouponType.FIXED, CouponType.PERCENT, CouponType.FREE_DELIVERY].map((option) => (
                  <option key={option} value={option}>
                    {t(`admin.${option}`)}
                  </option>
                ))}
              </Select>

              {type !== CouponType.FREE_DELIVERY && (
                <Input
                  label={t('admin.couponValue')}
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              )}

              {type === CouponType.PERCENT && (
                <Input
                  label={t('admin.maxDiscount')}
                  inputMode="decimal"
                  value={maxDiscount}
                  onChange={(event) => setMaxDiscount(event.target.value)}
                  hint={t('admin.maxDiscountHint')}
                />
              )}

              <Input
                label={t('admin.minSubtotal')}
                inputMode="decimal"
                value={minSubtotal}
                onChange={(event) => setMinSubtotal(event.target.value)}
                hint={t('admin.minSubtotalHint')}
              />

              <Input
                label={t('admin.couponDays')}
                inputMode="numeric"
                value={days}
                onChange={(event) => setDays(event.target.value)}
                hint={t('admin.couponDaysHint')}
              />

              <p className="text-xs text-ink-500">
                {t('admin.grantCouponExplainer')}
                {type === CouponType.FIXED && Number(value) > 0 && (
                  <>
                    {' '}
                    <Money amount={parseMajorUnits(value || '0')} />
                  </>
                )}
              </p>
            </>
          )}

          <Input
            label={t('admin.couponEditReason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            hint={t('admin.reasonAudited')}
          />

          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Sheet>
  );
}
