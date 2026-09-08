'use client';

/**
 * The audit log.
 *
 * Read-only, and deliberately so: there is no callable anywhere in this system
 * that edits or deletes an entry, and the security rules refuse every client
 * write. A super admin's actions appear here exactly like anyone else's — no
 * hidden bypass, which was a stated requirement.
 */

import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { PanelShell } from '@/components/layout/PanelShell';
import {
  DataTable,
  Drawer,
  Field,
  FilterSelect,
  PageHeader,
  SearchInput,
  StatusBadge,
  Toolbar,
  type Column,
} from '@/components/panel/ui';
import { when, whenExact } from '@/components/panel/status';
import { Alert, Card } from '@/components/ui';
import { useT, type Translate } from '@/i18n';
import { formatMinorUnits } from '@/shared/pricing';
import { matches, text } from '@/lib/stored';
import { firestore } from '@/firebase/client';
import { COLLECTIONS } from '@/shared/collections';
import type { AuditLog } from '@/shared/models';

/**
 * Turning a stored value into something a person can read.
 *
 * The old screen printed raw JSON, which is honest but unusable: an operator
 * asking "what changed?" was handed `{"status":"SUSPENDED"}` and left to
 * translate it themselves. So each key becomes a labelled row and each value is
 * translated where a translation exists.
 *
 * The fallback is deliberate and unchanged in spirit: anything this screen does
 * not recognise is still shown, as its raw text. A log that hides the half it
 * did not expect is worse than one that looks untidy.
 */

/** `t()` echoes the key back when there is no translation, which is the test. */
function translated(t: Translate, key: string, fallback: string): string {
  const value = t(key);
  return value === key ? fallback : value;
}

/** Money-ish and percentage keys read as nonsense in raw minor units. */
function formatValue(t: Translate, key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no');

  if (typeof value === 'number') {
    if (/bps$/i.test(key)) return `${(value / 100).toFixed(2)}%`;
    if (/(amount|price|total|subtotal|discount|fee|funding|credit)$/i.test(key)) {
      return `${formatMinorUnits(value)} ₼`;
    }
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : value.map((entry) => String(entry)).join(', ');
  }

  if (typeof value === 'object') return JSON.stringify(value);

  const text = String(value);
  // Enum-shaped strings have translations already — statuses, roles, reasons.
  if (/^[A-Z][A-Z0-9_]+$/.test(text)) {
    /*
     * `order.reason`, not `cancellationReason`.
     *
     * There is no `cancellationReason` namespace in any dictionary and there
     * never was — so a cancellation in the audit log fell through every lookup
     * and printed the raw enum. `order.reason` is where the nine reasons
     * actually live, and `orderActor` is where PLATFORM/RESTAURANT/CUSTOMER do.
     */
    for (const namespace of [
      'status',
      'roles',
      'order.status',
      'order.reason',
      'orderActor',
      'deliveryFailure',
      'admin',
    ]) {
      const label = translated(t, `${namespace}.${text}`, '');
      if (label) return label;
    }
  }
  return text;
}

/**
 * One side of a change, as rows.
 *
 * Shown even when empty: "there was nothing here before" is the answer to most
 * questions asked of this log, and a blank card says it better than a missing one.
 */
