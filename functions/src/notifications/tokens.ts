/**
 * QAPINDA — Registering and forgetting a device.
 *
 * WHY THIS IS A CALLABLE AND NOT A CLIENT WRITE
 * ---------------------------------------------
 * The obvious build is to let the browser write its own token straight into
 * Firestore. It is one line and it is wrong twice over.
 *
 * The token is the document id, so a client that could write the collection
 * could write *any* id — including a token belonging to somebody else's phone,
 * with its own `userId` on it. Every notification for that account would then
 * also ring on the attacker's device: order codes, addresses in the link,
 * refund amounts. There is no Firestore rule that catches this, because from
 * the rules' point of view the write is a signed-in user creating a document
 * with their own uid in it.
 *
 * And a client write cannot enforce the thing that keeps the collection honest:
 * a token registered to one account must not stay registered to it after
 * somebody else signs in on that tablet. The kitchen tablet handed to a new
 * franchise, the phone sold on — the token is the same, the person is not.
 * `registerPushToken` claims the token for the caller, overwriting whoever held
 * it, which is the only correct answer and one only the server can give.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, now } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser } from '../lib/auth';
import { asObject, optionalString, requireEnum, requireString } from '../lib/validate';
import { AppErrorCode } from '../shared/errors';
import { COLLECTIONS } from '../shared/collections';
import { PushPlatform } from '../shared/push';

/** FCM tokens are long. This is comfortably above what any platform issues. */
const MAX_TOKEN = 4096;

const PLATFORMS = Object.values(PushPlatform);

/**
 * Claims this device for the signed-in account.
 *
 * Called on every app start, not only on the first: the point is `lastSeenAt`.
 * FCM tokens are invalidated by events rather than by a clock, so "when did a
 * living app last confirm this one" is the only signal that separates a device
 * in daily use from a browser somebody cleared six months ago — and it is what
 * `pruneStalePushTokens` reads.
 *
 * `set` without merge, deliberately. A token that used to belong to another
 * account is taken over completely rather than left with a stale `userId`
 * beside a new one; the kitchen tablet that changed hands must stop ringing for
 * the previous owner the moment somebody else signs in on it.
 */
export const registerPushToken = onCall(
  guard('registerPushToken', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);

    const token = requireString(data, 'token', { min: 20, max: MAX_TOKEN });
    const platform = requireEnum<PushPlatform>(data, 'platform', PLATFORMS);
    // Trimmed hard: this exists so a person can be told "your iPhone has
    // notifications switched off", not so the platform can fingerprint a
    // browser. A full user-agent string is neither needed nor kept.
    const device = optionalString(data, 'device', { max: 120 });

    await db
      .collection(COLLECTIONS.pushTokens)
      .doc(token)
      .set({
        token,
        userId: caller.uid,
        platform,
        device: device ?? null,
        createdAt: now(),
        lastSeenAt: now(),
      });

    return { ok: true as const };
  }),
);

/**
 * Forgets this device.
 *
 * Called when somebody switches notifications off and when they sign out. The
 * sign-out case is the one that matters: a token left registered keeps ringing
 * a shared tablet with the previous account's orders, and the person who reads
 * them was never entitled to them.
 *
 * The caller must own the token. Otherwise this callable would be a way to
 * silence somebody else's kitchen — quietly, and with no error anywhere.
 */
export const unregisterPushToken = onCall(
  guard('unregisterPushToken', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);

    const token = requireString(data, 'token', { min: 20, max: MAX_TOKEN });
    const ref = db.collection(COLLECTIONS.pushTokens).doc(token);
    const snapshot = await ref.get();

    if (!snapshot.exists) return { ok: true as const };
    if (snapshot.data()?.userId !== caller.uid) fail(AppErrorCode.FORBIDDEN);

    await ref.delete();
    return { ok: true as const };
  }),
);
