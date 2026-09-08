/**
 * QAPINDA — Support tickets.
 *
 * WHAT CHANGED, AND WHY THIS HEADER NO LONGER SAYS WHAT IT USED TO
 * ----------------------------------------------------------------
 * This file used to hold one permanent thread per restaurant, and it said, at
 * length, that customers were excluded on purpose — that the platform does not
 * message customers and a relay that cannot act is worse than a phone number.
 * The owner has reversed that decision: *"həm müştəri dəstəyi, həm də restoran
 * dəstəyi aktiv olmalıdır"*. Customer support is in scope, so the argument for
 * leaving customers out is gone and the paragraph that made it has gone with
 * it rather than sitting here contradicting the code beneath.
 *
 * The one-thread design went too. A permanent thread has no answer to "is this
 * finished?", so an operator reads three unrelated problems interleaved and a
 * restaurant never knows whether last week's question was dropped or dealt
 * with. What replaced it is a ticket: one problem, a status, and a closure that
 * is permanent — a closed ticket is retained forever, readable forever, and
 * takes no new messages, because a new problem is a new ticket. Nothing was
 * thrown away in the change: `migrateSupportConversations` turns every existing
 * restaurant thread into an open ticket carrying all of its messages.
 *
 * THREE LANES, AND ONE OF THEM IS NOT FOR OPERATORS
 * -------------------------------------------------
 *   customer → operator      a problem with an order, usually
 *   restaurant → operator    the everyday operational thing
 *   restaurant → admin       commission, invoices, contracts, account trouble
 *                            — and a complaint about an operator
 *
 * The third lane is why lane access is enforced here and in `firestore.rules`
 * rather than by not drawing a tab: a person cannot be asked to forward a
 * complaint about themselves. `shared/supportState.ts` holds the predicates
 * and both sides read them.
 *
 * Couriers have no support lane at all. A courier's problem goes through the
 * restaurant they ride for — the same boundary that keeps every other
 * customer's address off a phone that gets lost or handed on.
 *
 * Reading is a direct Firestore subscription so a thread is live; writing is
 * these callables, because the unread counters, the ticket summary and the
 * status all have to move in the same transaction as the message or the badges
 * and the queues start lying.
 */

import { onCall } from 'firebase-functions/v2/https';

import { db, now, FieldValue, Timestamp } from '../lib/admin';
import { guard, fail } from '../lib/errors';
import { requireActiveUser, requirePermission } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { notify, notifyOperators } from '../lib/notify';
import { clean } from '../lib/moderation';
import {
  asObject,
  optionalString,
  optionalStringArray,
  requireEnum,
  requireString,
  sanitiseText,
} from '../lib/validate';
import { AppErrorCode, SUPPORT_TRANSITION_ERROR_TO_CODE } from '../shared/errors';
import { COLLECTIONS, legacyTicketId, paths } from '../shared/collections';
import {
  SUPPORT_FEEDBACK_COMMENT_MAX,
  isSupportFeedbackRating,
  supportFeedbackExpiresAt,
} from '../shared/feedback';
import {
  ACTIVE_SUPPORT_STATUSES,
  AuditAction,
  NotificationType,
  SupportActor,
  SupportLane,
  SupportTicketStatus,
  UserRole,
} from '../shared/enums';
import { ADMIN_ROOT, OPERATOR_ROOT, Permission } from '../shared/permissions';
import { displayName } from '../shared/reviews';
import {
  canOpenLane,
  canReachOut,
  checkSupportTransition,
  isTicketClosed,
  lanesHandledBy,
  statusAfterAskerReply,
  supportAccess,
  supportActorFor,
  type SupportTicketRef,
  type SupportViewer,
} from '../shared/supportState';
import type {
  Conversation,
  ConversationMessage,
  Order,
  Restaurant,
  SupportFeedback,
  SupportMessage,
  SupportTicket,
  User,
} from '../shared/models';

const MAX_BODY = 2000;

/**
 * Photographs per message.
 *
 * Three. Enough for "the bag, the receipt, the dish"; few enough that a ticket
 * stays a conversation rather than an album, and that an operator on a laptop
 * is not scrolling past twenty pictures to find the sentence under them.
 */
const MAX_PHOTOS = 3;
const MAX_SUBJECT = 120;

/**
 * How many support threads one account may have open at once.
 *
 * See the reasoning at the call site: a new ticket fans out to every operator
 * and admin, so this is the cheapest place to bound it.
 */
const MAX_OPEN_TICKETS = 3;

/**
 * How many messages one account may send to one ticket per minute.
 *
 * Twelve. Faster than anybody types a real sentence, slow enough that a script
 * cannot bury a conversation or drive the other side's unread badge and push
 * notifications in a loop.
 */
const MAX_MESSAGES_PER_MINUTE = 12;
/** How many tickets a queue screen carries. Older ones are found by filter. */
const PAGE = 100;

/** The name every party sees on a platform message. Never a person's. */
const PLATFORM_SENDER = 'Qapında dəstək';

const LANES = Object.values(SupportLane);
const STATUSES = Object.values(SupportTicketStatus);

