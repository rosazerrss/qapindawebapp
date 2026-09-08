'use client';

/**
 * The panel's own building blocks.
 *
 * The customer app and the panels want different things from a component: the
 * customer app wants big touch targets and warmth, a panel wants density,
 * scanability and a table that behaves the same on every screen. So the panel
 * has its own small kit rather than bending the customer one.
 *
 * Everything here is deliberately unstyled beyond the shared tokens — dark ink,
 * off-white canvas, white cards, one brick-red accent used for *action*, never
 * for decoration.
 */

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Search,
  X,
} from 'lucide-react';

import { Button, Card, Spinner, cn } from '@/components/ui';
import {
  DIALOG_ENTRANCE,
  DIALOG_GUTTER,
  DIALOG_SCRIM,
  DIALOG_SURFACE,
  DRAWER_ENTRANCE,
  useDialogChrome,
} from '@/components/ui/overlay';
import { useT } from '@/i18n';

// ---------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
  backHref,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /**
   * Where "← Geri" goes, on the screens that are a step inside another one.
   *
   * Absent on a top-level panel screen, which the sidebar already gets you out
   * of; present on anything reached from one — a settings sub-page, say — where
   * the sidebar's own entry is still highlighted and offers no way back up.
   * A fixed href rather than `router.back()` on purpose: a panel screen is
   * often arrived at from a link in a notification, and "back" would then leave
   * the panel entirely.
   */
  backHref?: string;
}) {
  const t = useT();

  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-1">
        {backHref && (
          // 44px square: the minimum a thumb can be asked to hit, and the panel
          // is used on tablets in kitchens as much as on desktops.
          <Link
            href={backHref}
            aria-label={t('common.back')}
            className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-100 active:bg-ink-200"
          >
            <ArrowLeft size={19} aria-hidden />
          </Link>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The one row above a table: search on the left, filters after it. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const t = useT();

  return (
    <div className={cn('relative min-w-56 flex-1 sm:max-w-xs', className)}>
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? t('common.search')}
        aria-label={placeholder ?? t('common.search')}
        className="h-10 w-full rounded-lg border border-ink-200 bg-white pl-9 pr-8 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="×"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-800"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** A compact labelled dropdown for the toolbar — not a form field. */
export function FilterSelect({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="h-10 appearance-none rounded-lg border border-ink-200 bg-white pl-3 pr-8 text-sm text-ink-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      >
        {children}
      </select>
      <ChevronDown
        size={15}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400"
      />
    </div>
  );
}

/** Horizontal tabs. One is always selected; there is no "none". */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  counts,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string }>;
  counts?: Partial<Record<T, number>>;
}) {
  return (
    <div className="no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b border-ink-200">
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative shrink-0 px-3.5 py-2.5 text-sm transition',
              active
                ? 'font-medium text-ink-900 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-600'
                : 'text-ink-500 hover:text-ink-800',
            )}
          >
            {option.label}
            {counts?.[option.value] !== undefined && (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
                  active ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-500',
                )}
              >
                {counts[option.value]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

const STATUS_TONES: Record<StatusTone, string> = {
  neutral: 'bg-ink-100 text-ink-600 ring-ink-200',
  info: 'bg-blue-50 text-info ring-blue-200',
  // Blue for the same reason it is blue in `Badge`: the brand is red, so an
  // order in the kitchen and an order that was cancelled were two shades of one
  // colour. The panels and the customer app must not disagree about this, which
  // is why both read from `orderTone` and both land here.
  progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  success: 'bg-green-50 text-success ring-green-200',
  warning: 'bg-amber-50 text-warning ring-amber-200',
  danger: 'bg-red-50 text-danger ring-red-200',
};

/**
 * A status pill.
 *
 * The dot is not decoration: colour alone must never carry the meaning, so the
 * label is always spelled out beside it and the ring gives a second cue in
 * forced-colours mode.
 */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        STATUS_TONES[tone],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn('block animate-pulse rounded bg-ink-100', className)} aria-hidden />;
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-row-edge">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: columns }).map((__, column) => (
            <Skeleton
              key={column}
              className={cn('h-4 flex-1', column === 0 && 'max-w-32', column > 2 && 'max-w-24')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DataTable
// ---------------------------------------------------------------------------

export interface Column<Row> {
  key: string;
  header: string;
  /** Right-align numbers; left-align words. Nothing centred. */
  align?: 'left' | 'right';
  width?: string;
  cell: (row: Row) => ReactNode;
  /** Return a comparable value to make the column sortable. */
  sortValue?: (row: Row) => string | number;
}

/**
 * One table for the whole panel.
 *
 * It owns sorting and paging so that no screen invents its own, and it renders
 * its own loading, empty and error states — a table that shows nothing without
 * saying why is the most common unfinished-looking thing in an admin panel.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  loading,
  error,
  emptyTitle,
  emptyHint,
  onRowClick,
  pageSize: initialPageSize = 25,
  footer,
}: {
  rows: Row[] | null;
  columns: Array<Column<Row>>;
  rowKey: (row: Row) => string;
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyHint?: string;
  onRowClick?: (row: Row) => void;
  pageSize?: number;
  footer?: ReactNode;
}) {
  const t = useT();
  const [sort, setSort] = useState<{ key: string; direction: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const sorted = useMemo(() => {
    if (!rows) return null;
    if (!sort) return rows;

    const column = columns.find((entry) => entry.key === sort.key);
    if (!column?.sortValue) return rows;

    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * sort.direction;
      return String(left).localeCompare(String(right)) * sort.direction;
    });
  }, [rows, sort, columns]);

  // A filter change can leave the viewer on a page that no longer exists.
  const pageCount = Math.max(1, Math.ceil((sorted?.length ?? 0) / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted?.slice(current * pageSize, current * pageSize + pageSize) ?? null;

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          {/* A header that is a different SURFACE, not merely bolder text —
              and a 2px rule under it, so the eye finds the top of the data
              without reading anything. */}
          <thead className="border-b-2 border-card-edge bg-subtle">
            <tr>
              {columns.map((column) => {
                const sortable = Boolean(column.sortValue);
                const active = sort?.key === column.key;

                return (
                  <th
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      'whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-500',
                      column.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {sortable ? (
                      <button
                        onClick={() =>
                          setSort((entry) =>
                            entry?.key === column.key
                              ? { key: column.key, direction: entry.direction === 1 ? -1 : 1 }
                              : { key: column.key, direction: 1 },
                          )
                        }
                        className={cn(
                          'inline-flex items-center gap-1 hover:text-ink-800',
                          active && 'text-ink-900',
                        )}
                      >
                        {column.header}
                        {active ? (
                          sort?.direction === 1 ? (
                            <ChevronUp size={13} />
                          ) : (
                            <ChevronDown size={13} />
                          )
                        ) : (
                          <ChevronDown size={13} className="opacity-25" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          {visible && visible.length > 0 && (
            // Rows separated by a line that is actually visible: `ink-100`
            // against white was a rule nobody could see, which is how a table
            // came to read as one block of text.
            <tbody className="divide-y divide-row-edge">
              {visible.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'transition hover:bg-subtle',
                    onRowClick && 'cursor-pointer',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-4 py-3.5 align-middle text-ink-800',
                        column.align === 'right' && 'text-right tabular-nums',
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>

      {loading || rows === null ? (
        <TableSkeleton columns={columns.length} />
      ) : error ? (
        <div className="px-4 py-12 text-center">
          <p className="font-medium text-danger">{error}</p>
        </div>
      ) : visible && visible.length === 0 ? (
        <div className="px-4 py-14 text-center">
          <p className="font-medium text-ink-700">{emptyTitle ?? t('common.empty')}</p>
          {emptyHint && <p className="mt-1 text-sm text-ink-400">{emptyHint}</p>}
        </div>
      ) : null}

      {footer}

      {sorted && sorted.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-card-edge bg-subtle px-4 py-3 text-sm text-ink-500">
          <div className="flex items-center gap-2">
            <span>{t('table.perPage')}</span>
            <FilterSelect
              value={String(pageSize)}
              onChange={(next) => {
                setPageSize(Number(next));
                setPage(0);
              }}
              label={t('table.perPage')}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </FilterSelect>
          </div>

          <div className="flex items-center gap-3">
            <span className="tabular-nums">
              {current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} /{' '}
              {sorted.length}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(current - 1)}
                disabled={current === 0}
                aria-label={t('table.previous')}
                className="rounded-lg border border-ink-200 p-1.5 text-ink-600 transition hover:bg-ink-50 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setPage(current + 1)}
                disabled={current >= pageCount - 1}
                aria-label={t('table.next')}
                className="rounded-lg border border-ink-200 p-1.5 text-ink-600 transition hover:bg-ink-50 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ConfirmDialog
// ---------------------------------------------------------------------------

/**
 * The stop before something irreversible.
 *
 * It states what will happen rather than asking "are you sure" — a person who
 * is about to suspend the wrong restaurant is sure; what they need is to read
 * the restaurant's name one more time.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = 'danger',
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra fields — a reason box, a rate. Often mandatory. */
  children?: ReactNode;
}) {
  const t = useT();
  const surface = useDialogChrome<HTMLDivElement>(open, onCancel);
  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[55] flex items-end justify-center sm:items-center',
        DIALOG_GUTTER,
      )}
    >
      <button
        aria-label={t('common.close')}
        tabIndex={-1}
        onClick={onCancel}
        className={DIALOG_SCRIM}
      />

      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          // Scrolls inside itself rather than pushing the page: several of
          // these carry a reason box and a form, and on a laptop in landscape
          // the confirm button used to end up below the fold.
          'relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-dialog p-5',
          DIALOG_SURFACE,
          DIALOG_ENTRANCE,
        )}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-ink-600">{body}</p>

        {children && <div className="mt-4 space-y-3">{children}</div>}

        <div className="mt-6 flex justify-end gap-2">
          {/* "Bağla", not "Ləğv et".
              
              Half the dialogs in this panel confirm an action that is itself a
              cancellation — cancelling an order, cancelling a payout — and with
              `common.cancel` on the dismiss button both buttons read "Ləğv et".
              A person about to cancel a customer's order should never have to
              work out which "Ləğv et" cancels the order and which one closes
              the box. */}
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t('common.close')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer — a side panel for detail without leaving the list.
// ---------------------------------------------------------------------------

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();
  const surface = useDialogChrome<HTMLElement>(open, onClose);
  if (!open) return null;

  return (
    <div className={cn('fixed inset-0 z-[55] flex justify-end', DIALOG_GUTTER)}>
      <button
        aria-label={t('common.close')}
        tabIndex={-1}
        onClick={onClose}
        className={DIALOG_SCRIM}
      />

      <aside
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        // Inset from every edge, so the drawer is a panel lying on top of the
        // list rather than a second half of the same page. It used to paint
        // itself `bg-canvas` — the page's own colour — which is precisely the
        // "both of them are white" the owner kept reporting; the panel colour
        // now comes from `DIALOG_SURFACE` alone.
        className={cn(
          'relative flex h-full w-full max-w-xl flex-col overflow-hidden rounded-dialog',
          DIALOG_SURFACE,
          DRAWER_ENTRANCE,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-ink-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ink-900">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-ink-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="shrink-0 flex h-11 w-11 items-center justify-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-800"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && <div className="border-t border-ink-200 px-5 py-4">{footer}</div>}
      </aside>
    </div>
  );
}

/** Label/value pair, the way every detail panel shows a field. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="shrink-0 text-sm text-ink-500">{label}</span>
      <span className="min-w-0 text-right text-sm text-ink-900">{children}</span>
    </div>
  );
}

export function InlineSpinner() {
  return <Spinner className="h-4 w-4 text-ink-400" />;
}
