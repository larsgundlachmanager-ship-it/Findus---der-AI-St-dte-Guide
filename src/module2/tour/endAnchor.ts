/**
 * End-Anker aus User-Text (Hafen, Strand, …) — Pack-POI nahe GPS/Stadt.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import { parseTagsJson } from '../../services/geo/triggerPolicy';
import {
  parseEndAnchorKind,
  wantsParkingNearEnd,
} from './parentBrief';
import type { TourEndAnchor, TourLatLng } from './types';

export async function resolveTourEndAnchorFromText(
  text: string,
  near: TourLatLng,
): Promise<TourEndAnchor | null> {
  const kind = parseEndAnchorKind(text);
  if (!kind) return null;
  const wantPark = wantsParkingNearEnd(text);
  let pois: Awaited<ReturnType<typeof getAllPois>> = [];
  try {
    pois = await getAllPois();
  } catch {
    return {
      lat: near.lat,
      lng: near.lng,
      name: kind.charAt(0).toUpperCase() + kind.slice(1),
    };
  }

  const scored = pois
    .filter((p) => {
      if (p.kind === 'approach' || p.kind === 'sub') return false;
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
      const blob =
        `${p.name} ${p.category ?? ''} ${parseTagsJson(p.tags_json).join(' ')}`.toLowerCase();
      if (!blob.includes(kind)) return false;
      if (
        /hotel|restaurant|café|cafe|supermarkt|tankstelle|schule|tennis/.test(blob) &&
        kind !== 'hotel'
      ) {
        return false;
      }
      return true;
    })
    .map((p) => {
      const blob =
        `${p.name} ${p.category ?? ''} ${parseTagsJson(p.tags_json).join(' ')}`.toLowerCase();
      const d = haversineMeters(near.lat, near.lng, p.lat, p.lng);
      let s = 20 - Math.min(18, d / 400);
      if (/must_have|wahrzeichen|highlight/.test(blob)) s += 4;
      if (wantPark && /park/.test(blob)) s += 6;
      return { p, s, d };
    })
    .sort((a, b) => b.s - a.s || a.d - b.d);

  const top = scored[0];
  if (!top) {
    return {
      lat: near.lat,
      lng: near.lng,
      name: kind.charAt(0).toUpperCase() + kind.slice(1),
    };
  }
  let name = top.p.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
  if (wantPark && !/park/i.test(name)) {
    name = `${name} (Parken)`;
  }
  return {
    lat: top.p.lat,
    lng: top.p.lng,
    name,
    poiId: top.p.id,
  };
}
