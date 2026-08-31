/**
 * Analogical transfer — unknown wish → nearest existing job contract.
 * No vehicle/app scripts: mountain access inherits transit; a catalog
 * (playlist) inherits OPEN_URL like a ticket link; hike stays sport.
 */

import type { FindusJobId } from './types';

const HIKE_ONLY =
  /\b(wandern|wanderung|hike|hiking|trekking|klettern|klettersteig|climb(?:ing)?)\b/iu;

const VEHICLE_ASCENT =
  /\b(rauf\w*|hinauf\w*|hochfahr\w*|auffahr\w*|raufkomm\w*|up\s+the\s+mountain|subir|monter|salire|pujar|llevar.{0,16}arriba|get\s+(?:me\s+)?up)\b/iu;

const ELEVATED_OR_ISOLATED =
  /\b(berg|gipfel|alpen|alp\b|mountain|peak|summit|montaña|montana|montagne|montagna|monte\b|cima|pico|volc[aá]n|vulkan|sierra|insel|isla|island|festung|fortaleza|castillo|mirador|aussicht(?:spunkt)?)\b/iu;

/** Local mode names are evidence of ticketed access, not a product script. */
const TICKETED_ACCESS_MODE =
  /\b(seilbahn|zahnradbahn|standseilbahn|bergbahn|gondel|kabinenbahn|funicular|cable\s*car|teleférico|teleferico|téléphérique|ropeway|cog(?:\s*railway)?|chairlift|sessellift)\b/iu;

const MEDIA_CATALOG =
  /\b(playlist|spotify|apple\s*music|deezer)\b/iu;

export function looksLikeHikeOnly(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || !HIKE_ONLY.test(t)) return false;
  return !VEHICLE_ASCENT.test(t) && !TICKETED_ACCESS_MODE.test(t);
}

/**
 * Ticketed access to a place (elevation, island, fortress): same contract as
 * transit — operator, connection, ticket/info URL, timeline stop.
 * Discovers the local mode; does not hardcode one vehicle.
 */
export function looksLikeTicketedPlaceAccess(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikeHikeOnly(t)) return false;
  if (TICKETED_ACCESS_MODE.test(t)) return true;
  const elevated = ELEVATED_OR_ISOLATED.test(t);
  const ascent = VEHICLE_ASCENT.test(t) || placeAscent(t);
  return elevated && ascent;
}

export function looksLikeMediaCatalogRequest(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return MEDIA_CATALOG.test(t);
}

/** Node-safe catalog URL — same OPEN_URL shape as a ticket link. */
export function mediaCatalogSearchUrl(text: string): string {
  const q = (text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'playlist';
  return `https://open.spotify.com/search/${encodeURIComponent(q)}`;
}

function placeAscent(t: string): boolean {
  return (
    /\b(fahren|take\s+me|kommen).{0,40}\b(berg|gipfel|mountain|cima|pico|montaña|montana)\b/iu.test(
      t,
    ) ||
    /\b(berg|gipfel|mountain|montaña|montana).{0,40}\b(fahren|rauf|hinauf|subir|up)\b/iu.test(
      t,
    )
  );
}

export type AnalogJobHint = {
  jobId: FindusJobId;
  score: number;
  shape: 'ticketed_place_access' | 'media_catalog';
};

/** Maps a situation shape onto an existing job — never a new one-off type. */
export function analogJobHints(text: string): AnalogJobHint[] {
  const out: AnalogJobHint[] = [];
  if (looksLikeTicketedPlaceAccess(text)) {
    out.push({ jobId: 'transit_live', score: 13, shape: 'ticketed_place_access' });
  }
  if (looksLikeMediaCatalogRequest(text)) {
    out.push({ jobId: 'shopping_errand', score: 14, shape: 'media_catalog' });
  }
  return out;
}
