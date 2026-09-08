'use client';

/**
 * The paper slip that goes out with the food.
 *
 * A kitchen does not read a screen while it packs a bag, so the whole point of
 * this component is the printed page. Nothing here is meant to be looked at in
 * the browser: the receipt lives in a portal that is `display: none` until the
 * browser is printing.
 *
 * PRINTING ONLY THE RECEIPT
 * -------------------------
 * The slip is rendered through `createPortal` into `document.body`, which is
 * the whole trick. It makes the receipt a *direct child* of `<body>`, so the
 * print rule can be the blunt, reliable one:
 *
 *     body > *:not(.qapinda-print-root) { display: none }
 *
 * Rendering it in place inside the panel would not survive that rule — the
 * receipt's own ancestors would be hidden and take it with them — and the usual
 * `visibility` workaround leaves the panel's layout, scroll containers and
 * fixed bars influencing the printed page. A portal removes the problem instead
 * of fighting it.
 *
 * The styles are plain CSS in a `<style>` tag rather than Tailwind classes,
 * because print is the one medium where the app's screen palette is wrong:
 * ink-500 grey on white is a smudge on a thermal printer. Everything here is
 * black on white and sized in points the way a receipt is.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useLocale, useT, type Translate } from '@/i18n';
import { formatDateTimeIn } from '@/components/panel/status';
import { FulfillmentType, PaymentStatus, type SupportedLocale } from '@/shared/enums';
import { formatMoney } from '@/shared/pricing';
import {
  STATION_KIND,
  slipsFor,
  stationShowsAddress,
  stationShowsPrices,
  type PrintStation,
} from '@/shared/printStations';
import type { Order } from '@/shared/models';
import { formatPhone } from '@/shared/phone';
import { addressDetail } from '@/lib/address';

/**
 * `display:none` on screen; the only thing that ever shows it is the print
 * media query below. The `!important` is not superstition — the panel's own
 * stylesheet is loaded after this tag, and a print run must not be at the mercy
 * of source order.
 */
const PRINT_CSS = `
.qapinda-print-root { display: none; }

@media print {
  body > *:not(.qapinda-print-root) { display: none !important; }

  .qapinda-print-root {
    display: block !important;
    color: #000;
    background: #fff;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 10pt;
    line-height: 1.25;
  }

  /*
   * THE SINGLE BIGGEST REASON A RECEIPT COMES OUT ENORMOUS.
   *
   * With no page size, the browser assumes A4 — so a thermal printer is told to
   * print a 210×297 mm page and dutifully feeds a page of paper for a slip with
   * eight lines on it. Half a metre of blank roll per order, and it looks like
   * the receipt is wrong when the receipt is fine.
   *
   * "size: 80mm auto" says: eighty millimetres wide, and as tall as the content
   * actually is. That is what a roll printer wants, and it is what stops the
   * feed.
   *
   * The margin is small because a thermal head already cannot print to the
   * paper's edge; 10 mm on all sides was throwing away a quarter of the width
   * and adding two centimetres of blank paper top and bottom.
   */
  @page { size: 80mm auto; margin: 3mm 2mm; }

  .qp-slip { max-width: 76mm; margin: 0 auto; }
  .qp-name { margin: 0; font-size: 14pt; font-weight: 700; text-align: center; }

  /* The station's name, under the restaurant's and nearly as large. Three
     slips come off three printers within a second of each other and the person
     collecting them has to tell which is which without reading the items. */
  .qp-station {
    margin: 2mm 0 0;
    text-align: center;
    font-size: 14pt;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .qp-sub { margin: 0.5mm 0 0; text-align: center; font-size: 9pt; }
  .qp-rule { border-top: 1px dashed #000; margin: 1.8mm 0; }
  .qp-row { display: flex; justify-content: space-between; gap: 4mm; }
  .qp-row > span:last-child { text-align: right; }
  .qp-strong { font-weight: 700; }
  .qp-heading { margin: 0 0 1mm; font-size: 10pt; font-weight: 700; text-transform: uppercase; }
  .qp-items { list-style: none; margin: 0; padding: 0; }
  .qp-item { display: flex; justify-content: space-between; gap: 3mm; margin-bottom: 1.2mm; }
  .qp-item-detail { display: block; padding-left: 4mm; font-size: 9pt; }
  .qp-total { font-size: 12pt; font-weight: 700; }
  .qp-box { border: 1px solid #000; padding: 1.5mm 2mm; margin-top: 2mm; }
  .qp-foot { margin: 2.5mm 0 0; text-align: center; font-size: 8pt; line-height: 1.2; }

  /* A slip that breaks across two pages is a slip somebody staples. */
  .qp-slip, .qp-item { break-inside: avoid; page-break-inside: avoid; }
}
`;

