/**
 * Einheitlicher Nav-Start: lokale POI-ID → Koordinaten → Geocode (Google/Nominatim).
 * Damit „Ja, navigieren“ und unbekannte Orte zuverlässig funktionieren.
 */

import { getAllPois, getPoiWithFacts } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { geocodePlaceNameOsmFirst } from './googleMapsNav';
import { startNavigation, startNavigationToCoords } from './navigationService';
import { recordNavSearch } from './navSearchHistory';
import { checkClosingTimeGate } from './closingTimeGate';
import { getCachedGeocodeForNav } from './landmarkCache';
import {
  lookupCachedDestinationByName,
  upsertCachedDestination,
} from './offlineNavCache';
import { isDeviceOffline } from './networkState';
import type { PendingNavOffer } from './navigationTypes';
import { suggestNearbyUnvisited } from '../research/poiDiscoveryResearch';
import {
  hasActiveTourQueue,
  weaveSpontaneousStop,
} from './multiStopTour';

/**
 * Einzelziel starten — bei laufender Tour: einweben statt Queue zu killen.
 * Gibt optional speechHint zurück (für UI/TTS).
 */
async function startNavOrWeaveIntoTour(opts: {
  name: string;
  lat: number;
  lng: number;
  poiId?: number;
  offlineOnly?: boolean;
}): Promise<{ ok: boolean; weaveSpeech?: string }> {
  if (hasActiveTourQueue()) {
    const woven = await weaveSpontaneousStop(
      {
        poiId: opts.poiId ?? -1,
        name: opts.name,
        lat: opts.lat,
        lng: opts.lng,
        done: false,
        priority: 'high',
        remindMinBefore: null,
      },
      { startNow: true },
    );
    if (woven) {
      return { ok: true, weaveSpeech: woven.speechHint };
    }
  }
  const ok = await startNavigationToCoords({
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
    poiId: opts.poiId,
    offlineOnly: opts.offlineOnly,
  });
  return { ok };
}

export type NavTargetInput = {
  poiId?: string | number | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type NavStartResult = {
  ok: boolean;
  /** lokaler POI oder -1 bei reinen Koordinaten */
  poiId: number | null;
  name: string;
  via: 'poi' | 'coords' | 'geocode' | 'none';
  message?: string;
};

function cleanName(name: string | null | undefined): string {
  return (name ?? '')
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .replace(/^📍\s*/u, '')
    .replace(/^Route:\s*/iu, '')
    .trim();
}

const VAGUE_AREA_RE =
  /\b(zentrum|ortskern|stadtmitte|stadtzentrum|ortszentrum|innenstadt|city\s*center|town\s*center|downtown|mitte\s+der\s+stadt)\b/iu;

/**
 * „Wangerooge“, „Pinneberg Zentrum“, „Ortskern“ — kein konkretes Erlebnisziel.
 */
export function isVagueAreaDestination(name: string | null | undefined): boolean {
  const n = cleanName(name).toLowerCase();
  if (!n || n.length < 2) return true;
  if (VAGUE_AREA_RE.test(n)) return true;
  const profile = getCachedUserProfile();
  const city = (profile?.cityName ?? profile?.cityId ?? '')
    .toLowerCase()
    .trim();
  if (!city) return false;
  if (n === city) return true;
  if (n === `${city} zentrum` || n === `zentrum ${city}`) return true;
  if (n.startsWith(`${city} `) && VAGUE_AREA_RE.test(n.slice(city.length))) {
    return true;
  }
  return false;
}

/**
 * Nächstes konkretes Pack-Highlight statt Stadtmitte / Ortskern.
 */
export async function resolveConcreteSightTarget(): Promise<{
  poiId: number;
  name: string;
  lat: number;
  lng: number;
} | null> {
  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }

  const nearby = await suggestNearbyUnvisited(lat, lng, 1);
  if (nearby[0]) {
    const poi = await getPoiWithFacts(nearby[0].poiId);
    if (poi) {
      return {
        poiId: poi.id,
        name: cleanName(poi.name) || nearby[0].name,
        lat: poi.lat,
        lng: poi.lng,
      };
    }
  }

  // Fallback: nächster area/legacy-POI (kein Transit/Hotel)
  try {
    const pois = await getAllPois();
    const visited = new Set(store.visitedHistory.map((v) => v.poiId));
    let best: { poiId: number; name: string; lat: number; lng: number; d: number } | null =
      null;
    for (const p of pois) {
      const kind = p.kind ?? 'legacy';
      if (kind !== 'area' && kind !== 'legacy') continue;
      const cat = (p.category ?? '').toLowerCase();
      if (/hotel|bahnhof|haltestelle|parkplatz|ferry|fähre|faehre/.test(cat)) {
        continue;
      }
      if (/hotel|bahnhof|haltestelle/.test(p.name.toLowerCase())) continue;
      if (visited.has(p.id)) continue;
      const d = Math.hypot(p.lat - lat, p.lng - lng);
      if (!best || d < best.d) {
        best = {
          poiId: p.id,
          name: cleanName(p.name) || p.name,
          lat: p.lat,
          lng: p.lng,
          d,
        };
      }
    }
    if (best) {
      return {
        poiId: best.poiId,
        name: best.name,
        lat: best.lat,
        lng: best.lng,
      };
    }
  } catch {
    /* soft */
  }
  return null;
}

