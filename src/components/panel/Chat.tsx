'use client';

/**
 * One support ticket, from either end.
 *
 * The same component serves the operator, the admin, the restaurant and the
 * customer, because a ticket is genuinely symmetric — two parties, one
 * history. What differs is decided by `supportAccess` in
 * `shared/supportState.ts`, the same function the server checks before it
 * accepts anything: who may reply, who may close, who may escalate. Building
 * four of these would guarantee they drifted apart, and drifting apart is how
 * a screen ends up offering a button the server refuses.
 *
 * NO OPTIMISTIC BUBBLE, ON PURPOSE
 * --------------------------------
 * The obvious trick is to paint the message immediately and reconcile later.
 * Here it costs more than it buys: the live subscription brings the real
 * message back in well under a second, while a failed optimistic bubble has to
 * either vanish under the reader's eyes or sit there marked "not sent" — and in
 * a support thread the difference between "I told them" and "I thought I told
 * them" is the whole point. The composer holds the text until the server has
 * it, and the send button spins while it waits.
 *
 * QUICK REPLIES, AND WHY THEY ONLY EVER FILL THE BOX
 * --------------------------------------------------
 * The platform side gets the ready sentences above the composer — seventy-odd
 * of them, grouped by the situation and searchable, because "an answer ready
 * for anything" is only useful if the right one can be found in two moves.
 * Picking one drops it into the draft and stops there: the operator edits it
 * and sends it themselves. The templates that name a fact — the order code, the amount
 * being returned — take it from the ticket and from the order behind it rather
 * than asking an operator to look it up and retype it, and the ones whose
 * facts are not known are simply not offered. See `shared/supportTemplates.ts`.
 *
 * THREE LANGUAGES, ONE RECORD
 * ---------------------------
 * Baku support is answered in Azerbaijani, Russian and English, and a
 * restaurant owner writing in one to an operator who reads another is an
 * ordinary Tuesday. Every message the other side sent carries a translate
 * button, and the header carries a toggle for the whole thread that keeps
 * translating what arrives next. What it never does is replace anything: the
 * original is what is stored, what is shown by default and what is one tap
 * away, and every translated bubble says "machine translation" underneath it.
 * A support thread is the record of a commercial dispute, and a machine's
 * paraphrase standing in for the record is not the record. The words go to a
 * callable, never to a translation API from the browser — see
 * `functions/src/support/translate.ts`.
 *
 * A CLOSED TICKET IS READ-ONLY, NOT HIDDEN
 * ----------------------------------------
 * The composer is replaced by a line explaining that this one is finished and
 * a new problem needs a new ticket. The history stays on screen: closing a
 * ticket ends the conversation, it does not take away what was said.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Languages, Send, ShieldAlert } from 'lucide-react';

import { StatusBadge } from './ui';
import { supportTone, when } from './status';
import { useToast } from './Toast';
import { OperatorTemplatePicker } from '@/components/support/OperatorTemplatePicker';
import { Alert, Button, Card, Select, Spinner, cn } from '@/components/ui';
import { useLocale, useT, translateError } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { PhotoPicker } from '@/components/ui/PhotoPicker';
import {
  escalateSupportTicket,
  markSupportTicketRead,
  sendSupportMessage,
  setSupportTicketStatus,
  translateSupportMessage,
} from '@/firebase/callables';
import { watchTicket, watchTicketMessages } from '@/services/support';
import { watchOrder } from '@/services/orders';
import { isPlatformRole } from '@/shared/permissions';
import { containsProfanity } from '@/shared/profanity';
import { formatMoney } from '@/shared/pricing';
import {
  MAX_BULK_TRANSLATIONS,
  cachedTranslation,
  isTranslatable,
  type MessageTranslation,
} from '@/shared/translation';
import {
  nextTicketStatusesFor,
  supportAccess,
  supportActorFor,
} from '@/shared/supportState';
import { SupportActor, SupportLane, SupportTicketStatus } from '@/shared/enums';
import type { Order, SupportMessage, SupportTicket } from '@/shared/models';
import { SecureImage } from '@/components/ui/Img';

/** The server's own cap on a message body. Mirrored so the box stops first. */
const MAX_BODY = 2000;

