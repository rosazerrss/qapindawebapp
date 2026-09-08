'use client';

/**
 * Which city the customer is shopping in.
 *
 * Chosen once and remembered. The app offers to detect it from the phone's
 * location, but never does so silently: a location prompt that appears before
 * anyone asked for it is the fastest way to get it denied forever.
 *
 * Read through `useSyncExternalStore` so the first paint already has the right
 * city and no effect has to correct it afterwards.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { DEFAULT_REGION_ID, isValidRegion, nearestRegion, regionById, type Region } from '@/shared/regions';

const STORAGE_KEY = 'qapinda_region';

let listeners: Array<() => void> = [];

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

function snapshot(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && isValidRegion(stored) ? stored : DEFAULT_REGION_ID;
  } catch {
    return DEFAULT_REGION_ID;
  }
}

/** The server cannot know; Baku is where the orders are. */
function serverSnapshot(): string {
  return DEFAULT_REGION_ID;
}

function store(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked — the choice lasts for this page view only.
  }
  for (const listener of listeners) listener();
}

/** True once the person has made a choice, so we stop nudging them. */
function chosenSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

interface RegionValue {
  regionId: string;
  region: Region;
  setRegion: (id: string) => void;
  /** Has the person picked, or are we showing them the default? */
  chosen: boolean;
  /** Asks the browser for a location and picks the nearest city. */
  detect: () => Promise<{ ok: boolean; regionId?: string; reason?: string }>;
  detecting: boolean;
}

const RegionContext = createContext<RegionValue | null>(null);

export function RegionProvider({ children }: { children: ReactNode }) {
  const regionId = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const chosen = useSyncExternalStore(subscribe, chosenSnapshot, () => true);
  const [detecting, setDetecting] = useState(false);

  const setRegion = useCallback((id: string) => {
    if (isValidRegion(id)) store(id);
  }, []);

  const detect = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return { ok: false, reason: 'unsupported' };
    }

    setDetecting(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 300_000,
        });
      });

      const nearest = nearestRegion({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      });

      // Outside the country, or too far from anywhere we list: better to leave
      // the choice alone than to drop somebody into a random city.
      if (!nearest) return { ok: false, reason: 'out-of-range' };

      store(nearest.id);
      return { ok: true, regionId: nearest.id };
    } catch {
      return { ok: false, reason: 'denied' };
    } finally {
      setDetecting(false);
    }
  }, []);

  const value = useMemo<RegionValue>(
    () => ({
      regionId,
      region: regionById(regionId) ?? regionById(DEFAULT_REGION_ID)!,
      setRegion,
      chosen,
      detect,
      detecting,
    }),
    [regionId, chosen, setRegion, detect, detecting],
  );

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export function useRegion(): RegionValue {
  const context = useContext(RegionContext);
  if (!context) throw new Error('useRegion must be used inside RegionProvider');
  return context;
}
