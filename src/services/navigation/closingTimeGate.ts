/**
 * Time-vs-Distance gate (Masterbook V5): ETA vs POI closing time.
 * Warn before navigating if foot/bike ETA would arrive after closing.
 */

import { getFactsForPoi, getPoiWithFacts } from '../../db/database';
import { evaluateOpeningHours } from '../ai/promptBuilder';
import { estimateTravelEtaRouted } from './travelEta';
import { useFinnusStore } from '../../store/useFinnusStore';

export type ClosingGateResult = {
  /** false → do not auto-start nav; speak warning instead */
  allow: boolean;
  warningSpeech: string | null;
  etaMinutes: number | null;
  minutesUntilClose: number | null;
  hoursStatus: string | null;
};

const TIME_RE =
  /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})|(\d{1,2})\s*[-–—]\s*(\d{1,2})\b/g;

function minutesUntilCloseFromFacts(
  facts: Array<{ fact_text: string }>,
  now: Date = new Date(),
): number | null {
  const hours = evaluateOpeningHours(facts, now);
  if (hours.hoursStatus === 'closed') return 0;
  if (hours.hoursStatus === 'unknown' || hours.hoursStatus === 'opening_soon') {
    return null;
  }

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const joined = hours.rawHoursFacts.join(' | ');
  const closes: number[] = [];
  let match: RegExpExecArray | null;
  TIME_RE.lastIndex = 0;
  while ((match = TIME_RE.exec(joined)) !== null) {
    let close: number | null = null;
    if (match[1] != null && match[3] != null) {
      close = Number(match[3]) * 60 + Number(match[4]);
    } else if (match[5] != null && match[6] != null) {
      close = Number(match[6]) * 60;
    }
    if (close != null && close > nowMins) closes.push(close);
  }
  if (!closes.length) {
    // closing_soon without parseable close → assume ≤60 min
    if (hours.hoursStatus === 'closing_soon') return 45;
    return null;
  }
  const nextClose = Math.min(...closes);
  return Math.max(0, nextClose - nowMins);
}

function formatCloseHint(minutesUntilClose: number): string {
  if (minutesUntilClose <= 0) return 'schon zu';
  if (minutesUntilClose < 60) return `schließt in ${minutesUntilClose} Minuten`;
  const h = Math.floor(minutesUntilClose / 60);
  const m = minutesUntilClose % 60;
  return m > 0
    ? `schließt in ${h} Stunden ${m} Minuten`
    : `schließt in ${h} Stunden`;
}

/**
 * Compare walk/bike ETA with closing window.
 * If ETA > minutes until close → block + warn with alternatives.
 */
export async function checkClosingTimeGate(opts: {
  destName: string;
  destLat: number;
  destLng: number;
  poiId?: number | null;
  facts?: Array<{ fact_text: string }> | null;
  /** Soft categories that often close early (bakery, pharmacy, …) */
  placeHint?: string | null;
  /** Google/OSM openNow — false → sofort blocken */
  openNow?: boolean | null;
}): Promise<ClosingGateResult> {
  const store = useFinnusStore.getState();
  const userLat = store.lastGpsLat;
  const userLng = store.lastGpsLng;
  if (
    userLat == null ||
    userLng == null ||
    !Number.isFinite(userLat) ||
    !Number.isFinite(userLng)
  ) {
    return {
      allow: true,
      warningSpeech: null,
      etaMinutes: null,
      minutesUntilClose: null,
      hoursStatus: null,
    };
  }

  const eta = await estimateTravelEtaRouted({
    userLat,
    userLng,
    destLat: opts.destLat,
    destLng: opts.destLng,
    destName: opts.destName,
  });

  if (opts.openNow === false) {
    const name = opts.destName.trim() || 'Das Ziel';
    return {
      allow: false,
      warningSpeech:
        `${name} ist gerade geschlossen. Ich suche dir eine offene Alternative in der Nähe.`,
      etaMinutes: eta.totalMinutes,
      minutesUntilClose: 0,
      hoursStatus: 'closed',
    };
  }

  let facts = opts.facts ?? null;
  if ((!facts || !facts.length) && opts.poiId != null && opts.poiId >= 0) {
    try {
      const rows = await getFactsForPoi(opts.poiId);
      facts = rows.map((f) => ({ fact_text: f.fact_text }));
      if (!facts.length) {
        const poi = await getPoiWithFacts(opts.poiId);
        facts = poi?.facts?.map((f) => ({ fact_text: f.fact_text })) ?? null;
      }
    } catch {
      facts = null;
    }
  }

  const hours = facts?.length
    ? evaluateOpeningHours(facts)
    : { hoursStatus: 'unknown' as const, hoursHint: null, rawHoursFacts: [] };

  if (hours.hoursStatus === 'closed') {
    const name = opts.destName.trim() || 'Das Ziel';
    return {
      allow: false,
      warningSpeech:
        `${name} ist gerade zu. Offene Alternative in der Nähe oder trotzdem hin — beides als Button.`,
      etaMinutes: eta.totalMinutes,
      minutesUntilClose: 0,
      hoursStatus: hours.hoursStatus,
    };
  }

  const untilClose =
    facts?.length != null ? minutesUntilCloseFromFacts(facts) : null;

  if (untilClose == null) {
    return {
      allow: true,
      warningSpeech: null,
      etaMinutes: eta.totalMinutes,
      minutesUntilClose: null,
      hoursStatus: hours.hoursStatus,
    };
  }

  // Buffer: need to arrive ≥5 min before close
  const bufferMin = 5;
  if (eta.totalMinutes + bufferMin <= untilClose) {
    return {
      allow: true,
      warningSpeech: null,
      etaMinutes: eta.totalMinutes,
      minutesUntilClose: untilClose,
      hoursStatus: hours.hoursStatus,
    };
  }

  const name = opts.destName.trim() || 'Das Ziel';
  const closeHint = formatCloseHint(untilClose);
  const place = (opts.placeHint ?? name).toLowerCase();
  const isFoodish = /bäck|baeck|café|cafe|imbiss|restaurant|apotheke|laden|shop|markt/i.test(
    place,
  );
  const alt = isFoodish
    ? `Offene Alternative in der Nähe oder trotzdem hin — Buttons.`
    : `Mit der Fahrzeit kommst du vor Schluss kaum an. Offene Alternative oder trotzdem hin — Buttons.`;

  return {
    allow: false,
    warningSpeech:
      `${name} ${closeHint} — die Route braucht ca. ${eta.totalMinutes} Minuten. ${alt}`,
    etaMinutes: eta.totalMinutes,
    minutesUntilClose: untilClose,
    hoursStatus: hours.hoursStatus,
  };
}