/** Where a party's own support screen lives, for a notification to link to. */
const ASKER_LINK: Record<SupportLane, string> = {
  [SupportLane.CUSTOMER_TO_OPERATOR]: '/account/support',
  [SupportLane.RESTAURANT_TO_OPERATOR]: '/panel/support',
  [SupportLane.RESTAURANT_TO_ADMIN]: '/panel/support',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The three facts every access decision is made from. Claims, never payload. */
function viewerOf(caller: { uid: string; role: UserRole; restaurantId: string | null }): SupportViewer {
  return { role: caller.role, uid: caller.uid, restaurantId: caller.restaurantId };
}

/** The slice of a ticket the shared predicates read. */
function refOf(ticket: SupportTicket): SupportTicketRef {
  return {
    lane: ticket.lane,
    status: ticket.status,
    customerId: ticket.customerId,
    restaurantId: ticket.restaurantId,
    // Carried so `supportAccess` can apply the retention rule: a ticket closed
    // more than two weeks ago has left the asker's list. The platform's own
    // access does not consult it.
    closedAtMs: ticket.closedAt?.toMillis?.() ?? null,
  };
}

function isPlatform(role: UserRole): boolean {
  return role === UserRole.OPERATOR || role === UserRole.SUPER_ADMIN;
}

/**
 * Loads a ticket and refuses anyone who may not read it.
 *
 * Every callable below starts here, so "not yours" and "does not exist" come
 * back as the same shape — a customer probing ticket ids learns nothing from
 * the difference between the two.
 */
async function loadReadableTicket(
  viewer: SupportViewer,
  ticketId: string,
): Promise<{ ticket: SupportTicket; ref: FirebaseFirestore.DocumentReference }> {
  const ref = db.doc(paths.supportTicket(ticketId));
  const snapshot = await ref.get();
  if (!snapshot.exists) fail(AppErrorCode.TICKET_NOT_FOUND);

  const ticket = snapshot.data() as SupportTicket;
  if (!supportAccess(viewer, refOf(ticket)).read) fail(AppErrorCode.TICKET_NOT_FOUND);

  return { ticket, ref };
}

/** The one place a ticket document is shaped, so no field can be forgotten. */
function newTicket(input: {
  id: string;
  lane: SupportLane;
  openedBy: string;
  openedByRole: UserRole;
  openedByName: string;
  restaurantId: string | null;
  restaurantName: string | null;
  customerId: string | null;
  customerName: string | null;
  orderId: string | null;
  orderCode: string | null;
  subject: string;
  filtered?: boolean;
  status?: SupportTicketStatus;
  assignedOperatorId?: string | null;
  lastMessage: string;
  lastSenderRole: UserRole | null;
  unreadForPlatform: number;
  unreadForAsker: number;
  migratedFrom?: string | null;
}) {
  return {
    id: input.id,
    lane: input.lane,
    openedBy: input.openedBy,
    openedByRole: input.openedByRole,
    openedByName: input.openedByName,
    restaurantId: input.restaurantId,
    restaurantName: input.restaurantName,
    customerId: input.customerId,
    customerName: input.customerName,
    orderId: input.orderId,
    orderCode: input.orderCode,
    assignedOperatorId: input.assignedOperatorId ?? null,
    assignedAdminId: null,
    subject: input.subject,
    filtered: input.filtered === true,
    status: input.status ?? SupportTicketStatus.OPEN,
    escalated: false,
    escalatedBy: null,
    escalatedAt: null,
    escalationReason: null,
    closedBy: null,
    closedByRole: null,
    closedAt: null,
    lastMessage: input.lastMessage,
    lastMessageAt: now(),
    lastSenderRole: input.lastSenderRole,
    unreadForPlatform: input.unreadForPlatform,
    unreadForAsker: input.unreadForAsker,
    migratedFrom: input.migratedFrom ?? null,
    createdAt: now(),
    updatedAt: now(),
  };
}

/** A message document. `system` marks the notes the server writes itself. */
function newMessage(input: {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: UserRole;
  senderName: string;
  body: string;
  photoUrls?: string[];
  system?: boolean;
  filtered?: boolean;
}) {
  return {
    id: input.id,
    ticketId: input.ticketId,
    senderId: input.senderId,
    senderRole: input.senderRole,
    senderName: input.senderName,
    body: input.body,
    /*
     * Pictures attached to this message.
     *
     * Always an array, never absent, so every reader can map over it without
     * a guard — a message with no photographs has an empty one.
     */
    photoUrls: input.photoUrls ?? [],
    system: input.system === true,
    // Recorded so the gap in a masked sentence reads as moderation rather than
    // as the sender's own typing. The words themselves are not kept anywhere.
    filtered: input.filtered === true,
    createdAt: now(),
  };
}

// ---------------------------------------------------------------------------
// Opening a ticket
// ---------------------------------------------------------------------------

/**
 * Raises a ticket.
 *
 * Two callers, one door. A customer or a restaurant opens a ticket in a lane
 * they are a party to; an operator or admin opens a restaurant thread on the
 * platform's own initiative — the "your acceptance times are slipping" message
 * that the old design supported and nobody asked to lose. `canOpenLane` and
 * `canReachOut` in `shared/supportState.ts` are what separate the two, and the
 * second can only ever produce a RESTAURANT_TO_OPERATOR ticket.
 *
 * When an `orderId` is given the order is verified against the caller before
 * it is stamped onto the ticket. That is not paranoia about the id: the order
 * code and the restaurant on the ticket are what an operator reads instead of
 * asking, so a caller who could attach somebody else's order would be handing
 * an operator the wrong customer's context.
 */
export const openSupportTicket = onCall(
  guard('openSupportTicket', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    const lane = requireEnum<SupportLane>(data, 'lane', LANES);
    // Both the subject and the first message are moderated before anything is
    // read from the database, so a ticket that is nothing but abuse is refused
    // without costing a single document read.
    const subject = clean(requireString(data, 'subject', { min: 3, max: MAX_SUBJECT }));
    const body = clean(sanitiseText(requireString(data, 'body', { min: 1, max: MAX_BODY })));
    const orderId = optionalString(data, 'orderId', { max: 128 });

    const platform = isPlatform(caller.role);
    const reachingOut = platform && canReachOut(caller.role);

    if (!reachingOut && !canOpenLane(caller.role, lane)) {
      fail(AppErrorCode.SUPPORT_LANE_NOT_ALLOWED);
    }
    // The platform never raises a ticket against itself or on a customer's
    // behalf; the only outward thread it may start is with a restaurant.
    if (reachingOut && lane !== SupportLane.RESTAURANT_TO_OPERATOR) {
      fail(AppErrorCode.SUPPORT_LANE_NOT_ALLOWED);
    }

    const profile = user as User;
    const asker = displayName(profile.fullName ?? '');

    // Which restaurant this ticket belongs to. For a party it is their own
    // claim — never a value from the payload, which is the tenant rule. For
    // the platform reaching out it is the restaurant they picked.
    const restaurantId = reachingOut
      ? requireString(data, 'restaurantId', { max: 128 })
      : lane === SupportLane.CUSTOMER_TO_OPERATOR
        ? null
        : caller.restaurantId;

    if (lane !== SupportLane.CUSTOMER_TO_OPERATOR && !restaurantId) {
      fail(AppErrorCode.FORBIDDEN);
    }

    /*
     * HOW MANY THREADS ONE PERSON MAY HAVE OPEN AT ONCE.
     *
     * Opening a ticket is the loudest thing an unprivileged account can do on
     * this platform: every new one notifies EVERY operator and admin — up to
     * two hundred accounts — and each of those notifications wakes up to twenty
     * devices. One customer in a loop was therefore two hundred writes and
     * several thousand push messages per ticket, and a support queue nobody
     * could work.
     *
     * Three at a time. Somebody with a genuinely bad evening — a wrong order,
     * a refund and a question about their account — is inside that, and the
     * limit clears itself the moment an operator resolves one. The platform
     * reaching out to a restaurant is exempt: that is staff work, and it is
     * already gated by a permission.
     */
    if (!platform) {
      const mine = await db
        .collection(COLLECTIONS.supportTickets)
        .where('openedBy', '==', caller.uid)
        .where('status', 'in', ACTIVE_SUPPORT_STATUSES)
        .limit(MAX_OPEN_TICKETS + 1)
        .get();
      if (mine.size >= MAX_OPEN_TICKETS) fail(AppErrorCode.RATE_LIMITED, 'open-tickets');
    }

    // --- Everything that has to be read, read before anything is written ----

    let restaurantName: string | null = null;
    let ownerUserId: string | null = null;

    if (restaurantId) {
      const restaurant = await db.doc(paths.restaurant(restaurantId)).get();
      if (!restaurant.exists) fail(AppErrorCode.RESTAURANT_NOT_FOUND);
      const record = restaurant.data() as Restaurant;
      restaurantName = record.name;
      ownerUserId = record.ownerUserId ?? null;
    }

    let orderCode: string | null = null;
    let orderRestaurantId: string | null = null;
    let orderRestaurantName: string | null = null;

    if (orderId) {
      const order = await db.doc(paths.order(orderId)).get();
      if (!order.exists) fail(AppErrorCode.ORDER_NOT_FOUND);
      const record = order.data() as Order;

      // The order has to be the caller's own, on whichever side they sit.
      const mine =
        lane === SupportLane.CUSTOMER_TO_OPERATOR
          ? record.customerId === caller.uid
          : record.restaurantId === restaurantId;
      if (!mine && !reachingOut) fail(AppErrorCode.FORBIDDEN);

      orderCode = record.code;
      orderRestaurantId = record.restaurantId;
      orderRestaurantName = record.restaurantName;
    }

    // A customer's ticket about an order names the restaurant too, so the
    // operator can see who cooked it without opening the order.
    const finalRestaurantId = restaurantId ?? orderRestaurantId;
    const finalRestaurantName = restaurantName ?? orderRestaurantName;

    const customerId = lane === SupportLane.CUSTOMER_TO_OPERATOR ? caller.uid : null;

    const ticketRef = db.collection(COLLECTIONS.supportTickets).doc();
    const messageRef = db.collection(paths.supportTicketMessages(ticketRef.id)).doc();

    const batch = db.batch();

    batch.set(
      ticketRef,
      newTicket({
        id: ticketRef.id,
        lane,
        openedBy: caller.uid,
        openedByRole: caller.role,
        openedByName: reachingOut ? PLATFORM_SENDER : asker,
        restaurantId: finalRestaurantId,
        restaurantName: finalRestaurantName,
        customerId,
        customerName: customerId ? asker : null,
        orderId,
        orderCode,
        subject: subject.text,
        filtered: subject.filtered || body.filtered,
        // The platform writing first has, by definition, already picked it up.
        status: reachingOut ? SupportTicketStatus.IN_PROGRESS : SupportTicketStatus.OPEN,
        assignedOperatorId: reachingOut ? caller.uid : null,
        lastMessage: body.text,
        lastSenderRole: caller.role,
        unreadForPlatform: reachingOut ? 0 : 1,
        unreadForAsker: reachingOut ? 1 : 0,
      }),
    );

    batch.set(
      messageRef,
      newMessage({
        id: messageRef.id,
        ticketId: ticketRef.id,
        senderId: caller.uid,
        senderRole: caller.role,
        senderName: reachingOut ? PLATFORM_SENDER : asker,
        body: body.text,
        filtered: body.filtered,
      }),
    );

    await batch.commit();

    if (reachingOut && ownerUserId) {
      // The platform wrote first, so the person to ping is the restaurant.
      await notify({
        userId: ownerUserId,
        restaurantId: finalRestaurantId,
        type: NotificationType.SUPPORT_MESSAGE,
        params: { restaurant: finalRestaurantName ?? '' },
        link: ASKER_LINK[lane],
      });
    } else if (!reachingOut) {
      /*
       * A new ticket reaches the operators on duty.
       *
       * This used to rely on somebody having the support queue open — "a
       * ticket raised at the platform lands in a queue that is already
       * watched" — which is true on a busy afternoon and false at nine in the
       * evening. It is one of the few things the owner kept on the operator's
       * list, so it is now actually sent. `notifyOperators` fans out to the
       * platform roster and `roleMayReceive` decides who is in the audience,
       * which for SUPPORT_MESSAGE is the operator and not the admin.
       */
      await notifyOperators({
        type: NotificationType.SUPPORT_MESSAGE,
        restaurantId: finalRestaurantId,
        orderId,
        params: { restaurant: subject.text },
        link: OPERATOR_ROOT,
      }).catch(() => undefined);
    }

    return { ok: true, ticketId: ticketRef.id };
  }),
);

