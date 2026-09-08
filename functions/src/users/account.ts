/**
 * QAPINDA — Accounts.
 *
 * ONE PHONE, ONE EMAIL, ONE ACCOUNT.
 *
 * Three things stand between a person and a second account:
 *
 *  1. Firebase Auth itself will not attach one phone number to two accounts.
 *     That closes the front door.
 *  2. `phoneIndex/{digits}` and `emailIndex/{normalised}` are claimed inside the
 *     same transaction that creates the user document. Two simultaneous
 *     registrations cannot both win: Firestore fails the second one.
 *  3. The email key is normalised first, so `a.li+yeni@gmail.com` and
 *     `ali@gmail.com` claim the *same* lock — that is the loophole people
 *     actually use, and it is the one a naive unique-index misses.
 *  4. And a number that already belongs to a WORK account — a restaurant, a
 *     courier, an operator, an admin — cannot become a customer account at
 *     all. The lock in (2) already stops the second account from existing;
 *     this only decides which sentence the person is shown, because "that is
 *     your work number" and "somebody else has that number" are different
 *     problems and only one of them is theirs to fix.
 *
 * What this does NOT claim to do: stop one person owning two phone numbers.
 * Nothing can. That is why the coupon limits are counted per phone AND per
 * address AND per device, and why a suspicious pattern raises REVIEW_REQUIRED
 * for a human to look at rather than an automatic ban.
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, auth, now, FieldValue } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { clean, cleanOptional } from '../lib/moderation';
import { requireAuth, requireActiveUser, setUserClaims } from '../lib/auth';
import {
  asObject,
  optionalEmail,
  optionalString,
  requireEnum,
  requirePhone,
  requireString,
  hashAddress,
} from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import {
  AccountStatus,
  AuditAction,
  AuthProvider,
  NotificationType,
  SUPPORTED_LOCALES,
  SupportedLocale,
  UserRole,
} from '../shared/enums';
import { writeAudit } from '../lib/audit';
import {
  mergeNotificationPrefs,
  notificationSoundEnabled,
  readNotificationPrefsRequest,
} from '../shared/notifications';
import { notify } from '../lib/notify';
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  normaliseEmailKey,
  normalisePhoneKey,
  paths,
} from '../shared/collections';
import { isWorkAccount } from '../shared/permissions';
import { usableEmail } from '../shared/identity';
import { lockIsLive } from '../shared/accountLocks';
import { anonymiseAccount } from './anonymise';
import {
  CONTACT_NAME_MAX,
  CONTACT_NAME_MIN,
  isUsableContactName,
  needsPhoneVerification,
} from '../shared/addressContact';
import { districtsOf, isValidDistrict, isValidRegion, regionName } from '../shared/regions';
import type { Address, User } from '../shared/models';

/**
 * Finishes registration for an already-authenticated user.
 *
 * The phone number is read from the verified ID token, never from the request
 * body — a client that could name its own phone number could claim anyone's.
 */
