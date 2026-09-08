'use client';

/**
 * The complaints filed against this restaurant.
 *
 * Read-only on purpose. A restaurant that could close its own complaint would
 * be marking its own homework, so the decision — and the only money that moves,
 * the commission — stays with the platform.
 *
 * What the restaurant *can* do is the thing that actually helps: phone the
 * customer. Payment happens at the door, so whatever is put right is put right
 * between those two people; the call button is therefore the loudest control on
 * the screen rather than a detail buried in the drawer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Phone } from 'lucide-react';

import { PanelShell } from '@/components/layout/PanelShell';
import {
  DataTable,
  Drawer,
  Field,
  PageHeader,
  SearchInput,
  StatusBadge,
  Tabs,
  Toolbar,
  type Column,
} from '@/components/panel/ui';
import { when } from '@/components/panel/status';
import { Alert, Card } from '@/components/ui';
import { useT } from '@/i18n';
import { listComplaints } from '@/firebase/callables';
import { ComplaintStatus } from '@/shared/enums';
import type { StatusTone } from '@/components/panel/ui';
import { SecureImage } from '@/components/ui/Img';

/**
 * `listComplaints` answers over the callable wire, so its timestamps arrive as
 * plain JSON: the admin SDK serialises a Timestamp as `_seconds`, never as an
 * object with `toMillis()`.
 */
interface WireTimestamp {
  _seconds?: number;
  seconds?: number;
}

interface ComplaintRow {
  orderId: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  reason: string;
  detail: string | null;
  photoUrls: string[];
  status: string;
  resolution: string | null;
  createdAt: WireTimestamp | null;
  resolvedAt: WireTimestamp | null;
}

type Tab = 'OPEN' | 'RESOLVED' | 'ALL';

/** Seconds on the wire, millis in the formatter — one place to bridge the two. */
const wireWhen = (value: WireTimestamp | null | undefined): string => {
  const seconds = value?._seconds ?? value?.seconds;
  return seconds === undefined ? '' : when({ toMillis: () => seconds * 1000 });
};

function complaintTone(status: string): StatusTone {
  switch (status) {
    case ComplaintStatus.OPEN:
      // Amber, because it is waiting on a person rather than on a process.
      return 'warning';
    case ComplaintStatus.RESOLVED_CREDITED:
      return 'success';
    default:
      return 'neutral';
  }
}