/** And on an escalation reason, which the server refuses when it is empty. */
const MAX_REASON = 500;

export function Chat({
  ticketId,
  /** Optional: the row the inbox already has, so the header paints instantly. */
  seed,
  className,
}: {
  ticketId: string;
  seed?: SupportTicket | null;
  className?: string;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const { firebaseUser, role, restaurantId } = useAuth();

  const [ticket, setTicket] = useState<SupportTicket | null>(seed ?? null);
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  /** URLs of pictures already uploaded and waiting to be sent with the text. */
  const [photos, setPhotos] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [reason, setReason] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  /*
   * TRANSLATION IS A VIEW, NOT A COPY.
   *
   * The translated words live on the message document, put there by the
   * server, and arrive through the same live subscription as everything else
   * — so there is no second cache here to fall out of step with the first.
   * These two sets hold only what belongs to this screen: which bubbles the
   * reader has asked to see translated, and which are waiting on the server.
   */
  const [showTranslated, setShowTranslated] = useState<Set<string>>(new Set());
  const [translating, setTranslating] = useState<Set<string>>(new Set());
  /** Translate everything the other side says, including what arrives next. */
  const [autoTranslate, setAutoTranslate] = useState(false);

  const scroller = useRef<HTMLDivElement | null>(null);

  // This component never switches tickets in place — every screen that mounts
  // it gives it a `key`, so a new ticket is a new mount. That is what lets the
  // subscription effects below just subscribe instead of also clearing the
  // previous ticket's messages and draft, and it is the reason a half-typed
  // reply can never surface in the wrong thread.

  useEffect(() => watchTicket(ticketId, setTicket), [ticketId]);
  useEffect(() => watchTicketMessages(ticketId, setMessages), [ticketId]);

  // Opening the ticket is reading it, and so is a message arriving while it is
  // on screen — nobody should come back to a badge for something they already
  // read. `markSupportTicketRead` clears only this side's counter and does
  // nothing when it is already zero, so calling it on every new message is
  // cheap and cannot badge the other party.
  const lastMessageId = messages?.[messages.length - 1]?.id ?? null;

  useEffect(() => {
    void markSupportTicketRead(ticketId);
  }, [ticketId, lastMessageId]);

  // Jump to the newest message whenever the thread changes. A chat that opens
  // at the top makes the reader scroll to find out what was just said. The
  // loading flag is a dependency too: the first batch replaces a spinner, and
  // the scroll has to happen after that swap rather than before it.
  const loading = messages === null;

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lastMessageId, loading]);

  // Derived during render, never assigned in an effect: the access answer is a
  // pure function of who is looking and what the ticket currently says.
  const viewer = { role, uid: firebaseUser?.uid ?? '', restaurantId };
  const uid = firebaseUser?.uid ?? null;
  const access = ticket
    ? supportAccess(viewer, {
        lane: ticket.lane,
        status: ticket.status,
        customerId: ticket.customerId,
        restaurantId: ticket.restaurantId,
        // A ticket the asker may no longer see is closed to them here too, so
        // a bookmarked thread cannot outlive the two weeks the list obeys.
        closedAtMs: ticket.closedAt?.toMillis?.() ?? null,
      })
    : { read: false, reply: false, close: false, escalate: false };

  const actor = supportActorFor(role) ?? SupportActor.SYSTEM;
  const platformSide = isPlatformRole(role);
  const closed = ticket?.status === SupportTicketStatus.CLOSED;

  const statusOptions = ticket ? nextTicketStatusesFor(ticket.status, actor) : [];

  // The facts the quick replies interpolate. The order is only read by the
  // platform side — a customer's own screen has no use for it and no reason to
  // spend a listener on it — and only when the ticket names one.
  const orderId = platformSide ? (ticket?.orderId ?? null) : null;

  useEffect(() => {
    if (!orderId) return;
    return watchOrder(orderId, setOrder);
  }, [orderId]);

  // Memoised because the picker keys its grouping off this object; a fresh
  // one every render would regroup seventy-three templates on every keystroke
  // in the composer.
  const facts = useMemo(
    () => ({
      code: ticket?.orderCode ?? null,
      restaurant: ticket?.restaurantName ?? null,
      amount: order ? formatMoney(order.pricing.total) : null,
    }),
    [ticket?.orderCode, ticket?.restaurantName, order],
  );

  // Appended rather than replacing, so an operator who has already typed the
  // specific half of their answer does not lose it by reaching for a template
  // to say the rest.
  const applyTemplate = (sentence: string) => {
    if (!sentence) return;
    setDraft((current) => (current.trim() ? `${current.trim()}\n${sentence}` : sentence));
  };

  /**
   * Fetch and show the translation of one message.
   *
   * Toggling is free once the server has answered: the translation is on the
   * message document, so a second press only flips which words this bubble is
   * drawing. Only the first press costs a call, and only if nobody — not the
   * operator, not the admin, not this reader yesterday — has asked before.
   */
  const toggleTranslation = async (message: SupportMessage) => {
    if (showTranslated.has(message.id)) {
      setShowTranslated((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
      return;
    }

    if (cachedTranslation(message, locale)) {
      setShowTranslated((current) => new Set(current).add(message.id));
      return;
    }

    setTranslating((current) => new Set(current).add(message.id));
    const result = await translateSupportMessage({
      ticketId,
      messageId: message.id,
      target: locale,
    });
    setTranslating((current) => {
      const next = new Set(current);
      next.delete(message.id);
      return next;
    });

    if (!result.ok) {
      toast.show(translateError(t, result.errorCode, result.errorDetail), 'danger');
      return;
    }

    // Shown even when the answer was "already in your language": the bubble
    // says so in that case, which is the honest outcome of the press.
    setShowTranslated((current) => new Set(current).add(message.id));
  };

  /**
   * The other side's messages, in the order they were said.
   *
   * "Mine" is never translated. A reader does not need their own sentences
   * turned into a language they did not write them in, and offering it is the
   * kind of control that makes a screen feel automated rather than built.
   */
  const foreignMessages = (messages ?? []).filter(
    (message) => message.senderId !== uid && isTranslatable(message),
  );

  /**
   * Translate the whole thread, and keep translating what arrives.
   *
   * Bounded by `MAX_BULK_TRANSLATIONS` and run one at a time rather than as a
   * fan-out: an escalated thread carrying a migrated conversation can be a
   * hundred messages, and one press must not become a hundred simultaneous
   * calls billed by the character. Messages the server has already translated
   * cost nothing and are simply revealed.
   */
  const translateAll = async () => {
    if (autoTranslate) {
      setAutoTranslate(false);
      setShowTranslated(new Set());
      return;
    }

    setAutoTranslate(true);

    const pending = foreignMessages
      .filter((message) => !cachedTranslation(message, locale))
      .slice(0, MAX_BULK_TRANSLATIONS);

    // The ones already translated appear at once; only the rest are fetched.
    setShowTranslated(new Set(foreignMessages.map((message) => message.id)));

    await translateEach(pending);
  };

  /**
   * Fetch a run of translations one at a time.
   *
   * Sequential rather than a fan-out: one press must not become twenty-five
   * simultaneous calls to a service billed by the character, and the reader is
   * watching the bubbles fill in from the top anyway. A failure stops the run
   * instead of repeating the same error two dozen times — the usual cause is
   * the service being off, and it will still be off for the next message.
   */
  const translateEach = async (batch: SupportMessage[]) => {
    for (const message of batch) {
      setTranslating((current) => new Set(current).add(message.id));
      const result = await translateSupportMessage({
        ticketId,
        messageId: message.id,
        target: locale,
      });
      setTranslating((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });

      if (!result.ok) {
        toast.show(translateError(t, result.errorCode, result.errorDetail), 'danger');
        setAutoTranslate(false);
        return;
      }

      // Revealed as each one lands rather than all at the end, so a long
      // thread fills in under the reader's eyes instead of sitting still and
      // then jumping.
      setShowTranslated((current) => new Set(current).add(message.id));
    }
  };

  /*
   * A message that arrives while the thread is being read translated.
   *
   * Without this, the toggle would translate what was on screen when it was
   * pressed and quietly stop — so the next thing the other side says would
   * appear in a language the reader turned the control on to avoid. It runs on
   * a new message only, never on a re-render, and every state change inside it
   * happens after an await, so it cannot loop.
   */
  useEffect(() => {
    if (!autoTranslate) return;

    const fresh = (messages ?? []).filter(
      (message) =>
        message.senderId !== uid &&
        isTranslatable(message) &&
        !cachedTranslation(message, locale) &&
        !showTranslated.has(message.id) &&
        !translating.has(message.id),
    );
    if (fresh.length === 0) return;

    // No state is set here: `translateEach` reveals each message after its own
    // await, which is what keeps this effect from writing during render.
    void translateEach(fresh.slice(0, MAX_BULK_TRANSLATIONS));
    // Keyed on the newest message: this is "something was said", not "the
    // component rendered". Listing the sets would re-enter it on its own
    // writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTranslate, lastMessageId]);

  // Derived during render: the warning is a pure function of what is in the
  // box. It is a courtesy and nothing more — the callable filters the message
  // again on arrival, and that pass is the one that decides.
  const draftHasProfanity = containsProfanity(draft);

  const send = async () => {
    const body = draft.trim();
    // A message needs words OR pictures. Photographs alone are a real message
    // here — "which item was missing?" is answered fastest with one.
    if ((!body && photos.length === 0) || sending) return;

    setSending(true);
    const result = await sendSupportMessage({ ticketId, body, photoUrls: photos });
    setSending(false);

    if (!result.ok) {
      toast.show(translateError(t, result.errorCode, result.errorDetail), 'danger');
      return;
    }

    // Cleared only now, so a refused message is still in the box to retry.
    setDraft('');
    setPhotos([]);
  };

  const moveTo = async (status: SupportTicketStatus) => {
    setBusy(true);
    const result = await setSupportTicketStatus({ ticketId, status });
    setBusy(false);

    if (!result.ok) {
      toast.show(translateError(t, result.errorCode, result.errorDetail), 'danger');
      return;
    }
    toast.show(t('support.statusChanged'));
  };

  const escalate = async () => {
    const trimmed = reason.trim();
    if (!trimmed) return;

    setBusy(true);
    const result = await escalateSupportTicket({ ticketId, reason: trimmed });
    setBusy(false);

    if (!result.ok) {
      toast.show(translateError(t, result.errorCode, result.errorDetail), 'danger');
      return;
    }

    setReason('');
    setEscalating(false);
    toast.show(t('support.escalated'));
  };

  return (
    <Card className={cn('flex h-[calc(100vh-14rem)] min-h-96 flex-col overflow-hidden p-0', className)}>
      <header className="border-b-2 border-card-edge bg-subtle px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-ink-900">
              {ticket?.subject ?? t('support.ticket')}
            </h2>
            <p className="mt-0.5 truncate text-sm text-ink-500">
              {ticket ? t(`supportLane.${ticket.lane}`) : ''}
              {ticket?.orderCode ? ` · ${ticket.orderCode}` : ''}
              {platformSide && ticket?.restaurantName ? ` · ${ticket.restaurantName}` : ''}
            </p>
          </div>

          {ticket && (
            <StatusBadge tone={supportTone(ticket.status)}>
              {t(`supportStatus.${ticket.status}`)}
            </StatusBadge>
          )}
        </div>

        {/*
          The escalation banner sits above the thread rather than inside it, so
          an admin opening a handed-up ticket learns why before reading a word
          of it. The note itself is also in the thread, in its place in time.
        */}
        {ticket?.escalated && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-warning">
            <ShieldAlert size={14} className="mt-px shrink-0" aria-hidden />
            <span>
              {t('support.escalatedAt', { date: when(ticket.escalatedAt) })}
              {ticket.escalationReason ? ` — ${ticket.escalationReason}` : ''}
            </span>
          </p>
        )}

        {/*
          Translate the whole thread.

          Everybody gets this, not just the platform: the restaurant owner
          reading an operator's Azerbaijani and the operator reading the
          owner's Russian have exactly the same problem. It is off by default
          and it is a toggle rather than a setting, because the original is
          what the thread is and the translation is how somebody is reading it
          this minute.
        */}
        {foreignMessages.length > 0 && (
          <button
            type="button"
            onClick={() => void translateAll()}
            className={cn(
              'mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition',
              autoTranslate
                ? 'border-brand-300 bg-brand-50 text-brand-800'
                : 'border-card-edge bg-surface text-ink-600 hover:border-brand-300 hover:text-brand-700',
            )}
          >
            <Languages size={13} aria-hidden />
            {autoTranslate ? t('support.showOriginals') : t('support.translateThread')}
          </button>
        )}

        {/* The platform's controls. A party sees none of this. */}
        {ticket && (access.close || access.escalate) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {statusOptions.length > 0 && (
              <Select
                aria-label={t('support.changeStatus')}
                value=""
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value as SupportTicketStatus;
                  if (next) void moveTo(next);
                }}
                className="w-auto"
              >
                <option value="">{t('support.changeStatus')}</option>
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {t(`supportStatus.${option}`)}
                  </option>
                ))}
              </Select>
            )}

            {access.escalate && !ticket.escalated && (
              <Button size="sm" variant="secondary" onClick={() => setEscalating((open) => !open)}>
                {t('support.escalate')}
              </Button>
            )}
          </div>
        )}

        {escalating && (
          <div className="mt-2">
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={MAX_REASON}
              placeholder={t('support.escalateReasonPlaceholder')}
              aria-label={t('support.escalateReasonPlaceholder')}
              className="w-full resize-y rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                loading={busy}
                disabled={reason.trim().length === 0}
                onClick={() => void escalate()}
              >
                {t('support.escalateConfirm')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEscalating(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </header>

      {/*
        The thread has a ground of its own — darker than the page, darker than
        the card it sits in. That is what makes a white incoming bubble a bubble
        rather than a paragraph, and it is the half the previous pass missed:
        `bg-canvas` here meant the thread was exactly the colour of the page.
      */}
      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto bg-thread px-4 py-4">
        {messages === null ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="h-5 w-5 text-ink-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="font-medium text-ink-700">{t('support.emptyTitle')}</p>
            <p className="mt-1 text-sm text-ink-400">{t('support.emptyHint')}</p>
          </div>
        ) : (
          messages.map((message) => {
            const fromPlatform = isPlatformRole(message.senderRole);
            const mine = platformSide ? fromPlatform : !fromPlatform;

            // A system note — an escalation — belongs to neither side and is
            // drawn down the middle so it reads as a record, not as a reply.
            if (message.system) {
              return (
                <p
                  key={message.id}
                  className="mx-auto max-w-[90%] rounded-lg border border-card-edge bg-subtle px-3 py-2 text-center text-xs text-ink-600"
                >
                  {t('support.escalationNote')} · {message.body} · {when(message.createdAt)}
                </p>
              );
            }

            return (
              <ChatBubble
                key={message.id}
                mine={mine}
                body={message.body}
                photoUrls={message.photoUrls}
                sender={message.senderName || t('support.unknownSender')}
                at={when(message.createdAt)}
                filteredNote={message.filtered ? t('support.filteredNote') : null}
                // Only the other side's words, and only when there are words:
                // a photograph does not translate and an inert button teaches
                // a reader to distrust the ones beside it.
                translatable={!mine && isTranslatable(message)}
                translation={cachedTranslation(message, locale)}
                showingTranslation={showTranslated.has(message.id)}
                translating={translating.has(message.id)}
                onToggleTranslation={() => void toggleTranslation(message)}
              />
            );
          })
        )}
      </div>

      {closed ? (
        <div className="border-t-2 border-card-edge bg-surface px-4 py-3">
          <Alert tone="info">{t('support.closedNotice')}</Alert>
        </div>
      ) : (
        <div className="border-t-2 border-card-edge bg-surface px-4 py-3">
          {platformSide && access.reply && (
            <OperatorTemplatePicker
              className="mb-3"
              facts={facts}
              onPick={applyTemplate}
              disabled={sending}
            />
          )}

          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, because a support thread is a conversation and
                // the reply is almost always one line. Shift+Enter is the
                // escape hatch for the rare message that needs a paragraph.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              maxLength={MAX_BODY}
              disabled={!access.reply}
              placeholder={t('support.placeholder')}
              aria-label={t('support.placeholder')}
              className="max-h-40 min-h-11 flex-1 resize-y rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-[15px] text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-ink-50"
            />
            <Button
              onClick={() => void send()}
              loading={sending}
              disabled={(draft.trim().length === 0 && photos.length === 0) || !access.reply}
              aria-label={t('support.send')}
            >
              <Send size={16} />
              <span className="hidden sm:inline">{t('support.send')}</span>
            </Button>
          </div>
          {/* Under the box rather than beside it: a picture being attached is
              part of the message being written, and a row of thumbnails is
              wider than a button. Uploaded as they are picked, so pressing
              send is instant rather than a wait with no explanation. */}
          {access.reply && uid && (
            <div className="mt-2">
              <PhotoPicker
                folder={`support/${uid}`}
                urls={photos}
                onChange={setPhotos}
                disabled={sending}
                label={t('support.attachPhoto')}
              />
            </div>
          )}

          <p className="mt-1.5 text-xs text-ink-400">
            {ticket?.lane === SupportLane.RESTAURANT_TO_ADMIN
              ? t('support.adminLaneHint')
              : t('support.composerHint')}
          </p>

          {draftHasProfanity && (
            <p className="mt-1.5 text-xs text-warning">{t('support.profanityWarning')}</p>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * One message in a support thread.
 *
 * Pulled out of the thread it is rendered in so that the two sides of a
 * conversation are described in exactly one place. "A chat where both sides are
 * white bubbles on a white page is unusable" — the fix is three signals at
 * once, and three signals spread across an inline ternary are three signals a
 * future edit can quietly take one of:
 *
 *   - ALIGNMENT: which edge of the thread the bubble hangs from.
 *   - SHAPE: which corner is squared off, pointing at its own side.
 *   - COLOUR: brand red with white text going out, white with a real border
 *     coming in — on a thread ground (`--color-thread`) that is neither, so
 *     both bubbles have an edge even with every border and shadow stripped.
 */
export function ChatBubble({
  mine,
  body,
  photoUrls,
  sender,
  at,
  filteredNote,
  translation = null,
  translatable = false,
  showingTranslation = false,
  translating = false,
  onToggleTranslation,
}: {
  /** True for the side this viewer is on. Decides all three signals. */
  mine: boolean;
  body: string;
  /** Pictures attached to this message. A message may be pictures alone. */
  photoUrls?: string[];
  sender: string;
  at: string;
  /** Set when a word was removed by the profanity filter. */
  filteredNote?: string | null;
  /** The machine translation the server has cached, if anybody has asked. */
  translation?: MessageTranslation | null;
  /** False for a picture-only message, and for one nobody offered to translate. */
  translatable?: boolean;
  showingTranslation?: boolean;
  translating?: boolean;
  onToggleTranslation?: () => void;
}) {
  const t = useT();

  /*
   * WHAT THE BUBBLE SHOWS, AND WHAT IT NEVER STOPS SHOWING.
   *
   * The translated words replace the original *in the bubble* while the reader
   * has asked for them, and the original is one tap away underneath. It is
   * never destroyed and never the thing that got sent: the record of what
   * somebody actually typed is the message, and this is a reading aid on top
   * of it. That is also why the label below says "machine translation" every
   * single time rather than once — a reader scrolling a long thread must never
   * be able to lose track of which sentences a person wrote.
   */
  const showTranslated = showingTranslation && !!translation && !translation.same;
  const shown = showTranslated ? translation!.text : body;

  return (
    <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
      <div className="max-w-[85%] sm:max-w-[70%]">
        <div
          className={
            mine
              ? 'rounded-2xl rounded-br-sm border border-brand-700 bg-brand-600 px-3.5 py-2.5 text-[15px] text-white shadow-sm'
              : 'rounded-2xl rounded-bl-sm border border-bubble-in-edge bg-bubble-in px-3.5 py-2.5 text-[15px] text-ink-900 shadow-sm'
          }
        >
          {/* Newlines are meaningful in a support message — an address or a
              list of order codes is written on separate lines. A message that
              is only a photograph has no body at all, and an empty paragraph
              would add a blank line above the picture. */}
          {shown && <p className="whitespace-pre-wrap break-words">{shown}</p>}

          {/* Thumbnails that open the original in a new tab. This is evidence
              somebody has to look at closely — a receipt, a wrong dish — so a
              lightbox that shrinks it to fit a phone would be in the way. */}
          {(photoUrls?.length ?? 0) > 0 && (
            <div className={cn('flex flex-wrap gap-1.5', body && 'mt-2')}>
              {photoUrls!.map((url) => (
                <SecureImage
                  key={url}
                  src={url}
                  alt=""
                  loading="lazy"
                  className={cn(
                    'h-28 w-28 rounded-xl border object-cover',
                    mine ? 'border-brand-700' : 'border-bubble-in-edge',
                  )}
                />
              ))}
            </div>
          )}
        </div>

        {/* Moderation is stated rather than hidden: a reader who can see that a
            word was removed does not read `***` as the sender's own typing, and
            an operator can tell that this conversation has needed a hand. */}
        {filteredNote && (
          <p className={cn('mt-1 text-xs text-ink-400', mine && 'text-right')}>{filteredNote}</p>
        )}

        {/* The translate control. A text button and not an icon: "Tərcümə et"
            is unmistakable and an icon of two letters is not, and this sits
            under a message somebody may be upset about. */}
        {translatable && onToggleTranslation && (
          <div className={cn('mt-1 flex items-center gap-2 text-xs', mine && 'justify-end')}>
            <button
              type="button"
              onClick={onToggleTranslation}
              disabled={translating}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium',
                'text-ink-500 transition hover:bg-subtle hover:text-brand-700',
                'disabled:cursor-wait disabled:opacity-60',
              )}
            >
              <Languages size={13} aria-hidden />
              {translating
                ? t('support.translating')
                : showTranslated
                  ? t('support.showOriginal')
                  : t('support.translate')}
            </button>

            {/* Stated on every translated bubble, never once at the top: a
                reader scrolling a long thread has to be able to tell, at the
                message they are looking at, whether a person wrote it. */}
            {showTranslated && (
              <span className="text-ink-400">{t('support.machineTranslation')}</span>
            )}

            {/* The button did something, and what it did was nothing. Without
                this the control looks broken on exactly the messages it has
                least to do. */}
            {showingTranslation && translation?.same && (
              <span className="text-ink-400">{t('support.alreadyYourLanguage')}</span>
            )}
          </div>
        )}

        <p className={cn('mt-1 text-xs text-ink-400', mine && 'text-right')}>
          {sender} · {at}
        </p>
      </div>
    </div>
  );
}
