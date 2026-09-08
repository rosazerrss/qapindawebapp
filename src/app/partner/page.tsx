'use client';

/**
 * "Qapında-ya qoşul" — the partner flow.
 *
 * Modelled on how Wolt and Yemeksepeti do it, and the important part is the
 * *order*. Those platforms never open with "sign in to your personal account
 * first" — a restaurant owner does not think of themselves as a customer, and
 * being told to become one reads like a mistake.
 *
 * So: the pitch first, then the restaurant's details, and the phone
 * verification comes last, presented as confirming the business contact rather
 * than as creating a shopping account.
 *
 * Underneath it is still one identity — a verified phone number, which is what
 * makes "one phone, one account" hold across the whole platform. The person
 * simply never has to think about that.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Clock, Store, Truck, Wallet } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { DeliveryMap, type MapPoint } from '@/components/restaurant/DeliveryMap';
import { CategoryPicker } from '@/components/restaurant/CategoryPicker';
import { CuisinePicker } from '@/components/restaurant/CuisinePicker';
import type { CuisineId } from '@/shared/cuisines';
import { Alert, Button, Card, Input, Select, Textarea, cn } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError } from '@/i18n';
import { applyForRestaurant } from '@/firebase/callables';
import { districtsOf, orderedRegions, regionById } from '@/shared/regions';
import { parseMajorUnits } from '@/shared/pricing';
import { formatPhone } from '@/shared/phone';
import { DEFAULT_ENABLED_PAYMENT_METHODS, UserRole } from '@/shared/enums';
import type { FoodCategoryId } from '@/shared/categories';

/** Open every day 10:00–23:00 to begin with; editable later in settings. */
const DEFAULT_HOURS = Array.from({ length: 7 }, (_, day) => ({
  day,
  opensAt: 600,
  closesAt: 1380,
  closed: false,
}));

type Stage = 'pitch' | 'business' | 'area' | 'terms';

