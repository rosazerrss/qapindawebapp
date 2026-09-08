/**
 * QAPINDA — the receipt that arrives after the food does.
 *
 * WHY IT IS WORTH SENDING
 * -----------------------
 * The customer already saw the order on the tracking screen and the courier
 * already handed over a printed slip. So this is not "did it arrive" — it is a
 * record: what was ordered, from whom, for how much, on what date. That is what
 * somebody looks for weeks later when they are reconciling a card statement,
 * arguing about a charge, or claiming a meal on expenses, and it is the one
 * thing an app cannot provide once the account is signed out on a lost phone.
 *
 * WHEN IT IS SENT
 * ---------------
 * On COMPLETED, not on DELIVERED. Sixty minutes separate the two, and in that
 * hour a complaint can be filed, a commission waived, a refund started. A
 * receipt emailed at the door and contradicted an hour later is worse than one
 * that arrives late and is right.
 *
 * WHO GETS IT
 * -----------
 * Only an account with a VERIFIED email. Not because the receipt is a secret —
 * it is the customer's own order — but because an unverified address is one a
 * person typed, and a mistyped address belongs to somebody else. That stranger
 * would receive a name, a delivery street and a telephone number.
 *
 * ONCE. `receiptEmailedAt` on the order is the record, checked before sending
 * and written after, so a retried job or a manually re-completed order does not
 * post a second copy of the same receipt.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY
 * -----------------------------------
 * No commission, no settlement, no restaurant's private figures. The customer's
 * receipt shows what the customer paid and nothing about what the platform
 * earned from it — those are two different documents and only one of them is
 * theirs.
 */

import { logger } from 'firebase-functions/v2';

import { db, now } from '../lib/admin';
import { paths } from '../shared/collections';
import { formatMoney } from '../shared/pricing';
import { PaymentMethod } from '../shared/enums';
import type { Order, User } from '../shared/models';

/** Escapes text for HTML. A dish name is user input and reaches an inbox. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PAYMENT_LABEL: Record<string, string> = {
  [PaymentMethod.CASH_ON_DELIVERY]: 'Qapıda nağd',
  [PaymentMethod.CARD_ON_DELIVERY]: 'Qapıda kartla',
  [PaymentMethod.ONLINE_CARD]: 'Onlayn kartla',
};

/** `7 sen 2026, 08:37` — the same shape the printed slip uses, in Baku time. */
function bakuDateTime(ms: number): string {
  const at = new Date(ms + 4 * 60 * 60 * 1000);
  const months = [
    'yan', 'fev', 'mar', 'apr', 'may', 'iyn',
    'iyl', 'avq', 'sen', 'okt', 'noy', 'dek',
  ];
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${at.getUTCDate()} ${months[at.getUTCMonth()]} ${at.getUTCFullYear()}, ` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`
  );
}

