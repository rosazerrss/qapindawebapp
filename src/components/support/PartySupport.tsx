'use client';

/**
 * Support, seen by the party who has the problem.
 *
 * One component for the customer and for the restaurant, because from this
 * side the two screens are the same screen: your open tickets, your closed
 * ones, a way to raise a new one, and — when the admin has switched it on — a
 * number to ring instead. The only thing that differs is which lanes you may
 * open, and that answer comes from `canOpenLane` in `shared/supportState.ts`,
 * the same function the server checks.
 *
 * AN EMPTY BOX IS A BAD QUESTION
 * ------------------------------
 * Somebody whose food has not arrived should not have to compose a support
 * ticket from nothing, and an operator should not have to open a queue of
 * tickets all called "Problem" one by one to find out what any of them is
 * about. So the composer opens with a row of the things that actually go
 * wrong: picking one writes both the subject and the first message, and both
 * stay fully editable. The two lists differ because the two sides have
 * different problems — a customer's is about their dinner, a restaurant's is
 * about the platform, the courier and the money. See
 * `shared/supportTemplates.ts`.
 *
 * WHY CLOSED TICKETS ARE STILL LISTED
 * -----------------------------------
 * A closed ticket is retained forever and stays readable. "What did we agree
 * about the commission in March?" is a question with an answer, and hiding
 * finished tickets to keep the list tidy is how that answer gets lost. They
 * sit under their own heading, below the ones that are still live.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, MessageSquarePlus, Phone } from 'lucide-react';

import { Chat } from '@/components/panel/Chat';
import { TemplatePicker } from '@/components/support/TemplatePicker';
import { StatusBadge } from '@/components/panel/ui';
import { supportTone, when } from '@/components/panel/status';
import { Alert, Button, Card, Input, Select, Textarea, cn } from '@/components/ui';
import { useT, translateError } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { openSupportTicket } from '@/firebase/callables';
import { watchMyTickets, watchRestaurantTickets } from '@/services/support';
import { supportCallNumber, watchPublicSettings } from '@/services/settings';
import { canOpenLane } from '@/shared/supportState';
import { containsProfanity } from '@/shared/profanity';
import { CUSTOMER_TEMPLATES, RESTAURANT_TEMPLATES } from '@/shared/supportTemplates';
import { SupportLane, SupportTicketStatus } from '@/shared/enums';
import type { PublicSettings, SupportTicket } from '@/shared/models';

/** Mirrors the server's own caps, so the boxes stop before the callable does. */
const MAX_SUBJECT = 120;
const MAX_BODY = 2000;

const ALL_LANES = Object.values(SupportLane);

