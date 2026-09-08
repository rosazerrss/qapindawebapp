'use client';

/**
 * The platform settings, one area at a time.
 *
 * WHY THIS IS A COMPONENT AND NOT A PAGE
 * --------------------------------------
 * "AYARLARA GİRDİKDƏ QARIŞIQLIQ OLMASIN — AYRICA PƏNCƏRƏLƏR AÇILSIN." Everything
 * here used to be one column with a single "Yadda saxla" at the foot of it: the
 * commission rate, the response window, the support number, maintenance mode,
 * the bank account and the button that deletes the platform's test data, all in
 * a row. Two things are wrong with that. The obvious one is that it cannot be
 * read. The dangerous one is that one Save button covered all of it, so
 * somebody who came to change a phone number saved a commission rate they had
 * only been looking at.
 *
 * So each area is now its own screen with its own Save, reached from an index
 * of cards, and this component is the one place that knows how to load, edit
 * and save the settings document. `section` says which part of it to draw. The
 * alternative — six pages each with their own copy of the form — is six places
 * for the validation to drift apart.
 *
 * WHAT THE DEFAULTS HERE APPLY TO
 * -------------------------------
 * New restaurants and new orders only. Changing the default commission does not
 * move a rate already agreed with a restaurant, and it certainly does not
 * reprice an order that has already been placed — every order froze its own
 * rate at checkout.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { PlatformReset } from '@/components/panel/PlatformReset';
import { SearchBackfill } from '@/components/panel/SearchBackfill';
import { CounterBackfill } from '@/components/panel/CounterBackfill';
import { StatusBadge } from '@/components/panel/ui';
import { useToast } from '@/components/panel/Toast';
import { Alert, Button, Card, Input, Loading, Switch, Textarea, cn } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { FOOD_CATEGORIES } from '@/shared/categories';
import {
  CUSTOMER_CANCEL_WINDOW_MINUTES,
  MAX_CANCEL_WINDOW_MINUTES,
  MIN_CANCEL_WINDOW_MINUTES,
} from '@/shared/orderState';
import { updatePublicSettings } from '@/firebase/callables';
import { formatIban, isValidIban, looksLikeCardNumber, normaliseIban } from '@/shared/bank';
import { firestore } from '@/firebase/client';
import { paths } from '@/shared/collections';
import { formatBps } from '@/shared/pricing';
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  PaymentMethod,
  V1_PAYMENT_METHODS,
} from '@/shared/enums';
import { DELIVERY_CODE_POLICY, deliveryCodePolicyOf } from '@/shared/deliveryCode';
import type { PublicSettings } from '@/shared/models';

/** The areas, in the order the index lists them. */
export type AdminSettingsSectionId =
  | 'general'
  | 'timing'
  | 'support'
  | 'platform'
  | 'payments'
  | 'bank'
  | 'danger';

/**
 * The form's own shape.
 *
 * Deliberately loose — this one component edits five unrelated settings
 * sections — but not so loose that a list of ids has to be cast at every read.
 * `string[]` covers both the payment methods and the category row.
 */
type FormValues = Record<string, string | boolean | string[] | PaymentMethod[]>;

/**
 * Epoch millis → the `YYYY-MM-DDTHH:mm` a `datetime-local` input expects.
 *
 * `toISOString` would be an hour or four wrong for the person typing, because
 * it is UTC and the admin is sitting in Baku; subtracting the offset first
 * makes the box show the wall-clock time they meant.
 */
function toLocalInput(millis: number): string {
  const at = new Date(millis - new Date(millis).getTimezoneOffset() * 60_000);
  return at.toISOString().slice(0, 16);
}

/** The reverse, with an empty box meaning "no promise" rather than epoch zero. */
function fromLocalInput(value: string): number | null {
  if (!value.trim()) return null;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
}

