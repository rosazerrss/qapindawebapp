/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by `npm run sync:shared`. Edit the original.
// ---------------------------------------------------------------------------
/**
 * QAPINDA — Azerbaijan's places.
 *
 * Nobody types a city name anywhere in this app. A typed city is a city that
 * gets spelled four different ways, and then "Bakı", "Baki" and "BAKU" become
 * three separate markets that never see each other's restaurants. So the list
 * lives here, it is closed, and every address, restaurant and search filter
 * points at an `id` from it.
 *
 * Coordinates are the settlement centre — good enough to find the nearest city
 * from a phone's location, which is all they are used for.
 *
 * Only Baku carries districts: it is the one place where "which part of the
 * city" changes whether a restaurant will deliver to you.
 */

export interface Region {
  /** Stable ascii id. Never shown; never changes once used in an address. */
  id: string;
  /** Azerbaijani name, as displayed. */
  name: string;
  lat: number;
  lng: number;
  /** City districts, where they matter for delivery. */
  districts?: string[];
  /** Sorted to the top of the picker — where the orders actually are. */
  major?: boolean;
}

export const BAKU_DISTRICTS = [
  'Binəqədi',
  'Xətai',
  'Xəzər',
  'Qaradağ',
  'Nərimanov',
  'Nəsimi',
  'Nizami',
  'Pirallahı',
  'Sabunçu',
  'Səbail',
  'Suraxanı',
  'Yasamal',
] as const;

export const REGIONS: Region[] = [
  // --- Where delivery actually starts -------------------------------------
  { id: 'baku', name: 'Bakı', lat: 40.4093, lng: 49.8671, major: true, districts: [...BAKU_DISTRICTS] },
  { id: 'sumqayit', name: 'Sumqayıt', lat: 40.5892, lng: 49.6686, major: true },
  { id: 'ganja', name: 'Gəncə', lat: 40.6828, lng: 46.3606, major: true },
  { id: 'mingachevir', name: 'Mingəçevir', lat: 40.77, lng: 47.0489, major: true },
  { id: 'shirvan', name: 'Şirvan', lat: 39.9264, lng: 48.9214, major: true },
  { id: 'nakhchivan', name: 'Naxçıvan', lat: 39.2089, lng: 45.4122, major: true },
  { id: 'sheki', name: 'Şəki', lat: 41.1919, lng: 47.1706, major: true },
  { id: 'lankaran', name: 'Lənkəran', lat: 38.7529, lng: 48.8475, major: true },
  { id: 'yevlakh', name: 'Yevlax', lat: 40.6172, lng: 47.15, major: true },
  { id: 'quba', name: 'Quba', lat: 41.3608, lng: 48.5128, major: true },
  { id: 'khachmaz', name: 'Xaçmaz', lat: 41.4586, lng: 48.8022, major: true },
  { id: 'shamakhi', name: 'Şamaxı', lat: 40.6314, lng: 48.6408, major: true },
  { id: 'gabala', name: 'Qəbələ', lat: 40.9814, lng: 47.8456, major: true },
  { id: 'zaqatala', name: 'Zaqatala', lat: 41.6317, lng: 46.6444, major: true },

  // --- Everywhere else, alphabetical ---------------------------------------
  { id: 'agjabadi', name: 'Ağcabədi', lat: 40.0531, lng: 47.4622 },
  { id: 'agdam', name: 'Ağdam', lat: 39.9931, lng: 46.9306 },
  { id: 'agdash', name: 'Ağdaş', lat: 40.6486, lng: 47.4711 },
  { id: 'agstafa', name: 'Ağstafa', lat: 41.1128, lng: 45.4494 },
  { id: 'agsu', name: 'Ağsu', lat: 40.5717, lng: 48.4022 },
  { id: 'astara', name: 'Astara', lat: 38.4558, lng: 48.8722 },
  { id: 'babek', name: 'Babək', lat: 39.1533, lng: 45.4544 },
  { id: 'balakan', name: 'Balakən', lat: 41.7239, lng: 46.4042 },
  { id: 'barda', name: 'Bərdə', lat: 40.3744, lng: 47.1264 },
  { id: 'beylagan', name: 'Beyləqan', lat: 39.7722, lng: 47.6156 },
  { id: 'bilasuvar', name: 'Biləsuvar', lat: 39.46, lng: 48.5486 },
  { id: 'jabrayil', name: 'Cəbrayıl', lat: 39.3994, lng: 47.0264 },
  { id: 'jalilabad', name: 'Cəlilabad', lat: 39.2089, lng: 48.51 },
  { id: 'julfa', name: 'Culfa', lat: 38.9542, lng: 45.6303 },
  { id: 'dashkasan', name: 'Daşkəsən', lat: 40.5203, lng: 46.0781 },
  { id: 'fuzuli', name: 'Füzuli', lat: 39.6006, lng: 47.1431 },
  { id: 'gadabay', name: 'Gədəbəy', lat: 40.5697, lng: 45.8161 },
  { id: 'goranboy', name: 'Goranboy', lat: 40.6103, lng: 46.7889 },
  { id: 'goychay', name: 'Göyçay', lat: 40.6531, lng: 47.7403 },
  { id: 'goygol', name: 'Göygöl', lat: 40.5872, lng: 46.3189 },
  { id: 'hajigabul', name: 'Hacıqabul', lat: 40.0392, lng: 48.9256 },
  { id: 'imishli', name: 'İmişli', lat: 39.8697, lng: 48.0653 },
  { id: 'ismayilli', name: 'İsmayıllı', lat: 40.7867, lng: 48.1519 },
  { id: 'kalbajar', name: 'Kəlbəcər', lat: 40.1069, lng: 46.0361 },
  { id: 'kangarli', name: 'Kəngərli', lat: 39.3908, lng: 45.16 },
  { id: 'kurdamir', name: 'Kürdəmir', lat: 40.345, lng: 48.1642 },
  { id: 'gakh', name: 'Qax', lat: 41.4206, lng: 46.9297 },
  { id: 'gazakh', name: 'Qazax', lat: 41.0928, lng: 45.3661 },
  { id: 'gobustan', name: 'Qobustan', lat: 40.5333, lng: 48.9294 },
  { id: 'gubadli', name: 'Qubadlı', lat: 39.3439, lng: 46.5811 },
  { id: 'gusar', name: 'Qusar', lat: 41.4275, lng: 48.43 },
  { id: 'lachin', name: 'Laçın', lat: 39.6383, lng: 46.5464 },
  { id: 'lerik', name: 'Lerik', lat: 38.7739, lng: 48.415 },
  { id: 'masalli', name: 'Masallı', lat: 39.0342, lng: 48.6592 },
  { id: 'naftalan', name: 'Naftalan', lat: 40.5069, lng: 46.8181 },
  { id: 'neftchala', name: 'Neftçala', lat: 39.3781, lng: 49.2461 },
  { id: 'oguz', name: 'Oğuz', lat: 41.0722, lng: 47.4553 },
  { id: 'ordubad', name: 'Ordubad', lat: 38.9036, lng: 46.0242 },
  { id: 'saatli', name: 'Saatlı', lat: 39.9308, lng: 48.3697 },
  { id: 'sabirabad', name: 'Sabirabad', lat: 40.0086, lng: 48.4756 },
  { id: 'sadarak', name: 'Sədərək', lat: 39.7108, lng: 44.885 },
  { id: 'salyan', name: 'Salyan', lat: 39.5964, lng: 48.9789 },
  { id: 'samukh', name: 'Samux', lat: 40.7639, lng: 46.4083 },
  { id: 'siyazan', name: 'Siyəzən', lat: 41.0783, lng: 49.1114 },
  { id: 'shabran', name: 'Şabran', lat: 41.22, lng: 48.9942 },
  { id: 'shahbuz', name: 'Şahbuz', lat: 39.4058, lng: 45.5697 },
  { id: 'shamkir', name: 'Şəmkir', lat: 40.8294, lng: 46.0164 },
  { id: 'sharur', name: 'Şərur', lat: 39.5539, lng: 44.9847 },
  { id: 'shusha', name: 'Şuşa', lat: 39.7539, lng: 46.7508 },
  { id: 'tartar', name: 'Tərtər', lat: 40.3444, lng: 46.9339 },
  { id: 'tovuz', name: 'Tovuz', lat: 40.9928, lng: 45.6167 },
  { id: 'ujar', name: 'Ucar', lat: 40.5175, lng: 47.6489 },
  { id: 'khankendi', name: 'Xankəndi', lat: 39.8153, lng: 46.7519 },
  { id: 'khizi', name: 'Xızı', lat: 40.9106, lng: 49.0736 },
  { id: 'khojali', name: 'Xocalı', lat: 39.9131, lng: 46.7947 },
  { id: 'khojavend', name: 'Xocavənd', lat: 39.7936, lng: 47.1108 },
  { id: 'yardimli', name: 'Yardımlı', lat: 38.9081, lng: 48.245 },
  { id: 'zangilan', name: 'Zəngilan', lat: 39.0864, lng: 46.6522 },
  { id: 'zardab', name: 'Zərdab', lat: 40.2189, lng: 47.7069 },
];

