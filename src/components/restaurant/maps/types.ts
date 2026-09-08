/**
 * QAPINDA — The one shape both map implementations answer to.
 *
 * There are two delivery maps in this folder: one drawn with Google Maps and
 * one with Leaflet over OpenStreetMap. They are interchangeable, and the whole
 * point of that is that no screen in the app knows which one it got. This file
 * is the contract that makes it true — if a prop is added here it has to be
 * honoured by both, and if it cannot be honoured by both it does not belong
 * here.
 */

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface DeliveryMapProps {
  value: MapPoint | null;
  radiusMeters: number;
  regionId: string;
  onChange: (point: MapPoint) => void;
  className?: string;
  /** Overrides the map's own height, for a screen that gives it more room. */
  mapClassName?: string;
  /**
   * Move the pin here, and take the map with it.
   *
   * For the two things a person can do that are not dragging: "use my current
   * location", and picking a search result. Applied once per distinct value —
   * a new object with the same coordinates is the same instruction, and
   * re-applying it would fight the pin somebody has since dragged.
   */
  focus?: MapPoint | null;
  /** Replaces the default "drag the pin" line under the map. */
  hint?: string;
}