function seedFrom(data: PublicSettings | null): FormValues {
  return {
    city: data?.city ?? 'Bakı',
    defaultCommissionRateBps: String((data?.defaultCommissionRateBps ?? 1200) / 100),
    defaultResponseWindowMinutes: String(data?.defaultResponseWindowMinutes ?? 10),
    autoCompleteAfterMinutes: String(data?.autoCompleteAfterMinutes ?? 60),
    // The shared default answers for a settings document written before this
    // field existed, which is every one of them.
    customerCancelWindowMinutes: String(
      data?.customerCancelWindowMinutes ?? CUSTOMER_CANCEL_WINDOW_MINUTES,
    ),
    // Empty means "show them all", which is what an untouched platform says.
    homeCategories: data?.homeCategories ?? [],
    supportPhone: data?.supportPhone ?? '',
    supportEmail: data?.supportEmail ?? '',
    supportCallEnabled: data?.supportCallEnabled ?? false,
    maintenanceMode: data?.maintenanceMode ?? false,
    maintenanceMessage: data?.maintenanceMessage ?? '',
    /*
     * The "back by" time, as the browser's own datetime-local wants it.
     *
     * Stored as epoch millis and edited as a local wall-clock string, which is
     * the one conversion this form has to do — the admin thinks in "tonight at
     * nine", and the settings document has to hold something a server in
     * another timezone reads the same way.
     */
    maintenanceUntil: data?.maintenanceUntil ? toLocalInput(data.maintenanceUntil) : '',
    maintenanceReason: '',
    acceptingNewRestaurants: data?.acceptingNewRestaurants ?? true,
    // Absent means ALWAYS. `deliveryCodePolicyOf` says so and the server says
    // so; reading it through that function rather than defaulting here keeps
    // the three in step.
    deliveryCodePolicy: deliveryCodePolicyOf(data ?? {}),
    testDataResetEnabled: data?.testDataResetEnabled ?? false,
    enabledPaymentMethods: data?.enabledPaymentMethods ?? [...DEFAULT_ENABLED_PAYMENT_METHODS],
    bankAccountHolder: data?.platformBankAccount?.accountHolder ?? '',
    bankIban: data?.platformBankAccount ? formatIban(data.platformBankAccount.iban) : '',
    bankName: data?.platformBankAccount?.bankName ?? '',
    bankNote: data?.platformBankAccount?.note ?? '',
  };
}