export const registerAccount = onCall(
  guard('registerAccount', async (request) => {
    const caller = requireAuth(request);
    const data = asObject(request.data);

    const fullName = requireString(data, 'fullName', { min: 2, max: 80 });
    const locale = requireEnum<SupportedLocale>(
      { locale: (data.locale as string) ?? 'az' },
      'locale',
      SUPPORTED_LOCALES,
    );

    // Trust the token, not the payload.
    const record = await auth.getUser(caller.uid);
    const phone = record.phoneNumber;
    if (!phone) fail(AppErrorCode.PHONE_NOT_VERIFIED);

    /*
     * An email may come from the token (Google, Apple) or be typed in. Either
     * way it is normalised before it becomes a lock — and either way it goes
     * through `usableEmail`, which throws away Apple's "Hide My Email"
     * forwarding addresses.
     *
     * That last part is the rule and not a nicety: a relay address is unique
     * per app per person, so locking one can never catch a duplicate, while it
     * does occupy the slot the person's real address needed. `shared/identity.ts`
     * has the whole argument. The client applies the same test so the form does
     * not prefill a string nobody recognises; this is the copy that decides.
     */
    const typedEmail = usableEmail(optionalEmail(data, 'email'));
    const email = typedEmail ?? usableEmail(record.email) ?? null;

    const phoneKey = normalisePhoneKey(phone);
    const emailKey = email ? normaliseEmailKey(email) : null;

    const providers: AuthProvider[] = [];
    if (record.phoneNumber) providers.push(AuthProvider.PHONE);
    for (const provider of record.providerData) {
      if (provider.providerId === 'google.com') providers.push(AuthProvider.GOOGLE);
      if (provider.providerId === 'apple.com') providers.push(AuthProvider.APPLE);
    }

    const userRef = db.doc(paths.user(caller.uid));
    const phoneLockRef = db.doc(paths.phoneLock(phone));
    const emailLockRef = emailKey ? db.doc(paths.emailLock(email!)) : null;

    const existingRole = await db.runTransaction(async (tx) => {
      // All reads first — Firestore transactions require it.
      const [existingUser, phoneLock, emailLock] = await Promise.all([
        tx.get(userRef),
        tx.get(phoneLockRef),
        emailLockRef ? tx.get(emailLockRef) : Promise.resolve(null),
      ]);

      // Already registered: make the call idempotent rather than an error, so a
      // retried sign-up does not look broken to the user.
      if (existingUser.exists) return (existingUser.data() as User).role;

      /*
       * A LOCK IS ONLY HONOURED WHILE THE ACCOUNT BEHIND IT IS STILL THERE.
       *
       * Both index documents are read for their holder before either is
       * trusted. `lockIsLive` in `shared/accountLocks.ts` has the whole
       * argument; the short version is that a `users/{uid}` deleted from the
       * Firestore console leaves its locks behind, and those locks then refuse
       * the number's real owner for ever with no screen anywhere able to clear
       * them. That is not a hypothetical — it happened to this platform's own
       * admin account, and it is the reason this block exists.
       *
       * Every read is here, above the writes, because Firestore transactions
       * require it.
       */
      const phoneHolderUid = phoneLock.exists
        ? (phoneLock.data()?.uid as string | undefined) ?? null
        : null;
      const emailHolderUid = emailLock?.exists
        ? (emailLock.data()?.uid as string | undefined) ?? null
        : null;

      const [phoneHolderDoc, emailHolderDoc] = await Promise.all([
        phoneHolderUid && phoneHolderUid !== caller.uid
          ? tx.get(db.doc(paths.user(phoneHolderUid)))
          : Promise.resolve(null),
        emailHolderUid && emailHolderUid !== caller.uid
          ? tx.get(db.doc(paths.user(emailHolderUid)))
          : Promise.resolve(null),
      ]);

      /** `users/{uid}` reduced to the two fields the lock rule looks at. */
      const asHolder = (
        doc: FirebaseFirestore.DocumentSnapshot | null,
      ): { accountStatus: string | null; phoneKey: string | null; emailKey: string | null } | null => {
        if (!doc?.exists) return null;
        const held = doc.data() as User;
        return {
          accountStatus: held.accountStatus ?? null,
          phoneKey: held.phone ? normalisePhoneKey(held.phone) : null,
          emailKey: held.email ? normaliseEmailKey(held.email) : null,
        };
      };

      const phoneLockLive =
        phoneLock.exists &&
        lockIsLive({
          kind: 'PHONE',
          lockKey: phoneKey,
          holderUid: phoneHolderUid,
          holder: asHolder(phoneHolderDoc),
        });

      const emailLockLive =
        Boolean(emailLock?.exists) &&
        emailKey !== null &&
        lockIsLive({
          kind: 'EMAIL',
          lockKey: emailKey,
          holderUid: emailHolderUid,
          holder: asHolder(emailHolderDoc),
        });

      /*
       * A PHONE THAT ALREADY WORKS HERE CANNOT ALSO SHOP HERE.
       *
       * `phoneIndex` has always answered "is this number taken", and that is
       * still the first thing asked. What it did not answer is *by whom*: a
       * number belonging to a restaurant, a courier, an operator or an admin
       * came back as the same flat "already registered" as a number belonging
       * to another customer.
       *
       * The two need different sentences, because they are different problems.
       * "Somebody else has this number" is a mistake to correct; "this is your
       * work number" is a rule to explain — the person is not locked out of
       * Qapında, they are signed in to it already, on the account they work
       * with. So the locked account is read and its role decides which of the
       * two is said. The read happens here, before any write, like every other
       * read in this transaction.
       */
      if (phoneLockLive && phoneHolderUid !== caller.uid) {
        const holderRole = phoneHolderDoc?.exists ? (phoneHolderDoc.data() as User).role : null;

        if (isWorkAccount(holderRole)) fail(AppErrorCode.WORK_PHONE_NOT_CUSTOMER);
        fail(AppErrorCode.PHONE_ALREADY_REGISTERED);
      }
      if (emailLockLive && emailHolderUid !== caller.uid) {
        fail(AppErrorCode.EMAIL_ALREADY_REGISTERED);
      }

      /*
       * A ghost lock is taken over, and said so out loud.
       *
       * Logged rather than passed over in silence because the ordinary reason
       * for one is somebody editing Firestore by hand, and that is worth
       * knowing about even when the recovery worked.
       */
      if (phoneLock.exists && !phoneLockLive && phoneHolderUid !== caller.uid) {
        logger.warn('stale phone lock reclaimed', {
          phoneKey,
          previousUid: phoneHolderUid,
          uid: caller.uid,
        });
      }
      if (emailLock?.exists && !emailLockLive && emailHolderUid !== caller.uid) {
        logger.warn('stale email lock reclaimed', {
          emailKey,
          previousUid: emailHolderUid,
          uid: caller.uid,
        });
      }

      const user: Omit<User, 'createdAt' | 'updatedAt' | 'lastSeenAt'> = {
        uid: caller.uid,
        phone,
        phoneVerified: true,
        email,
        emailVerified: record.emailVerified ?? false,
        fullName,
        role: UserRole.CUSTOMER,
        restaurantId: null,
        accountStatus: AccountStatus.ACTIVE,
        locale,
        linkedProviders: providers,
        riskFlags: [],
        hasCompletedOrder: false,
        lastRegionId: null,
        defaultAddressId: null,
      };

      tx.set(userRef, { ...user, createdAt: now(), updatedAt: now(), lastSeenAt: now() });
      tx.set(phoneLockRef, { uid: caller.uid, createdAt: now() });
      if (emailLockRef) tx.set(emailLockRef, { uid: caller.uid, createdAt: now() });

      return null;
    });

    // `null` means this call created the account; anything else is the role the
    // account already had. Reporting the stored role rather than a flat
    // CUSTOMER matters for a work account whose owner reinstalled the app: the
    // sign-in screen sends people on by role, and telling it "customer" would
    // send a courier to the shopfront.
    const created = existingRole === null;

    if (created) {
      // Everyone starts as a customer. Roles are granted, never self-assigned.
      await setUserClaims(caller.uid, UserRole.CUSTOMER, null);
      logger.info('account registered', { uid: caller.uid, phoneKey });
    }

    return { ok: true, created, role: existingRole ?? UserRole.CUSTOMER };
  }),
);

