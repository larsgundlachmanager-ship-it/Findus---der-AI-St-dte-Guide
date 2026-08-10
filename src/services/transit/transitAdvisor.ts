/**
 * Smart Transit: konkrete Abfahrt + Verspätung + Gehzeit-Check + Nav-Angebot.
 * Live-Fahrplan: Transitous (GTFS-RT) → DB/HAFAS → Takt-Schätzung.
 * Live-Pacing: Buffer = Dep_live − (now + ETA_walk).
 */

import { haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { resolvePersonaEngine } from '../personaEngine';
import {
  getPlanBikeMPerMin,
  getPlanWalkMPerMin,
} from '../mobility/paceProfile';
import { env } from '../../config/env';
import {
  findNearestStationPoi,
  shouldRouteToFerryAdvisor,
} from './transportContext';
import { fetchLiveDeparturesForCity } from './adapters';
import {
  resolveIbnrForCity,
  resolveTransitousStopIdForCity,
} from './stationRegistry';
import {
  evaluateLivePacing,
  formatPacingSpeech,
  runLivePacing,
  type PacingResult,
} from './livePacingEngine';
import {
  isCatchMyBusQuery,
  scheduleCatchMyBusReminder,
  getActiveCatchMyBusReminder,
} from './catchMyBusReminder';
import { resolveActiveTravelMode } from '../navigation/travelModeContext';
import {
  applyWalkEtaWeatherMultiplier,
  type WeatherRoutingAdjustment,
} from '../weather/weatherRouting';
import { resolveWeatherRouting } from '../weatherService';
import { scheduleTransitDepartureReminder } from '../notifications/notificationService';
import { DEFAULT_SAFETY_BUFFER_MIN } from '../notifications/reminderMath';

export type TransitDeparture = {
  line: string;
  direction: string;
  /** Tatsächliche / erwartete Abfahrt (inkl. Verspätung, wenn Live). */
  when: Date;
  /** Planzeit laut Fahrplan (ohne Verspätung), falls bekannt. */
  plannedWhen: Date | null;
  /**
   * Verspätung in Sekunden (positiv = verspätet, 0 = pünktlich).
   * null = unbekannt (z. B. reiner Takt-Fallback).
   */
  delaySec: number | null;
  cancelled: boolean;
  /** true = nur Plan/Takt, keine Live-Realtime-Daten. */
  planned: boolean;
};

export type TransitAdvice = {
  stationPoi: Poi;
  stationName: string;
  walkMinutes: number;
  distanceM: number;
  departures: TransitDeparture[];
  source: 'live' | 'takt' | 'transitous' | 'journey';
  destinationHint: string | null;
  pacing?: PacingResult | null;
  /** Wetter-Routing (Starkregen → längere Gehzeit + Voice) */
  weather?: WeatherRoutingAdjustment | null;
  /** Door-to-door: Ankunft am Ziel */
  arrivalWhen?: Date | null;
  arrivalLabel?: string | null;
  /** Gesamtminuten A→B wenn Journey */
  journeyMinutes?: number | null;
  /** true = Journey gecacht für Stempelkarte / ÖPNV starten */
  hasJourneyNav?: boolean;
  /** Zugang zum Bahnhof: nur „Rad“ sagen wenn wirklich Bike-Mode */
  accessMode?: 'walk' | 'bike';
};

const TRANSIT_QUERY =
  /\b(wann\s+fährt|wann\s+faehrt|nächste\s+(bahn|zug|bus|s-bahn|regionalbahn)|naechste\s+(bahn|zug|bus)|abfahrt|fahrplan|verbindung|welche\s+(bahn|zug|linie)|nächster\s+zug|naechster\s+zug|wie\s+komm(?:e|)\s+ich\s+(?:nach|zu|mit)\s+(?:dem\s+)?(?:zug|bahn|bus|öpnv|oepnv|s-bahn)|öpnv|oepnv|verspät|verspaet|pünktlich|puenktlich|hat\s+die\s+(bahn|zug)|fällt\s+aus|faellt\s+aus|ausfall|verspätung|verspaetung|wann\s+muss\s+ich\s+los|mit\s+(?:dem\s+)?(?:zug|bahn|bus)|fahrkarte|bahnticket)\b/iu;

/** Explizite Fuß-/Rad-Nav zu Amenity → kein ÖPNV-Short-Circuit. */
const AMENITY_NAV_RE =
  /\b(?:navigier(?:e|en)?|bring\s+mich|führ\s+mich|fuehr\s+mich|geh(?:en)?\s+(?:wir\s+)?(?:hin\s+)?(?:zum|zur|nach)|route\s+zu(?:m|r)?|kannst\s+du\s+mich\s+(?:dahin|dort|zum|zur)|fahr\s+mich|lass\s+uns\s+(?:zum|zur))\b/iu;

const AMENITY_PLACE_RE =
  /\b(tennis|club|café|cafe|bäck|baeck|restaurant|imbiss|supermarkt|apotheke|museum|hotel|park|strand|kneipe|bar|fitness|sport(?:platz|halle|zentrum)?|schwimm|schule|kirche|bibliothek|arzt|friseur)\b/iu;

/**
 * „Navigiere zum Tennisclub“ / „bring mich dahin“ — Modul 2 / Mobility, nicht Bahn-Takt.
 */
export function isAmenityNavIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Explizite ÖPNV-Wörter → Transit behalten
  if (
    /\b(zug|bahn|bus|s-bahn|öpnv|oepnv|regionalbahn|fahrplan|abfahrt|verbindung|haltestelle|bahnhof|haltepunkt|rb\s*\d+|u-bahn|tram|straße?nbahn)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  if (AMENITY_NAV_RE.test(t) && AMENITY_PLACE_RE.test(t)) return true;
  // „kannst du mich dahin navigieren“ nach Ortsnennung im Kontext
  if (
    AMENITY_NAV_RE.test(t) &&
    /\b(dahin|dort|hin|zum|zur|nach)\b/iu.test(t) &&
    !/\b(pinneberg|hamburg|berlin|hbf|hauptbahnhof)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

/** @deprecated IBNR kommt aus Pack _transit / stationRegistry */
const STATION_IBNR: Record<string, string> = {
  prisdorf: '8004888',
};

/** Fallback-Takt wenn Live ausfällt. */
const CITY_TAKT: Record<
  string,
  {
    lines: Array<{ line: string; directions: string[]; cadenceMin: number }>;
  }
> = {
  prisdorf: {
    lines: [
      {
        line: 'RB61',
        directions: ['Pinneberg', 'Hamburg', 'Wrist', 'Itzehoe'],
        cadenceMin: 30,
      },
      {
        line: 'RB71',
        directions: ['Pinneberg', 'Hamburg', 'Tornesch', 'Elmshorn'],
        cadenceMin: 30,
      },
    ],
  },
};

/** Fallback = Default-Planungsgeschwindigkeit (~3,5 km/h), nicht Optimismus. */
const WALK_M_PER_MIN_FALLBACK = 58;
const BIKE_M_PER_MIN_FALLBACK = 220;
/** Luftlinie → realer Fußweg (Umwege, Straßen) */
const WALK_PATH_FACTOR = 1.45;
/** Minuten Puffer über Gehzeit hinaus — darunter = sportlich / nächste Bahn. */
const TIGHT_BUFFER_MIN = 5;

export function isTransitQuery(text: string): boolean {
  const t = text.trim();
  // Fähren separat über ferryAdvisor (auch standortbasiert — siehe shouldRouteToFerryAdvisor)
  if (
    /\b(fähre|faehre|ferry|harlesiel|fähranleger|faehranleger|inselbahn|anleger|überfahrt|ueberfahrt)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  // Amenity-Nav (Tennisclub, Café, …) nie als ÖPNV short-circuiten
  if (isAmenityNavIntent(t)) return false;
  return TRANSIT_QUERY.test(t) || isCatchMyBusQuery(t);
}

/** Async-Variante: schließt standortbasierte Fähr-Fragen aus. */
export async function isTransitQueryWithLocation(text: string): Promise<boolean> {
  if (!isTransitQuery(text)) return false;
  if (await shouldRouteToFerryAdvisor(text)) return false;
  return true;
}

/** Nur Abfahrtszeiten gefragt — kein Navigationsangebot nötig. */
export function isScheduleOnlyQuery(text: string): boolean {
  const t = text.trim();
  const asksDirections =
    /\b(kompass|navigation|route|hinnavig|weg\s+(dorthin|zum|zur)|wie\s+komm(?:e|)\s+ich)\b/iu.test(
      t,
    );
  return !asksDirections;
}

function cityId(): string {
  return (
    getCachedUserProfile()?.cityId ||
    env.cityId?.() ||
    'prisdorf'
  )
    .toString()
    .trim()
    .toLowerCase();
}

function extractDestinationHint(text: string): string | null {
  const m = text.match(
    /\b(?:nach|richtung|zu)\s+([A-ZÄÖÜa-zäöüß][\wäöüß\-]*(?:\s+[A-ZÄÖÜa-zäöüß][\wäöüß\-]*){0,3})/u,
  );
  if (!m?.[1]) return null;
  const dest = m[1]
    .replace(
      /\s+(bitte|jetzt|mal|mit|der|die|das|einmal|rausuchen|raussuchen|nehmen|geht|fahren|fährt|faehrt).*$/iu,
      '',
    )
    .trim();
  if (dest.length < 3) return null;
  if (/^(bahnhof|haltepunkt|station|zug|bahn)\b/iu.test(dest)) return null;
  return dest.slice(0, 60);
}

/** Zielort genannt → door-to-door Journey, nicht nur Abfahrtstafel. */
export function wantsDestinationJourney(text: string): boolean {
  const hint = extractDestinationHint(text);
  if (!hint) return false;
  // „nächste Bahn nach X“ / „Verbindung nach X“ / Hbf
  return (
    /\b(nach|richtung)\b/iu.test(text) &&
    (/\b(hauptbahnhof|hbf|bahnhof)\b/iu.test(text) ||
      /\b(hamburg|berlin|münchen|muenchen|köln|koeln|bremen|kiel|lübeck|luebeck|pinneberg)\b/iu.test(
        hint,
      ) ||
      hint.split(/\s+/).length >= 1)
  );
}

async function findStationPoi(): Promise<Poi | null> {
  return findNearestStationPoi();
}

function walkMinutesForDistance(
  distanceM: number,
  weather?: WeatherRoutingAdjustment | null,
): { minutes: number; mode: 'walk' | 'bike' } {
  const travel = resolveActiveTravelMode().mode;
  const mobility =
    travel === 'bike'
      ? 'bike'
      : resolvePersonaEngine(getCachedUserProfile()).mobilityMode;
  const useBike = mobility === 'bike' || travel === 'bike';
  let mpm: number;
  try {
    mpm = useBike ? getPlanBikeMPerMin() : getPlanWalkMPerMin();
  } catch {
    mpm = useBike ? BIKE_M_PER_MIN_FALLBACK : WALK_M_PER_MIN_FALLBACK;
  }
  // Haversine ist Luftlinie — Fußweg länger (Pfadfaktor); Rad etwas weniger
  const pathM = distanceM * (useBike ? 1.2 : WALK_PATH_FACTOR);
  const base = Math.max(1, Math.ceil(pathM / mpm));
  const minutes = weather
    ? applyWalkEtaWeatherMultiplier(base, weather.walkEtaMultiplier)
    : base;
  return { minutes, mode: useBike ? 'bike' : 'walk' };
}

function formatClock(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function minutesUntil(d: Date, now = new Date()): number {
  return Math.max(0, Math.round((d.getTime() - now.getTime()) / 60_000));
}

function delayMinutes(delaySec: number | null): number | null {
  if (delaySec == null) return null;
  return Math.round(delaySec / 60);
}

/** Kurzer Status für Sprache & Karte. */
export function formatDelayStatus(dep: TransitDeparture): string {
  if (dep.cancelled) return 'fällt aus';
  const mins = delayMinutes(dep.delaySec);
  if (mins == null) return 'Verspätung unbekannt';
  if (mins <= 0) return 'pünktlich';
  if (mins === 1) return '+1 Minute';
  return `+${mins} Minuten`;
}

function delaySpeechClause(dep: TransitDeparture): string {
  if (dep.cancelled) {
    return 'Die fällt aktuell aus.';
  }
  const mins = delayMinutes(dep.delaySec);
  if (mins == null) {
    return '';
  }
  if (mins <= 0) {
    return 'Laut Live-Daten fährt sie pünktlich.';
  }
  const planned =
    dep.plannedWhen != null
      ? `Plan war ${formatClock(dep.plannedWhen)} Uhr — `
      : '';
  if (mins === 1) {
    return `${planned}aktuell eine Minute Verspätung.`;
  }
  return `${planned}aktuell ${mins} Minuten Verspätung.`;
}

async function fetchLiveDepartures(
  ibnr: string,
  destinationHint: string | null,
  city?: string,
  station?: Poi | null,
): Promise<{ deps: TransitDeparture[]; source: 'live' | 'transitous' } | null> {
  const cityKey = city ?? cityId();
  const live = await fetchLiveDeparturesForCity({
    cityId: cityKey,
    stopId: ibnr,
    directionHint: destinationHint,
    limit: 6,
    stationLat: station?.lat,
    stationLng: station?.lng,
    stationName: station?.name,
    transitousStopId: resolveTransitousStopIdForCity(cityKey),
  });
  if (!live?.departures?.length) return null;
  return {
    source: live.source === 'transitous' ? 'transitous' : 'live',
    deps: live.departures.map((d) => ({
      line: d.line,
      direction: d.direction,
      when: d.when,
      plannedWhen: d.plannedWhen,
      delaySec: d.delaySec,
      cancelled: d.cancelled,
      planned: d.planned,
    })),
  };
}

function buildTaktDepartures(
  city: string,
  destinationHint: string | null,
  now = new Date(),
): TransitDeparture[] {
  const cfg = CITY_TAKT[city];
  if (!cfg) return [];
  const hint = destinationHint?.toLowerCase() ?? null;
  const out: TransitDeparture[] = [];

  cfg.lines.forEach((line, lineIdx) => {
    let dir = line.directions[0] ?? '—';
    if (hint) {
      // Explizites Match zuerst (Hamburg vor Pinneberg!)
      const ranked = [...line.directions].sort((a, b) => {
        const score = (d: string) => {
          const dl = d.toLowerCase();
          if (hint.includes(dl) || dl.includes(hint.split(/\s+/)[0] ?? '')) {
            return 2;
          }
          if (/hamburg/i.test(hint) && /hamburg/i.test(d)) return 3;
          if (/pinneberg/i.test(hint) && /pinneberg/i.test(d)) return 3;
          return 0;
        };
        return score(b) - score(a);
      });
      const match = ranked.find((d) => {
        const dl = d.toLowerCase();
        if (/hamburg/i.test(hint)) return /hamburg/i.test(d);
        if (/pinneberg/i.test(hint)) return /pinneberg/i.test(d);
        return (
          dl.includes(hint) ||
          hint.includes(dl) ||
          hint.split(/\s+/).some((t) => t.length >= 4 && dl.includes(t))
        );
      });
      if (match) dir = match;
    }

    const cadence = Math.max(15, line.cadenceMin);
    const offsetMin = lineIdx * Math.floor(cadence / 2);
    const base = new Date(now.getTime() + 3 * 60_000);
    const minutes =
      Math.ceil((base.getMinutes() - offsetMin) / cadence) * cadence +
      offsetMin;
    const first = new Date(base);
    first.setSeconds(0, 0);
    first.setMinutes(0);
    first.setMinutes(minutes);
    while (first.getTime() <= now.getTime()) {
      first.setMinutes(first.getMinutes() + cadence);
    }

    for (let i = 0; i < 3; i++) {
      const when = new Date(first.getTime() + i * cadence * 60_000);
      out.push({
        line: line.line,
        direction: dir,
        when,
        plannedWhen: when,
        delaySec: null,
        cancelled: false,
        planned: true,
      });
    }
  });

  out.sort((a, b) => a.when.getTime() - b.when.getTime());
  return out.slice(0, 4);
}

export async function buildTransitAdvice(
  text: string,
): Promise<TransitAdvice | null> {
  if (!isTransitQuery(text)) return null;

  const station = await findStationPoi();
  if (!station) return null;

  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;

  const stationNamePreview = station.name
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .replace(/\s+und\s+historisches.*$/i, '')
    .trim();

  const weather = await resolveWeatherRouting({
    lat: lat ?? undefined,
    lng: lng ?? undefined,
    stationName: stationNamePreview,
  });

  let distanceM = 0;
  let walkMinutes = applyWalkEtaWeatherMultiplier(8, weather.walkEtaMultiplier);
  let accessMode: 'walk' | 'bike' = 'walk';
  if (lat != null && lng != null) {
    distanceM = Math.round(haversineMeters(lat, lng, station.lat, station.lng));
    const access = walkMinutesForDistance(distanceM, weather);
    walkMinutes = access.minutes;
    accessMode = access.mode;
  }

  const destinationHint = extractDestinationHint(text);
  const city = cityId();
  const ibnr = resolveIbnrForCity(city) || STATION_IBNR[city];
  let departures: TransitDeparture[] = [];
  let source: 'live' | 'takt' | 'transitous' | 'journey' = 'takt';

  if (ibnr) {
    const live = await fetchLiveDepartures(
      ibnr,
      destinationHint,
      city,
      station,
    );
    if (live?.deps?.length) {
      departures = live.deps;
      source = live.source;
    }
  }
  // Kein Takt-Erfinden, wenn User ein konkretes Ziel genannt hat
  if (!departures.length && !destinationHint) {
    departures = buildTaktDepartures(city, destinationHint);
    source = 'takt';
  }

  const stationName = stationNamePreview;

  const firstRunnable =
    departures.find((d) => !d.cancelled) ?? departures[0] ?? null;
  let pacing: PacingResult | null = null;
  if (firstRunnable && source !== 'takt') {
    const { getNavPhase } = await import('../navigation/boardingDetector');
    pacing = await runLivePacing({
      departure: firstRunnable,
      walkEtaMin: walkMinutes,
      from: lat != null && lng != null ? { lat, lng } : null,
      to: { lat: station.lat, lng: station.lng },
      skipRebook: getNavPhase() === 'in_transit',
    });
  } else if (firstRunnable) {
    const base = evaluateLivePacing({
      departure: firstRunnable,
      walkEtaMin: walkMinutes,
    });
    pacing = {
      ...base,
      speech: formatPacingSpeech(base),
      nextConnection: null,
    };
  }

  if (pacing && weather.isHeavyRain && weather.voiceAlert) {
    pacing = {
      ...pacing,
      speech: `${pacing.speech} ${weather.voiceAlert}`,
    };
  }

  return {
    stationPoi: station,
    stationName,
    walkMinutes,
    distanceM,
    departures,
    source,
    destinationHint,
    pacing,
    weather,
    accessMode,
  };
}

function navOfferClause(offerNavigation: boolean): string {
  if (!offerNavigation) return '';
  // Just-Do-It: Button startet Nav — keine Permission-Frage in der Speech
  return ' Route zum Bahnhof liegt bereit.';
}

/**
 * Deterministische Kumpel-Antwort inkl. Verspätung, Gehzeit-Check + optional Nav-Angebot.
 * Nutzt Live-Pacing-Szenarien (Entwarnung / Ansporn / Neu-Berechnung).
 */
export function formatTransitReply(
  advice: TransitAdvice,
  offerNavigation = true,
): string {
  const now = new Date();
  const runnable = advice.departures.filter((d) => !d.cancelled);
  const first = runnable[0] ?? advice.departures[0];
  const second = runnable[1] ?? advice.departures[1] ?? first;
  const accessMode =
    advice.accessMode ??
    (resolveActiveTravelMode().mode === 'bike' ? 'bike' : 'walk');
  const accessPhrase =
    accessMode === 'bike'
      ? `Du brauchst von hier aus etwa ${advice.walkMinutes} Minuten mit dem Rad`
      : advice.distanceM > 0
        ? `Du brauchst von hier aus gut ${advice.walkMinutes} Minuten zu Fuß`
        : `Rechne mit etwa ${advice.walkMinutes} Minuten Fußweg zum Bahnhof`;

  if (!first) {
    if (advice.destinationHint) {
      return (
        `Für ${advice.destinationHint} krieg ich gerade keine belegte Live-Verbindung vom ${advice.stationName}. ` +
        `Kurz die Bahn-App oder den Aushang checken — ich erfinde keine Linie.` +
        navOfferClause(offerNavigation)
      );
    }
    return (
      `Am ${advice.stationName} komm ich gerade nicht an aktuelle Abfahrten ran — am besten kurz die Bahn-App oder den Aushang vor Ort checken.` +
      navOfferClause(offerNavigation)
    );
  }

  // Door-to-door Journey: Abfahrt + Ankunft immer zu Ende erzählen
  if (
    advice.source === 'journey' &&
    advice.arrivalWhen &&
    advice.arrivalLabel
  ) {
    const untilFirst = minutesUntil(first.when, now);
    const leaveIn = Math.max(0, untilFirst - advice.walkMinutes - TIGHT_BUFFER_MIN);
    const tight = untilFirst < advice.walkMinutes + TIGHT_BUFFER_MIN;
    const arrive = formatClock(advice.arrivalWhen);
    const total =
      advice.journeyMinutes != null
        ? ` Gesamtfahrt ca. ${advice.journeyMinutes} Minuten.`
        : '';
    const delayClause = delaySpeechClause(first);
    let body =
      `Die nächste sinnvolle Verbindung nach ${advice.arrivalLabel}: ${first.line} ab ${advice.stationName} um ${formatClock(first.when)} Uhr` +
      (first.direction ? ` Richtung ${first.direction}` : '') +
      `. ` +
      (delayClause ? `${delayClause} ` : '') +
      `Ankunft gegen ${arrive} Uhr.${total} `;
    if (tight && second && second.when.getTime() !== first.when.getTime()) {
      body +=
        `${accessPhrase} — das wird richtig sportlich. Wenn du sprinten willst, ok; sonst nimm die nächste um ${formatClock(second.when)} Uhr` +
        (second.direction ? ` Richtung ${second.direction}` : '') +
        `. `;
    } else if (leaveIn <= 0) {
      body += `${accessPhrase} — am besten jetzt los. `;
    } else {
      body += `${accessPhrase}. Du hast noch etwa ${leaveIn} Minuten, bis du los solltest — kein Stress. `;
    }
    return body.trim() + navOfferClause(offerNavigation);
  }

  // Live-Pacing hat Vorrang (Entwarnung / Zahn zulegen / verpasst)
  if (
    advice.pacing &&
    (advice.pacing.scenario === 'relaxed' ||
      advice.pacing.scenario === 'tight' ||
      advice.pacing.scenario === 'missed')
  ) {
    // Pacing-Speech oft abgeschnitten — Ankunft/Ziel + Alternative anhängen
    let speech = advice.pacing.speech.replace(/\s+/g, ' ').trim();
    if (advice.destinationHint && !/ankunft|ankommen/i.test(speech)) {
      speech += ` Richtung ${first.direction}.`;
    }
    if (
      advice.pacing.scenario === 'tight' &&
      second &&
      second.when.getTime() !== first.when.getTime() &&
      !/nächste|danach|sonst/i.test(speech)
    ) {
      speech += ` Sonst die ${second.line} um ${formatClock(second.when)} Uhr.`;
    }
    return speech + navOfferClause(offerNavigation);
  }

  if (first.cancelled) {
    const next = runnable[0];
    if (next) {
      const nextDelay = delaySpeechClause(next);
      return (
        `Die nächste ${first.line} Richtung ${first.direction} fällt gerade aus. ` +
        `Danach kommt die ${next.line} um ${formatClock(next.when)} Uhr` +
        (nextDelay ? ` — ${nextDelay}` : '.') +
        ` ${accessPhrase}.` +
        navOfferClause(offerNavigation)
      );
    }
    return (
      `Laut Live-Daten fällt die nächste Bahn am ${advice.stationName} gerade aus.` +
      navOfferClause(offerNavigation)
    );
  }

  const untilFirst = minutesUntil(first.when, now);
  const tight = untilFirst < advice.walkMinutes + TIGHT_BUFFER_MIN;
  const weatherClause =
    advice.weather?.isHeavyRain && advice.weather.voiceAlert
      ? ` ${advice.weather.voiceAlert}`
      : '';

  const line1 = first.line.replace(/\s+/g, ' ');
  const dir1 = first.direction;
  const t1 = formatClock(first.when);
  const delayClause = delaySpeechClause(first);
  const liveGap =
    advice.source === 'takt'
      ? ' Live-Verspätungen fehlen gerade (DB/HAFAS nicht erreichbar) — das ist der übliche Takt, keine Live-Garantie.'
      : '';

  if (tight && second && second.when.getTime() !== first.when.getTime()) {
    const line2 = second.line.replace(/\s+/g, ' ');
    const t2 = formatClock(second.when);
    const delay2 = delaySpeechClause(second);
    return (
      `Die nächste ${line1} Richtung ${dir1} fährt um ${t1} Uhr am ${advice.stationName} ab. ` +
      (delayClause ? `${delayClause} ` : '') +
      `${accessPhrase} — die wäre also richtig sportlich! ` +
      `Mein Tipp: Nimm entspannt die ${line2} um ${t2} Uhr` +
      (delay2 ? ` (${delay2.replace(/\.$/, '')})` : '') +
      `. Dann hast du am Bahnsteig noch ein paar Minuten Puffer.` +
      weatherClause +
      liveGap +
      navOfferClause(offerNavigation)
    );
  }

  const leaveIn = Math.max(0, untilFirst - advice.walkMinutes - TIGHT_BUFFER_MIN);
  return (
    `Die nächste ${line1} Richtung ${dir1} fährt um ${t1} Uhr am ${advice.stationName} ab. ` +
    (delayClause ? `${delayClause} ` : '') +
    `${accessPhrase.replace(' aber', '')}` +
    (leaveIn > 2
      ? ` — du hast noch etwa ${leaveIn} Minuten, bis du los solltest.`
      : ' — das passt entspannt.') +
    weatherClause +
    liveGap +
    navOfferClause(offerNavigation)
  );
}

/** Prompt-Block falls die Frage doch an Gemini geht. */
export function buildTransitPromptBlock(advice: TransitAdvice): string {
  const now = new Date();
  const rows = advice.departures
    .slice(0, 4)
    .map((d) => {
      const until = minutesUntil(d.when, now);
      const status = formatDelayStatus(d);
      const planned =
        d.plannedWhen != null
          ? `, Plan ${formatClock(d.plannedWhen)}`
          : '';
      return `- ${d.line} → ${d.direction}: ${formatClock(d.when)} Uhr (in ${until} Min., ${status}${planned})`;
    })
    .join('\n');

  const liveNote =
    advice.source === 'live' || advice.source === 'transitous'
      ? 'Live-Abfahrten inkl. Verspätung/Ausfall — Status GENAU so sagen (pünktlich / +X Min / fällt aus).'
      : 'Nur üblicher Takt — KEINE Verspätung behaupten. Sag ehrlich, dass Live-Daten gerade fehlen.';

  const pacingNote = advice.pacing
    ? `Live-Pacing: Szenario=${advice.pacing.scenario}, Buffer=${advice.pacing.bufferMin} Min, Delay=${advice.pacing.delayMin ?? '—'} Min.`
    : '';

  return `
=== ECHTE TRANSIT- & EMPFEHLUNGS-LOGIK (PFLICHT) ===
Station: ${advice.stationName}
Gehzeit vom Nutzer: ca. ${advice.walkMinutes} Minuten (${advice.distanceM > 0 ? `${advice.distanceM} m` : 'Distanz geschätzt'})
Fahrplan-Quelle: ${
    advice.source === 'transitous'
      ? 'Transitous (GTFS-RT)'
      : advice.source === 'live'
        ? 'Live-Abfahrten (DB/HAFAS)'
        : 'üblicher Takt (RB61/RB71)'
  }
${liveNote}
${pacingNote}
${advice.destinationHint ? `Ziel-Hinweis des Users: ${advice.destinationHint}` : ''}
${advice.weather?.promptBlock ?? ''}

Nächste Abfahrten (NUR DIESE Zeiten & Status nennen — nichts erfinden):
${rows}

Regeln:
1. Nenne konkrete Linie + Uhrzeit + Richtung + Verspätungsstatus (wenn Live).
2. Vergleiche Restzeit bis Abfahrt mit Gehzeit. Ist es knapp (< Gehzeit + 2 Min): sag klar, dass er die Bahn nicht stressfrei schafft, und empfehle die nächste.
3. Bei Ausfall: klar sagen und nächste Alternative nennen.
4. Bei Verspätung ≥ 3 Min Puffer: Entwarnung („entspannt laufen“).
5. Schließe IMMER mit: „Route zum Bahnhof liegt bereit.“ (Button startet — nicht fragen)
6. Ton: hilfsbereiter Kumpel im Ohr — kein DB-App-Verweis als Ausweichmanöver.
7. Bei Starkregen: mehr Laufzeit + überdachten Weg erwähnen (siehe WETTER-ROUTING).
8. 3–5 Sätze, flüssig, kein Markdown.
`.trim();
}

/** Door-to-door Live-Journey für „Bahn nach X / Hamburg Hbf“. */
async function tryDestinationJourneyAdvice(
  text: string,
): Promise<{
  advice: TransitAdvice;
  reply: string;
  offerNavigation: boolean;
} | null> {
  const destHint = extractDestinationHint(text);
  if (!destHint) return null;

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

  const station = await findStationPoi();
  if (!station) return null;

  let destLat: number | null = null;
  let destLng: number | null = null;
  let destName = destHint;

  try {
    const { searchDbLocations } = await import('./dbRestJourneys');
    const hits = await searchDbLocations(destHint, {
      lat,
      lng,
      results: 8,
    });
    const preferred =
      hits.find((h) => /hauptbahnhof|\bhbf\b/i.test(h.name)) ??
      hits.find((h) =>
        destHint
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length >= 4)
          .every((t) => h.name.toLowerCase().includes(t)),
      ) ??
      hits[0];
    if (preferred) {
      destLat = preferred.lat;
      destLng = preferred.lng;
      destName = preferred.name;
    }
  } catch {
    /* geocode fallback */
  }

  if (destLat == null || destLng == null) {
    try {
      const { geocodePlaceName } = await import('../navigation/googleMapsNav');
      const g = await geocodePlaceName(destHint, {
        biasLat: lat,
        biasLng: lng,
      });
      if (g) {
        destLat = g.lat;
        destLng = g.lng;
        destName = g.label || destHint;
      }
    } catch {
      return null;
    }
  }
  if (destLat == null || destLng == null) return null;

  if (haversineMeters(destLat, destLng, station.lat, station.lng) < 400) {
    return null;
  }

  const { planJourney } = await import('./journeyPlanner');
  const plan = await planJourney({
    from: { lat, lng },
    to: { lat: destLat, lng: destLng },
    travelMode: 'transit',
    numItineraries: 4,
  });
  if (!plan.itineraries.length) return null;

  const now = Date.now();
  const weather = await resolveWeatherRouting({
    lat,
    lng,
    stationName: station.name,
  });
  const distanceM = Math.round(
    haversineMeters(lat, lng, station.lat, station.lng),
  );
  const access = walkMinutesForDistance(distanceM, weather);

  const scored = plan.itineraries
    .map((it) => {
      const dep = it.firstTransitDeparture ?? it.startTime;
      const untilDep = (dep.getTime() - now) / 60_000;
      const catchable = untilDep >= access.minutes + 1;
      const last = it.legs[it.legs.length - 1];
      const endDist =
        last?.toLat != null && last?.toLng != null
          ? haversineMeters(last.toLat, last.toLng, destLat!, destLng!)
          : 0;
      return { it, untilDep, catchable, endDist };
    })
    .filter((x) => x.endDist < 2_500)
    .sort((a, b) => {
      if (a.catchable !== b.catchable) return a.catchable ? -1 : 1;
      return a.it.endTime.getTime() - b.it.endTime.getTime();
    });

  const best = scored[0]?.it;
  const alt = scored[1]?.it ?? null;
  if (!best) return null;

  const { rememberJourneyForStart } = await import(
    '../navigation/journeyStartCache'
  );
  rememberJourneyForStart({
    itinerary: best,
    destName,
    destLat,
    destLng,
  });

  const firstTransit = best.legs.find(
    (l) => l.mode !== 'WALK' && l.mode !== 'BIKE',
  );
  const depWhen =
    best.firstTransitDeparture ?? firstTransit?.startTime ?? best.startTime;
  const line = best.firstTransitLine ?? firstTransit?.line ?? 'Bahn';
  const direction =
    firstTransit?.headsign?.trim() ||
    firstTransit?.toName?.trim() ||
    destName;

  const departures: TransitDeparture[] = [
    {
      line,
      direction,
      when: depWhen,
      plannedWhen: firstTransit?.scheduledStart ?? depWhen,
      delaySec: best.firstTransitDelaySec,
      cancelled: false,
      planned: !firstTransit?.realTime,
    },
  ];
  if (alt) {
    const altTransit = alt.legs.find(
      (l) => l.mode !== 'WALK' && l.mode !== 'BIKE',
    );
    const altDep =
      alt.firstTransitDeparture ?? altTransit?.startTime ?? alt.startTime;
    departures.push({
      line: alt.firstTransitLine ?? altTransit?.line ?? 'Bahn',
      direction:
        altTransit?.headsign?.trim() ||
        altTransit?.toName?.trim() ||
        destName,
      when: altDep,
      plannedWhen: altTransit?.scheduledStart ?? altDep,
      delaySec: alt.firstTransitDelaySec,
      cancelled: false,
      planned: !altTransit?.realTime,
    });
  }

  const walkMin =
    best.walkToStopSec != null
      ? Math.max(1, Math.round(best.walkToStopSec / 60))
      : access.minutes;

  const advice: TransitAdvice = {
    stationPoi: station,
    stationName: station.name
      .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
      .replace(/\s+und\s+historisches.*$/i, '')
      .trim(),
    walkMinutes: walkMin,
    distanceM,
    departures,
    source: 'journey',
    destinationHint: destHint,
    weather,
    accessMode: access.mode,
    arrivalWhen: best.endTime,
    arrivalLabel: destName,
    journeyMinutes: Math.max(1, Math.round(best.durationSec / 60)),
    hasJourneyNav: true,
    pacing: null,
  };

  useFinnusStore.getState().setPendingNavOffer({
    poiId: station.id,
    name: station.name,
    lat: destLat,
    lng: destLng,
  });

  void scheduleTransitDepartureReminder({
    departureMs: depWhen.getTime(),
    walkEtaMinutes: walkMin,
    line,
    stationName: advice.stationName,
    safetyBufferMin: DEFAULT_SAFETY_BUFFER_MIN,
    reminderKey: `journey:${station.id}:${line}:${depWhen.getTime()}`,
  }).catch(() => undefined);

  return {
    advice,
    reply: formatTransitReply(advice, true),
    offerNavigation: true,
  };
}

export async function prepareTransitFollowUp(text: string): Promise<{
  advice: TransitAdvice;
  reply: string;
  offerNavigation: boolean;
} | null> {
  // Ziel genannt → Live door-to-door (Ankunft + echte Linie), kein Takt-Fantasie
  if (wantsDestinationJourney(text)) {
    const destJourney = await tryDestinationJourneyAdvice(text);
    if (destJourney) return destJourney;
  }

  const advice = await buildTransitAdvice(text);
  if (!advice) return null;

  const catchMyBus = isCatchMyBusQuery(text);
  const offerNavigation = !isScheduleOnlyQuery(text) && !catchMyBus;

  if (catchMyBus) {
    const first =
      advice.departures.find((d) => !d.cancelled) ?? advice.departures[0];
    if (first) {
      const { reminder, confirmSpeech } = scheduleCatchMyBusReminder({
        departure: first,
        walkEtaMin: advice.walkMinutes,
        destinationHint: advice.destinationHint,
        stationName: advice.stationName,
        destLat: advice.stationPoi.lat,
        destLng: advice.stationPoi.lng,
      });
      void reminder;
      // Feed guardian with live status so cancel/delay triggers Plan B
      try {
        const { reportConnectionDisruption } = await import(
          '../logistics/logisticsTriggerEngine'
        );
        const eventId = `catch-bus-${getActiveCatchMyBusReminder()?.id ?? ''}`;
        if (first.cancelled) {
          reportConnectionDisruption({
            eventId,
            status: 'cancelled',
            note: `${first.line} fällt aus`,
          });
        } else if (first.delaySec != null && first.delaySec >= 180) {
          reportConnectionDisruption({
            eventId,
            status: 'delayed',
            delayMin: Math.round(first.delaySec / 60),
            note: `${first.line} +${Math.round(first.delaySec / 60)} Min`,
          });
        }
      } catch {
        /* optional */
      }
      return {
        advice,
        reply: confirmSpeech,
        offerNavigation: false,
      };
    }
  }

  if (offerNavigation) {
    useFinnusStore.getState().setPendingNavOffer({
      poiId: advice.stationPoi.id,
      name: advice.stationName,
    });
  } else {
    useFinnusStore.getState().setPendingNavOffer(null);
  }

  // Auch bei normaler Abfahrtsfrage: OS-Push zum Leave-by planen
  const firstRunnable =
    advice.departures.find((d) => !d.cancelled) ?? advice.departures[0];
  if (firstRunnable) {
    void scheduleTransitDepartureReminder({
      departureMs: firstRunnable.when.getTime(),
      walkEtaMinutes: advice.walkMinutes,
      line: firstRunnable.line,
      stationName: advice.stationName,
      safetyBufferMin: DEFAULT_SAFETY_BUFFER_MIN,
      reminderKey: `${advice.stationPoi.id}:${firstRunnable.line}:${firstRunnable.when.getTime()}`,
    }).catch((err) => {
      console.warn('[transit] schedule reminder failed:', err);
    });
  }

  return {
    advice,
    reply: formatTransitReply(advice, offerNavigation),
    offerNavigation,
  };
}
