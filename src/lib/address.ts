/**
 * The half of an address a street name does not contain.
 *
 * "Nizami küç. 12" gets a courier to a door in a wall. Which flat, which
 * floor, which block and whose reception is the rest of the journey, and those
 * four fields live beside the line rather than inside it — so anything that
 * shows an address and forgets them shows an address that cannot be delivered
 * to.
 *
 * That is exactly what the printed ticket did: the kitchen's receipt carried
 * `address.line` alone, so a driver working from the paper in their hand had
 * the street and nothing else, while the same order in the courier app showed
 * the flat number. One helper now, used by both, because the way these two
 * screens drifted apart is by each assembling the address for itself.
 *
 * Takes the translate function rather than importing it: this is called from
 * components that already have one, and the short forms ("mənz.", "mərt.")
 * are dictionary entries like everything else.
 */

import type { Translate } from '@/i18n';

interface AddressParts {
  building?: string | null;
  apartment?: string | null;
  floor?: string | null;
  company?: string | null;
}

/**
 * `"B blok · mənz. 42 · mərt. 3 · Azersun"`, with every absent part dropped.
 *
 * Returns an empty string when there is nothing to add, so a caller can test
 * it directly rather than checking four fields.
 */
export function addressDetail(address: AddressParts | null | undefined, t: Translate): string {
  if (!address) return '';

  return [
    address.building,
    address.apartment && t('account.apartmentShort', { value: address.apartment }),
    address.floor && t('account.floorShort', { value: address.floor }),
    address.company,
  ]
    .filter(Boolean)
    .join(' · ');
}
