/**
 * Router handoffs — M1 / M3 / M5 / memory from Manager route.
 */

import type { ManagerAnalysis } from './types';

export type HandoffKind =
  | 'none'
  | 'm1_poi_offer'
  | 'm3_nav_start'
  | 'm5_plan'
  | 'memory';

export function resolveHandoff(analysis: ManagerAnalysis): HandoffKind {
  switch (analysis.route) {
    case 'm1_poi':
      return 'm1_poi_offer';
    case 'm3_nav_start':
      return 'm3_nav_start';
    case 'm5_plan':
      return 'm5_plan';
    case 'memory':
      return 'memory';
    default:
      return 'none';
  }
}

/** Facing-aware pack identify offer text (short). */
export async function buildM1PoiOffer(opts: {
  userText: string;
  lat: number;
  lng: number;
  headingDeg?: number | null;
}): Promise<{
  speech: string;
  poiId: string | null;
  placeName: string | null;
  askMore: boolean;
}> {
  try {
    const { lookupPackFactsForSubject } = await import(
      '../agents/packFactLookup'
    );
    const { resolveFacingBearingDeg } = await import(
      '../../services/navigation/facingReference'
    );
    const facing = resolveFacingBearingDeg({
      deviceHeadingDeg: opts.headingDeg ?? null,
    });
    const hit = await lookupPackFactsForSubject({
      subject: opts.userText,
      lat: opts.lat,
      lng: opts.lng,
      limitFacts: 8,
      // facing hint in subject for future cone filter
      cityHint: null,
    });
    if (!hit) {
      return {
        speech:
          'Von hier erkenne ich den Ort im Datensatz noch nicht sicher. Zeig etwas deutlicher hin oder beschreib kurz — dann hol ich mehr dazu.',
        poiId: null,
        placeName: null,
        askMore: false,
      };
    }
    const name = hit.poi?.name || 'dieser Ort';
    const snippet = (hit.facts[0] || '').slice(0, 160);
    return {
      speech: snippet
        ? `Das wirkt nach ${name}. ${snippet} Möchtest du mehr dazu hören?`
        : `Das wirkt nach ${name}. Möchtest du mehr dazu hören?`,
      poiId: hit.poi?.id != null ? String(hit.poi.id) : null,
      placeName: name,
      askMore: true,
    };
  } catch {
    return {
      speech:
        'Ich gucke kurz, was das vor dir ist — beschreib den Ort, wenn ich daneben liege.',
      poiId: null,
      placeName: null,
      askMore: false,
    };
  }
}
