'use client';

/**
 * Adding or editing a delivery address.
 *
 * WHY THIS IS FOUR STEPS AND NOT ONE FORM
 * ---------------------------------------
 * It used to be one long form with a map somewhere in the middle, and the pin
 * was the optional-looking thing halfway down it. That is exactly backwards
 * now: `shared/geo.ts` measures the restaurant's delivery circle against the
 * ADDRESS'S COORDINATES, so an address with no pin cannot be ordered to at all
 * — `mayDeliverTo` refuses it and `createOrder` refuses it again. A flow in
 * which the one required thing looks optional produces addresses that cannot
 * buy food, and a customer who does not understand why.
 *
 * So the pin comes first and the typing comes after, in the order the owner
 * asked for:
 *
 *   1. AXTAR      — "Ünvanınızı daxil edin", or "Mövcud konumumu istifadə et".
 *   2. XƏRİTƏ     — a draggable pin with the resolved address under it.
 *   3. GİRİŞ      — the same map, asking for the pin to be moved to the
 *                   entrance, because that is where the courier stops.
 *   4. TƏFƏRRÜAT  — bina, mənzil, mərtəbə, şirkət, telephone, courier note.
 *
 * Every step has ← Geri and one primary action pinned at the bottom. Editing an
 * address that already has a pin opens at step 2, because the person came to
 * change a flat number and should not be made to search for their own street.
 *
 * THE MAP IS THE SAME LEAFLET MAP THE RESTAURANT PANEL USES
 * --------------------------------------------------------
 * `DeliveryMap` — OpenStreetMap, no key, no quota, and the same component that
 * draws the restaurant's own circle, so what a customer pins and what a
 * restaurant drew are measured in the same units by the same code.
 *
 * THE TEXT UNDER THE PIN IS A CONVENIENCE, NOT A DEPENDENCY
 * --------------------------------------------------------
 * `reverseGeocode` fills the street line in so most people never type one. When
 * Nominatim is slow, blocked or rate-limited it returns nothing, and the screen
 * says so and hands the field back — the pin is what actually matters and it is
 * already placed. There is no state in which a failed geocode blocks a save.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleCheck,
  Crosshair,
  MapPin,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';

import { useT, translateError } from '@/i18n';
import { AppErrorCode } from '@/shared/errors';
import { Alert, Button, Input, Select, Sheet, Textarea, cn } from '@/components/ui';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { OtpInput } from '@/components/ui/OtpInput';
import { DeliveryMap, type MapPoint } from '@/components/restaurant/DeliveryMap';
import {
  saveAddress,
  sendAddressPhoneCode,
  verifyAddressPhoneCode,
} from '@/firebase/callables';
import { useAuth } from '@/contexts/AuthContext';
import { useRegion } from '@/contexts/RegionContext';
import {
  currentPosition,
  endAddressSearch,
  resolveResult,
  reverseGeocode,
  searchAddress,
  type GeocodeResult,
} from '@/lib/geocode';
import { checkDeliveryRange, mayDeliverTo, type DeliveryOrigin } from '@/shared/geo';
import { districtsOf, orderedRegions, regionName } from '@/shared/regions';
import {
  ADDRESS_CODE_LENGTH,
  ADDRESS_CODE_RESEND_SECONDS,
  CONTACT_NAME_MAX,
  addressDeliverable,
  isUsableContactName,
  needsPhoneVerification,
} from '@/shared/addressContact';
import { formatPhone } from '@/shared/phone';
import {
  forgetSmsUnavailable,
  rememberSmsUnavailable,
  smsKnownUnavailable,
} from '@/lib/addressSms';
import type { Address } from '@/shared/models';

/**
 * A dot, not a delivery area.
 *
 * `DeliveryMap` always draws its circle; at eighty metres it reads as "roughly
 * this spot", which is honest about what a dropped pin actually means, instead
 * of implying a zone the customer is choosing.
 */
const PIN_HALO_METERS = 80;

/**
 * How long the pin has to sit still before we ask Nominatim where it is.
 *
 * A drag fires continuously and each of those is a request somebody else pays
 * for. Nine hundred milliseconds is past the end of a deliberate drag and short
 * enough that the line appears while the person is still looking at the map.
 */
const GEOCODE_DEBOUNCE_MS = 900;

/** The same idea for typing, which produces far more events than dragging. */
const SEARCH_DEBOUNCE_MS = 600;

/*
 * `verify` is a step and not a separate screen.
 *
 * The address is saved by then — the server wrote it — so this step is not
 * "finish saving", it is "prove the number you just gave us". Keeping it inside
 * the same sheet is what makes that legible: the person has not left the thing
 * they were doing, and closing the sheet does not lose the address, it only
 * leaves it unverified and clearly marked as such in the list.
 */
type Step = 'search' | 'map' | 'entrance' | 'details' | 'verify';

/** The restaurant a customer came from, when they came from one. */
export interface AddressDeliveryOrigin extends DeliveryOrigin {
  name: string;
}

