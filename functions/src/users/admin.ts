/**
 * QAPINDA — User administration.
 *
 * Roles are granted here and nowhere else, and every grant is audited. There is
 * no hidden bypass: a super admin's own actions are logged exactly like an
 * operator's, and no callable lets anyone edit or delete an audit entry.
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, auth, now } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requirePermission, setUserClaims } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { asObject, requireEnum, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import {
  AccountStatus,
  AuditAction,
  PLATFORM_ROLES,
  RESTAURANT_SCOPED_ROLES,
  UserRole,
} from '../shared/enums';
import { COLLECTIONS, paths } from '../shared/collections';
import { anonymiseAccount } from './anonymise';
import { Permission } from '../shared/permissions';
import type { User } from '../shared/models';

const ASSIGNABLE_ROLES = [
  UserRole.CUSTOMER,
  UserRole.RESTAURANT_OWNER,
  UserRole.RESTAURANT_MANAGER,
  UserRole.RESTAURANT_STAFF,
  /*
   * THE COURIER WAS MISSING FROM THIS LIST AND THAT IS WHY THERE WERE NONE.
   *
   * `setRestaurantStaff` could create one, but only a restaurant owner can call
   * that — so a platform admin setting up a shop for somebody, which is how
   * every restaurant on this platform starts, had no way to add a driver at
   * all. The role existed, the panel existed, the permissions existed, and
   * nothing could reach them.
   */
  UserRole.RESTAURANT_COURIER,
  UserRole.OPERATOR,
  UserRole.SUPER_ADMIN,
] as const;

const SETTABLE_STATUSES = [
  AccountStatus.ACTIVE,
  AccountStatus.REVIEW_REQUIRED,
  AccountStatus.SUSPENDED,
  AccountStatus.BANNED,
] as const;

/**
 * Changes an account's role.
 *
 * Only a super admin may do this — an operator who could promote themselves
 * would make every other permission decorative.
 */
export const setUserRole = onCall(
  guard('setUserRole', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_CHANGE_USER_ROLE);

    const data = asObject(request.data);
    const targetUid = requireString(data, 'uid', { max: 128 });
    const role = requireEnum<UserRole>(data, 'role', ASSIGNABLE_ROLES);
    const restaurantId =
      typeof data.restaurantId === 'string' && data.restaurantId ? data.restaurantId : null;
    const reason = requireString(data, 'reason', { min: 10, max: 300 });

    if (targetUid === caller.uid) {
      // Not even to demote yourself: it would strand the platform with no admin
      // if it were the last one, and every real case has a second admin to do it.
      fail(AppErrorCode.FORBIDDEN, 'self');
    }

    const targetRef = db.doc(paths.user(targetUid));
    const snapshot = await targetRef.get();
    if (!snapshot.exists) fail(AppErrorCode.NOT_FOUND, 'user');
    const target = snapshot.data() as User;

    /*
     * A restaurant role without a restaurant would pass every permission check
     * and then match no tenant — a role that can act on nothing, confusingly.
     *
     * `RESTAURANT_SCOPED_ROLES`, not `RESTAURANT_ROLES`: a courier belongs to
     * exactly one shop and therefore needs a restaurantId, even though it is
     * deliberately kept out of the list of roles that may ACT for that shop.
     * The two were the same list here, so a courier was refused with a
     * restaurant and accepted without one.
     */
    const isRestaurantRole = RESTAURANT_SCOPED_ROLES.includes(role);
    if (isRestaurantRole && !restaurantId) fail(AppErrorCode.VALIDATION_FAILED, 'restaurantId');
    if (!isRestaurantRole && restaurantId) fail(AppErrorCode.VALIDATION_FAILED, 'restaurantId');

    if (restaurantId) {
      const restaurant = await db.doc(paths.restaurant(restaurantId)).get();
      if (!restaurant.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
    }

    await targetRef.update({ role, restaurantId, updatedAt: now() });
    await setUserClaims(targetUid, role, restaurantId);
    // Force the next request to fetch a fresh token carrying the new role.
    await auth.revokeRefreshTokens(targetUid);

    await writeAudit({
      actorId: caller.uid,
      actorRole: actor.role,
      action: AuditAction.USER_ROLE_CHANGED,
      targetType: 'user',
      targetId: targetUid,
      restaurantId,
      oldValue: { role: target.role, restaurantId: target.restaurantId },
      newValue: { role, restaurantId },
      reason,
      ip: request.rawRequest.ip ?? null,
    });

    logger.info('role changed', { by: caller.uid, target: targetUid, role });
    return { ok: true };
  }),
);

