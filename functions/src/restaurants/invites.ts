/**
 * QAPINDA — nobody joins a restaurant without saying yes.
 *
 * WHAT THIS REPLACES
 * ------------------
 * `setRestaurantStaff` took a telephone number and changed that account's role
 * on the spot. The person found out by opening the app and discovering it had
 * turned into a restaurant panel: no message, no question, and no way out
 * except asking the restaurant to undo it.
 *
 * It was also a way to reach into somebody else's account. Anyone who could
 * manage a team could bind a stranger to their business by typing a number they
 * had seen once — and the bound account then carried a `restaurantId` claim,
 * which is the tenant boundary the whole security model rests on.
 *
 * So the number now produces an OFFER. The role changes on the invited person's
 * own tap and on nothing else.
 *
 * WHAT IS STILL IMMEDIATE, AND WHY THAT IS RIGHT
 * ----------------------------------------------
 * REMOVAL. Setting somebody back to CUSTOMER happens at once, with no
 * invitation and no acceptance. Consent protects a person from being enrolled;
 * it is not a veto over being let go, and a restaurant that has just dismissed
 * somebody must not have to wait for that person's agreement before their
 * access to the customer list ends.
 *
 * WHY EXPIRY IS CHECKED ON READ RATHER THAN SWEPT BY A JOB
 * --------------------------------------------------------
 * An invitation nobody answers is harmless — it grants nothing. The only moment
 * its age matters is the moment somebody tries to accept it, and that is
 * exactly when this code is running anyway. A scheduled sweep would spend a job
 * every hour to keep a field tidy that only one code path ever reads.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, auth, now, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requireRestaurantAccess, setUserClaims } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { notify } from '../lib/notify';
import { asObject, requireBoolean, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { AuditAction, InviteStatus, NotificationType, PLATFORM_ROLES, UserRole } from '../shared/enums';
import { paths } from '../shared/collections';
import { Permission } from '../shared/permissions';
import type { RestaurantInvite, User } from '../shared/models';

/**
 * How long an offer stands.
 *
 * A fortnight covers somebody on holiday and is short enough that a list of
 * pending invitations is a list of live ones. An expired invitation is not
 * deleted — "we invited them and they never answered" is a thing a restaurant
 * with a staffing dispute wants to be able to show.
 */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function isLive(invite: RestaurantInvite): boolean {
  if (invite.status !== InviteStatus.PENDING) return false;
  const expiresMs = invite.expiresAt?.toMillis?.();
  return typeof expiresMs !== 'number' || expiresMs > Date.now();
}

/**
 * The invited person answers.
 *
 * Only they can call it: the invitation is addressed to their uid and the
 * check below compares it against the caller's own, not against anything in
 * the request. A payload that names somebody else's invitation is refused as
 * not found rather than as forbidden — there is no reason to confirm to a
 * stranger that a given invitation exists.
 */
export const respondToRestaurantInvite = onCall(
  guard('respondToRestaurantInvite', async (request) => {
    const { caller, user } = await requireActiveUser(request);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const accept = requireBoolean(data, 'accept');

    const ref = db.doc(paths.restaurantInvite(restaurantId, caller.uid));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.NOT_FOUND, 'invite');

    const invite = snapshot.data() as RestaurantInvite;

    // The address on the envelope, checked against who opened it.
    if (invite.uid !== caller.uid) fail(AppErrorCode.NOT_FOUND, 'invite');

    if (!isLive(invite)) {
      // Recorded so the list stops offering a button that cannot work.
      if (invite.status === InviteStatus.PENDING) {
        await ref.update({ status: InviteStatus.EXPIRED, answeredAt: now() }).catch(() => undefined);
      }
      fail(AppErrorCode.CONFLICT, 'invite-not-open');
    }

    /*
     * The state of the person is re-read here, not trusted from the invitation.
     *
     * Between being invited and answering, somebody may have taken a job at
     * another restaurant, been made an operator, or become an owner. Accepting
     * a fortnight-old offer must not quietly move an account out of any of
     * those.
     */
    if (accept) {
      // Somebody else's restaurant took them on while this offer was sitting
      // there. That is a real conflict and the person has to be told.
      if (user.restaurantId && user.restaurantId !== restaurantId) {
        fail(AppErrorCode.CONFLICT, 'other-restaurant');
      }

      /*
       * A PLATFORM ROLE IS THE ONLY ROLE THAT BLOCKS ACCEPTANCE.
       *
       * This used to demand `role === CUSTOMER`, which refused the ordinary
       * case as well: a member of staff at this same restaurant, offered the
       * courier job. `setRestaurantStaff` no longer sends an invitation in that
       * case at all — but an invitation written before that change, or one to
       * somebody whose role moved while it sat unanswered, still has to answer
       * correctly rather than with a bare 400.
       *
       * An operator or a super admin is different: those accounts hold power
       * over every restaurant on the platform, and quietly binding one to a
       * single shop through an invitation it accepted is not a thing this
       * callable may do.
       */
      if (PLATFORM_ROLES.includes(user.role)) fail(AppErrorCode.CONFLICT, 'role-changed');
    }

    await ref.update({
      status: accept ? InviteStatus.ACCEPTED : InviteStatus.DECLINED,
      answeredAt: now(),
    });

    if (accept) {
      await db
        .doc(paths.user(caller.uid))
        .update({ role: invite.role, restaurantId, updatedAt: now() });
      await setUserClaims(caller.uid, invite.role, restaurantId);
      /*
       * The token in this person's own browser still says CUSTOMER, and the
       * security rules read only the token. Without this they would have the
       * new role in every callable and the old one in every direct Firestore
       * read — the panel would load and its data would not.
       */
      await auth.revokeRefreshTokens(caller.uid).catch(() => undefined);
    }

    await writeAudit({
      actorId: caller.uid,
      actorRole: user.role,
      action: accept ? AuditAction.USER_ROLE_CHANGED : AuditAction.RESTAURANT_INVITE_DECLINED,
      targetType: 'user',
      targetId: caller.uid,
      restaurantId,
      oldValue: { role: user.role },
      newValue: accept ? { role: invite.role, restaurantId } : { declined: true },
      reason: accept ? 'invitation accepted' : 'invitation declined',
      ip: request.rawRequest.ip ?? null,
    }).catch(() => undefined);

    /*
     * Told to whoever asked, and TOLD WHAT HAPPENED.
     *
     * This used to send one sentence — "X answered your invitation" — with the
     * yes or no hidden in a parameter the text never printed. A notification
     * that reports an event without reporting its outcome makes the reader open
     * the staff screen to find out, which is the whole job it was supposed to
     * do for them. Two separate types now, so the banner itself says it.
     */
    await notify({
      userId: invite.invitedBy,
      restaurantId,
      role: UserRole.RESTAURANT_OWNER,
      type: accept
        ? NotificationType.RESTAURANT_INVITE_ACCEPTED
        : NotificationType.RESTAURANT_INVITE_DECLINED,
      params: { name: user.fullName, role: invite.role },
      link: '/panel/staff',
    }).catch(() => undefined);

    return { ok: true, accepted: accept };
  }),
);

