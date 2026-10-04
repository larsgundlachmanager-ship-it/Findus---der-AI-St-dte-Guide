/**
 * GPS ≠ Abflugstadt — echte Anreise-Task vor Flughafen-Taxi.
 * Pure detection (Node-smoke-sicher).
 */

import {
  findAirportByCityHint,
  nearestCommercialAirport,
  type CommercialAirport,
} from './airportIata';

export type OriginAccessLeg =
  | 'needed'
  | 'already_there'
  | 'hotel'
  | 'train'
  | 'unknown';

export type OriginGpsMismatch = {
  mismatch: boolean;
  gpsAirport: CommercialAirport | null;
  statedAirport: CommercialAirport | null;
  distanceKm: number | null;
};

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function normCity(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Abflugort erst committen, wenn er Sinn ergibt:
 * - Genannter Ort („von Hamburg“) gewinnt — nie still durch GPS/Prev überschreiben
 * - Origin ≠ Dest
 * - Unauflösbarer Hint → null (nachfragen), kein Fake-GPS
 */
export function pickPlausibleFlightOrigin(opts: {
  originFromHint: CommercialAirport | null;
  originFromGps: CommercialAirport | null;
  prevOrigin: CommercialAirport | null;
  dest: CommercialAirport | null;
  /** User hat explizit einen Abflugort genannt (auch wenn Lookup fehlschlägt). */
  userNamedOrigin: boolean;
}): CommercialAirport | null {
  const destIata = (opts.dest?.iata || '').trim().toUpperCase();
  const ok = (a: CommercialAirport | null): CommercialAirport | null => {
    if (!a?.iata) return null;
    if (destIata && a.iata.toUpperCase() === destIata) return null;
    return a;
  };

  if (opts.userNamedOrigin) {
    // Explizit genannt → nur der Hint. GPS darf nicht heimlich reinrutschen.
    return ok(opts.originFromHint);
  }
  return ok(opts.originFromGps) ?? ok(opts.prevOrigin);
}

/** True wenn Abflug = Ziel oder Hint nicht zu einem Flughafen auflösbar. */
export function flightOriginNeedsClarify(opts: {
  userNamedOrigin: boolean;
  origin: CommercialAirport | null;
  dest: CommercialAirport | null;
  originHint?: string | null;
}): boolean {
  if (opts.userNamedOrigin && !opts.origin) return true;
  if (
    opts.origin &&
    opts.dest &&
    opts.origin.iata.toUpperCase() === opts.dest.iata.toUpperCase()
  ) {
    return true;
  }
  return false;
}

/** Stated origin from „von Berlin“ / IATA / city hint. */
export function resolveStatedOriginAirport(opts: {
  originHint?: string | null;
  originIata?: string | null;
  userText?: string | null;
}): CommercialAirport | null {
  if (opts.originIata) {
    const { airportByIata } = require('./airportIata') as {
      airportByIata: (c: string) => CommercialAirport | null;
    };
    const byCode = airportByIata(opts.originIata);
    if (byCode) return byCode;
  }
  const hint = (opts.originHint || '').trim();
  if (hint) {
    const hit = findAirportByCityHint(hint);
    if (hit) return hit;
  }
  const t = (opts.userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const von = t.match(
    /\bvon\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+){0,2})/iu,
  );
  if (von?.[1]) {
    const hit = findAirportByCityHint(von[1]);
    if (hit) return hit;
  }
  return null;
}

/**
 * True wenn User-Abflugstadt und GPS-nächster Linienflughafen klar auseinanderliegen.
 * Default: ≥ 80 km zwischen Airports ODER unterschiedliche City-Norm.
 */
export function detectOriginGpsMismatch(opts: {
  gpsLat?: number | null;
  gpsLng?: number | null;
  originHint?: string | null;
  originIata?: string | null;
  userText?: string | null;
  minKm?: number;
}): OriginGpsMismatch {
  const minKm = opts.minKm ?? 80;
  const gpsAirport =
    opts.gpsLat != null &&
    opts.gpsLng != null &&
    Number.isFinite(opts.gpsLat) &&
    Number.isFinite(opts.gpsLng)
      ? nearestCommercialAirport(opts.gpsLat, opts.gpsLng)
      : null;
  const statedAirport = resolveStatedOriginAirport({
    originHint: opts.originHint,
    originIata: opts.originIata,
    userText: opts.userText,
  });
  if (!gpsAirport || !statedAirport) {
    return {
      mismatch: false,
      gpsAirport,
      statedAirport,
      distanceKm: null,
    };
  }
  if (gpsAirport.iata === statedAirport.iata) {
    return {
      mismatch: false,
      gpsAirport,
      statedAirport,
      distanceKm: 0,
    };
  }
  const distanceKm = haversineKm(gpsAirport, statedAirport);
  const cityDiff =
    normCity(gpsAirport.city) !== normCity(statedAirport.city);
  const mismatch = cityDiff && distanceKm >= minKm;
  return { mismatch, gpsAirport, statedAirport, distanceKm };
}

