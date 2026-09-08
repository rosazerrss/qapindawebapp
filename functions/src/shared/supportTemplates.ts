/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Support message templates.
 *
 * Two different problems, one mechanism.
 *
 * THE PLATFORM SIDE: THE SAME SENTENCE, TWENTY TIMES A DAY
 * -------------------------------------------------------
 * An operator answers the same handful of situations all shift — the order is
 * late, an item is missing, the restaurant has been rung, the money is on its
 * way back. Retyping those is where the typos and the curt half-sentences come
 * from. So the composer offers them as a picker, and picking one *drops the
 * sentence into the draft*. It never sends: the operator reads it, edits it,
 * adds the thing that makes it about this person, and presses send themselves.
 * A canned answer that posted itself would be a robot wearing the platform's
 * name, and the whole point of support is that a person answered.
 *
 * Templates carrying a fact — the order code, the amount — interpolate it from
 * the ticket. `availableTemplates` drops the ones whose facts are not known
 * rather than offering a sentence with a hole in it: on a ticket with no order
 * attached, "which order is this about?" is the template that belongs anyway.
 *
 * THE PARTY SIDE: AN EMPTY BOX IS A BAD QUESTION
 * ----------------------------------------------
 * Somebody whose food has not arrived should not have to compose a support
 * ticket from nothing. They pick what is wrong and the message is written for
 * them, still fully editable. The chosen template also sets the subject, which
 * is what an operator reads in the queue before opening anything — a list of
 * tickets all called "Problem" is a list you have to open one by one.
 *
 * The two lists differ because the two sides have different problems. A
 * customer's list is about their order; a restaurant's is about the platform,
 * the courier and the money.
 *
 * NO TEXT LIVES HERE
 * ------------------
 * Only keys. Every sentence is in `az.json`, `en.json` and `ru.json` under
 * `supportTemplateOperator`, `supportTemplateCustomer` /
 * `supportSubjectCustomer` and `supportTemplateRestaurant` /
 * `supportSubjectRestaurant`, so support speaks the language the person chose.
 */

/** A fact a template needs before it can be offered. */
export type SupportTemplateFact = 'code' | 'restaurant' | 'amount';

/**
 * WHY THE OPERATOR'S LIST IS GROUPED.
 *
 * Twelve sentences fit in a row of chips. Fifty do not — and fifty is what it
 * takes to actually cover what a restaurant and a customer raise, which was the
 * brief: an answer ready for anything. An ungrouped list of fifty is slower to
 * use than typing, which would make the whole feature worse than nothing.
 *
 * So they are grouped by the situation an operator is in, and the groups are
 * named for what is happening rather than for a part of the system: somebody
 * on a shift thinks "this order is late", not "order lifecycle".
 */
export const SupportTemplateGroup = {
  /** Opening, acknowledging, asking for what is missing. */
  OPENING: 'OPENING',
  /** The food: late, wrong, missing, cold, never came. */
  ORDER: 'ORDER',
  /** The road: the courier, the address, a failed delivery. */
  DELIVERY: 'DELIVERY',
  /** Money going out and coming in. */
  PAYMENT: 'PAYMENT',
  /** The restaurant's own business: commission, invoices, payouts. */
  BUSINESS: 'BUSINESS',
  /** The panel, the menu, accounts, things that will not work. */
  TECHNICAL: 'TECHNICAL',
  /** A complaint decided, and what was given. */
  RESOLUTION: 'RESOLUTION',
  /** Waiting, handing over, and finishing. */
  CLOSING: 'CLOSING',
} as const;
export type SupportTemplateGroup =
  (typeof SupportTemplateGroup)[keyof typeof SupportTemplateGroup];

export interface SupportTemplate {
  /** The dictionary key, inside whichever namespace the list belongs to. */
  key: string;
  /** Facts the sentence interpolates. Absent means it needs nothing. */
  facts?: readonly SupportTemplateFact[];
  /** Which heading it sits under. Only the operator's list is grouped. */
  group?: SupportTemplateGroup;
}

/**
 * What the ticket knows, for filling a template in.
 *
 * All three are nullable because all three are genuinely often unknown: a
 * ticket raised from the help screen has no order, and a customer's ticket
 * about an order the platform never charged for has no amount.
 */
export interface SupportTemplateFacts {
  code: string | null;
  restaurant: string | null;
  amount: string | null;
}

