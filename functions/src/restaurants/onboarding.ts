/**
 * QAPINDA — Restaurant onboarding and administration.
 *
 * A restaurant applies, a human approves, and only then does it appear to
 * customers. The commission rate lives in the private subdocument and can only
 * be changed by the platform, with a reason, into the audit log — a rate that
 * could be edited quietly is a rate no restaurant should agree to.
 */

import { onCall } from 'firebase-functions/v2/https';

import { auth, db, now, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import {
  requireActiveUser,
  requirePermission,
  requireRestaurantAccess,
  setUserClaims,
} from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { rebuildSettlement } from '../lib/settlement';
import { notify, notifyOperators as notifyPlatform } from '../lib/notify';
import { requireFreshKey } from '../lib/idempotency';
import {
  asObject,
  optionalBoolean,
  optionalEmail,
  optionalInt,
  optionalString,
  requireArray,
  requireEnum,
  requireInt,
  requirePhone,
  requireString,
} from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { mirrorRestaurantVisibility } from '../menu/visibility';
import { writeRestaurantInvite } from './invites';
import { checkDeliveryZones, type DeliveryZone } from '../shared/geo';
import { checkDayShifts } from '../shared/hours';
import {
  AuditAction,
  FulfillmentType,
  LedgerEntryType,
  NotificationType,
  PaymentMethod,
  PLATFORM_ROLES,
  RestaurantStatus,
  ServiceState,
  UserRole,
  DEFAULT_ENABLED_PAYMENT_METHODS,
  V1_PAYMENT_METHODS,
  AccountStatus,
} from '../shared/enums';
import {
  COLLECTIONS,
  paths,
  periodOf,
  restaurantApplicationIdempotencyKey,
} from '../shared/collections';
import { districtsOf, isValidDistrict, isValidRegion, regionName } from '../shared/regions';
import { normaliseFoodCategories } from '../shared/categories';
import { ADMIN_ROOT, Permission } from '../shared/permissions';
import { resolveNotificationPrefs } from '../shared/notifications';
import { restaurantMayDisableCodes } from '../shared/deliveryCode';
import { normaliseCuisines } from '../shared/cuisines';
import { normaliseStations } from '../shared/printStations';
import type { OpeningHours, PublicSettings, Restaurant, User } from '../shared/models';

const DEFAULT_COMMISSION_BPS = 1200;
const DEFAULT_RESPONSE_WINDOW_MIN = 10;

async function settings(): Promise<Partial<PublicSettings>> {
  const snapshot = await db.doc(paths.publicSettings()).get();
  return (snapshot.data() as PublicSettings | undefined) ?? {};
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * A sensible week for a restaurant an operator just typed in.
 *
 * 10:00–23:00 every day, which the owner will change within the hour. The point
 * is that the record is valid from the first second rather than carrying an
 * empty schedule the open/closed check would have to special-case.
 */
function defaultOpeningHours(): OpeningHours[] {
  return Array.from({ length: 7 }, (_, day) => ({
    day,
    closed: false,
    opensAt: 10 * 60,
    closesAt: 23 * 60,
  }));
}

function parseOpeningHours(input: unknown): OpeningHours[] {
  if (!Array.isArray(input)) fail(AppErrorCode.VALIDATION_FAILED, 'openingHours');

  /*
   * SEVEN ROWS USED TO BE THE RULE, AND THE DAY WAS THE INDEX.
   *
   * That is what made two shifts in a day impossible: a restaurant serving
   * lunch and dinner has eight rows, and the eighth would have been rejected
   * before it was read — or, worse, read as an eighth weekday. So the day is
   * now taken from the row itself, and the list is as long as it needs to be:
   * seven days, one or two shifts each.
   */
  if (input.length < 7 || input.length > 14) fail(AppErrorCode.VALIDATION_FAILED, 'openingHours');

  const rows: OpeningHours[] = input.map((entry) => {
    const row = entry as Record<string, unknown>;

    const day = typeof row.day === 'number' ? row.day : -1;
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      fail(AppErrorCode.VALIDATION_FAILED, 'openingHours.day');
    }

    const closed = row.closed === true;
    const opensAt = typeof row.opensAt === 'number' ? row.opensAt : 0;
    const closesAt = typeof row.closesAt === 'number' ? row.closesAt : 0;

    if (!closed) {
      const valid =
        Number.isInteger(opensAt) &&
        Number.isInteger(closesAt) &&
        opensAt >= 0 &&
        opensAt < 1440 &&
        closesAt > 0 &&
        closesAt <= 1440 + 360; // past midnight is allowed, up to 06:00
      if (!valid || closesAt <= opensAt) fail(AppErrorCode.VALIDATION_FAILED, 'openingHours');
    }

    return { day, opensAt, closesAt, closed };
  });

  /*
   * Every weekday must be present, and each day's shifts must make sense
   * together — checked with the SAME function the panel warns with, so a
   * restaurant is never told its hours are fine on screen and refused here.
   */
  for (let day = 0; day <= 6; day += 1) {
    const shifts = rows.filter((row) => row.day === day);
    if (shifts.length === 0) fail(AppErrorCode.VALIDATION_FAILED, 'openingHours.missing-day');

    const problem = checkDayShifts(shifts);
    if (problem) fail(AppErrorCode.VALIDATION_FAILED, `openingHours.${problem}`);
  }

  return rows;
}

/**
 * A restaurant owner applies to join.
 *
 * The applicant becomes RESTAURANT_OWNER immediately, but the restaurant is
 * PENDING_APPROVAL and invisible to customers — the role lets them build their
 * menu while they wait, not sell.
 */
export const applyForRestaurant = onCall(
  guard('applyForRestaurant', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    if (user.role !== UserRole.CUSTOMER) fail(AppErrorCode.ALREADY_APPLIED);

    const config = await settings();
    if (config.acceptingNewRestaurants === false) fail(AppErrorCode.FORBIDDEN, 'closed');

    const name = requireString(data, 'name', { min: 2, max: 60 });
    const legalName = requireString(data, 'legalName', { min: 2, max: 120 });
    const tagline = optionalString(data, 'tagline', { max: 120 }) ?? '';
    // Chosen from the closed region list; a typed city fragments the market.
    const regionId = requireString(data, 'regionId', { max: 40 });
    if (!isValidRegion(regionId)) fail(AppErrorCode.INVALID_REGION);

    const district = optionalString(data, 'district', { max: 60 });
    const districts = districtsOf(regionId);
    if (districts.length > 0 && (!district || !isValidDistrict(regionId, district))) {
      fail(AppErrorCode.INVALID_DISTRICT);
    }

    const city = regionName(regionId);
    const addressLine = requireString(data, 'addressLine', { min: 5, max: 300 });

    // The delivery circle needs a centre. Without one, "is this address in
    // range?" has no answer, so the map pin is mandatory.
    const lat = typeof data.lat === 'number' ? data.lat : null;
    const lng = typeof data.lng === 'number' ? data.lng : null;
    if (lat === null || lng === null) fail(AppErrorCode.VALIDATION_FAILED, 'location');
    const contactName = requireString(data, 'contactName', { min: 2, max: 80 });
    const contactPhone = requirePhone(data, 'contactPhone');
    const contactEmail = optionalEmail(data, 'contactEmail');
    const taxId = optionalString(data, 'taxId', { max: 40 });
    /*
     * The kitchen types, reduced to the platform's own list.
     *
     * `normaliseCuisines` drops anything unrecognised rather than refusing the
     * whole application: the picker cannot produce an invalid id, so a bad
     * value here is a hand-made request, and failing a restaurant's sign-up
     * over one is worse than signing them up with two kitchens instead of
     * three. Empty is allowed — the owner can pick them in the panel later.
     */
    const cuisines = normaliseCuisines(data.cuisines);
    // Anything that is not one of the platform's category ids is dropped rather
    // than refused: the closed list is ours, and an applicant should not have an
    // application rejected because a stale client sent an id we have retired.
    const categories = normaliseFoodCategories(data.categories);

    const minOrderAmount = requireInt(data, 'minOrderAmount', { min: 0, max: 100_000 });
    const deliveryFee = requireInt(data, 'deliveryFee', { min: 0, max: 50_000 });
    const freeDeliveryThreshold = optionalInt(data, 'freeDeliveryThreshold', {
      min: 0,
      max: 1_000_000,
    });
    const estimatedMinutesMin = requireInt(data, 'estimatedMinutesMin', { min: 5, max: 180 });
    const estimatedMinutesMax = requireInt(data, 'estimatedMinutesMax', { min: 5, max: 240 });
    if (estimatedMinutesMax < estimatedMinutesMin) {
      fail(AppErrorCode.VALIDATION_FAILED, 'estimatedMinutes');
    }

    const deliveryRadiusMeters = requireInt(data, 'deliveryRadiusMeters', {
      min: 500,
      max: 30_000,
    });

    // Only the methods the platform allows, and in V1 that is cash and card at
    // the door. An applicant cannot opt into online payment before it exists.
    const requested = requireArray<string>(data, 'paymentMethods', { max: 3 });
    const allowed: PaymentMethod[] = (config.enabledPaymentMethods ?? V1_PAYMENT_METHODS).filter(
      (method) => V1_PAYMENT_METHODS.includes(method),
    );
    const paymentMethods = requested.filter((method): method is PaymentMethod =>
      allowed.includes(method as PaymentMethod),
    );
    if (paymentMethods.length === 0) fail(AppErrorCode.VALIDATION_FAILED, 'paymentMethods');

    const openingHours = parseOpeningHours(data.openingHours);
    const brandColor = optionalString(data, 'brandColor', { max: 9 }) ?? '#B4321F';

    await requireFreshKey(
      restaurantApplicationIdempotencyKey(caller.uid),
      'applyForRestaurant',
    );

    const restaurantRef = db.collection(COLLECTIONS.restaurants).doc();

    const restaurant: Omit<Restaurant, 'createdAt' | 'updatedAt'> = {
      id: restaurantRef.id,
      name,
      slug: `${slugify(name)}-${restaurantRef.id.slice(0, 5).toLowerCase()}`,
      tagline,
      cuisines,
      categories,
      status: RestaurantStatus.PENDING_APPROVAL,
      serviceState: ServiceState.CLOSED,
      regionId,
      district: districts.length > 0 ? district : null,
      city,
      addressLine,
      lat,
      lng,
      deliveryRadiusMeters,
      publicPhone: contactPhone,
      logoUrl: null,
      coverUrl: null,
      brandColor,
      minOrderAmount,
      deliveryFee,
      freeDeliveryThreshold,
      estimatedMinutesMin,
      estimatedMinutesMax,
      paymentMethods,
      // The restaurant delivers with its own driver. There is no platform fleet.
      fulfillmentTypes: [FulfillmentType.DELIVERY],
      /*
       * Handover codes ON for a new restaurant.
       *
       * The switch belongs to the restaurant — see `shared/deliveryCode.ts` —
       * but the DEFAULT is the platform's decision, and it is on. A shop that
       * has not thought about this yet is a shop with no answer for its first
       * "nobody delivered it" argument, and that first argument is exactly when
       * a new restaurant can least afford one. Turning it off stays a
       * deliberate choice its owner makes in Ayarlar.
       */
      requireDeliveryCode: true,
      openingHours,
      ratingAverage: 0,
      ratingCount: 0,
      completedOrderCount: 0,
      ownerUserId: caller.uid,
      approvedAt: null,
      approvedBy: null,
    };

    const batch = db.batch();
    batch.set(restaurantRef, { ...restaurant, createdAt: now(), updatedAt: now() });
    batch.set(db.doc(paths.restaurantBusiness(restaurantRef.id)), {
      legalName,
      taxId,
      contactName,
      contactPhone,
      contactEmail,
      commissionRateBps: config.defaultCommissionRateBps ?? DEFAULT_COMMISSION_BPS,
      responseWindowMinutes:
        config.defaultResponseWindowMinutes ?? DEFAULT_RESPONSE_WINDOW_MIN,
      notes: null,
      updatedAt: now(),
      updatedBy: caller.uid,
    });
    batch.update(db.doc(paths.user(caller.uid)), {
      role: UserRole.RESTAURANT_OWNER,
      restaurantId: restaurantRef.id,
      updatedAt: now(),
    });
    await batch.commit();

    await setUserClaims(caller.uid, UserRole.RESTAURANT_OWNER, restaurantRef.id);

    await writeAudit({
      actorId: caller.uid,
      actorRole: UserRole.RESTAURANT_OWNER,
      action: AuditAction.RESTAURANT_APPLIED,
      targetType: 'restaurant',
      targetId: restaurantRef.id,
      restaurantId: restaurantRef.id,
      newValue: { name, city },
      ip: request.rawRequest.ip ?? null,
    });

    /*
     * The admin is told, because until now nobody was.
     *
     * An application sits in PENDING_APPROVAL until a person opens it, and the
     * only thing that made that happen was somebody thinking to look at the
     * Restoranlar page. It is one of the four notifications the admin kept.
     * Fanned out through the platform roster: the type's audience is ADMIN
     * alone, so an operator on the same roster is filtered out by
     * `roleMayReceive` rather than by this call site.
     */
    await notifyPlatform({
      type: NotificationType.RESTAURANT_APPLICATION_RECEIVED,
      restaurantId: restaurantRef.id,
      params: { name, city },
      link: `${ADMIN_ROOT}/restaurants`,
    }).catch(() => undefined);

    return { ok: true, restaurantId: restaurantRef.id };
  }),
);