const BY_ID = new Map(REGIONS.map((region) => [region.id, region]));

export const DEFAULT_REGION_ID = 'baku';

export function regionById(id: string | null | undefined): Region | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

export function regionName(id: string | null | undefined): string {
  return regionById(id)?.name ?? '';
}

export function isValidRegion(id: string): boolean {
  return BY_ID.has(id);
}

/** Districts of a region, or an empty list where the region has none. */
export function districtsOf(id: string | null | undefined): string[] {
  return regionById(id)?.districts ?? [];
}

export function isValidDistrict(regionId: string, district: string): boolean {
  return districtsOf(regionId).includes(district);
}

/** Majors first, then alphabetical — the picker's order. */
export function orderedRegions(): Region[] {
  const collator = new Intl.Collator('az');
  const major = REGIONS.filter((region) => region.major);
  const rest = REGIONS.filter((region) => !region.major).sort((a, b) =>
    collator.compare(a.name, b.name),
  );
  return [...major, ...rest];
}

/** Substring match for the picker's search box, accent-insensitive enough. */
export function searchRegions(term: string): Region[] {
  const needle = fold(term);
  if (!needle) return orderedRegions();
  return orderedRegions().filter((region) => fold(region.name).includes(needle));
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .trim();
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. Used for "is this address in range?". */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The closest region to a coordinate.
 *
 * `maxMeters` keeps a phone somewhere over the Caspian from being told it is in
 * Baku: past that distance we would rather ask than guess.
 */
export function nearestRegion(
  point: { lat: number; lng: number },
  maxMeters = 120_000,
): Region | null {
  let best: Region | null = null;
  let bestDistance = Infinity;

  for (const region of REGIONS) {
    const distance = distanceMeters(point, region);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = region;
    }
  }

  return bestDistance <= maxMeters ? best : null;
}
