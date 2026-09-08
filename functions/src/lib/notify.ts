/**
 * QAPINDA — Writing notifications.
 *
 * Stored as a translation key plus parameters, never as a finished sentence —
 * a customer who switches the app to Russian should see their old notifications
 * in Russian too.
 *
 * ONE EVENT, ONE NOTIFICATION, ONE SOUND
 * --------------------------------------
 * Every document written here has a deterministic id: `notificationDedupeKey`
 * of the event, the recipient and — where a repeat is legitimate — the day it
 * happened on. That is the whole deduplication mechanism, and it is structural
 * rather than a check somebody has to remember to write. A retried transaction,
 * a scheduled job passing over the same order a second time, and two function
 * instances racing the same webhook all compute the same id and therefore all
 * write the same document. There is no path through this file that produces two
 * rows for one thing.
 *
 * NOBODY IS SENT SOMEBODY ELSE'S NOTIFICATION
 * -------------------------------------------
 * `roleMayReceive` is checked before the write, so a courier can never be the
 * recipient of an operator's alert even if a call site asks for it. The security
 * rules are the boundary that actually holds; this is what stops a wrong
 * recipient existing in the first place.
 */

import { db, now } from './admin';
import { COLLECTIONS, paths } from '../shared/collections';
import { NotificationType, UserRole, AccountStatus } from '../shared/enums';
import {
  NotificationDeliveryStatus,
  NotificationStatus,
  notificationAllowed,
  notificationDedupeKey,
  notificationPriority,
  notificationSoundEnabled,
  roleAudience,
  roleMayReceive,
  type NotificationPriority,
} from '../shared/notifications';
import type { User } from '../shared/models';

export interface NotifyInput {
  userId: string;
  restaurantId?: string | null;
  /** The order this is about, when it is about one. Also the dedupe subject. */
  orderId?: string | null;
  type: NotificationType;
  params?: Record<string, string | number>;
  link?: string | null;
  /**
   * The bucket within which this event may only happen once.
   *
   * Left out, the recipient plus the subject is the whole key and the event can
   * only ever happen once. Pass a date to let an alert repeat daily — see
   * `OPS_RESTAURANT_OFFLINE`, which a job re-evaluates every fifteen minutes and
   * which must still reach the operator once a day.
   */
  occurrence?: string | null;
  /**
   * What the recipient is, for the panel the notification belongs in.
   *
   * Optional here and required by `notifyIn`, and the difference is the whole
   * reason there are two functions: `notify` reads the recipient's document
   * anyway, so it can look the role up; a transaction may not read once it has
   * begun writing, so its caller has to know. Every transactional call site
   * does — the customer on an order is a CUSTOMER, and the person a courier
   * notification is addressed to is a courier.
   */
  role?: UserRole;
  /** Overrides the table — used when the recipient has the sound switched off. */
  soundEnabled?: boolean;
}

/** The same, for the transactional path, where the role cannot be looked up. */
export type NotifyInTransactionInput = NotifyInput & { role: UserRole };

/** The document, built in one place so `id` and `recipientId` cannot drift. */
function build(input: NotifyInTransactionInput) {
  const id = notificationDedupeKey({
    type: input.type,
    recipientId: input.userId,
    subjectId: input.orderId ?? input.restaurantId ?? null,
    occurrence: input.occurrence ?? null,
  });

  const priority: NotificationPriority = notificationPriority(input.type);

  return {
    id,
    notificationId: id,
    userId: input.userId,
    recipientId: input.userId,
    role: input.role,
    orderId: input.orderId ?? null,
    restaurantId: input.restaurantId ?? null,
    type: input.type,
    titleKey: `notifications.${input.type}.title`,
    bodyKey: `notifications.${input.type}.body`,
    params: input.params ?? {},
    link: input.link ?? null,
    priority,
    soundEnabled: input.soundEnabled ?? notificationSoundEnabled(undefined, input.type),
    read: false,
    readAt: null,
    status: NotificationStatus.UNREAD,
    /*
     * `pending`, never `sent`.
     *
     * Nothing has been delivered at the moment this document is built — it has
     * been *stored*. A session belonging to the recipient is what moves this to
     * `sent`, and a notification that stays `pending` for an evening is exactly
     * the evidence somebody is looking for when a restaurant says the order
     * never reached them.
     */
    deliveryStatus: NotificationDeliveryStatus.PENDING,
    deliveredAt: null,
    /*
     * The log's copy of the sentence, filled in by the device that showed it.
     *
     * Null here because this process has no translations: the dictionaries are
     * shipped with the web app, not with the functions, and inventing a second
     * copy of them beside the server would guarantee the two drift. `titleKey`
     * and `bodyKey` above are the authority; these are only the log.
     */
    title: null,
    body: null,
    createdAt: now(),
  };
}

