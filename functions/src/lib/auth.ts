/**
 * Who is calling, and may they.
 *
 * Roles are read from the ID token's custom claims — set only by this server —
 * never from a field in the request body and never from the user document,
 * which the client can partially write.
 */

import type { CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { db, auth } from './admin';
import { fail } from './errors';
import { AppErrorCode } from '../shared/errors';
import { AccountStatus, UserRole } from '../shared/enums';
import { paths } from '../shared/collections';
import { Permission, authorise, hasPermission, mayOrderFood } from '../shared/permissions';
import type { User } from '../shared/models';

export interface Caller {
  uid: string;
  role: UserRole;
  restaurantId: string | null;
  token: Record<string, unknown>;
}

/** Signed in, and nothing more. */
export function requireAuth(request: CallableRequest<unknown>): Caller {
  const authData = request.auth;
  if (!authData?.uid) fail(AppErrorCode.UNAUTHENTICATED);

  const token = authData.token as unknown as Record<string, unknown>;
  const role = (token.role as UserRole) ?? UserRole.CUSTOMER;
  const restaurantId = (token.restaurantId as string) || null;

  return { uid: authData.uid, role, restaurantId, token };
}

/**
 * Signed in, and the account is in good standing.
 *
 * A suspended account can still hold a valid token until it expires, so the
 * status is re-read from Firestore on every action that matters.
 */
export async function requireActiveUser(
  request: CallableRequest<unknown>,
): Promise<{ caller: Caller; user: User }> {
  const caller = requireAuth(request);
  const snapshot = await db.doc(paths.user(caller.uid)).get();
  if (!snapshot.exists) fail(AppErrorCode.FORBIDDEN);

  const user = snapshot.data() as User;

  switch (user.accountStatus) {
    case AccountStatus.ACTIVE:
      break;
    case AccountStatus.SUSPENDED:
      fail(AppErrorCode.ACCOUNT_SUSPENDED);
      break;
    case AccountStatus.BANNED:
      fail(AppErrorCode.ACCOUNT_BANNED);
      break;
    case AccountStatus.REVIEW_REQUIRED:
      // Under review the person can still browse and see their history; the
      // callers that place orders check this explicitly.
      break;
    default:
      fail(AppErrorCode.FORBIDDEN);
  }

  // The claim is the authority, but a mismatch means the token is stale — the
  // safer of the two wins.
  if (user.role !== caller.role) {
    caller.role = user.role;
    caller.restaurantId = user.restaurantId;
  }

  return { caller, user };
}

/** Blocks an account that is flagged for review from creating anything new. */
export function requireNotUnderReview(user: User): void {
  if (user.accountStatus === AccountStatus.REVIEW_REQUIRED) {
    fail(AppErrorCode.ACCOUNT_UNDER_REVIEW);
  }
}

/**
 * Only a customer may order food.
 *
 * THE ROLE IS READ FROM THE STORED USER DOCUMENT, never from the request and
 * never from the token alone. `requireActiveUser` hands back the document it
 * just re-read, and a token is an hour behind the truth: somebody promoted to
 * courier this morning is still carrying a CUSTOMER claim in their pocket.
 * The document is what the platform believes, so the document decides.
 *
 * The failure is deliberately its own code rather than FORBIDDEN. What the
 * person sees is a sentence explaining that this is a work account; what the
 * log keeps is the role that was refused, which is the part nobody outside
 * this server needs to read.
 */
export function requireCustomerAccount(user: User, action: string): void {
  if (mayOrderFood(user.role)) return;

  logger.warn('work account attempted a customer action', {
    uid: user.uid,
    role: user.role,
    restaurantId: user.restaurantId ?? null,
    action,
  });
  fail(AppErrorCode.WORK_ACCOUNT_CANNOT_ORDER);
}

/** Has the permission at all. Says nothing about *whose* data. */
export function requirePermission(caller: Caller, permission: Permission): void {
  if (!hasPermission(caller.role, permission)) fail(AppErrorCode.FORBIDDEN);
}

/**
 * Has the permission AND is allowed to use it on this restaurant.
 *
 * This is the tenant gate. Every restaurant-scoped callable must go through it;
 * a permission check on its own would let one restaurant edit another's menu.
 */
export function requireRestaurantAccess(
  caller: Caller,
  permission: Permission,
  targetRestaurantId: string,
): void {
  if (!hasPermission(caller.role, permission)) fail(AppErrorCode.FORBIDDEN);
  if (!authorise(caller.role, caller.restaurantId, permission, targetRestaurantId)) {
    fail(AppErrorCode.NOT_YOUR_RESTAURANT);
  }
}

/**
 * Writes the role and tenant onto the account's custom claims.
 *
 * The client must refresh its ID token afterwards (`getIdToken(true)`) before
 * the new role takes effect — the app does that on the next auth state change.
 */
export async function setUserClaims(
  uid: string,
  role: UserRole,
  restaurantId: string | null,
): Promise<void> {
  await auth.setCustomUserClaims(uid, { role, restaurantId: restaurantId ?? null });
}