/**
 * Attaches an email to an existing account, claiming the lock.
 *
 * Separate from registration because a phone-only sign-up is legitimate: the
 * email is optional until the person wants receipts.
 */
export const linkEmail = onCall(
  guard('linkEmail', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    /*
     * A relay address is refused outright here rather than silently ignored.
     *
     * `registerAccount` may reach one by accident — it reads whatever the
     * provider put in the token — but this callable is somebody deliberately
     * typing an address into the settings screen, and "@privaterelay.appleid.com"
     * typed by hand is a person who has copied it out of Apple's mail app
     * believing it is their address. Storing it would give them an account
     * whose email they can never receive a receipt at from anywhere else.
     */
    const email = usableEmail(optionalEmail(data, 'email'));
    if (!email) fail(AppErrorCode.INVALID_EMAIL);

    const emailKey = normaliseEmailKey(email);
    const newLockRef = db.doc(`${COLLECTIONS.emailIndex}/${emailKey}`);
    const oldLockRef = user.email ? db.doc(paths.emailLock(user.email)) : null;
    const userRef = db.doc(paths.user(caller.uid));

    await db.runTransaction(async (tx) => {
      const existing = await tx.get(newLockRef);
      const holderUid = existing.exists
        ? (existing.data()?.uid as string | undefined) ?? null
        : null;

      // Same ghost-lock rule as registration, and for the same reason: an
      // address stranded by a hand-deleted account must not lock its owner out
      // of their own settings screen. `shared/accountLocks.ts` has the argument.
      if (holderUid && holderUid !== caller.uid) {
        const holderDoc = await tx.get(db.doc(paths.user(holderUid)));
        const held = holderDoc.exists ? (holderDoc.data() as User) : null;

        const live = lockIsLive({
          kind: 'EMAIL',
          lockKey: emailKey,
          holderUid,
          holder: held
            ? {
                accountStatus: held.accountStatus ?? null,
                phoneKey: held.phone ? normalisePhoneKey(held.phone) : null,
                emailKey: held.email ? normaliseEmailKey(held.email) : null,
              }
            : null,
        });

        if (live) fail(AppErrorCode.EMAIL_ALREADY_REGISTERED);
        logger.warn('stale email lock reclaimed', { emailKey, previousUid: holderUid, uid: caller.uid });
      }

      // Release the previous lock so a changed address does not strand it.
      if (oldLockRef && oldLockRef.path !== newLockRef.path) tx.delete(oldLockRef);

      tx.set(newLockRef, { uid: caller.uid, createdAt: now() });
      tx.update(userRef, { email, emailVerified: false, updatedAt: now() });
    });

    return { ok: true, email };
  }),
);

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Saves a delivery address.
 *
 * Handled server-side rather than by a direct client write because the address
 * hash — which the coupon limits count against — must be computed from the same
 * normalisation every time, and because setting one address as default has to
 * clear the others atomically.
 */
