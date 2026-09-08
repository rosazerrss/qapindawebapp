'use client';

/**
 * "Hesabım".
 *
 * A guest sees Register and Sign in; a signed-in person sees their details and
 * Sign out. Everything below the profile card is a link to a page of its own —
 * addresses and favourites are things people edit, not things to cram into a
 * sheet on a settings list.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  ChevronRight,
  Heart,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MapPin,
  ReceiptText,
  TicketPercent,
  Shield,
  SlidersHorizontal,
  Store,
  Pencil,
  Trash2,
  UserRound,
} from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { RestaurantInvites } from '@/components/customer/RestaurantInvites';
import { EmailVerifySheet } from '@/components/customer/EmailVerifySheet';
import { LanguageMenu } from '@/components/customer/LanguageMenu';
import { Alert, Button, Card, Input, Sheet } from '@/components/ui';
import { AccountSkeleton } from '@/components/ui/loading';
import { useAuth } from '@/contexts/AuthContext';
import { useFavourites } from '@/contexts/FavouritesContext';
import { useLocale, translateError } from '@/i18n';
import { requestAccountDeletion, updateProfile } from '@/firebase/callables';
import { formatPhone } from '@/shared/phone';
import { accountHome } from '@/shared/permissions';

export default function AccountPage() {
  const { t } = useLocale();
  const router = useRouter();
  const {
    firebaseUser,
    profile,
    loading,
    identityLoading,
    needsRegistration,
    profileUnavailable,
    identityStalled,
    retryProfile,
    signOut,
  } = useAuth();
  const { items } = useFavourites();

  const [verifyingEmail, setVerifyingEmail] = useState(false);
  /*
   * The name editor.
   *
   * `editingName` holds the draft, and null means the sheet is closed — one
   * piece of state rather than an `open` flag beside a value, so the two cannot
   * disagree about whether there is anything to save.
   */
  const [editingName, setEditingName] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * The skeleton stays up until we know WHO is signed in, not merely THAT
   * somebody is.
   *
   * `loading` answers the second question and goes false a round trip early. In
   * that gap `profile` is still null, and the branch below reads a null profile
   * as "registration unfinished" — so a signed-in customer walking back to this
   * page watched a "finish signing up" card for a second or two before their
   * own account appeared. That is the flash that was reported, and this line is
   * the fix for it.
   */
  if (loading || identityLoading) {
    return (
      <AppShell>
        <AccountSkeleton />
      </AppShell>
    );
  }

  // ---- Guest ------------------------------------------------------------
  if (!firebaseUser) {
    return (
      <AppShell>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-ink-900">
          {t('account.title')}
        </h1>

        <Card className="p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ink-50 text-ink-300">
            <UserRound size={28} aria-hidden />
          </span>
          <p className="mt-4 text-lg font-medium text-ink-900">{t('auth.guestGreeting')}</p>
          <p className="mt-1.5 text-sm text-ink-500">{t('auth.guestHint')}</p>

          <div className="mx-auto mt-6 max-w-xs space-y-2">
            <Link href="/login" className="block">
              <Button fullWidth size="lg">
                {t('auth.signIn')}
              </Button>
            </Link>
            <Link href="/login" className="block">
              <Button fullWidth variant="secondary">
                {t('auth.signUp')}
              </Button>
            </Link>
          </div>
        </Card>

        <Section title={t('account.sectionPreferences')}>
          <Card className="flex items-center justify-between p-5">
            <span className="text-sm font-medium text-ink-700">{t('account.language')}</span>
            <LanguageMenu />
          </Card>
        </Section>

        <Section title={t('account.sectionLegal')}>
          <Card className="divide-y divide-row-edge">
            <Row href="/account/support" icon={LifeBuoy} label={t('account.help')} />
            <Row href="/legal/terms" icon={Shield} label={t('legal.terms')} />
            <Row href="/legal/privacy" icon={Shield} label={t('legal.privacy')} />
          </Card>
        </Section>
      </AppShell>
    );
  }

  /*
   * ---- Signed in, and we could not read the account --------------------
   *
   * Kept strictly apart from the branch below it. Both used to be one `!profile`
   * test, which meant a refused or dropped read showed a registered person the
   * "finish signing up" card — the alarming version of a network error. This
   * says what actually happened and offers the only useful button.
   */
  /*
   * The identity never arrived, and we stopped waiting.
   *
   * `identityLoading` now has a six-second deadline so no screen can spin
   * forever — but the branch below reads a missing profile as "not registered",
   * and reaching THAT because a phone was in a lift would be the same alarming
   * lie the retry work was done to remove. So this stands in front of it and
   * says the true thing: we could not reach the server.
   */
  if (identityStalled) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-6">
          <Card className="p-8 text-center">
            <p className="text-lg font-medium text-ink-900">{t('account.loadFailed')}</p>
            <p className="mt-1.5 text-sm text-ink-500">{t('account.loadFailedHint')}</p>
            <Button className="mt-6" fullWidth size="lg" onClick={retryProfile}>
              {t('common.retry')}
            </Button>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (profileUnavailable) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-6">
          <Card className="p-8 text-center">
            <p className="text-lg font-medium text-ink-900">{t('account.loadFailed')}</p>
            <p className="mt-1.5 text-sm text-ink-500">{t('account.loadFailedHint')}</p>
            <Button className="mt-6" fullWidth size="lg" onClick={retryProfile}>
              {t('common.retry')}
            </Button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-4 rounded-lg px-2 py-1 text-sm text-ink-500 underline transition hover:text-ink-800"
            >
              {t('auth.signOut')}
            </button>
          </Card>
        </div>
      </AppShell>
    );
  }

  // ---- Signed in but registration unfinished ---------------------------
  if (needsRegistration || !profile) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-6">
          <Card className="p-8 text-center">
            <p className="text-lg font-medium text-ink-900">{t('auth.signUp')}</p>
            <p className="mt-1.5 text-sm text-ink-500">{t('auth.oneAccountNotice')}</p>
            <Link href="/login" className="mt-6 block">
              <Button fullWidth size="lg">
                {t('auth.finish')}
              </Button>
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-4 rounded-lg px-2 py-1 text-sm text-ink-500 underline transition hover:text-ink-800"
            >
              {t('auth.signOut')}
            </button>
          </Card>
        </div>
      </AppShell>
    );
  }

  /**
   * Saves the name.
   *
   * The server is the one that trims, bounds and filters it, so what comes back
   * is what was actually stored — and it is written into the local state rather
   * than the draft, because a name the filter masked must show as masked rather
   * than as what the person typed.
   */
  const saveName = async () => {
    const value = (editingName ?? '').trim();
    if (value.length < 2) return;

    setSavingName(true);
    setNameError(null);
    const result = await updateProfile(value);
    setSavingName(false);

    if (!result.ok) {
      setNameError(translateError(t, result.errorCode));
      return;
    }

    setEditingName(null);
    // Nothing else to do: the profile is a live Firestore listener, so the new
    // name arrives on its own rather than being copied into a second copy here.
  };

  const requestDeletion = async () => {
    setBusy(true);
    const result = await requestAccountDeletion(confirmText.trim());
    setBusy(false);

    if (!result.ok) {
      /*
       * The one refusal worth its own sentence.
       *
       * "Ziddiyyət var" tells somebody who just pressed delete nothing at all.
       * An order in flight is a real, temporary and understandable reason, and
       * saying so turns a dead end into a wait of an hour.
       */
      setMessage(
        result.errorDetail === 'active-order'
          ? t('account.deleteBlockedByOrder')
          : translateError(t, result.errorCode, result.errorDetail),
      );
      return;
    }

    // The account is gone by the time this returns — not queued, not pending.
    // Signing out is therefore cleanup rather than a step: the credential it
    // held has already been deleted server-side.
    setDeleting(false);
    await signOut();
    router.replace('/');
  };

  /*
   * Where this account's own panel is, or null for an ordinary customer.
   *
   * `accountHome` is the single answer to "where does this role live" and is
   * already used to send work accounts away from the cart. Reusing it means the
   * link and the redirect can never disagree about the address.
   */
  const home = accountHome(profile.role);
  const panelHref = home === '/' ? null : home;

  const initials = profile.fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <AppShell>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-ink-900">
        {t('account.title')}
      </h1>

      {/* Above everything, because it is a question waiting for an answer and
          the rest of this screen is settings. Draws nothing at all when there
          is no offer outstanding, which is almost always. */}
      <div className="mb-4 empty:mb-0">
        <RestaurantInvites uid={profile.uid} />
      </div>

      <Card className="flex items-center gap-4 p-5">
        <span
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-700"
        >
          {initials || <UserRound size={24} />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-lg font-medium text-ink-900">{profile.fullName}</p>
            <button
              type="button"
              onClick={() => {
                setNameError(null);
                setEditingName(profile.fullName);
              }}
              aria-label={t('account.editName')}
              className="shrink-0 rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            >
              <Pencil size={15} aria-hidden />
            </button>
          </div>
          <p className="text-sm text-ink-500">{formatPhone(profile.phone)}</p>

          {profile.email ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-400">
              <span className="truncate">{profile.email}</span>
              {profile.emailVerified ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <BadgeCheck size={15} aria-hidden />
                  {t('account.emailVerified')}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setVerifyingEmail(true)}
                  className="rounded px-1 text-brand-600 underline transition hover:text-brand-700"
                >
                  {t('account.verifyEmail')}
                </button>
              )}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setVerifyingEmail(true)}
              className="mt-1 rounded px-1 text-sm text-brand-600 underline transition hover:text-brand-700"
            >
              {t('account.addEmail')}
            </button>
          )}
        </div>
      </Card>

      {profile.accountStatus === 'REVIEW_REQUIRED' && (
        <div className="mt-4">
          <Alert tone="warning">{t('errors.ACCOUNT_UNDER_REVIEW')}</Alert>
        </div>
      )}

      <Section title={t('account.sectionActivity')}>
        <Card className="divide-y divide-row-edge">
          <Row href="/orders" icon={ReceiptText} label={t('account.orders')} />
          <Row
            href="/account/favourites"
            icon={Heart}
            label={t('favourites.title')}
            badge={items.length > 0 ? String(items.length) : undefined}
          />
          <Row href="/account/addresses" icon={MapPin} label={t('account.addresses')} />
          <Row href="/account/coupons" icon={TicketPercent} label={t('account.coupons')} />
        </Card>
      </Section>

      {/*
        THE WAY BACK TO YOUR OWN PANEL — shown only to accounts that have one.
        
        This used to say "no panel links here, by design", and the reasoning was
        sound as far as it went: a link on a screen every customer opens turns a
        private door into a public sign. What it missed is that the door is only
        public if the link is drawn for everybody.
        
        A restaurant owner is also a person with an address book and an order
        history, so they do land on this screen — and from here their own panel
        was reachable only by remembering the URL. That is not security, it is
        an inconvenience aimed at the one person on the platform who is paying
        us commission.
        
        So it is drawn from `accountHome`, which already answers "where does
        this role live", and only when that answer is not the customer's home
        page. A customer's role sends them to `/`, so the block does not render
        at all for them and nothing about the panel's address appears anywhere
        they can see.
      */}
      {panelHref && (
        <Section title={t('account.sectionPanel')}>
          <Card className="divide-y divide-row-edge">
            <Row href={panelHref} icon={LayoutDashboard} label={t('account.goToPanel')} />
          </Card>
        </Section>
      )}

      {/* A door, not a panel.
          The notification switches used to be rendered inline here, and the
          owner asked twice for them to leave every main screen: a control on
          the page somebody opens to check an order is a control that gets
          flipped by accident. Hesabım now shows the way to Ayarlar, and the
          switches live there.

          There is no shortcut straight to Bildirişlər here either, and that is
          the same instruction taken to its end: the last notification control
          on a main screen is gone, and the only notification thing a customer
          meets outside Ayarlar is the bell in the header. Ayarlar lists
          Bildirişlər, Tez-tez verilən suallar and Geri bildirim together, which
          is one door to find instead of four half-doors to trip over. */}
      <Section title={t('account.sectionPreferences')}>
        <Card className="divide-y divide-row-edge">
          <Row href="/account/settings" icon={SlidersHorizontal} label={t('nav.settings')} />
        </Card>
        <Card className="mt-3 flex items-center justify-between p-5">
          <span className="text-sm font-medium text-ink-700">{t('account.language')}</span>
          <LanguageMenu />
        </Card>
      </Section>


      <Section title={t('account.sectionLegal')}>
        <Card className="divide-y divide-row-edge">
          <Row href="/legal/terms" icon={Shield} label={t('legal.terms')} />
          <Row href="/legal/privacy" icon={Shield} label={t('legal.privacy')} />
        </Card>
      </Section>

      {message && (
        <div className="mt-4">
          <Alert tone="danger">{message}</Alert>
        </div>
      )}

      <div className="mt-8 space-y-2 border-t border-card-edge pt-6">
        {/*
          Red, and outlined rather than filled.

          It was the plain white `secondary` button, which on a white card is
          barely a button at all — the one control on this screen a person
          actively looks for, and the hardest one to see. Red says "this ends
          the session" at a glance.

          Outlined rather than solid on purpose: a solid red block would outrank
          "delete my account" sitting right below it, and signing out is the
          reversible one of the two. Colour carries the meaning; weight carries
          the consequence.
        */}
        <Button
          variant="secondary"
          fullWidth
          onClick={() => void signOut()}
          className="border-red-200 bg-red-50 text-danger hover:bg-red-100"
        >
          <LogOut size={17} aria-hidden /> {t('auth.signOut')}
        </Button>
        <button
          type="button"
          onClick={() => setDeleting(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm text-ink-400 transition hover:bg-red-50 hover:text-danger"
        >
          <Trash2 size={15} aria-hidden /> {t('account.deleteAccount')}
        </button>
      </div>

      <EmailVerifySheet
        open={verifyingEmail}
        onClose={() => setVerifyingEmail(false)}
        currentEmail={profile.email}
      />

      {/*
        Editing the name.

        The number below it is deliberately not editable here. A telephone
        number is not a preference — it is what signs this person in and what
        the one-account rule is built on — so it is changed by support, with a
        person deciding, and the sheet says so rather than leaving somebody
        hunting for a button that is not there.
      */}
      <Sheet
        open={editingName !== null}
        onClose={() => setEditingName(null)}
        title={t('account.editName')}
        footer={
          <Button
            fullWidth
            loading={savingName}
            disabled={(editingName ?? '').trim().length < 2}
            onClick={saveName}
          >
            {t('common.save')}
          </Button>
        }
      >
        <div className="space-y-4">
          <Input
            label={t('auth.fullName')}
            value={editingName ?? ''}
            maxLength={80}
            autoComplete="name"
            onChange={(event) => {
              setNameError(null);
              setEditingName(event.target.value);
            }}
          />
          <p className="text-sm text-ink-500">{t('account.editNameHint')}</p>
          {nameError && <Alert tone="danger">{nameError}</Alert>}
        </div>
      </Sheet>

      <Sheet
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t('account.deleteAccount')}
        footer={
          <Button
            variant="danger"
            fullWidth
            loading={busy}
            // Not translated on purpose: the server compares this exact phrase,
            // so a localised one would never be accepted.
            disabled={confirmText.trim() !== 'HESABIMI SIL'}
            onClick={requestDeletion}
          >
            {t('account.deleteAccount')}
          </Button>
        }
      >
        <Alert tone="warning">{t('account.deleteWarning')}</Alert>
        <div className="mt-4">
          <Input
            label={t('account.deleteConfirmLabel')}
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
          />
        </div>
      </Sheet>
    </AppShell>
  );
}

/** A titled group of cards — the settings list needs landmarks, not one long run. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  href,
  icon: Icon,
  label,
  badge,
}: {
  href: string;
  icon: typeof Store;
  label: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-4 transition first:rounded-t-2xl last:rounded-b-2xl hover:bg-ink-50"
    >
      <Icon size={18} className="text-ink-400" aria-hidden />
      <span className="flex-1 text-[15px] text-ink-800">{label}</span>
      {badge && (
        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">
          {badge}
        </span>
      )}
      <ChevronRight size={16} className="text-ink-300" aria-hidden />
    </Link>
  );
}