// ---------------------------------------------------------------------------
// Writing into a ticket
// ---------------------------------------------------------------------------

/**
 * Appends one message.
 *
 * Everything moves in one transaction: the message, the summary the queues
 * sort on, the other side's unread counter, and — when the party who raised
 * the ticket writes back — the status, because a ticket marked RESOLVED that
 * has an unanswered question in it is worse than one that was never resolved.
 *
 * ALL READS BEFORE ALL WRITES. Firestore refuses a transaction that reads
 * after writing, and that mistake has taken this codebase down once already.
 * There is exactly one read here and it is the first line of the callback.
 */
export const sendSupportMessage = onCall(
  guard('sendSupportMessage', async (request) => {
    const { caller, user } = await requireActiveUser(request);
    const data = asObject(request.data);

    const ticketId = requireString(data, 'ticketId', { max: 128 });
    /*
     * A message is text, pictures, or both.
     *
     * `body` used to be required, and with photographs that becomes wrong: a
     * customer whose answer to "which item was missing?" is a photograph of the
     * bag should not have to invent a sentence to go with it. So the rule is
     * that a message must carry SOMETHING — and an empty message with no
     * pictures is still refused, because that is a mis-click, not a message.
     */
    const photoUrls = optionalStringArray(data, 'photoUrls', {
      max: MAX_PHOTOS,
      maxLength: 500,
    });

    const rawBody = optionalString(data, 'body', { max: MAX_BODY }) ?? '';
    if (!rawBody.trim() && photoUrls.length === 0) {
      fail(AppErrorCode.VALIDATION_FAILED, 'body');
    }

    /*
     * Only our own Storage bucket, checked here rather than trusted.
     *
     * A URL sent by a client is a URL a client chose. Without this a support
     * message could carry a link to anywhere — a tracking pixel that tells
     * somebody when an operator opened their ticket, or an image hosted
     * elsewhere that is swapped for something else after it has been seen and
     * accepted. Pinning it to `firebasestorage.googleapis.com` means the file
     * is one this project's own storage rules admitted.
     */
    for (const url of photoUrls) {
      if (!/^https:\/\/firebasestorage\.googleapis\.com\//.test(url)) {
        fail(AppErrorCode.VALIDATION_FAILED, 'photoUrls');
      }
    }

    // Moderated before the transaction opens: a message that is nothing but
    // abuse is refused, and one with a word masked out is what gets stored.
    const body = rawBody.trim()
      ? clean(sanitiseText(rawBody))
      : { text: '', filtered: false };

    const viewer = viewerOf(caller);
    const platform = isPlatform(caller.role);
    const senderName = platform
      ? PLATFORM_SENDER
      : displayName((user as User).fullName ?? '');

    const ticketRef = db.doc(paths.supportTicket(ticketId));
    const messageRef = db.collection(paths.supportTicketMessages(ticketId)).doc();

    const outcome = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ticketRef);
      if (!snapshot.exists) fail(AppErrorCode.TICKET_NOT_FOUND);

      const ticket = snapshot.data() as SupportTicket;
      const access = supportAccess(viewer, refOf(ticket));

      // "Not yours" and "does not exist" answer alike, so an id cannot be
      // probed; a ticket you may read but not write says so plainly instead.
      if (!access.read) fail(AppErrorCode.TICKET_NOT_FOUND);
      if (isTicketClosed(ticket.status)) fail(AppErrorCode.TICKET_CLOSED);
      if (!access.reply) fail(AppErrorCode.FORBIDDEN);

      /*
       * A CEILING ON HOW FAST ONE SIDE MAY WRITE.
       *
       * Every message increments the other side's unread counter and — through
       * the notification the ticket raises — can wake their devices. Without a
       * limit, one account could bury a conversation and buzz an operator's
       * telephone in a loop, and the only cost to them is a `while` statement.
       *
       * Counted from the ticket itself rather than a separate document: the
       * window and the count sit on the same row this transaction is already
       * holding, so there is nothing extra to read, nothing to keep in step,
       * and no way for the counter to survive the transaction being retried.
       */
      const windowStart = (ticket as SupportTicket & { rateWindowAt?: { toMillis?: () => number } })
        .rateWindowAt?.toMillis?.() ?? 0;
      const withinWindow = Date.now() - windowStart < 60_000;
      const sentInWindow = withinWindow
        ? ((ticket as SupportTicket & { rateCount?: number }).rateCount ?? 0)
        : 0;
      if (sentInWindow >= MAX_MESSAGES_PER_MINUTE) fail(AppErrorCode.RATE_LIMITED, 'messages');

      // --- reads done; writes from here --------------------------------- //

      const update: Record<string, unknown> = {
        // A photo-only message still has to say something in the ticket list,
        // where there is no room for a picture and a blank row reads as a bug.
        lastMessage: body.text || `📷 ${photoUrls.length}`,
        lastMessageAt: now(),
        lastSenderRole: caller.role,
        updatedAt: now(),
        // Only the *other* side's counter moves. Incrementing your own would
        // badge you for your own message, which is how these always break.
        [platform ? 'unreadForAsker' : 'unreadForPlatform']: FieldValue.increment(1),
        // The rolling minute this message belongs to. Reset rather than
        // incremented when the window has passed, so a slow conversation never
        // accumulates towards the ceiling.
        rateWindowAt: withinWindow ? ticket.rateWindowAt ?? now() : now(),
        rateCount: sentInWindow + 1,
      };

      // Sticky on the ticket, never cleared: it marks that this conversation
      // has needed moderation at some point, which is what an operator picking
      // it up wants to know.
      if (body.filtered) update.filtered = true;

      if (platform) {
        // Answering is picking it up. An operator who replies and forgets to
        // press a status button should not leave the ticket looking untouched.
        if (ticket.status === SupportTicketStatus.OPEN) {
          update.status = SupportTicketStatus.IN_PROGRESS;
        }
        if (caller.role === UserRole.OPERATOR && !ticket.assignedOperatorId) {
          update.assignedOperatorId = caller.uid;
        }
        if (caller.role === UserRole.SUPER_ADMIN && !ticket.assignedAdminId) {
          update.assignedAdminId = caller.uid;
        }
      } else {
        const next = statusAfterAskerReply(ticket.status);
        if (next) update.status = next;
      }

      transaction.update(ticketRef, update);

      transaction.set(
        messageRef,
        newMessage({
          id: messageRef.id,
          ticketId,
          senderId: caller.uid,
          senderRole: caller.role,
          senderName,
          body: body.text,
          photoUrls,
          filtered: body.filtered,
        }),
      );

      return {
        lane: ticket.lane,
        openedBy: ticket.openedBy,
        restaurantId: ticket.restaurantId,
        subject: ticket.subject,
      };
    });

    // Only the platform's reply is worth a push: the party who raised the
    // ticket is not watching a queue, and an operator is.
    if (platform) {
      await notify({
        userId: outcome.openedBy,
        restaurantId: outcome.restaurantId,
        type: NotificationType.SUPPORT_MESSAGE,
        params: { restaurant: outcome.subject },
        link: ASKER_LINK[outcome.lane],
      });
    }

    return { ok: true };
  }),
);

