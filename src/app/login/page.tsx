'use client';

/**
 * Sign in and sign up — one screen, because with phone authentication they are
 * the same act. You prove the number; whether an account already exists is the
 * server's problem, not a choice the person has to make up front.
 *
 * Google is offered as a second door. It still ends at a phone number: the
 * "one phone, one account" rule is what keeps coupon limits meaningful, so a
 * Google account without a verified number cannot finish registering.
 *
 * Every step has a way back. `next` is how a guest returns to checkout with
 * their cart intact.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  GoogleAuthProvider,
  OAuthProvider,
  RecaptchaVerifier,
  getRedirectResult,
  linkWithPhoneNumber,
  signInWithPhoneNumber,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type AuthProvider as FirebaseAuthProvider,
  type ConfirmationResult,
  type UserCredential,
} from 'firebase/auth';

import { AppShell } from '@/components/layout/AppShell';
import { Alert, Button, Card, Input } from '@/components/ui';
import { PageLoading } from '@/components/ui/loading';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { OtpInput } from '@/components/ui/OtpInput';
import { LogoMark } from '@/components/layout/Logo';
import { useAuth } from '@/contexts/AuthContext';
import { useT, translateError, type Translate } from '@/i18n';
import { firebaseAuth, isFirebaseConfigured } from '@/firebase/client';
import { recordConsent, registerAccount } from '@/firebase/callables';
import { ConsentType } from '@/shared/enums';
import { AppErrorCode } from '@/shared/errors';
import {
  AUTH_SITUATION,
  isPopupDismissal,
  shouldRetryWithRedirect,
  usableEmail,
} from '@/shared/identity';

type Step = 'phone' | 'code' | 'profile';

/** How long before another SMS may be asked for. */
const RESEND_SECONDS = 59;

/**
 * `+994 50 123 45 25` → `(*******5425)`.
 *
 * The last four digits are what a person checks against the number in their
 * head; the rest is a full mobile number sitting on a screen in a café. Built
 * from the digits rather than the formatted string so that spaces and the
 * country code cannot end up counted as characters to mask.
 */
function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return raw;
  const tail = digits.slice(-4);
  return `${'*'.repeat(Math.max(digits.length - 4, 3))}${tail}`;
}

/**
 * The provider objects, built fresh each time.
 *
 * A provider instance carries the scopes and custom parameters it was
 * configured with, and reusing one across a popup attempt and the redirect
 * that follows it has been known to carry stale state. They cost nothing to
 * build, so they are built where they are used.
 */
function providerFor(kind: 'google' | 'apple'): FirebaseAuthProvider {
  if (kind === 'google') {
    const google = new GoogleAuthProvider();
    // Without this, a person signed into two Google accounts is silently given
    // whichever one the browser saw last — and finds out only when the order
    // history is somebody else's.
    google.setCustomParameters({ prompt: 'select_account' });
    return google;
  }

  const apple = new OAuthProvider('apple.com');
  apple.addScope('email');
  apple.addScope('name');
  return apple;
}

/**
 * WHERE APPLE'S NAME GOES, AND WHY IT HAS TO GO SOMEWHERE.
 *
 * Apple sends the person's name on the *very first authorisation of this app
 * by this Apple ID, ever*. Not the first this month, not the first since the
 * app was reinstalled — the first, once, and never again. Every later sign-in
 * returns `displayName: null`, permanently, for the life of that Apple ID.
 *
 * Which means the ordinary abandoned sign-up destroys it: the person authorises
 * Apple, lands on the "what is your name" step, gets distracted, closes the
 * tab. They come back tomorrow, sign in with Apple again, and Apple sends
 * nothing — so they type their name by hand and nobody ever knows what was
 * lost. On the redirect path it is worse, because the page reloads *by design*
 * between Apple answering and this screen rendering.
 *
 * So the moment a name arrives it is written to `sessionStorage`, and the
 * registration step reads from there when the live credential has nothing.
 * Session storage and not local: it belongs to this attempt at signing up, on
 * this tab, and a name left lying around for the next person to use this
 * browser is a different kind of mistake.
 */
const NAME_STASH = 'qapinda:providerName';