export const saveAddress = onCall(
  guard('saveAddress', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    const addressId = optionalString(data, 'addressId', { max: 64 });
    // The label and the note travel onto every order placed to this address,
    // where a courier and a restaurant read them. Same rule as anywhere else.
    const label = clean(requireString(data, 'label', { min: 1, max: 40 })).text;
    const line = requireString(data, 'line', { min: 5, max: 300 });
    const note = cleanOptional(optionalString(data, 'note', { max: 200 })).text;
    const isDefault = data.isDefault === true;

    // The city is chosen from a closed list, never typed. A free-text city
    // splits one market into three spellings that never see each other.
    const regionId = requireString(data, 'regionId', { max: 40 });
    if (!isValidRegion(regionId)) fail(AppErrorCode.INVALID_REGION);

    const district = optionalString(data, 'district', { max: 60 });
    const available = districtsOf(regionId);
    if (available.length > 0) {
      if (!district) fail(AppErrorCode.INVALID_DISTRICT);
      if (!isValidDistrict(regionId, district)) fail(AppErrorCode.INVALID_DISTRICT);
    }

    const lat = typeof data.lat === 'number' ? data.lat : null;
    const lng = typeof data.lng === 'number' ? data.lng : null;

    /*
     * The details a map cannot know, and the number the courier rings.
     *
     * All optional, all moderated the same way the note is: they travel onto
     * every order placed to this address and are read by a restaurant and by a
     * driver, so they are held to the same standard as anything else somebody
     * else has to look at.
     *
     * The phone is validated as a real Azerbaijani number rather than stored as
     * typed. A courier standing in the street with a number that does not dial
     * has an address with no way in, which is the failure this field exists to
     * prevent — so a malformed one is refused here rather than discovered at
     * the door.
     */
    const building = cleanOptional(optionalString(data, 'building', { max: 80 })).text;
    const apartment = cleanOptional(optionalString(data, 'apartment', { max: 20 })).text;
    const floor = cleanOptional(optionalString(data, 'floor', { max: 20 })).text;
    const company = cleanOptional(optionalString(data, 'company', { max: 80 })).text;
    const phone =
      data.phone === undefined || data.phone === null || data.phone === ''
        ? null
        : requirePhone(data, 'phone');

    /*
     * WHO OPENS THE DOOR — now required, and required HERE.
     *
     * The restaurant and its courier were being handed the account holder's
     * name and number. For most orders that is right and nobody notices; for
     * the ones where it is wrong it is badly wrong — food sent to a parent's
     * flat or an office reception, and the driver stands in the street ringing
     * somebody who is at work in another district. The order is then filed as
     * "customer unreachable" and the person who ordered it finds out when they
     * get home.
     *
     * Both halves of the name, because "Elvin" at a block of forty flats
     * identifies nobody and the entire point of the field is that the driver
     * can say who they are looking for. `isUsableContactName` is the same test
     * the form applies, so the button and the server cannot disagree.
     */
    const contactName = clean(requireString(data, 'contactName', { min: CONTACT_NAME_MIN, max: CONTACT_NAME_MAX })).text;
    if (!isUsableContactName(contactName)) fail(AppErrorCode.VALIDATION_FAILED, 'contactName');
    if (!phone) fail(AppErrorCode.VALIDATION_FAILED, 'phone');

    const collection = db.collection(`${paths.user(caller.uid)}/${SUBCOLLECTIONS.addresses}`);
    const ref = addressId ? collection.doc(addressId) : collection.doc();

    /*
     * IS THIS NUMBER ALREADY PROVED?
     *
     * Three ways it can be, and the first is the common case by a distance:
     *
     *  1. it IS the account's own number, proved by SMS at registration —
     *     nothing to send, nothing to spend, nothing asked of the customer;
     *  2. this address already carried this exact number and it was verified
     *     before — re-saving the floor number must not un-prove the phone;
     *  3. otherwise it is not proved, and `sendAddressPhoneCode` is next.
     *
     * `phoneVerified` is decided here and never accepted from the request. A
     * client that could set it would make the whole verification decorative.
     */
    const previous = addressId ? ((await ref.get()).data() as Address | undefined) : undefined;

    const phoneVerified = !needsPhoneVerification({
      addressPhone: phone,
      accountPhone: user.phone,
      accountPhoneVerified: user.phoneVerified === true,
    })
      ? true
      : previous?.phone === phone && previous?.phoneVerified === true;

    const address: Omit<Address, 'createdAt' | 'updatedAt'> = {
      id: ref.id,
      label,
      line,
      note,
      regionId,
      district: available.length > 0 ? district : null,
      city: regionName(regionId),
      lat,
      lng,
      isDefault,
      building,
      apartment,
      floor,
      company,
      phone,
      contactName,
      phoneVerified,
    };

    const batch = db.batch();

    if (isDefault) {
      const others = await collection.where('isDefault', '==', true).get();
      for (const doc of others.docs) {
        if (doc.id !== ref.id) batch.update(doc.ref, { isDefault: false });
      }
      batch.update(db.doc(paths.user(caller.uid)), {
        defaultAddressId: ref.id,
        updatedAt: now(),
      });
    }

    batch.set(
      ref,
      addressId
        ? { ...address, updatedAt: now() }
        : { ...address, createdAt: now(), updatedAt: now() },
      { merge: true },
    );

    await batch.commit();

    /*
     * `needsCode` is what the form reads to decide whether to open the code
     * step. Returned rather than worked out again on the client, because the
     * client working it out again is how the two come to disagree — and the way
     * they disagree is a saved address that looks ready and cannot be ordered
     * to.
     */
    return {
      ok: true,
      addressId: ref.id,
      addressHash: hashAddress(address.city, line),
      phoneVerified,
      needsCode: !phoneVerified,
    };
  }),
);

