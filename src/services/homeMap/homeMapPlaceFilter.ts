/**
 * Karten-Filter unter „Orte“: Status + Typ. Union — Ort sichtbar, wenn
 * mindestens ein eingeschalteter Chip passt.
 *
 * Standard = erste Reihe: Besucht, Geplant, Auslösen, Story.
 * Typ-Chips (ÖPNV, Restaurant, …) haben eigene Farben; Rest-Gelb nur Alltag/Weitere.
 */

import type { Poi } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { HOME_MAP_PLACE_COLORS, HOME_MAP_TYPE_COLORS } from './homeMapStyle';
import {
  isModul1AutoTriggerMapPoi,
  isPackStoryMapPoi,
} from '../navigation/stampMapModul1';
import { homeMapTypeFilterId, isMapShelterBuildingPoi } from './homeMapPlaceType';
import { isLearnedMapPoi } from './homeMapPlaceTone';

export const HOME_MAP_STATUS_FILTER_IDS = [
  'visited',
  'planned',
  'trigger',
  'story',
] as const;

export const HOME_MAP_TYPE_FILTER_IDS = [
  'transit',
  'restaurant',
  'cafe',
  'museum',
  'kultur',
  'hotel',
  'einkaufen',
  'freizeit',
  'natur',
  'aktivitaet',
  'alltag',
] as const;

export const HOME_MAP_FILTER_IDS = [
  ...HOME_MAP_STATUS_FILTER_IDS,
  ...HOME_MAP_TYPE_FILTER_IDS,
] as const;

export type HomeMapFilterId = (typeof HOME_MAP_FILTER_IDS)[number];

export type HomeMapFilterChip = {
  id: HomeMapFilterId;
  label: string;
  color: string;
};

export const HOME_MAP_FILTER_CHIPS: HomeMapFilterChip[] = [
  { id: 'visited', label: 'Besucht', color: HOME_MAP_PLACE_COLORS.visited },
  { id: 'planned', label: 'Geplant', color: HOME_MAP_PLACE_COLORS.planned },
  { id: 'trigger', label: 'Auslösen', color: HOME_MAP_PLACE_COLORS.liked },
  { id: 'story', label: 'Story', color: HOME_MAP_PLACE_COLORS.neutral },
  { id: 'transit', label: 'ÖPNV', color: HOME_MAP_TYPE_COLORS.transit },
  { id: 'restaurant', label: 'Restaurant', color: HOME_MAP_TYPE_COLORS.restaurant },
  { id: 'cafe', label: 'Café', color: HOME_MAP_TYPE_COLORS.cafe },
  { id: 'museum', label: 'Museum', color: HOME_MAP_TYPE_COLORS.museum },
  { id: 'kultur', label: 'Kultur', color: HOME_MAP_TYPE_COLORS.kultur },
  { id: 'hotel', label: 'Hotel', color: HOME_MAP_TYPE_COLORS.hotel },
  { id: 'einkaufen', label: 'Einkaufen', color: HOME_MAP_TYPE_COLORS.einkaufen },
  { id: 'freizeit', label: 'Freizeit', color: HOME_MAP_TYPE_COLORS.freizeit },
  { id: 'natur', label: 'Natur', color: HOME_MAP_TYPE_COLORS.natur },
  { id: 'aktivitaet', label: 'Aktivitäten', color: HOME_MAP_TYPE_COLORS.aktivitaet },
  { id: 'alltag', label: 'Alltag', color: HOME_MAP_TYPE_COLORS.alltag },
];

export function allHomeMapFiltersOn(): Record<HomeMapFilterId, boolean> {
  return Object.fromEntries(
    HOME_MAP_FILTER_IDS.map((id) => [id, true]),
  ) as Record<HomeMapFilterId, boolean>;
}

export function allHomeMapFiltersOff(): Record<HomeMapFilterId, boolean> {
  return Object.fromEntries(
    HOME_MAP_FILTER_IDS.map((id) => [id, false]),
  ) as Record<HomeMapFilterId, boolean>;
}

/** Besucht · Geplant · Auslösen · Story */
export function standardHomeMapFilters(): Record<HomeMapFilterId, boolean> {
  const flags = allHomeMapFiltersOff();
  for (const id of HOME_MAP_STATUS_FILTER_IDS) flags[id] = true;
  return flags;
}

export function isStandardHomeMapFilters(
  flags: Record<HomeMapFilterId, boolean>,
): boolean {
  for (const id of HOME_MAP_STATUS_FILTER_IDS) {
    if (!flags[id]) return false;
  }
  for (const id of HOME_MAP_TYPE_FILTER_IDS) {
    if (flags[id]) return false;
  }
  return true;
}

export function enabledHomeMapFilterSet(
  flags: Record<HomeMapFilterId, boolean>,
): Set<HomeMapFilterId> {
  const out = new Set<HomeMapFilterId>();
  for (const id of HOME_MAP_FILTER_IDS) {
    if (flags[id]) out.add(id);
  }
  return out;
}

export function homeMapFilterIdsForPoi(
  poi: Poi,
  opts: {
    visited: boolean;
    planned: boolean;
    profile?: UserProfile | null;
  },
): HomeMapFilterId[] {
  const ids: HomeMapFilterId[] = [];
  if (opts.visited) ids.push('visited');
  if (opts.planned) ids.push('planned');
  const trigger = isModul1AutoTriggerMapPoi(poi, opts.profile);
  if (trigger && !opts.visited) ids.push('trigger');
  if (isPackStoryMapPoi(poi) && !opts.visited && !trigger) ids.push('story');
  if (isMapShelterBuildingPoi(poi) && !opts.visited && !ids.includes('story')) {
    ids.push('story');
  }
  if (isLearnedMapPoi(poi) && !opts.visited && !ids.includes('story')) {
    ids.push('story');
  }
  const typeId = homeMapTypeFilterId(poi);
  if (typeId && HOME_MAP_FILTER_IDS.includes(typeId as HomeMapFilterId)) {
    ids.push(typeId as HomeMapFilterId);
  }
  return ids;
}

export function poiPassesHomeMapFilter(
  poi: Poi,
  opts: {
    visited: boolean;
    planned: boolean;
    profile?: UserProfile | null;
    enabled: ReadonlySet<HomeMapFilterId>;
  },
): boolean {
  if (opts.enabled.size === 0) return false;
  if (opts.enabled.size >= HOME_MAP_FILTER_IDS.length) return true;
  const ids = homeMapFilterIdsForPoi(poi, opts);
  return ids.some((id) => opts.enabled.has(id));
}
