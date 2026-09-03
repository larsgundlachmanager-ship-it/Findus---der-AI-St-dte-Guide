/**
 * Amenity-Icon-Prefs für Orte — unabhängig von Status/Typ-Chips.
 * Default: alle an (= heutiges Kartenbild).
 */

import {
  HOME_MAP_PLACE_ICON_IDS,
  type HomeMapPlaceIcon,
} from './homeMapPlaceType';

export function allAmenityIconsOn(): Record<HomeMapPlaceIcon, boolean> {
  return Object.fromEntries(
    HOME_MAP_PLACE_ICON_IDS.map((id) => [id, true]),
  ) as Record<HomeMapPlaceIcon, boolean>;
}

export function allAmenityIconsOff(): Record<HomeMapPlaceIcon, boolean> {
  return Object.fromEntries(
    HOME_MAP_PLACE_ICON_IDS.map((id) => [id, false]),
  ) as Record<HomeMapPlaceIcon, boolean>;
}

export function isAmenityIconEnabled(
  flags: Record<HomeMapPlaceIcon, boolean> | null | undefined,
  icon: HomeMapPlaceIcon | string | null | undefined,
): boolean {
  if (!icon) return true;
  if (!flags) return true;
  const v = flags[icon as HomeMapPlaceIcon];
  return v !== false;
}

export type HomeMapAmenityIconChip = {
  id: HomeMapPlaceIcon;
  label: string;
};

export type HomeMapAmenityIconGroup = {
  title: string;
  icons: HomeMapAmenityIconChip[];
};

/** UI-Gruppen für Orte → Icons-Panel. */
export const HOME_MAP_AMENITY_ICON_GROUPS: HomeMapAmenityIconGroup[] = [
  {
    title: 'ÖPNV',
    icons: [
      { id: 'rail', label: 'Bahn' },
      { id: 'bus', label: 'Bus' },
      { id: 'ferry', label: 'Fähre' },
    ],
  },
  {
    title: 'Alltag',
    icons: [
      { id: 'post', label: 'Briefkasten / Packstation' },
      { id: 'doctor', label: 'Arzt' },
      { id: 'pharmacy', label: 'Apotheke' },
      { id: 'atm', label: 'Geldautomat' },
      { id: 'parking', label: 'Parken' },
      { id: 'fuel', label: 'Tankstelle' },
      { id: 'supermarket', label: 'Supermarkt' },
      { id: 'kiosk', label: 'Kiosk' },
      { id: 'bakery', label: 'Bäckerei' },
      { id: 'info', label: 'Info' },
      { id: 'bike', label: 'Mietrad' },
    ],
  },
  {
    title: 'Notfall',
    icons: [
      { id: 'toilet', label: 'WC' },
      { id: 'water', label: 'Wasser' },
    ],
  },
  {
    title: 'Gastro & Hotel',
    icons: [
      { id: 'restaurant', label: 'Restaurant' },
      { id: 'cafe', label: 'Café' },
      { id: 'bar', label: 'Bar' },
      { id: 'hotel', label: 'Hotel' },
      { id: 'hostel', label: 'Hostel' },
      { id: 'camping', label: 'Camping' },
    ],
  },
  {
    title: 'Kultur & Natur',
    icons: [
      { id: 'museum', label: 'Museum' },
      { id: 'historic', label: 'Historie' },
      { id: 'attraction', label: 'Sehenswürdigkeit' },
      { id: 'cinema', label: 'Kino' },
      { id: 'theater', label: 'Theater' },
      { id: 'viewpoint', label: 'Aussicht' },
      { id: 'park', label: 'Park' },
      { id: 'nature', label: 'Natur' },
      { id: 'activity', label: 'Aktivität' },
      { id: 'souvenir', label: 'Souvenir' },
    ],
  },
];
