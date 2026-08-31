/**
 * Chained multi-destination nav from casual speech:
 * „Zurück zum Hotel, aber vorher noch zu Aldi“
 * → Stop 1: Aldi → Stop 2: Hotel (auto-advance).
 */

import { getAllPois, haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore, type UserEntity } from '../../store/useUserMemoryStore';
import {
  geocodePlaceName,
  hasGoogleMapsNavKey,
  searchOpenPlacesAhead,
} from './googleMapsNav';
import {
  startMultiStopTour,
  type MultiStopTour,
  type TourStop,
} from './multiStopTour';

export type ChainedNavIntent = {
  viaLabels: string[];
  /** Final destination label, or null if only vias + hotel flag. */
  finalLabel: string | null;
  finalIsHotel: boolean;
};

/** Remember chain while we ask for hotel name / confirmation. */
let pendingChain: ChainedNavIntent | null = null;

export function takePendingChainedNav(): ChainedNavIntent | null {
  const p = pendingChain;
  pendingChain = null;
  return p;
}

export function peekPendingChainedNav(): ChainedNavIntent | null {
  return pendingChain;
}

function stashPendingChain(intent: ChainedNavIntent): void {
  pendingChain = intent;
}

const HOTEL_FINAL_RE =
  /\b(hotel|unterkunft|pension|hostel|zurück\s+zum\s+hotel|zurueck\s+zum\s+hotel|mein(em)?\s+hotel)\b/iu;

/** „vorher / erst / dann noch / und noch schnell …“ */
const CHAIN_SIGNAL_RE =
  /\b(vorher|zuerst|erst(mal)?|danach|dann\s+noch|und\s+dann|aber\s+(vorher|erst)|noch\s+(schnell|kurz)\s+(zu|nach|bei)|über|via|zwischendurch|auf\s+dem\s+weg)\b/iu;

const VIA_CAPTURE_RE =
  /(?:vorher|zuerst|erst(?:mal)?|noch\s+(?:schnell|kurz)|zwischendurch|auf\s+dem\s+weg)\s*(?:noch\s+)?(?:zu|nach|bei|zum|zur|ins|in\s+den|in\s+die|zum)?\s*([A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,3})/iu;

const THEN_HOTEL_RE =
  /\b(?:dann|danach|und\s+dann|anschließend|anschliessend)\s+(?:zurück\s+)?(?:zum\s+)?hotel\b/iu;

