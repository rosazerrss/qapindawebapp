'use client';

/**
 * QAPINDA — Remembering, for this visit, that no code can be sent.
 *
 * WHY A MODULE-LEVEL FLAG AND NOT A SETTING
 * -----------------------------------------
 * Whether the platform has an SMS gateway configured is a server fact: it lives
 * in `functions/.env`, which by design never reaches a browser. There is no
 * setting a screen can read to find out in advance.
 *
 * So the browser learns it the only way it can — by asking once and being
 * refused — and this remembers the answer for the rest of the visit. The person
 * who walks into the dead end does so once; every address they add afterwards
 * warns them before they save, and offers the one-tap fix in the form itself.
 *
 * NOT PERSISTED, ON PURPOSE. `localStorage` would carry a stale "no SMS" into
 * the week after the gateway is switched on, and the failure mode of that is a
 * customer told they cannot verify a number that they can. A fact learned by
 * observation should not outlive the observation by longer than the visit.
 */

let unavailable = false;

/** True once a code request has come back saying no gateway is configured. */
export const smsKnownUnavailable = (): boolean => unavailable;

export function rememberSmsUnavailable(): void {
  unavailable = true;
}

/** For a screen that has just seen a code go out after all. */
export function forgetSmsUnavailable(): void {
  unavailable = false;
}
