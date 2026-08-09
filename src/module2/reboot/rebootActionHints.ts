/**
 * Fact-meta → ActionBoard Entities / Slow-Lane Flags.
 * Speech bleibt frei; Links dürfen nachpoppen.
 */

import type { ActionEntity } from '../../services/actionBoard/types';
import type { AgentResult } from '../types';

export type RebootBoardHints = {
  entities: ActionEntity[];
  module1?: {
    poiId: number | string;
    name: string;
    lat: number;
    lng: number;
    websiteUrl?: string | null;
    category?: string | null;
    hotel?: boolean;
    activity?: boolean;
  };
  /** Speisekarte / Tickets / Stay22 nachziehen */
  wantDeepLinks: boolean;
};

type VenueRow = {
  name?: string;
  lat?: number;
  lng?: number;
  websiteUrl?: string | null;
  menuUrl?: string | null;
  bookUrl?: string | null;
};

function asVenues(meta: Record<string, unknown> | undefined): VenueRow[] {
  const v = meta?.venues;
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === 'object') as VenueRow[];
}

export function buildRebootBoardHints(fact: AgentResult): RebootBoardHints {
  const meta = (fact.meta ?? {}) as Record<string, unknown>;
  const entities: ActionEntity[] = [];

  const placeName =
    (typeof meta.placeName === 'string' && meta.placeName) ||
    (typeof meta.destName === 'string' && meta.destName) ||
    null;
  const placeLat =
    typeof meta.placeLat === 'number'
      ? meta.placeLat
      : typeof meta.destLat === 'number'
        ? meta.destLat
        : undefined;
  const placeLng =
    typeof meta.placeLng === 'number'
      ? meta.placeLng
      : typeof meta.destLng === 'number'
        ? meta.destLng
        : undefined;

  if (placeName && meta.packMatch === true) {
    entities.push({
      name: placeName,
      rank: 1,
      lat: placeLat,
      lng: placeLng,
      category: 'attraction',
      poiId: typeof meta.poiId === 'number' ? meta.poiId : null,
    });
  }

  const venues = asVenues(meta);
  for (let i = 0; i < Math.min(2, venues.length); i++) {
    const v = venues[i]!;
    if (!v.name?.trim()) continue;
    const url = v.menuUrl || v.websiteUrl || v.bookUrl || null;
    entities.push({
      name: v.name.trim(),
      rank: i === 0 ? 1 : 2,
      lat: typeof v.lat === 'number' ? v.lat : undefined,
      lng: typeof v.lng === 'number' ? v.lng : undefined,
      websiteUrl: url,
      category:
        meta.affiliate === 'stay22' || meta.booking_deep_link === true
          ? 'hotel'
          : meta.packMatch === true
            ? 'attraction'
            : 'restaurant',
    });
  }

  // Amenity / Combo Nav-Ziele als Entities (Route schon in Seed-Buttons)
  if (meta.amenityNav === true && typeof meta.destName === 'string') {
    entities.push({
      name: meta.destName,
      rank: 1,
      lat: typeof meta.destLat === 'number' ? meta.destLat : undefined,
      lng: typeof meta.destLng === 'number' ? meta.destLng : undefined,
      category: 'shop',
    });
  }

  const wantDeepLinks =
    meta.menu_links_required === true ||
    meta.needsMenuUrl === true ||
    meta.booking_deep_link === true ||
    meta.affiliate === 'stay22' ||
    meta.needsEventLinks === true ||
    meta.ticket_or_info_url === true ||
    venues.some((v) => !v.menuUrl && !v.bookUrl && Boolean(v.name)) ||
    Boolean(
      fact.buttons?.some(
        (b) =>
          b.payload.kind === 'deep_link' &&
          /pending/i.test(String((b.payload as { url?: string }).url ?? '')),
      ),
    );

  let module1: RebootBoardHints['module1'];
  if (
    meta.packMatch === true &&
    placeName &&
    typeof placeLat === 'number' &&
    typeof placeLng === 'number'
  ) {
    module1 = {
      poiId: typeof meta.poiId === 'number' ? meta.poiId : placeName,
      name: placeName,
      lat: placeLat,
      lng: placeLng,
      category: 'attraction',
      activity: false,
      hotel: false,
    };
  } else if (
    meta.booking_deep_link === true &&
    venues[0]?.name &&
    typeof venues[0].lat === 'number' &&
    typeof venues[0].lng === 'number'
  ) {
    module1 = {
      poiId: venues[0].name,
      name: venues[0].name,
      lat: venues[0].lat,
      lng: venues[0].lng,
      websiteUrl: venues[0].bookUrl || venues[0].websiteUrl,
      category: 'hotel',
      hotel: true,
    };
  }

  // Dedup by name
  const seen = new Set<string>();
  const deduped = entities.filter((e) => {
    const k = e.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { entities: deduped.slice(0, 3), module1, wantDeepLinks };
}
