'use client';

/**
 * Who is signed in.
 *
 * Guest browsing is a first-class state, not an error: `user === null` means a
 * visitor who can look at every restaurant and fill a cart. They are only sent
 * to sign in at checkout, and their cart survives the trip.
 *
 * The role comes from the ID token's custom claims — the same claims the server
 * checks — so the UI and the server can never disagree about what someone is
 * allowed to see. This is for hiding buttons; the server decides for real.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  onIdTokenChanged,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';

import { firebaseAuth, firestore, isFirebaseConfigured } from '@/firebase/client';
import { disablePushOnThisDevice, enablePushOnThisDevice } from '@/lib/fcm';
import { touchSession } from '@/firebase/callables';
import { paths } from '@/shared/collections';
import { UserRole } from '@/shared/enums';
import type { User } from '@/shared/models';

interface AuthValue {
  /** The Firebase account, or null for a guest. */
  firebaseUser: FirebaseUser | null;
  /** The Qapında profile. Null until registration finishes. */
  profile: User | null;
  role: UserRole;
  restaurantId: string | null;
  /** True while we still do not know whether anyone is signed in. */
  loading: boolean;
  /**
   * True while we know somebody is signed in but not yet *who*.
   *
   * `loading` answers a different question — whether Firebase has told us
   * anything at all — and it goes false the instant the auth state arrives,
   * about a round trip before the profile document and the decoded token do.
   * In that gap `role` is still its CUSTOMER default, and a screen that guards
   * on the role alone throws its own user off it: the courier opening /courier
   * was redirected to the shopfront on every cold load, having watched a
   * spinner first. Anything that redirects on a role must wait for this.
   */
  identityLoading: boolean;
  /** Signed in but has not completed `registerAccount` yet. */
  needsRegistration: boolean;
  /**
   * We asked for the profile, we were refused or cut off, and we have stopped
   * asking.
   *
   * This is NOT the same as "there is no profile", and telling the two apart is
   * the whole point of it existing — see the listener below. A screen that
   * finds this true should say the account could not be read and offer to try
   * again. It must never offer to register.
   */
  profileUnavailable: boolean;
  /** Re-attaches the profile listener after `profileUnavailable`. */
  retryProfile: () => void;
  /**
   * We gave up waiting for the identity rather than receiving one.
   *
   * `identityLoading` goes false at the deadline whether or not an answer came,
   * so that no screen can spin forever. This says which of the two happened.
   */
  identityStalled: boolean;
  signOut: () => Promise<void>;
  refreshClaims: () => Promise<void>;
  configured: boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * What the profile read has told us so far.
 *
 * The uid rides along on every variant so that "not loaded yet" and "loaded,
 * and there is nothing" stay separable during render — and so that signing out
 * and back in as somebody else cannot show the previous person's answer.
 */
type ProfileState =
  | { uid: string; status: 'loaded'; user: User }
  | { uid: string; status: 'missing' }
  | { uid: string; status: 'error' };

/**
 * How long to wait before re-opening a profile listener that failed, and — by
 * its length — how many times to bother.
 *
 * Short first, because the common failure is a token that is a few hundred
 * milliseconds behind the account and fixes itself. Then long enough to cross a
 * lift or a lost signal. Four is the end of it: past there the read is being
 * refused for a reason that waiting will not change, and the screens say so.
 */
const PROFILE_RETRY_MS = [400, 1_200, 3_000, 8_000];

/**
 * How long any screen may be made to wait for "who is this".
 *
 * The retries above can take thirteen seconds to give up, and the token read
 * can take longer still on a bad connection. Thirteen seconds of spinner is not
 * meaningfully different from a broken page to the person holding the phone.
 *
 * So there is a stop. Past it the app stops claiming the identity is still
 * arriving and renders with what it has — which, for a signed-in customer whose
 * profile has not landed, is the sign-in wall rather than a spinner. That is a
 * worse answer than the right one and a much better answer than none, and it
 * recovers on its own the moment either listener finally reports.
 *
 * Six seconds because it has to outlast a normal cold start on a slow phone —
 * two round trips, one for the token and one for the document — while staying
 * inside the few seconds a person will wait before deciding the app is broken.
 */