/**
 * The restaurant withdraws an offer it has not had an answer to.
 *
 * Same permission as making one. Withdrawing an ACCEPTED invitation does
 * nothing here on purpose — that person is on the team now, and taking them off
 * it is `setRestaurantStaff` with CUSTOMER, which is a different act with a
 * different audit entry.
 */
export const cancelRestaurantInvite = onCall(
  guard('cancelRestaurantInvite', async (request) => {
    const { caller, user: actor } = await requireActiveUser(request);

    const data = asObject(request.data);
    const restaurantId = requireString(data, 'restaurantId', { max: 128 });
    const uid = requireString(data, 'uid', { max: 128 });

    requireRestaurantAccess(caller, Permission.RESTAURANT_MANAGE_STAFF, restaurantId);

    const ref = db.doc(paths.restaurantInvite(restaurantId, uid));
    const snapshot = await ref.get();
    if (!snapshot.exists) fail(AppErrorCode.NOT_FOUND, 'invite');

    const invite = snapshot.data() as RestaurantInvite;
    if (invite.status !== InviteStatus.PENDING) fail(AppErrorCode.CONFLICT, 'invite-not-open');

    await ref.update({ status: InviteStatus.CANCELLED, answeredAt: now() });

    await writeAudit({
      actorId: caller.uid,
      actorRole: actor.role,
      action: AuditAction.RESTAURANT_INVITE_CANCELLED,
      targetType: 'user',
      targetId: uid,
      restaurantId,
      newValue: { role: invite.role },
      reason: 'invitation withdrawn',
    }).catch(() => undefined);

    return { ok: true };
  }),
);

/**
 * Writes (or replaces) the offer, and tells the person.
 *
 * Called by `setRestaurantStaff`, which keeps the permission check, the
 * telephone lookup and every refusal that guards who may be invited at all.
 * This is only the part that records the offer.
 *
 * The id is deterministic — `restaurantId__uid` — so inviting the same person
 * twice replaces one document rather than leaving a trail of offers each of
 * which would separately be acceptable.
 */
export async function writeRestaurantInvite(input: {
  restaurantId: string;
  restaurantName: string;
  uid: string;
  role: UserRole;
  invitedBy: string;
}): Promise<void> {
  const ref = db.doc(paths.restaurantInvite(input.restaurantId, input.uid));

  const invite: RestaurantInvite = {
    id: ref.id,
    restaurantId: input.restaurantId,
    restaurantName: input.restaurantName,
    uid: input.uid,
    role: input.role,
    status: InviteStatus.PENDING,
    invitedBy: input.invitedBy,
    createdAt: now() as unknown as RestaurantInvite['createdAt'],
    expiresAt: Timestamp.fromMillis(
      Date.now() + INVITE_TTL_MS,
    ) as unknown as RestaurantInvite['expiresAt'],
    answeredAt: null,
  };

  await ref.set(invite);

  await notify({
    userId: input.uid,
    restaurantId: input.restaurantId,
    role: UserRole.CUSTOMER,
    type: NotificationType.RESTAURANT_INVITE,
    params: { name: input.restaurantName },
    link: '/account',
  }).catch(() => undefined);
}

/** Exported for the tests, and for anything that needs the same freshness rule. */
export { isLive as inviteIsLive };

/** Narrow helper so callers do not have to import `User` just for a role check. */
export function mayBeInvited(target: Pick<User, 'role' | 'restaurantId'>): boolean {
  return target.role === UserRole.CUSTOMER && !target.restaurantId;
}