/**
 * An operator signing a restaurant up on their behalf.
 *
 * The normal route is the restaurant applying itself, and that stays the better
 * route — the owner types their own legal name and drops their own pin. But
 * most of these deals are closed on the phone or across a table, and forcing
 * the owner through a web form afterwards loses half of them.
 *
 * So this exists, deliberately narrow:
 *  - it asks only for what the platform genuinely needs to start taking orders;
 *  - the restaurant is created ACTIVE but CLOSED, so it appears in the panel and
 *    nowhere else until its owner opens it;
 *  - the owner is matched by phone number. If nobody has registered with that
 *    number yet, the restaurant is created ownerless and the first person to
 *    register with it is linked by `claimRestaurant` — an operator must never
 *    be able to point a restaurant at an arbitrary account.
 */
export const createRestaurantByAdmin = onCall(
  guard('createRestaurantByAdmin', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_APPROVE_RESTAURANT);

    const data = asObject(request.data);

    const name = requireString(data, 'name', { min: 2, max: 60 });
    const legalName = optionalString(data, 'legalName', { max: 120 }) ?? name;
    const regionId = requireString(data, 'regionId', { max: 40 });
    if (!isValidRegion(regionId)) fail(AppErrorCode.INVALID_REGION);

    const district = optionalString(data, 'district', { max: 60 });
    const districts = districtsOf(regionId);
    if (districts.length > 0 && (!district || !isValidDistrict(regionId, district))) {
      fail(AppErrorCode.INVALID_DISTRICT);
    }

    const addressLine = requireString(data, 'addressLine', { min: 5, max: 300 });
    const lat = typeof data.lat === 'number' ? data.lat : null;
    const lng = typeof data.lng === 'number' ? data.lng : null;
    if (lat === null || lng === null) fail(AppErrorCode.VALIDATION_FAILED, 'location');

    const ownerPhone = requirePhone(data, 'ownerPhone');
    const contactName = optionalString(data, 'contactName', { max: 80 }) ?? name;
    const commissionRateBps = optionalInt(data, 'commissionRateBps', { min: 0, max: 5000 });

    const config = await settings();

    // Match the owner by phone, and only by phone: the number is the identity
    // in this platform, so there is no way to attach a restaurant to somebody
    // who never claimed that number.
    const owners = await db
      .collection(COLLECTIONS.users)
      .where('phone', '==', ownerPhone)
      .limit(1)
      .get();

    const ownerDoc = owners.empty ? null : owners.docs[0];
    const ownerId = ownerDoc?.id ?? '';

    if (ownerDoc) {
      const ownerUser = ownerDoc.data() as { role?: string; restaurantId?: string | null };
      // Somebody who already runs a restaurant cannot be handed a second one:
      // the role and the claim hold exactly one restaurantId.
      if (ownerUser.role && ownerUser.role !== UserRole.CUSTOMER) {
        fail(AppErrorCode.ALREADY_APPLIED);
      }
    }

    const restaurantRef = db.collection(COLLECTIONS.restaurants).doc();

    const restaurant = {
      id: restaurantRef.id,
      name,
      slug: `${slugify(name)}-${restaurantRef.id.slice(0, 5).toLowerCase()}`,
      tagline: '',
      cuisines: [],
      categories: [],
      status: RestaurantStatus.ACTIVE,
      // Active but shut: it exists, the owner can set it up, and no customer
      // sees an empty menu in the meantime.
      serviceState: ServiceState.CLOSED,
      regionId,
      district: districts.length > 0 ? district : null,
      city: regionName(regionId),
      addressLine,
      lat,
      lng,
      deliveryRadiusMeters: 5000,
      publicPhone: ownerPhone,
      logoUrl: null,
      coverUrl: null,
      brandColor: '#b4321f',
      minOrderAmount: 0,
      deliveryFee: 0,
      freeDeliveryThreshold: null,
      estimatedMinutesMin: 30,
      estimatedMinutesMax: 60,
      // The two settled at the door. Online card is switched on per restaurant
      // once the platform actually has a payment provider behind it — signing a
      // new shop up to a payment nobody can take is a dead end at checkout.
      paymentMethods: [...DEFAULT_ENABLED_PAYMENT_METHODS],
      fulfillmentTypes: [FulfillmentType.DELIVERY],
      // On by default, and the restaurant's to switch off. See the note on the
      // application path above.
      requireDeliveryCode: true,
      openingHours: defaultOpeningHours(),
      ratingAverage: 0,
      ratingCount: 0,
      completedOrderCount: 0,
      ownerUserId: ownerId,
      approvedAt: now(),
      approvedBy: caller.uid,
    } as unknown as Restaurant;

    const batch = db.batch();
    batch.set(restaurantRef, { ...restaurant, createdAt: now(), updatedAt: now() });
    batch.set(db.doc(paths.restaurantBusiness(restaurantRef.id)), {
      legalName,
      taxId: null,
      contactName,
      contactPhone: ownerPhone,
      contactEmail: null,
      commissionRateBps: commissionRateBps ?? config.defaultCommissionRateBps ?? DEFAULT_COMMISSION_BPS,
      responseWindowMinutes: config.defaultResponseWindowMinutes ?? DEFAULT_RESPONSE_WINDOW_MIN,
      notes: 'Admin tərəfindən yaradıldı',
      updatedAt: now(),
      updatedBy: caller.uid,
    });

    if (ownerDoc) {
      batch.update(ownerDoc.ref, {
        role: UserRole.RESTAURANT_OWNER,
        restaurantId: restaurantRef.id,
        updatedAt: now(),
      });
    }

    await batch.commit();

    if (ownerDoc) await setUserClaims(ownerDoc.id, UserRole.RESTAURANT_OWNER, restaurantRef.id);

    await writeAudit({
      actorId: caller.uid,
      actorRole: actor.role,
      action: AuditAction.RESTAURANT_APPROVED,
      targetType: 'restaurant',
      targetId: restaurantRef.id,
      restaurantId: restaurantRef.id,
      newValue: { name, createdByAdmin: true, ownerLinked: Boolean(ownerDoc) },
      reason: 'Admin tərəfindən əlavə edildi',
    });

    return { ok: true, restaurantId: restaurantRef.id, ownerLinked: Boolean(ownerDoc) };
  }),
);