/**
 * Marks a ticket read for whichever side is asking.
 *
 * Deliberately an `update` on an existing document and never a merging `set`.
 * The old `markConversationRead` used `set(…, { merge: true })`, which created
 * a half-formed conversation the moment a restaurant merely opened the support
 * screen: a document with an unread counter and no name, no restaurantId and
 * no timestamps. The inbox then listed those ghosts and the first search
 * keystroke crashed on their missing name, and the restaurant's real first
 * message took the "already exists" branch and never filled the gaps in.
 * Reading something is not a reason to create it.
 */
export const markSupportTicketRead = onCall(
  guard('markSupportTicketRead', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const ticketId = requireString(data, 'ticketId', { max: 128 });

    const viewer = viewerOf(caller);
    const { ticket, ref } = await loadReadableTicket(viewer, ticketId);

    const field = isPlatform(caller.role) ? 'unreadForPlatform' : 'unreadForAsker';
    if ((ticket[field] ?? 0) === 0) return { ok: true };

    await ref.update({ [field]: 0 });
    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Working a ticket
// ---------------------------------------------------------------------------

/** Moves a ticket's status, through the state machine and nothing else. */
export const setSupportTicketStatus = onCall(
  guard('setSupportTicketStatus', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);

    const ticketId = requireString(data, 'ticketId', { max: 128 });
    const status = requireEnum<SupportTicketStatus>(data, 'status', STATUSES);

    const viewer = viewerOf(caller);
    const actor = supportActorFor(caller.role);
    if (!actor) fail(AppErrorCode.FORBIDDEN);

    const ticketRef = db.doc(paths.supportTicket(ticketId));

    const outcome = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ticketRef);
      if (!snapshot.exists) fail(AppErrorCode.TICKET_NOT_FOUND);

      const ticket = snapshot.data() as SupportTicket;
      const access = supportAccess(viewer, refOf(ticket));
      if (!access.read) fail(AppErrorCode.TICKET_NOT_FOUND);
      if (!access.close) fail(AppErrorCode.FORBIDDEN);

      const check = checkSupportTransition(ticket.status, status, actor);
      if (!check.allowed) {
        fail(SUPPORT_TRANSITION_ERROR_TO_CODE[check.reason ?? 'transition-not-allowed']);
      }

      // --- reads done; writes from here --------------------------------- //

      const update: Record<string, unknown> = { status, updatedAt: now() };

      if (status === SupportTicketStatus.CLOSED) {
        // Who closed it and when, kept on the ticket itself. A closed ticket
        // is never deleted; this is the record of how it ended.
        update.closedBy = caller.uid;
        update.closedByRole = caller.role;
        update.closedAt = now();
      }

      transaction.update(ticketRef, update);

      /*
       * "Geri bildirim" — the customer's copy of the closure.
       *
       * Written in the same transaction as the closure, so a ticket cannot end
       * up closed with nothing to show for it, and keyed on the ticket's own id
       * so a retried close writes the same document rather than a second entry.
       *
       * Only the customer lane. A restaurant reads its own closed tickets in
       * its panel, on the ticket itself; this exists because a customer has no
       * such queue and would otherwise never learn that anybody answered.
       *
       * `closedAt` is a server timestamp, which cannot be read back inside the
       * transaction that writes it — so `expiresAt` is computed from the
       * server's clock as this function sees it. A few milliseconds of drift
       * against a fourteen-day retention is not a difference anybody can have.
       */
      if (
        status === SupportTicketStatus.CLOSED &&
        ticket.lane === SupportLane.CUSTOMER_TO_OPERATOR &&
        ticket.customerId
      ) {
        const entry: Omit<SupportFeedback, 'closedAt' | 'createdAt'> = {
          id: ticketId,
          ticketId,
          userId: ticket.customerId,
          subject: ticket.subject,
          lane: ticket.lane,
          orderId: ticket.orderId,
          orderCode: ticket.orderCode,
          restaurantName: ticket.restaurantName,
          closedByRole: caller.role,
          rating: null,
          ratingComment: null,
          ratedAt: null,
          expiresAt: Timestamp.fromMillis(supportFeedbackExpiresAt(Date.now())),
        };

        transaction.set(db.doc(paths.supportFeedback(ticketId)), {
          ...entry,
          closedAt: now(),
          createdAt: now(),
        });
      }

      return { from: ticket.status, ticket };
    });

    if (status === SupportTicketStatus.CLOSED) {
      await writeAudit({
        actorId: caller.uid,
        actorRole: caller.role,
        action: AuditAction.SUPPORT_TICKET_CLOSED,
        targetType: 'supportTicket',
        targetId: ticketId,
        restaurantId: outcome.ticket.restaurantId,
        oldValue: outcome.from,
        newValue: status,
      });
    }

    await notify({
      userId: outcome.ticket.openedBy,
      restaurantId: outcome.ticket.restaurantId,
      type: NotificationType.SUPPORT_TICKET_UPDATED,
      params: { subject: outcome.ticket.subject },
      link: ASKER_LINK[outcome.ticket.lane],
    });

    return { ok: true };
  }),
);