function receiptHtml(order: Order): string {
  const lines = order.items
    .map((item) => {
      const modifiers = item.modifiers.length
        ? `<div style="color:#8b817c;font-size:13px;margin-top:2px">${escape(
            item.modifiers.map((modifier) => modifier.optionName).join(', '),
          )}</div>`
        : '';

      return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #ece6e2;vertical-align:top">
            <div style="color:#1f1a18">${item.quantity}× ${escape(item.name)}</div>
            ${modifiers}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #ece6e2;text-align:right;white-space:nowrap;color:#1f1a18">
            ${formatMoney(item.lineTotal, order.pricing.currency)}
          </td>
        </tr>`;
    })
    .join('');

  const discountRow =
    order.pricing.discount > 0
      ? `<tr><td style="padding:3px 0;color:#2e6a4e">Endirim</td>
           <td style="padding:3px 0;text-align:right;color:#2e6a4e">
             −${formatMoney(order.pricing.discount, order.pricing.currency)}
           </td></tr>`
      : '';

  const placedMs = order.placedAt?.toMillis?.() ?? Date.now();

  /*
   * One table, inline styles, no images.
   *
   * Not a design choice — a deliverability one. Every mail client strips a
   * stylesheet, half of them block a remote image until the reader allows it,
   * and a receipt that arrives as an empty frame with a broken picture in it
   * looks like the phishing it will be mistaken for.
   */
  return `<!doctype html>
<html lang="az"><body style="margin:0;background:#f5f3f1;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f1;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px">

        <tr><td style="font-size:13px;color:#877c76;letter-spacing:.08em;text-transform:uppercase">
          Qapında
        </td></tr>

        <tr><td style="padding-top:6px;font-size:22px;font-weight:700;color:#1f1a18">
          ${escape(order.restaurantName)}
        </td></tr>

        <tr><td style="padding-top:4px;color:#5b534f;font-size:14px">
          Sifariş ${escape(order.code)} · ${bakuDateTime(placedMs)}
        </td></tr>

        <tr><td style="padding-top:20px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px">
            ${lines}
          </table>
        </td></tr>

        <tr><td style="padding-top:14px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#5b534f">
            <tr><td style="padding:3px 0">Yeməklər</td>
                <td style="padding:3px 0;text-align:right">
                  ${formatMoney(order.pricing.subtotal, order.pricing.currency)}
                </td></tr>
            <tr><td style="padding:3px 0">Çatdırılma</td>
                <td style="padding:3px 0;text-align:right">
                  ${formatMoney(order.pricing.deliveryFee, order.pricing.currency)}
                </td></tr>
            ${discountRow}
          </table>
        </td></tr>

        <tr><td style="padding-top:12px;border-top:2px solid #1f1a18">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding-top:10px;font-size:17px;font-weight:700;color:#1f1a18">Cəmi</td>
                <td style="padding-top:10px;text-align:right;font-size:17px;font-weight:700;color:#1f1a18">
                  ${formatMoney(order.pricing.total, order.pricing.currency)}
                </td></tr>
            <tr><td style="padding-top:4px;font-size:14px;color:#5b534f">Ödəniş</td>
                <td style="padding-top:4px;text-align:right;font-size:14px;color:#5b534f">
                  ${escape(PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod)}
                </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding-top:24px;font-size:13px;color:#877c76;line-height:1.6">
          Bu, sifarişinizin qeydidir. Sifarişi
          <b>${escape(order.restaurantName)}</b> hazırlayıb və öz kuryeri ilə çatdırıb.
          Qapında sifarişi bir araya gətirən platformadır.
          <br><br>
          Yeməklə bağlı problem varsa, çatdırılmadan sonra 48 saat ərzində
          tətbiqdən şikayət göndərə bilərsiniz.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** The plain-text half. Some clients show it, and every spam filter reads it. */
function receiptText(order: Order): string {
  const placedMs = order.placedAt?.toMillis?.() ?? Date.now();

  return [
    `${order.restaurantName} — sifariş ${order.code}`,
    bakuDateTime(placedMs),
    '',
    ...order.items.map(
      (item) =>
        `${item.quantity}x ${item.name} — ${formatMoney(item.lineTotal, order.pricing.currency)}`,
    ),
    '',
    `Yeməklər: ${formatMoney(order.pricing.subtotal, order.pricing.currency)}`,
    `Çatdırılma: ${formatMoney(order.pricing.deliveryFee, order.pricing.currency)}`,
    ...(order.pricing.discount > 0
      ? [`Endirim: -${formatMoney(order.pricing.discount, order.pricing.currency)}`]
      : []),
    `Cəmi: ${formatMoney(order.pricing.total, order.pricing.currency)}`,
    `Ödəniş: ${PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}`,
    '',
    'Qapında — sifarişi restoran hazırlayır və öz kuryeri ilə çatdırır.',
  ].join('\n');
}

/**
 * Sends the receipt, if there is anywhere to send it and it has not gone yet.
 *
 * Never throws. It is called after an order has already completed and the money
 * has already been accounted for; an unreachable mail provider must not turn a
 * finished order into a failed job that retries the settlement behind it.
 */
export async function sendOrderReceipt(order: Order): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return; // Mail is not configured. Nothing to report.

    if (order.receiptEmailedAt) return;

    const userSnap = await db.doc(paths.user(order.customerId)).get();
    const user = userSnap.data() as User | undefined;

    // A verified address only. An unverified one is a string somebody typed,
    // and a typo belongs to a stranger who would receive this customer's name,
    // street and telephone number.
    if (!user?.email || user.emailVerified !== true) return;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM ?? 'Qapında <onboarding@resend.dev>',
        to: [user.email],
        subject: `Qapında · ${order.restaurantName} · ${order.code}`,
        html: receiptHtml(order),
        text: receiptText(order),
      }),
    });

    if (!response.ok) {
      logger.warn('receipt email refused', {
        orderId: order.id,
        status: response.status,
      });
      return;
    }

    // Written only after a successful send, so a failure is retried by the next
    // completion rather than being remembered as done.
    await db.doc(paths.order(order.id)).update({ receiptEmailedAt: now() });
  } catch (error) {
    logger.warn('receipt email failed', {
      orderId: order.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