export function AddressForm({
  open,
  onClose,
  onSaved,
  existing,
  origin,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (addressId: string) => void;
  existing?: Address | null;
  /**
   * Shown live while the pin is being placed: is this inside the circle of the
   * restaurant whose basket this address is being added for?
   *
   * Passed in rather than looked up, because this component is opened from
   * three places and only one of them has a restaurant. Answering "will they
   * deliver here" at the moment somebody is choosing the spot is far kinder
   * than answering it at the checkout after they have saved it.
   */
  origin?: AddressDeliveryOrigin | null;
}) {
  const t = useT();
  const { profile } = useAuth();
  const { regionId: browsingRegion } = useRegion();

  const pinned = existing?.lat != null && existing?.lng != null;

  const [step, setStep] = useState<Step>(pinned ? 'details' : 'search');

  const [label, setLabel] = useState(existing?.label ?? t('account.labelHome'));
  const [regionId, setRegionId] = useState(existing?.regionId ?? browsingRegion);
  const [district, setDistrict] = useState(existing?.district ?? '');
  const [line, setLine] = useState(existing?.line ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [building, setBuilding] = useState(existing?.building ?? '');
  const [apartment, setApartment] = useState(existing?.apartment ?? '');
  const [floor, setFloor] = useState(existing?.floor ?? '');
  const [company, setCompany] = useState(existing?.company ?? '');
  /*
   * WHO OPENS THE DOOR — prefilled with the account holder, and required.
   *
   * Prefilled because the honest default is "me, at my own number", and making
   * the commonest case free is the difference between a field people fill in
   * and a field people abandon a checkout over. Required because the courier
   * standing in the street needs a name to ask for and a number that answers,
   * and until now they were being handed the account holder's regardless of who
   * the food was actually going to.
   */
  const [contactName, setContactName] = useState(
    existing?.contactName ?? (existing ? '' : (profile?.fullName ?? '')),
  );
  const [phone, setPhone] = useState(existing?.phone ?? (existing ? '' : (profile?.phone ?? '')));
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The verification step's own state.
   *
   * `savedId` is what makes the step possible at all: the code is sent for a
   * SAVED address, so the id has to survive the save that produced it.
   */
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  /**
   * The platform cannot send a code at all right now.
   *
   * Distinct from an ordinary error: it is not something the customer can fix
   * by trying again, so the screen offers a different route rather than a
   * retry. See `sendCode`.
   */
  const [smsUnavailable, setSmsUnavailable] = useState(smsKnownUnavailable());
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [point, setPoint] = useState<MapPoint | null>(
    pinned ? { lat: existing!.lat!, lng: existing!.lng! } : null,
  );
  /** Where the map should jump to next — geolocation, or a search result. */
  const [focus, setFocus] = useState<MapPoint | null>(null);

  const [term, setTerm] = useState('');
  /*
   * What the last completed lookup found, and which term it answered.
   *
   * The term travels with the results so that deleting characters back below
   * the minimum length shows nothing again — derived during render, rather
   * than an effect clearing the list, which would be a second render whose
   * only job is to catch up with the first.
   */
  const [found, setFound] = useState<{ term: string; results: GeocodeResult[] } | null>(null);
  const [searching, setSearching] = useState(false);
  /**
   * The row whose position is being looked up, by its label.
   *
   * On a slow connection the Google lookup is a visible moment, and a list that
   * does nothing for a second after a tap reads as broken. By label rather than
   * by index because the list can be replaced underneath by a newer search.
   */
  const [choosing, setChoosing] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);

  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<string | null>(existing?.line ?? null);
  const [geocodeFailed, setGeocodeFailed] = useState(false);

  /*
   * Whether the customer has written the street line themselves.
   *
   * A ref, not state: it changes nothing on screen, and it is the one thing
   * that must survive every re-render without causing one. Once it is true the
   * geocoder stops overwriting the field — somebody who corrected "Nizami küç."
   * to the name people actually use must not have it undone by a pin nudge.
   */
  const lineIsMine = useRef(Boolean(existing?.line));

  const regions = useMemo(() => orderedRegions(), []);
  const districts = districtsOf(regionId);

  // --- Reverse geocoding the pin ----------------------------------------- //

  useEffect(() => {
    if (!point) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setResolving(true);
      void reverseGeocode(point, controller.signal).then((answer) => {
        if (controller.signal.aborted) return;
        setResolving(false);
        setGeocodeFailed(answer === null);
        if (answer === null) return;
        setResolved(answer);
        // Only fills an untouched field. See `lineIsMine`.
        if (!lineIsMine.current) setLine(answer);
      });
    }, GEOCODE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [point]);

  // --- Searching for a street -------------------------------------------- //

  /*
   * Close the billing session when this screen goes away.
   *
   * Only Google has one, and an abandoned session costs nothing — but a token
   * left behind would be picked up by the NEXT customer's first keystroke,
   * which is precisely the reuse session pricing is meant to prevent.
   */
  useEffect(() => endAddressSearch, []);

  useEffect(() => {
    // Too short to ask about. Nothing is cleared here — `results` below derives
    // that from the term itself, so this effect only ever starts a lookup.
    if (term.trim().length < 3) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      void searchAddress(term, controller.signal).then((matches) => {
        if (controller.signal.aborted) return;
        setSearching(false);
        setFound({ term, results: matches });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  /*
   * The resend countdown.
   *
   * One interval, cleared on unmount, and it stops at zero rather than running
   * for ever behind a closed sheet. The number it counts is the server's own
   * cooldown, imported rather than repeated, so a button that says "60 saniyə"
   * and a server that refuses at 61 cannot happen.
   */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  /** The results, only while they still answer what is in the box. */
  const results = term.trim().length >= 3 && found?.term === term ? found.results : null;

  const locateMe = async () => {
    setLocating(true);
    setLocationDenied(false);

    const here = await currentPosition();
    setLocating(false);

    if (!here) {
      // A refusal, a switched-off GPS, or a browser that will not say. None of
      // them is an error the person can fix from here, and all of them have the
      // same answer: put the pin on the map yourself.
      setLocationDenied(true);
      return;
    }

    setFocus(here);
    setStep('map');
  };

  /**
   * A tapped suggestion becomes a pin.
   *
   * Asynchronous because a Google suggestion does not carry its coordinates —
   * they are fetched here, once, for the one row the customer chose rather than
   * for all five they scrolled past. `resolveResult` hides which provider
   * answered; a Nominatim row resolves instantly and never leaves this frame.
   *
   * A failed lookup moves to the map WITHOUT moving the pin, on purpose. The
   * customer is then one drag away from a saved address, which is a better
   * place to be than back at a search box that just did nothing.
   */
  const chooseResult = async (result: GeocodeResult) => {
    setChoosing(result.line);
    const place = await resolveResult(result);
    setChoosing(null);

    if (place) {
      setFocus({ lat: place.lat, lng: place.lng });
      setResolved(place.line);
      if (!lineIsMine.current) setLine(place.line);
    }

    setStep('map');
  };

  // --- Is this inside the restaurant's circle? --------------------------- //

  /*
   * Derived during render, from the same function the checkout and the server
   * use. Not a warning bolted on afterwards — the answer to "will they deliver
   * here" is the reason the pin exists.
   */
  const range = origin && point ? checkDeliveryRange(origin, point) : null;
  const deliverable = range ? mayDeliverTo(range) : true;

  // --- Saving ------------------------------------------------------------ //

  const districtMissing = districts.length > 0 && !districts.includes(district);

  /*
   * The name and the number are now part of "ready", and they are checked with
   * the same function the server checks them with. Two copies of "is this name
   * usable" would eventually be two different answers, and the way that failure
   * shows up is a save button that works and a save that fails.
   */
  const contactReady = isUsableContactName(contactName) && phone.trim().length > 0;

  const ready =
    Boolean(point) &&
    line.trim().length >= 5 &&
    label.trim().length > 0 &&
    !districtMissing &&
    contactReady;

  /*
   * Will this number have to be proved?
   *
   * Answered on the screen only so the person can be told what happens next.
   * The server decides it again from the stored account, and the server's
   * answer is the one that counts — this is the same shared function, so the
   * two agree.
   */
  const willNeedCode = needsPhoneVerification({
    addressPhone: phone,
    accountPhone: profile?.phone ?? null,
    accountPhoneVerified: profile?.phoneVerified === true,
  });

  const submit = async () => {
    setSaving(true);
    setError(null);

    const result = await saveAddress({
      addressId: existing?.id ?? null,
      label: label.trim(),
      line: line.trim(),
      note: note.trim() || null,
      regionId,
      district: districts.length > 0 ? district : null,
      isDefault,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      building: building.trim() || null,
      apartment: apartment.trim() || null,
      floor: floor.trim() || null,
      company: company.trim() || null,
      phone: phone || null,
      contactName: contactName.trim(),
    });

    setSaving(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    const addressId = result.data!.addressId;
    setSavedId(addressId);

    /*
     * Saved either way. What happens next depends on the SERVER's answer, not
     * on `willNeedCode` above: the account's own verified number needs no
     * message and the customer is simply finished.
     */
    if (!result.data!.needsCode) {
      onSaved?.(addressId);
      onClose();
      return;
    }

    setStep('verify');
    void sendCode(addressId);
  };

  /** Asks the server to send a code to the number saved on this address. */
  const sendCode = async (addressId: string) => {
    setSending(true);
    setError(null);
    setCode('');

    const result = await sendAddressPhoneCode({ addressId });
    setSending(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      /*
       * NO CODE IS COMING, AND THE CUSTOMER MUST NOT BE LEFT WAITING FOR ONE.
       *
       * `SMS_SENDING_DISABLED` means the platform has no SMS gateway
       * configured. Before this, the address was saved, the code screen opened,
       * an error appeared — and the person sat looking at six empty boxes for a
       * message that would never arrive. Worse, the address stayed unverified,
       * so they could not order to it either. A dead end with no way out and no
       * explanation.
       *
       * The protection itself stays: an unverified number must never reach a
       * courier, because that is how a stranger gets a driver at their door.
       * What changes is that the customer is offered the one thing that does
       * work — their own number, already verified at registration — instead of
       * being told what failed and abandoned there.
       */
      const disabled = result.errorCode === AppErrorCode.SMS_SENDING_DISABLED;
      if (disabled) rememberSmsUnavailable();
      setSmsUnavailable(disabled);
      return;
    }

    forgetSmsUnavailable();
    setSmsUnavailable(false);

    // Already the account's own number — nothing was sent and nothing is
    // needed. Finish rather than showing an empty code box.
    if (result.data?.alreadyVerified) {
      onSaved?.(addressId);
      onClose();
      return;
    }

    setCooldown(ADDRESS_CODE_RESEND_SECONDS);
  };

  /**
   * Replaces the address's number with the account's own and saves again.
   *
   * The account number was verified by SMS at registration, so the server marks
   * this address verified without sending anything — the case
   * `needsPhoneVerification` was written to catch. One tap, no message, no
   * cost, and the customer leaves with an address they can actually order to.
   */
  const switchToOwnNumber = async () => {
    const own = profile?.phone;
    if (!own) return;

    setSending(true);
    setError(null);

    const result = await saveAddress({
      addressId: savedId ?? existing?.id ?? null,
      label: label.trim(),
      line: line.trim(),
      note: note.trim() || null,
      regionId,
      district: districts.length > 0 ? district : null,
      isDefault,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      building: building.trim() || null,
      apartment: apartment.trim() || null,
      floor: floor.trim() || null,
      company: company.trim() || null,
      phone: own,
      contactName: contactName.trim(),
    });

    setSending(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setPhone(own);
    setSmsUnavailable(false);
    onSaved?.(result.data!.addressId);
    onClose();
  };

  const confirmCode = async () => {
    if (!savedId) return;

    setVerifying(true);
    setError(null);

    const result = await verifyAddressPhoneCode({ addressId: savedId, code: code.trim() });
    setVerifying(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      // A wrong code is worth clearing: the commonest next action is typing it
      // again, and leaving the wrong digits there makes that harder, not easier.
      setCode('');
      return;
    }

    onSaved?.(savedId);
    onClose();
  };

  /** ← Geri for whichever step this is. The first step's is "close". */
  const back = () => {
    /*
     * From the code step, back is CLOSE, not "return to the form".
     *
     * The address is already saved by then. Sending somebody back to a form
     * whose Save button would create a second copy of what they just saved is
     * the wrong door; leaving is the right one, and the address waits in the
     * list with "nömrə təsdiqlənməyib" on it until they come back to it.
     */
    if (step === 'verify') {
      onSaved?.(savedId ?? '');
      onClose();
      return;
    }
    if (step === 'details') setStep(pinned ? 'details' : 'entrance');
    if (step === 'entrance') setStep('map');
    if (step === 'map') setStep('search');
    if (step === 'search' || (step === 'details' && pinned)) onClose();
  };

  const titles: Record<Step, string> = {
    search: t('address.stepSearchTitle'),
    map: t('address.stepMapTitle'),
    entrance: t('address.stepEntranceTitle'),
    details: t('address.stepDetailsTitle'),
    verify: t('address.stepVerifyTitle'),
  };

  const footer = (
    <div className="space-y-2">
      {step === 'map' && (
        <Button fullWidth disabled={!point} onClick={() => setStep('entrance')}>
          {t('common.continue')}
        </Button>
      )}
      {step === 'entrance' && (
        <Button fullWidth disabled={!point} onClick={() => setStep('details')}>
          <CircleCheck size={17} aria-hidden /> {t('address.confirmLocation')}
        </Button>
      )}
      {step === 'details' && (
        <>
          {!ready && <p className="text-center text-sm text-ink-400">{t('account.saveBlocked')}</p>}
          <Button fullWidth loading={saving} disabled={!ready} onClick={submit}>
            {willNeedCode ? t('address.saveAndVerify') : t('common.save')}
          </Button>
        </>
      )}
      {/*
        No gateway, so no code is coming. The one route that still works is
        offered instead of leaving the person in front of six empty boxes —
        see the note in `sendCode`.
      */}
      {step === 'verify' && smsUnavailable && profile?.phone && (
        <Button fullWidth loading={sending} onClick={() => void switchToOwnNumber()}>
          {t('address.switchToOwnNumber', { phone: formatPhone(profile.phone) })}
        </Button>
      )}
      {step === 'verify' && !smsUnavailable && (
        <Button
          fullWidth
          loading={verifying}
          disabled={code.trim().length !== ADDRESS_CODE_LENGTH}
          onClick={confirmCode}
        >
          {t('address.confirmCode')}
        </Button>
      )}
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} footer={step === 'search' ? undefined : footer}>
      {/* One header for every step: a 44px ← Geri and the step's own name.
          `Sheet`'s own title bar is not used, because the back control has to
          be part of the flow rather than a close button beside it. */}
      <div className="-mt-1 mb-4 flex items-center gap-1.5">
        <button
          type="button"
          onClick={back}
          aria-label={t('common.back')}
          className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-100 active:bg-ink-200"
        >
          <ArrowLeft size={19} aria-hidden />
        </button>
        <h2 className="text-lg font-semibold text-ink-900">{titles[step]}</h2>
      </div>

      {step === 'search' && (
        <SearchStep
          term={term}
          onTerm={setTerm}
          results={results}
          searching={searching}
          choosing={choosing}
          locating={locating}
          locationDenied={locationDenied}
          onUseLocation={() => void locateMe()}
          onChoose={chooseResult}
          onSkip={() => setStep('map')}
        />
      )}

      {(step === 'map' || step === 'entrance') && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            {step === 'map' ? t('address.mapHint') : t('address.entranceHint')}
          </p>

          <DeliveryMap
            value={point}
            focus={focus}
            onChange={setPoint}
            radiusMeters={PIN_HALO_METERS}
            regionId={regionId}
            mapClassName="h-72"
            hint={t('address.dragHint')}
          />

          {/* The sheet under the map: what is at the pin, right now. */}
          <div className="rounded-2xl border border-ink-200 bg-white p-4">
            <p className="flex items-start gap-2 text-[15px] text-ink-800">
              <MapPin size={17} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
              <span className="min-w-0">
                {resolving
                  ? t('address.resolving')
                  : (resolved ?? (point ? t('address.pinOnly') : t('account.mapPinMissing')))}
              </span>
            </p>

            {geocodeFailed && !resolving && (
              <p className="mt-2 text-sm text-ink-400">{t('address.geocodeUnavailable')}</p>
            )}

            {range && (
              <p
                className={cn(
                  'mt-3 flex items-start gap-1.5 rounded-xl px-2.5 py-2 text-sm',
                  deliverable ? 'bg-green-50 text-success' : 'bg-red-50 text-danger',
                )}
                role="status"
              >
                {deliverable ? (
                  <Check size={14} className="mt-0.5 shrink-0" aria-hidden />
                ) : (
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                )}
                {deliverable
                  ? t('address.insideRange', { restaurant: origin!.name })
                  : t('address.outsideRange', { restaurant: origin!.name })}
              </p>
            )}
          </div>
        </div>
      )}

      {step === 'verify' && (
        <VerifyStep
          phone={phone}
          code={code}
          onCode={setCode}
          onComplete={() => void confirmCode()}
          onResend={() => savedId && void sendCode(savedId)}
          sending={sending}
          cooldown={cooldown}
          error={error}
          unavailable={smsUnavailable}
        />
      )}

      {step === 'details' && (
        <DetailsStep
          label={label}
          onLabel={setLabel}
          regionId={regionId}
          onRegion={(next) => {
            setRegionId(next);
            setDistrict('');
          }}
          regions={regions}
          district={district}
          onDistrict={setDistrict}
          districts={districts}
          districtMissing={districtMissing}
          line={line}
          onLine={(next) => {
            lineIsMine.current = true;
            setLine(next);
          }}
          building={building}
          onBuilding={setBuilding}
          apartment={apartment}
          onApartment={setApartment}
          floor={floor}
          onFloor={setFloor}
          company={company}
          onCompany={setCompany}
          /*
           * "Ev" is the default label and the one most addresses keep, and a
           * company field under it is a question with no answer. Still shown
           * when a value is already stored, so relabelling an address cannot
           * silently drop what somebody typed.
           */
          showCompany={label !== t('account.labelHome') || company.trim().length > 0}
          contactName={contactName}
          onContactName={setContactName}
          phone={phone}
          onPhone={setPhone}
          willNeedCode={willNeedCode}
          ownPhone={profile?.phone ?? null}
          smsUnavailable={smsUnavailable}
          note={note}
          onNote={setNote}
          isDefault={isDefault}
          onDefault={setIsDefault}
          point={point}
          onEditPin={() => setStep('map')}
          error={error}
        />
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — "Ünvanınızı daxil edin"
// ---------------------------------------------------------------------------

function SearchStep({
  term,
  onTerm,
  results,
  searching,
  choosing,
  locating,
  locationDenied,
  onUseLocation,
  onChoose,
  onSkip,
}: {
  term: string;
  onTerm: (value: string) => void;
  results: GeocodeResult[] | null;
  searching: boolean;
  /** The label of the row whose position is being fetched, if any. */
  choosing: string | null;
  locating: boolean;
  locationDenied: boolean;
  onUseLocation: () => void;
  onChoose: (result: GeocodeResult) => Promise<void>;
  onSkip: () => void;
}) {
  const t = useT();

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          size={17}
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
        />
        <input
          type="search"
          value={term}
          autoFocus
          onChange={(event) => onTerm(event.target.value)}
          placeholder={t('address.searchPlaceholder')}
          aria-label={t('address.searchPlaceholder')}
          className="min-h-12 w-full rounded-2xl border border-ink-200 bg-white pl-10 pr-4 text-[15px] text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-brand-400"
        />
      </div>

      {/* The fastest path, and the one most people take. */}
      <button
        type="button"
        onClick={onUseLocation}
        disabled={locating}
        className="flex min-h-12 w-full items-center gap-2.5 rounded-2xl border border-brand-200 bg-brand-50/60 px-4 text-[15px] font-medium text-brand-700 transition hover:bg-brand-50 disabled:opacity-60"
      >
        <Crosshair size={18} aria-hidden />
        {locating ? t('address.locating') : t('address.useMyLocation')}
      </button>

      {locationDenied && <Alert tone="warning">{t('address.locationDenied')}</Alert>}

      {searching && <p className="text-sm text-ink-400">{t('common.loading')}</p>}

      {results !== null && !searching && (
        <div className="divide-y divide-row-edge overflow-hidden rounded-2xl border border-card-edge">
          {results.length === 0 ? (
            <p className="px-4 py-4 text-sm text-ink-500">{t('address.noResults')}</p>
          ) : (
            results.map((result) => (
              <button
                // Google rows carry a place id and no coordinates; Nominatim
                // rows the other way round. The line is the one thing both
                // always have, and it is what the customer is reading.
                key={result.placeId ?? `${result.lat},${result.lng},${result.line}`}
                type="button"
                onClick={() => void onChoose(result)}
                disabled={choosing !== null}
                className="flex min-h-14 w-full items-start gap-2.5 px-4 py-3 text-left transition hover:bg-ink-50 disabled:opacity-60"
              >
                <MapPin size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
                <span className="min-w-0 text-[15px] text-ink-800">{result.line}</span>
                {choosing === result.line && (
                  <span className="ml-auto shrink-0 text-sm text-ink-400">
                    {t('common.loading')}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* Always available, and never a dead end: the map is the real control,
          and searching is only a shortcut to it. */}
      <button
        type="button"
        onClick={onSkip}
        className="min-h-11 w-full rounded-xl px-3 text-sm font-medium text-brand-600 transition hover:bg-brand-50"
      >
        {t('address.pinOnMapInstead')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — the details a map cannot know
// ---------------------------------------------------------------------------

function DetailsStep(props: {
  label: string;
  onLabel: (value: string) => void;
  regionId: string;
  onRegion: (value: string) => void;
  regions: Array<{ id: string; name: string }>;
  district: string;
  onDistrict: (value: string) => void;
  districts: string[];
  districtMissing: boolean;
  line: string;
  onLine: (value: string) => void;
  building: string;
  onBuilding: (value: string) => void;
  apartment: string;
  onApartment: (value: string) => void;
  floor: string;
  onFloor: (value: string) => void;
  company: string;
  /** False for "Ev" — see the note at the field. */
  showCompany: boolean;
  onCompany: (value: string) => void;
  contactName: string;
  onContactName: (value: string) => void;
  phone: string;
  onPhone: (value: string) => void;
  willNeedCode: boolean;
  /** The account's own verified number, for the one-tap fix. */
  ownPhone: string | null;
  /**
   * The platform cannot send a verification code right now.
   *
   * Known only after one attempt has failed — there is no setting a browser can
   * read for it — so this is false on the first address of a session and true
   * for every one after. That is still worth doing: the person who hits the
   * dead end once does not hit it twice.
   */
  smsUnavailable: boolean;
  note: string;
  onNote: (value: string) => void;
  isDefault: boolean;
  onDefault: (value: boolean) => void;
  point: MapPoint | null;
  onEditPin: () => void;
  error: string | null;
}) {
  const t = useT();

  /**
   * The three suggestions are translated, and the saved label is whatever the
   * customer picked in their own language: it is free text on the server and it
   * is read by that same customer, never matched against a list.
   */
  const labelSuggestions = useMemo(
    () => [t('account.labelHome'), t('account.labelWork'), t('account.labelOther')],
    [t],
  );

  return (
    <div className="space-y-6">
      {/* Where the pin ended up, with a way back to it. A person who realises
          at this point that they pinned the wrong block must not have to close
          the whole thing and start again. */}
      <div className="flex items-start gap-3 rounded-2xl bg-ink-50 px-3.5 py-3">
        <MapPin size={17} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
        <span className="min-w-0 flex-1 text-sm text-ink-700">
          {props.point
            ? `${regionName(props.regionId)} · ${props.line || t('address.pinOnly')}`
            : t('account.mapPinMissing')}
        </span>
        <button
          type="button"
          onClick={props.onEditPin}
          className="min-h-11 shrink-0 rounded-lg px-2 text-sm font-medium text-brand-600 transition hover:bg-brand-50"
        >
          {t('common.edit')}
        </button>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-700">
          {t('account.addressLabel')}
        </legend>
        <div className="flex gap-2">
          {labelSuggestions.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={props.label === option}
              onClick={() => props.onLabel(option)}
              className={cn(
                'min-h-11 rounded-xl border px-4 text-sm transition',
                props.label === option
                  ? 'border-brand-500 bg-brand-50 font-medium text-brand-700'
                  : 'border-ink-200 text-ink-600 hover:border-ink-300',
              )}
            >
              {option}
            </button>
          ))}
        </div>
        {!labelSuggestions.includes(props.label) && (
          <Input
            value={props.label}
            onChange={(event) => props.onLabel(event.target.value)}
            maxLength={40}
            aria-label={t('account.addressLabel')}
            className="mt-2"
          />
        )}
      </fieldset>

      <div className="space-y-4">
        <Select
          label={t('account.city')}
          value={props.regionId}
          onChange={(event) => props.onRegion(event.target.value)}
        >
          {props.regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name}
            </option>
          ))}
        </Select>

        {props.districts.length > 0 && (
          <Select
            label={t('account.district')}
            value={props.district}
            onChange={(event) => props.onDistrict(event.target.value)}
            hint={t('account.districtHint')}
          >
            <option value="">{t('account.districtChoose')}</option>
            {props.districts.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </Select>
        )}

        <Textarea
          label={t('account.addressLine')}
          value={props.line}
          onChange={(event) => props.onLine(event.target.value)}
          maxLength={300}
          placeholder={t('account.addressLinePlaceholder')}
          hint={t('account.addressLineWhy')}
        />
      </div>

      {/* Bina, mənzil, mərtəbə, şirkət — two columns on anything but the
          narrowest phone, because these are short answers and a column of
          four full-width boxes is a form that looks longer than it is. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label={t('address.building')}
          value={props.building}
          onChange={(event) => props.onBuilding(event.target.value)}
          maxLength={80}
        />
        <Input
          label={t('address.apartment')}
          value={props.apartment}
          onChange={(event) => props.onApartment(event.target.value)}
          maxLength={20}
          inputMode="numeric"
        />
        <Input
          label={t('address.floor')}
          value={props.floor}
          onChange={(event) => props.onFloor(event.target.value)}
          maxLength={20}
          inputMode="numeric"
        />
        {/*
          THE COMPANY FIELD ONLY WHERE A COMPANY MAKES SENSE.
          
          "Ev" is the default label and the one almost everybody keeps, and a
          field asking for a company name under it is a question with no answer
          — so it gets left blank on every address, and its presence makes the
          form longer for no gain.
          
          Shown for "İş" and for a label the customer typed themselves, since
          "Ofis" or "Anbar" are exactly the cases it exists for. Not deleted
          when it is hidden, and not hidden when it already has a value: an
          address saved with a company and later relabelled must not silently
          lose it.
        */}
        {props.showCompany && (
          <Input
            label={t('address.company')}
            value={props.company}
            onChange={(event) => props.onCompany(event.target.value)}
            maxLength={80}
          />
        )}
      </div>

      {/*
        Who opens the door.
        
        Grouped and given its own heading rather than dropped in among the
        floor numbers, because it is the one part of this form somebody ELSE
        depends on: a driver in the street reads the name and dials the number.
        The two fields belong together and the heading says what they are for.
      */}
      <fieldset className="space-y-4 rounded-2xl border border-ink-200 p-4">
        <legend className="px-1 text-sm font-medium text-ink-700">
          {t('address.contactLegend')}
        </legend>

        <Input
          label={t('address.contactName')}
          value={props.contactName}
          onChange={(event) => props.onContactName(event.target.value)}
          maxLength={CONTACT_NAME_MAX}
          autoComplete="name"
          /*
           * No placeholder.
           *
           * It used to show an invented name — "Elvin Məmmədov" — and a made-up
           * person's name sitting in a field is read as a value that is already
           * there rather than as an example. Somebody scanning the form moves
           * past it, and the address is saved with the wrong name on it. The
           * hint underneath says what to write, which is the honest place for
           * an instruction.
           */
          hint={t('address.contactNameHint')}
          error={
            props.contactName.trim().length > 0 && !isUsableContactName(props.contactName)
              ? t('address.contactNameShort')
              : null
          }
        />

        {/*
          THE NUMBER, AND A ONE-TAP WAY BACK TO YOUR OWN.
          
          Typing a different number is a real case — "my mother will take it" —
          but it is the minority one, and it is the one that costs an SMS and a
          code screen. Somebody who typed one by accident, or who tried a
          relative's number and changed their mind, previously had to remember
          their own number and retype it.
          
          The button also carries the whole answer when the platform cannot
          send a code at all: rather than letting the person save, reach the
          code screen and find out there, the hint says so HERE and the button
          fixes it in one tap.
        */}
        <div className="space-y-2">
          <PhoneInput
            label={t('address.phone')}
            value={props.phone}
            onChange={props.onPhone}
            hint={
              !props.willNeedCode
                ? t('address.phoneIsYours')
                : props.smsUnavailable
                  ? t('address.phoneCannotVerify')
                  : t('address.phoneNeedsCode')
            }
          />

          {props.ownPhone && props.willNeedCode && (
            <button
              type="button"
              onClick={() => props.onPhone(props.ownPhone!)}
              className={cn(
                'min-h-11 w-full rounded-xl border px-3 text-sm font-medium transition',
                props.smsUnavailable
                  ? 'border-warning bg-warning/10 font-semibold text-warning'
                  : 'border-ink-200 text-brand-600 hover:bg-brand-50',
              )}
            >
              {t('address.switchToOwnNumber', { phone: formatPhone(props.ownPhone) })}
            </button>
          )}
        </div>
      </fieldset>

      <Textarea
        label={t('address.courierNote')}
        value={props.note}
        onChange={(event) => props.onNote(event.target.value)}
        maxLength={200}
        placeholder={t('address.courierNotePlaceholder')}
        hint={t('address.courierNoteHint')}
      />

      <label className="flex min-h-11 items-center gap-2.5 text-[15px] text-ink-700">
        <input
          type="checkbox"
          checked={props.isDefault}
          onChange={(event) => props.onDefault(event.target.checked)}
          className="h-4 w-4 accent-brand-600"
        />
        {t('account.setDefault')}
      </label>

      {props.districtMissing && <Alert tone="warning">{t('errors.INVALID_DISTRICT')}</Alert>}
      {props.error && <Alert tone="danger">{props.error}</Alert>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — proving the number
// ---------------------------------------------------------------------------

/**
 * The code step.
 *
 * ONLY REACHED WHEN THE NUMBER IS NOT THE ACCOUNT'S OWN. Most people never see
 * this screen: they order to their own phone, that number was proved by SMS at
 * registration, and nothing more is asked of them. This is the "send it to my
 * mother's flat" case, and it exists because an unproved number on an address is
 * a way to send an unwanted courier to any phone in the country.
 *
 * The address is ALREADY SAVED when this opens. So there is no "cancel" that
 * loses work — leaving simply leaves the number unproved, the list says so, and
 * the checkout will ask for it before the order rather than after.
 */
function VerifyStep({
  phone,
  code,
  onCode,
  onComplete,
  onResend,
  sending,
  cooldown,
  error,
  unavailable,
}: {
  phone: string;
  code: string;
  onCode: (value: string) => void;
  onComplete: () => void;
  onResend: () => void;
  sending: boolean;
  cooldown: number;
  error: string | null;
  /** No gateway is configured: no code is coming, so none is asked for. */
  unavailable: boolean;
}) {
  const t = useT();

  /*
   * The dead-end case, given its own screen rather than an error on the normal
   * one. Showing six empty boxes under a message that says a code cannot be
   * sent is the shape of the bug this replaces.
   */
  if (unavailable) {
    return (
      <div className="space-y-4">
        <Alert tone="warning">
          <span className="block font-semibold">{t('address.smsUnavailableTitle')}</span>
          <span className="mt-1 block">{t('address.smsUnavailableBody')}</span>
        </Alert>
        <p className="text-sm text-ink-500">{t('address.verifyWhy')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-[15px] text-ink-700">
        {t('address.verifyIntro', { phone: formatPhone(phone) || phone })}
      </p>

      <OtpInput
        label={t('address.codeLabel')}
        value={code}
        onChange={onCode}
        onComplete={onComplete}
        invalid={Boolean(error)}
        disabled={sending}
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <button
        type="button"
        onClick={onResend}
        disabled={sending || cooldown > 0}
        className="min-h-11 w-full rounded-xl px-3 text-sm font-medium text-brand-600 transition hover:bg-brand-50 disabled:text-ink-400 disabled:hover:bg-transparent"
      >
        {cooldown > 0 ? t('address.resendIn', { seconds: String(cooldown) }) : t('address.resend')}
      </button>

      <p className="text-sm text-ink-400">{t('address.verifyWhy')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One saved address, in a list
// ---------------------------------------------------------------------------

/**
 * The row the owner's screenshots describe: the street on top, the city under
 * it, and the courier's note under that — "Adres Tarifi: giriş, kat soldan 1" —
 * because the note is the part the person recognises their own address by.
 *
 * The same row is used at the checkout with a radio and a delivery-range
 * notice, and in Ünvanlarım with a pencil and a bin. What changes is which
 * handlers are passed, never the shape.
 */
export function AddressRow({
  address,
  selected,
  onSelect,
  onEdit,
  onDelete,
  notice,
}: {
  address: Address;
  selected?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /**
   * A line the checkout puts under an address it cannot deliver to.
   *
   * Passed in rather than worked out here, because the answer depends on the
   * restaurant the basket belongs to and this row is used in three places that
   * have no restaurant at all. The row stays a row; only the sentence changes.
   */
  notice?: { tone: 'warning' | 'danger'; text: string } | null;
}) {
  const t = useT();
  const pinned = address.lat != null && address.lng != null;

  /*
   * The same three questions the checkout asks and the server enforces, asked
   * here so that the answer arrives before somebody has filled a basket.
   */
  const contact = addressDeliverable({
    contactName: address.contactName,
    phone: address.phone,
    phoneVerified: address.phoneVerified,
  });

  const detail = [
    address.building,
    address.apartment && t('account.apartmentShort', { value: address.apartment }),
    address.floor && t('account.floorShort', { value: address.floor }),
    address.company,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-2xl border p-4 transition',
        selected ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300',
      )}
    >
      {onSelect && (
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
            selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300',
          )}
        >
          {selected && <Check size={13} strokeWidth={3} />}
        </span>
      )}

      <button
        type="button"
        onClick={onSelect}
        aria-pressed={onSelect ? Boolean(selected) : undefined}
        className="min-w-0 flex-1 text-left"
        disabled={!onSelect}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink-900">{address.label}</span>
          {address.isDefault && (
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-500">
              {t('account.isDefault')}
            </span>
          )}
          {/* An address with no pin cannot be ordered to — `mayDeliverTo`
              refuses it — so this is a warning, not a badge. */}
          {!pinned && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
              <AlertTriangle size={11} aria-hidden />
              {t('address.needsPin')}
            </span>
          )}
          {/* The same kind of warning as a missing pin, and for the same
              reason: `createOrder` refuses an address whose contact is
              incomplete, so this is a blocker wearing a badge, not a hint. */}
          {!contact.ok && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
              <AlertTriangle size={11} aria-hidden />
              {contact.reason === 'UNVERIFIED'
                ? t('address.needsCode')
                : t('address.needsContact')}
            </span>
          )}
        </span>

        {/* The street line first and largest: it is what somebody reads. */}
        <span className="mt-1 block text-[15px] text-ink-800">{address.line}</span>
        {detail && <span className="block text-sm text-ink-600">{detail}</span>}
        <span className="block text-sm text-ink-500">
          {address.city}
          {address.district && ` · ${address.district}`}
        </span>
        {/* Who the courier asks for. Shown because an address whose contact is
            somebody else is exactly the address a person needs to recognise in
            a list of four. */}
        {address.contactName && (
          <span className="mt-1 block text-sm text-ink-600">
            {address.contactName}
            {address.phone ? ` · ${formatPhone(address.phone) || address.phone}` : ''}
          </span>
        )}

        {address.note && (
          <span className="mt-1 block text-sm text-ink-400">
            {t('address.noteLabel')}: {address.note}
          </span>
        )}

        {notice && (
          <span
            className={cn(
              'mt-2 flex items-start gap-1.5 rounded-xl px-2.5 py-1.5 text-sm',
              notice.tone === 'danger' ? 'bg-red-50 text-danger' : 'bg-amber-50 text-amber-700',
            )}
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            {notice.text}
          </span>
        )}
      </button>

      <div className="flex shrink-0 flex-col gap-1">
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={t('common.edit')}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-100"
          >
            <Pencil size={17} aria-hidden />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={t('common.delete')}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-400 transition hover:bg-red-50 hover:text-danger"
          >
            <Trash2 size={17} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