/** Fuzzy-Match gegen lokale POIs (ohne actionHandler-Zyklus). */
async function matchLocalPoiId(
  target: string | number | undefined | null,
): Promise<number | null> {
  if (target == null) return null;
  if (typeof target === 'number' && Number.isFinite(target) && target >= 0) {
    const poi = await getPoiWithFacts(target);
    return poi ? target : null;
  }
  const s = String(target).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const id = Number(s);
    const poi = await getPoiWithFacts(id);
    return poi ? id : null;
  }

  const pois = await getAllPois();
  const lower = s.toLowerCase();
  const bySpot = pois.find((p) => (p.spot_key ?? '').toLowerCase() === lower);
  if (bySpot) return bySpot.id;
  const byName = pois.find((p) =>
    p.name.toLowerCase().includes(lower.replace(/_/g, ' ')),
  );
  if (byName) return byName.id;

  const tokens = lower
    .replace(/[()[\].,]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4);
  let bestId: number | null = null;
  let bestScore = 0;
  for (const poi of pois) {
    const blob = `${poi.name} ${poi.spot_key ?? ''} ${poi.category ?? ''}`.toLowerCase();
    let score = 0;
    for (const tok of tokens) {
      if (blob.includes(tok)) score += 12;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = poi.id;
    }
  }
  return bestId != null && bestScore >= 12 ? bestId : null;
}

/** Nur IDs, die wirklich in der SQLite-DB existieren. */
export async function resolveExistingPoiId(
  target: string | number | undefined | null,
): Promise<number | null> {
  return matchLocalPoiId(target);
}

function biasFromStore(): {
  biasLat?: number;
  biasLng?: number;
  cityHint?: string | null;
} {
  const store = useFinnusStore.getState();
  const profile = getCachedUserProfile();
  return {
    biasLat: store.lastGpsLat ?? undefined,
    biasLng: store.lastGpsLng ?? undefined,
    cityHint: profile?.cityName ?? profile?.cityId ?? null,
  };
}

async function resolveStoredPlaceByName(
  name: string,
): Promise<{ lat: number; lng: number; label: string } | null> {
  const cached = await lookupCachedDestinationByName(name);
  if (cached) {
    return { lat: cached.lat, lng: cached.lng, label: cached.name };
  }
  const geo = await getCachedGeocodeForNav(name);
  if (geo) return geo;
  const profile = getCachedUserProfile();
  const cityHint = profile?.cityName ?? profile?.cityId ?? null;
  if (cityHint && !name.toLowerCase().includes(cityHint.toLowerCase())) {
    return getCachedGeocodeForNav(`${name}, ${cityHint}`);
  }
  return null;
}