/** Suspends, bans, flags for review, or restores an account. */
export const setUserStatus = onCall(
  guard('setUserStatus', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_CHANGE_USER_STATUS);

    const data = asObject(request.data);
    const targetUid = requireString(data, 'uid', { max: 128 });
    const accountStatus = requireEnum<AccountStatus>(data, 'status', SETTABLE_STATUSES);
    const reason = requireString(data, 'reason', { min: 10, max: 300 });

    if (targetUid === caller.uid) fail(AppErrorCode.FORBIDDEN, 'self');

    const targetRef = db.doc(paths.user(targetUid));
    const snapshot = await targetRef.get();
    if (!snapshot.exists) fail(AppErrorCode.NOT_FOUND, 'user');
    const target = snapshot.data() as User;

    // An operator may pause a suspicious customer but not touch another admin.
    if (PLATFORM_ROLES.includes(target.role) && caller.role !== UserRole.SUPER_ADMIN) {
      fail(AppErrorCode.FORBIDDEN);
    }

    await targetRef.update({ accountStatus, updatedAt: now() });

    /*
     * THE FIRESTORE ROW IS THE DECISION; FIREBASE AUTH IS THE ENFORCEMENT.
     *
     * `requireActiveUser` reads `accountStatus` from the document on every
     * callable, so the moment the line above commits, a suspended account can
     * no longer do anything on this platform. Disabling the Auth user and
     * revoking its tokens is what stops it *signing in* — belt as well as
     * braces, and worth having.
     *
     * They are separated because the second half can fail on its own and used
     * not to be allowed to. An account whose document exists without a matching
     * Auth user — anonymised, deleted from the console, or created before the
     * two were written together — made `updateUser` throw, and the throw
     * travelled out of here as a bare failure. The admin was then told the
     * change had not worked, having watched it work: the status in the table
     * updated, because the write above had already committed.
     *
     * So the failure is reported as what it is — the status changed, the
     * sign-in block did not — and the admin is told which half is missing
     * instead of being left to guess.
     */
    let authUpdated = true;
    try {
      if (accountStatus === AccountStatus.BANNED || accountStatus === AccountStatus.SUSPENDED) {
        // A valid token outlives the ban by up to an hour unless it is revoked.
        await auth.revokeRefreshTokens(targetUid);
        await auth.updateUser(targetUid, { disabled: accountStatus === AccountStatus.BANNED });
      } else {
        await auth.updateUser(targetUid, { disabled: false });
      }
    } catch (error) {
      authUpdated = false;
      logger.warn('setUserStatus: auth not updated', {
        targetUid,
        accountStatus,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await writeAudit({
      actorId: caller.uid,
      actorRole: actor.role,
      action: AuditAction.USER_STATUS_CHANGED,
      targetType: 'user',
      targetId: targetUid,
      oldValue: { accountStatus: target.accountStatus },
      // Recorded, so the log says which half landed rather than implying both.
      newValue: { accountStatus, authUpdated },
      reason,
      ip: request.rawRequest.ip ?? null,
    });

    return { ok: true, authUpdated };
  }),
);

/**
 * Anonymises an account that asked to be deleted.
 *
 * Identifying fields are overwritten and the phone and email locks are
 * released, so the number can register fresh. The orders stay, without a name
 * on them, because the restaurant's books and the tax record must still balance.
 */
export const anonymiseUser = onCall(
  guard('anonymiseUser', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_CHANGE_USER_STATUS);
    if (caller.role !== UserRole.SUPER_ADMIN) fail(AppErrorCode.FORBIDDEN);

    const data = asObject(request.data);
    const targetUid = requireString(data, 'uid', { max: 128 });
    const reason = requireString(data, 'reason', { min: 10, max: 300 });

    const targetRef = db.doc(paths.user(targetUid));
    const snapshot = await targetRef.get();
    if (!snapshot.exists) fail(AppErrorCode.NOT_FOUND, 'user');
    const target = snapshot.data() as User;

    if (target.accountStatus !== AccountStatus.DELETION_REQUESTED) {
      fail(AppErrorCode.VALIDATION_FAILED, 'not-requested');
    }

    // What "deleted" means lives in one place — see `users/anonymise.ts`. A
    // second copy here is how the phone lock would eventually be released in
    // one path and not the other.
    await anonymiseAccount({
      uid: targetUid,
      target,
      actorId: caller.uid,
      actorRole: actor.role,
      reason,
    });

    return { ok: true };
  }),
);

/**
 * Grants the very first super admin.
 *
 * Guarded by a secret in the functions environment and by there being no super
 * admin yet. DELETE `BOOTSTRAP_ADMIN_SECRET` from `functions/.env` as soon as
 * the first admin exists — it is a one-time key, not a maintenance tool.
 */
export const bootstrapSuperAdmin = onCall(
  guard('bootstrapSuperAdmin', async (request) => {
    const caller = request.auth;
    if (!caller?.uid) fail(AppErrorCode.UNAUTHENTICATED);

    const secret = process.env.BOOTSTRAP_ADMIN_SECRET;
    if (!secret || secret.length < 20) fail(AppErrorCode.FORBIDDEN, 'disabled');

    const data = asObject(request.data);
    const provided = requireString(data, 'secret', { min: 20, max: 200 });
    if (provided !== secret) fail(AppErrorCode.FORBIDDEN);

    const existing = await db
      .collection(COLLECTIONS.users)
      .where('role', '==', UserRole.SUPER_ADMIN)
      .limit(1)
      .get();
    if (!existing.empty) fail(AppErrorCode.CONFLICT, 'already-bootstrapped');

    const userRef = db.doc(paths.user(caller.uid));
    if (!(await userRef.get()).exists) fail(AppErrorCode.NOT_FOUND, 'register-first');

    await userRef.update({ role: UserRole.SUPER_ADMIN, restaurantId: null, updatedAt: now() });
    await setUserClaims(caller.uid, UserRole.SUPER_ADMIN, null);
    await auth.revokeRefreshTokens(caller.uid);

    await writeAudit({
      actorId: caller.uid,
      actorRole: UserRole.SUPER_ADMIN,
      action: AuditAction.USER_ROLE_CHANGED,
      targetType: 'user',
      targetId: caller.uid,
      newValue: { role: UserRole.SUPER_ADMIN },
      reason: 'bootstrap',
    });

    logger.warn('super admin bootstrapped — remove BOOTSTRAP_ADMIN_SECRET now', {
      uid: caller.uid,
    });
    return { ok: true };
  }),
);