export const deleteAddress = onCall(
  guard('deleteAddress', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);
    const addressId = requireString(data, 'addressId', { max: 64 });

    const ref = db.doc(`${paths.user(caller.uid)}/${SUBCOLLECTIONS.addresses}/${addressId}`);
    const batch = db.batch();
    batch.delete(ref);

    if (user.defaultAddressId === addressId) {
      batch.update(db.doc(paths.user(caller.uid)), {
        defaultAddressId: null,
        updatedAt: now(),
      });
    }

    await batch.commit();
    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Data rights
// ---------------------------------------------------------------------------

/**
 * "Hesabımı sil" — and it is actually deleted.
 *
 * WHAT THIS USED TO DO, AND WHY THAT WAS WRONG
 * --------------------------------------------
 * It set `accountStatus` to DELETION_REQUESTED and stopped. Nothing else
 * happened until a super admin found the account and ran `anonymiseUser` by
 * hand. So a customer who asked to be deleted was left signed in, with their
 * name and number and addresses intact, waiting on somebody they have no way to
 * contact — and if nobody ever looked, waiting for ever. That is not a deletion
 * flow, it is a deletion queue with no one reading it.
 *
 * Now the account is anonymised in the same request. The person presses the
 * button, and the account is gone.
 *
 * THE ORDERS STAY, WITH NO NAME ON THEM
 * -------------------------------------
 * Order records carry a tax and accounting retention obligation, and a
 * restaurant's own books have to balance after a customer leaves. So what goes
 * is everything that identifies the person — name, phone, email, saved
 * addresses, the sign-in credential — and what stays is an order with nobody's
 * name on it. `users/anonymise.ts` has the full argument and is shared with the
 * admin's path so the two cannot drift.
 *
 * THE LOCKS ARE RELEASED, WHICH IS THE PART PEOPLE NOTICE
 * -------------------------------------------------------
 * Deleting an account has to free the telephone number, or the person cannot
 * come back — and "bu nömrə artıq qeydiyyatdadır", pointing at an account they
 * themselves deleted, is the worst sentence this product could show them.
 *
 * AN ORDER IN FLIGHT BLOCKS IT
 * ----------------------------
 * Deliberately. A courier on their way to a door needs a name to ask for and a
 * number that answers, and anonymising the account underneath them would strand
 * both. It is a wait of an hour, and the screen says so.
 */
export const requestAccountDeletion = onCall(
  guard('requestAccountDeletion', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    const confirmation = requireString(data, 'confirm', { max: 40 });
    if (confirmation !== 'HESABIMI SIL') fail(AppErrorCode.VALIDATION_FAILED, 'confirm');

    if (user.role !== UserRole.CUSTOMER) {
      // A restaurant owner or admin must be unwound by the platform first.
      fail(AppErrorCode.FORBIDDEN);
    }

    const active = await db
      .collection(COLLECTIONS.orders)
      .where('customerId', '==', caller.uid)
      .where('status', 'in', ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'])
      .limit(1)
      .get();
    if (!active.empty) fail(AppErrorCode.CONFLICT, 'active-order');

    /*
     * Recorded as a request first, then carried out.
     *
     * Two writes rather than one, and the order matters: if the anonymisation
     * fails halfway — a network fault, a timeout — the account is left in
     * DELETION_REQUESTED, which is a state the admin's `anonymiseUser` can
     * finish. Going straight to ANONYMIZED and failing would leave an account
     * that looks untouched and that nobody knows was asked to be deleted.
     */
    await db.doc(paths.user(caller.uid)).update({
      accountStatus: AccountStatus.DELETION_REQUESTED,
      updatedAt: now(),
    });

    await anonymiseAccount({
      uid: caller.uid,
      target: user,
      // The person themselves. Recorded as such in the audit log, because "who
      // deleted this account" has a genuinely different answer here than it
      // does on the admin's path, and a support conversation six months later
      // turns on which one it was.
      actorId: caller.uid,
      actorRole: user.role,
      reason: 'customer requested deletion',
    });

    return { ok: true, deleted: true };
  }),
);

/** Records a consent decision. Marketing consent is separate, and revocable. */
export const recordConsent = onCall(
  guard('recordConsent', async (request) => {
    const caller = requireAuth(request);
    const data = asObject(request.data);

    const consentType = requireEnum(data, 'consentType', [
      'PRIVACY_NOTICE',
      'TERMS',
      'EXPLICIT_DATA_CONSENT',
      'MARKETING',
    ] as const);
    const granted = data.granted === true;
    const documentVersion = optionalString(data, 'documentVersion', { max: 40 });

    await db.collection(COLLECTIONS.consents).add({
      userId: caller.uid,
      consentType,
      documentVersion,
      granted,
      ip: request.rawRequest.ip ?? null,
      userAgent: request.rawRequest.headers['user-agent'] ?? null,
      createdAt: now(),
    });

    return { ok: true };
  }),
);

/** Keeps `lastSeenAt` fresh without granting the client a write on the field. */
/**
 * Which messages this account wants, how loudly, and on which types.
 *
 * WHAT CANNOT BE SWITCHED OFF HERE
 * -------------------------------
 * Not everything on this screen is a preference. `notificationAllowed` in
 * `shared/notifications.ts` is what actually reads what is written here, and it
 * refuses to hide any type marked `silenceable: false` — a cancelled delivery
 * reaches the courier whatever they have saved. What those types lose instead
 * is their *sound*, and that distinction is the whole design: a driver working
 * in silence still sees the cancellation on screen.
 *
 * WHY EVERY FIELD IS MERGED RATHER THAN REPLACED
 * ---------------------------------------------
 * `notificationPrefs` is one map, so writing it with three keys erases the
 * other four. The customer's screen sends the two switches it owns and the
 * operator's sends nine types; neither knows about the other. So this reads
 * what is stored, lays the request over it, and writes the whole resolved
 * object back — a screen can only ever change the switches it actually shows.
 *
 * A PER-TYPE SWITCH IS CHECKED AGAINST THE ROLE, NOT AGAINST THE SCREEN
 * ---------------------------------------------------------------------
 * `mayToggleType` is the authority, and it is applied here rather than in the
 * component that renders the switches: a caller who posts
 * `types: { OPS_ORDER_PROBLEM: false }` by hand is asking to mute an alert they
 * were never going to be sent, and one who posts `types: { REFUND_ISSUED:
 * false }` is asking to hide the one message they are certainly waiting for.
 * Both are refused. The role comes from the stored user document, never from
 * anything the caller sent.
 *
 * `types` REPLACES `mutedTypes`, AND LEAVES IT ALONE
 * -------------------------------------------------
 * The old list is still read by `notificationTypeEnabled` for accounts that
 * have one, so an operator who muted six kinds last year still has them muted.
 * It is never written again: a list of what is OFF cannot express a type that
 * is off by default and has been deliberately switched ON, which is exactly
 * what a customer turning "sifarişiniz hazırlanır" on now does.
 */
export const updateNotificationPrefs = onCall(
  guard('updateNotificationPrefs', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    /*
     * The request, read into a patch by the shared reader.
     *
     * The rules it applies — which flags exist, which per-type switches this
     * role owns, what an absent field means — are the same ones the settings
     * screen applies when it decides what to draw, so they live once, in
     * `shared/notifications.ts`, and are unit-tested there against the very
     * code this callable runs. Reading them a second time here is how the
     * admin's per-type list came to be the one path nothing could test.
     *
     * The role comes from the stored user document, never from the request.
     */
    const read = readNotificationPrefsRequest(data, user.role);
    if (!read.ok) {
      fail(
        read.reason === 'forbidden' ? AppErrorCode.FORBIDDEN : AppErrorCode.VALIDATION_FAILED,
        read.field,
      );
    }

    // One place decides what "absent" means, and it is shared with the screen
    // and with the tests. See `mergeNotificationPrefs`.
    const next = mergeNotificationPrefs(user.notificationPrefs, read.patch, user.role);

    /*
     * `set` with a merge rather than `update`.
     *
     * `update` refuses outright if the document is not there, and the account
     * document can be a moment behind on a freshly created account — an admin
     * bootstrapped by `bootstrapSuperAdmin`, a staff member whose claims were
     * written before their document settled. That refusal surfaced as a bare
     * INTERNAL under a switch somebody had just moved, with nothing on screen
     * to say what had gone wrong. A merge writes the preference either way and
     * leaves every other field alone, which is all this callable ever meant.
     */
    await db.doc(paths.user(caller.uid)).set(
      {
        notificationPrefs: next,
        updatedAt: now(),
      },
      { merge: true },
    );

    return { ok: true };
  }),
);