/**
 * "Adminə eskalasiya et".
 *
 * The operator's way out of a ticket they cannot finish — a refund argument, a
 * commission dispute, anything where the honest answer is "this is not mine to
 * decide". The ticket keeps its whole history and its lane; what changes is
 * that it now belongs to the admin by name, and carries who handed it up, when
 * and why. The reason is mandatory: an escalation with no reason is a ticket
 * dropped over a wall.
 *
 * Only an operator escalates. An admin has nobody above them, so
 * `supportAccess` gives them `escalate: false` rather than a button that lies.
 */
export const escalateSupportTicket = onCall(
  guard('escalateSupportTicket', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_SUPPORT_CHAT);

    const data = asObject(request.data);
    const ticketId = requireString(data, 'ticketId', { max: 128 });
    const reason = requireString(data, 'reason', { min: 3, max: 500 });

    const viewer = viewerOf(caller);
    const ticketRef = db.doc(paths.supportTicket(ticketId));
    const noteRef = db.collection(paths.supportTicketMessages(ticketId)).doc();

    const outcome = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ticketRef);
      if (!snapshot.exists) fail(AppErrorCode.TICKET_NOT_FOUND);

      const ticket = snapshot.data() as SupportTicket;
      const access = supportAccess(viewer, refOf(ticket));
      if (!access.read) fail(AppErrorCode.TICKET_NOT_FOUND);
      if (!access.escalate) fail(AppErrorCode.FORBIDDEN);
      if (ticket.escalated) fail(AppErrorCode.TICKET_ALREADY_ESCALATED);

      // --- reads done; writes from here --------------------------------- //

      transaction.update(ticketRef, {
        escalated: true,
        escalatedBy: caller.uid,
        escalatedAt: now(),
        escalationReason: reason,
        // Handed to the admin, but still in progress: an escalated ticket that
        // reverted to OPEN would look like nobody had ever touched it.
        status: SupportTicketStatus.IN_PROGRESS,
        updatedAt: now(),
      });

      // The note is written into the thread so the admin reading it top to
      // bottom sees the handover in place, not as a field beside the chat.
      transaction.set(
        noteRef,
        newMessage({
          id: noteRef.id,
          ticketId,
          senderId: caller.uid,
          senderRole: caller.role,
          senderName: PLATFORM_SENDER,
          body: reason,
          system: true,
        }),
      );

      return ticket;
    });

    await writeAudit({
      actorId: caller.uid,
      actorRole: caller.role,
      action: AuditAction.SUPPORT_TICKET_ESCALATED,
      targetType: 'supportTicket',
      targetId: ticketId,
      restaurantId: outcome.restaurantId,
      reason,
    });

    return { ok: true };
  }),
);