export function PartySupport({
  side,
  orderId,
  orderCode,
}: {
  /** Which side is looking. Decides which subscription and which lanes. */
  side: 'customer' | 'restaurant';
  /**
   * An order to attach to a new ticket.
   *
   * Set when the screen was reached from an order — "Problem var?" — so the
   * operator opens the ticket already knowing which order is being discussed
   * instead of asking. Also pre-opens the composer, because somebody who
   * arrived that way did not come to browse their ticket history.
   */
  orderId?: string | null;
  orderCode?: string | null;
}) {
  const t = useT();
  const { firebaseUser, role, restaurantId } = useAuth();

  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [composing, setComposing] = useState(Boolean(orderId));
  const [lane, setLane] = useState<SupportLane>(
    side === 'customer' ? SupportLane.CUSTOMER_TO_OPERATOR : SupportLane.RESTAURANT_TO_OPERATOR,
  );
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uid = firebaseUser?.uid ?? null;

  useEffect(() => {
    if (side !== 'customer' || !uid) return;
    return watchMyTickets(uid, setTickets);
  }, [side, uid]);

  useEffect(() => {
    if (side !== 'restaurant' || !restaurantId) return;
    return watchRestaurantTickets(restaurantId, setTickets);
  }, [side, restaurantId]);

  useEffect(() => watchPublicSettings(setSettings), []);

  // Derived during render rather than mirrored into state: which lanes this
  // role may open is a pure function of the role, and an effect that copied it
  // into state would be one render behind on every sign-in.
  const lanes = useMemo(
    () => ALL_LANES.filter((entry) => canOpenLane(role, entry)),
    [role],
  );

  // Which list of problems this side is offered, and which dictionary the
  // sentences come out of. Both are decided by the side rather than by the
  // lane: a restaurant writing to the admin has the same nine problems it has
  // when writing to an operator, it is only choosing a different reader.
  const templates = side === 'customer' ? CUSTOMER_TEMPLATES : RESTAURANT_TEMPLATES;
  const namespace = side === 'customer' ? 'Customer' : 'Restaurant';

  const applyTemplate = (key: string) => {
    // Both halves are filled, because the subject is what an operator reads in
    // the queue before opening anything — and a ticket whose subject says what
    // it is about is one an operator can pick up in the right order.
    setSubject(t(`supportSubject${namespace}.${key}`));
    setBody(t(`supportTemplate${namespace}.${key}`));
  };

  // A courtesy warning, derived during render. The callable filters the text
  // again when it arrives, and that is the pass that counts.
  const draftHasProfanity = containsProfanity(`${subject} ${body}`);

  const live = (tickets ?? []).filter(
    (ticket) => ticket.status !== SupportTicketStatus.CLOSED,
  );
  const finished = (tickets ?? []).filter(
    (ticket) => ticket.status === SupportTicketStatus.CLOSED,
  );

  const phone = supportCallNumber(settings);

  const submit = async () => {
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (trimmedSubject.length < 3 || !trimmedBody) return;

    setBusy(true);
    setError(null);

    const result = await openSupportTicket({
      lane,
      subject: trimmedSubject,
      body: trimmedBody,
      orderId: orderId ?? null,
    });

    setBusy(false);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    setSubject('');
    setBody('');
    setComposing(false);
    if (result.data?.ticketId) setSelectedId(result.data.ticketId);
  };

  // A thread fills the screen on its own; the list is what you come back to.
  if (selectedId) {
    return (
      <div>
        <button
          onClick={() => setSelectedId(null)}
          className="mb-3 inline-flex items-center gap-1 text-sm text-ink-500 transition hover:text-ink-800"
        >
          <ChevronLeft size={16} />
          {t('support.backToTickets')}
        </button>

        <Chat key={selectedId} ticketId={selectedId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/*
        The phone option, when there is one. It is above the ticket list rather
        than buried under it because somebody who wants to ring is not going to
        scroll past their own history to find the number.
      */}
      {phone && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-brand-100 bg-brand-50 p-4">
          <div className="min-w-0">
            <p className="font-medium text-ink-900">{t('support.callTitle')}</p>
            <p className="mt-0.5 text-sm text-ink-500">{t('support.callHint')}</p>
          </div>
          {/*
            An anchor, not a button that assigns `window.location`.
            
            A `tel:` link is handled by the operating system and never navigates
            the page, so the assignment was harmless — but it is indistinguishable
            from a real navigation to anything reading this code, including the
            test that now forbids them. An anchor also gives a long-press "copy
            number", which a button cannot.
          */}
          <a
            href={`tel:${phone}`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-4 text-[15px] font-medium text-ink-900 transition hover:bg-ink-50"
          >
            <Phone size={15} aria-hidden />
            {t('support.call')}
          </a>
        </Card>
      )}

      {composing ? (
        <Card className="p-4">
          <h2 className="font-semibold text-ink-900">{t('support.newTicket')}</h2>

          {orderCode && (
            <p className="mt-1 text-sm text-ink-500">
              {t('support.aboutOrder', { code: orderCode })}
            </p>
          )}

          <TemplatePicker
            className="mt-3"
            label={t('support.problemsLabel')}
            hint={t('support.problemsHint')}
            options={templates.map((template) => ({
              key: template.key,
              label: t(`supportSubject${namespace}.${template.key}`),
            }))}
            onPick={applyTemplate}
            disabled={busy}
          />

          {lanes.length > 1 && (
            <div className="mt-3">
              <Select
                label={t('support.laneLabel')}
                value={lane}
                onChange={(event) => setLane(event.target.value as SupportLane)}
                hint={t(`supportLaneHint.${lane}`)}
              >
                {lanes.map((entry) => (
                  <option key={entry} value={entry}>
                    {t(`supportLane.${entry}`)}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="mt-3">
            <Input
              label={t('support.subjectLabel')}
              value={subject}
              maxLength={MAX_SUBJECT}
              placeholder={t('support.subjectPlaceholder')}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>

          <div className="mt-3">
            <Textarea
              label={t('support.bodyLabel')}
              value={body}
              rows={5}
              maxLength={MAX_BODY}
              placeholder={t('support.bodyPlaceholder')}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>

          {draftHasProfanity && (
            <p className="mt-2 text-xs text-warning">{t('support.profanityWarning')}</p>
          )}

          {error && (
            <div className="mt-3">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <Button
              loading={busy}
              disabled={subject.trim().length < 3 || body.trim().length === 0}
              onClick={() => void submit()}
            >
              {t('support.submitTicket')}
            </Button>
            <Button variant="ghost" onClick={() => setComposing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Card>
      ) : (
        lanes.length > 0 && (
          <Button fullWidth variant="secondary" onClick={() => setComposing(true)}>
            <MessageSquarePlus size={16} />
            {t('support.newTicket')}
          </Button>
        )
      )}

      <TicketGroup
        title={t('support.liveTickets')}
        tickets={live}
        loading={tickets === null}
        emptyHint={t('support.noLiveTickets')}
        onSelect={setSelectedId}
      />

      {finished.length > 0 && (
        <TicketGroup
          title={t('support.closedTickets')}
          tickets={finished}
          loading={false}
          emptyHint=""
          onSelect={setSelectedId}
        />
      )}
    </div>
  );
}

/** One heading and the rows under it. Extracted only to avoid writing it twice. */
function TicketGroup({
  title,
  tickets,
  loading,
  emptyHint,
  onSelect,
}: {
  title: string;
  tickets: SupportTicket[];
  loading: boolean;
  emptyHint: string;
  onSelect: (ticketId: string) => void;
}) {
  const t = useT();

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">{title}</h2>

      <Card className="p-0">
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-ink-400">{t('common.loading')}</p>
        ) : tickets.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-400">{emptyHint}</p>
        ) : (
          <ul className="divide-y divide-row-edge">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <button
                  onClick={() => onSelect(ticket.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-ink-50/70"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink-900">
                      {ticket.subject}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-ink-500">
                      {ticket.lastMessage || t('support.noMessagesYet')}
                    </span>
                    <span className="mt-1 block text-xs text-ink-400">
                      {t(`supportLane.${ticket.lane}`)}
                      {ticket.orderCode ? ` · ${ticket.orderCode}` : ''} ·{' '}
                      {when(ticket.lastMessageAt)}
                    </span>
                  </span>

                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusBadge tone={supportTone(ticket.status)}>
                      {t(`supportStatus.${ticket.status}`)}
                    </StatusBadge>
                    {ticket.unreadForAsker > 0 && (
                      <span
                        className={cn(
                          'min-w-5 rounded-full bg-brand-600 px-1.5 py-0.5 text-center',
                          'text-[11px] font-medium tabular-nums text-white',
                        )}
                        aria-label={t('support.unreadCount', { count: ticket.unreadForAsker })}
                      >
                        {ticket.unreadForAsker}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