/**
 * "Test bildirişi göndər" — the button a restaurant presses at 6pm on a Friday.
 *
 * WHY THIS IS NOT A FAKE ROW DRAWN ON THE SCREEN
 * ---------------------------------------------
 * The question being asked is "do notifications actually reach me", and a
 * mock-up answers it with a lie: it would look identical whether the listener
 * is subscribed, whether the security rule lets this account read its own
 * inbox, whether the write path works at all. So this goes the whole way round
 * — a real document, written by the real `notify()`, delivered by the real
 * Firestore listener, drawn by the real bell, rung by the real sound layer. If
 * any link in that chain is broken for this account, the restaurant sees
 * nothing happen, which is the true answer.
 *
 * The one thing it deliberately does not exercise is a preference: the type is
 * not silenceable, so a muted setting cannot swallow the test and leave the
 * person unable to tell "switched off" from "broken". The SOUND still follows
 * the settings, because "does my phone make a noise" is half of what is being
 * tested.
 *
 * `occurrence` carries the minute, so pressing it again a minute later is a new
 * event with a new id rather than a silent no-op against the same document.
 * Pressing it twice in the same minute is one notification, which is the same
 * deduplication rule as everything else here.
 */
export const sendTestNotification = onCall(
  guard('sendTestNotification', async (request) => {
    const { caller, user } = await requireActiveUser(request);

    const minute = new Date().toISOString().slice(0, 16);

    await notify({
      userId: caller.uid,
      role: user.role,
      restaurantId: user.restaurantId ?? null,
      type: NotificationType.NOTIFICATION_TEST,
      occurrence: minute,
      params: {},
      link: null,
    });

    /*
     * What the button reports back is what the SERVER did, not what the browser
     * will do with it. The document is written; whether it arrives is the thing
     * the person is about to watch for, and `deliveryStatus` on the document is
     * what records the answer.
     */
    return {
      ok: true,
      soundEnabled: notificationSoundEnabled(
        user.notificationPrefs,
        NotificationType.NOTIFICATION_TEST,
      ),
    };
  }),
);