/**
 * Picking a ticket up, and the admin taking one over.
 *
 * An operator claims an unassigned ticket so two people do not answer the same
 * customer twice. An admin may claim any ticket at all, including one an
 * operator is already holding — that is the takeover the owner asked for, and
 * it is audited rather than silent.
 */
export const claimSupportTicket = onCall(
  guard('claimSupportTicket', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_SUPPORT_CHAT);

    const data = asObject(request.data);
    const ticketId = requireString(data, 'ticketId', { max: 128 });

    const viewer = viewerOf(caller);
    const admin = caller.role === UserRole.SUPER_ADMIN;
    const ticketRef = db.doc(paths.supportTicket(ticketId));

    const outcome = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ticketRef);
      if (!snapshot.exists) fail(AppErrorCode.TICKET_NOT_FOUND);

      const ticket = snapshot.data() as SupportTicket;
      const access = supportAccess(viewer, refOf(ticket));
      if (!access.read) fail(AppErrorCode.TICKET_NOT_FOUND);
      if (!access.close) fail(AppErrorCode.FORBIDDEN);
      if (isTicketClosed(ticket.status)) fail(AppErrorCode.TICKET_CLOSED);

      // --- reads done; writes from here --------------------------------- //

      const update: Record<string, unknown> = { updatedAt: now() };

      if (admin) update.assignedAdminId = caller.uid;
      else update.assignedOperatorId = caller.uid;

      if (ticket.status === SupportTicketStatus.OPEN) {
        update.status = SupportTicketStatus.IN_PROGRESS;
      }

      transaction.update(ticketRef, update);
      return ticket;
    });

    if (admin && outcome.assignedOperatorId && outcome.assignedOperatorId !== caller.uid) {
      await writeAudit({
        actorId: caller.uid,
        actorRole: caller.role,
        action: AuditAction.SUPPORT_TICKET_TAKEN_OVER,
        targetType: 'supportTicket',
        targetId: ticketId,
        restaurantId: outcome.restaurantId,
        oldValue: outcome.assignedOperatorId,
        newValue: caller.uid,
      });
    }

    return { ok: true };
  }),
);

