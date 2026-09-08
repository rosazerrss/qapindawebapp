'use client';

/**
 * QAPINDA — the restaurant's own turnover, on a sheet of paper or in a PDF.
 *
 * WHY THIS IS A PRINT VIEW AND NOT A GENERATED PDF FILE
 * -----------------------------------------------------
 * The obvious build is jsPDF or pdf-lib: a button, some bytes, a download. It
 * was rejected for a reason that has nothing to do with effort.
 *
 * A PDF's built-in fonts are Latin-1. They do not contain Ə, ə, Ş, Ğ, İ, ı, Ö
 * or Ü. A report generated with them reads "Dnr" and "Kabab qzartma" — every
 * Azerbaijani letter silently dropped or replaced, on the document a restaurant
 * takes to its accountant. Fixing that means embedding a Unicode font, which
 * means shipping several hundred kilobytes of base64 typeface to every person
 * who opens the panel, so that a button most of them press once a month can
 * work.
 *
 * The browser already has a PDF writer, it already has the fonts, and it is
 * already the thing that draws every other screen in this panel. "Print → Save
 * as PDF" produces a better-looking document with correct Azerbaijani, no
 * dependency, and no bytes added to the bundle. It also prints to an actual
 * printer, which is what a restaurant owner with a folder of monthly figures
 * usually wants.
 *
 * WHAT IS ON THE SHEET
 * --------------------
 * The same figures as the screen, arranged for paper rather than for scanning:
 * the takings, what the platform charged, what the restaurant is left with,
 * every dish that sold, and the day-by-day column the chart draws.
 *
 * The commission is on it, deliberately. This is the restaurant's own copy of
 * the month, and a summary that showed the money coming in but not the money
 * going out would be the half a dispute starts over.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { useLocale, useT } from '@/i18n';
import { formatDayIn } from '@/components/panel/status';
import { formatMinorUnits } from '@/shared/pricing';
import { watchRestaurant } from '@/services/catalog';

export interface SalesReportData {
  totals: {
    orderCount: number;
    itemsSold: number;
    grossSales: number;
    deliveryFees: number;
    discounts: number;
    commission: number;
    platformCredits: number;
    netToRestaurant: number;
    averageOrder: number;
    acceptanceRate: number | null;
    rejectedCount: number;
    expiredCount: number;
    averageAnswerMinutes: number | null;
    averagePrepMinutes: number | null;
  };
  products: Array<{
    productId: string;
    name: string;
    quantity: number;
    revenue: number;
    orderCount: number;
  }>;
  daily: Array<{ day: string; revenue: number; orders: number }>;
  truncated: boolean;
}

/**
 * Hidden on screen, and the only thing on the page when printing.
 *
 * `!important` is not superstition: the panel's stylesheet loads after this
 * tag, and a printed document must not depend on source order. Same approach as
 * the kitchen slip in `Receipt.tsx`, and for the same reason.
 */
const PRINT_CSS = `
.qapinda-report-root { display: none; }

@media print {
  body > *:not(.qapinda-report-root) { display: none !important; }

  .qapinda-report-root {
    display: block !important;
    color: #000;
    background: #fff;
    /* A system serif for the figures: this is a document that ends up in a
       folder next to invoices, not a screen. */
    font-family: "Times New Roman", Times, Georgia, serif;
    font-size: 10.5pt;
    line-height: 1.45;
  }

  @page { size: A4; margin: 14mm; }

  .qr-head { border-bottom: 2px solid #000; padding-bottom: 3mm; margin-bottom: 5mm; }
  .qr-brand { font-size: 8.5pt; letter-spacing: 1.5px; text-transform: uppercase; }
  .qr-name { margin: 1mm 0 0; font-size: 18pt; font-weight: 700; }
  .qr-range { margin: 1mm 0 0; font-size: 10.5pt; }

  .qr-section { margin: 0 0 6mm; break-inside: avoid; page-break-inside: avoid; }
  .qr-h2 {
    margin: 0 0 2mm;
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    border-bottom: 1px solid #000;
    padding-bottom: 1mm;
  }

  .qr-table { width: 100%; border-collapse: collapse; }
  .qr-table th, .qr-table td { padding: 1.4mm 0; vertical-align: top; }
  .qr-table th { text-align: left; font-weight: 400; }
  .qr-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .qr-rule td { border-top: 1px solid #000; }
  .qr-total td { font-weight: 700; font-size: 12pt; padding-top: 2mm; }

  .qr-grid th { border-bottom: 1px solid #000; font-weight: 700; font-size: 9pt; }
  .qr-grid td { border-bottom: 1px solid #ccc; }

  /* A table that breaks mid-row is a table somebody re-prints. */
  .qr-grid tr { break-inside: avoid; page-break-inside: avoid; }

  .qr-foot {
    margin-top: 8mm;
    padding-top: 2mm;
    border-top: 1px solid #000;
    font-size: 8.5pt;
  }
}
`;