const IDENTITY_DEADLINE_MS = 6_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  /*
   * Both of these carry the uid they belong to, so that "not loaded yet" and
   * "loaded, and there is nothing" stay separable during render. Storing the
   * bare value and a separate flag is the same information in two places, and
   * the two drift apart exactly when a person signs out and back in as
   * somebody else.
   */
  const [profileSnapshot, setProfileSnapshot] = useState<ProfileState | null>(null);
  /** Bumped by `retryProfile` to re-run the listener effect from scratch. */
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [claims, setClaims] = useState<{
    uid: string;
    role: UserRole;
    restaurantId: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    const auth = firebaseAuth();
    // Without configuration `loading` was already initialised to false, so
    // there is nothing to set here — and nothing to listen to.
    if (!auth) return;

    return onAuthStateChanged(auth, (next) => {
      setFirebaseUser(next);
      if (!next) setClaims(null);
      setLoading(false);
    });
  }, []);

  /**
   * A role change (staff added, restaurant approved) arrives as a new token.
   *
   * WHY THE `catch` IS LOAD-BEARING
   * -------------------------------
   * `getIdTokenResult` goes to the network when the cached token has expired,
   * and on a phone that is a request that can simply not come back — a lift, a
   * tunnel, a handover between cells. Without the catch the promise rejected,
   * `setClaims` never ran, and `identityLoading` stayed true FOREVER: every
   * screen that waits for the identity showed a spinner that could not end, and
   * the only way out was to close the tab.
   *
   * That was the "sometimes it says loading and never opens" on mobile, and it
   * was introduced by the same change that made those screens wait for the
   * identity in the first place. Waiting for an answer is right; waiting for an
   * answer that can never arrive is not.
   *
   * On failure the identity settles as a plain customer. That is safe rather
   * than a guess: `role` prefers the profile document, which is read separately
   * and is what the server re-reads on every call, so a wrong claim here cannot
   * grant anything — and one retry covers the common case of a token that
   * expired at the exact moment the signal dropped.
   */
  useEffect(() => {
    const auth = firebaseAuth();
    if (!auth) return;

    return onIdTokenChanged(auth, async (next) => {
      if (!next) {
        setClaims(null);
        return;
      }

      const read = async () => {
        const token = await next.getIdTokenResult();
        setClaims({
          uid: next.uid,
          role: (token.claims.role as UserRole) ?? UserRole.CUSTOMER,
          restaurantId: (token.claims.restaurantId as string) || null,
        });
      };

      try {
        await read();
      } catch {
        try {
          await read();
        } catch {
          setClaims({ uid: next.uid, role: UserRole.CUSTOMER, restaurantId: null });
        }
      }
    });
  }, []);

  /**
   * The profile is live: a suspension or a new default address shows at once.
   *
   * WHY THIS LISTENER RETRIES, AND WHY THAT IS NOT A REFINEMENT
   * -----------------------------------------------------------
   * It used to answer a failed read the same way it answers an empty one — with
   * `null` — on the reasoning that either way we asked and got nothing, and
   * that leaving the question unsettled hangs the screen forever.
   *
   * Half of that was right and the other half shipped a bug that a fully
   * registered person hits on an ordinary day. `null` here means "this account
   * has no profile", which is precisely the fact `needsRegistration` is built
   * on. So a listener that failed for any reason at all — the token had not
   * reached Firestore yet, the tab woke from sleep, the phone changed network,
   * the rules refused one read — told the whole app that a five-year customer
   * had never registered, and the sign-in screen dutifully sent them to the
   * "finish registering" step. Worse, `onSnapshot` TEARS THE LISTENER DOWN on
   * error, so nothing ever corrected it: the state was wrong until the page was
   * reloaded.
   *
   * The three answers are now kept apart:
   *
   *   'loaded'  — the document is here.
   *   'missing' — the read SUCCEEDED and there is no document. Only this one
   *               may ever send somebody to the registration form.
   *   'error'   — we could not find out, having tried. The screens show a retry.
   *
   * The retry forces a fresh token first, because the failure this recovers
   * from most often is a permission refusal against a token that had not yet
   * caught up with the account. The attempt count is the stop: an unauthorised
   * read that will never be authorised must not become a listener that reopens
   * against Firestore forever.
   */
  useEffect(() => {
    const db = firestore();
    if (!db || !firebaseUser) return;

    const uid = firebaseUser.uid;
    const reference = doc(db, paths.user(uid));

    let cancelled = false;
    let detach: (() => void) | undefined;
    let timer: number | undefined;
    let attempt = 0;

    const attach = () => {
      if (cancelled) return;

      detach = onSnapshot(
        reference,
        (snapshot) => {
          attempt = 0;

          if (snapshot.exists()) {
            // A document is a document, cached or not. Showing a slightly stale
            // profile for a moment is right; refusing to show one is not.
            setProfileSnapshot({ uid, status: 'loaded', user: snapshot.data() as User });
            return;
          }

          /*
           * "NOT THERE" IS ONLY TRUE IF THE SERVER SAID SO.
           *
           * This is the bug behind "removing somebody from the team sends them
           * to the registration form", and it was the last one standing in a
           * family of them.
           *
           * Removing a member of staff revokes their refresh token — it has to,
           * because the security rules read the token and a stale one would
           * keep the restaurant's orders readable for another hour. The moment
           * that happens the Firestore SDK in that person's browser drops its
           * connection AND CLEARS ITS LOCAL CACHE, because the authenticated
           * user has changed. It then emits a snapshot from that empty cache.
           *
           * `exists()` on it is false. `fromCache` on it is true. The first
           * says "this account has no profile"; the second says "I have not
           * asked anybody yet". We were reading only the first, so a person who
           * had been a customer for a year was told to register again, at the
           * exact moment their role changed — which is also the moment it is
           * most alarming, because it looks like the removal deleted them.
           *
           * A cached emptiness is therefore not an answer. The listener stays
           * open and the next server snapshot settles it: either the document
           * arrives, or the server confirms it is genuinely gone.
           */
          if (snapshot.metadata.fromCache) return;

          setProfileSnapshot({ uid, status: 'missing' });
        },
        () => {
          // The listener is already dead at this point; dropping our handle on
          // it only keeps the cleanup below honest.
          detach = undefined;
          if (cancelled) return;

          attempt += 1;
          if (attempt > PROFILE_RETRY_MS.length) {
            setProfileSnapshot({ uid, status: 'error' });
            return;
          }

          const auth = firebaseAuth();
          void auth?.currentUser?.getIdToken(true).catch(() => undefined);
          timer = window.setTimeout(attach, PROFILE_RETRY_MS[attempt - 1]);
        },
      );
    };

    attach();

    return () => {
      cancelled = true;
      detach?.();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [firebaseUser, profileAttempt]);

  // Derived rather than cleared in an effect: with nobody signed in there is no
  // profile, and a stale one must never flash on screen between the two.
  const profileState =
    firebaseUser && profileSnapshot?.uid === firebaseUser.uid ? profileSnapshot : null;
  const profile = profileState?.status === 'loaded' ? profileState.user : null;

  const retryProfile = useCallback(() => setProfileAttempt((count) => count + 1), []);

  // Signed out, nobody to identify. Signed in, both answers must be in: the
  // token says what the security rules will allow, the document says what the
  // server believes, and until the two are here the role is a guess.
  /*
   * The stop, armed the moment somebody is known to be signed in.
   *
   * Keyed on the uid so that signing out and back in as somebody else starts a
   * fresh clock rather than inheriting an expired one — otherwise the second
   * person would be rendered with no identity at all, instantly.
   */
  const [identityTimedOut, setIdentityTimedOut] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    const uid = firebaseUser.uid;
    const timer = window.setTimeout(() => setIdentityTimedOut(uid), IDENTITY_DEADLINE_MS);
    return () => window.clearTimeout(timer);
  }, [firebaseUser]);

  const identityUnresolved = Boolean(firebaseUser) && !loading
    ? profileState === null || claims?.uid !== firebaseUser?.uid
    : loading;

  const identityLoading =
    identityUnresolved && identityTimedOut !== (firebaseUser?.uid ?? null);

  /**
   * The token is an hour behind the truth, and that hour is a bug.
   *
   * When a restaurant makes somebody a courier, `setRestaurantStaff` writes the
   * new role to their user document and to their custom claims in the same
   * breath. The document is live here, so the app knows within a second. The
   * *token* in their pocket does not — Firebase reissues it about once an hour
   * — and the security rules read the token, not the document. So the courier
   * opened /courier, the app let them in on the strength of the profile, and
   * every query they made was refused: an empty screen with no explanation,
   * which is exactly what was reported.
   *
   * Noticing the disagreement and forcing a fresh token closes that hour.
   * `refreshed` is the stop: if the server never actually set the claim, one
   * refresh per mismatch is a wasted round trip, but a loop would be a bug that
   * hammers Firebase forever.
   */
  const refreshed = useRef<string | null>(null);

  useEffect(() => {
    const auth = firebaseAuth();
    if (!auth?.currentUser || !profile) return;

    const wanted = `${profile.role}:${profile.restaurantId ?? ''}`;
    const held = `${claims?.role ?? UserRole.CUSTOMER}:${claims?.restaurantId ?? ''}`;
    if (wanted === held || refreshed.current === wanted) return;

    refreshed.current = wanted;
    void auth.currentUser.getIdToken(true);
  }, [profile, claims]);

  /*
   * Keep this device's push registration current, once we know who is signed in.
   *
   * On every start, not only the first: a token can be rotated by the browser
   * at any moment, and the server's `lastSeenAt` — the only evidence a device
   * is still alive — is what this moves forward. It is also what claims a
   * shared tablet for whoever has just signed in on it, taking the token off
   * the previous account so their orders stop ringing on it.
   *
   * Everything inside returns quietly when push is not switched on, not
   * permitted, or not supported. Nothing here ever prompts: the only place that
   * asks for permission is the switch in Settings, because a prompt somebody
   * did not ask for is the fastest way to be refused permanently.
   */
  const signedInUid = profile?.uid ?? null;

  useEffect(() => {
    if (!signedInUid) return;
    void enablePushOnThisDevice().catch(() => undefined);
  }, [signedInUid]);

  /*
   * The session record.
   *
   * Fired once per signed-in account rather than on every render, and the
   * server decides whether it is worth an audit entry: for a customer it moves
   * `lastSeenAt` and nothing more, and for a staff account it writes "this
   * person was in the panel" — throttled there, not here, because the throttle
   * has to survive a page reload and this component does not.
   *
   * Never awaited and never surfaced. A failure here must not keep anybody out
   * of the app; the record is for the platform's benefit, not the person's.
   */
  useEffect(() => {
    if (!signedInUid) return;
    void touchSession().catch(() => undefined);
  }, [signedInUid]);

  const signOut = useCallback(async () => {
    /*
     * The device is unregistered BEFORE the sign-out.
     *
     * `unregisterPushToken` is a callable, and a callable needs the credential
     * that is about to be thrown away — after `firebaseSignOut` it would be
     * refused. Getting this order wrong leaves a live token on a shared tablet
     * and the next person to pick it up reads the last person's orders.
     */
    await disablePushOnThisDevice().catch(() => undefined);

    /*
     * And the session is closed in the log, for the same reason and in the same
     * order: this is a callable, so it needs the credential that the next line
     * throws away. It is the only sign-out that can be recorded at all — a
     * closed tab tells no server anything.
     */
    await touchSession('END').catch(() => undefined);

    const auth = firebaseAuth();
    if (auth) await firebaseSignOut(auth);
  }, []);

  /** Forces a fresh token — call after anything that changes a role. */
  const refreshClaims = useCallback(async () => {
    const auth = firebaseAuth();
    if (auth?.currentUser) await auth.currentUser.getIdToken(true);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      firebaseUser,
      profile,
      // Prefer the profile: it is what the server re-reads on every call.
      role: profile?.role ?? claims?.role ?? UserRole.CUSTOMER,
      restaurantId: profile?.restaurantId ?? claims?.restaurantId ?? null,
      loading,
      identityLoading,
      /*
       * Only on a read that SUCCEEDED and found nothing.
       *
       * Two earlier states both used to reach here and both were wrong: "not
       * read yet" (fixed by waiting for `identityLoading`) and "the read
       * failed" (fixed by the listener above keeping 'error' apart from
       * 'missing'). Either one sends a registered person back to the
       * registration form, which is the single most alarming thing this app can
       * show somebody — it reads as though their account is gone.
       */
      needsRegistration:
        Boolean(firebaseUser) && !identityLoading && profileState?.status === 'missing',
      /*
       * The deadline expired with nothing to show for it.
       *
       * Distinct from `identityLoading` (which is now false — we stopped
       * waiting) and from `profileUnavailable` (which means the read itself
       * failed). This one means we simply never heard back, and a screen that
       * wants to say "check your connection" rather than showing a sign-in wall
       * can read it.
       */
      identityStalled: identityUnresolved,
      profileUnavailable: profileState?.status === 'error',
      retryProfile,
      signOut,
      refreshClaims,
      configured: isFirebaseConfigured,
    }),
    [
      firebaseUser,
      profile,
      profileState,
      claims,
      loading,
      identityLoading,
      identityUnresolved,
      retryProfile,
      signOut,
      refreshClaims,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