/**
 * How long one work session may run before a fresh sign-in is recorded.
 *
 * The audit log answers "who was in the admin panel on Tuesday afternoon". It
 * does not need to answer it eight times an hour. A person who opens the panel
 * at nine and again after lunch is two entries; the same person reloading the
 * page all morning is one.
 */
const SESSION_AUDIT_GAP_MS = 6 * 60 * 60 * 1000;

/**
 * Marks the account as active, and — for a STAFF account — records the session.
 *
 * WHY ONLY STAFF
 * --------------
 * This writes to the audit log, which exists to answer questions about people
 * who hold power over other people's money and data: who suspended a
 * restaurant, who changed a commission, who read a customer's order. "Who was
 * signed in, and when" belongs in that same record for exactly those accounts.
 *
 * It emphatically does not belong there for customers. A log of when every
 * customer opened a food app is a detailed record of thousands of people's
 * daily routines, kept for ever, readable by every operator, serving no
 * question anybody has ever needed to ask. Building it would be a privacy
 * liability created for the sake of symmetry.
 *
 * WHY SIGN-OUT IS RECORDED SEPARATELY AND HONESTLY
 * ------------------------------------------------
 * `event: 'END'` is sent by the sign-out button, and only by it. Closing the
 * tab, the laptop lid, or the browser sends nothing at all — no web application
 * can reliably record that, and pretending otherwise would put a log in front
 * of an auditor that implies a session ended when it may have run on. So an END
 * entry means "this person pressed Çıxış", which is true, and its ABSENCE means
 * nothing in particular.
 */
