'use client';

/**
 * The partner strip that sits above everything else.
 *
 * One red band, one message, nothing else — the way Yemeksepeti runs
 * "YEMEKSEPETİ RESTORANI OL" across the top. A customer's eye slides past a
 * band that never changes; a restaurant owner reads it once and knows where to
 * go.
 *
 * The bag is drawn rather than loaded as an image: a photo of a black icon on
 * white would sit on the red band as a white rectangle, and an SVG takes the
 * band's colour, stays sharp at any size, and costs no request.
 */

import Link from 'next/link';

import { useT } from '@/i18n';

export function DeliveryBagIcon({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden
    >
      {/* The bag body, with its lid seam. */}
      <path
        d="M8 22.5 30.5 12a4 4 0 0 1 3.4 0L56 22.5v25A3.5 3.5 0 0 1 52.5 51h-41A3.5 3.5 0 0 1 8 47.5v-25Z"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path
        d="M8 22.5h48"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      {/* The band across the middle — the mark's signature. */}
      <path d="M8 31h48v9H8z" fill="currentColor" />
      {/* The carry handle. */}
      <path
        d="M22 22.5c0-6 3.5-10.5 8-13"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M28.5 22.5c0-6 3.5-10.5 8-13"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PartnerBar() {
  const t = useT();

  return (
    <div className="bg-brand-700">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-center gap-3 px-4 py-2">
        <DeliveryBagIcon size={26} className="shrink-0 text-white" />

        <Link
          href="/partner"
          className="rounded-lg bg-white px-4 py-1.5 text-xs font-bold tracking-wide text-brand-700 transition hover:bg-brand-50 sm:text-sm"
        >
          {t('partner.barCta')}
        </Link>
      </div>
    </div>
  );
}
