/**
 * Firebase Admin bootstrap.
 *
 * Everything server-side goes through this one initialised app, so there is a
 * single place that decides the region and the Firestore settings.
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';

/** Must match the Firestore database region, or every call pays a round trip. */
export const REGION = 'europe-west1';

/*
 * APP CHECK, THE SERVER HALF.
 *
 * The browser attaches a token that says "this is really the Qapında app on
 * qapinda.az"; this is what makes the functions insist on one. Without it every
 * callable in this project is a public endpoint any script can drive with an
 * ordinary customer account — and `previewOrder`, which prices a basket against
 * a coupon code, then becomes a free unlimited oracle for guessing live coupon
 * codes.
 *
 * Read from the environment rather than hard-coded to `true`, and off by
 * default, for one reason: the reCAPTCHA key is a console step the owner takes
 * *after* this deploys. Enforcing before the key exists would refuse every call
 * from the real app — the shopfront, checkout, the panels, all of it — and the
 * failure would look like a total outage rather than a missing setting. So the
 * switch is one variable, set on the functions and in the client's own
 * `NEXT_PUBLIC_APPCHECK_SITE_KEY` at the same time:
 *
 *     firebase functions:config … or, simply, the runtime env var
 *     APPCHECK_ENFORCE=true
 *
 * Turn the client on first, confirm real traffic is carrying tokens in the
 * App Check console, then turn this on. That order is what makes it a
 * five-minute change rather than an outage.
 */
const ENFORCE_APP_CHECK = process.env.APPCHECK_ENFORCE === 'true';

setGlobalOptions({
  region: REGION,
  maxInstances: 20,
  // A hung call holds a paid instance. Nothing here should take a minute.
  timeoutSeconds: 60,
  memory: '256MiB',
  enforceAppCheck: ENFORCE_APP_CHECK,
});

const app = initializeApp();

export const db = getFirestore(app);
export const auth = getAuth(app);
export { FieldValue, Timestamp };

db.settings({ ignoreUndefinedProperties: true });

export const now = () => FieldValue.serverTimestamp();

/** A Timestamp `minutes` from now — for response deadlines and estimates. */
export function minutesFromNow(minutes: number): Timestamp {
  return Timestamp.fromMillis(Date.now() + minutes * 60_000);
}
