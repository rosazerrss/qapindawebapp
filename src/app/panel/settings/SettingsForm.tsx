'use client';

/**
 * The shopfront settings a restaurant owns, one area at a time.
 *
 * WHY THIS IS A COMPONENT AND NOT A PAGE
 * --------------------------------------
 * "AYARLARA GİRDİKDƏ QARIŞIQLIQ OLMASIN — AYRICA PƏNCƏRƏLƏR AÇILSIN ONLARIN
 * DAXİLİNƏ GİRİB HƏRŞEY ETMƏK OLSUN." This was one page: two photographs, the
 * shop name, a map, a radius slider, delivery pricing, payment methods, seven
 * rows of opening hours and a language picker, under a single "Yadda saxla".
 * An owner who came to change a phone number scrolled past all of it, and the
 * one Save button at the bottom saved every field on the screen — including
 * ones they had only been looking at.
 *
 * Now each area is its own screen with its own Save, reached from an index of
 * cards, and this component is the single place that knows how to load, edit
 * and save the restaurant. `section` says which part to draw.
 *
 * WHY EACH SCREEN POSTS ONLY ITS OWN FIELDS
 * -----------------------------------------
 * `updateRestaurantProfile` reads every field independently and leaves out what
 * it was not sent, so a screen that posts three keys changes three settings and
 * nothing else. That is what makes "one area, one Save" true rather than merely
 * tidy.
 *
 * Notably absent from all of it: the commission rate and the approval status.
 * Those live in the private subdocument and only the platform can move them — a
 * restaurant that could set its own commission would not be a marketplace.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';

import { useToast } from '@/components/panel/Toast';
import { Alert, Button, Card, Input, Loading, Select, Switch, Textarea } from '@/components/ui';
import { DeliveryMap, type MapPoint } from '@/components/restaurant/DeliveryMap';
import { ImageUpload } from '@/components/restaurant/ImageUpload';
import { CategoryPicker } from '@/components/restaurant/CategoryPicker';
import { CuisinePicker } from '@/components/restaurant/CuisinePicker';
import { PrintStationEditor } from '@/components/restaurant/PrintStationEditor';
import { districtsOf, orderedRegions } from '@/shared/regions';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import { updateRestaurantProfile } from '@/firebase/callables';
import { getRestaurant } from '@/services/catalog';
import { formatMinorUnits, parseMajorUnits } from '@/shared/pricing';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { paths } from '@/shared/collections';
import { PaymentMethod, V1_PAYMENT_METHODS } from '@/shared/enums';
import { restaurantCategories, type FoodCategoryId } from '@/shared/categories';
import { normaliseCuisines, type CuisineId } from '@/shared/cuisines';
import { normaliseStations, type PrintStation } from '@/shared/printStations';
import { DeliveryZoneEditor } from '@/components/restaurant/DeliveryZoneEditor';
import { OpeningHoursEditor } from '@/components/restaurant/OpeningHoursEditor';
import type { DeliveryZone } from '@/shared/geo';
import { restaurantMayDisableCodes } from '@/shared/deliveryCode';
import type { OpeningHours, PublicSettings, Restaurant } from '@/shared/models';

/**
 * The restaurant's own identifier, read-only and copyable.
 *
 * Two restaurants may legitimately carry the same name — a chain, or simply a
 * coincidence — and the Firestore document id is the only thing that tells them
 * apart. It is also the tail of the public address (`/restaurant/<slug>-<id>`),
 * which is why a renamed restaurant keeps its old links working, so an owner
 * asking support "which one is mine" has exactly this string to quote.
 */
function RestaurantIdField({
  restaurantId,
  label,
  hint,
  copyLabel,
  onCopied,
}: {
  restaurantId: string;
  label: string;
  hint: string;
  copyLabel: string;
  onCopied: () => void;
}) {
  const copy = async () => {
    // Clipboard access is refused outside a secure context and on some
    // in-app browsers; failing silently is better than an error the owner
    // cannot act on, since the value is on screen to read anyway.
    try {
      await navigator.clipboard.writeText(restaurantId);
      onCopied();
    } catch {
      /* ignored */
    }
  };

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink-700">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-2.5 font-mono text-sm text-ink-700">
          {restaurantId}
        </code>
        <Button variant="secondary" onClick={() => void copy()}>
          <Copy size={15} /> {copyLabel}
        </Button>
      </div>
      <span className="mt-1.5 block text-sm text-ink-400">{hint}</span>
    </div>
  );
}