/** Approves an application and makes the restaurant visible. */
export const approveRestaurant = onCall(
  guard('approveRestaurant', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_APPROVE_RESTAURANT);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const commissionRateBps = optionalInt(data, 'commissionRateBps', { min: 0, max: 5000 });

    const ref = db.doc(paths.restaurant(restaurantId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
    const restaurant = snapshot.data() as Restaurant;

    if (restaurant.status === RestaurantStatus.ACTIVE) return { ok: true, alreadyActive: true };

    const batch = db.batch();
    batch.update(ref, {
      status: RestaurantStatus.ACTIVE,
      approvedAt: now(),
      approvedBy: caller.uid,
      updatedAt: now(),
    });
    if (commissionRateBps !== null) {
      batch.update(db.doc(paths.restaurantBusiness(restaurantId)), {
        commissionRateBps,
        updatedAt: now(),
        updatedBy: caller.uid,
      });
    }
    await batch.commit();

    await Promise.all([
      writeAudit({
        actorId: caller.uid,
        actorRole: actor.role,
        action: AuditAction.RESTAURANT_APPROVED,
        targetType: 'restaurant',
        targetId: restaurantId,
        restaurantId,
        oldValue: { status: restaurant.status },
        newValue: { status: RestaurantStatus.ACTIVE, commissionRateBps },
        ip: request.rawRequest.ip ?? null,
      }),
      notify({
        userId: restaurant.ownerUserId,
        restaurantId,
        role: UserRole.RESTAURANT_OWNER,
        type: NotificationType.RESTAURANT_APPROVED,
        params: { name: restaurant.name },
        link: '/panel',
      }),
    ]);

    /*
     * TELLING THE PEOPLE WHO ASKED TO BE TOLD.
     *
     * "Yeni restoranlar" has been a switch on the customer's settings screen
     * since launch with nothing behind it — a control that changed nothing,
     * which is worse than a missing one because it teaches people the settings
     * are decorative. This is the sender it was always waiting for.
     *
     * Only the customers who turned it on, and only in this restaurant's own
     * region: "a new place opened near you" is the promise, and a message about
     * a kebab shop four cities away is exactly the noise that gets an app
     * muted. Off by default, so nobody receives one by accident.
     *
     * Sent after the transaction and never awaited into the caller's answer —
     * approving a restaurant must not fail because a notification did.
     */
    void announceNewRestaurant(restaurantId, restaurant.name, restaurant.regionId).catch(
      (error) => console.error('new restaurant announcement failed', error),
    );

    // The menu becomes public with the restaurant. A shop approved after having
    // been rejected already has dishes, and they carry `restaurantVisible:
    // false` from that rejection until this puts it back.
    await mirrorRestaurantVisibility(restaurantId, true);

    return { ok: true };
  }),
);

