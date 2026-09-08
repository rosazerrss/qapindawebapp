'use client';

/**
 * Where the courier is going.
 *
 * A written address is not directions. "Nizami küç. 12, 3-cü mərtəbə" is enough
 * for somebody who already knows the street and useless to anybody who does
 * not, and a courier standing on a corner at nine in the evening is usually the
 * second kind. The customer already dropped a pin when they saved the address;
 * this is that pin, shown back to the person who has to drive to it.
 *
 * Read-only on purpose — nothing here can move the marker. Where the customer
 * said their home is is not a courier's to correct, and a dragged pin would
 * silently disagree with the address the order was priced against.
 *
 * The map only mounts when the courier asks for it. Leaflet plus a screen of
 * OpenStreetMap tiles is a real download, couriers are on mobile data in the
 * street, and most deliveries are to an address the driver recognises from the
 * text alone. So the default is a button, not a map.
 *
 * Google Maps when a browser key is configured, OpenStreetMap through Leaflet
 * when it is not — the same choice `DeliveryMap` makes, and made the same way,
 * so a courier and a restaurant are never looking at two different maps of the
 * same city. If Google will not load — refused key, spent quota, lapsed billing
 * — this falls through to OpenStreetMap rather than showing a driver a grey
 * box in the street.
 *
 * THE ONE THING THAT WORKS THE SAME EITHER WAY
 * --------------------------------------------
 * The "open in navigation" link below the map. It is a plain Google Maps URL,
 * it costs nothing, it needs no key, and it hands the coordinates to whatever
 * app the driver already has. That link — not the map — is what actually gets
 * the food to the door.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import { Map as MapIcon, Navigation } from 'lucide-react';

import { cn } from '@/components/ui';
import { useT } from '@/i18n';
import { hasGoogleMaps, loadGoogleMaps } from '@/lib/googleMaps';

/** Close enough to see the building, far enough to see which corner it is on. */
const ZOOM = 17;

export function DestinationMap({
  lat,
  lng,
  /** Shown in the marker's tooltip so the pin and the words stay tied together. */
  label,
  className,
}: {
  lat: number;
  lng: number;
  label?: string | null;
  className?: string;
}) {
  const t = useT();
  const containerId = useId().replace(/:/g, '');
  const leafletRef = useRef<LeafletMap | null>(null);
  const googleMarkerRef = useRef<google.maps.Marker | null>(null);

  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    /**
     * OpenStreetMap. Both the no-key path and the Google-refused path end here.
     *
     * Leaflet is imported on demand rather than at the top of the file: it
     * touches `window` as it initialises, which is fatal during server
     * rendering, and a courier who never opens a map should never pay for the
     * bytes.
     */
    const drawLeaflet = async (container: HTMLElement) => {
      const leaflet = await import('leaflet');
      if (cancelled || leafletRef.current) return;

      const map = leaflet.map(container, {
        center: [lat, lng],
        zoom: ZOOM,
        // One less thing to do by accident while holding a phone and a bag.
        scrollWheelZoom: false,
      });
      leafletRef.current = map;

      leaflet
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
          maxZoom: 19,
        })
        .addTo(map);

      const marker = leaflet.marker([lat, lng]).addTo(map);
      if (label) marker.bindTooltip(label);

      // Leaflet measures its container when it is created. Inside a card that
      // has only just been revealed that measurement can be of a box with no
      // height yet, which paints grey tiles over half the map.
      window.setTimeout(() => map.invalidateSize(), 0);
    };

    void (async () => {
      const container = document.getElementById(containerId);
      if (!container) return;

      if (hasGoogleMaps()) {
        const maps = await loadGoogleMaps();
        if (cancelled) return;

        if (maps) {
          const map = new maps.Map(container, {
            center: { lat, lng },
            zoom: ZOOM,
            // A courier is holding a phone in one hand. One finger has to pan.
            gestureHandling: 'greedy',
            clickableIcons: false,
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
          });

          const marker = new maps.Marker({ position: { lat, lng }, map });
          if (label) marker.setTitle(label);
          googleMarkerRef.current = marker;
          return;
        }
        // Google would not load. Fall through — a driver in the street gets a
        // map, not an explanation.
      }

      await drawLeaflet(container);
    })();

    return () => {
      cancelled = true;
      leafletRef.current?.remove();
      leafletRef.current = null;
      googleMarkerRef.current?.setMap(null);
      googleMarkerRef.current = null;
    };
  }, [open, containerId, lat, lng, label]);

  return (
    <div className={cn('mt-3', className)}>
      {open ? (
        <>
          <div
            id={containerId}
            role="img"
            aria-label={t('kuryer.mapLabel')}
            className="h-64 w-full overflow-hidden rounded-2xl border border-ink-200"
          />

          {/* Looking at the pin is not the same as getting there. This hands
              the coordinates to whatever navigation app the driver already
              uses, which will always route better than we can. */}
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex h-13 w-full items-center justify-center gap-2 rounded-2xl border border-ink-200 text-base font-medium text-ink-800 transition hover:bg-ink-50"
          >
            <Navigation size={18} aria-hidden />
            {t('kuryer.navigate')}
          </a>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl border border-ink-200 text-base font-medium text-ink-800 transition hover:bg-ink-50"
        >
          <MapIcon size={18} aria-hidden />
          {t('kuryer.showMap')}
        </button>
      )}
    </div>
  );
}