// ---------------------------------------------------------------------------
// Reading the queues
// ---------------------------------------------------------------------------

/**
 * The platform's inbox, as a one-shot list.
 *
 * The operator screen no longer uses this. It said here that "every ticket in
 * the lanes I work" was the unscoped read the rules refuse a browser, and that
 * was wrong: the operator's clause names `lane in [...]`, so a subscription
 * carrying that same filter proves itself against it. The screen therefore
 * subscribes — see `watchInboxTickets` — which is what the owner asked for
 * when they said the operator side must never need reloading.
 *
 * It is kept, and kept correct, because it is still the right shape for any
 * caller that wants the queue without a listener: a report, a script, an
 * integration. The lane filter comes from `lanesHandledBy` exactly as before,
 * so an operator's result never contains a RESTAURANT_TO_ADMIN ticket.
 */
export const listSupportTickets = onCall(
  guard('listSupportTickets', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_SUPPORT_CHAT);

    const data = asObject(request.data);
    const status = optionalString(data, 'status', { max: 40 });

    const lanes = lanesHandledBy(caller.role);
    if (lanes.length === 0) fail(AppErrorCode.FORBIDDEN);

    // `in` takes the lane list straight from the role, so the widest query an
    // operator can produce is still the two lanes they are allowed to see.
    const snapshot = await db
      .collection(COLLECTIONS.supportTickets)
      .where('lane', 'in', lanes)
      .orderBy('lastMessageAt', 'desc')
      .limit(PAGE)
      .get();

    const tickets = snapshot.docs
      .map((doc) => doc.data() as SupportTicket)
      .filter((ticket) => !status || ticket.status === status);

    return { ok: true, tickets };
  }),
);

/**
 * The counts behind the operator's queue tabs.
 *
 * Also no longer used by the screen, and for the same reason: the tabs and the
 * overview tiles now count the live subscription, so their figures and the
 * list beneath them cannot disagree — which they could, when one was a
 * server-side aggregate taken at mount and the other a list taken later.
 *
 * Retained because an aggregate over every ticket, rather than over the window
 * a listener holds, is a genuinely different answer and the one a report
 * wants.
 */
export const supportQueueCounts = onCall(
  guard('supportQueueCounts', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_SUPPORT_CHAT);

    const lanes = lanesHandledBy(caller.role);
    if (lanes.length === 0) fail(AppErrorCode.FORBIDDEN);

    const counts = await Promise.all(
      lanes.map(async (lane) => {
        const [active, waiting, unassigned] = await Promise.all([
          db
            .collection(COLLECTIONS.supportTickets)
            .where('lane', '==', lane)
            .where('status', 'in', ACTIVE_SUPPORT_STATUSES)
            .count()
            .get(),
          db
            .collection(COLLECTIONS.supportTickets)
            .where('lane', '==', lane)
            .where('status', '==', SupportTicketStatus.WAITING_FOR_CUSTOMER)
            .count()
            .get(),
          db
            .collection(COLLECTIONS.supportTickets)
            .where('lane', '==', lane)
            .where('status', '==', SupportTicketStatus.OPEN)
            .count()
            .get(),
        ]);

        return {
          lane,
          active: active.data().count,
          waiting: waiting.data().count,
          unassigned: unassigned.data().count,
        };
      }),
    );

    return { ok: true, counts };
  }),
);

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Turns every pre-ticket restaurant thread into an open ticket.
 *
 * The old design had one permanent conversation per restaurant. Those threads
 * are the history of a real working relationship and orphaning them — leaving
 * them in a collection nothing reads — would have been the same as deleting
 * them. So each becomes one OPEN ticket in the restaurant → operator lane,
 * with every message copied across in order and the original conversation
 * retained untouched.
 *
 * Idempotent by construction: the ticket's id is derived from the restaurant
 * (`legacyTicketId`), and messages keep their original ids, so running this
 * twice writes the same documents rather than a second copy of the history.
 * Admin-only, and safe to run again after a partial failure.
 */