function refFor(id: string) {
  return db.collection(COLLECTIONS.notifications).doc(id);
}

/**
 * Writes a notification, unless the recipient has switched that kind off.
 *
 * The preference check lives here rather than at each call site so that a
 * setting cannot be honoured in one place and forgotten in another. It reaches
 * only the types `shared/notifications.ts` marks as silenceable; a cancelled
 * order is delivered whatever the settings say, and its *sound* is switched off
 * instead, which is the distinction the whole settings design rests on.
 *
 * A user document that cannot be read is treated as "send it, with sound": the
 * alternative is swallowing a message because of a transient error, and a
 * notification too many is the cheaper failure.
 *
 * `create` rather than `set`, so that a second attempt at the same event is a
 * no-op instead of resetting a notification the person has already read back to
 * unread — which would ring their phone a second time for something they have
 * already dealt with.
 */
export async function notify(input: NotifyInput): Promise<void> {
  const snapshot = await db
    .doc(paths.user(input.userId))
    .get()
    .catch(() => null);

  const recipient = snapshot?.exists ? (snapshot.data() as User) : null;

  // The stored role, not one the caller guessed. A person promoted to operator
  // last week should get their notifications filed under what they are now.
  const role = input.role ?? recipient?.role ?? UserRole.CUSTOMER;

  // The permission matrix, applied before the write rather than after it. A
  // courier can never become the recipient of an operator's alert, however the
  // call site is spelled.
  if (!roleMayReceive(role, input.type)) return;

  const prefs = recipient?.notificationPrefs;

  // The audience is passed, because one type can be two different promises: a
  // restaurant may switch a cancellation off and the customer whose dinner it
  // was may not. `notificationAllowed` cannot know which of them it is looking
  // at unless it is told.
  if (!notificationAllowed(prefs, input.type, roleAudience(role))) return;

  const document = build({
    ...input,
    role,
    soundEnabled: input.soundEnabled ?? notificationSoundEnabled(prefs, input.type),
  });

  await refFor(document.id)
    .create(document)
    // ALREADY_EXISTS. The event has been notified once already, which is
    // exactly what the deterministic id is for; there is nothing to do.
    .catch(async (error: { code?: number }) => {
      if (error?.code === 6) return;

      /*
       * One retry, and it records that it needed one.
       *
       * A transient failure here is a notification that never happened, which
       * is the case `deliveryStatus` exists to make visible. So the retry
       * writes `failed` rather than `pending`: the document is on screen for
       * the recipient either way, and whoever is diagnosing a missing order
       * can see that this one did not go cleanly. If the retry fails too there
       * is nothing left to write it with, and the caller — an order status
       * change, usually — must not be taken down by it.
       */
      await refFor(document.id)
        .create({ ...document, deliveryStatus: NotificationDeliveryStatus.FAILED })
        .catch(() => undefined);
    });
}

/**
 * The same, written inside a transaction or batch alongside whatever caused it.
 *
 * No preference read: a transaction cannot start a read once it has begun
 * writing, and every current caller sends something the settings may not hide.
 * If an optional notification ever needs to be written this way, read the user
 * document *before* the transaction and pass the answer in through
 * `soundEnabled` — do not quietly widen this function.
 *
 * `set` rather than `create`, because a `create` that loses the race would fail
 * the entire batch it is part of and take the order status change down with it.
 * A lost dinner is a worse outcome than a duplicate write, and the duplicate
 * write is not a duplicate notification: the id is a pure function of the
 * event, so the second write lands on the same document as the first.
 *
 * WHY A REPEAT STILL CANNOT PRODUCE TWO NOTIFICATIONS
 * ---------------------------------------------------
 * Because the id is a pure function of the event, the second write lands on the
 * same document as the first: one row, one badge, one sound. Firestore has no
 * conditional write and a transaction may not read once it has begun writing,
 * so there is no way from in here to say "create this, or leave it alone" — and
 * the alternative, `create`, would abort the batch and with it the order status
 * change that the notification is only a footnote to.
 *
 * What a repeat costs, then, is not a duplicate: it is a notification the
 * person had already read being marked unread again. That is bounded by the
 * state machine — `shared/orderState.ts` refuses a transition an order has
 * already made, so no order can be ACCEPTED twice — and the client is the
 * second line: `decideRing` remembers every `notificationId` the session has
 * announced, so even a re-delivered document is silent.
 */
export function notifyIn(
  writer: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch,
  input: NotifyInTransactionInput,
): void {
  if (!roleMayReceive(input.role, input.type)) return;

  const document = build(input);
  (writer as FirebaseFirestore.WriteBatch).set(refFor(document.id), document);
}

// ---------------------------------------------------------------------------
// The operator's desk
// ---------------------------------------------------------------------------