/**
 * "A new place opened near you."
 *
 * Written in one batch rather than one call per customer: a region with two
 * thousand opted-in customers is four batched commits, not two thousand
 * round trips, and the whole thing has to finish inside one function.
 *
 * Capped, deliberately. Beyond the cap the announcement simply reaches fewer
 * people, which is the right failure for a courtesy message — the alternative
 * is a function that times out halfway and leaves a partial send nobody can
 * tell apart from a complete one.
 */
async function announceNewRestaurant(
  restaurantId: string,
  name: string,
  regionId: string,
): Promise<void> {
  const audience = await db
    .collection(COLLECTIONS.users)
    .where('role', '==', UserRole.CUSTOMER)
    .where('accountStatus', '==', AccountStatus.ACTIVE)
    .where('lastRegionId', '==', regionId)
    .limit(2000)
    .get();

  if (audience.empty) return;

  let sent = 0;

  for (const doc of audience.docs) {
    const customer = doc.data() as User;

    // The shared resolver, so the screen's switch and this sender can never
    // disagree about what "off by default" means for an account that has
    // never opened settings.
    const prefs = resolveNotificationPrefs(customer.notificationPrefs, UserRole.CUSTOMER);
    if (prefs.newRestaurants !== true) continue;

    await notify({
      userId: customer.uid,
      role: UserRole.CUSTOMER,
      restaurantId,
      type: NotificationType.NEW_RESTAURANT_AVAILABLE,
      params: { name },
      /*
       * The restaurant's own page, by id.
       *
       * `/restaurant/[handle]` accepts an id as readily as a slug, so this
       * lands somewhere real without this function having to look the slug up.
       * It used to point at the bare root, which has no page of its own and
       * never did — tapping the notification opened a 404.
       */
      link: `/restaurant/${restaurantId}`,
    }).catch(() => undefined);

    sent += 1;
  }

  console.info('new restaurant announced', { restaurantId, regionId, sent });
}

