/**
 * Reading a stored document without trusting its shape.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every collection in this system has outlived at least one schema change, and
 * the panels are the only screens that read *all* of a collection rather than
 * one recent document. So the panels are where a document written before a
 * field existed shows up — and TypeScript is no help at all here: `Order` says
 * `pricing.total` is a number because that is what the code writes today, not
 * because the document on disk has one.
 *
 * The failure that follows is not a wrong number in one cell. `order.code
 * .toLowerCase()` inside a filter throws while React is rendering the list, so
 * one malformed document from 2025 takes down the whole screen with
 * "Xəta baş verdi" — which is exactly how the İcmal screen went blank, and why
 * `functions/src/admin/report.ts` sums each row inside its own try.
 *
 * These are the client-side half of that discipline. They are deliberately
 * dull: a missing string reads as empty, a missing number as zero, a missing
 * array as empty. A row with a gap in it renders with a gap in it, and the
 * other four hundred rows still render.
 */

/** A stored string, or '' — never `undefined.toLowerCase()`. */
export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * A stored number, or zero.
 *
 * NaN and Infinity count as missing: they arrive from arithmetic done on a
 * field that was not there, and rendering "NaN ₼" beside a real total is worse
 * than rendering nothing.
 */
export function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A stored array, or an empty one — never `undefined.length`. */
export function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Does this row match what was typed in the search box?
 *
 * Every panel list has the same three-line filter, and every one of them used
 * to call `.toLowerCase()` on a field that a document might not carry. Passing
 * the fields through here says "search these, whatever they turn out to be",
 * which is what the search box actually means.
 *
 * An empty needle matches everything, because an empty search box is not a
 * filter.
 */
export function matches(needle: string, ...fields: unknown[]): boolean {
  const wanted = needle.trim().toLowerCase();
  if (!wanted) return true;

  return fields.some((field) => text(field).toLowerCase().includes(wanted));
}
