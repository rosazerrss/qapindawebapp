'use client';

/**
 * QAPINDA — "X restoranı sizi komandasına dəvət edir."
 *
 * WHY IT LIVES ON THE ACCOUNT SCREEN
 * ----------------------------------
 * The person being invited is, at this moment, an ordinary customer. They have
 * no restaurant panel — that is the whole point — so the offer has to reach
 * them somewhere they already go. Hesabım is the one screen every signed-in
 * person opens, and it is where the notification's link points.
 *
 * WHY IT DRAWS NOTHING WHEN THERE IS NOTHING
 * ------------------------------------------
 * Almost every customer will never be invited to anything. A heading with an
 * empty space under it, on the account screen of a hundred thousand people, to
 * serve the handful who have an offer, is a worse screen for everybody. The
 * component returns null until a live invitation actually exists.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { firestore } from '@/firebase/client';
import { useAuth } from '@/contexts/AuthContext';
import { accountHome } from '@/shared/permissions';
import { useT, translateError } from '@/i18n';
import { respondToRestaurantInvite } from '@/firebase/callables';
import { Alert, Button, Card } from '@/components/ui';
import { COLLECTIONS } from '@/shared/collections';
import { InviteStatus } from '@/shared/enums';
import type { RestaurantInvite } from '@/shared/models';

export function RestaurantInvites({ uid }: { uid: string | null }) {
  const t = useT();
  const router = useRouter();
  const { refreshClaims } = useAuth();
  const [invites, setInvites] = useState<RestaurantInvite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = firestore();
    if (!db || !uid) return;

    /*
     * Filtered on both `uid` and `status` in the QUERY, not after it.
     *
     * Firestore evaluates a security rule against the query rather than against
     * the documents it would return, so the `uid` clause is what makes this
     * readable at all — without it the whole subscription is refused, not
     * merely narrowed. The status clause is ordinary economy: an account that
     * has been invited and declined three times should not stream three dead
     * rows on every visit to the account screen.
     */
    return onSnapshot(
      query(
        collection(db, COLLECTIONS.restaurantInvites),
        where('uid', '==', uid),
        where('status', '==', InviteStatus.PENDING),
      ),
      (snapshot) =>
        setInvites(
          snapshot.docs
            .map((entry) => entry.data() as RestaurantInvite)
            /*
             * The expiry is applied HERE, in the subscription, not during
             * render.
             *
             * An offer whose fortnight has run out is still PENDING in the
             * database — it is marked expired when somebody tries to use it,
             * not by a sweep — so it has to be filtered somewhere. Reading the
             * clock during render makes the render impure, which the lint rule
             * refuses for a good reason: React may run it twice and expects the
             * same answer. A snapshot callback is an event, and reading the
             * clock in one is exactly right.
             */
            .filter((invite) => {
              const expiresMs = invite.expiresAt?.toMillis?.();
              return typeof expiresMs !== 'number' || expiresMs > Date.now();
            }),
        ),
      // Silent. This is an extra on a screen about something else; a red banner
      // about a subscription most people have no rows in would be noise.
      () => setInvites([]),
    );
  }, [uid]);

  if (invites.length === 0) return null;

  const answer = async (invite: RestaurantInvite, accept: boolean) => {
    setBusy(invite.restaurantId);
    setError(null);

    const result = await respondToRestaurantInvite({
      restaurantId: invite.restaurantId,
      accept,
    });

    setBusy(null);

    if (!result.ok) {
      setError(translateError(t, result.errorCode, result.errorDetail));
      return;
    }

    if (!accept) return;

    /*
     * The token has to be refetched before the panel is opened.
     *
     * The server has just changed this account's role and revoked its token,
     * but the one in this browser still says CUSTOMER — and the Firestore
     * security rules read only the token. Navigating straight to the panel with
     * the old one loads a screen whose every query is refused, which looks
     * exactly like a broken panel rather than like a stale credential.
     *
     * `refreshClaims` forces a new token; `AuthContext` then re-renders the
     * whole app under the new role, which is why this is a router push and not
     * a page reload.
     */
    await refreshClaims();
    router.push(accountHome(invite.role));
  };

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-semibold text-ink-900">{t('invite.title')}</h2>

      <div className="mt-3 space-y-3">
        {invites.map((invite) => (
          <div
            key={invite.id}
            className="rounded-xl border border-card-edge p-3.5"
          >
            <p className="text-ink-900">
              {t('invite.body', { name: invite.restaurantName })}
            </p>
            <p className="mt-0.5 text-sm text-ink-500">
              {t('invite.asRole', { role: t(`roles.${invite.role}`) })}
            </p>

            {/* Said before the buttons, not after. Accepting turns a personal
                account into a work account: the person stops being able to
                order food from it, which is the one consequence somebody would
                be angry about discovering afterwards. */}
            <p className="mt-2 text-sm text-ink-600">{t('invite.warning')}</p>

            <div className="mt-3 flex gap-2">
              <Button
                loading={busy === invite.restaurantId}
                onClick={() => void answer(invite, true)}
              >
                {t('invite.accept')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy === invite.restaurantId}
                onClick={() => void answer(invite, false)}
              >
                {t('invite.decline')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Card>
  );
}
