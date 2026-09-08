'use client';

/**
 * The delivery map, drawn with OpenStreetMap.
 *
 * THIS IS NOT A DEGRADED MODE
 * --------------------------
 * It is the map this platform ran on until Google Maps was added, and it is
 * kept complete rather than kept around. It is what draws when there is no
 * Google key, and — more importantly — what draws when there IS one and it
 * stops working: a lapsed billing account, a quota hit, a referrer restriction
 * that no longer matches a new domain. Those all happen, and they happen at the
 * weekend. The answer to every one of them is a working map, not a grey box.
 *
 * No API key, no quota, no bill that starts arriving once the app gets popular.
 *
 * The pin is draggable and the circle follows it, so "my delivery area" is
 * something a restaurant owner can *see* rather than a number they guess at.
 * The same circle is what the server later measures a customer's address
 * against, so what is drawn here is exactly what will be enforced.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { Circle, Map as LeafletMap, Marker } from 'leaflet';

import { useT } from '@/i18n';
import { cn } from '@/components/ui';
import { regionById } from '@/shared/regions';

import type { DeliveryMapProps, MapPoint } from './types';

export function LeafletDeliveryMap({
  value,
  radiusMeters,
  regionId,
  onChange,
  className,
  mapClassName,
  focus,
  hint,
}: DeliveryMapProps) {
  const t = useT();
  const containerId = useId().replace(/:/g, '');
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const circleRef = useRef<Circle | null>(null);
  const onChangeRef = useRef(onChange);

  // Kept current in an effect, not during render: writing a ref while
  // rendering is a side effect, and React may render more than once.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [ready, setReady] = useState(false);

  // Leaflet touches `window` on import, so it can only load in the browser.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const L = await import('leaflet');
      if (cancelled) return;

      const element = document.getElementById(containerId);
      if (!element || mapRef.current) return;

      const region = regionById(regionId);
      const start = value ?? { lat: region?.lat ?? 40.4093, lng: region?.lng ?? 49.8671 };

      const map = L.map(element, { attributionControl: true }).setView(
        [start.lat, start.lng],
        value ? 15 : 12,
      );

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);

      // The default marker images are resolved relative to the CSS file, which
      // a bundler rewrites — a plain divIcon avoids the broken-image problem
      // entirely and matches the brand besides.
      const icon = L.divIcon({
        className: '',
        html:
          '<div style="width:22px;height:22px;border-radius:50%;background:#b4321f;' +
          'border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const marker = L.marker([start.lat, start.lng], { draggable: true, icon }).addTo(map);
      const circle = L.circle([start.lat, start.lng], {
        radius: radiusMeters,
        color: '#b4321f',
        weight: 2,
        fillColor: '#b4321f',
        fillOpacity: 0.12,
      }).addTo(map);

      const move = (point: MapPoint) => {
        marker.setLatLng([point.lat, point.lng]);
        circle.setLatLng([point.lat, point.lng]);
        onChangeRef.current(point);
      };

      marker.on('dragend', () => {
        const position = marker.getLatLng();
        move({ lat: position.lat, lng: position.lng });
      });

      // Tapping the map is faster than dragging on a phone.
      map.on('click', (event) => move({ lat: event.latlng.lat, lng: event.latlng.lng }));

      mapRef.current = map;
      markerRef.current = marker;
      circleRef.current = circle;
      setReady(true);

      // The container is often laid out after the map is built (inside a sheet
      // or a tab), leaving grey tiles until Leaflet is told to re-measure.
      setTimeout(() => map.invalidateSize(), 200);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // Built once. Later prop changes are applied by the effects below, because
    // rebuilding the map would throw away the user's pan and zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId]);

  // The radius slider moves the circle, not the map.
  useEffect(() => {
    circleRef.current?.setRadius(radiusMeters);
  }, [radiusMeters]);

  /*
   * A programmatic move: geolocation, or a chosen search result.
   *
   * The applied value is remembered in a ref so that re-rendering for any other
   * reason cannot drag the pin back to where "use my location" last put it —
   * which would be the map undoing the adjustment the person just made by hand.
   */
  const appliedFocus = useRef<string | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !focus) return;

    const key = `${focus.lat},${focus.lng}`;
    if (appliedFocus.current === key) return;
    appliedFocus.current = key;

    marker.setLatLng([focus.lat, focus.lng]);
    circleRef.current?.setLatLng([focus.lat, focus.lng]);
    map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 17));
    onChangeRef.current(focus);
  }, [focus, ready]);

  // Changing the city recentres, unless a pin has already been placed.
  useEffect(() => {
    if (!mapRef.current || value) return;
    const region = regionById(regionId);
    if (region) mapRef.current.setView([region.lat, region.lng], 12);
  }, [regionId, value]);

  return (
    <div className={cn('space-y-2', className)}>
      <div
        id={containerId}
        className={cn(
          'w-full overflow-hidden rounded-2xl border border-ink-200 bg-ink-100',
          mapClassName ?? 'h-64',
        )}
        role="application"
        aria-label={t('map.label')}
      />
      <p className="text-sm text-ink-400">
        {ready ? (hint ?? t('map.hint')) : t('common.loading')}
        {value && (
          <span className="ml-1 tabular-nums text-ink-500">
            ({value.lat.toFixed(5)}, {value.lng.toFixed(5)})
          </span>
        )}
      </p>
    </div>
  );
}