function stashProviderName(name: string | null | undefined): void {
  if (!name) return;
  try {
    window.sessionStorage.setItem(NAME_STASH, name);
  } catch {
    // Private mode, or storage disabled. The field is simply typed by hand.
  }
}

function readStashedName(): string {
  try {
    return window.sessionStorage.getItem(NAME_STASH) ?? '';
  } catch {
    return '';
  }
}

function clearStashedName(): void {
  try {
    window.sessionStorage.removeItem(NAME_STASH);
  } catch {
    // Nothing to clear.
  }
}

function SignInInner() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/account';
  const { firebaseUser, profile, loading, identityLoading, needsRegistration, profileUnavailable, retryProfile, refreshClaims } =
    useAuth();

  // Only the phone→code move is a choice this screen makes; reaching the
  // profile step is a *fact* about the account, so it is derived below.
  const [phase, setPhase] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  /** True when registration was refused in a way the person cannot argue with. */
  const [stranded, setStranded] = useState(false);

  const confirmation = useRef<ConfirmationResult | null>(null);
  const verifier = useRef<RecaptchaVerifier | null>(null);

  /**
   * Tears the widget down properly.
   *
   * Dropping the reference is not enough: reCAPTCHA leaves its iframe behind,
   * and a second verifier over the same container fails with "already
   * rendered". `clear()` empties it so the next attempt starts clean.
   */
  const resetVerifier = () => {
    try {
      verifier.current?.clear();
    } catch {
      // Already torn down.
    }
    verifier.current = null;
  };

  useEffect(() => resetVerifier, []);

  /**
   * Take what the provider gave us, and only what is worth keeping.
   *
   * The email is run through `usableEmail`, which returns null for Apple's
   * "Hide My Email" forwarding addresses. Prefilling the form with
   * `a1b2c3d4@privaterelay.appleid.com` would show the person a string they
   * have never seen, invite them to accept it, and hand their account an email
   * they cannot receive anything at from anywhere but Qapında — while locking
   * the slot their real address needed. `shared/identity.ts` argues it fully.
   */
  const absorbCredential = (credential: UserCredential) => {
    const real = usableEmail(credential.user.email);
    if (real) setEmail(real);

    const name = credential.user.displayName;
    if (name) {
      setFullName(name);
      stashProviderName(name);
    }
  };

  /*
   * Coming back from a redirect.
   *
   * On the redirect path the browser has left this page and returned to it, so
   * the popup's return value never existed here — `getRedirectResult` is the
   * only place the credential can be read, and it can be read exactly once.
   * Miss it and Apple's name is gone for good.
   *
   * It answers null on an ordinary page load, which is the common case and
   * costs nothing.
   */
  useEffect(() => {
    const auth = firebaseAuth();
    if (!auth) return;

    let live = true;

    void getRedirectResult(auth)
      .then((credential) => {
        if (!live) return;

        if (credential) {
          absorbCredential(credential);
          return;
        }

        /*
         * No redirect to absorb — an ordinary page load. Restore the name Apple
         * sent, if this tab is part-way through a sign-up.
         *
         * This is the reload case: somebody authorised Apple, reached the "what
         * is your name" step, and refreshed the page. Apple sends a name on the
         * very first authorisation of this app by this Apple ID and never
         * again, so without the stash that name is gone permanently — not until
         * next time, permanently. Only ever fills an empty box.
         */
        const stashed = readStashedName();
        if (stashed) setFullName((current) => (current.trim() ? current : stashed));
      })
      .catch((caught: unknown) => {
        if (!live) return;
        const code = (caught as { code?: string }).code ?? '';
        if (code === AUTH_SITUATION.DIFFERENT_CREDENTIAL) {
          setError(t('auth.useYourPhoneInstead'));
          return;
        }
        if (isPopupDismissal(code)) return;
        setError(t('auth.providerFailed'));
      });

    return () => {
      live = false;
    };
    // Runs once on mount: a redirect result is delivered exactly once, and
    // re-running this on a re-render would read null and overwrite nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && firebaseUser && profile) router.replace(next);
  }, [loading, firebaseUser, profile, next, router]);

  /*
   * The resend clock.
   *
   * One interval that exists only while there is something to count. Ticking
   * off the stored value rather than off a target timestamp is fine here
   * because the whole window is under a minute and the screen is in the
   * foreground for all of it — and if a phone does suspend the tab, coming
   * back to a countdown that resumes is better than coming back to one that
   * has jumped to zero while the SMS is still in flight.
   */
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((left) => Math.max(left - 1, 0)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  const step: Step = needsRegistration ? 'profile' : phase;

  /**
   * Google or Apple — both end at the same place.
   *
   * Neither is a separate door: whichever one is used, the account still needs
   * a verified phone number, because the phone is Qapında's identity and the
   * one-account rule is enforced on it. So the flow rejoins at 'phone'.
   *
   * Apple in particular may hand back no email and no name at all — the person
   * can choose "Hide My Email", and Apple only ever sends the name on the very
   * first authorisation. So nothing here treats those fields as guaranteed; the
   * registration step asks for what is missing.
   */
  const withProvider = async (kind: 'google' | 'apple') => {
    const auth = firebaseAuth();
    if (!auth) {
      setError(t('errors.NOT_CONFIGURED'));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const provider = providerFor(kind);

      /*
       * A popup first, a redirect when the popup is refused.
       *
       * On a desktop the popup is the better experience — the page keeps its
       * state and the cart is still where it was. On a phone it is frequently
       * not available at all: iOS in-app browsers (Instagram, Facebook,
       * Telegram) block popups outright, and some block them without
       * admitting it. Without this fallback the Google button on a phone does
       * *nothing at all*, silently, which is the worst failure a sign-in
       * screen has — and a phone is where the food orders come from.
       *
       * The redirect leaves the page, so what Apple said has to survive the
       * journey. That is what `stashProviderName` is for; see below.
       */
      const credential = await signInWithPopup(auth, provider);
      absorbCredential(credential);
    } catch (caught) {
      const code = (caught as { code?: string }).code ?? '';

      // Closing the window is not an error worth a red banner.
      if (isPopupDismissal(code)) return;

      if (shouldRetryWithRedirect(code)) {
        try {
          await signInWithRedirect(auth, providerFor(kind));
          // The page is leaving. `busy` deliberately stays true so nothing can
          // be pressed in the moment before it does.
          return;
        } catch {
          setError(t('auth.popupBlocked'));
          setBusy(false);
          return;
        }
      }

      /*
       * THE ONE THAT MATTERS: THIS PERSON ALREADY HAS AN ACCOUNT.
       *
       * Firebase raises this when the email behind the Google or Apple account
       * already signs in another way — almost always because they registered
       * with their telephone months ago and have now pressed the Google button,
       * which is the obvious thing to do.
       *
       * Nothing is wrong and nothing should be created. The rule is one
       * customer, one account, so the answer is to send them to the door that
       * already works rather than to open a second one. The screen says so in
       * a sentence and drops them on the phone step.
       */
      if (code === AUTH_SITUATION.DIFFERENT_CREDENTIAL) {
        setError(t('auth.useYourPhoneInstead'));
        setPhase('phone');
        setBusy(false);
        return;
      }

      setError(
        code === AUTH_SITUATION.NOT_ENABLED
          ? t('auth.providerDisabled')
          : t('auth.providerFailed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    const auth = firebaseAuth();
    if (!auth) {
      setError(t('errors.NOT_CONFIGURED'));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      resetVerifier();
      verifier.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
      });

      // Signed in with Google but no number yet: link rather than replace, so
      // one person keeps one account instead of collecting two.
      confirmation.current =
        auth.currentUser && !auth.currentUser.phoneNumber
          ? await linkWithPhoneNumber(auth.currentUser, phone, verifier.current)
          : await signInWithPhoneNumber(auth, phone, verifier.current);

      setPhase('code');
      // Started when the SMS actually left, not when the button was pressed —
      // a failed send must not lock the person out of trying again.
      setResendIn(RESEND_SECONDS);
    } catch (caught) {
      setError(authErrorText(t, caught));
      resetVerifier();
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (!confirmation.current) return;

    setBusy(true);
    setError(null);

    try {
      await confirmation.current.confirm(code.trim());
      // The auth listener decides what happens next: registered → redirect,
      // new → the profile step.
    } catch {
      setError(t('errors.VALIDATION_FAILED'));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);

    const result = await registerAccount({
      fullName: fullName.trim(),
      email: email.trim() || null,
    });

    if (!result.ok) {
      setBusy(false);
      setError(translateError(t, result.errorCode, result.errorDetail));
      /*
       * THE DEAD END, AND THE WAY OUT OF IT.
       *
       * Two of these refusals leave the person stuck rather than merely told
       * off. They pressed Google, Firebase made them a *new* sign-in, and the
       * server has now refused to register it because the telephone or the
       * email already belongs to an account — their own, usually, made with
       * their phone last year.
       *
       * Without a way back they are signed in as an identity that owns nothing
       * and can do nothing, looking at a red sentence, on a screen whose only
       * other control is the button that just failed. So the offer appears:
       * leave this sign-in and start again on the telephone, which is the door
       * that will actually open.
       */
      setStranded(
        result.errorCode === AppErrorCode.EMAIL_ALREADY_REGISTERED ||
          result.errorCode === AppErrorCode.PHONE_ALREADY_REGISTERED ||
          result.errorCode === AppErrorCode.WORK_PHONE_NOT_CUSTOMER,
      );
      return;
    }

    // Registered: the stash has done its job and must not follow this browser
    // into somebody else's sign-up.
    clearStashedName();

    // Terms and privacy are recorded as accepted; marketing is a separate,
    // freely-given consent — that separation is the point of the rules.
    await recordConsent({ consentType: ConsentType.TERMS, granted: true });
    await recordConsent({ consentType: ConsentType.PRIVACY_NOTICE, granted: true });
    await recordConsent({ consentType: ConsentType.MARKETING, granted: marketing });

    await refreshClaims();
    setBusy(false);
    router.replace(next);
  };

  /**
   * Abandon this sign-in and go back to the telephone.
   *
   * Signs out rather than merely navigating: the half-made Google identity is
   * what is blocking the screen, and leaving it signed in means the phone step
   * would try to *link* the number to it — which is precisely the write the
   * server has already refused. Signing out first makes the next attempt an
   * ordinary sign-in to the account that exists.
   */
  const startOver = async () => {
    const auth = firebaseAuth();
    setBusy(true);
    try {
      if (auth) await signOut(auth);
    } finally {
      clearStashedName();
      setStranded(false);
      setError(null);
      setEmail('');
      setFullName('');
      setCode('');
      setPhase('phone');
      setBusy(false);
    }
  };

  /*
   * Nothing is decided until we know who — if anyone — is signed in.
   *
   * `step` below is derived from `needsRegistration`, and the redirect above
   * sends an already-registered person on their way. Both are answers to "who
   * is this", and `loading` does not answer that question — it only says
   * whether Firebase has spoken at all. Rendering between the two is how a
   * signed-in customer saw the sign-up form on the way to their own account.
   */
  if (loading || identityLoading) {
    return (
      <AppShell>
        <PageLoading />
      </AppShell>
    );
  }

  /*
   * Signed in, and the account could not be read.
   *
   * This is emphatically not "you have not registered". It used to be treated
   * as exactly that — a dropped or refused read left `profile` null, which put
   * this screen on the registration step and asked a long-standing customer for
   * their name again. A person who sees that reasonably concludes their account
   * has been deleted. Say what happened instead, and offer the one button that
   * helps.
   */
  if (firebaseUser && profileUnavailable) {
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

  return (
    <AppShell>
      <div className="mx-auto max-w-md py-2">
        {/* Every step has a way out. */}
        <div className="mb-2 flex items-center">
          {step === 'code' ? (
            <button
              onClick={() => {
                setPhase('phone');
                setCode('');
                setError(null);
              }}
              className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-ink-500 hover:bg-ink-100"
            >
              <ArrowLeft size={17} /> {t('common.back')}
            </button>
          ) : (
            <Link
              href={step === 'profile' ? '/' : next}
              className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-ink-500 hover:bg-ink-100"
            >
              <ArrowLeft size={17} /> {t('common.back')}
            </Link>
          )}
        </div>

        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={44} className="text-brand-600" />
          <h1 className="mt-3 text-xl font-semibold text-ink-900">
            {step === 'profile' ? t('auth.signUp') : t('auth.signIn')}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {step === 'profile' ? t('auth.almostDone') : t('brand.tagline')}
          </p>
        </div>

        <Card className="p-5">
          {step === 'phone' && (
            <div className="space-y-4">
              <PhoneInput
                label={t('auth.phone')}
                hint={t('auth.phoneHint')}
                value={phone}
                onChange={setPhone}
              />
              <Button
                fullWidth
                loading={busy}
                disabled={phone.length < 13 || !isFirebaseConfigured}
                onClick={sendCode}
              >
                {t('auth.sendCode')}
              </Button>

              {/* Shortcuts to the same place, not separate doors. */}
              {!firebaseUser && (
                <>
                  <div className="flex items-center gap-3 py-1">
                    <span className="h-px flex-1 bg-ink-200" />
                    <span className="text-xs text-ink-400">{t('auth.or')}</span>
                    <span className="h-px flex-1 bg-ink-200" />
                  </div>

                  <Button
                    variant="secondary"
                    fullWidth
                    disabled={busy}
                    onClick={() => void withProvider('google')}
                  >
                    <GoogleGlyph /> {t('auth.withGoogle')}
                  </Button>

                  <Button
                    variant="secondary"
                    fullWidth
                    disabled={busy}
                    onClick={() => void withProvider('apple')}
                  >
                    <AppleGlyph /> {t('auth.withApple')}
                  </Button>
                </>
              )}

              {firebaseUser && !firebaseUser.phoneNumber && (
                <Alert tone="info">{t('auth.phoneStillNeeded')}</Alert>
              )}
            </div>
          )}

          {step === 'code' && (
            <div className="space-y-5">
              <p className="text-[15px] leading-relaxed text-ink-600">
                {/* Masked rather than spelled out. The person already knows
                    their own number; the last four are enough to catch a
                    mistyped one, and the rest is not worth putting on a screen
                    somebody else can be standing behind. */}
                {t('auth.codeSentTo', { phone: maskPhone(phone) })}
              </p>

              <OtpInput
                label={t('auth.code')}
                value={code}
                onChange={(next) => {
                  setCode(next);
                  // The red boxes are about the code that was rejected, not the
                  // one being typed now.
                  if (error) setError(null);
                }}
                onComplete={() => void verifyCode()}
                disabled={busy}
                invalid={Boolean(error)}
              />

              <Button fullWidth loading={busy} disabled={code.length < 6} onClick={verifyCode}>
                {t('auth.verify')}
              </Button>

              {/*
               * Resending is a real SMS that costs money and, sent twice in ten
               * seconds, arrives out of order — so the button is a countdown
               * until it is genuinely worth pressing. Showing the clock in the
               * button's own place, rather than hiding the button, means the
               * screen does not jump when it becomes available.
               */}
              {resendIn > 0 ? (
                <div className="flex h-12 w-full items-center justify-center rounded-2xl bg-ink-100 text-base font-medium tabular-nums text-ink-400">
                  {`00 : ${String(resendIn).padStart(2, '0')}`}
                </div>
              ) : (
                <Button
                  variant="secondary"
                  fullWidth
                  disabled={busy}
                  onClick={() => {
                    setCode('');
                    setError(null);
                    void sendCode();
                  }}
                >
                  {t('auth.resend')}
                </Button>
              )}
            </div>
          )}

          {step === 'profile' && (
            <div className="space-y-4">
              <Input
                label={t('auth.fullName')}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
                maxLength={80}
              />
              <Input
                label={t('auth.emailOptional')}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                autoComplete="email"
                maxLength={254}
              />

              <Alert tone="info">{t('auth.oneAccountNotice')}</Alert>

              <label className="flex items-start gap-2.5 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(event) => setMarketing(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                />
                <span>
                  {t('auth.marketingConsent')}
                  <span className="mt-0.5 block text-xs text-ink-400">
                    {t('auth.marketingHint')}
                  </span>
                </span>
              </label>

              <Button
                fullWidth
                loading={busy}
                disabled={fullName.trim().length < 2}
                onClick={finish}
              >
                {t('auth.finish')}
              </Button>
            </div>
          )}

          {error && (
            <div className="mt-4">
              <Alert tone="danger">{error}</Alert>

              {/* The way out of the dead end. Shown only when the refusal is
                  one the person cannot resolve on this screen — never as a
                  general "give up" button next to an ordinary typo. */}
              {stranded && (
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  disabled={busy}
                  onClick={() => void startOver()}
                >
                  {t('auth.startOverWithPhone')}
                </Button>
              )}
            </div>
          )}
        </Card>

        <p className="mt-4 text-center text-xs text-ink-400">
          {t('auth.termsNotice')}{' '}
          <Link href="/legal/terms" className="underline">
            {t('legal.terms')}
          </Link>
        </p>

        {/* Invisible reCAPTCHA anchors here. */}
        <div id="recaptcha-container" />
      </div>
    </AppShell>
  );
}

/** Apple's mark, drawn — a PNG here would be a request and a licence question. */
function AppleGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.36 12.66c.02-2.3 1.88-3.4 1.96-3.45-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.55.02-2.98.9-3.77 2.28-1.61 2.79-.41 6.93 1.15 9.2.76 1.11 1.67 2.36 2.86 2.31 1.15-.05 1.58-.74 2.97-.74 1.39 0 1.78.74 3 .72 1.24-.02 2.02-1.13 2.78-2.25.87-1.29 1.23-2.54 1.25-2.6-.03-.01-2.4-.92-2.4-3.71ZM14.1 5.9c.63-.77 1.06-1.83.94-2.9-.91.04-2.01.61-2.67 1.37-.59.68-1.1 1.76-.96 2.8 1.01.08 2.05-.51 2.69-1.27Z" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l6.9 5.3c4.1-3.8 6.6-9.4 6.6-15.6z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 10l7.1-5.5z"
      />
      <path
        fill="#EA4335"
        d="M24 10.6c3.2 0 5.4 1.4 6.7 2.6l6.1-6C33 3.8 29.9 2 24 2 15.4 2 8.1 6.9 4.4 14l7.1 5.5c1.8-5.3 6.7-8.9 12.5-8.9z"
      />
    </svg>
  );
}

/**
 * A Firebase Auth failure, said in the customer's language.
 *
 * WHAT THIS REPLACED
 * ------------------
 * `setError((caught as Error).message)`. The customer was shown, verbatim:
 *
 *     Firebase: We have blocked all requests from this device due to unusual
 *     activity. Try again later. (auth/too-many-requests).
 *
 * In English, naming the vendor, quoting an error code — at the narrowest point
 * in the whole funnel, the moment somebody is trying to create an account. Every
 * other screen in this app translates its errors properly; this one line was the
 * exception, and it was on the screen that could least afford it.
 *
 * WHY A SWITCH AND NOT A LOOKUP BY CODE
 * -------------------------------------
 * Because the fallback matters more than the mapping. A code nobody has listed
 * must produce a sentence a person can act on — never the raw message, which is
 * how the original bug happened, and never an empty box, which is worse. So an
 * unknown code answers with the generic failure and the details go to the
 * console for whoever is debugging, not to the customer.
 */
function authErrorText(t: Translate, caught: unknown): string {
  const code = (caught as { code?: string } | null)?.code ?? '';

  switch (code) {
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return t('errors.INVALID_PHONE');
    case 'auth/too-many-requests':
      return t('auth.tooManyRequests');
    case 'auth/quota-exceeded':
      return t('auth.smsUnavailable');
    case 'auth/network-request-failed':
      return t('errors.NETWORK');
    case 'auth/captcha-check-failed':
    case 'auth/invalid-app-credential':
      return t('auth.verificationFailed');
    case 'auth/credential-already-in-use':
    case 'auth/account-exists-with-different-credential':
      return t('auth.phoneTaken');
    default:
      // Not shown to the person. Kept so a failure that nobody mapped is still
      // findable by whoever is looking at the console.
      if (code) console.warn('[auth]', code);
      return t('errors.INTERNAL');
  }
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <PageLoading />
        </AppShell>
      }
    >
      <SignInInner />
    </Suspense>
  );
}
