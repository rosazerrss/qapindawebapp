/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Tez-tez verilən suallar.
 *
 * WHY THE LIST OF QUESTIONS IS HERE AND THE ANSWERS ARE NOT
 * ---------------------------------------------------------
 * What a customer is told about cancelling an order, who delivers it, and when
 * money comes back is a description of how this system actually behaves — it is
 * the same subject as `shared/orderState.ts` and `shared/geo.ts`, written for
 * somebody who does not read code. Keeping the SHAPE of it here means the
 * screen cannot quietly drop a question, the three dictionaries can be checked
 * against one list rather than against each other, and adding a question is one
 * edit plus three sentences instead of a hunt through a component.
 *
 * The answers themselves are translations, like every other user-visible
 * string: `faq.q.<id>.q` and `faq.q.<id>.a`, in az, en and ru.
 *
 * THE ONE THING THIS FILE MUST NOT DO IS FLATTER
 * ----------------------------------------------
 * Every answer below describes what the code does, including the parts a
 * customer would rather were otherwise: Qapında runs no couriers of its own, an
 * order can only be cancelled in the first three minutes and only before the
 * restaurant accepts it, an address with no pin cannot order at all, and the
 * app no longer sends any notification about the progress of an order. A FAQ
 * that promises more than the system delivers turns into a support queue.
 *
 * WHICH MEANS IT HAS TO BE RE-READ WHEN THE SYSTEM CHANGES
 * -------------------------------------------------------
 * The answers here drifted once already — they described notifications that had
 * been removed and a payment page that had gained an option — and a wrong FAQ
 * is worse than a missing one, because somebody acts on it. Anything changed in
 * `orderState.ts`, `geo.ts`, `payments.ts` or `notifications.ts` is a reason to
 * read this file again.
 */

export interface FaqGroup {
  /** Translated at `faq.group.<id>`. */
  id: string;
  /** Each translated at `faq.q.<id>.q` and `faq.q.<id>.a`. */
  questions: string[];
}

/**
 * The groups, in the order somebody meets them.
 *
 * Ordering first because that is what a new customer is doing; account last
 * because that is what they come back for. Nothing is longer than six
 * questions — a group somebody has to scroll is a group nobody reads.
 */
export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: 'ordering',
    questions: [
      'howToOrder',
      'minimumOrder',
      'trackOrder',
      // Added when the order-status notifications were removed. It is the first
      // thing a returning customer notices and the first thing they will ask,
      // and an unanswered "why did my phone stop telling me anything" is read
      // as the app being broken.
      'noStatusNotifications',
      'orderTime',
      'changeOrder',
    ],
  },
  {
    id: 'payment',
    questions: ['paymentMethods', 'cardAtDoor', 'onlineCard', 'receipt'],
  },
  {
    id: 'delivery',
    questions: ['whoDelivers', 'deliveryFee', 'deliveryRadius', 'courierContact', 'notHome'],
  },
  {
    id: 'coupons',
    questions: ['howCoupons', 'couponNotWorking', 'couponPerOrder'],
  },
  {
    id: 'cancelRefund',
    questions: ['cancelOrder', 'restaurantRejected', 'refundTime', 'somethingWrong'],
  },
  {
    id: 'contact',
    questions: ['contactRestaurant', 'contactSupport', 'complaint'],
  },
  {
    id: 'addresses',
    questions: ['addPin', 'whyPin', 'addressPhone', 'editAddress'],
  },
  {
    id: 'account',
    questions: ['oneAccount', 'changePhone', 'deleteAccount', 'notificationsOff'],
  },
];

/** Every question id, flat. What a search box filters and a test iterates. */
export function faqQuestionIds(): string[] {
  return FAQ_GROUPS.flatMap((group) => group.questions);
}

/** The translation keys one question owns. Written once, read by both sides. */
export function faqKeys(id: string): { question: string; answer: string } {
  return { question: `faq.q.${id}.q`, answer: `faq.q.${id}.a` };
}

/**
 * Whether a question matches what somebody typed.
 *
 * Case- and diacritic-insensitive, because "sifariş" typed on a phone keyboard
 * in a hurry is "sifaris" as often as not, and a search that finds nothing is
 * read as "there is no answer to this" rather than as "you missed an ə".
 */
export function faqMatches(term: string, question: string, answer: string): boolean {
  const needle = foldForSearch(term);
  if (!needle) return true;
  return foldForSearch(question).includes(needle) || foldForSearch(answer).includes(needle);
}

/** Lowercase, strip accents, collapse the Azerbaijani letters to their bases. */
function foldForSearch(value: string): string {
  return value
    .toLocaleLowerCase('az')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .trim();
}
