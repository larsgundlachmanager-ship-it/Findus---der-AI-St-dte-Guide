/**
 * Smart Transit: konkrete Abfahrt + Verspätung + Gehzeit-Check + Nav-Angebot.
 * Live-Fahrplan via db.transport.rest (wenn erreichbar), sonst Takt-Schätzung.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { resolvePersonaEngine } from '../personaEngine';
import { env } from '../../config/env';
import {
  findNearestStationPoi,
  shouldRouteToFerryAdvisor,
} from './transportContext';

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
  source: 'live' | 'takt';
  destinationHint: string | null;
};

const TRANSIT_QUERY =
  /\b(wann\s+fährt|wann\s+faehrt|nächste\s+(bahn|zug|bus|s-bahn|regionalbahn)|naechste\s+(bahn|zug|bus)|abfahrt|fahrplan|verbindung|welche\s+(bahn|zug|linie)|nächster\s+zug|naechster\s+zug|wie\s+komm(?:e|)\s+ich\s+nach|verspät|verspaet|pünktlich|puenktlich|hat\s+die\s+(bahn|zug)|fällt\s+aus|faellt\s+aus|ausfall|verspätung|verspaetung)\b/iu;

const DB_REST = 'https://v6.db.transport.rest';
const FETCH_MS = 5_000;

/** Bekannte Halte → IBNR für Live-Abfahrten. */
const STATION_IBNR: Record<string, string> = {
  prisdorf: '8004878',
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

const WALK_M_PER_MIN = 80;
const BIKE_M_PER_MIN = 220;
/** Minuten Puffer: darunter = „schaffst du nicht stressfrei“. */
const TIGHT_BUFFER_MIN = 2;

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
  return TRANSIT_QUERY.test(t);
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
    /\b(?:nach|richtung|zu)\s+([A-ZÄÖÜa-zäöüß][\wäöüß\-]*(?:\s+[A-ZÄÖÜa-zäöüß][\wäöüß\-]*){0,2})/u,
  );
  if (!m?.[1]) return null;
  const dest = m[1]
    .replace(/\s+(bitte|jetzt|mal|mit|der|die|das).*$/iu, '')
    .trim();
  if (dest.length < 3) return null;
  if (/^(bahnhof|haltepunkt|station|zug|bahn)\b/iu.test(dest)) return null;
  return dest.slice(0, 40);
}

async function findStationPoi(): Promise<Poi | null> {
  return findNearestStationPoi();
}

function walkMinutesForDistance(distanceM: number): number {
  const mobility = resolvePersonaEngine(getCachedUserProfile()).mobilityMode;
  const mpm = mobility === 'bike' ? BIKE_M_PER_MIN : WALK_M_PER_MIN;
  return Math.max(1, Math.ceil(distanceM / mpm));
}