export function AdminSettingsSection({ section }: { section: AdminSettingsSectionId }) {
  const t = useT();
  const toast = useToast();

  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [form, setForm] = useState<FormValues | null>(null);
  // The listener has an error handler, because a refused read used to leave
  // `form` null and the whole screen on a spinner that could never stop. It
  // seeds from the defaults and says what happened, since an admin locked out
  // of Ayarlar cannot even reach the switch that would let them fix it.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    const db = firestore();
    if (!db) return;

    // Seeded once, so typing is never overwritten by the live listener.
    const seed = (data: PublicSettings | null) =>
      setForm((current) => current ?? seedFrom(data));

    return onSnapshot(
      doc(db, paths.publicSettings()),
      (snapshot) => {
        const data = (snapshot.data() as PublicSettings | undefined) ?? null;
        setSettings(data);
        setLoadError(null);
        seed(data);
      },
      () => {
        setLoadError(t('errors.LIST_UNAVAILABLE'));
        seed(null);
      },
    );
  }, [t]);

  if (!form) return <Loading />;

  const patch = (values: FormValues) => setForm((current) => ({ ...current!, ...values }));

  const methods = form.enabledPaymentMethods as PaymentMethod[];

  const ibanTyped = String(form.bankIban).trim();
  const ibanLooksLikeCard = ibanTyped.length > 0 && looksLikeCardNumber(ibanTyped);
  const ibanInvalid = ibanTyped.length > 0 && !ibanLooksLikeCard && !isValidIban(ibanTyped);
  const bankAccountReady =
    ibanTyped.length > 0 &&
    !ibanInvalid &&
    !ibanLooksLikeCard &&
    String(form.bankAccountHolder).trim().length >= 2 &&
    String(form.bankName).trim().length >= 2;

  /*
   * Saves ONLY this section's fields.
   *
   * `updatePublicSettings` reads each field independently and leaves out what
   * it was not sent, so a screen that posts three keys changes three settings.
   * That is what makes "one area, one Save" honest rather than cosmetic: an
   * admin on the support screen cannot save a commission rate they never saw.
   */
  const payloadFor = (): Record<string, unknown> => {
    switch (section) {
      case 'general':
        return {
          city: form.city,
          defaultCommissionRateBps: Math.round(Number(form.defaultCommissionRateBps) * 100),
        };
      case 'timing':
        return {
          defaultResponseWindowMinutes: Number(form.defaultResponseWindowMinutes),
          autoCompleteAfterMinutes: Number(form.autoCompleteAfterMinutes),
          customerCancelWindowMinutes: Number(form.customerCancelWindowMinutes),
          homeCategories: form.homeCategories as string[],
        };
      case 'support':
        return {
          supportPhone: form.supportPhone,
          supportEmail: form.supportEmail,
          supportCallEnabled: form.supportCallEnabled,
        };
      case 'platform':
        return {
          maintenanceMode: form.maintenanceMode,
          // Sent every time, so that clearing the box clears the notice rather
          // than leaving last month's explanation on the shopfront.
          maintenanceMessage: String(form.maintenanceMessage).trim() || null,
          maintenanceUntil: fromLocalInput(String(form.maintenanceUntil)),
          maintenanceReason: String(form.maintenanceReason).trim() || null,
          acceptingNewRestaurants: form.acceptingNewRestaurants,
          deliveryCodePolicy: form.deliveryCodePolicy,
        };
      case 'payments':
        return { enabledPaymentMethods: methods };
      case 'bank':
        // Sent only once all three fields are filled in: a half-typed account is
        // worse than none, because it is shown to every restaurant that owes
        // money as the place to send it.
        return bankAccountReady
          ? {
              platformBankAccount: {
                accountHolder: String(form.bankAccountHolder).trim(),
                iban: normaliseIban(String(form.bankIban)),
                bankName: String(form.bankName).trim(),
                note: String(form.bankNote).trim() || null,
              },
            }
          : {};
      case 'danger':
        return { testDataResetEnabled: form.testDataResetEnabled };
    }
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);

    const result = await updatePublicSettings(payloadFor());

    setBusy(false);

    if (!result.ok) {
      setMessage({ tone: 'danger', text: translateError(t, result.errorCode, result.errorDetail) });
      return;
    }

    // The toast confirms; the inline alert stays for anyone who looked away.
    setMessage({ tone: 'success', text: t('admin.settingsSaved') });
    toast.show(t('admin.settingsSaved'));
  };

  return (
    <div className="max-w-2xl space-y-4">
      {section === 'general' && (
        <Card className="p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t('account.city')}
              value={String(form.city)}
              onChange={(event) => patch({ city: event.target.value })}
            />
            <Input
              label={`${t('admin.commissionRate')} (%)`}
              value={String(form.defaultCommissionRateBps)}
              onChange={(event) => patch({ defaultCommissionRateBps: event.target.value })}
              inputMode="decimal"
              hint={formatBps(Math.round(Number(form.defaultCommissionRateBps || 0) * 100))}
            />
          </div>
          <div className="mt-4">
            <Alert tone="info">{t('admin.commissionScopeNote')}</Alert>
          </div>
        </Card>
      )}

      {section === 'timing' && (
        <Card className="p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t('admin.responseWindow')}
              value={String(form.defaultResponseWindowMinutes)}
              onChange={(event) => patch({ defaultResponseWindowMinutes: event.target.value })}
              inputMode="numeric"
              hint={t('admin.responseWindowHint')}
            />
            <Input
              label={t('admin.autoComplete')}
              value={String(form.autoCompleteAfterMinutes)}
              onChange={(event) => patch({ autoCompleteAfterMinutes: event.target.value })}
              inputMode="numeric"
              hint={t('admin.autoCompleteHint')}
            />
            {/* The platform's own cancellation policy, which used to require a
                developer and a deploy to change. */}
            <Input
              label={t('admin.cancelWindow')}
              value={String(form.customerCancelWindowMinutes)}
              onChange={(event) => patch({ customerCancelWindowMinutes: event.target.value })}
              inputMode="numeric"
              hint={t('admin.cancelWindowHint', {
                min: MIN_CANCEL_WINDOW_MINUTES,
                max: MAX_CANCEL_WINDOW_MINUTES,
              })}
            />
          </div>

          {/*
            * WHICH CATEGORIES THE HOME SCREEN SHOWS.
            *
            * The categories themselves stay in code — each needs an emoji,
            * search aliases and three translations, which is a commit rather
            * than a form. What changes with the city is which of them are worth
            * showing: a row of eleven icons where four lead to empty screens is
            * the complaint this answers.
            *
            * Nothing selected means all of them, in the code's order, which is
            * both the default and the answer if this is ever cleared.
            */}
          <div className="mt-5 border-t border-card-edge pt-4">
            <h3 className="text-[15px] font-semibold text-ink-900">
              {t('admin.homeCategories')}
            </h3>
            <p className="mt-0.5 text-sm text-ink-500">{t('admin.homeCategoriesHint')}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              {FOOD_CATEGORIES.map((category) => {
                const picked = (form.homeCategories as string[]) ?? [];
                const at = picked.indexOf(category.id);
                const chosen = at >= 0;

                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() =>
                      patch({
                        // Appended rather than inserted, so the order on screen
                        // is the order they were picked in — which is the only
                        // ordering control this needs.
                        homeCategories: chosen
                          ? picked.filter((id) => id !== category.id)
                          : [...picked, category.id],
                      })
                    }
                    className={cn(
                      'flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition',
                      chosen
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-card-edge bg-surface text-ink-600 hover:bg-ink-50',
                    )}
                  >
                    <span aria-hidden>{category.emoji}</span>
                    {t(`categories.${category.id}`)}
                    {chosen && <span className="text-xs text-brand-500">{at + 1}</span>}
                  </button>
                );
              })}
            </div>

            {(form.homeCategories as string[]).length === 0 && (
              <p className="mt-2 text-xs text-ink-400">{t('admin.homeCategoriesAll')}</p>
            )}
          </div>
        </Card>
      )}

      {section === 'support' && (
        <Card className="p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t('admin.supportPhone')}
              value={String(form.supportPhone)}
              onChange={(event) => patch({ supportPhone: event.target.value })}
            />
            <Input
              label={t('admin.supportEmail')}
              value={String(form.supportEmail)}
              onChange={(event) => patch({ supportEmail: event.target.value })}
            />
          </div>

          {/*
            The phone-support switch.

            Off by default, and it stays off until somebody here decides
            otherwise — whether "Dəstəyə zəng et" appears at all is the admin's
            call. The customer and restaurant screens additionally require a
            number before they draw it, so turning this on with the field above
            empty changes nothing, which is why the hint says so rather than
            letting somebody wonder.
          */}
          <div className="mt-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[15px] text-ink-800">{t('admin.supportCallEnabled')}</p>
              <p className="mt-0.5 text-sm text-ink-400">
                {String(form.supportPhone).trim()
                  ? t('admin.supportCallEnabledHint')
                  : t('admin.supportCallNeedsNumber')}
              </p>
            </div>
            <Switch
              checked={Boolean(form.supportCallEnabled)}
              onChange={(next) => patch({ supportCallEnabled: next })}
              label={t('admin.supportCallEnabled')}
            />
          </div>
        </Card>
      )}

      {section === 'platform' && (
        <Card className="divide-y divide-row-edge p-0">
          <SwitchRow
            label={t('admin.acceptingNewRestaurants')}
            hint={t('admin.acceptingNewRestaurantsHint')}
            checked={Boolean(form.acceptingNewRestaurants)}
            onChange={(next) => patch({ acceptingNewRestaurants: next })}
          />
          {/*
            The handover code, as a platform decision.
            
            A switch rather than a two-item dropdown, because there are exactly
            two answers and one of them is "the platform decides" — which is
            what being ON means. Off hands the question back to each restaurant,
            which is what this product did before and is still a legitimate
            answer for a platform whose restaurants all know their own drivers.
          */}
          <SwitchRow
            label={t('admin.deliveryCodeAlways')}
            hint={t('admin.deliveryCodeAlwaysHint')}
            checked={form.deliveryCodePolicy === DELIVERY_CODE_POLICY.ALWAYS}
            onChange={(next) =>
              patch({
                deliveryCodePolicy: next
                  ? DELIVERY_CODE_POLICY.ALWAYS
                  : DELIVERY_CODE_POLICY.RESTAURANT_CHOICE,
              })
            }
          />
          <SwitchRow
            label={t('admin.maintenanceMode')}
            hint={t('admin.maintenanceModeHint')}
            checked={Boolean(form.maintenanceMode)}
            onChange={(next) => patch({ maintenanceMode: next })}
          />

          {/* The explanation only appears once the platform is actually being
              closed. Three empty boxes under an off switch are three questions
              nobody has asked yet. */}
          {Boolean(form.maintenanceMode) && (
            <div className="space-y-4 p-4">
              <Alert tone="warning">{t('admin.maintenanceWarning')}</Alert>

              <Textarea
                label={t('admin.maintenanceMessage')}
                value={String(form.maintenanceMessage)}
                onChange={(event) => patch({ maintenanceMessage: event.target.value })}
                maxLength={400}
                hint={t('admin.maintenanceMessageHint')}
              />

              <Input
                type="datetime-local"
                label={t('admin.maintenanceUntil')}
                value={String(form.maintenanceUntil)}
                onChange={(event) => patch({ maintenanceUntil: event.target.value })}
                hint={t('admin.maintenanceUntilHint')}
              />

              <Input
                label={t('admin.maintenanceReason')}
                value={String(form.maintenanceReason)}
                onChange={(event) => patch({ maintenanceReason: event.target.value })}
                maxLength={300}
                hint={t('admin.maintenanceReasonHint')}
              />
            </div>
          )}
        </Card>
      )}

      {section === 'payments' && (
        <Card className="p-4">
          {/*
            What checkout may offer, as a decision rather than a status board.

            This section used to READ a constant and report it, which meant it
            announced online card as "available" on a platform with no payment
            provider — and a customer who chose it met a refusal after filling
            their basket. The switches now write `enabledPaymentMethods`, and
            the server refuses to turn online card on while there is nothing
            behind it. So the screen cannot advertise a payment that does not
            work.
          */}
          <div className="divide-y divide-row-edge">
            {V1_PAYMENT_METHODS.map((method) => {
              const on = methods.includes(method);
              const last = on && methods.length === 1;

              return (
                <SwitchRow
                  key={method}
                  label={t(`checkout.${method}`)}
                  hint={
                    method === PaymentMethod.ONLINE_CARD
                      ? t('admin.paymentOnlineHint')
                      : last
                        ? t('admin.paymentLastOne')
                        : undefined
                  }
                  checked={on}
                  // The platform must keep accepting money somehow. Turning the
                  // last method off is not a setting, it is an outage.
                  disabled={last}
                  onChange={(next) =>
                    patch({
                      enabledPaymentMethods: next
                        ? [...methods, method]
                        : methods.filter((entry) => entry !== method),
                    })
                  }
                />
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {V1_PAYMENT_METHODS.map((method) => (
              <StatusBadge key={method} tone={methods.includes(method) ? 'success' : 'neutral'}>
                {t(`checkout.${method}`)}
              </StatusBadge>
            ))}
          </div>
        </Card>
      )}

      {section === 'bank' && (
        <Card className="p-4">
          {/* Where restaurants that owe commission send it. It appears verbatim
              on their settlement screen, so a typo here is a month of transfers
              landing nowhere — hence the check digits are verified before it
              can be saved. Bank details only; a card number is refused. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t('settlement.accountHolder')}
              value={String(form.bankAccountHolder)}
              onChange={(event) => patch({ bankAccountHolder: event.target.value })}
              maxLength={120}
            />
            <Input
              label={t('settlement.iban')}
              value={String(form.bankIban)}
              onChange={(event) => patch({ bankIban: event.target.value })}
              maxLength={42}
              placeholder="AZ00 XXXX 0000 0000 0000 0000 0000"
            />
            <Input
              label={t('settlement.bankName')}
              value={String(form.bankName)}
              onChange={(event) => patch({ bankName: event.target.value })}
              maxLength={120}
            />
            <Input
              label={t('settlement.paymentNote')}
              value={String(form.bankNote)}
              onChange={(event) => patch({ bankNote: event.target.value })}
              maxLength={200}
            />
          </div>

          {ibanLooksLikeCard && (
            <div className="mt-3">
              <Alert tone="danger">{t('settlement.cardNotAllowed')}</Alert>
            </div>
          )}
          {ibanInvalid && (
            <div className="mt-3">
              <Alert tone="warning">{t('settlement.ibanInvalid')}</Alert>
            </div>
          )}
        </Card>
      )}

      {section === 'danger' && (
        <Card className="p-4">
          {/*
            The pre-launch reset, and the switch that lets it run at all.

            On a screen of its own, because it is the only thing in Ayarlar that
            destroys data rather than changing a default. The switch and the
            button are deliberately not the same control: the switch is a
            setting, saved with "Yadda saxla" and recorded in the audit log, and
            it is what stops a mis-aimed click on a live platform from being
            able to do anything at all. Turn it off again the day real customers
            arrive.
          */}
          <div className="space-y-4">
            <SwitchRow
              label={t('admin.testDataResetEnabled')}
              hint={t('admin.testDataResetEnabledHint')}
              checked={Boolean(form.testDataResetEnabled)}
              onChange={(next) => patch({ testDataResetEnabled: next })}
            />

            {/* Shown only once the setting on the SERVER says so — not once the
                switch above is moved. An unsaved switch has changed nothing,
                and offering the button before "Yadda saxla" would teach the
                owner that the guard is decorative. */}
            {settings?.testDataResetEnabled !== true && (
              <Alert tone="info">{t('admin.testDataResetSaveFirst')}</Alert>
            )}

            {/* Above the reset, and separated from it: this one is a
                maintenance task that destroys nothing, and it must not read as
                part of the switch-guarded machinery below it. */}
            <div className="border-t border-card-edge pt-4">
              <SearchBackfill />
              <CounterBackfill />
            </div>

            <div className="border-t border-card-edge pt-4">
              <PlatformReset enabled={settings?.testDataResetEnabled === true} />
            </div>
          </div>
        </Card>
      )}

      {loadError && <Alert tone="danger">{loadError}</Alert>}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {settings === null && !loadError && <Alert tone="warning">{t('admin.settingsMissing')}</Alert>}

      {/* One Save, and it belongs to this screen alone. Disabled while the
          request is in flight, so a second tap cannot post the form twice. */}
      <Button loading={busy} disabled={busy} onClick={() => void save()}>
        {t('common.save')}
      </Button>
    </div>
  );
}

/** One setting, one sentence about it, one switch. 44px minimum. */
function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex min-h-[56px] items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] text-ink-800">{label}</p>
        {hint && <p className="mt-0.5 text-sm text-ink-400">{hint}</p>}
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} label={label} />
    </div>
  );
}