const FIRST_THEN_RE =
  /\b(?:erst|zuerst)\s+(?:zu|nach|bei|zum|zur)?\s*([A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,2})\s*[,.]?\s*(?:dann|danach|und\s+dann)\s+(?:zurück\s+)?(?:zum\s+)?(hotel|[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']{2,})/iu;

const OVER_VIA_RE =
  /\b(?:über|via)\s+([A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']+)\s+(?:zum|zur|nach)\s+(hotel|[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']{2,})/iu;

const NOISE =
  /^(noch|mal|kurz|schnell|bitte|einfach|auch|ein|eine|einen|dem|den|der|die|das|zu|zum|zur|nach|bei)$/i;

function cleanLabel(raw: string): string {
  return raw
    .replace(/[.,!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoise(label: string): boolean {
  const t = label.trim();
  if (t.length < 2) return true;
  if (NOISE.test(t)) return true;
  if (/^(hotel|unterkunft)$/i.test(t)) return true;
  return false;
}

/**
 * Detect chained destinations. Fast regex — no LLM.
 */
export function detectChainedNavIntent(text: string): ChainedNavIntent | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 8) return null;

  // Pattern: erst X, dann Hotel / Y
  const firstThen = t.match(FIRST_THEN_RE);
  if (firstThen) {
    const via = cleanLabel(firstThen[1] ?? '');
    const finalRaw = cleanLabel(firstThen[2] ?? '');
    if (!isNoise(via)) {
      const finalIsHotel = /^hotel$/i.test(finalRaw) || HOTEL_FINAL_RE.test(finalRaw);
      return {
        viaLabels: [via],
        finalLabel: finalIsHotel ? 'Hotel' : finalRaw,
        finalIsHotel,
      };
    }
  }

  // Pattern: über Aldi zum Hotel
  const over = t.match(OVER_VIA_RE);
  if (over) {
    const via = cleanLabel(over[1] ?? '');
    const finalRaw = cleanLabel(over[2] ?? '');
    if (!isNoise(via)) {
      const finalIsHotel = /^hotel$/i.test(finalRaw);
      return {
        viaLabels: [via],
        finalLabel: finalIsHotel ? 'Hotel' : finalRaw,
        finalIsHotel,
      };
    }
  }

  const hasChain = CHAIN_SIGNAL_RE.test(t);
  const hasHotel = HOTEL_FINAL_RE.test(t) || THEN_HOTEL_RE.test(t);
  if (!hasChain) return null;

  const vias: string[] = [];
  const viaMatch = t.match(VIA_CAPTURE_RE);
  if (viaMatch?.[1]) {
    const v = cleanLabel(viaMatch[1]);
    if (!isNoise(v) && !/^hotel$/i.test(v)) vias.push(v);
  }

  // Fallback: „… vorher Aldi …“ without zu/
  if (!vias.length) {
    const loose = t.match(
      /\b(?:vorher|erst(?:mal)?|zuerst)\s+(?:noch\s+)?([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']{2,})/u,
    );
    if (loose?.[1] && !isNoise(loose[1]) && !/^hotel$/i.test(loose[1])) {
      vias.push(cleanLabel(loose[1]));
    }
  }

  // „zum Hotel und noch schnell zu Aldi“ — Aldi is via, hotel final
  if (!vias.length && hasHotel) {
    const andAlso = t.match(
      /\b(?:und|aber)\s+(?:noch\s+)?(?:schnell\s+|kurz\s+)?(?:zu|nach|bei|zum)?\s*([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-&.']{2,})/iu,
    );
    if (andAlso?.[1] && !/^hotel$/i.test(andAlso[1]) && !isNoise(andAlso[1])) {
      vias.push(cleanLabel(andAlso[1]));
    }
  }

  if (!vias.length) return null;
  if (!hasHotel && vias.length < 2) {
    // Single via without final — not a chain (discovery handles it)
    return null;
  }

  return {
    viaLabels: vias,
    finalLabel: hasHotel ? 'Hotel' : null,
    finalIsHotel: hasHotel,
  };
}

type ResolvedStop = {
  name: string;
  lat: number;
  lng: number;
  poiId: number;
};

async function resolveHotelEntity(): Promise<UserEntity | null> {
  const mem = useUserMemoryStore.getState();
  return (
    mem.getConfirmedHotel() ||
    mem.getHotelCandidate() ||
    mem.entities.filter((e) => e.type === 'hotel').slice(-1)[0] ||
    null
  );
}

async function resolvePlaceLabel(
  label: string,
  origin: { lat: number; lng: number },
): Promise<ResolvedStop | null> {
  const q = label.trim();
  if (!q) return null;

  // 1) Local pack POIs
  try {
    const pois = await getAllPois();
    const lower = q.toLowerCase();
    let best: Poi | null = null;
    let bestD = 4_000;
    for (const p of pois) {
      if (p.kind === 'approach') continue;
      const blob = `${p.name} ${p.category ?? ''} ${p.spot_key ?? ''}`.toLowerCase();
      if (!blob.includes(lower) && !lower.includes(p.name.toLowerCase().slice(0, 6))) {
        continue;
      }
      const d = haversineMeters(origin.lat, origin.lng, p.lat, p.lng);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best && bestD < 3_500) {
      return {
        name: best.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim(),
        lat: best.lat,
        lng: best.lng,
        poiId: best.id,
      };
    }
  } catch {
    // ignore
  }

  // 2) Open Places Nearby (supermarket brands etc.)
  if (hasGoogleMapsNavKey()) {
    const typeGuess = guessPlaceType(q);
    const places = await searchOpenPlacesAhead({
      lat: origin.lat,
      lng: origin.lng,
      placeType: typeGuess,
      radiusM: 2500,
      openNow: false,
    });
    const lower = q.toLowerCase();
    const hit =
      places.find((p) => p.name.toLowerCase().includes(lower)) ||
      places.find((p) => lower.includes(p.name.toLowerCase().slice(0, 4))) ||
      places[0];
    if (hit) {
      return {
        name: hit.name,
        lat: hit.lat,
        lng: hit.lng,
        poiId: -1,
      };
    }
  }

  // 3) Geocode — Bias = Live-GPS-Stadt, nie Home-Profil
  let cityHint: string | null = null;
  try {
    const { nearestCityName, loadNearbyCitiesFromIndex } = require('./fuzzyCityResolve') as {
      nearestCityName: (
        lat: number | null,
        lng: number | null,
        cities: Array<{ name: string; lat: number; lng: number }>,
      ) => string | null;
      loadNearbyCitiesFromIndex: () => Array<{
        name: string;
        lat: number;
        lng: number;
      }>;
    };
    const st = useFinnusStore.getState();
    cityHint = nearestCityName(
      st.lastGpsLat,
      st.lastGpsLng,
      loadNearbyCitiesFromIndex(),
    );
  } catch {
    cityHint = null;
  }
  const geo = await geocodePlaceName(q, {
    biasLat: origin.lat,
    biasLng: origin.lng,
    cityHint,
  });
  if (geo) {
    return {
      name: geo.label.split(',')[0]?.trim() || q,
      lat: geo.lat,
      lng: geo.lng,
      poiId: -1,
    };
  }
  return null;
}

function guessPlaceType(label: string): string {
  const l = label.toLowerCase();
  if (/aldi|lidl|rewe|edeka|penny|netto|supermarkt/.test(l)) return 'supermarket';
  if (/bäck|baeck|bäcker/.test(l)) return 'bakery';
  if (/café|cafe|starbucks|coffee/.test(l)) return 'cafe';
  if (/apotheke/.test(l)) return 'pharmacy';
  if (/tankstelle|shell|aral|esso/.test(l)) return 'gas_station';
  return 'store';
}

async function resolveHotelStop(
  hotel: UserEntity,
): Promise<ResolvedStop | null> {
  if (
    typeof hotel.lat === 'number' &&
    typeof hotel.lng === 'number' &&
    Number.isFinite(hotel.lat) &&
    Number.isFinite(hotel.lng)
  ) {
    return {
      name: hotel.name,
      lat: hotel.lat,
      lng: hotel.lng,
      poiId: hotel.poiId ?? -1,
    };
  }
  if (hotel.poiId != null && hotel.poiId >= 0) {
    const pois = await getAllPois();
    const p = pois.find((x) => x.id === hotel.poiId);
    if (p) {
      return { name: hotel.name || p.name, lat: p.lat, lng: p.lng, poiId: p.id };
    }
  }
  // Geocode hotel name as last resort
  const store = useFinnusStore.getState();
  if (store.lastGpsLat != null && store.lastGpsLng != null) {
    return resolvePlaceLabel(hotel.name, {
      lat: store.lastGpsLat,
      lng: store.lastGpsLng,
    });
  }
  return null;
}

/**
 * Plan + start: vias first, then final (hotel). Returns reply for voice.
 */
export async function planAndStartChainedNav(
  intent: ChainedNavIntent,
): Promise<{ ok: boolean; reply: string; needsHotelName?: boolean }> {
  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  if (lat == null || lng == null) {
    return {
      ok: false,
      reply: 'Kurz GPS an — dann bau ich dir die Route mit allen Stopps.',
    };
  }
  const origin = { lat, lng };

  const stops: TourStop[] = [];

  for (const label of intent.viaLabels) {
    const resolved = await resolvePlaceLabel(label, origin);
    if (!resolved) {
      return {
        ok: false,
        reply: `Hmm, ${label} find ich gerade nicht. Sag den Namen nochmal?`,
      };
    }
    stops.push({
      poiId: resolved.poiId,
      name: resolved.name,
      lat: resolved.lat,
      lng: resolved.lng,
      done: false,
    });
  }

  if (intent.finalIsHotel) {
    const hotel = await resolveHotelEntity();
    if (!hotel) {
      stashPendingChain(intent);
      useUserMemoryStore.getState().setAwaitingHotelName(true);
      const viaHint = stops[0]?.name ?? intent.viaLabels[0] ?? 'den Zwischenstopp';
      return {
        ok: false,
        needsHotelName: true,
        reply: `${viaHint} merke ich mir — aber welches Hotel meinst du? Sag den Namen, dann kett ich beides.`,
      };
    }
    if (!hotel.isConfirmed) {
      stashPendingChain(intent);
      useUserMemoryStore.getState().setPendingHotelConfirm(hotel.id);
      return {
        ok: false,
        reply: `Zwischenstopp klar. Ist ${hotel.name} dein Hotel? Sag Ja — dann leg ich die Route fest.`,
      };
    }
    const hotelStop = await resolveHotelStop(hotel);
    if (!hotelStop) {
      return {
        ok: false,
        reply: `Dein Hotel ${hotel.name} kenn ich dem Namen nach — Koordinaten fehlen noch. Sobald wir da waren, klappt’s.`,
      };
    }
    stops.push({
      poiId: hotelStop.poiId,
      name: hotelStop.name,
      lat: hotelStop.lat,
      lng: hotelStop.lng,
      done: false,
    });
  } else if (intent.finalLabel) {
    const final = await resolvePlaceLabel(intent.finalLabel, origin);
    if (!final) {
      return {
        ok: false,
        reply: `${intent.finalLabel} find ich nicht. Nochmal den Namen?`,
      };
    }
    stops.push({
      poiId: final.poiId,
      name: final.name,
      lat: final.lat,
      lng: final.lng,
      done: false,
    });
  }

  if (stops.length < 2) {
    return {
      ok: false,
      reply: 'Ich brauch mindestens zwei Ziele — z. B. „vorher Aldi, dann Hotel“.',
    };
  }

  const viaNames = stops.slice(0, -1).map((s) => s.name);
  const finalName = stops[stops.length - 1]!.name;
  const title =
    viaNames.length === 1
      ? `${viaNames[0]} → ${finalName}`
      : `${viaNames.join(' → ')} → ${finalName}`;

  let estimated = 0;
  let prev = origin;
  for (const s of stops) {
    estimated += haversineMeters(prev.lat, prev.lng, s.lat, s.lng);
    prev = s;
  }

  const tour: MultiStopTour = {
    kind: 'custom',
    title,
    targetDistanceM: null,
    targetDurationMin: null,
    estimatedDistanceM: Math.round(estimated),
    stops,
    currentIndex: 0,
  };

  const started = await startMultiStopTour(tour);
  if (!started.ok) {
    return { ok: false, reply: started.reply };
  }

  const viaJoin =
    viaNames.length === 1 ? viaNames[0] : viaNames.slice(0, -1).join(', ') + ' und ' + viaNames.slice(-1);
  return {
    ok: true,
    reply: `Passt — erst zu ${viaJoin}, danach automatisch zu ${finalName}. Route steht, wir starten.`,
  };
}