export const rejectRestaurant = onCall(
  guard('rejectRestaurant', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_APPROVE_RESTAURANT);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const reason = requireString(data, 'reason', { min: 10, max: 500 });

    const ref = db.doc(paths.restaurant(restaurantId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
    const restaurant = snapshot.data() as Restaurant;

    await ref.update({
      status: RestaurantStatus.REJECTED,
      serviceState: ServiceState.CLOSED,
      updatedAt: now(),
    });

    await Promise.all([
      writeAudit({
        actorId: caller.uid,
        actorRole: actor.role,
        action: AuditAction.RESTAURANT_REJECTED,
        targetType: 'restaurant',
        targetId: restaurantId,
        restaurantId,
        oldValue: { status: restaurant.status },
        newValue: { status: RestaurantStatus.REJECTED },
        reason,
      }),
      notify({
        userId: restaurant.ownerUserId,
        restaurantId,
        role: UserRole.RESTAURANT_OWNER,
        type: NotificationType.RESTAURANT_REJECTED,
        params: { name: restaurant.name, reason },
      }),
    ]);

    // A rejected application's dishes are not a menu anybody may read.
    await mirrorRestaurantVisibility(restaurantId, false);

    return { ok: true };
  }),
);

/** Hides a restaurant from customers without deleting anything. */
export const setRestaurantStatus = onCall(
  guard('setRestaurantStatus', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_SUSPEND_RESTAURANT);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const status = requireEnum<RestaurantStatus>(data, 'status', [
      RestaurantStatus.ACTIVE,
      RestaurantStatus.SUSPENDED,
    ]);
    const reason = requireString(data, 'reason', { min: 10, max: 500 });

    const ref = db.doc(paths.restaurant(restaurantId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
    const restaurant = snapshot.data() as Restaurant;

    await ref.update({
      status,
      // A suspended restaurant must not keep taking orders while it is hidden.
      serviceState: status === RestaurantStatus.ACTIVE ? restaurant.serviceState : ServiceState.CLOSED,
      updatedAt: now(),
    });

    /*
     * And its DISHES stop being public with it.
     *
     * Hiding the restaurant used to hide only the restaurant. `products` allowed
     * a read of anything not HIDDEN, and a restaurantId appears in every URL the
     * shop ever had — so the menu of a suspended restaurant stayed readable to
     * anyone who asked for it directly. See menu/visibility.ts for why this is a
     * mirrored field rather than a lookup inside the rule.
     */
    await mirrorRestaurantVisibility(restaurantId, status === RestaurantStatus.ACTIVE);

    await writeAudit({
      actorId: caller.uid,
      actorRole: actor.role,
      action: AuditAction.RESTAURANT_SUSPENDED,
      targetType: 'restaurant',
      targetId: restaurantId,
      restaurantId,
      oldValue: { status: restaurant.status },
      newValue: { status },
      reason,
    });

    return { ok: true };
  }),
);

/** Changes the commission rate. Platform only, reasoned, audited. */
export const setCommissionRate = onCall(
  guard('setCommissionRate', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_SET_COMMISSION);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const commissionRateBps = requireInt(data, 'commissionRateBps', { min: 0, max: 5000 });
    const reason = requireString(data, 'reason', { min: 10, max: 300 });

    const ref = db.doc(paths.restaurantBusiness(restaurantId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
    const previous = snapshot.data()?.commissionRateBps ?? null;

    await ref.update({ commissionRateBps, updatedAt: now(), updatedBy: caller.uid });

    await writeAudit({
      actorId: caller.uid,
      actorRole: actor.role,
      action: AuditAction.RESTAURANT_COMMISSION_CHANGED,
      targetType: 'restaurant',
      targetId: restaurantId,
      restaurantId,
      oldValue: { commissionRateBps: previous },
      newValue: { commissionRateBps },
      reason,
    });

    // Orders already placed keep the rate they were placed at — see
    // `order.commissionRateBps`. This only affects what comes next.
    return { ok: true };
  }),
);

/**
 * Puts a restaurant forward on the shopfront, or takes it back down.
 *
 * The only badge that is stored, because it is the only one that is a decision:
 * "new" is a date and "popular" is a count, and both are computed from fields
 * the restaurant document already has — see `shared/badges.ts`. A stored copy
 * of either would be a number to keep fresh and a way for it to be wrong.
 *
 * A written reason is required for the same reason it is on every other admin
 * action here: this one changes what customers are shown first, and "who made
 * this restaurant featured, when, and why" is a question somebody will ask.
 */