function rememberDestination(input: {
  name: string;
  lat: number;
  lng: number;
  poiId?: number | null;
  source: 'db_poi' | 'geocode' | 'nav' | 'offer' | 'search' | 'discovery' | 'route';
  searchQuery?: string | null;
}): void {
  void upsertCachedDestination({
    name: input.name,
    lat: input.lat,
    lng: input.lng,
    poiId: input.poiId ?? null,
    source: input.source,
    searchQuery: input.searchQuery ?? input.name,
  }).catch(() => undefined);
}

/**
 * Startet Navigation so robust wie möglich.
 * Masterbook: ETA vs. ClosingTime — warn before start when doors would be closed.
 */
export async function resolveAndStartNavigation(
  input: NavTargetInput,
  opts?: { skipClosingGate?: boolean; offlineOnly?: boolean },
): Promise<NavStartResult> {
  let nameHint = cleanName(input.name);
  let existingId = await resolveExistingPoiId(input.poiId ?? undefined);

  // „Was sehen“ / Stadtname / Ortskern → immer ein konkretes Pack-Ziel
  if (isVagueAreaDestination(nameHint) && existingId == null) {
    const concrete = await resolveConcreteSightTarget();
    if (concrete) {
      return resolveAndStartNavigation(
        {
          poiId: concrete.poiId,
          name: concrete.name,
          lat: concrete.lat,
          lng: concrete.lng,
        },
        opts,
      );
    }
  }

  const runGate = async (args: {
    name: string;
    lat: number;
    lng: number;
    poiId?: number | null;
    facts?: Array<{ fact_text: string }> | null;
  }): Promise<NavStartResult | null> => {
    if (opts?.skipClosingGate) return null;
    const gate = await checkClosingTimeGate({
      destName: args.name,
      destLat: args.lat,
      destLng: args.lng,
      poiId: args.poiId,
      facts: args.facts,
      placeHint: args.name,
    });
    if (gate.allow) return null;
    return {
      ok: false,
      poiId: args.poiId ?? null,
      name: args.name,
      via: 'none',
      message: gate.warningSpeech ?? 'Das Ziel schließt bald — ETA ist zu lang.',
    };
  };

  if (existingId != null) {
    const poi = await getPoiWithFacts(existingId);
    if (poi) {
      const blocked = await runGate({
        name: cleanName(poi.name) || nameHint || 'Ziel',
        lat: poi.lat,
        lng: poi.lng,
        poiId: poi.id,
        facts: poi.facts?.map((f) => ({ fact_text: f.fact_text })),
      });
      if (blocked) return blocked;
    }
    const poiName = cleanName(poi?.name) || nameHint || 'Ziel';
    if (poi && hasActiveTourQueue()) {
      const woven = await startNavOrWeaveIntoTour({
        name: poiName,
        lat: poi.lat,
        lng: poi.lng,
        poiId: poi.id,
        offlineOnly: opts?.offlineOnly,
      });
      if (woven.ok) {
        void recordNavSearch(poiName);
        rememberDestination({
          name: poiName,
          lat: poi.lat,
          lng: poi.lng,
          poiId: poi.id,
          source: 'db_poi',
          searchQuery: nameHint || poiName,
        });
        return {
          ok: true,
          poiId: existingId,
          name: poiName,
          via: 'poi',
          message: woven.weaveSpeech,
        };
      }
    }
    const ok = await startNavigation(existingId, { offlineOnly: opts?.offlineOnly });
    if (ok) {
      void recordNavSearch(poiName);
      if (poi) {
        rememberDestination({
          name: poiName,
          lat: poi.lat,
          lng: poi.lng,
          poiId: poi.id,
          source: 'db_poi',
          searchQuery: nameHint || poiName,
        });
      }
      return {
        ok: true,
        poiId: existingId,
        name: cleanName(poi?.name) || nameHint || 'Ziel',
        via: 'poi',
      };
    }
    // POI da, aber Nav fail → trotzdem Koordinaten versuchen
    if (poi) {
      const ok2 = await startNavOrWeaveIntoTour({
        name: cleanName(poi.name),
        lat: poi.lat,
        lng: poi.lng,
        poiId: poi.id,
        offlineOnly: opts?.offlineOnly,
      });
      if (ok2.ok) {
        void recordNavSearch(cleanName(poi.name));
        rememberDestination({
          name: cleanName(poi.name),
          lat: poi.lat,
          lng: poi.lng,
          poiId: poi.id,
          source: 'db_poi',
        });
        return {
          ok: true,
          poiId: poi.id,
          name: cleanName(poi.name),
          via: 'coords',
          message: ok2.weaveSpeech,
        };
      }
    }
  }

  if (
    typeof input.lat === 'number' &&
    typeof input.lng === 'number' &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng)
  ) {
    const label = nameHint || 'Ziel';
    const blocked = await runGate({
      name: label,
      lat: input.lat,
      lng: input.lng,
      poiId: existingId,
    });
    if (blocked) return blocked;
    const ok = await startNavOrWeaveIntoTour({
      name: label,
      lat: input.lat,
      lng: input.lng,
      poiId: existingId ?? -1,
      offlineOnly: opts?.offlineOnly,
    });
    if (ok.ok) {
      void recordNavSearch(label);
      rememberDestination({
        name: label,
        lat: input.lat,
        lng: input.lng,
        poiId: existingId,
        source: existingId != null && existingId >= 0 ? 'db_poi' : 'nav',
        searchQuery: nameHint || label,
      });
      return {
        ok: true,
        poiId: existingId ?? -1,
        name: label,
        via: 'coords',
        message: ok.weaveSpeech,
      };
    }
  }

  if (nameHint.length >= 2) {
    const offline = opts?.offlineOnly || (await isDeviceOffline());
    if (offline) {
      const stored = await resolveStoredPlaceByName(nameHint);
      if (stored) {
        const destName = stored.label || nameHint;
        const ok = await startNavOrWeaveIntoTour({
          name: destName,
          lat: stored.lat,
          lng: stored.lng,
          poiId: -1,
          offlineOnly: true,
        });
        if (ok.ok) {
          void recordNavSearch(destName);
          rememberDestination({
            name: destName,
            lat: stored.lat,
            lng: stored.lng,
            source: 'search',
            searchQuery: nameHint,
          });
          return {
            ok: true,
            poiId: -1,
            name: destName,
            via: 'geocode',
            message: ok.weaveSpeech,
          };
        }
      }
      return {
        ok: false,
        poiId: null,
        name: nameHint,
        via: 'none',
        message:
          'Diesen Ort habe ich offline noch nicht gespeichert. Einmal online suchen, dann kann ich dich später auch ohne Internet dorthin führen.',
      };
    }

    // Online: immer Google Places (+ Main Entrance wenn möglich)
    const { resolveDestinationWithEntrance } = await import(
      './resolveEntranceCoords'
    );
    const bias = biasFromStore();
    const entrance = await resolveDestinationWithEntrance({
      name: nameHint,
      biasLat: bias?.biasLat,
      biasLng: bias?.biasLng,
    });
    if (entrance.via !== 'none' && entrance.lat && entrance.lng) {
      const destName = entrance.name || nameHint;
      const blocked = await runGate({
        name: destName,
        lat: entrance.lat,
        lng: entrance.lng,
        poiId: -1,
      });
      if (blocked) return blocked;
      const ok = await startNavOrWeaveIntoTour({
        name: destName,
        lat: entrance.lat,
        lng: entrance.lng,
        poiId: -1,
        offlineOnly: opts?.offlineOnly,
      });
      if (ok.ok) {
        void recordNavSearch(destName);
        rememberDestination({
          name: destName,
          lat: entrance.lat,
          lng: entrance.lng,
          source: 'search',
          searchQuery: nameHint,
        });
        if (__DEV__) {
          console.log(
            '[nav] entrance resolve',
            entrance.via,
            entrance.usedEntrance ? 'main_entrance' : 'place',
          );
        }
        return {
          ok: true,
          poiId: -1,
          name: destName,
          via: 'geocode',
          message: ok.weaveSpeech,
        };
      }
    }

    const geo = await geocodePlaceNameOsmFirst(nameHint, biasFromStore());
    if (geo) {
      const destName = geo.label || nameHint;
      const blocked = await runGate({
        name: destName,
        lat: geo.lat,
        lng: geo.lng,
        poiId: -1,
      });
      if (blocked) return blocked;
      const ok = await startNavOrWeaveIntoTour({
        name: destName,
        lat: geo.lat,
        lng: geo.lng,
        poiId: -1,
        offlineOnly: opts?.offlineOnly,
      });
      if (ok.ok) {
        void recordNavSearch(destName);
        rememberDestination({
          name: destName,
          lat: geo.lat,
          lng: geo.lng,
          source: 'geocode',
          searchQuery: nameHint,
        });
        // Merken für „Ja“ / nochmal — nicht bei laufender Tour (Queue ist SSOT)
        if (!hasActiveTourQueue()) {
          useFinnusStore.getState().setPendingNavOffer({
            poiId: -1,
            name: geo.label || nameHint,
            lat: geo.lat,
            lng: geo.lng,
          });
        }
        return {
          ok: true,
          poiId: -1,
          name: geo.label || nameHint,
          via: 'geocode',
          message: ok.weaveSpeech,
        };
      }
    }
  }

  return {
    ok: false,
    poiId: null,
    name: nameHint || 'Ziel',
    via: 'none',
    message:
      'Dazu finde ich gerade keinen Ort für die Navigation. Sag den Namen nochmal oder prüfe, ob Google Maps in den Keys aktiv ist.',
  };
}

