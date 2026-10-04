/**
 * Fernbahn-Zeiten A→B via DB transport.rest (HAFAS).
 * Nicht planJourney() — der filtert Verbindungen >4 h weg (Stadt-ÖPNV).
 */

import { isJunkPlaceName, sanitizeTravelPlaceName } from '../placeNameSanity';

export type RailJourneyTiming = {
  departAt: string | null;
  arriveAt: string | null;
  departDateKey: string | null;
  durationHint: string | null;
  fromStation: string | null;
  toStation: string | null;
  /** Umstiege (0 = Direkt). */
  transfers?: number | null;
  /** z. B. „Berlin Hbf, Dresden Hbf“ — Zwischenhalte der Umstiege. */
  viaHint?: string | null;
};

function clockFromDate(d: Date | null | undefined): string | null {
  if (!d || !Number.isFinite(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateKeyFromDate(d: Date | null | undefined): string | null {
  if (!d || !Number.isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function durationHintFromSec(sec: number | null | undefined): string | null {
  if (sec == null || !(sec > 0)) return null;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} Min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} Min` : `${h} h`;
}

/** @deprecated use sanitizeTravelPlaceName — Alias für Smokes/Caller. */
export function sanitizeRailCityName(
  raw: string | null | undefined,
  fallback = 'Hamburg',
): string {
  return sanitizeTravelPlaceName(raw, fallback);
}

export { isJunkPlaceName, sanitizeTravelPlaceName };

function stationQuery(city: string): string {
  const c = city.trim();
  if (/hbf|hauptbahnhof|hlavní|central/i.test(c)) return c;
  // DE/CZ: Hbf oft bessere Treffer
  if (/hamburg|berlin|münchen|muenchen|köln|koeln|frankfurt|prag|prague|praha|wien|dresden|leipzig/i.test(c)) {
    if (/prag|prague|praha/i.test(c)) return 'Praha hlavní nádraží';
    return `${c} Hbf`;
  }
  return c;
}

function pickStation(
  hits: Array<{ id: string; name: string; lat: number; lng: number }>,
): { id: string; name: string; lat: number; lng: number } | null {
  if (!hits.length) return null;
  const prefer = hits.find((h) =>
    /hbf|hauptbahnhof|hlavní|central\s*station|centraal/i.test(h.name),
  );
  return prefer || hits[0] || null;
}

/**
 * Live Abfahrt/Ankunft für Fernstrecke (auch >4 h).
 */
export async function lookupRailJourneyTiming(opts: {
  originCity: string;
  destCity: string;
  checkin: string;
  /** Prefer morning depart ~07:00 local */
  preferHour?: number;
}): Promise<RailJourneyTiming> {
  const empty: RailJourneyTiming = {
    departAt: null,
    arriveAt: null,
    departDateKey: /^\d{4}-\d{2}-\d{2}/.test(opts.checkin) ? opts.checkin.slice(0, 10) : null,
    durationHint: null,
    fromStation: null,
    toStation: null,
    transfers: null,
    viaHint: null,
  };
  const origin = sanitizeTravelPlaceName(opts.originCity, 'Hamburg');
  const destRaw = (opts.destCity || '').trim();
  // Ziel nie durch Origin ersetzen — Junk-Ziel = keine Fake-Verbindung
  if (!destRaw || isJunkPlaceName(destRaw)) {
    return { ...empty, fromStation: origin, toStation: null };
  }
  const dest = sanitizeTravelPlaceName(destRaw, destRaw);
  if (!/^\d{4}-\d{2}-\d{2}/.test(opts.checkin)) return empty;

  try {
    const { searchDbLocations, planDbJourneys } = await import(
      '../../services/transit/dbRestJourneys'
    );
    const [fromHits, toHits] = await Promise.all([
      searchDbLocations(stationQuery(origin), { results: 6 }),
      searchDbLocations(stationQuery(dest), { results: 6 }),
    ]);
    const from = pickStation(fromHits);
    const to = pickStation(toHits);
    if (!from || !to) return { ...empty, fromStation: origin, toStation: dest };

    const hour = opts.preferHour ?? 7;
    const departAt = new Date(
      `${opts.checkin.slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00`,
    );
    const journeys = await planDbJourneys({
      from: { lat: from.lat, lng: from.lng, name: from.name },
      to: { lat: to.lat, lng: to.lng, name: to.name },
      departAt,
      results: 5,
    });
    // Fernverkehr: bis 18 h ok (kein ÖPNV-4h-Cap)
    const usable = journeys
      .filter((j) => j.durationSec > 0 && j.durationSec <= 18 * 3600)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const best = usable[0];
    if (!best) {
      return {
        ...empty,
        fromStation: from.name,
        toStation: to.name,
      };
    }
    const firstRail =
      best.legs.find((l) => l.mode === 'RAIL' || l.mode === 'TRANSIT') || best.legs[0];
    const lastRail =
      [...best.legs].reverse().find((l) => l.mode === 'RAIL' || l.mode === 'TRANSIT') ||
      best.legs[best.legs.length - 1];
    const railLegs = best.legs.filter((l) => l.mode === 'RAIL' || l.mode === 'TRANSIT');
    const transfers = Math.max(0, railLegs.length - 1);
    // Umstiegspunkte = Ziel jedes Rail-Legs außer dem letzten
    const viaNames = railLegs
      .slice(0, -1)
      .map((l) => (l.toName || '').trim())
      .filter((n) => n && !/^(start|ziel)$/i.test(n));
    const viaHint =
      transfers === 0
        ? 'Direkt'
        : viaNames.length
          ? `über ${viaNames.slice(0, 2).join(', ')}${viaNames.length > 2 ? '…' : ''}`
          : `${transfers}× umsteigen`;
    return {
      departAt: clockFromDate(firstRail?.startTime ?? best.startTime),
      arriveAt: clockFromDate(lastRail?.endTime ?? best.endTime),
      departDateKey: dateKeyFromDate(firstRail?.startTime ?? best.startTime) || empty.departDateKey,
      durationHint: durationHintFromSec(best.durationSec),
      fromStation: firstRail?.fromName || from.name,
      toStation: lastRail?.toName || to.name,
      transfers,
      viaHint,
    };
  } catch {
    return empty;
  }
}