export const setRestaurantFeatured = onCall(
  guard('setRestaurantFeatured', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    // The same permission that approves and suspends: deciding what the
    // shopfront leads with is the same kind of authority.
    requirePermission(caller, Permission.PLATFORM_APPROVE_RESTAURANT);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const featured = data.featured === true;
    const reason = requireString(data, 'reason', { min: 10, max: 300 });

    /*
     * Bought, or given?
     *
     * The default is EDITORIAL — the platform's own pick, free, and shown as a
     * recommendation. A caller has to ask for SPONSORED, and asking for it
     * changes what the customer reads: "Reklam", never "Seçilmiş". Selling a
     * slot and presenting it as the platform's own recommendation is telling
     * customers something untrue about the one thing they use the ordering to
     * judge, and it is the only part of this feature that cannot be undone by
     * an apology.
     */
    const sponsored = data.kind === 'SPONSORED';

    /*
     * When it ends. Required for a sold slot, optional for a free one.
     *
     * `featured` was a bare boolean, and a bare boolean is switched off by
     * somebody who remembers. Nobody remembers. A restaurant that paid for
     * March would still be on top in August, and the person it displaced would
     * never know why. So money buys a dated slot or it buys nothing.
     */
    const untilMs = optionalInt(data, 'untilMs', { min: 0, max: 4_102_444_800_000 });
    if (featured && sponsored && untilMs === null) {
      fail(AppErrorCode.VALIDATION_FAILED, 'untilMs');
    }
    if (untilMs !== null && untilMs <= Date.now()) {
      fail(AppErrorCode.VALIDATION_FAILED, 'untilMs-past');
    }

    /*
     * What it costs, in qəpik. Optional even for a sold slot — the first ones
     * are negotiated over a phone call and sometimes given away to open the
     * door, and a required price would force an operator to type a lie.
     */
    const feeAmount = optionalInt(data, 'feeAmount', { min: 0, max: 1_000_000 });

    const ref = db.doc(paths.restaurant(restaurantId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);

    const restaurant = snapshot.data() as Restaurant;
    // A restaurant that is not live cannot be promoted on a screen it does not
    // appear on, and a featured badge waiting for an approval is a surprise.
    if (featured && restaurant.status !== RestaurantStatus.ACTIVE) {
      fail(AppErrorCode.RESTAURANT_NOT_ACTIVE);
    }

    await ref.update({
      featured,
      // Cleared rather than left behind when the promotion ends, so a document
      // can never claim to be sponsored and not promoted at the same time.
      featuredKind: featured ? (sponsored ? 'SPONSORED' : 'EDITORIAL') : null,
      featuredUntil: featured && untilMs !== null ? Timestamp.fromMillis(untilMs) : null,
      updatedAt: now(),
    });

    /*
     * The fee, as a ledger entry — and nothing more.
     *
     * No new money machinery at all: the monthly settlement already folds every
     * ledger entry into what the restaurant owes, so an advert is collected
     * alongside the commission on the same invoice. That is the whole reason
     * the price is a flat monthly figure rather than a cost per click: clicks
     * would need impression counting, click attribution and a billing cycle of
     * their own, and none of those exist.
     *
     * Positive, because the sign convention is "the restaurant owes the
     * platform" — the same direction as commission.
     */
    let feePosted = false;
    if (featured && sponsored && feeAmount !== null && feeAmount > 0) {
      const period = periodOf(new Date());
      const key = `sponsorship:${restaurantId}:${period}`;
      const entryRef = db.doc(paths.ledgerEntry(key));

      // `create` rather than `set`: two adverts sold to one restaurant in one
      // month is a mistake somebody should see, not a silent double charge.
      await entryRef
        .create({
          id: key,
          restaurantId,
          period,
          orderId: null,
          type: LedgerEntryType.ADJUSTMENT,
          amount: feeAmount,
          currency: 'AZN',
          description: `Reklam yerləşdirməsi · ${period}`,
          idempotencyKey: key,
          createdBy: caller.uid,
          createdAt: now(),
        })
        .then(() => {
          feePosted = true;
        })
        .catch(() => {
          // Already charged this month. The promotion still applies; only the
          // second invoice line is refused.
        });

      if (feePosted) await rebuildSettlement(restaurantId, period);
    }

    await writeAudit({
      actorId: caller.uid,
      actorRole: actor.role,
      action: AuditAction.RESTAURANT_FEATURED,
      targetType: 'restaurant',
      targetId: restaurantId,
      restaurantId,
      oldValue: {
        featured: restaurant.featured === true,
        kind: restaurant.featuredKind ?? null,
      },
      newValue: {
        featured,
        kind: featured ? (sponsored ? 'SPONSORED' : 'EDITORIAL') : null,
        untilMs,
        feeAmount: feePosted ? feeAmount : null,
      },
      reason,
    });

    return { ok: true, featured, sponsored, feePosted };
  }),
);

/** The restaurant edits its own shopfront. */

/**
 * Reads and validates a set of delivery bands.
 *
 * Every number is re-read here rather than trusted: a fee is money, a distance
 * decides which fee applies, and both arrive from a browser.
 */
function parseDeliveryZones(input: unknown): DeliveryZone[] | null {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input)) fail(AppErrorCode.VALIDATION_FAILED, 'deliveryZones');
  if (input.length === 0) return null;
  if (input.length > 5) fail(AppErrorCode.VALIDATION_FAILED, 'deliveryZones.too-many');

  const zones = input.map((raw) => {
    const zone = raw as Record<string, unknown>;

    const number = (key: string, max: number): number => {
      const value = zone[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
        fail(AppErrorCode.VALIDATION_FAILED, `deliveryZones.${key}`);
      }
      return value;
    };

    const minimum = zone.minOrderAmount;
    if (minimum !== null && minimum !== undefined) {
      if (typeof minimum !== 'number' || !Number.isInteger(minimum) || minimum < 0) {
        fail(AppErrorCode.VALIDATION_FAILED, 'deliveryZones.minOrderAmount');
      }
    }

    return {
      fromMetres: number('fromMetres', 100_000),
      toMetres: number('toMetres', 100_000),
      fee: number('fee', 100_000),
      minOrderAmount: (minimum as number | null | undefined) ?? null,
    };
  });

  // The shared rule, so the panel and the server refuse the same shapes.
  const problem = checkDeliveryZones(zones);
  if (problem) fail(AppErrorCode.VALIDATION_FAILED, `deliveryZones.${problem}`);

  return zones;
}