export async function startNavigationFromOffer(
  offer: PendingNavOffer,
): Promise<NavStartResult> {
  return resolveAndStartNavigation({
    poiId: offer.poiId >= 0 ? offer.poiId : undefined,
    name: offer.name,
    lat: offer.lat,
    lng: offer.lng,
  });
}

/**
 * Validiert/repariert START_NAVIGATION-Actions und setzt pendingNavOffer.
 * Unbekannte Orte → Geocode + Koordinaten im Payload.
 */
export async function normalizeNavActionsAndOffer(opts: {
  actions: Array<{
    type: string;
    label: string;
    payload: {
      targetPoiId?: string | number;
      destLat?: number;
      destLng?: number;
      destName?: string;
    };
  }>;
  fallbackOffer?: PendingNavOffer | null;
}): Promise<{
  actions: typeof opts.actions;
  offer: PendingNavOffer | null;
}> {
  const out = [];
  let offer: PendingNavOffer | null = opts.fallbackOffer ?? null;

  for (const a of opts.actions) {
    if (a.type !== 'START_NAVIGATION') {
      out.push(a);
      continue;
    }

    const labelName = cleanName(
      a.payload.destName || a.label.replace(/^📍\s*/u, ''),
    );
    let existingId = await resolveExistingPoiId(a.payload.targetPoiId);

    // Ortskern / Stadtname → konkretes Highlight
    if (isVagueAreaDestination(labelName) && existingId == null) {
      const concrete = await resolveConcreteSightTarget();
      if (concrete) {
        out.push({
          ...a,
          label: `📍 Route: ${concrete.name}`,
          payload: {
            ...a.payload,
            targetPoiId: concrete.poiId,
            destName: concrete.name,
            destLat: concrete.lat,
            destLng: concrete.lng,
          },
        });
        offer = {
          poiId: concrete.poiId,
          name: concrete.name,
          lat: concrete.lat,
          lng: concrete.lng,
        };
        continue;
      }
    }

    if (existingId != null) {
      const poi = await getPoiWithFacts(existingId);
      const name = cleanName(poi?.name) || labelName || 'Ziel';
      const fixed = {
        ...a,
        label: `📍 Route: ${name}`,
        payload: {
          ...a.payload,
          targetPoiId: existingId,
          destName: name,
          destLat: poi?.lat,
          destLng: poi?.lng,
        },
      };
      out.push(fixed);
      // Action is SSOT — always prefer resolved START_NAVIGATION over discovery fallback
      offer = {
        poiId: existingId,
        name,
        lat: poi?.lat,
        lng: poi?.lng,
      };
      continue;
    }

    // Ungültige ID → Koordinaten oder Geocode
    let lat = a.payload.destLat;
    let lng = a.payload.destLng;
    let name = labelName;

    if (
      (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) &&
      name.length >= 2
    ) {
      const geo = await geocodePlaceNameOsmFirst(name, biasFromStore());
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        name = geo.label || name;
      }
    }

    if (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    ) {
      const fixed = {
        ...a,
        label: `📍 Route: ${name || 'Ziel'}`,
        payload: {
          ...a.payload,
          targetPoiId: -1,
          destName: name || 'Ziel',
          destLat: lat,
          destLng: lng,
        },
      };
      out.push(fixed);
      offer = { poiId: -1, name: name || 'Ziel', lat, lng };
      continue;
    }

    // Lokal per Name suchen
    if (name.length >= 2) {
      const pois = await getAllPois();
      const lower = name.toLowerCase();
      const hit = pois.find((p) =>
        p.name.toLowerCase().includes(lower.slice(0, 24)),
      );
      if (hit) {
        out.push({
          ...a,
          label: `📍 Route: ${cleanName(hit.name)}`,
          payload: {
            targetPoiId: hit.id,
            destName: cleanName(hit.name),
            destLat: hit.lat,
            destLng: hit.lng,
          },
        });
        offer = {
          poiId: hit.id,
          name: cleanName(hit.name),
          lat: hit.lat,
          lng: hit.lng,
        };
        continue;
      }
    }

    // Action droppen wenn nichts auflösbar — sonst „kein Ort“
    console.warn('[nav] Dropping unresolved START_NAVIGATION', a.label);
  }

  // Fallback-Offer aus Kontext, wenn Gemini nichts Brauchbares hatte
  if (!offer && opts.fallbackOffer) {
    offer = opts.fallbackOffer;
    const exists = out.some((a) => a.type === 'START_NAVIGATION');
    if (!exists) {
      out.unshift({
        type: 'START_NAVIGATION',
        label: `📍 Route: ${opts.fallbackOffer.name}`,
        payload: {
          targetPoiId: opts.fallbackOffer.poiId,
          destName: opts.fallbackOffer.name,
          destLat: opts.fallbackOffer.lat,
          destLng: opts.fallbackOffer.lng,
        },
      });
    }
  }

  if (offer) {
    if (
      typeof offer.lat === 'number' &&
      typeof offer.lng === 'number' &&
      Number.isFinite(offer.lat) &&
      Number.isFinite(offer.lng)
    ) {
      rememberDestination({
        name: offer.name,
        lat: offer.lat,
        lng: offer.lng,
        poiId: offer.poiId >= 0 ? offer.poiId : null,
        source: 'offer',
        searchQuery: offer.name,
      });
    }
    useFinnusStore.getState().setPendingNavOffer(offer);
  }

  return { actions: out, offer };
}