/**
 * How long the roster of operators is trusted for.
 *
 * A Cloud Function instance is reused across many orders, and reading every
 * platform account on each of them would be a query per order for a list that
 * changes when somebody is hired. Two minutes is short enough that a new
 * operator starts receiving alerts within one shift-change and long enough that
 * a busy evening is one read, not a thousand.
 */
const ROSTER_TTL_MS = 120_000;

let rosterCache: { at: number; users: Array<{ uid: string; user: User }> } | null = null;

/**
 * Every platform account that should be told about operational trouble.
 *
 * Operators and the admin. Suspended and banned accounts are excluded at the
 * query, because a person whose access has been withdrawn should not still be
 * accumulating a queue of the platform's problems.
 */
async function operationsRoster(): Promise<Array<{ uid: string; user: User }>> {
  if (rosterCache && Date.now() - rosterCache.at < ROSTER_TTL_MS) return rosterCache.users;

  const snapshot = await db
    .collection(COLLECTIONS.users)
    .where('role', 'in', [UserRole.OPERATOR, UserRole.SUPER_ADMIN])
    .where('accountStatus', '==', AccountStatus.ACTIVE)
    .limit(200)
    .get();

  const users = snapshot.docs.map((doc) => ({ uid: doc.id, user: doc.data() as User }));
  rosterCache = { at: Date.now(), users };
  return users;
}

export interface OperatorAlertInput {
  type: NotificationType;
  orderId?: string | null;
  restaurantId?: string | null;
  params?: Record<string, string | number>;
  link?: string | null;
  occurrence?: string | null;
}

/**
 * Tells the people on duty about something that needs a human.
 *
 * Fan-out, one document per recipient, each with its own deterministic id — so
 * two operators get one notification each and a re-run gives them no more.
 *
 * Each recipient's own settings are read here, which is what makes the owner's
 * "the operator must be able to switch what they want on and off" true: one
 * operator watching the late queue can mute new orders without muting anybody
 * else's. `OPS_ORDER_PROBLEM` is not switchable and reaches all of them.
 *
 * Never called from inside a transaction — it reads the roster — so every call
 * site raises the alert after its own write has committed. An alert lost to a
 * crash between the two is a missed phone call; an order rolled back because
 * the notification failed would be a lost dinner.
 */
export async function notifyOperators(input: OperatorAlertInput): Promise<void> {
  const roster = await operationsRoster().catch(() => []);
  if (roster.length === 0) return;

  const writes = roster.map(({ uid, user }) =>
    notify({
      userId: uid,
      role: user.role,
      type: input.type,
      orderId: input.orderId ?? null,
      restaurantId: input.restaurantId ?? null,
      params: input.params,
      link: input.link ?? null,
      occurrence: input.occurrence ?? null,
    }).catch(() => undefined),
  );

  await Promise.all(writes);
}

/**
 * The operator alerts for one batch of scheduled work, written together.
 *
 * The scheduled jobs raise several alerts at once and also write the marker
 * that stops them raising the same one tomorrow; both belong in the caller's
 * batch, so this hands back the documents rather than writing them. The
 * recipient's settings are read once for the whole batch.
 */
export async function operatorAlertDocuments(
  alerts: OperatorAlertInput[],
): Promise<Array<{ ref: FirebaseFirestore.DocumentReference; data: ReturnType<typeof build> }>> {
  if (alerts.length === 0) return [];

  const roster = await operationsRoster().catch(() => []);
  const documents: Array<{
    ref: FirebaseFirestore.DocumentReference;
    data: ReturnType<typeof build>;
  }> = [];

  for (const { uid, user } of roster) {
    for (const alert of alerts) {
      if (!roleMayReceive(user.role, alert.type)) continue;
      if (!notificationAllowed(user.notificationPrefs, alert.type, roleAudience(user.role))) {
        continue;
      }

      const data = build({
        userId: uid,
        role: user.role,
        type: alert.type,
        orderId: alert.orderId ?? null,
        restaurantId: alert.restaurantId ?? null,
        params: alert.params,
        link: alert.link ?? null,
        occurrence: alert.occurrence ?? null,
        soundEnabled: notificationSoundEnabled(user.notificationPrefs, alert.type),
      });

      documents.push({ ref: refFor(data.id), data });
    }
  }

  return documents;
}

/*
 * There is no table of "which notification a status change earns the customer"
 * any more, because the answer is now none of them for every status.
 *
 * The customer follows their order on the order screen; the seven status
 * notifications that used to live here were removed from `NotificationType`
 * altogether, so this table could not be rebuilt by accident even if somebody
 * wanted to. The one status change anybody is still told about by
 * notification is a cancellation reaching the KITCHEN, and `changeOrderStatus`
 * writes that one where it happens rather than through a lookup.
 */