export const touchSession = onCall(
  guard('touchSession', async (request) => {
    const caller = requireAuth(request);

    const data = asObject(request.data);
    const ending = data.event === 'END';

    const ref = db.doc(paths.user(caller.uid));
    const snapshot = await ref.get().catch(() => null);
    const user = snapshot?.data() as User | undefined;

    await ref.update({ lastSeenAt: now() }).catch(() => undefined);

    if (!user || !isWorkAccount(user.role)) return { ok: true, audited: false };

    const ip = request.rawRequest.ip ?? null;

    if (ending) {
      await writeAudit({
        actorId: caller.uid,
        actorRole: user.role,
        action: AuditAction.STAFF_SESSION_ENDED,
        targetType: 'user',
        targetId: caller.uid,
        restaurantId: user.restaurantId ?? null,
        ip,
      }).catch(() => undefined);

      await ref.update({ sessionAuditedAt: FieldValue.delete() }).catch(() => undefined);
      return { ok: true, audited: true };
    }

    /*
     * A new session, or the same one still going?
     *
     * Two things restart the clock: enough time having passed, and the address
     * having changed. The second matters more than the first — the same account
     * appearing from a different network is the thing worth a line of its own,
     * and it is what a shared password looks like from the outside.
     */
    const lastMs = (user.sessionAuditedAt as { toMillis?: () => number } | undefined)?.toMillis?.();
    const sameAddress = ip !== null && user.sessionAuditedIp === ip;
    const recent = typeof lastMs === 'number' && Date.now() - lastMs < SESSION_AUDIT_GAP_MS;

    if (recent && sameAddress) return { ok: true, audited: false };

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: AuditAction.STAFF_SESSION_STARTED,
      targetType: 'user',
      targetId: caller.uid,
      restaurantId: user.restaurantId ?? null,
      ip,
    }).catch(() => undefined);

    await ref
      .update({ sessionAuditedAt: now(), sessionAuditedIp: ip })
      .catch(() => undefined);

    return { ok: true, audited: true };
  }),
);

/** Records a device fingerprint against a phone. Feeds the review flag. */
export async function recordDeviceSignal(
  deviceId: string | null,
  uid: string,
  phone: string,
): Promise<void> {
  if (!deviceId) return;
  await db
    .doc(paths.deviceSignal(deviceId))
    .set(
      {
        deviceId,
        uids: FieldValue.arrayUnion(uid),
        phones: FieldValue.arrayUnion(normalisePhoneKey(phone)),
        lastSeenAt: now(),
      },
      { merge: true },
    )
    .catch((error) => logger.warn('device signal write failed', { error: String(error) }));
}