/** "1 sen 2026 — 30 sen 2026". */
function rangeLabel(from: number, to: number, locale: 'az' | 'ru' | 'en'): string {
  return `${formatDayIn(from, locale)} — ${formatDayIn(to, locale)}`;
}

/** `2026-09-01` → `01.09`, which is what a column of dates wants to be. */
function shortIsoDay(day: string): string {
  const parts = day.split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}` : day;
}

export function SalesReportPrint({
  restaurantId,
  report,
  range,
  onPrinted,
}: {
  restaurantId: string | null;
  report: SalesReportData;
  range: { from: number; to: number };
  /** Fired when the browser is finished, so the caller can drop the sheet. */
  onPrinted: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [name, setName] = useState<string | null>(null);
  /*
   * Stamped once, when the sheet is created.
   *
   * `Date.now()` inside the JSX would be a new value on every render, which the
   * lint rule refuses for the right reason: a render must be able to run twice
   * and produce the same thing. A lazy initialiser reads the clock exactly once,
   * which is also what the document wants — one prepared-at time, not the time
   * the last re-render happened.
   */
  const [preparedAt] = useState(() => Date.now());

  // The restaurant's own document — one read, allowed by `ownsRestaurant`. The
  // name is the first thing on the sheet and the panel does not otherwise carry
  // it down this far.
  useEffect(() => {
    if (!restaurantId) return;
    return watchRestaurant(restaurantId, (live) => setName(live?.name ?? null));
  }, [restaurantId]);

  /*
   * Printed after two frames, not immediately.
   *
   * One frame for React to commit this subtree, one for the browser to lay it
   * out. Calling `print()` before layout produces a blank sheet — the same
   * lesson the kitchen slip learned.
   */
  useEffect(() => {
    const done = () => onPrinted();
    window.addEventListener('afterprint', done);

    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => window.print());
    });

    return () => {
      window.removeEventListener('afterprint', done);
      cancelAnimationFrame(frame);
    };
  }, [onPrinted]);

  /*
   * `document.body` is reached without a mounted guard on purpose.
   *
   * This component is only ever rendered in response to a click, so it never
   * exists during server rendering and never during hydration — the usual
   * reasons for the two-pass dance do not apply here, and a guard would only
   * add a render that draws nothing.
   */
  const money = (value: number) => `${formatMinorUnits(value)} ₼`;
  const { totals } = report;

  const sheet = (
    <div className="qapinda-report-root">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="qr-head">
        <div className="qr-brand">Qapında</div>
        <h1 className="qr-name">{name ?? t('sales.title')}</h1>
        <p className="qr-range">
          {t('sales.printPeriod')}: {rangeLabel(range.from, range.to, locale)}
        </p>
      </div>

      <section className="qr-section">
        <h2 className="qr-h2">{t('sales.printSummary')}</h2>
        <table className="qr-table">
          <tbody>
            <tr>
              <th>{t('sales.orderCount')}</th>
              <td className="qr-num">{totals.orderCount}</td>
            </tr>
            <tr>
              <th>{t('sales.itemsSold')}</th>
              <td className="qr-num">{totals.itemsSold}</td>
            </tr>
            <tr>
              <th>{t('sales.averageOrder')}</th>
              <td className="qr-num">{money(totals.averageOrder)}</td>
            </tr>
            <tr>
              <th>{t('sales.grossSales')}</th>
              <td className="qr-num">{money(totals.grossSales)}</td>
            </tr>
            <tr>
              <th>{t('sales.deliveryFees')}</th>
              <td className="qr-num">{money(totals.deliveryFees)}</td>
            </tr>
            <tr>
              <th>{t('sales.discounts')}</th>
              <td className="qr-num">−{money(totals.discounts)}</td>
            </tr>
            <tr>
              <th>{t('sales.commission')}</th>
              <td className="qr-num">−{money(totals.commission)}</td>
            </tr>
            {totals.platformCredits > 0 && (
              <tr>
                <th>{t('sales.platformCredits')}</th>
                <td className="qr-num">+{money(totals.platformCredits)}</td>
              </tr>
            )}
            <tr className="qr-rule qr-total">
              <td>{t('sales.netToRestaurant')}</td>
              <td className="qr-num">{money(totals.netToRestaurant)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="qr-section">
        <h2 className="qr-h2">{t('sales.performance')}</h2>
        <table className="qr-table">
          <tbody>
            <tr>
              <th>{t('sales.acceptanceRate')}</th>
              <td className="qr-num">
                {totals.acceptanceRate === null ? '—' : `${totals.acceptanceRate}%`}
              </td>
            </tr>
            <tr>
              <th>{t('sales.answerTime')}</th>
              <td className="qr-num">
                {totals.averageAnswerMinutes === null
                  ? '—'
                  : t('restaurantPanel.prepMinutes', { count: totals.averageAnswerMinutes })}
              </td>
            </tr>
            <tr>
              <th>{t('sales.prepTime')}</th>
              <td className="qr-num">
                {totals.averagePrepMinutes === null
                  ? '—'
                  : t('restaurantPanel.prepMinutes', { count: totals.averagePrepMinutes })}
              </td>
            </tr>
            <tr>
              <th>{t('sales.printFailed')}</th>
              <td className="qr-num">
                {totals.rejectedCount} / {totals.expiredCount}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {report.products.length > 0 && (
        <section className="qr-section">
          <h2 className="qr-h2">{t('sales.byProduct')}</h2>
          <table className="qr-table qr-grid">
            <thead>
              <tr>
                <th>{t('sales.product')}</th>
                <th className="qr-num">{t('sales.quantity')}</th>
                <th className="qr-num">{t('sales.inOrders')}</th>
                <th className="qr-num">{t('sales.revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {report.products.map((line) => (
                <tr key={line.productId}>
                  <td>{line.name}</td>
                  <td className="qr-num">{line.quantity}</td>
                  <td className="qr-num">{line.orderCount}</td>
                  <td className="qr-num">{money(line.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {report.daily.length > 0 && (
        <section className="qr-section">
          <h2 className="qr-h2">{t('sales.dailyRevenue')}</h2>
          <table className="qr-table qr-grid">
            <thead>
              <tr>
                <th>{t('sales.printDay')}</th>
                <th className="qr-num">{t('sales.orderCount')}</th>
                <th className="qr-num">{t('sales.revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {report.daily.map((entry) => (
                <tr key={entry.day}>
                  <td>{shortIsoDay(entry.day)}</td>
                  <td className="qr-num">{entry.orders}</td>
                  <td className="qr-num">{money(entry.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="qr-foot">
        {/* Said on the paper, because a sheet outlives the screen that made it
            and somebody will read it without knowing where it came from. The
            truncation warning in particular must travel with the document: a
            report that quietly covers only part of a month is worse than one
            that says so. */}
        {t('sales.printFooter', { at: formatDayIn(preparedAt, locale) })}
        {report.truncated ? ` ${t('sales.truncated')}` : ''}
      </p>
    </div>
  );

  return createPortal(sheet, document.body);
}