export default function RestaurantComplaintsPage() {
  const t = useT();

  const [complaints, setComplaints] = useState<ComplaintRow[] | null>(null);
  const [tab, setTab] = useState<Tab>('OPEN');
  const [term, setTerm] = useState('');
  const [detail, setDetail] = useState<ComplaintRow | null>(null);

  const reload = useCallback(async () => {
    const result = await listComplaints();
    setComplaints(
      result.ok && result.data ? (result.data.complaints as unknown as ComplaintRow[]) : [],
    );
  }, []);

  useEffect(() => {
    // The state update happens after an `await`, so nothing is set synchronously
    // during this effect; the rule cannot see past the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const counts = useMemo(
    () => ({
      OPEN: (complaints ?? []).filter((entry) => entry.status === ComplaintStatus.OPEN).length,
    }),
    [complaints],
  );

  const rows = useMemo(() => {
    if (!complaints) return null;
    const needle = term.trim().toLowerCase();

    return complaints
      .filter((entry) =>
        tab === 'ALL'
          ? true
          : tab === 'OPEN'
            ? entry.status === ComplaintStatus.OPEN
            : entry.status !== ComplaintStatus.OPEN,
      )
      .filter(
        (entry) =>
          !needle ||
          entry.orderCode.toLowerCase().includes(needle) ||
          entry.customerName.toLowerCase().includes(needle),
      );
  }, [complaints, tab, term]);

  const columns: Column<ComplaintRow>[] = [
    {
      key: 'order',
      header: t('admin.orderId'),
      width: '110px',
      cell: (entry) => <span className="font-mono font-semibold text-ink-900">{entry.orderCode}</span>,
      sortValue: (entry) => entry.orderCode,
    },
    {
      key: 'reason',
      header: t('complaintPanel.reason'),
      cell: (entry) => (
        <span className="block">
          <span className="block text-ink-900">{t(`complaintReason.${entry.reason}`)}</span>
          <span className="block text-xs text-ink-400">{entry.customerName}</span>
        </span>
      ),
      sortValue: (entry) => entry.reason,
    },
    {
      key: 'filed',
      header: t('complaintPanel.filedAt'),
      align: 'right',
      cell: (entry) => <span className="text-xs text-ink-500">{wireWhen(entry.createdAt)}</span>,
      sortValue: (entry) => entry.createdAt?._seconds ?? entry.createdAt?.seconds ?? 0,
    },
    {
      key: 'status',
      header: t('admin.status'),
      cell: (entry) => (
        <StatusBadge tone={complaintTone(entry.status)}>
          {t(`complaintStatus.${entry.status}`)}
        </StatusBadge>
      ),
      sortValue: (entry) => entry.status,
    },
  ];

  return (
    <PanelShell kind="restaurant">
      <PageHeader
        title={t('nav.complaints')}
        subtitle={t('complaintPanel.restaurantSubtitle')}
      />

      <Alert tone="info">{t('complaintPanel.readOnly')}</Alert>

      <div className="mt-4">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          counts={counts}
          options={[
            { value: 'OPEN', label: t('complaintStatus.OPEN') },
            { value: 'RESOLVED', label: t('complaintPanel.tabResolved') },
            { value: 'ALL', label: t('common.all') },
          ]}
        />
      </div>

      <Toolbar>
        <SearchInput value={term} onChange={setTerm} />
      </Toolbar>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(entry) => entry.orderId}
        onRowClick={setDetail}
        emptyTitle={t('complaintPanel.none')}
      />

      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? t(`complaintReason.${detail.reason}`) : ''}
        subtitle={detail ? `${detail.orderCode} · ${wireWhen(detail.createdAt)}` : undefined}
        footer={
          detail?.customerPhone ? (
            // An anchor rather than a button: `tel:` is a link, and on a desktop
            // the owner can still copy it out of the context menu.
            <a
              href={`tel:${detail.customerPhone}`}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-[15px] font-medium text-white transition hover:bg-brand-700"
            >
              <Phone size={16} /> {t('complaintPanel.call')}
            </a>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-4">
            <StatusBadge tone={complaintTone(detail.status)}>
              {t(`complaintStatus.${detail.status}`)}
            </StatusBadge>

            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold text-ink-900">
                {t('complaintPanel.detail')}
              </h3>
              <p className="whitespace-pre-line text-sm text-ink-700">
                {detail.detail || t('complaintPanel.noDetail')}
              </p>
            </Card>

            {detail.photoUrls.length > 0 && (
              <Card className="p-4">
                <h3 className="mb-2 text-sm font-semibold text-ink-900">
                  {t('complaintPanel.photos')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {detail.photoUrls.map((url) => (
                    // Opens the original in a new tab — this is evidence, not a
                    // gallery, so a lightbox would only get in the way. The
                    // link is made by `SecureImage` and points at the blob it
                    // fetched, so the new tab shows our own origin rather than
                    // Google's bucket and a permanent public token.
                    <SecureImage
                      key={url}
                      src={url}
                      alt=""
                      className="h-20 w-20 rounded-xl border border-ink-200 object-cover"
                    />
                  ))}
                </div>
              </Card>
            )}

            <Card className="px-4 py-2">
              <Field label={t('admin.customer')}>{detail.customerName}</Field>
              <Field label={t('auth.phone')}>
                <a
                  href={`tel:${detail.customerPhone}`}
                  className="inline-flex items-center gap-1.5 text-brand-600 underline"
                >
                  <Phone size={13} /> {detail.customerPhone}
                </a>
              </Field>
              <Field label={t('admin.orderId')}>
                <span className="font-mono">{detail.orderCode}</span>
              </Field>
            </Card>

            {detail.resolution && (
              <Card className="p-4">
                <h3 className="mb-2 text-sm font-semibold text-ink-900">
                  {t('complaintPanel.resolution')}
                </h3>
                <p className="whitespace-pre-line text-sm text-ink-700">{detail.resolution}</p>
                <p className="mt-1 text-xs text-ink-400">{wireWhen(detail.resolvedAt)}</p>
              </Card>
            )}

            <p className="text-xs text-ink-400">{t('complaintPanel.readOnly')}</p>
          </div>
        )}
      </Drawer>
    </PanelShell>
  );
}