function ValueCard({ title, value }: { title: string; value: unknown }) {
  const t = useT();

  const entries =
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : null;

  return (
    <Card className="p-4">
      <p className="mb-2 text-sm text-ink-500">{title}</p>

      {entries === null ? (
        <p className="text-sm text-ink-400">{value === null || value === undefined ? '—' : String(value)}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-ink-400">—</p>
      ) : (
        <dl className="divide-y divide-row-edge">
          {entries.map(([key, entry]) => (
            <div key={key} className="flex gap-3 py-1.5 text-sm">
              <dt className="w-40 shrink-0 text-ink-500">
                {translated(t, `auditField.${key}`, key)}
              </dt>
              <dd className="min-w-0 flex-1 break-words text-ink-900">
                {formatValue(t, key, entry)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

export default function AuditPage() {
  const t = useT();

  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  // An empty audit log and an audit log that could not be read are two very
  // different facts, and this screen is the one place where being told which
  // is which actually matters.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState('ALL');
  const [term, setTerm] = useState('');
  const [detail, setDetail] = useState<AuditLog | null>(null);

  useEffect(() => {
    const db = firestore();
    if (!db) return;

    return onSnapshot(
      query(collection(db, COLLECTIONS.auditLogs), orderBy('at', 'desc'), limit(200)),
      (snapshot) => {
        setLogs(snapshot.docs.map((entry) => entry.data() as AuditLog));
        setLoadError(null);
      },
      () => {
        setLogs([]);
        setLoadError(t('errors.LIST_UNAVAILABLE'));
      },
    );
  }, [t]);

  // The action list is built from what actually arrived rather than from the
  // enum: a filter offering twenty actions that never occur is noise.
  const actions = useMemo(
    () => [...new Set((logs ?? []).map((log) => text(log.action)).filter(Boolean))].sort(),
    [logs],
  );

  const rows = useMemo(() => {
    if (!logs) return null;
    const needle = term.trim().toLowerCase();

    // The oldest entries in this collection predate half the fields below, so
    // every one of them is read defensively: a log that cannot be searched
    // because one 2025 row has no `actorId` is a log nobody can use.
    return logs
      .filter((log) => action === 'ALL' || log.action === action)
      .filter((log) =>
        matches(needle, log.action, log.actorId, log.targetType, log.targetId, log.reason),
      );
  }, [logs, action, term]);

  // Entries written before `id` was stored still need a stable React key, and
  // one actor cannot write two entries in the same millisecond.
  const rowKey = (log: AuditLog) => log.id ?? `${text(log.actorId)}-${log.at?.toMillis?.() ?? 0}`;

  const columns: Column<AuditLog>[] = [
    {
      key: 'when',
      header: t('admin.auditWhen'),
      cell: (log) => <span className="whitespace-nowrap text-ink-600">{when(log.at)}</span>,
      sortValue: (log) => log.at?.toMillis?.() ?? 0,
    },
    {
      key: 'actor',
      header: t('admin.auditActor'),
      cell: (log) => (
        <span className="block">
          <span className="block text-ink-900">
            {log.actorRole ? t(`roles.${log.actorRole}`) : t('common.none')}
          </span>
          <span className="block font-mono text-xs text-ink-400">
            {text(log.actorId).slice(0, 12) || '—'}
          </span>
        </span>
      ),
      sortValue: (log) => `${log.actorRole ?? ''} ${text(log.actorId)}`,
    },
    {
      key: 'action',
      header: t('admin.auditAction'),
      cell: (log) => (
        <StatusBadge tone="progress">
          {translated(t, `auditAction.${log.action}`, log.action)}
        </StatusBadge>
      ),
      sortValue: (log) => text(log.action),
    },
    {
      key: 'target',
      header: t('admin.auditTarget'),
      cell: (log) => (
        <span className="block">
          <span className="block text-ink-800">
            {translated(t, `auditTarget.${log.targetType}`, String(log.targetType))}
          </span>
          <span className="block font-mono text-xs text-ink-400">
            {String(log.targetId).slice(0, 12)}
          </span>
        </span>
      ),
      sortValue: (log) => `${text(log.targetType)} ${text(log.targetId)}`,
    },
    {
      key: 'reason',
      header: t('admin.auditReason'),
      cell: (log) =>
        log.reason ? (
          <span className="line-clamp-2 max-w-xs text-ink-600">{log.reason}</span>
        ) : (
          <span className="text-ink-300">—</span>
        ),
    },
  ];

  return (
    <PanelShell kind="admin">
      <PageHeader title={t('nav.audit')} subtitle={t('admin.auditSubtitle')} />

      <div className="mb-4">
        <Alert tone="info">{t('admin.auditImmutable')}</Alert>
      </div>

      <Toolbar>
        <SearchInput value={term} onChange={setTerm} placeholder={t('admin.auditSearch')} />
        <FilterSelect value={action} onChange={setAction} label={t('admin.auditAction')}>
          <option value="ALL">{t('common.all')}</option>
          {actions.map((option) => (
            <option key={option} value={option}>
              {translated(t, `auditAction.${option}`, option)}
            </option>
          ))}
        </FilterSelect>
      </Toolbar>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={rowKey}
        onRowClick={setDetail}
        error={loadError}
        emptyTitle={t('admin.noAuditEntries')}
        emptyHint={t('admin.noOrdersHint')}
      />

      {/* --- Detail ---------------------------------------------------- */}
      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? translated(t, `auditAction.${detail.action}`, detail.action) : ''}
        subtitle={
          detail
            ? `${translated(t, `auditTarget.${detail.targetType}`, String(detail.targetType))} · ${detail.targetId}`
            : undefined
        }
      >
        {detail && (
          <div className="space-y-4">
            <Card className="px-4 py-2">
              <Field label={t('admin.auditWhen')}>{whenExact(detail.at)}</Field>
              <Field label={t('admin.auditActor')}>
                {detail.actorRole ? t(`roles.${detail.actorRole}`) : t('common.none')}
              </Field>
              <Field label={t('admin.auditActorId')}>
                <span className="font-mono text-xs">{text(detail.actorId) || '—'}</span>
              </Field>
              <Field label={t('admin.auditIp')}>{detail.ip || '—'}</Field>
              {detail.restaurantId && (
                <Field label={t('admin.restaurant')}>
                  <span className="font-mono text-xs">{detail.restaurantId}</span>
                </Field>
              )}
            </Card>

            {detail.reason && (
              <Card className="p-4">
                <p className="mb-1 text-sm text-ink-500">{t('admin.auditReason')}</p>
                <p className="text-sm text-ink-800">{detail.reason}</p>
              </Card>
            )}

            {/* Both sides are shown even when empty: "nothing was there before"
                is itself the answer to most questions asked of this log. */}
            <ValueCard title={t('admin.auditOldValue')} value={detail.oldValue} />
            <ValueCard title={t('admin.auditNewValue')} value={detail.newValue} />
          </div>
        )}
      </Drawer>
    </PanelShell>
  );
}