function formatClock(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function minutesUntil(d: Date, now = new Date()): number {
  return Math.max(0, Math.round((d.getTime() - now.getTime()) / 60_000));
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Verspätung in Sekunden aus API-Feld oder Differenz when − plannedWhen. */
function resolveDelaySec(
  delay: number | null | undefined,
  when: Date,
  plannedWhen: Date | null,
): number | null {
  if (typeof delay === 'number' && Number.isFinite(delay)) {
    return Math.round(delay);
  }
  if (plannedWhen) {
    return Math.round((when.getTime() - plannedWhen.getTime()) / 1000);
  }
  return null;
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
  if (mins === 1) return '+1 Min';
  return `+${mins} Min`;
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
    dep.plannedWhen != null ? `Plan war ${formatClock(dep.plannedWhen)} Uhr — ` : '';
  if (mins === 1) {
    return `${planned}aktuell eine Minute Verspätung.`;
  }
  return `${planned}aktuell ${mins} Minuten Verspätung.`;
}

async function fetchLiveDepartures(
  ibnr: string,
  destinationHint: string | null,
): Promise<TransitDeparture[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const url = `${DB_REST}/stops/${encodeURIComponent(ibnr)}/departures?duration=120&results=12&remarks=true`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      departures?: Array<{
        when?: string | null;
        plannedWhen?: string | null;
        delay?: number | null;
        cancelled?: boolean | null;
        direction?: string;
        line?: { name?: string; productName?: string };
      }>;
    };
    const list = data.departures ?? [];
    if (list.length === 0) return null;

    const hint = destinationHint?.toLowerCase() ?? null;
    const mapped: TransitDeparture[] = [];
    for (const d of list) {
      const cancelled = d.cancelled === true;
      const plannedWhen = parseIsoDate(d.plannedWhen);
      const when =
        parseIsoDate(d.when) ??
        (cancelled ? plannedWhen : null) ??
        plannedWhen;
      if (!when) continue;
      // Ausfälle behalten; vergangene Abfahrten (ohne Ausfall) skippen
      if (
        !cancelled &&
        when.getTime() < Date.now() - 60_000
      ) {
        continue;
      }
      const delaySec = cancelled
        ? null
        : resolveDelaySec(d.delay, when, plannedWhen);
      const direction = (d.direction ?? '').trim() || 'unbekannt';
      mapped.push({
        line: (d.line?.name || d.line?.productName || 'Zug').trim(),
        direction,
        when,
        plannedWhen,
        delaySec,
        cancelled,
        planned: false,
      });
    }
    if (mapped.length === 0) return null;

    // Laufende Züge zuerst, Ausfälle ans Ende
    mapped.sort((a, b) => {
      if (a.cancelled !== b.cancelled) return a.cancelled ? 1 : -1;
      if (hint) {
        const ah = a.direction.toLowerCase().includes(hint) ? 0 : 1;
        const bh = b.direction.toLowerCase().includes(hint) ? 0 : 1;
        if (ah !== bh) return ah - bh;
      }
      return a.when.getTime() - b.when.getTime();
    });
    return mapped.slice(0, 6);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    let dir = line.directions[0];
    if (hint) {
      const match = line.directions.find(
        (d) =>
          d.toLowerCase().includes(hint) || hint.includes(d.toLowerCase()),
      );
      if (match) dir = match;
      else if (/hamburg|pinneberg|tornesch/i.test(hint)) {
        dir =
          line.directions.find((d) =>
            /hamburg|pinneberg|tornesch/i.test(d),
          ) ?? dir;
      }
    }

    const cadence = Math.max(15, line.cadenceMin);
    const offsetMin = lineIdx * Math.floor(cadence / 2);
    const base = new Date(now.getTime() + 3 * 60_000);
    let minutes =
      Math.ceil((base.getMinutes() - offsetMin) / cadence) * cadence + offsetMin;
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
  let distanceM = 0;
  let walkMinutes = 8;
  if (lat != null && lng != null) {
    distanceM = Math.round(haversineMeters(lat, lng, station.lat, station.lng));
    walkMinutes = walkMinutesForDistance(distanceM);
  }

  const destinationHint = extractDestinationHint(text);
  const city = cityId();
  const ibnr = STATION_IBNR[city];
  let departures: TransitDeparture[] | null = null;
  let source: 'live' | 'takt' = 'takt';

  if (ibnr) {
    departures = await fetchLiveDepartures(ibnr, destinationHint);
    if (departures?.length) source = 'live';
  }
  if (!departures?.length) {
    departures = buildTaktDepartures(city, destinationHint);
    source = 'takt';
  }

  const stationName = station.name
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .replace(/\s+und\s+historisches.*$/i, '')
    .trim();

  return {
    stationPoi: station,
    stationName,
    walkMinutes,
    distanceM,
    departures,
    source,
    destinationHint,
  };
}

function navOfferClause(offerNavigation: boolean): string {
  if (!offerNavigation) return '';
  return ' Soll ich dir den Kompass rüber zum Bahnhof anmachen?';
}

/**
 * Deterministische Kumpel-Antwort inkl. Verspätung, Gehzeit-Check + optional Nav-Angebot.
 */
export function formatTransitReply(
  advice: TransitAdvice,
  offerNavigation = true,
): string {
  const now = new Date();
  const runnable = advice.departures.filter((d) => !d.cancelled);
  const first = runnable[0] ?? advice.departures[0];
  const second = runnable[1] ?? advice.departures[1] ?? first;

  if (!first) {
    return (
      `Am ${advice.stationName} habe ich gerade keinen Live-Fahrplan — prüfe die App der Bahn oder den Schalter vor Ort.` +
      navOfferClause(offerNavigation)
    );
  }

  if (first.cancelled) {
    const next = runnable[0];
    if (next) {
      const nextDelay = delaySpeechClause(next);
      return (
        `Die nächste ${first.line} Richtung ${first.direction} fällt gerade aus. ` +
        `Danach kommt die ${next.line} um ${formatClock(next.when)} Uhr` +
        (nextDelay ? ` — ${nextDelay}` : '.') +
        ` Du brauchst etwa ${advice.walkMinutes} Minuten zu Fuß.` +
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
  const walkPhrase =
    advice.distanceM > 0
      ? `Du brauchst von hier aus aber gut ${advice.walkMinutes} Minuten zu Fuß`
      : `Rechne mit etwa ${advice.walkMinutes} Minuten Fußweg zum Bahnhof`;

  const line1 = first.line.replace(/\s+/g, ' ');
  const dir1 = first.direction;
  const t1 = formatClock(first.when);
  const delayClause = delaySpeechClause(first);
  const liveGap =
    advice.source === 'takt'
      ? ' Live-Verspätungen kann ich gerade nicht prüfen — das ist der übliche Takt.'
      : '';

  if (tight && second && second.when.getTime() !== first.when.getTime()) {
    const line2 = second.line.replace(/\s+/g, ' ');
    const t2 = formatClock(second.when);
    const delay2 = delaySpeechClause(second);
    return (
      `Die nächste ${line1} Richtung ${dir1} fährt um ${t1} Uhr am ${advice.stationName} ab. ` +
      (delayClause ? `${delayClause} ` : '') +
      `${walkPhrase} — die wäre also extrem knapp! ` +
      `Mein Tipp: Nimm entspannt die ${line2} um ${t2} Uhr` +
      (delay2 ? ` (${delay2.replace(/\.$/, '')})` : '') +
      `. Dann hast du am Bahnsteig noch ein paar Minuten Puffer.` +
      liveGap +
      navOfferClause(offerNavigation)
    );
  }

  return (
    `Die nächste ${line1} Richtung ${dir1} fährt um ${t1} Uhr am ${advice.stationName} ab. ` +
    (delayClause ? `${delayClause} ` : '') +
    `${walkPhrase.replace(' aber', '')} — das passt entspannt.` +
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
    advice.source === 'live'
      ? 'Live-Abfahrten inkl. Verspätung/Ausfall — Status GENAU so sagen (pünktlich / +X Min / fällt aus).'
      : 'Nur üblicher Takt — KEINE Verspätung behaupten. Sag ehrlich, dass Live-Daten gerade fehlen.';

  return `
=== ECHTE TRANSIT- & EMPFEHLUNGS-LOGIK (PFLICHT) ===
Station: ${advice.stationName}
Gehzeit vom Nutzer: ca. ${advice.walkMinutes} Minuten (${advice.distanceM > 0 ? `${advice.distanceM} m` : 'Distanz geschätzt'})
Fahrplan-Quelle: ${advice.source === 'live' ? 'Live-Abfahrten' : 'üblicher Takt (RB61/RB71)'}
${liveNote}
${advice.destinationHint ? `Ziel-Hinweis des Users: ${advice.destinationHint}` : ''}

Nächste Abfahrten (NUR DIESE Zeiten & Status nennen — nichts erfinden):
${rows}

Regeln:
1. Nenne konkrete Linie + Uhrzeit + Richtung + Verspätungsstatus (wenn Live).
2. Vergleiche Restzeit bis Abfahrt mit Gehzeit. Ist es knapp (< Gehzeit + 2 Min): sag klar, dass er die Bahn nicht stressfrei schafft, und empfehle die nächste.
3. Bei Ausfall: klar sagen und nächste Alternative nennen.
4. Schließe IMMER mit: „Soll ich dir den Kompass rüber zum Bahnhof anmachen?“
5. Ton: hilfsbereiter Kumpel im Ohr — kein DB-App-Verweis als Ausweichmanöver.
6. 3–5 Sätze, flüssig, kein Markdown.
`.trim();
}

export async function prepareTransitFollowUp(text: string): Promise<{
  advice: TransitAdvice;
  reply: string;
  offerNavigation: boolean;
} | null> {
  const advice = await buildTransitAdvice(text);
  if (!advice) return null;

  const offerNavigation = !isScheduleOnlyQuery(text);

  if (offerNavigation) {
    useFinnusStore.getState().setPendingNavOffer({
      poiId: advice.stationPoi.id,
      name: advice.stationName,
    });
  } else {
    useFinnusStore.getState().setPendingNavOffer(null);
  }

  return {
    advice,
    reply: formatTransitReply(advice, offerNavigation),
    offerNavigation,
  };
}