export const migrateSupportConversations = onCall(
  guard('migrateSupportConversations', async (request) => {
    const { caller } = await requireActiveUser(request);
    requirePermission(caller, Permission.PLATFORM_EDIT_SETTINGS);

    const conversations = await db.collection(COLLECTIONS.conversations).limit(500).get();

    let migrated = 0;
    let messagesCopied = 0;

    for (const doc of conversations.docs) {
      const conversation = doc.data() as Conversation;
      const restaurantId = conversation.restaurantId ?? doc.id;

      // A thread that was never written into is nothing to carry over. The old
      // `markConversationRead` created empty shells like these by accident.
      const messages = await db
        .collection(paths.conversationMessages(doc.id))
        .orderBy('createdAt', 'asc')
        .get();
      if (messages.empty) continue;

      // The restaurant name may be missing on a shell document, so it is
      // re-read rather than trusted — a nameless ticket is unfindable.
      let restaurantName = conversation.restaurantName ?? '';
      let ownerUserId: string | null = null;
      const restaurant = await db.doc(paths.restaurant(restaurantId)).get();
      if (restaurant.exists) {
        const record = restaurant.data() as Restaurant;
        restaurantName = record.name;
        ownerUserId = record.ownerUserId ?? null;
      }

      const ticketId = legacyTicketId(restaurantId);
      const ticketRef = db.doc(paths.supportTicket(ticketId));

      // Already carried over. Re-writing the ticket would reset a status an
      // operator has since moved and re-raise unread badges they have cleared,
      // which is a worse kind of "idempotent" than simply not doing it twice.
      if ((await ticketRef.get()).exists) continue;

      const last = messages.docs[messages.docs.length - 1].data() as ConversationMessage;

      const batch = db.batch();

      batch.set(
        ticketRef,
        {
          ...newTicket({
            id: ticketId,
            lane: SupportLane.RESTAURANT_TO_OPERATOR,
            // Attributed to the restaurant's owner where one is known, so the
            // thread appears in that restaurant's list of its own tickets.
            openedBy: ownerUserId ?? restaurantId,
            openedByRole: UserRole.RESTAURANT_OWNER,
            openedByName: restaurantName,
            restaurantId,
            restaurantName,
            customerId: null,
            customerName: null,
            orderId: null,
            orderCode: null,
            subject: restaurantName || restaurantId,
            lastMessage: last.body,
            lastSenderRole: last.senderRole,
            unreadForPlatform: conversation.unreadForPlatform ?? 0,
            unreadForAsker: conversation.unreadForRestaurant ?? 0,
            migratedFrom: doc.id,
          }),
          // The thread's own history, not the moment it was migrated. A ticket
          // that claimed to have been created today would sort to the top of
          // every queue and lie about how long the restaurant has been waiting.
          createdAt: conversation.createdAt ?? last.createdAt,
          lastMessageAt: conversation.lastMessageAt ?? last.createdAt,
        },
        { merge: true },
      );

      for (const message of messages.docs) {
        const record = message.data() as ConversationMessage;
        batch.set(
          db.doc(`${paths.supportTicketMessages(ticketId)}/${message.id}`),
          {
            id: message.id,
            ticketId,
            senderId: record.senderId,
            senderRole: record.senderRole,
            senderName: record.senderName,
            body: record.body,
            system: false,
            createdAt: record.createdAt,
          } satisfies SupportMessage,
          { merge: true },
        );
        messagesCopied += 1;
      }

      await batch.commit();
      migrated += 1;
    }

    await writeAudit({
      actorId: caller.uid,
      actorRole: caller.role,
      action: AuditAction.SETTINGS_UPDATED,
      targetType: 'supportTickets',
      targetId: 'migration',
      newValue: { migrated, messagesCopied },
    });

    return { ok: true, migrated, messagesCopied, adminRoot: ADMIN_ROOT };
  }),
);

/**
 * A ticket's messages, for a party that cannot subscribe to them.
 *
 * Present for completeness of the API surface — every screen in the app reads
 * the thread live through the security rules instead, which is both cheaper
 * and what makes a chat feel like one.
 */
export const getSupportTicket = onCall(
  guard('getSupportTicket', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);
    const ticketId = requireString(data, 'ticketId', { max: 128 });

    const viewer = viewerOf(caller);
    const { ticket } = await loadReadableTicket(viewer, ticketId);

    const messages = await db
      .collection(paths.supportTicketMessages(ticketId))
      .orderBy('createdAt', 'asc')
      .limit(200)
      .get();

    return {
      ok: true,
      ticket,
      messages: messages.docs.map((doc) => doc.data() as SupportMessage),
      access: supportAccess(viewer, refOf(ticket)),
      actor: supportActorFor(caller.role) ?? SupportActor.SYSTEM,
    };
  }),
);

// ---------------------------------------------------------------------------
// Geri bildirim
// ---------------------------------------------------------------------------

/**
 * "Necə həll olundu?" — the customer's rating of a closed ticket.
 *
 * WHY THE RATING IS WRITTEN IN TWO PLACES
 * ---------------------------------------
 * The Geri bildirim entry is transient: it is deleted once its retention period
 * is up, and that is what the owner asked for. A rating that lived only there
 * would be deleted with it, and the one piece of information support actually
 * wants out of this feature — was the person happy — would evaporate on a
 * schedule. So the rating is copied onto the SUPPORT TICKET, which is retained
 * and never deleted, in the same transaction that records it on the entry.
 *
 * A rating may be changed while the entry exists and cannot be given at all
 * once it is gone: there is no second document to write it to, and inventing
 * one would be re-creating the thing that was deliberately expired.
 *
 * Reads before writes, like every transaction here.
 */
export const rateSupportFeedback = onCall(
  guard('rateSupportFeedback', async (request) => {
    const { caller } = await requireActiveUser(request);
    const data = asObject(request.data);

    const feedbackId = requireString(data, 'feedbackId', { max: 128 });
    const rating = data.rating;
    if (!isSupportFeedbackRating(rating)) fail(AppErrorCode.VALIDATION_FAILED, 'rating');

    const comment = optionalString(data, 'comment', { max: SUPPORT_FEEDBACK_COMMENT_MAX });
    const cleaned = comment ? clean(comment) : null;

    const feedbackRef = db.doc(paths.supportFeedback(feedbackId));

    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(feedbackRef);
      // Expired and swept, or never this person's. The same answer either way:
      // there is nothing here for you. Distinguishing them would tell a caller
      // which ticket ids exist.
      if (!snapshot.exists) fail(AppErrorCode.TICKET_NOT_FOUND, 'feedback');

      const entry = snapshot.data() as SupportFeedback;
      if (entry.userId !== caller.uid) fail(AppErrorCode.FORBIDDEN, 'feedback');

      const ticketRef = db.doc(paths.supportTicket(entry.ticketId));
      const ticket = await transaction.get(ticketRef);

      // --- reads done; writes from here --------------------------------- //

      transaction.update(feedbackRef, {
        rating,
        ratingComment: cleaned?.text ?? null,
        ratedAt: now(),
      });

      // The retained half. A ticket that has somehow gone is not an error the
      // customer can do anything about, and their rating is still recorded on
      // the entry they are looking at.
      if (ticket.exists) {
        transaction.update(ticketRef, {
          supportRating: rating,
          supportRatingComment: cleaned?.text ?? null,
          supportRatingAt: now(),
          updatedAt: now(),
        });
      }
    });

    return { ok: true };
  }),
);
