'use client';

/**
 * The delivery map, drawn with Google Maps.
 *
 * Same props, same behaviour, same circle as the OpenStreetMap version beside
 * it — a screen that renders a delivery map does not know which of the two it
 * got, and nothing outside this folder had to change when Google was added.
 *
 * WHY IT STILL FALLS BACK, AT RUNTIME
 * -----------------------------------
 * `hasGoogleMaps()` is answered at BUILD time: it reads an environment
 * variable baked into the bundle. It says a key was configured. It cannot say
 * the key still works — billing lapses, quotas are hit, a referrer restriction
 * stops matching after a domain change, and an API gets switched off in the
 * console by somebody tidying up. All of those produce a loaded page and a
 * refused map.
 *
 * So this component treats a failed load as an ordinary outcome and renders
 * the OpenStreetMap map instead. The restaurant sees a map. Nobody sees a grey
 * box, and nobody has to redeploy to get one back.
 *
 * WHAT IT COSTS TO DRAW
 * ---------------------
 * One Dynamic Maps load per mounted map. That is why the courier's map is
 * behind a button and why the library is loaded lazily rather than from the
 * layout: the home page, the basket and the order list must never bill a map
 * load for a map nobody asked to see.
 */

import { useEffect, useRef, useState } from 'react';

import { useT } from '@/i18n';
import { cn } from '@/components/ui';
import { regionById } from '@/shared/regions';
import { loadGoogleMaps } from '@/lib/googleMaps';

import { LeafletDeliveryMap } from './LeafletDeliveryMap';
import type { DeliveryMapProps, MapPoint } from './types';

/** Qapında red, so the pin and the circle match the rest of the app. */
const BRAND = '#b4321f';

export function GoogleDeliveryMap(props: DeliveryMapProps) {
  const { value, radiusMeters, regionId, onChange, className, mapClassName, focus, hint } = props;

  const t = useT();

  /**
   * The div the map is drawn into, held by ref rather than looked up by id.
   *
   * A `getElementById` that came back null would leave this screen on
   * "Yüklənir…" for ever with nothing said — the same shape of silent failure
   * that made the v33 loader bug so expensive to find. A ref cannot miss.
   */
  const containerRef = useRef<HTMLDivElement | null>(null);

  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const onChangeRef = useRef(onChange);

  // Kept current in an effect, not during render: writing a ref while
  // rendering is a side effect, and React may render more than once.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  /**
   * 'loading' → 'ready', or 'loading' → 'fallback' if Google would not load.
   *
   * Three states rather than a boolean because the third one is a different
   * component, not a different message.
   */
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const maps = await loadGoogleMaps();
      if (cancelled) return;

      if (!maps) {
        setStatus('fallback');
        return;
      }

      const element = containerRef.current;
      if (!element) {
        // Unmounted between the await and here, or something stranger. Either
        // way the fallback draws a map; silence would draw nothing.
        setStatus('fallback');
        return;
      }
      if (mapRef.current) return;

      const region = regionById(regionId);
      const start = value ?? { lat: region?.lat ?? 40.4093, lng: region?.lng ?? 49.8671 };

      const map = new maps.Map(element, {
        center: start,
        zoom: value ? 15 : 12,
        /*
         * `greedy` so one finger pans the map. The default on a touch device
         * asks for two fingers, which is correct for a map embedded in an
         * article and wrong for a map that IS the control somebody is being
         * asked to operate.
         */
        gestureHandling: 'greedy',
        // Tapping a restaurant or a bus stop should move the pin, not open
        // Google's own info window over the top of the form.
        clickableIcons: false,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      });

      const marker = new maps.Marker({
        position: start,
        map,
        draggable: true,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: BRAND,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
      });

      const circle = new maps.Circle({
        map,
        center: start,
        radius: radiusMeters,
        strokeColor: BRAND,
        strokeWeight: 2,
        fillColor: BRAND,
        fillOpacity: 0.12,
        // The circle sits under the pin and must not eat the taps meant for
        // the map beneath it.
        clickable: false,
      });

      const move = (point: MapPoint) => {
        marker.setPosition(point);
        circle.setCenter(point);
        onChangeRef.current(point);
      };

      marker.addListener('dragend', () => {
        const position = marker.getPosition();
        if (position) move({ lat: position.lat(), lng: position.lng() });
      });

      // Tapping the map is faster than dragging on a phone.
      map.addListener('click', (event: google.maps.MapMouseEvent) => {
        if (event.latLng) move({ lat: event.latLng.lat(), lng: event.latLng.lng() });
      });

      mapRef.current = map;
      markerRef.current = marker;
      circleRef.current = circle;
      setStatus('ready');
    })();

    return () => {
      cancelled = true;
      /*
       * Google has no `map.remove()`. Detaching the overlays and dropping the
       * references is the documented way to let one go — the div is React's to
       * unmount, and the map object is collected with it.
       */
      markerRef.current?.setMap(null);
      circleRef.current?.setMap(null);
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // Built once. Later prop changes are applied by the effects below, because
    // rebuilding the map would throw away the user's pan and zoom — and bill a
    // second map load for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    marker.setPosition(focus);
    circleRef.current?.setCenter(focus);
    map.setCenter(focus);
    map.setZoom(Math.max(map.getZoom() ?? 0, 17));
    onChangeRef.current(focus);
  }, [focus, status]);

  // Changing the city recentres, unless a pin has already been placed.
  useEffect(() => {
    if (!mapRef.current || value) return;
    const region = regionById(regionId);
    if (!region) return;
    mapRef.current.setCenter({ lat: region.lat, lng: region.lng });
    mapRef.current.setZoom(12);
  }, [regionId, value]);

  if (status === 'fallback') return <LeafletDeliveryMap {...props} />;

  return (
    <div className={cn('space-y-2', className)}>
      <div
        ref={containerRef}
        className={cn(
          'w-full overflow-hidden rounded-2xl border border-ink-200 bg-ink-100',
          mapClassName ?? 'h-64',
        )}
        role="application"
        aria-label={t('map.label')}
      />
      <p className="text-sm text-ink-400">
        {status === 'ready' ? (hint ?? t('map.hint')) : t('common.loading')}
        {value && (
          <span className="ml-1 tabular-nums text-ink-500">
            ({value.lat.toFixed(5)}, {value.lng.toFixed(5)})
          </span>
        )}
      </p>
    </div>
  );
}