export const updateRestaurantProfile = onCall(
  guard('updateRestaurantProfile', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });

    requireRestaurantAccess(caller, Permission.RESTAURANT_EDIT_PROFILE, restaurantId);

    const ref = db.doc(paths.restaurant(restaurantId));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);

    // Only these fields, and never status, commission, ratings or ownership.
    const update: Record<string, unknown> = { updatedAt: now() };

    const name = optionalString(data, 'name', { max: 60 });
    if (name) update.name = name;

    const tagline = optionalString(data, 'tagline', { max: 120 });
    if (tagline !== null) update.tagline = tagline;

    if (data.cuisines !== undefined) {
      /*
       * Closed list, capped at three, ordered by the list rather than by the
       * order they were ticked — so two restaurants that chose the same
       * kitchens describe themselves identically, which is what makes the home
       * page's filter row stable. See `shared/cuisines.ts`.
       *
       * This also quietly retires the free text: the first time an owner saves
       * this screen, whatever was typed months ago is replaced by real ids.
       */
      update.cuisines = normaliseCuisines(data.cuisines);
    }
    if (data.categories !== undefined) {
      update.categories = normaliseFoodCategories(data.categories);
    }
    if (data.addressLine !== undefined) {
      update.addressLine = requireString(data, 'addressLine', { min: 5, max: 300 });
    }
    if (data.regionId !== undefined) {
      const nextRegion = requireString(data, 'regionId', { max: 40 });
      if (!isValidRegion(nextRegion)) fail(AppErrorCode.INVALID_REGION);

      const nextDistricts = districtsOf(nextRegion);
      const nextDistrict = optionalString(data, 'district', { max: 60 });
      if (nextDistricts.length > 0 && (!nextDistrict || !isValidDistrict(nextRegion, nextDistrict))) {
        fail(AppErrorCode.INVALID_DISTRICT);
      }

      update.regionId = nextRegion;
      update.district = nextDistricts.length > 0 ? nextDistrict : null;
      update.city = regionName(nextRegion);
    }
    // Moving the pin moves the delivery circle, so both travel together.
    if (typeof data.lat === 'number' && typeof data.lng === 'number') {
      update.lat = data.lat;
      update.lng = data.lng;
    }
    if (data.minOrderAmount !== undefined) {
      update.minOrderAmount = requireInt(data, 'minOrderAmount', { min: 0, max: 100_000 });
    }
    if (data.deliveryFee !== undefined) {
      update.deliveryFee = requireInt(data, 'deliveryFee', { min: 0, max: 50_000 });
    }
    if (data.freeDeliveryThreshold !== undefined) {
      update.freeDeliveryThreshold = optionalInt(data, 'freeDeliveryThreshold', {
        min: 0,
        max: 1_000_000,
      });
    }
    if (data.estimatedMinutesMin !== undefined) {
      update.estimatedMinutesMin = requireInt(data, 'estimatedMinutesMin', { min: 5, max: 180 });
    }
    if (data.estimatedMinutesMax !== undefined) {
      update.estimatedMinutesMax = requireInt(data, 'estimatedMinutesMax', { min: 5, max: 240 });
    }
    if (data.deliveryRadiusMeters !== undefined) {
      update.deliveryRadiusMeters = requireInt(data, 'deliveryRadiusMeters', {
        min: 500,
        max: 30_000,
      });
    }
    /*
     * Delivery bands, checked by the same function the panel checks with.
     *
     * Refused rather than repaired: a set of bands with a hole in it is a
     * restaurant that meant something specific and typed it wrong, and quietly
     * "fixing" it here would price deliveries by a rule nobody chose. `null`
     * and `[]` both mean "no bands", which is the state every restaurant on the
     * platform is in today and a perfectly good one to stay in.
     */
    if (data.deliveryZones !== undefined) {
      update.deliveryZones = parseDeliveryZones(data.deliveryZones);
    }

    if (data.openingHours !== undefined) update.openingHours = parseOpeningHours(data.openingHours);
    if (data.publicPhone !== undefined) {
      update.publicPhone = optionalString(data, 'publicPhone', { max: 32 }) ?? '';
    }
    if (data.logoUrl !== undefined) update.logoUrl = optionalString(data, 'logoUrl', { max: 500 });
    if (data.coverUrl !== undefined) update.coverUrl = optionalString(data, 'coverUrl', { max: 500 });
    if (data.brandColor !== undefined) {
      update.brandColor = optionalString(data, 'brandColor', { max: 9 }) ?? '#B4321F';
    }

    if (data.paymentMethods !== undefined) {
      const config = await settings();
      // The platform's list decides what a restaurant may tick. The fallback is
      // the two methods settled at the door, never the full V1 list: a settings
      // document that has never been written must not be read as "online card
      // is available", because online card needs a provider the server may not
      // have.
      const allowed = (config.enabledPaymentMethods ?? DEFAULT_ENABLED_PAYMENT_METHODS).filter(
        (method) => V1_PAYMENT_METHODS.includes(method),
      );
      const requested = requireArray<string>(data, 'paymentMethods', { max: 3 });
      const methods = requested.filter((method): method is PaymentMethod =>
        allowed.includes(method as PaymentMethod),
      );
      if (methods.length === 0) fail(AppErrorCode.VALIDATION_FAILED, 'paymentMethods');
      update.paymentMethods = methods;
    }

    // Off by default. A restaurant opts in for itself — see the field's own
    // comment in shared/models.ts for the trade-off it is accepting.
    /*
     * The restaurant's own handover-code switch — which it may raise but not
     * lower.
     *
     * While the platform's policy is ALWAYS the field is simply not written.
     * Not refused: the settings form posts every field it holds on every save,
     * so refusing here would make an unrelated change to the opening hours fail
     * with a validation error about a switch the restaurant cannot see. What
     * the restaurant stores makes no difference under ALWAYS either way —
     * `deliveryCodeRequired` reads the platform first — so ignoring it is both
     * the safe answer and the honest one.
     */
    /*
     * The print stations.
     *
     * `normaliseStations` is the same function the panel renders through, so a
     * station that would not draw cannot be stored: no id, no name, an unknown
     * kind, a duplicate id, more than the cap. Anything unusable is dropped
     * rather than failing the save — the editor cannot produce it, so a bad
     * value here is a hand-made request, and refusing the whole settings screen
     * over one malformed station would be a worse answer than storing the three
     * good ones.
     */
    if (data.printStations !== undefined) {
      update.printStations = normaliseStations(data.printStations);
    }

    if (data.requireDeliveryCode !== undefined) {
      if (restaurantMayDisableCodes(await settings())) {
        update.requireDeliveryCode = optionalBoolean(data, 'requireDeliveryCode', false);
      }
    }

    await ref.update(update);
    return { ok: true };
  }),
);

