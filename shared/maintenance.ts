/**
 * QAPINDA — Maintenance mode: the platform is closed, and nobody orders.
 *
 * The owner's rule, in his words: "admin platformanı texniki məsələyə görə
 * deaktiv edərkən qətiyyən heçkim sifariş etməməlidir." So this is not a
 * cosmetic banner. It is one flag in `publicSettings`, read by the SERVER on
 * every ordering call, and a hidden button is explicitly not the mechanism —
 * `createOrder` and `previewOrder` both refuse while it is on, whatever the
 * request says.
 *
 * WHY THE PREDICATE LIVES HERE RATHER THAN IN THE CALLABLE
 * -------------------------------------------------------
 * Three places have to agree about what "closed" means: the shopfront that
 * shows the notice, the checkout that stops offering the button, and the two
 * callables that refuse. If each worked it out for itself they would drift —
 * and the way they would drift is that the screen would say "closed" while the
 * server still took the order, or the reverse, which is the exact failure this
 * flag exists to prevent. So the question is answered once, by a pure function
 * over the settings document, and everything else asks it.
 *
 * WHAT MAINTENANCE MODE DOES NOT TOUCH
 * ------------------------------------
 * Everything the platform needs in order to be repaired, and everything needed
 * to finish the orders already in flight. Restaurants, couriers, operators and
 * admins keep working exactly as before: no panel is gated on this, no status
 * transition is gated on this, and an order accepted a minute before the switch
 * was thrown is cooked, driven and delivered normally. Closing the door is not
 * the same as emptying the building — see `maintenanceBlocks`.
 */

/** Just enough of `PublicSettings` to answer the question. */
export interface MaintenanceSettingsLike {
  maintenanceMode?: boolean | null;
  /** What customers are told. Optional: silence is an acceptable answer. */
  maintenanceMessage?: string | null;
  /**
   * When the platform is expected back, in epoch milliseconds.
   *
   * Stored as a plain number rather than a Firestore `Timestamp` so that the
   * same value survives the callable wire, `JSON.parse` and this predicate
   * without three different shapes to unwrap. Null means "we are not promising
   * a time", which is better than a promise that is quietly missed.
   */
  maintenanceUntil?: number | null;
}

/** The whole of maintenance mode, in the shape a screen wants to render. */
export interface MaintenanceState {
  on: boolean;
  message: string | null;
  /** Epoch millis, or null when no return time was given. */
  until: number | null;
}

/** The longest a "back by" promise may be pushed into the future: 30 days. */
const MAX_MAINTENANCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Reads the state out of a settings document.
 *
 * Written defensively because the document is old data: a deployment made
 * before this feature existed has no `maintenanceMode` field at all, and the
 * absence of the field must read as "the platform is open" rather than as
 * `undefined` leaking into a boolean check somewhere downstream.
 */
export function maintenanceStateOf(
  settings: MaintenanceSettingsLike | null | undefined,
): MaintenanceState {
  const on = settings?.maintenanceMode === true;
  const message = typeof settings?.maintenanceMessage === 'string' ? settings.maintenanceMessage.trim() : '';
  const until =
    typeof settings?.maintenanceUntil === 'number' && Number.isFinite(settings.maintenanceUntil)
      ? settings.maintenanceUntil
      : null;

  return {
    on,
    // Only when there is one and the platform is actually closed: a message
    // left over from the last outage must not appear on an open shopfront.
    message: on && message.length > 0 ? message : null,
    until: on ? until : null,
  };
}

/**
 * May a new order be created right now?
 *
 * The single question `createOrder` and `previewOrder` ask, and the single
 * question the checkout screen asks before it offers the button. Deliberately
 * named for what it decides rather than for the flag behind it, so that a
 * second reason to close the platform can be added here later without every
 * caller having to learn about it.
 */
export function orderingIsOpen(settings: MaintenanceSettingsLike | null | undefined): boolean {
  return !maintenanceStateOf(settings).on;
}

/**
 * Which parts of the platform maintenance mode closes.
 *
 * Only the placing of new orders. Named as a function rather than written as a
 * comment because it is the thing that has to stay true: a future change that
 * starts gating a panel on `maintenanceMode` has to come through here and past
 * the test that pins it.
 */
export function maintenanceBlocks(
  action: 'createOrder' | 'previewOrder' | 'orderStatusChange' | 'panelAccess' | 'signIn',
): boolean {
  return action === 'createOrder' || action === 'previewOrder';
}

/**
 * Validates a return time an admin typed before it is stored.
 *
 * A time in the past is worse than no time — it reads as "we should already be
 * back" — and a time years out is a typo. Both come back as null, which is the
 * honest "no promise" state rather than a refusal that would stop the admin
 * closing the platform at all in an emergency.
 */
export function normaliseMaintenanceUntil(
  value: unknown,
  nowMs: number,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= nowMs) return null;
  if (value - nowMs > MAX_MAINTENANCE_WINDOW_MS) return null;
  return Math.round(value);
}