/**
 * The operator's and admin's quick replies, in the order a shift uses them.
 *
 * The same list serves both: an admin answering an escalated ticket is doing
 * the operator's job on a harder ticket, and giving them a second, subtly
 * different set of sentences would only mean the platform sounds like two
 * different companies depending on who picked the ticket up.
 */
export const OPERATOR_TEMPLATES: readonly SupportTemplate[] = [
  // --- Opening -------------------------------------------------------- //
  { key: 'greeting', group: 'OPENING' },
  { key: 'acknowledge', group: 'OPENING' },
  { key: 'apology', group: 'OPENING' },
  { key: 'whichOrder', group: 'OPENING' },
  { key: 'needPhoto', group: 'OPENING' },
  { key: 'needDetail', group: 'OPENING' },
  { key: 'confirmUnderstanding', group: 'OPENING' },

  // --- The food ------------------------------------------------------- //
  { key: 'lateOrder', facts: ['code'], group: 'ORDER' },
  { key: 'orderPreparing', facts: ['code'], group: 'ORDER' },
  { key: 'orderOnTheWay', facts: ['code'], group: 'ORDER' },
  { key: 'wrongItem', facts: ['code'], group: 'ORDER' },
  { key: 'missingItem', facts: ['code'], group: 'ORDER' },
  { key: 'qualityIssue', group: 'ORDER' },
  { key: 'coldFood', group: 'ORDER' },
  { key: 'neverArrived', facts: ['code'], group: 'ORDER' },
  { key: 'restaurantContacted', facts: ['restaurant'], group: 'ORDER' },
  { key: 'restaurantNotAnswering', facts: ['restaurant'], group: 'ORDER' },
  { key: 'restaurantRejected', group: 'ORDER' },
  { key: 'restaurantBusy', group: 'ORDER' },
  { key: 'orderCancelled', facts: ['code'], group: 'ORDER' },
  { key: 'cancelWindowClosed', group: 'ORDER' },
  { key: 'resend', group: 'ORDER' },

  // --- The road ------------------------------------------------------- //
  { key: 'courierOnTheWay', group: 'DELIVERY' },
  { key: 'courierDelayed', group: 'DELIVERY' },
  { key: 'courierUnreachable', group: 'DELIVERY' },
  { key: 'addressUnclear', group: 'DELIVERY' },
  { key: 'addressOutOfRange', group: 'DELIVERY' },
  { key: 'customerUnreachable', group: 'DELIVERY' },
  { key: 'deliveryFailed', facts: ['code'], group: 'DELIVERY' },
  { key: 'deliveryCodeHelp', group: 'DELIVERY' },
  { key: 'ownFleetReminder', group: 'DELIVERY' },

  // --- Money ---------------------------------------------------------- //
  { key: 'refundStarted', facts: ['amount'], group: 'PAYMENT' },
  { key: 'refundTiming', group: 'PAYMENT' },
  { key: 'refundDone', facts: ['amount'], group: 'PAYMENT' },
  { key: 'refundNotOwed', group: 'PAYMENT' },
  { key: 'paymentFailed', group: 'PAYMENT' },
  { key: 'doubleCharge', group: 'PAYMENT' },
  { key: 'cashPayment', group: 'PAYMENT' },
  { key: 'onlineNotConfirmed', group: 'PAYMENT' },
  { key: 'couponNotWorking', group: 'PAYMENT' },
  { key: 'priceChanged', group: 'PAYMENT' },

  // --- The restaurant's business -------------------------------------- //
  { key: 'commissionExplained', group: 'BUSINESS' },
  { key: 'commissionChange', group: 'BUSINESS' },
  { key: 'invoiceExplained', group: 'BUSINESS' },
  { key: 'settlementTiming', group: 'BUSINESS' },
  { key: 'payoutDetails', group: 'BUSINESS' },
  { key: 'ledgerMismatch', group: 'BUSINESS' },
  { key: 'contractQuestion', group: 'BUSINESS' },

  // --- The panel and the menu ----------------------------------------- //
  { key: 'menuHelp', group: 'TECHNICAL' },
  { key: 'photoHelp', group: 'TECHNICAL' },
  { key: 'optionsHelp', group: 'TECHNICAL' },
  { key: 'hoursHelp', group: 'TECHNICAL' },
  { key: 'pauseHelp', group: 'TECHNICAL' },
  { key: 'zonesHelp', group: 'TECHNICAL' },
  { key: 'staffAccount', group: 'TECHNICAL' },
  { key: 'courierAccount', group: 'TECHNICAL' },
  { key: 'loginProblem', group: 'TECHNICAL' },
  { key: 'soundProblem', group: 'TECHNICAL' },
  { key: 'appProblem', group: 'TECHNICAL' },

  // --- What was decided ----------------------------------------------- //
  { key: 'complaintUpheld', group: 'RESOLUTION' },
  { key: 'complaintRejected', group: 'RESOLUTION' },
  { key: 'couponGiven', facts: ['amount'], group: 'RESOLUTION' },
  { key: 'commissionWaived', group: 'RESOLUTION' },
  { key: 'commissionKept', group: 'RESOLUTION' },
  { key: 'restaurantWarned', group: 'RESOLUTION' },

  // --- Waiting and finishing ------------------------------------------ //
  { key: 'pleaseWait', group: 'CLOSING' },
  { key: 'checkingWithTeam', group: 'CLOSING' },
  { key: 'escalating', group: 'CLOSING' },
  { key: 'willFollowUp', group: 'CLOSING' },
  { key: 'noResponse', group: 'CLOSING' },
  { key: 'anythingElse', group: 'CLOSING' },
  { key: 'closing', group: 'CLOSING' },
  { key: 'thanksForPatience', group: 'CLOSING' },
];

