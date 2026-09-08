/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Does this delivery close with a code?
 *
 * Source of truth. Synced into `src/shared` and `functions/src/shared` by
 * `npm run sync:shared`. Do not edit the copies.
 *
 * WHOSE DECISION IT IS
 * --------------------
 * The restaurant's. It knows its own drivers, its own neighbourhood and its own
 * customers, and a shop with two couriers who have worked there for years does
 * not need a code at every door.
 *
 * What the code buys, when it is on, is a fact. Without it a disputed delivery
 * is a driver who says they handed it over and a customer who says nobody came,
 * and there is nothing to appeal to. Six digits that only somebody at the door
 * could have read out end that argument. So a new restaurant starts with codes
 * ON, and turning them off is a deliberate choice its owner makes.
 *
 * THE PLATFORM SETTING IS AN OVERRIDE, AND IT IS OFF
 * -------------------------------------------------
 * `deliveryCodePolicy` exists so the platform CAN require codes everywhere if
 * it ever needs to — a wave of disputes, a regulator, a decision the owner
 * makes later. It is not on. The default is RESTAURANT_CHOICE, and under it
 * this file simply reports what the restaurant asked for.
 *
 * WHY THE DEFAULT MATTERS MORE THAN IT LOOKS
 * ------------------------------------------
 * The customer's screen and the server have to agree. The customer is shown the
 * "kodu göstər" button by the same answer this function gives the courier's
 * screen and `courierConfirmDelivery` — so a platform policy that required a
 * code while a restaurant had codes switched off would put a driver at a door
 * asking for six digits the customer's screen never offered. One function, read
 * by all three, is what makes that impossible.
 *
 * ONE FUNCTION, THREE READERS
 * ---------------------------
 * `courierConfirmDelivery` enforces it, `issueDeliveryCode` decides whether the
 * customer may be given digits at all, and the courier's screen decides what to
 * say before they knock. Three copies of this rule would eventually be three
 * different rules, and the way that failure shows up is a driver at a door
 * being asked for a code the server will not accept.
 */

export const DELIVERY_CODE_POLICY = {
  /** The platform requires a code everywhere, whatever a restaurant says. */
  ALWAYS: 'ALWAYS',
  /** Each restaurant's own switch decides. The default. */
  RESTAURANT_CHOICE: 'RESTAURANT_CHOICE',
} as const;

export type DeliveryCodePolicy = (typeof DELIVERY_CODE_POLICY)[keyof typeof DELIVERY_CODE_POLICY];

export const DELIVERY_CODE_POLICIES = [
  DELIVERY_CODE_POLICY.ALWAYS,
  DELIVERY_CODE_POLICY.RESTAURANT_CHOICE,
] as const;

/**
 * The platform's setting, read defensively.
 *
 * Only the literal string `ALWAYS` turns the override on. Absent, null,
 * unrecognised, or a settings document written before the field existed all
 * mean RESTAURANT_CHOICE — the restaurant decides.
 *
 * Deliberately strict in that direction. An override that could switch itself
 * on because a field was misspelled would make every restaurant's own switch
 * stop working with nothing on any screen to explain why.
 */
export function deliveryCodePolicyOf(settings: {
  deliveryCodePolicy?: string | null;
}): DeliveryCodePolicy {
  return settings.deliveryCodePolicy === DELIVERY_CODE_POLICY.ALWAYS
    ? DELIVERY_CODE_POLICY.ALWAYS
    : DELIVERY_CODE_POLICY.RESTAURANT_CHOICE;
}

/**
 * Does this order close with a code?
 *
 * The restaurant's own flag, unless the platform override is on.
 *
 * An unreadable restaurant document is treated as "no". That happens for real —
 * a courier is not restaurant staff and cannot always read the restaurant they
 * are delivering for — and the alternative is a driver stuck at a door, holding
 * food, unable to close an order because a document they were never allowed to
 * read did not load. "No code" is recoverable; "cannot deliver" is not.
 */
export function deliveryCodeRequired(input: {
  settings: { deliveryCodePolicy?: string | null } | null | undefined;
  restaurant: { requireDeliveryCode?: boolean } | null | undefined;
}): boolean {
  if (deliveryCodePolicyOf(input.settings ?? {}) === DELIVERY_CODE_POLICY.ALWAYS) return true;
  return input.restaurant?.requireDeliveryCode === true;
}

/**
 * May a restaurant switch codes off for itself?
 *
 * False under ALWAYS, and the settings screen shows the switch locked with the
 * platform's reason rather than hiding it — a control that vanishes reads as a
 * bug, and a control that is disabled and explained reads as a policy.
 */
export function restaurantMayDisableCodes(settings: {
  deliveryCodePolicy?: string | null;
}): boolean {
  return deliveryCodePolicyOf(settings) === DELIVERY_CODE_POLICY.RESTAURANT_CHOICE;
}