/** A titled block of the form. The heading is what makes the page scannable. */
function Section({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3">
        <h2 className="font-medium text-ink-900">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-ink-400">{hint}</p>}
      </div>
      <div className={className ?? 'space-y-4'}>{children}</div>
    </Card>
  );
}

/** The areas, in the order the index lists them. */
export type RestaurantSettingsSectionId =
  | 'images'
  | 'profile'
  | 'location'
  | 'delivery'
  | 'payments'
  | 'deliveryCode'
  | 'printers'
  | 'hours';

export function RestaurantSettingsSection({
  section,
}: {
  section: RestaurantSettingsSectionId;
}) {
  const t = useT();
  const toast = useToast();
  const { restaurantId } = useAuth();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [form, setForm] = useState<{
    name: string;
    tagline: string;
    publicPhone: string;
    regionId: string;
    district: string;
    addressLine: string;
    cuisines: CuisineId[];
    categories: FoodCategoryId[];
    minOrderAmount: string;
    deliveryFee: string;
    freeDeliveryThreshold: string;
    estimatedMinutesMin: string;
    estimatedMinutesMax: string;
    deliveryRadiusMeters: string;
    deliveryZones: DeliveryZone[];
    paymentMethods: string[];
    openingHours: OpeningHours[];
    requireDeliveryCode: boolean;
    printStations: PrintStation[];
  } | null>(null);

  const [point, setPoint] = useState<MapPoint | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whether the platform itself accepts online card right now. Read once —
  // this changes about twice a year, and a live listener would be a connection
  // held open to learn nothing.
  const platformAllowsOnline = (settings?.enabledPaymentMethods ?? []).includes(
    PaymentMethod.ONLINE_CARD,
  );

  useEffect(() => {
    const db = firestore();
    if (!db) return;

    let cancelled = false;
    void getDoc(doc(db, paths.publicSettings())).then((snapshot) => {
      if (!cancelled) setSettings(snapshot.exists() ? (snapshot.data() as PublicSettings) : null);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!restaurantId) return;
    getRestaurant(restaurantId).then((found) => {
      if (!found) return;
      setRestaurant(found);
      setPoint(found.lat !== null && found.lng !== null ? { lat: found.lat, lng: found.lng } : null);
      setLogoUrl(found.logoUrl);
      setCoverUrl(found.coverUrl);
      setForm({
        name: found.name,
        tagline: found.tagline,
        publicPhone: found.publicPhone ?? '',
        regionId: found.regionId ?? 'baku',
        district: found.district ?? '',
        addressLine: found.addressLine,
        /*
         * Only the ids the picker can represent.
         *
         * A restaurant whose stored value is still free text opens with nothing
         * ticked, and `CuisinePicker` shows those words above the tiles rather
         * than letting them disappear without a word.
         */
        cuisines: normaliseCuisines(found.cuisines),
        // A restaurant that has never seen this control still gets the tiles
        // its cuisine text implies, so opening the page and pressing save does
        // not silently narrow where it appears.
        categories: restaurantCategories(found),
        minOrderAmount: formatMinorUnits(found.minOrderAmount),
        deliveryFee: formatMinorUnits(found.deliveryFee),
        freeDeliveryThreshold:
          found.freeDeliveryThreshold === null ? '' : formatMinorUnits(found.freeDeliveryThreshold),
        estimatedMinutesMin: String(found.estimatedMinutesMin),
        estimatedMinutesMax: String(found.estimatedMinutesMax),
        deliveryRadiusMeters: String(found.deliveryRadiusMeters),
        // Absent on every restaurant that predates zones, which is all of them.
        deliveryZones: found.deliveryZones ?? [],
        paymentMethods: [...found.paymentMethods],
        openingHours: found.openingHours,
        requireDeliveryCode: Boolean(found.requireDeliveryCode),
        // Absent means "nothing configured", which the printer treats as the
        // single whole receipt it printed before stations existed.
        printStations: normaliseStations(found.printStations),
      });
    });
  }, [restaurantId]);

  if (!form || !restaurant) return <Loading />;

  const patch = (values: Partial<typeof form>) =>
    setForm((current) => (current ? { ...current, ...values } : current));

  /*
   * Is the handover code the platform's decision rather than this restaurant's?
   *
   * `restaurantMayDisableCodes` is the same function the server consults, so a
   * switch that looks usable and a save that is ignored cannot happen.
   */
  const locked = !restaurantMayDisableCodes(settings ?? {});

  const save = async () => {
    if (!restaurantId) return;

    setBusy(true);
    setError(null);

    /*
     * Only what this screen actually shows.
     *
     * `parseMajorUnits` throws on anything that is not a clean amount, which is
     * why the money fields are built inside the try: a typo in "12,5,0" must
     * become "Məlumatlar düzgün deyil" rather than an unhandled rejection.
     */
    let payload: Record<string, unknown>;
    try {
      payload = { restaurantId, ...fieldsFor(section) };
    } catch {
      setBusy(false);
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }

    const result = await updateRestaurantProfile(payload);
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    toast.show(t('restaurantPanel.doneSettingsSaved'));
  };


  /** The fields one screen owns, and nothing else. */
  function fieldsFor(area: RestaurantSettingsSectionId): Record<string, unknown> {
    switch (area) {
      case 'images':
        return { logoUrl, coverUrl };
      case 'profile':
        return {
          name: form!.name.trim(),
          tagline: form!.tagline.trim(),
          publicPhone: form!.publicPhone.trim(),
          cuisines: form!.cuisines,
          categories: form!.categories,
        };
      case 'location':
        return {
          regionId: form!.regionId,
          district: districtsOf(form!.regionId).length > 0 ? form!.district : null,
          addressLine: form!.addressLine.trim(),
          ...(point ? { lat: point.lat, lng: point.lng } : {}),
          deliveryRadiusMeters: Number(form!.deliveryRadiusMeters),
        };
      case 'delivery':
        return {
          minOrderAmount: parseMajorUnits(form!.minOrderAmount || '0'),
          deliveryFee: parseMajorUnits(form!.deliveryFee || '0'),
          freeDeliveryThreshold: form!.freeDeliveryThreshold.trim()
            ? parseMajorUnits(form!.freeDeliveryThreshold)
            : null,
          estimatedMinutesMin: Number(form!.estimatedMinutesMin),
          estimatedMinutesMax: Number(form!.estimatedMinutesMax),
          // An empty list is stored as null rather than [], so "this restaurant
          // has no bands" is one value everywhere instead of two.
          deliveryZones: form!.deliveryZones.length > 0 ? form!.deliveryZones : null,
        };
      case 'payments':
        return { paymentMethods: form!.paymentMethods };
      case 'deliveryCode':
        return { requireDeliveryCode: form!.requireDeliveryCode };
      case 'printers':
        return { printStations: form!.printStations };
      case 'hours':
        return { openingHours: form!.openingHours };
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      {section === 'images' && (
        <>
        <Section
          title={t('restaurantPanel.sectionImages')}
          hint={t('restaurantPanel.sectionImagesHint')}
        >
          {restaurantId && (
            <RestaurantIdField
              restaurantId={restaurantId}
              label={t('restaurantPanel.restaurantId')}
              hint={t('restaurantPanel.restaurantIdHint')}
              copyLabel={t('common.copy')}
              onCopied={() => toast.show(t('common.copied'))}
            />
          )}

          <ImageUpload
            restaurantId={restaurantId ?? ''}
            kind="cover"
            aspect="wide"
            value={coverUrl}
            onChange={setCoverUrl}
            label={t('upload.cover')}
          />
          <ImageUpload
            restaurantId={restaurantId ?? ''}
            kind="logo"
            value={logoUrl}
            onChange={setLogoUrl}
            label={t('upload.logo')}
          />
        </Section>
        </>
      )}

      {section === 'profile' && (
        <>
        <Section title={t('restaurantPanel.sectionProfile')}>
          <Input
            label={t('restaurantPanel.restaurantName')}
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
            maxLength={60}
          />
          <Input
            label={t('restaurantPanel.tagline')}
            value={form.tagline}
            onChange={(event) => patch({ tagline: event.target.value })}
            maxLength={120}
          />
          {/* Public on the restaurant page and frozen onto every order, so a
              customer chasing their food rings the kitchen rather than support. */}
          <Input
            label={t('restaurantPanel.publicPhone')}
            value={form.publicPhone}
            onChange={(event) => patch({ publicPhone: event.target.value })}
            type="tel"
            inputMode="tel"
            maxLength={20}
            hint={t('restaurantPanel.publicPhoneHint')}
          />
          {/* What kind of kitchen this is — chosen, never typed. */}
          <CuisinePicker
            value={form.cuisines}
            stored={restaurant.cuisines ?? []}
            onChange={(next) => patch({ cuisines: next })}
          />

          {/* What the customer's home page files this restaurant under. */}
          <CategoryPicker
            value={form.categories}
            onChange={(next) => patch({ categories: next })}
          />
        </Section>
        </>
      )}

      {section === 'location' && (
        <>
        <Section title={t('restaurantPanel.sectionLocation')}>
          <Select
            label={t('account.city')}
            value={form.regionId}
            onChange={(event) => patch({ regionId: event.target.value, district: '' })}
          >
            {orderedRegions().map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </Select>

          {districtsOf(form.regionId).length > 0 && (
            <Select
              label={t('account.district')}
              value={form.district}
              onChange={(event) => patch({ district: event.target.value })}
            >
              <option value="">{t('account.districtChoose')}</option>
              {districtsOf(form.regionId).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </Select>
          )}

          <Textarea
            label={t('account.addressLine')}
            value={form.addressLine}
            onChange={(event) => patch({ addressLine: event.target.value })}
            maxLength={300}
          />

          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-700">{t('map.pickTitle')}</p>
            <DeliveryMap
              value={point}
              radiusMeters={Number(form.deliveryRadiusMeters) || 5000}
              regionId={form.regionId}
              onChange={setPoint}
            />
          </div>

          <div>
            <label className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-ink-700">
              {t('map.radius')}
              <span className="tabular-nums text-ink-500">
                {((Number(form.deliveryRadiusMeters) || 0) / 1000).toFixed(1)} km
              </span>
            </label>
            <input
              type="range"
              min={500}
              max={30000}
              step={500}
              value={Number(form.deliveryRadiusMeters) || 5000}
              onChange={(event) => patch({ deliveryRadiusMeters: event.target.value })}
              className="w-full accent-brand-600"
            />
            <p className="mt-1 text-sm text-ink-400">{t('map.radiusHint')}</p>
          </div>
        </Section>
        </>
      )}

      {section === 'delivery' && (
        <>
        <Section
          title={t('restaurantPanel.sectionDelivery')}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Input
            label={`${t('home.minOrder')} (₼)`}
            value={form.minOrderAmount}
            onChange={(event) => patch({ minOrderAmount: event.target.value })}
            inputMode="decimal"
          />
          <Input
            label={`${t('home.deliveryFee')} (₼)`}
            value={form.deliveryFee}
            onChange={(event) => patch({ deliveryFee: event.target.value })}
            inputMode="decimal"
          />
          <Input
            label={`${t('home.freeDelivery')} (₼)`}
            value={form.freeDeliveryThreshold}
            onChange={(event) => patch({ freeDeliveryThreshold: event.target.value })}
            inputMode="decimal"
            hint={t('restaurantPanel.freeDeliveryHint')}
          />
          <Input
            label={t('restaurantPanel.prepMin')}
            value={form.estimatedMinutesMin}
            onChange={(event) => patch({ estimatedMinutesMin: event.target.value })}
            inputMode="numeric"
          />
          <Input
            label={t('restaurantPanel.prepMax')}
            value={form.estimatedMinutesMax}
            onChange={(event) => patch({ estimatedMinutesMax: event.target.value })}
            inputMode="numeric"
          />
        </Section>

        {/* Below the flat fee, not instead of it: the bands are an option, and
            the flat fee is what answers when a delivery's distance is unknown
            or no band covers it. */}
        <Section title={t('restaurantPanel.zonesTitle')}>
          <DeliveryZoneEditor
            zones={form.deliveryZones}
            onChange={(deliveryZones) => patch({ deliveryZones })}
            radiusMetres={Number(form.deliveryRadiusMeters) || 0}
          />
        </Section>
        </>
      )}

      {section === 'payments' && (
        <>
        <Section title={t('restaurant.paymentMethods')} className="space-y-2">
          {V1_PAYMENT_METHODS.map((method) => {
            // A restaurant can tick online card, but the customer only ever
            // sees it if Qapında has switched it on platform-wide as well —
            // that is where the payment provider lives. Ticking a box that
            // then does nothing, with no explanation, is worse than not
            // offering the box: the restaurant thinks it is taking card
            // payments and it is not.
            const blockedByPlatform =
              method === PaymentMethod.ONLINE_CARD && !platformAllowsOnline;

            return (
              <div key={method}>
                <label className="flex items-center gap-2.5 text-[15px] text-ink-700">
                  <input
                    type="checkbox"
                    checked={form.paymentMethods.includes(method)}
                    onChange={(event) =>
                      patch({
                        paymentMethods: event.target.checked
                          ? [...form.paymentMethods, method]
                          : form.paymentMethods.filter((entry) => entry !== method),
                      })
                    }
                    className="h-4 w-4 accent-brand-600"
                  />
                  {t(`checkout.${method}`)}
                </label>

                {blockedByPlatform && form.paymentMethods.includes(method) && (
                  <p className="mt-1 pl-6.5 text-sm text-warning">
                    {t('restaurantPanel.onlineNotEnabledYet')}
                  </p>
                )}
              </div>
            );
          })}
        </Section>
        </>
      )}

      {section === 'deliveryCode' && (
        <>
        <Section title={t('restaurantPanel.requireDeliveryCodeLabel')}>
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-ink-500">
              {t('restaurantPanel.requireDeliveryCodeHint')}
            </p>
            {/*
              Under the platform's ALWAYS policy the switch is shown ON and
              disabled, not hidden.
              
              A control that disappears reads as a bug and sends somebody to
              support asking where the setting went; a control that is visibly
              locked, with the reason under it, reads as a policy. And the state
              it is locked in is the true one — the server requires a code for
              every delivery, whatever this restaurant's own flag happens to say
              in its document.
            */}
            <Switch
              checked={locked ? true : form.requireDeliveryCode}
              disabled={locked}
              onChange={(next) => patch({ requireDeliveryCode: next })}
              label={t('restaurantPanel.requireDeliveryCodeLabel')}
            />
          </div>
          {locked && (
            <Alert tone="info">{t('restaurantPanel.deliveryCodeLockedByPlatform')}</Alert>
          )}
        </Section>
        </>
      )}

      {section === 'printers' && (
        <Section title={t('restaurantPanel.sectionPrinters')}>
          <PrintStationEditor
            restaurantId={restaurantId ?? null}
            value={form.printStations}
            onChange={(next) => patch({ printStations: next })}
          />
        </Section>
      )}

      {section === 'hours' && (
        <Section
          title={t('restaurant.openingHours')}
          hint={t('restaurantPanel.sectionHoursHint')}
        >
          <OpeningHoursEditor
            hours={form.openingHours}
            onChange={(openingHours) => patch({ openingHours })}
          />
        </Section>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {/* One Save, and it belongs to this screen alone. Disabled while the
          request is in flight, so a second tap cannot post the form twice. */}
      <Button loading={busy} disabled={busy} onClick={() => void save()}>
        {t('common.save')}
      </Button>
    </div>
  );
}