/** The headings, in the order a shift works through them. */
export const OPERATOR_TEMPLATE_GROUPS: readonly SupportTemplateGroup[] = [
  'OPENING',
  'ORDER',
  'DELIVERY',
  'PAYMENT',
  'BUSINESS',
  'TECHNICAL',
  'RESOLUTION',
  'CLOSING',
];

/** What a customer opens a ticket about. */
export const CUSTOMER_TEMPLATES: readonly SupportTemplate[] = [
  { key: 'notArrived' },
  { key: 'late' },
  { key: 'wrongItem' },
  { key: 'missingItem' },
  { key: 'quality' },
  { key: 'addressNotFound' },
  { key: 'payment' },
  { key: 'refund' },
  { key: 'other' },
];

/** And what a restaurant does. Nothing here is about a customer's dinner. */
export const RESTAURANT_TEMPLATES: readonly SupportTemplate[] = [
  { key: 'customerUnreachable' },
  { key: 'addressProblem' },
  { key: 'courierProblem' },
  { key: 'cancellation' },
  { key: 'payment' },
  { key: 'settlement' },
  { key: 'technical' },
  { key: 'account' },
  { key: 'other' },
];

/** True when every fact this template interpolates is actually known. */
export function templateIsUsable(
  template: SupportTemplate,
  facts: SupportTemplateFacts,
): boolean {
  return (template.facts ?? []).every((fact) => {
    const value = facts[fact];
    return typeof value === 'string' && value.length > 0;
  });
}

/**
 * The templates worth showing for this ticket.
 *
 * An operator offered "the {{code}} order is on its way" on a ticket with no
 * order attached would either send a sentence with a placeholder in it or have
 * to delete it — so it is not offered.
 */
export function availableTemplates(
  templates: readonly SupportTemplate[],
  facts: SupportTemplateFacts,
): SupportTemplate[] {
  return templates.filter((template) => templateIsUsable(template, facts));
}

/**
 * The interpolation parameters for one template.
 *
 * Only the facts the template actually names, so a missing value can never be
 * silently substituted into a sentence that did not ask for it.
 */
export function templateParams(
  template: SupportTemplate,
  facts: SupportTemplateFacts,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const fact of template.facts ?? []) {
    params[fact] = facts[fact] ?? '';
  }
  return params;
}


/**
 * The available templates, kept in their groups.
 *
 * A group whose every sentence needed a fact this ticket does not have is
 * dropped entirely rather than rendered as an empty heading — a "Money"
 * heading with nothing under it is a control that looks broken.
 */
export function groupedTemplates(
  facts: SupportTemplateFacts,
): Array<{ group: SupportTemplateGroup; templates: SupportTemplate[] }> {
  return OPERATOR_TEMPLATE_GROUPS.map((group) => ({
    group,
    templates: availableTemplates(
      OPERATOR_TEMPLATES.filter((template) => template.group === group),
      facts,
    ),
  })).filter((entry) => entry.templates.length > 0);
}