function formatWhen(
  value: { toMillis?: () => number } | null | undefined,
  locale: SupportedLocale,
): string {
  const millis = value?.toMillis?.();
  if (millis === undefined) return '';
  return formatDateTimeIn(millis, locale);
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="qp-row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** The slip itself. Exported so the markup can be read on its own terms. */
export function Receipt({
  order,
  t,
  locale,
  printedAt,
  station,
  only,
}: {
  order: Order;
  t: Translate;
  locale: SupportedLocale;
  /**
   * When the print was asked for, in milliseconds. Passed in rather than read
   * from the clock here: a render must produce the same slip every time it
   * runs, and `Date.now()` during render would quietly change the paper.
   */
  printedAt: number;
  /**
   * Which slip this is.
   *
   * Absent means the whole receipt, which is what this component printed before
   * stations existed and what a restaurant that has configured nothing still
   * gets.
   */
  station?: PrintStation;
  /**
   * Exactly the lines that belong on this slip.
   *
   * Passed in rather than worked out here, because the routing rules interact —
   * an item claimed by no station has to land somewhere, and only `slipsFor`
   * can see all the stations at once. See its note.
   */
  only?: Order['items'];
}) {
  const delivery = order.fulfillment === FulfillmentType.DELIVERY;
  const detail = addressDetail(order.address, t);

  /*
   * WHAT THIS PARTICULAR SLIP CARRIES.
   *
   * A kitchen ticket has no prices on it. Money is noise to a cook, and a slip
   * with the total on it is a slip that ends up in a customer's bag. It also
   * carries only the items routed to this station: a grill cook reading past
   * four lines of drinks at the busiest moment of the evening is a grill cook
   * who misses the fifth.
   */
  const kind = station?.kind ?? STATION_KIND.COUNTER;
  const showPrices = stationShowsPrices(kind);
  /**
   * Is the person who opens the door somebody other than the person who ordered?
   *
   * Compared on digits alone, because the two fields are formatted by different
   * code paths and `+994 55 222 22 22` versus `+994552222222` is not a
   * difference anybody wants printed. A name that differs counts too: the same
   * number can belong to a household where the order says to ask for the son.
   */
  const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');
  const doorDiffers =
    Boolean(order.address) &&
    ((Boolean(order.address?.phone) &&
      digits(order.address?.phone) !== digits(order.customerPhone)) ||
      (Boolean(order.address?.contactName) &&
        order.address?.contactName?.trim() !== order.customerName?.trim()));

  const showAddress = stationShowsAddress(kind);
  const items = only ?? order.items;

  /**
   * Has the money already changed hands, before the door?
   *
   * Only PAID counts. An online order still PENDING at the bank, or one that
   * FAILED, owes exactly what it always did — and a slip that called it paid
   * would be the platform telling a courier to hand over food for nothing.
   */
  const paidUpFront = order.paymentStatus === PaymentStatus.PAID;

  return (
    <article className="qp-slip">
      <h1 className="qp-name">{order.restaurantName}</h1>
      {/* The station's name, big, at the top. Three slips come off three
          printers within a second of each other and somebody has to be able to
          tell at a glance which one they are holding. */}
      {station && <p className="qp-station">{station.name}</p>}
      {showPrices && order.restaurantPhone && (
        <p className="qp-sub">{formatPhone(order.restaurantPhone)}</p>
      )}

      <div className="qp-rule" />

      <Line label={t('receipt.orderCode')} value={<span className="qp-strong">{order.code}</span>} />
      <Line label={t('receipt.placedAt')} value={formatWhen(order.placedAt, locale)} />

      <div className="qp-rule" />

      {showAddress && <Line label={t('receipt.customer')} value={order.customerName} />}
      <Line label={t('receipt.phone')} value={formatPhone(order.customerPhone)} />

      {showAddress && delivery && order.address ? (
        <>
          <Line label={t('receipt.address')} value={order.address.line} />
          {/* The flat, the floor, the block. Printed in bold and directly under
              the street, because this is the line the driver reads while
              standing in a stairwell — and because it was missing from this
              ticket entirely while the courier app had it. */}
          {detail && (
            <Line
              label={t('receipt.addressDetail')}
              value={<span className="qp-strong">{detail}</span>}
            />
          )}
          {/*
            WHO OPENS THE DOOR, AND WHICH NUMBER RINGS.
            
            Printed under the address rather than beside the customer's name,
            because that is where a driver looks. On most orders it is the same
            person as the account holder above; on the ones where it is not, the
            kitchen ringing the account holder is exactly the failure this line
            exists to prevent — the person who ordered is at work in another
            district and cannot open the door.
          */}
          {/*
            PRINTED ONLY WHEN IT IS SOMEBODY ELSE.

            On most orders the door contact IS the account holder, so this block
            reprinted the name and the number that are already two lines above
            it — the same telephone number twice on a slip the kitchen reads at
            a glance. Repetition on a receipt is worse than absence: it makes
            the reader check whether the two are different, every time, on every
            order, when they almost never are.

            So the comparison is on the digits, not the formatting: `+994 55 222
            22 22` and `+994552222222` are one number, and a receipt that thinks
            otherwise is back to printing it twice.
          */}
          {doorDiffers && (
            <>
              {order.address.contactName && (
                <Line
                  label={t('receipt.doorName')}
                  value={<span className="qp-strong">{order.address.contactName}</span>}
                />
              )}
              {order.address.phone && (
                <Line
                  label={t('receipt.doorPhone')}
                  value={<span className="qp-strong">{formatPhone(order.address.phone)}</span>}
                />
              )}
            </>
          )}
          {order.address.note && <Line label={t('receipt.addressNote')} value={order.address.note} />}
        </>
      ) : showAddress ? (
        <Line label={t('receipt.fulfillment')} value={t('receipt.pickup')} />
      ) : null}

      <div className="qp-rule" />

      <h2 className="qp-heading">{t('receipt.items')}</h2>
      <ul className="qp-items">
        {items.map((item, index) => (
          <li key={`${item.productId}-${index}`} className="qp-item">
            <span>
              <span className="qp-strong">{item.quantity}×</span> {item.name}
              {item.modifiers.length > 0 && (
                <span className="qp-item-detail">
                  {item.modifiers.map((modifier) => modifier.optionName).join(' · ')}
                </span>
              )}
              {item.note && <span className="qp-item-detail">— {item.note}</span>}
            </span>
            {showPrices ? (
              <span>{formatMoney(item.lineTotal)}</span>
            ) : null}
          </li>
        ))}
      </ul>

      {/* Every line about money, together, and absent entirely on a kitchen
          ticket. See `stationShowsPrices`. */}
      {showPrices && (
        <>
          <div className="qp-rule" />

          <Line label={t('cart.subtotal')} value={formatMoney(order.pricing.subtotal)} />
          <Line label={t('cart.deliveryFee')} value={formatMoney(order.pricing.deliveryFee)} />
          {order.pricing.discount > 0 && (
            <Line
              label={
                order.coupon ? `${t('cart.discount')} (${order.coupon.code})` : t('cart.discount')
              }
              value={`−${formatMoney(order.pricing.discount)}`}
            />
          )}

          <div className="qp-rule" />

          <div className="qp-row qp-total">
            <span>{t('cart.total')}</span>
            <span>{formatMoney(order.pricing.total)}</span>
          </div>

          <Line label={t('receipt.payment')} value={t(`checkout.${order.paymentMethod}`)} />
        </>
      )}

      {order.customerNote && (
        <>
          <div className="qp-rule" />
          <h2 className="qp-heading">{t('receipt.orderNote')}</h2>
          <p style={{ margin: 0 }}>{order.customerNote}</p>
        </>
      )}

      {/* Boxed rather than run into the totals: this is the one line the person
          holding the bag has to act on, and it is about money changing hands. */}
      {showPrices && (
        <div className="qp-box">
          <div className="qp-row qp-strong">
            <span>{t('receipt.amountDue')}</span>
            {/*
              ZERO WHEN IT HAS ALREADY BEEN PAID.

              This printed the order's total whatever the payment method, so an
              order paid online by card handed the courier a slip saying
              "Ödəniləcək: 25 ₼". The driver then either asks a customer to pay
              twice — which is the single worst thing a delivery can do to a
              platform's name — or works out for themselves that the slip is
              wrong, which is only slightly better.

              `paidUpFront` is read from the order's own payment status rather
              than from the method, because an online order that never came back
              from the bank is not paid and its slip must still say so.
            */}
            <span>{paidUpFront ? t('receipt.paidOnline') : formatMoney(order.pricing.total)}</span>
          </div>
        </div>
      )}

      {/* One line, not two. Two centred footers on an eighty-millimetre roll is
          four lines of paper for one sentence and a timestamp. */}
      <p className="qp-foot">
        {t('receipt.footer')} ·{' '}
        {t('receipt.printedAt', { at: formatWhen({ toMillis: () => printedAt }, locale) })}
      </p>
    </article>
  );
}

/**
 * Hand an order to the printers.
 *
 * WHAT A BROWSER CAN AND CANNOT DO, SAID ONCE
 * -------------------------------------------
 * It cannot choose the printer. `window.print()` hands the page to the
 * operating system and the operating system picks. There is no web API for
 * "send this to the grill printer", and there is not going to be one.
 *
 * What this does instead is print the slips ONE AT A TIME, in order, waiting
 * for each to finish before starting the next. Two things then become possible:
 *
 *   • With Chrome in `--kiosk-printing`, each print goes silently to that
 *     window's default printer. One Chrome profile per station, each with its
 *     own default printer and its own station set to auto-print, and three
 *     slips land on three machines with nobody pressing anything.
 *   • Without it, the person gets three dialogues in a row and picks a printer
 *     for each — which is slower, but is still three slips instead of one.
 *
 * WHY THE JOBS ARE A QUEUE AND NOT A LOOP
 * ---------------------------------------
 * `window.print()` is synchronous-ish and modal, and calling it twice in a row
 * either loses the second job or prints the first slip twice. So the queue
 * advances on `afterprint` — the browser telling us the previous one is done —
 * and each slip is mounted alone, because the printer prints what is in the
 * DOM and two slips in the tree is two slips on the paper.
 *
 * EMPTY STATIONS ARE SKIPPED
 * --------------------------
 * A bar station on an order with no drinks would otherwise produce a blank
 * ticket, and a stack of blank tickets is how a real one gets thrown away with
 * them.
 */
export function useReceiptPrinter(): {
  /** Print every station that has something on it. */
  print: (order: Order, stations?: PrintStation[]) => void;
  portal: ReactNode;
} {
  const t = useT();
  const { locale } = useLocale();

  /**
   * The slips still to print, and the one on the paper now.
   *
   * `at` is stamped once for the whole batch so three slips off one order carry
   * the same printed-at time — three times a second apart on one order reads as
   * three separate prints when somebody is comparing tickets later.
   */
  const [queue, setQueue] = useState<{
    order: Order;
    at: number;
    slips: Array<{ station?: PrintStation; items?: Order['items'] }>;
  } | null>(null);

  const current = queue?.slips[0];

  useEffect(() => {
    if (!queue) return;

    /*
     * Advance on `afterprint`, not on a timer.
     *
     * The browser fires it when the preview is closed or the job is sent, which
     * is the only reliable signal that the DOM is free for the next slip. A
     * timeout here would be a guess, and a guess that is too short prints the
     * next station's items onto the previous station's paper.
     */
    const done = () => {
      setQueue((live) => {
        if (!live) return null;
        const rest = live.slips.slice(1);
        return rest.length > 0 ? { ...live, slips: rest } : null;
      });
    };

    window.addEventListener('afterprint', done);

    // Two frames: one for React to commit the slip, one for the browser to lay
    // it out. Printing before layout produces an empty sheet.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => window.print());
    });

    return () => {
      window.removeEventListener('afterprint', done);
      cancelAnimationFrame(frame);
    };
    /*
     * The whole queue, on purpose.
     *
     * `done` replaces it with a new object holding one fewer slip, so a new
     * identity IS the signal to print the next one — this effect re-running is
     * the mechanism, not an accident. The last slip sets it to null, the
     * cleanup runs, and nothing re-runs.
     */
  }, [queue]);

  const print = useCallback((order: Order, stations?: PrintStation[]) => {
    /*
     * `slipsFor` decides everything: which items go on which slip, where an
     * item no station claimed ends up, and which slips would have come out
     * blank. One function, so the three rules cannot be combined wrongly here.
     */
    const resolved = slipsFor(order.items, stations ?? []);

    setQueue({
      order,
      at: Date.now(),
      // Nothing configured — or nothing to print — means the single whole
      // receipt this component printed before any of this existed.
      slips: resolved.length > 0 ? resolved : [{}],
    });
  }, []);

  const portal = queue
    ? createPortal(
        <div className="qapinda-print-root" aria-hidden>
          {/* Inside the root on purpose: a <style> applies wherever it sits in
              the document, and keeping it here means the print rules arrive
              and leave with the slip instead of leaking into the panel. */}
          <style>{PRINT_CSS}</style>
          <Receipt
            // Keyed so React replaces the slip rather than patching one station's
            // items into another station's paper.
            key={current?.station?.id ?? 'whole'}
            order={queue.order}
            t={t}
            locale={locale}
            printedAt={queue.at}
            station={current?.station}
            only={current?.items}
          />
        </div>,
        document.body,
      )
    : null;

  return { print, portal };
}
