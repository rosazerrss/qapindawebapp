/**
 * One place that decides what colour a state is.
 *
 * Two screens showing the same order in different colours is the fastest way to
 * make people distrust a panel. Every status badge in the panel gets its tone
 * from here.
 *
 * The tones follow meaning, not mood: grey = nothing to do yet, red-brand =
 * moving, green = finished well, red = finished badly, amber = needs a person.
 */

import {
  AccountStatus,
  OrderStatus,
  PaymentStatus,
  RestaurantStatus,
  SupportTicketStatus,
} from '@/shared/enums';
import type { SupportedLocale } from '@/shared/enums';
import { PaymentState } from '@/shared/payments';
import type { StatusTone } from './ui';

export function orderTone(status: string): StatusTone {
  switch (status) {
    case OrderStatus.COMPLETED:
    case OrderStatus.DELIVERED:
      return 'success';
    case OrderStatus.PLACED:
      // Someone must accept this, and a clock is running.
      return 'warning';
    case OrderStatus.ACCEPTED:
    case OrderStatus.PREPARING:
    case OrderStatus.READY:
    case OrderStatus.OUT_FOR_DELIVERY:
      return 'progress';
    case OrderStatus.REJECTED:
    case OrderStatus.CANCELLED:
    case OrderStatus.EXPIRED:
    // The courier went and came back. Red, like the other unhappy endings —
    // but it is its own status everywhere else, because it means something
    // different about what went wrong.
    case OrderStatus.DELIVERY_FAILED:
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * The same six tones, expressed in the `Badge` component's smaller vocabulary.
 *
 * `Badge` is what the customer app and the courier app use; `StatusBadge` is
 * what the panels use. They must not drift, so the mapping lives here beside
 * `orderTone` rather than being written out again in each app — that copy is
 * how a cancelled order came to be red in the panel and grey on a phone.
 */
export type BadgeTone = 'neutral' | 'brand' | 'progress' | 'success' | 'warning' | 'danger';

const BADGE_TONE: Record<StatusTone, BadgeTone> = {
  neutral: 'neutral',
  info: 'neutral',
  progress: 'progress',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export function toBadgeTone(tone: StatusTone): BadgeTone {
  return BADGE_TONE[tone];
}

/** An order's badge tone, for every screen that renders a `Badge`. */
export function orderBadgeTone(status: string): BadgeTone {
  return BADGE_TONE[orderTone(status)];
}

/**
 * The coloured edge down the left of an order block.
 *
 * "Each order must read as its own block, with its status obvious at a glance
 * by colour as well as by word." A pill carries the colour but it is small and
 * it is read, not seen; a four-pixel stripe down the whole card is what makes a
 * cancelled order findable in a list of forty from the other side of a counter.
 *
 * It never replaces the label — the word is always on the card too, because
 * colour alone is unreadable to a good number of the people using this.
 *
 * The class names are written out in full rather than composed, because
 * Tailwind reads this file as text and a name it cannot see is a name it does
 * not generate.
 */
const TONE_ACCENT: Record<StatusTone, string> = {
  neutral: 'border-l-ink-300',
  info: 'border-l-blue-400',
  // Blue, not a lighter red. `--color-danger` is the same red as brand-600, so
  // every shade of the brand puts "being cooked" and "cancelled" in one family;
  // a lighter step was tried and from two metres they were still the same
  // stripe. The distance has to be in the hue, not the lightness.
  progress: 'border-l-blue-500',
  success: 'border-l-success',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
};

export function orderAccentClass(status: string): string {
  return `border-l-4 ${TONE_ACCENT[orderTone(status)]}`;
}

export function paymentTone(status: string): StatusTone {
  switch (status) {
    case PaymentStatus.COLLECTED:
    case PaymentStatus.PAID:
      return 'success';
    case PaymentStatus.NOT_COLLECTED:
    case PaymentStatus.FAILED:
      return 'danger';
    case PaymentStatus.REFUNDED:
    case PaymentStatus.REFUND_PENDING:
      return 'warning';
    default:
      // Cash at the door before delivery is not a problem — it is the norm.
      return 'neutral';
  }
}

/**
 * Tone for a `Payment`'s own state — distinct from `paymentTone`, which reads
 * the coarser status stored on the order. A failed or expired attempt is not
 * an error in this screen; it is exactly the kind of row an operator opens
 * this page to look at, so it gets a colour that says "look here", not
 * "something broke".
 */
export function paymentStateTone(state: string): StatusTone {
  switch (state) {
    case PaymentState.PAID:
      return 'success';
    case PaymentState.FAILED:
      return 'danger';
    case PaymentState.CREATED:
    case PaymentState.PENDING:
      return 'neutral';
    case PaymentState.CANCELLED:
      return 'neutral';
    case PaymentState.EXPIRED:
    case PaymentState.REFUND_PENDING:
    case PaymentState.REFUNDED:
    case PaymentState.PARTIALLY_REFUNDED:
      return 'warning';
    default:
      return 'neutral';
  }
}

export function restaurantTone(status: string): StatusTone {
  switch (status) {
    case RestaurantStatus.ACTIVE:
      return 'success';
    case RestaurantStatus.PENDING_APPROVAL:
      return 'warning';
    case RestaurantStatus.SUSPENDED:
    case RestaurantStatus.REJECTED:
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * A support ticket's tone.
 *
 * Follows the same grammar as the others: amber for the one that needs a
 * person to pick it up, brand for work in progress, grey for a ball that is in
 * somebody else's court, green for answered, and neutral for finished — a
 * closed ticket is not a failure and must not read as one.
 */
export function supportTone(status: string): StatusTone {
  switch (status) {
    case SupportTicketStatus.OPEN:
      return 'warning';
    case SupportTicketStatus.IN_PROGRESS:
      return 'progress';
    case SupportTicketStatus.WAITING_FOR_CUSTOMER:
      return 'info';
    case SupportTicketStatus.RESOLVED:
      return 'success';
    default:
      return 'neutral';
  }
}

export function userTone(status: string): StatusTone {
  switch (status) {
    case AccountStatus.ACTIVE:
      return 'success';
    case AccountStatus.REVIEW_REQUIRED:
    case AccountStatus.DELETION_REQUESTED:
      return 'warning';
    case AccountStatus.SUSPENDED:
    case AccountStatus.BANNED:
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * Deterministic date/time formatting.
 *
 * `toLocaleString('az-AZ', { month: 'short' })` depends on the device's ICU
 * data, and plenty of Android/embedded builds do not ship an Azerbaijani month
 * table — the "short month" comes back as the literal string "M08" instead of
 * a name. These tables sidestep the platform entirely, so a date renders the
 * same way on every device and browser.
 */
const MONTHS: Record<SupportedLocale, string[]> = {
  az: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'],
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * "26 avq 2026", or "26 avq" when `dropCurrentYear` is set and the date falls
 * in the current year — almost everything shown in these panels is recent, so
 * the year is usually noise.
 */
function formatDate(millis: number, locale: SupportedLocale, dropCurrentYear: boolean): string {
  const date = new Date(millis);
  const day = date.getDate();
  const month = MONTHS[locale][date.getMonth()];
  const year = date.getFullYear();
  if (dropCurrentYear && year === new Date().getFullYear()) return `${day} ${month}`;
  return `${day} ${month} ${year}`;
}

/** "05:18", 24-hour, zero-padded. */
function formatTime(millis: number): string {
  const date = new Date(millis);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** `TimestampLike` → "26 avq, 05:18" (or "26 avq 2026, 05:18" for a past year). */
export function when(value: { toMillis?: () => number } | null | undefined): string {
  const millis = value?.toMillis?.();
  if (millis === undefined) return '';
  return `${formatDate(millis, 'az', true)}, ${formatTime(millis)}`;
}

/** `TimestampLike` → "26 avq" (or "26 avq 2026" for a past year). Date only, no time. */
export function whenDate(value: { toMillis?: () => number } | null | undefined): string {
  const millis = value?.toMillis?.();
  if (millis === undefined) return '';
  return formatDate(millis, 'az', true);
}

/**
 * `TimestampLike` → "26 avq 2026". The year is always kept.
 *
 * For a deadline — a coupon's last day, a settlement due date — dropping the
 * year to save four characters is the one place it actually costs something:
 * "26 avq" read in January is a date somebody has to work out, and the whole
 * point of the line is that they should not have to.
 */
export function whenDeadline(value: { toMillis?: () => number } | null | undefined): string {
  const millis = value?.toMillis?.();
  if (millis === undefined) return '';
  return formatDate(millis, 'az', false);
}

/** `TimestampLike` → "05:18". Time only, no date. */
export function whenTime(value: { toMillis?: () => number } | null | undefined): string {
  const millis = value?.toMillis?.();
  if (millis === undefined) return '';
  return formatTime(millis);
}

/**
 * For screens that render in the customer's chosen locale (az/ru/en) rather
 * than the admin panels' fixed Azerbaijani, and that want the year kept even
 * for the current year — e.g. a printed receipt, which is a record meant to
 * outlive "recent".
 */
export function formatDateTimeIn(millis: number, locale: SupportedLocale): string {
  return `${formatDate(millis, locale, false)}, ${formatTime(millis)}`;
}

/**
 * The day alone — "1 sen 2026" — with the year always kept.
 *
 * For a printed report's heading, where a range is two dates side by side and
 * the time of day is noise, but the year is the thing that makes the sheet mean
 * something when it is found in a folder next year.
 */
export function formatDayIn(millis: number, locale: SupportedLocale): string {
  return formatDate(millis, locale, false);
}

/**
 * The full moment, for the audit log: "26 avq 2026, 05:18:42".
 *
 * Everywhere else in the panel the year is dropped and seconds are noise. Not
 * here — an audit entry is read months later by somebody reconstructing who did
 * what, and "26 avq" without a year is exactly the ambiguity they cannot afford.
 */
export function whenExact(value: { toMillis?: () => number } | null | undefined): string {
  const millis = value?.toMillis?.();
  if (millis === undefined) return '';

  const date = new Date(millis);
  return `${formatDate(millis, 'az', false)}, ${formatTime(millis)}:${pad2(date.getSeconds())}`;
}
