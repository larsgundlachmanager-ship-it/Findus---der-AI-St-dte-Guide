/**
 * Live-HUD Amenity-Pitch-Texte (rein, ohne RN) — Erholung / Fotospot.
 * Struktur: menschlicher Opener + Name + Gehzeit; nie „Park?“ / „Foto-Spot?“.
 */

export type AmenityPitchHit = {
  name: string;
  distanceM: number;
  walkMin: number;
  lat?: number;
  lng?: number;
};

export type AmenityPitchCard = {
  id: string;
  title: string;
  meta: string;
  tellMorePrompt: string;
  score: number;
  navDest?: { name: string; lat: number; lng: number };
};

function formatDist(m: number): string {
  if (m < 1000) return `${Math.max(40, Math.round(m / 20) * 20)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatWalkMeta(name: string, distanceM: number, walkMin: number): string {
  const walk =
    walkMin <= 1 ? '1 Min entfernt' : `${walkMin} Min entfernt`;
  if (walkMin <= 2) {
    return `${name} · ${formatDist(distanceM)}`;
  }
  return `${name} · ${walk}`;
}

function navFrom(
  hit: AmenityPitchHit,
): { name: string; lat: number; lng: number } | undefined {
  if (
    hit.lat == null ||
    hit.lng == null ||
    !Number.isFinite(hit.lat) ||
    !Number.isFinite(hit.lng)
  ) {
    return undefined;
  }
  return { name: hit.name, lat: hit.lat, lng: hit.lng };
}

export function buildParkRestHudCard(hit: AmenityPitchHit): AmenityPitchCard {
  return {
    id: `amenity-park-${Math.round(hit.distanceM)}`,
    title: 'Brauchst du eine kurze Erholung?',
    meta: formatWalkMeta(hit.name, hit.distanceM, hit.walkMin),
    tellMorePrompt:
      `Ruhiger Spot „${hit.name}“ (~${hit.walkMin} Min) — kurz warum er zum Durchatmen passt und Route.`,
    score: hit.distanceM <= 350 ? 70 : hit.distanceM <= 650 ? 62 : 54,
    navDest: navFrom(hit),
  };
}

export function buildPhotoSpotHudCard(hit: AmenityPitchHit): AmenityPitchCard {
  return {
    id: `amenity-photo-${Math.round(hit.distanceM)}`,
    title: 'Hier kannst du dir das angucken',
    meta: formatWalkMeta(hit.name, hit.distanceM, hit.walkMin),
    tellMorePrompt:
      `Fotospot / Blick „${hit.name}“ (~${hit.walkMin} Min) — kurz was man sieht, ob’s was für dich ist, und Route.`,
    score: hit.distanceM <= 400 ? 68 : hit.distanceM <= 750 ? 60 : 52,
    navDest: navFrom(hit),
  };
}

/** Gattungsnamen — kein HUD-Pitch. */
export function isVagueRestOrPhotoName(
  name: string,
  kind: 'park_rest' | 'photo_spot',
): boolean {
  const t = name.replace(/\s+/g, ' ').trim();
  if (t.length < 3) return true;
  if (kind === 'park_rest') {
    return /^(park|parks|grünanlage|grünflächen?|gartenanlagen?)$/iu.test(t);
  }
  return /^(foto[- ]?spots?|aussichten?|viewpoint|sehenswürdigkeit(en)?)$/iu.test(
    t,
  );
}