/** Adds or removes a staff member. Owner only, and always inside the tenant. */
export const setRestaurantStaff = onCall(
  guard('setRestaurantStaff', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });

    requireRestaurantAccess(caller, Permission.RESTAURANT_MANAGE_STAFF, restaurantId);

    const phone = requirePhone(data, 'phone');
    const role = requireEnum<UserRole>(data, 'role', [
      UserRole.RESTAURANT_MANAGER,
      UserRole.RESTAURANT_STAFF,
      // A driver, not staff — added the same way, but see RESTAURANT_ROLES:
      // this account never gains the permissions the other three carry.
      UserRole.RESTAURANT_COURIER,
      UserRole.CUSTOMER, // removing someone from the team
    ]);

    const matches = await db
      .collection(COLLECTIONS.users)
      .where('phone', '==', phone)
      .limit(1)
      .get();
    if (matches.empty) fail(AppErrorCode.NOT_FOUND, 'user');

    const targetDoc = matches.docs[0];
    const target = targetDoc.data() as { role: UserRole; restaurantId: string | null };

    // Never poach: a person already working for a different restaurant, or an
    // owner, cannot be reassigned from here.
    if (target.restaurantId && target.restaurantId !== restaurantId) {
      fail(AppErrorCode.CONFLICT, 'other-restaurant');
    }
    if (target.role === UserRole.RESTAURANT_OWNER) fail(AppErrorCode.FORBIDDEN, 'owner');
    if (PLATFORM_ROLES.includes(target.role)) {
      fail(AppErrorCode.FORBIDDEN, 'platform-staff');
    }

    /*
     * ADDING SOMEBODY IS AN INVITATION. REMOVING THEM IS NOT.
     *
     * This used to change the target's role immediately, both ways. One
     * direction of that was indefensible: a person's account became a
     * restaurant panel without their being asked, because somebody typed their
     * telephone number — and the account then carried a `restaurantId` claim,
     * which is the tenant boundary the entire security model rests on.
     *
     * So joining now writes an offer and stops. `respondToRestaurantInvite` is
     * the only thing that assigns the role, and only the invited person can
     * call it.
     *
     * Removal stays immediate, and that asymmetry is deliberate rather than an
     * oversight. Consent protects somebody from being enrolled; it is not a veto
     * over being dismissed. A restaurant that has just let a member of staff go
     * must not wait for that person's agreement before their access to the
     * customer list ends.
     */
    /*
     * ALREADY ON THIS TEAM? THEN IT IS A ROLE CHANGE, NOT AN ENROLMENT.
     *
     * The invitation exists so that nobody is pulled into a restaurant without
     * being asked. It was applied to every non-removal change, which made this
     * fail: a restaurant with a member of staff who also drives could not turn
     * them into a courier. The invitation went out, the person accepted, and
     * `respondToRestaurantInvite` refused it — because by then they were not a
     * plain CUSTOMER any more, which is exactly the state the guard was written
     * to catch. A 400 with nothing on screen to explain it.
     *
     * The distinction the consent rule actually cares about is whether this
     * person is joining. Somebody already working here, being moved between
     * jobs within the same restaurant, has already consented to working here;
     * asking again would mean a shop could not promote its own staff without
     * their pressing a button, and would leave them stuck in the old role until
     * they did.
     *
     * So: same restaurant → applied at once, audited as a role change. Somebody
     * new → an invitation, as before.
     */
    const alreadyOnThisTeam = target.restaurantId === restaurantId;

    if (role !== UserRole.CUSTOMER && !alreadyOnThisTeam) {
      // The name goes on the invitation, so the person being asked sees who is
      // asking rather than a document id.
      const shopSnapshot = await db.doc(paths.restaurant(restaurantId)).get();
      const shopName = (shopSnapshot.data() as Restaurant | undefined)?.name ?? '';

      await writeRestaurantInvite({
        restaurantId,
        restaurantName: shopName,
        uid: targetDoc.id,
        role,
        invitedBy: caller.uid,
      });

      await writeAudit({
        actorId: caller.uid,
        actorRole: actor.role,
        action: AuditAction.RESTAURANT_INVITE_SENT,
        targetType: 'user',
        targetId: targetDoc.id,
        restaurantId,
        newValue: { role },
        reason: 'restaurant staff invitation',
      });

      return { ok: true, uid: targetDoc.id, invited: true };
    }

    const newRestaurantId = role === UserRole.CUSTOMER ? null : restaurantId;

    await targetDoc.ref.update({ role, restaurantId: newRestaurantId, updatedAt: now() });
    await setUserClaims(targetDoc.id, role, newRestaurantId);

    /*
     * THE OLD TOKEN HAS TO DIE WITH THE OLD ROLE.
     *
     * `setCustomUserClaims` changes what the NEXT token will say. It does not
     * touch the one already in the person's browser, and the Firestore security
     * rules read only the token — so somebody removed from a restaurant at six
     * o'clock kept `role: RESTAURANT_STAFF, restaurantId: X` for up to an hour
     * and could go on reading that restaurant's live orders straight from the
     * client SDK: customer names, telephone numbers, addresses.
     *
     * Cloud Functions were never exposed, because `requireActiveUser` re-reads
     * the user document on every call. The rules cannot, which is exactly why
     * the revocation belongs here.
     *
     * `setUserRole` and `setUserStatus` already did this; adding a courier or
     * removing a member of staff is the same act and was the one path that
     * forgot.
     */
    await auth.revokeRefreshTokens(targetDoc.id).catch(() => undefined);

    await writeAudit({
      actorId: caller.uid,
      actorRole: actor.role,
      action: AuditAction.USER_ROLE_CHANGED,
      targetType: 'user',
      targetId: targetDoc.id,
      restaurantId,
      oldValue: { role: target.role },
      newValue: { role, restaurantId: newRestaurantId },
      reason: 'restaurant staff change',
    });

    return { ok: true, uid: targetDoc.id, invited: false };
  }),
);