export default function PartnerPage() {
  const t = useT();
  const router = useRouter();
  const { firebaseUser, profile, role, loading, identityLoading, refreshClaims } = useAuth();

  const [stage, setStage] = useState<Stage>('pitch');
  const [form, setForm] = useState({
    name: '',
    legalName: '',
    taxId: '',
    tagline: '',
    regionId: 'baku',
    district: '',
    addressLine: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    minOrderAmount: '10.00',
    deliveryFee: '3.00',
    freeDeliveryThreshold: '25.00',
    estimatedMinutesMin: '30',
    estimatedMinutesMax: '50',
  });
  const [categories, setCategories] = useState<FoodCategoryId[]>([]);
  const [cuisines, setCuisines] = useState<CuisineId[]>([]);
  const [point, setPoint] = useState<MapPoint | null>(null);
  const [radius, setRadius] = useState(5000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regions = useMemo(() => orderedRegions(), []);
  const districts = districtsOf(form.regionId);
  const patch = (values: Partial<typeof form>) => setForm((c) => ({ ...c, ...values }));

  /*
   * Waits for the identity, not merely for the sign-in.
   *
   * Both branches below read something that is not known yet while
   * `identityLoading` is true: `role` (which defaults to CUSTOMER, so an
   * existing partner is shown the pitch again) and `profile` (whose absence is
   * read as "not verified", so a signed-in owner is asked to verify their phone
   * a second time). Neither is a security decision — the callable refuses both
   * cases anyway — but both are alarming to look at.
   */
  if (loading || identityLoading) {
    return (
      <AppShell>
        <PageLoading />
      </AppShell>
    );
  }

  // Already a partner — no point showing the pitch again.
  if (profile && role !== UserRole.CUSTOMER) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-md p-6 text-center">
          <Store size={36} className="mx-auto text-brand-600" />
          <p className="mt-3 font-medium text-ink-900">{t('partner.alreadyPartner')}</p>
          <Link href="/panel" className="mt-4 block">
            <Button fullWidth>{t('account.restaurantPanel')}</Button>
          </Link>
        </Card>
      </AppShell>
    );
  }

  const businessReady =
    form.name.trim().length >= 2 &&
    form.legalName.trim().length >= 2 &&
    form.contactName.trim().length >= 2 &&
    form.contactPhone.trim().length >= 10;

  const areaReady =
    form.addressLine.trim().length >= 5 &&
    point !== null &&
    (districts.length === 0 || districts.includes(form.district));

  const submit = async () => {
    setBusy(true);
    setError(null);

    let payload: Record<string, unknown>;
    try {
      payload = {
        name: form.name.trim(),
        legalName: form.legalName.trim(),
        taxId: form.taxId.trim() || null,
        tagline: form.tagline.trim(),
        cuisines,
        categories,
        regionId: form.regionId,
        district: districts.length > 0 ? form.district : null,
        addressLine: form.addressLine.trim(),
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        contactEmail: form.contactEmail.trim() || null,
        lat: point!.lat,
        lng: point!.lng,
        deliveryRadiusMeters: radius,
        minOrderAmount: parseMajorUnits(form.minOrderAmount || '0'),
        deliveryFee: parseMajorUnits(form.deliveryFee || '0'),
        freeDeliveryThreshold: form.freeDeliveryThreshold.trim()
          ? parseMajorUnits(form.freeDeliveryThreshold)
          : null,
        estimatedMinutesMin: Number(form.estimatedMinutesMin),
        estimatedMinutesMax: Number(form.estimatedMinutesMax),
        // The two settled at the door. Online card is not something a new
        // restaurant should be signed up to without a provider behind it, and
        // it can be switched on later from the panel once there is one.
        paymentMethods: [...DEFAULT_ENABLED_PAYMENT_METHODS],
        openingHours: DEFAULT_HOURS,
      };
    } catch {
      setBusy(false);
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }

    const result = await applyForRestaurant(payload);
    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    // The role arrives as a fresh claim; refresh before the panel gate reads it.
    await refreshClaims();
    router.replace('/panel/menu');
  };

  return (
    <AppShell bare>
      {/* --- The pitch ------------------------------------------------- */}
      {stage === 'pitch' && (
        <>
          <section className="bg-brand-600 px-4 py-12 text-white">
            <div className="mx-auto max-w-3xl">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {t('partner.heroTitle')}
              </h1>
              <p className="mt-3 max-w-xl text-lg text-white/85">{t('partner.heroBody')}</p>
              <Button
                size="lg"
                variant="secondary"
                className="mt-6"
                onClick={() => setStage('business')}
              >
                {t('partner.start')} <ArrowRight size={18} />
              </Button>
            </div>
          </section>

          <div className="mx-auto max-w-3xl px-4 py-10">
            <div className="grid gap-5 sm:grid-cols-3">
              <Benefit icon={Truck} title={t('partner.ownDriverTitle')} body={t('partner.ownDriverBody')} />
              <Benefit icon={Wallet} title={t('partner.moneyTitle')} body={t('partner.moneyBody')} />
              <Benefit icon={Clock} title={t('partner.controlTitle')} body={t('partner.controlBody')} />
            </div>

            <h2 className="mt-12 text-xl font-semibold text-ink-900">{t('partner.howTitle')}</h2>
            <ol className="mt-4 space-y-4">
              {[1, 2, 3, 4].map((step) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                    {step}
                  </span>
                  <div>
                    <p className="font-medium text-ink-900">{t(`partner.step${step}Title`)}</p>
                    <p className="text-sm text-ink-500">{t(`partner.step${step}Body`)}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-10">
              <Alert tone="info">{t('partner.commissionNote')}</Alert>
            </div>

            <Button size="lg" className="mt-6" onClick={() => setStage('business')}>
              {t('partner.start')} <ArrowRight size={18} />
            </Button>
          </div>
        </>
      )}

      {/* --- The form -------------------------------------------------- */}
      {stage !== 'pitch' && (
        <div className="mx-auto max-w-2xl px-4 py-5">
          <button
            onClick={() =>
              setStage(stage === 'business' ? 'pitch' : stage === 'area' ? 'business' : 'area')
            }
            className="mb-3 flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-ink-500 hover:bg-ink-100"
          >
            <ArrowLeft size={17} /> {t('common.back')}
          </button>

          <Steps stage={stage} />

          {stage === 'business' && (
            <Card className="mt-5 space-y-4 p-5">
              <h2 className="font-semibold text-ink-900">{t('partner.businessTitle')}</h2>

              <Input
                label={t('partner.restaurantName')}
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                maxLength={60}
              />
              <Input
                label={t('partner.legalName')}
                value={form.legalName}
                onChange={(e) => patch({ legalName: e.target.value })}
                maxLength={120}
                hint={t('partner.legalNameHint')}
              />
              <Input
                label={t('partner.taxId')}
                value={form.taxId}
                onChange={(e) => patch({ taxId: e.target.value })}
                maxLength={40}
              />
              {/* What kind of kitchen this is — chosen, never typed. */}
              <CuisinePicker value={cuisines} onChange={setCuisines} />
              {/* Where this shop will appear on the customer's home page. */}
              <CategoryPicker value={categories} onChange={setCategories} />
              <Input
                label={t('partner.contactName')}
                value={form.contactName}
                onChange={(e) => patch({ contactName: e.target.value })}
                maxLength={80}
              />
              <PhoneInput
                label={t('partner.contactPhone')}
                value={form.contactPhone}
                onChange={(next) => patch({ contactPhone: next })}
                hint={t('partner.contactPhoneHint')}
              />
              <Input
                label={t('auth.emailOptional')}
                value={form.contactEmail}
                onChange={(e) => patch({ contactEmail: e.target.value })}
                type="email"
              />

              <Button fullWidth disabled={!businessReady} onClick={() => setStage('area')}>
                {t('common.confirm')} <ArrowRight size={17} />
              </Button>
            </Card>
          )}

          {stage === 'area' && (
            <Card className="mt-5 space-y-4 p-5">
              <h2 className="font-semibold text-ink-900">{t('partner.areaTitle')}</h2>

              <Select
                label={t('account.city')}
                value={form.regionId}
                onChange={(e) => patch({ regionId: e.target.value, district: '' })}
              >
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </Select>

              {districts.length > 0 && (
                <Select
                  label={t('account.district')}
                  value={form.district}
                  onChange={(e) => patch({ district: e.target.value })}
                >
                  <option value="">{t('account.districtChoose')}</option>
                  {districts.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </Select>
              )}

              <Textarea
                label={t('partner.addressLine')}
                value={form.addressLine}
                onChange={(e) => patch({ addressLine: e.target.value })}
                maxLength={300}
              />

              <div>
                <p className="mb-1.5 text-sm font-medium text-ink-700">{t('map.pickTitle')}</p>
                <DeliveryMap
                  value={point}
                  radiusMeters={radius}
                  regionId={form.regionId}
                  onChange={setPoint}
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-ink-700">
                  {t('map.radius')}
                  <span className="tabular-nums text-ink-500">
                    {(radius / 1000).toFixed(1)} km
                  </span>
                </label>
                <input
                  type="range"
                  min={500}
                  max={30000}
                  step={500}
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  className="w-full accent-brand-600"
                />
                <p className="mt-1 text-sm text-ink-400">{t('map.radiusHint')}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={`${t('home.minOrder')} (₼)`}
                  value={form.minOrderAmount}
                  onChange={(e) => patch({ minOrderAmount: e.target.value })}
                  inputMode="decimal"
                />
                <Input
                  label={`${t('home.deliveryFee')} (₼)`}
                  value={form.deliveryFee}
                  onChange={(e) => patch({ deliveryFee: e.target.value })}
                  inputMode="decimal"
                />
                <Input
                  label={`${t('home.freeDelivery')} (₼)`}
                  value={form.freeDeliveryThreshold}
                  onChange={(e) => patch({ freeDeliveryThreshold: e.target.value })}
                  inputMode="decimal"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    label={t('partner.minMinutes')}
                    value={form.estimatedMinutesMin}
                    onChange={(e) => patch({ estimatedMinutesMin: e.target.value })}
                    inputMode="numeric"
                  />
                  <Input
                    label={t('partner.maxMinutes')}
                    value={form.estimatedMinutesMax}
                    onChange={(e) => patch({ estimatedMinutesMax: e.target.value })}
                    inputMode="numeric"
                  />
                </div>
              </div>

              <Button fullWidth disabled={!areaReady} onClick={() => setStage('terms')}>
                {t('common.confirm')} <ArrowRight size={17} />
              </Button>
            </Card>
          )}

          {stage === 'terms' && (
            <Card className="mt-5 space-y-4 p-5">
              <h2 className="font-semibold text-ink-900">{t('partner.confirmTitle')}</h2>

              <dl className="space-y-2 text-[15px]">
                <Line label={t('partner.restaurantName')} value={form.name} />
                <Line
                  label={t('account.city')}
                  value={`${regionById(form.regionId)?.name ?? ''}${form.district ? ` · ${form.district}` : ''}`}
                />
                <Line label={t('partner.addressLine')} value={form.addressLine} />
                <Line label={t('map.radius')} value={`${(radius / 1000).toFixed(1)} km`} />
                <Line label={t('partner.contactPhone')} value={formatPhone(form.contactPhone)} />
              </dl>

              <Alert tone="info">{t('partner.ownDriverReminder')}</Alert>

              {/* The identity step, framed as confirming the business contact. */}
              {!firebaseUser || !profile ? (
                <>
                  <Alert tone="warning">{t('partner.verifyNeeded')}</Alert>
                  <Link href="/login?next=/partner">
                    <Button fullWidth>{t('partner.verifyPhone')}</Button>
                  </Link>
                </>
              ) : (
                <Button size="lg" fullWidth loading={busy} onClick={submit}>
                  {t('partner.submit')}
                </Button>
              )}

              {error && <Alert tone="danger">{error}</Alert>}

              <p className="text-xs text-ink-400">{t('partner.reviewNote')}</p>
            </Card>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Benefit({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Truck;
  title: string;
  body: string;
}) {
  return (
    <div>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <Icon size={20} />
      </span>
      <p className="mt-3 font-medium text-ink-900">{title}</p>
      <p className="mt-1 text-sm text-ink-500">{body}</p>
    </div>
  );
}

function Steps({ stage }: { stage: Stage }) {
  const t = useT();
  const order: Stage[] = ['business', 'area', 'terms'];
  const index = order.indexOf(stage);

  return (
    <div className="flex items-center gap-2">
      {order.map((entry, position) => (
        <div key={entry} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              position <= index ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-500',
            )}
          >
            {position < index ? <Check size={13} strokeWidth={3} /> : position + 1}
          </span>
          <span
            className={cn(
              'truncate text-xs',
              position <= index ? 'text-ink-700' : 'text-ink-400',
            )}
          >
            {t(`partner.stage_${entry}`)}
          </span>
          {position < order.length - 1 && <span className="h-px flex-1 bg-ink-200" />}
        </div>
      ))}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value || '—'}</dd>
    </div>
  );
}