/** Live-Chips für Anreise-Task. */
export function originAccessChips(statedCity: string): Array<{
  type: 'SHOW_MORE';
  label: string;
  payload: { textPrompt: string };
}> {
  const city = (statedCity || 'Abflugort').trim() || 'Abflugort';
  return [
    {
      type: 'SHOW_MORE',
      label: `Schon in ${city}`.slice(0, 22),
      payload: { textPrompt: `Ich bin schon in ${city}` },
    },
    {
      type: 'SHOW_MORE',
      label: 'Mit Bahn hin',
      payload: { textPrompt: `Ich fahre mit der Bahn nach ${city}` },
    },
    {
      type: 'SHOW_MORE',
      label: 'Hotel Vornacht',
      payload: {
        textPrompt: `Ich übernachte vorher in ${city} im Hotel`,
      },
    },
  ];
}

export function parseOriginAccessReply(text: string): OriginAccessLeg | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (
    /\b(schon\s+(?:in|vor\s+ort|da)|bin\s+(?:schon|bereits)|bereits\s+(?:in|da)|vor\s+ort)\b/iu.test(
      t,
    )
  ) {
    return 'already_there';
  }
  if (
    /\b(hotel|übernacht|uebernacht|vornacht|tag\s+vorher|eine\s+nacht)\b/iu.test(t)
  ) {
    return 'hotel';
  }
  if (
    /\b(bahn|zug|ice|ic\b|re\s|mit\s+der\s+bahn|zugfahrt)\b/iu.test(t)
  ) {
    return 'train';
  }
  return null;
}

export type OriginAccessWorkTask = {
  id: string;
  worker: 'transit' | 'hotel' | 'chat';
  brief: string;
  dependsOn?: string | null;
  mustHaves?: string[];
  executeWhen?: 'now' | 'later' | 'on_confirm';
};

/**
 * Task zwischen Flug und Flughafen-Taxi:
 * flight → access → taxi
 */
export function buildOriginAccessWorkChain(opts: {
  mismatch: OriginGpsMismatch;
  flightTaskId?: string;
  taxiTaskId?: string;
  accessLeg?: OriginAccessLeg | null;
}): OriginAccessWorkTask[] | null {
  if (!opts.mismatch.mismatch || !opts.mismatch.statedAirport) return null;
  const flightId = opts.flightTaskId || 'flight';
  const taxiId = opts.taxiTaskId || 'taxi';
  const stated = opts.mismatch.statedAirport;
  const gps = opts.mismatch.gpsAirport;
  const leg = opts.accessLeg || 'needed';

  if (leg === 'already_there') return null;

  const accessId = 'origin_access';
  const fromLabel = gps?.city || 'GPS';
  const toLabel = stated.city;

  if (leg === 'hotel') {
    return [
      {
        id: accessId,
        worker: 'hotel',
        brief: `Anreise-Task: Hotel Vornacht in ${toLabel} (GPS=${fromLabel}) — dann Leave-by vom Hotel zum Flughafen ${stated.iata}`,
        dependsOn: flightId,
        mustHaves: ['origin_access_hotel'],
        executeWhen: 'now',
      },
      {
        id: taxiId,
        worker: 'transit',
        brief: `Taxi/Uber vom Hotel ${toLabel} zum Flughafen ${stated.iata} — Deep-Link nach Leave-by`,
        dependsOn: accessId,
        mustHaves: ['leave_by'],
        executeWhen: 'later',
      },
    ];
  }

  if (leg === 'train') {
    return [
      {
        id: accessId,
        worker: 'transit',
        brief: `Anreise-Task: Bahn ${fromLabel} → ${toLabel} (Hbf) eintragen — Verbindung + Ankunft vor Leave-by`,
        dependsOn: flightId,
        mustHaves: ['origin_access_rail'],
        executeWhen: 'now',
      },
      {
        id: taxiId,
        worker: 'transit',
        brief: `Taxi/Uber ${toLabel} Hbf/Hotel → Flughafen ${stated.iata} — Deep-Link nach Leave-by`,
        dependsOn: accessId,
        mustHaves: ['leave_by'],
        executeWhen: 'later',
      },
    ];
  }

  // needed / unknown — klären, Task sticky in Queue
  return [
    {
      id: accessId,
      worker: 'chat',
      brief: `Anreise-Task: GPS=${fromLabel}, Abflug=${toLabel} (${stated.iata}) — schon vor Ort / Bahn / Hotel Vornacht klären (Live-Chips)`,
      dependsOn: flightId,
      mustHaves: ['origin_access_clarify'],
      executeWhen: 'now',
    },
    {
      id: taxiId,
      worker: 'transit',
      brief: `Taxi/Uber zum Flughafen ${stated.iata} nach Anreise-Task — Deep-Link Just-Do-It`,
      dependsOn: accessId,
      mustHaves: ['leave_by'],
      executeWhen: 'later',
    },
  ];
}
