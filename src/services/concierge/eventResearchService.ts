/**
 * Tagesaktuelle Event-Recherche (Web/PDF/Flyer via Gemini Google Search).
 * Keine generischen „Kulturverwaltung“-Platzhalter — nur konkrete heutige Events.
 */

import { generateGeminiText, hasGeminiApiKey, takeLastGeminiGroundingUrls } from '../geminiService';
import { getCachedUserProfile } from '../userProfileService';
import { useFinnusStore } from '../../store/useFinnusStore';
import type { QuickAction } from '../../types/concierge';
import type { PendingNavOffer } from '../navigation/navigationTypes';
import { shortenActionLabel } from './actionLabelShorten';
import { isCelestialOrSkyQuery } from './celestialSkyQuery';
import { extractSpokenClock, extractSpokenEndClock } from '../research/extractSpokenClock';
import { extractSpokenPriceEur } from '../research/extractSpokenPrice';
import { FINDUS_ANSWER_FIRST_BLOCK, FINDUS_NAMED_SCHEDULE_BLOCK, FINDUS_WOVEN_PITCH_SPEECH_BLOCK } from './findusResponsePolicy';
import {
  formatRelativeWhenSpeech,
  isLaterPlanSchedule,
} from './eventTravelSpeech';
import { isUpcomingForUnsolicitedPitch, looksLikeTimedStartShow, looksLikeOngoingDayEvent } from '../speech/laterPlanSpeech';

import {
  userAskedForFestival,
  detectAskedFestivalType,
  isEventFestivalDeepenQuery,
  wantsEventBriefingActions,
  looksLikeShopNotFestival,
  eventMatchesFestivalType,
  type AskedFestivalType,
} from './eventFestivalType';
import {
  isSportsScheduleFollowUp,
  isSportsScheduleQuery,
  looksLikeNamedScheduleQuery,
} from './sportsScheduleQuery';

export {
  userAskedForFestival,
  detectAskedFestivalType,
  isEventFestivalDeepenQuery,
  wantsEventBriefingActions,
  looksLikeShopNotFestival,
  eventMatchesFestivalType,
};
export type { AskedFestivalType };
export { isSportsScheduleQuery } from './sportsScheduleQuery';

export { isCelestialOrSkyQuery } from './celestialSkyQuery';

export type ResearchedEvent = {
  title: string;
  venue: string;
  startTime: string | null;
  /** Kalendertag YYYY-MM-DD wenn belegt (genannter Spielplan) */
  dateIso: string | null;
  /** Ticketpreis in € nur belegt */
  ticketPriceEur: number | null;
  summary: string;
  /** Official / flyer / PDF URL if found */
  infoUrl: string | null;
  /** Ticket / booking URL if found */
  ticketUrl: string | null;
  /** Whether a PDF/flyer was cited */
  hasPdf: boolean;
  sourceHint: string | null;
  /**
   * Quellen-Vertrauen 0–1 (PDF/Ticket/Venue-Site > vager Hinweis).
   * Speech/Buttons priorisieren hohe Werte; niedrige ehrlich relativieren.
   */
  sourceTrust: number;
  lat?: number | null;
  lng?: number | null;
  /** Live-ÖPNV-Minuten (nach enrichEventsWithLiveTransit) */
  liveTransitMin?: number | null;
  /** Ankunft Epoch-ms aus Journey */
  liveArrivalAtMs?: number | null;
};

export type EventResearchResult = {
  dateLabel: string;
  city: string;
  events: ResearchedEvent[];
  researchNotes: string;
  promptBlock: string;
  /** Suggested nav offers for venues (geocode later) */
  venueOffers: PendingNavOffer[];
  /** Original user text — Speech/Filter-Kontext */
  userText?: string;
};

const EVENT_QUERY_RE =
  /\b(was\s+(heute\s+)?geht|was\s+geht\s+heute|was\s+heute\b[\s\S]{0,48}?\bgeht|was\s+[\s\S]{0,40}?\bso\s+geht|was\s+läuft\s+heute|was\s+laeuft\s+heute|was\s+ist\s+(heute\s+)?los|heute\s+abend|heut\s+abend|events?|veranstaltung|veranstaltungen|programm|party|party[\s-]?locations?|party\s+machen|konzert|live\s*musik|dj|festival|weinfest|stadtfest|sommerfest|volksfest|wein\s*fest|\bfest\b|markt|turnier|wochenprogramm|was\s+geht\s+(heute\s+)?abend|abendprogramm|ausgehen|nightlife|nachtleben|feiern|clubs?|disco|tanzen|tanz(?:en|fläche)?|ausklingen|locations?\s+zum\s+feiern)\b/iu;

export function isEventResearchQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (isCelestialOrSkyQuery(t)) return false;
  if (isSportsScheduleQuery(t)) return true;
  try {
    const { getLastLiveInventory } = require('../../module2/context/shortTermContext') as {
      getLastLiveInventory: () => { kind: string; query: string } | null;
    };
    const pending = getLastLiveInventory();
    if (
      pending?.kind === 'events' &&
      isSportsScheduleFollowUp(t, pending.query)
    ) {
      return true;
    }
  } catch {
    /* soft */
  }
  if (
    /\bbleiben\b/iu.test(t) &&
    /\b(nacht|heute\s+bis\s+morgen|heute\s+auf\s+morgen|hotel|übernacht|uebernacht)\b/iu.test(
      t,
    ) &&
    !/\b(party|tanzen|feiern|club|konzert|event)\b/iu.test(t)
  ) {
    return false;
  }
  if (EVENT_QUERY_RE.test(t)) return true;
  // Follow-up zum letzten Event-Turn („wann geht's los?“, „läuft das jetzt?“…)
  if (isEventFestivalDeepenQuery(t)) {
    try {
      const { getLastLiveInventory } = require('../../module2/context/shortTermContext') as {
        getLastLiveInventory: () => { kind: string; query: string } | null;
      };
      const pending = getLastLiveInventory();
      if (pending?.kind === 'events') return true;
      if (pending?.query && detectAskedFestivalType(pending.query)) return true;
    } catch {
      /* soft */
    }
  }
  return false;
}

/** Stadt aus der Frage schlägt Pack-/GPS-Default (z. B. „in Hamburg“). */
export function resolveEventResearchCity(userText: string): string {
  try {
    const { extractCityFromText } = require('../../module2/context/shortTermContext') as {
      extractCityFromText: (t: string) => string | null;
    };
    const named = extractCityFromText(userText);
    if (named?.trim()) return named.trim();
  } catch {
    /* soft */
  }
  // Genannter Spielplan ohne Stadt im Satz: lieber „Umgebung“ als GPS-Dorf —
  // Recherche sucht am Namen; Empty-Speech darf kein Nightlife vorschlagen.
  if (looksLikeNamedScheduleQuery(userText)) {
    return 'der Umgebung';
  }
  const profile = getCachedUserProfile()?.cityName?.trim();
  if (profile) return profile;
  const live = useFinnusStore.getState().currentLocationName?.trim();
  if (live) {
    try {
      const { extractCityFromText } = require('../../module2/context/shortTermContext') as {
        extractCityFromText: (t: string) => string | null;
      };
      return extractCityFromText(live)?.trim() || live;
    } catch {
      return live;
    }
  }
  return 'der Umgebung';
}

export function buildEmptyEventResearch(
  city: string,
  notes: string,
): EventResearchResult {
  const dateLabel = todayDe();
  return {
    dateLabel,
    city,
    events: [],
    researchNotes: notes,
    promptBlock: [
      '=== TAGESAKTUELLE EVENT-RECHERCHE ===',
      `Stadt: ${city} · Datum: ${dateLabel}`,
      `Research-Notizen: ${notes}`,
      'Keine belegten heutigen Events — ehrlich sagen, gezielter nachfragen.',
    ].join('\n'),
    venueOffers: [],
  };
}

function emptyEventResearch(
  city: string,
  notes: string,
): EventResearchResult {
  return buildEmptyEventResearch(city, notes);
}

function todayDe(): string {
  return new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractJsonObject(raw: string): unknown | null {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

import { scoreSourceTrust } from '../research/sourceTrust';
import {
  buildNamedPlaceMapsUrl,
  dropDeadEventPageUrl,
  eventUrlMatchesHints,
  extractHttpUrlsFromText,
  keepFoundEventUrl,
  overlayGroundingEventUrls,
  resolveEventInfoUrl,
} from '../research/eventInfoUrl';

function scoreEventSourceTrust(e: {
  infoUrl: string | null;
  ticketUrl: string | null;
  hasPdf: boolean;
  sourceHint: string | null;
  startTime: string | null;
  summary: string;
}): number {
  return scoreSourceTrust({
    url: e.infoUrl,
    ticketUrl: e.ticketUrl,
    hasPdf: e.hasPdf,
    sourceHint: e.sourceHint,
    hasTime: Boolean(e.startTime),
    detailLen: e.summary.trim().length,
  });
}


function normalizeEventDateIso(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const iso = s.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1]!;
  const de = s.match(/\b(\d{1,2})[.](\d{1,2})[.](20\d{2})\b/);
  if (de) {
    const d = Number(de[1]);
    const m = Number(de[2]);
    const y = Number(de[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  const deNoYear = s.match(/\b(\d{1,2})[.](\d{1,2})[.](?!\d)/);
  if (deNoYear) {
    const d = Number(deNoYear[1]);
    const m = Number(deNoYear[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const y = new Date().getFullYear();
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return null;
}

function parseTicketPriceEur(raw: unknown, summary: string): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw < 5000) {
    return Math.round(raw * 100) / 100;
  }
  if (typeof raw === 'string' && /\d/.test(raw)) {
    const n = Number(String(raw).replace(',', '.').replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0 && n < 5000) return Math.round(n * 100) / 100;
  }
  try {
    const spoken = extractSpokenPriceEur(summary);
    if (spoken) {
      const m = spoken.match(/(\d+[.,]?\d*)/);
      if (m) {
        const n = Number(m[1]!.replace(',', '.'));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  } catch {
    /* soft */
  }
  return null;
}

function formatNamedScheduleDateSpeech(
  dateIso: string | null,
  startTime: string | null,
  summary?: string | null,
): string {
  const timeBit = startTime ? `, Anpfiff ${startTime} Uhr` : '';
  if (dateIso) {
    try {
      const [y, m, d] = dateIso.split('-').map(Number);
      const dt = new Date(y!, m! - 1, d!);
      if (Number.isFinite(dt.getTime())) {
        const wd = dt.toLocaleDateString('de-DE', { weekday: 'long' });
        const day = dt.toLocaleDateString('de-DE', {
          day: 'numeric',
          month: 'long',
        });
        return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${day}${timeBit}. `;
      }
    } catch {
      /* fall through */
    }
  }
  const spokenDate = extractSpokenCalendarDate(
    `${summary || ''} ${startTime || ''}`,
  );
  if (spokenDate) {
    return startTime
      ? `${spokenDate}, Anpfiff ${startTime} Uhr. `
      : `${spokenDate}. `;
  }
  return startTime ? `Anpfiff ${startTime} Uhr. ` : '';
}

function asEvents(data: unknown, city?: string | null): ResearchedEvent[] {
  if (!data || typeof data !== 'object') return [];
  const root = data as { events?: unknown[] };
  if (!Array.isArray(root.events)) return [];
  const out: ResearchedEvent[] = [];
  for (const row of root.events) {
    if (!row || typeof row !== 'object') continue;
    const e = row as Record<string, unknown>;
    const title = String(e.title ?? e.name ?? '').trim();
    const venue = String(e.venue ?? e.location ?? e.place ?? '').trim();
    if (title.length < 3 && venue.length < 3) continue;
    const rawInfo =
      typeof e.infoUrl === 'string' && /^https?:\/\//i.test(e.infoUrl)
        ? e.infoUrl
        : typeof e.pdfUrl === 'string' && /^https?:\/\//i.test(e.pdfUrl)
          ? e.pdfUrl
          : typeof e.url === 'string' && /^https?:\/\//i.test(e.url)
            ? e.url
            : null;
    const hints = {
      title: title || venue,
      venue: venue || title,
      city: city ?? null,
    };
    const infoUrl = resolveEventInfoUrl({
      candidate: rawInfo,
      hints,
    });
    const rawTicket =
      typeof e.ticketUrl === 'string' && /^https?:\/\//i.test(e.ticketUrl)
        ? e.ticketUrl
        : null;
    const ticketKept = keepFoundEventUrl(rawTicket);
    const ticketUrl =
      ticketKept && eventUrlMatchesHints(ticketKept, hints) ? ticketKept : null;
    const hasPdf =
      Boolean(e.hasPdf) ||
      /\.pdf(\?|$)/i.test(infoUrl ?? '') ||
      /pdf|flyer|programm/i.test(String(e.sourceHint ?? ''));
    const summary = String(e.summary ?? e.detail ?? '').trim().slice(0, 1100);
    const startTime =
      extractSpokenClock(
        e.startTime != null ? String(e.startTime) : '',
      ) ||
      extractSpokenClock(summary) ||
      extractSpokenClock(
        `${e.title ?? ''} ${e.venue ?? ''} ${e.sourceHint ?? ''}`,
      );
    const sourceHint =
      typeof e.sourceHint === 'string' ? e.sourceHint.slice(0, 120) : null;
    const sourceTrust = scoreEventSourceTrust({
      infoUrl,
      ticketUrl,
      hasPdf,
      sourceHint,
      startTime,
      summary,
    });
    const dateIso =
      normalizeEventDateIso(e.dateIso ?? e.startDate ?? e.date) ||
      normalizeEventDateIso(summary);
    const ticketPriceEur = parseTicketPriceEur(
      e.ticketPriceEur ?? e.priceEur ?? e.price,
      summary,
    );
    out.push({
      title: title || venue,
      venue: venue || title,
      startTime,
      dateIso,
      ticketPriceEur,
      summary,
      infoUrl,
      ticketUrl,
      hasPdf,
      sourceHint,
      sourceTrust,
    });
  }
  return out.sort((a, b) => b.sourceTrust - a.sourceTrust).slice(0, 4);
}

async function geocodeEventVenues(
  events: ResearchedEvent[],
  city: string,
): Promise<ResearchedEvent[]> {
  try {
    const { geocodePlaceNameOsmFirst } = require('../navigation/googleMapsNav') as {
      geocodePlaceNameOsmFirst: (
        q: string,
        o?: { cityHint?: string | null; biasLat?: number; biasLng?: number },
      ) => Promise<{ lat: number; lng: number } | null>;
    };
    const { useGpsStore } = require('../../store/useGpsStore') as {
      useGpsStore: {
        getState: () => { lat: number | null; lng: number | null };
      };
    };
    const gps = useGpsStore.getState();
    return Promise.all(
      events.map(async (e) => {
        if (e.lat != null && e.lng != null) return e;
        const q = `${e.venue}${city ? `, ${city}` : ''}`;
        const geo = await geocodePlaceNameOsmFirst(q, {
          cityHint: city,
          biasLat: gps.lat ?? undefined,
          biasLng: gps.lng ?? undefined,
        });
        if (!geo) return e;
        return { ...e, lat: geo.lat, lng: geo.lng };
      }),
    );
  } catch {
    return events;
  }
}

/** Kalenderdatum aus Summary/Titel — für Answer-First Spielplan-Speech. */
export function extractSpokenCalendarDate(text: string): string | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${d}.${m}.${y}`;
  }
  const deFull = t.match(
    /\b(\d{1,2})\.(\d{1,2})\.(20\d{2}|\d{2})\b/,
  );
  if (deFull) {
    const d = deFull[1]!.padStart(2, '0');
    const m = deFull[2]!.padStart(2, '0');
    let y = deFull[3]!;
    if (y.length === 2) y = `20${y}`;
    return `${d}.${m}.${y}`;
  }
  const deShort = t.match(/\b(\d{1,2})\.(\d{1,2})\.(?!\d)/);
  if (deShort) {
    return `${deShort[1]!.padStart(2, '0')}.${deShort[2]!.padStart(2, '0')}.`;
  }
  const months =
    'januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember';
  const named = t.match(
    new RegExp(
      `\\b(\\d{1,2})\\.\\s*(${months})(?:\\s+(20\\d{2}))?\\b`,
      'iu',
    ),
  );
  if (named) {
    const y = named[3] ? ` ${named[3]}` : '';
    return `${named[1]}. ${named[2]}${y}`;
  }
  const wd = t.match(
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/iu,
  );
  if (wd && deShort) {
    return `${wd[1]} ${deShort[0]}`;
  }
  if (wd && /\b(nächste[rn]?|kommende[rn]?)\s+\1\b/iu.test(t)) {
    return wd[1]!;
  }
  return wd ? wd[1]! : null;
}

/**
 * Club-Homepage → Spielplan-/Ticket-Deep-Link (analog Speisekarte).
 */
async function deepenNamedScheduleEventUrls(
  events: ResearchedEvent[],
): Promise<ResearchedEvent[]> {
  try {
    const {
      findDeepestScheduleLink,
      isClubOrActHomepageUrl,
      isScheduleDeepPath,
    } = require('../actionBoard/scheduleDeepLink') as {
      findDeepestScheduleLink: (o: {
        websiteUrl: string;
        signal?: AbortSignal;
      }) => Promise<{ url: string; label: string } | null>;
      isClubOrActHomepageUrl: (u: string) => boolean;
      isScheduleDeepPath: (u: string) => boolean;
    };
    return await Promise.all(
      events.map(async (e) => {
        let infoUrl = e.infoUrl;
        let ticketUrl = e.ticketUrl;
        const seed =
          (infoUrl && /^https?:\/\//i.test(infoUrl) ? infoUrl : null) ||
          (ticketUrl && /^https?:\/\//i.test(ticketUrl) ? ticketUrl : null);
        if (!seed) return e;
        const needsDeep =
          isClubOrActHomepageUrl(seed) || !isScheduleDeepPath(seed);
        if (!needsDeep && infoUrl && isScheduleDeepPath(infoUrl)) {
          return e;
        }
        const deep = await findDeepestScheduleLink({ websiteUrl: seed });
        if (!deep?.url) return e;
        const isTicketish = /ticket/i.test(deep.label + deep.url);
        if (isTicketish) {
          if (!ticketUrl || isClubOrActHomepageUrl(ticketUrl)) {
            ticketUrl = deep.url;
          }
          if (!infoUrl || isClubOrActHomepageUrl(infoUrl)) {
            // Keep homepage only if no schedule path; prefer deep for info when schedule
            if (isScheduleDeepPath(deep.url)) infoUrl = deep.url;
          }
        } else {
          infoUrl = deep.url;
        }
        return { ...e, infoUrl, ticketUrl };
      }),
    );
  } catch {
    return events;
  }
}

/**
 * Live research for today's local program OR a named schedule (team/act/venue).
 * Call-1 kann cityHint + force setzen — dann kein Keyword-Gate und kein GPS-Ersatz.
 */
export async function researchTodaysEvents(
  userText: string,
  opts?: {
    /** Call-1 destCity / cityScope.researchCity — schlägt GPS */
    cityHint?: string | null;
    /** Call-1 execution=events_research → immer recherchieren */
    force?: boolean;
  },
): Promise<EventResearchResult | null> {
  if (!opts?.force && !isEventResearchQuery(userText)) return null;
  const namedAsk = looksLikeNamedScheduleQuery(userText);
  const sportsAsk = namedAsk; // Alias für Filter/Empty-Speech
  const city =
    (opts?.cityHint || '').trim() || resolveEventResearchCity(userText);
  const dateLabel = todayDe();
  const dateIso = todayIso();
  const store = useFinnusStore.getState();

  if (!hasGeminiApiKey()) {
    return emptyEventResearch(
      city,
      'kein API-Key — Event-Recherche nicht verfügbar',
    );
  }

  const festType = namedAsk ? null : detectAskedFestivalType(userText);
  const deepenAsk = isEventFestivalDeepenQuery(userText);
  const typeHardMatch =
    namedAsk
      ? ''
      : festType === 'wine'
      ? 'HARD-MATCH Weinfest/Weinmarkt: NUR Events mit klarem Wein-Fest-Charakter. KEIN generisches Straßenfest/Landstraßenfest/Stadtfest als Ersatz — auch nicht „liegt in dem Viertel“. Kein Treffer → events=[] und ehrlich.'
      : festType === 'beer'
        ? 'HARD-MATCH Bierfest/Oktoberfest: nur passende Bier-Feste, keine fremden Fest-Typen als Ersatz.'
        : festType === 'street'
          ? 'HARD-MATCH Straßen-/Viertelfest: nur passende Straßenfeste.'
          : festType === 'city'
            ? 'HARD-MATCH Stadtfest/Volksfest: nur passende Stadt-/Volksfeste.'
            : festType && festType !== 'generic'
              ? `HARD-MATCH Fest-Typ „${festType}“: nur passende Feste — fremde Fest-Typen nicht unterschieben.`
              : userAskedForFestival(userText)
                ? 'Wenn der User Fest/Festival meint: NUR echte Feste mit Programm. KEINE Weinhandlungen/Vinotheken/Weinbars ohne Fest-Charakter.'
                : '';

  const namedPrompt = namedAsk
    ? [
        `Du recherchierst GENAU die User-Frage — genanntes Team/Act/Halle/Event (kein Nightlife-Katalog).`,
        `HEUTE ist ${dateLabel} (ISO ${dateIso}).`,
        `User-Frage: „${userText.trim().slice(0, 280)}“`,
        city && city !== 'der Umgebung'
          ? `Recherche-Stadt-Hinweis: ${city} (aus Frage/Call-1 destCity/cityScope). GPS-Heimatdorf ist KEIN Ersatz-Programm und kein Nightlife-Fallback.`
          : 'Keine klare Stadt — am genannten Namen suchen (offizielle Seite/Spielplan), nicht am GPS-Ort.',
        '',
        'AUFGABE: Google Search — nächste BELEGTE Spiele/Termine (nicht nur „heute“; nächste Woche/Monat ausdrücklich ok).',
        'Pflicht-Felder pro Treffer wenn belegt: dateIso YYYY-MM-DD (nicht nur in summary), startTime HH:MM, Gegner, Halle/Venue, ticketPriceEur Zahl nur belegt, infoUrl = TIEFER Spielplan-/Fixtures-/Schedule-Link (nie Club-Homepage-Root), ticketUrl = Buchungs-/Ticketshop wenn kaufbar.',
        'Such-Queries aktiv: genannter Name + „Spielplan“ / „nächstes Heimspiel“ / „Fixtures“ / „Tickets“; Liga-Kalender wenn erkennbar (z. B. BBL).',
        'infoUrl: bevorzugt …/spielplan, /fixtures, /schedule, /heimspiele, Ticketshop-Kalender — nicht Domain-Root. ticketUrl: Eventim/Reservix/Ticketmaster/Venue-Shop mit dem konkreten Spiel wenn möglich.',
        'Halle-Aliase (STT): Ballsportarena / Badcathedrale / Edel-optics / Inselpark Arena / Barclays Arena — gleiches Venue-Cluster.',
        'Liefere 1–3 nächste Termine (Heim bevorzugt wenn gefragt). title = Teams/Act, venue = Halle; dateIso+startTime Pflichtfelder; summary ergänzt Gegner/Preise nur belegt.',
        'VERBOTEN: Clubnacht, Konzert, Stadt-Fest, „was geht heute“ als Ersatz wenn der genannte Termin fehlt.',
        'Wenn nichts belegt: events=[] + researchNotes ehrlich.',
      ]
    : null;

  const prompt = (namedPrompt || [
    `Du bist ein hyperlokaler Event-Researcher für ${city}.`,
    `HEUTE ist ${dateLabel} (ISO ${dateIso}).`,
    'In der Speech relative Datums-Labels nutzen: „heute“, „heute Abend“, „dieses Wochenende“ — kaltes Kalenderdatum nur wenn nötig.',
    `User-Frage: „${userText.trim().slice(0, 280)}“`,
    '',
    'AUFGABE: Recherche mit Google Search — finde TATSÄCHLICHE Events/Programme für HEUTE oder das NÄCHSTE belegte Datum (wenn User nach Start/Jetzt/nächstes fragt).',
    'PRIORITÄT: aktuell laufend → heute/heute Abend → dieses Wochenende → nächstes bevorstehendes. In speech relative Labels („heute“, „dieses Wochenende“). NICHT „findet üblicherweise im Mai statt“ als Hauptantwort, wenn Live-Kalender/Flyer für jetzt/nächste Termine existieren.',
    `STRIKT nur Events in/bei „${city}“ — nicht eine andere Stadt aus dem User-Profil erfinden.`,
    typeHardMatch,
    deepenAsk
      ? 'Follow-up/Vertiefung: denselben Fest-Typ/Ort vertiefen ODER aktuell belegtes Fest dieses Typs neu belegen — nicht zu einem anderen historischen Fest driften.'
      : '',
    'Mehrere passende Feste/Events? Bis zu 4 liefern (unterschiedliche Orte/Stadtteile) — nicht bei einem Treffer stoppen.',
    'summary: 4–8 dichte Sätze wenn Stoff da ist — Start/Ende, was JETZT läuft, Eintritt, Stände/Angebot, Preise, Musik/Acts, Besonderheiten, Buchbares (Probe/Tickets) — nur belegt. Nie nur „ja, läuft“ / „es gibt ein Fest“.',
    'ticketUrl: Reservix/Eventim/Ticketmaster/Venue-Buchung wenn gefunden (DE Live-Events → reservix.de bevorzugt). Konfetti nur Workshops/Weinproben. Weinprobe/Kurs-Details (Preis, Personen, Ablauf) in summary wenn belegt.',
    'Quellen priorisieren: lokale Eventkalender, Tourismus, Wochenprogramm-PDFs, Flyer, Venue-Websites, Lokalzeitung, Gemeindeblatt, Facebook-Events der Locations (nur mit klarem Heute-/Termin-Bezug).',
    `Wenn wenig Treffer — aktiv nach „${city} Veranstaltungen heute“, „${city} Events heute Abend“${festType === 'wine' ? `, „${city} Weinfest heute/aktuell“` : ''}, Wochenprogramm-PDF suchen. Lieber 1–2 belegte Events als 4 vage.`,
    'Für jede Location: was läuft KONKRET (DJ, Party-Name, Live-Musik, Fest-Programm) + Uhrzeit/Datum + Eintritt/Preis wenn belegt + kurz wie der Ort ist (1–2 Sätze, nur Belege).',
    'startTime ist PFLICHT sobald irgendeine Quelle eine Uhr nennt („20:00“, „ab 21 Uhr“, „17.30“). Dann immer als HH:MM. null nur wenn wirklich keine Uhr in den Quellen steht — nie die Uhr nur in summary verstecken.',
    'Wenn ein PDF/Flyer/Wochenprogramm gefunden wird: URL mitnehmen (hasPdf=true).',
    'infoUrl = die EXAKTE URL aus dem Suchtreffer / Browser-Adresszeile 1:1 kopieren — die Seite, auf der du den Treffer siehst (wie „Link teilen“). Nie Stadt-Kalender, nie Slug erfinden/umbauen, nie thematisch fremde Seiten (z. B. Suchtprävention statt Weinfest). Wenn unsicher: infoUrl=null.',
    'VERBOTEN: nur „Kulturverwaltung“, „Tourist-Info“, Bars ohne heutiges Programm nennen.',
    'Wenn wirklich nichts gefunden: events=[] und researchNotes ehrlich.',
  ])
    .concat([
      '',
      'Antworte NUR mit JSON (kein Markdown außerhalb):',
      '{',
      '  "researchNotes": "kurz was du geprüft hast",',
      '  "events": [',
      '    {',
      '      "title": "Event-Name",',
      '      "venue": "Ort/Location",',
      '      "startTime": "20:00" | null,',
      '      "dateIso": "2026-09-12" | null,',
      '      "ticketPriceEur": 28 | null,',
      '      "summary": "4–8 Sätze: was passiert, Start/Ende, Eintritt, Stände/Preise/Acts wenn belegt, Besonderheit",',
      '      "infoUrl": "https://..." | null,',
      '      "ticketUrl": "https://..." | null,',
      '      "hasPdf": true|false,',
      '      "sourceHint": "z.B. Wochenprogramm PDF / Venue Website"',
      '    }',
      '  ]',
      '}',
      'Max 4 events. Nur belegte aktuelle/nächste Sachen.',
    ])
    .filter(Boolean)
    .join('\n');

  try {
    takeLastGeminiGroundingUrls();
    const raw = await generateGeminiText(prompt, {
      task: 'research',
      enableGoogleSearch: true,
      maxTokens: 2200,
      temperature: 0.25,
      useFindusSystem: false,
    });
    const parsed = extractJsonObject(raw);
    const grounded = [
      ...takeLastGeminiGroundingUrls(),
      ...extractHttpUrlsFromText(raw),
    ];
    let events = overlayGroundingEventUrls(
      await geocodeEventVenues(asEvents(parsed, city), city),
      grounded,
      city,
    );
    events = await Promise.all(
      events.map(async (e) => {
        const [infoUrl, ticketUrl] = await Promise.all([
          dropDeadEventPageUrl(e.infoUrl),
          dropDeadEventPageUrl(e.ticketUrl),
        ]);
        return { ...e, infoUrl, ticketUrl };
      }),
    );
    if (namedAsk && events.length) {
      events = await deepenNamedScheduleEventUrls(events);
    }
    // Genannter Termin leer → ein gezielter Retry (offizielle Seite / nächstes Heimspiel).
    if (namedAsk && events.length === 0) {
      try {
        takeLastGeminiGroundingUrls();
        const retryRaw = await generateGeminiText(
          [
            `Google Search Pflicht: nächste Termine zu „${userText.trim().slice(0, 160)}“.`,
            `Heute ISO ${dateIso}. Nicht nur heute — nächste belegte Heim-/Auswärtsspiele.`,
            'Quellen: offizielle Club-Website, BBL/Liga-Kalender, Ticketshop.',
            'Halle-Aliase: Ballsportarena, Inselpark Arena, Edel-optics, Barclays Arena.',
            'JSON nur: {"researchNotes":"...","events":[{title,venue,startTime,dateIso,ticketPriceEur,summary,infoUrl,ticketUrl,hasPdf,sourceHint}]}',
            'Max 3 events. Nichts erfinden. Nightlife verboten.',
          ].join('\n'),
          {
            task: 'research',
            enableGoogleSearch: true,
            maxTokens: 1800,
            temperature: 0.2,
            useFindusSystem: false,
          },
        );
        const retryParsed = extractJsonObject(retryRaw);
        const retryGrounded = [
          ...takeLastGeminiGroundingUrls(),
          ...extractHttpUrlsFromText(retryRaw),
        ];
        let retryEvents = overlayGroundingEventUrls(
          await geocodeEventVenues(asEvents(retryParsed, city), city),
          retryGrounded,
          city,
        );
        retryEvents = await Promise.all(
          retryEvents.map(async (e) => {
            const [infoUrl, ticketUrl] = await Promise.all([
              dropDeadEventPageUrl(e.infoUrl),
              dropDeadEventPageUrl(e.ticketUrl),
            ]);
            return { ...e, infoUrl, ticketUrl };
          }),
        );
        if (retryEvents.length) {
          events = namedAsk
            ? await deepenNamedScheduleEventUrls(retryEvents)
            : retryEvents;
        }
      } catch {
        /* soft — erstes Result behalten */
      }
    }
    if (userAskedForFestival(userText) || festType) {
      // Hard: immer Shops raus — lieber leer + ehrlich als Weinladen als Fest
      events = events.filter((e) => !looksLikeShopNotFestival(e));
    }
    if (festType && festType !== 'generic') {
      const typed = events.filter((e) => eventMatchesFestivalType(e, festType));
      // Hard-Match: lieber leer + ehrlich als falscher Fest-Typ
      events = typed;
    }
    // Nightlife-„heute“-Filter: Sport-Spielplan behält nächste Termine (auch Freitag nächste Woche).
    if (!sportsAsk) {
      events = events.filter((e) =>
        isUpcomingForUnsolicitedPitch(
          `${e.startTime ? `um ${e.startTime}` : ''} ${e.title} ${e.venue} ${e.summary}`,
        ),
      );
    }
    const notes =
      parsed && typeof parsed === 'object' && 'researchNotes' in parsed
        ? String((parsed as { researchNotes?: string }).researchNotes ?? '')
        : '';

    const venueOffers: PendingNavOffer[] = events.map((e, i) => ({
      poiId: -(9000 + i),
      name: e.venue,
      lat: e.lat ?? store.lastGpsLat ?? undefined,
      lng: e.lng ?? store.lastGpsLng ?? undefined,
    }));

    const briefingButtons =
      !sportsAsk &&
      (deepenAsk ||
        wantsEventBriefingActions(userText) ||
        events.length === 1);

    const promptBlock = [
      '=== TAGESAKTUELLE EVENT-RECHERCHE (PFLICHT) ===',
      `Stadt: ${city} · Datum: ${dateLabel}`,
      sportsAsk ? 'Modus: genannter Termin (Team/Act/Halle) — kein Nightlife-Ersatz.' : '',
      festType ? `Fest-Typ-Hard-Match: ${festType}` : '',
      notes ? `Research-Notizen: ${notes}` : '',
      events.length
        ? events
            .map(
              (e, i) =>
                `${i + 1}) ${e.title} @ ${e.venue}` +
                `${e.startTime ? ` · Start ${e.startTime}` : ''}` +
                `${e.summary ? ` — ${e.summary}` : ''}` +
                `${e.infoUrl ? ` · Info/PDF: ${e.infoUrl}` : ''}` +
                `${e.ticketUrl ? ` · Ticket: ${e.ticketUrl}` : ''}` +
                `${e.hasPdf ? ' · PDF/Flyer' : ''}` +
                `${e.sourceHint ? ` · Quelle: ${e.sourceHint}` : ''}` +
                ` · Vertrauen ${Math.round(e.sourceTrust * 100)}%`,
            )
            .join('\n')
        : sportsAsk
          ? 'Kein belegter Termin zum genannten Namen — ehrlich sagen. KEIN Club/Konzert/Nightlife als Ersatz.'
          : festType && festType !== 'generic'
          ? `Kein belegtes Event vom Typ „${festType}“ — ehrlich sagen. KEIN anderes Fest-Typ als Ersatz unterschieben.`
          : 'Keine belegten heutigen Events gefunden — ehrlich sagen, Alternativen kurz anbieten (ohne Fake-Programm).',
      '',
      'ANTWORT-REGELN:',
      sportsAsk ? FINDUS_ANSWER_FIRST_BLOCK : FINDUS_WOVEN_PITCH_SPEECH_BLOCK,
      sportsAsk ? FINDUS_NAMED_SCHEDULE_BLOCK : '',
      sportsAsk
        ? '- speechText: flüssige 1–3 Sätze (nächstes Spiel + optional zweites + Halle + Tickets ab X wenn belegt). KEIN Stakkato, kein „Nächstes Spiel:“/„Alternativ:“, kein Pitch-Opener, kein Nightlife.'
        : '- speechText: Idee kurz stützen (Wetter/Tageszeit ehrlich) → bei mehreren Treffern Top-2 pitchen → sonst / bei Nachfrage ein Fest ausführlich (bis ~1200 Zeichen Stoff).',
      '- Nie nur „ja gibt es“ / „läuft auf Hochtouren“. Uhrzeit/Ende, Eintritt, Angebot, Acts, Weinpreise, Buchbares nur belegt. Fest≠Weinladen. Weinfest≠Straßenfest. Keine Adressen vorlesen — außer User fragt explizit danach.',
      '- Aktuell/nächstes Datum vor saisonalem „meist im Mai“. Tagesfest/Markt schon gestartet → „läuft noch bis …“ nur wenn Ende belegt und es wirklich noch läuft.',
      '- Kino/Konzert/Auftritt/Vorstellung/Finsternis: Start vorbei → nicht vorschlagen, kein „läuft noch“. Kein Stoff mehr → ehrlich nichts.',
      '- Später Start (heute Abend): Zeit + Ort + Was weben — KEIN Los-jetzt-ETA. Läuft jetzt / Start in ≤~45 Min: Fahrzeit flüssig einweben.',
      '- Immer Fließtext, weiche Übergänge — kein Fakten-Telegramm / keine Rubriken.',
      '- Follow-up/Vertiefung: am genannten Fest bleiben, flüssig erzählen — keine Fakten-Liste und kein Themenwechsel.',
      '- Stadtweite Fest-Frage: wenn ≥2 Treffer → Top-2 pitchen (Favorit + Alternative), nicht nur eins — beide mit Programm-Stoff.',
      '- Bei Vertrauen <50%: als Hinweis formulieren („laut … / scheint …“), nicht als harte Tatsache.',
      sportsAsk
        ? '- quickActions: nur 📅 Spielplan (Deep-Link, nicht Homepage) + 🎫 Tickets (Preis im Label wenn belegt). KEINE START_NAVIGATION / keine Monat- oder Datum-Routen.'
        : briefingButtons
          ? '- quickActions: Navigation starten (wenn Koordinaten), Programm/PDF/Website, Tickets — klar benannt, 1:1 zum gesprochenen Fest.'
          : '- quickActions: klar benannt (🗺️ Maps, 🌐 Programm/Website, 🎫 Tickets/Probe). Bei Mehrfach-Auswahl: Programm/Maps pro Option; Route erst nach der Wahl.',
      '- 4–5 Buttons erlaubt wenn hilfreich. Keine fremden Orte als Buttons.',
      '- Extra-Mile: PDF/Flyer/Confetti-Buchung erwähnen wenn in der Recherche vorhanden.',
    ]
      .filter(Boolean)
      .join('\n');

    void noteEventVenuesForCollective(city, events);
    try {
      const { setLastTopic, setLastPlaceName } = require('../../module2/context/shortTermContext') as {
        setLastTopic: (t: string | null) => void;
        setLastPlaceName: (n: string | null) => void;
      };
      if (events[0]?.venue) setLastPlaceName(events[0].venue);
      setLastTopic(
        festType && festType !== 'generic'
          ? `${festType}-fest ${city}`
          : userText.trim().slice(0, 80),
      );
    } catch {
      /* soft */
    }

    return {
      dateLabel,
      city,
      events,
      researchNotes: notes,
      promptBlock,
      venueOffers,
      userText: userText.trim(),
    };
  } catch (err) {
    if (__DEV__) console.warn('[eventResearch] failed', err);
    return emptyEventResearch(
      city,
      'Recherche gerade fehlgeschlagen — gezielter nachfragen anbieten',
    );
  }
}

async function noteEventVenuesForCollective(
  city: string,
  events: ResearchedEvent[],
): Promise<void> {
  try {
    const { contributePlacesFromResearchResult } = await import(
      '../memory/collectiveLearning'
    );
    contributePlacesFromResearchResult({
      query: 'events today',
      city,
      venues: events.map((e) => ({
        name: e.venue,
        factText: `${e.title}${e.startTime ? ` · ${e.startTime}` : ''}`.slice(
          0,
          400,
        ),
        sourceUrl: e.infoUrl || e.ticketUrl,
        sourceTrust: Math.max(0.4, e.sourceTrust || 0.45),
        placeType: 'venue',
      })),
    });
  } catch {
    /* soft */
  }
}

/** Ticket-URL nur wenn konkret — Hollow-Suche raus. */
function usableTicketUrl(raw: string | null): string | null {
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  try {
    const { preferKonfettiAffiliateUrl } = require('../affiliate/konfettiAffiliate') as {
      preferKonfettiAffiliateUrl: (u: string) => string;
    };
    raw = preferKonfettiAffiliateUrl(raw.trim());
  } catch { /* soft */ }
  try {
    const { isHollowTicketPartnerUrl, normalizeAffiliateUrl } =
      require('../affiliate/affiliateService') as {
        isHollowTicketPartnerUrl: (u: string) => boolean;
        normalizeAffiliateUrl: (u: string) => string;
      };
    if (isHollowTicketPartnerUrl(raw)) return null;
    const url = normalizeAffiliateUrl(raw.trim());
    if (!url || isHollowTicketPartnerUrl(url)) return null;
    return url;
  } catch {
    return raw;
  }
}

/** Build deterministic quick actions from researched events (speech sync base). */
export function eventResearchToActions(
  research: EventResearchResult,
  opts?: { includeNav?: boolean },
): QuickAction[] {
  const actions: QuickAction[] = [];
  const ranked = [...research.events].sort(
    (a, b) => b.sourceTrust - a.sourceTrust,
  );
  const namedAsk = looksLikeNamedScheduleQuery(research.userText || '');
  // Genannter Spielplan: Buttons = Spielplan/Tickets — Nav nur bei explizitem includeNav
  const briefing =
    opts?.includeNav === true ||
    (!namedAsk &&
      (ranked.length === 1 ||
        wantsEventBriefingActions(research.userText || '')));
  const top = ranked.slice(0, namedAsk || briefing ? 1 : 2);
  for (const e of top) {
    let ticket = usableTicketUrl(e.ticketUrl);
    if (ticket) {
      try {
        const { ticketProductKey } = require('../affiliate/quoteIdentity') as {
          ticketProductKey: (u: string) => string | null;
        };
        if (ticketProductKey(ticket)) {
          const { preferTicketSource } = require('../affiliate/affiliateService') as {
            preferTicketSource: (i: {
              priced?: Array<{ url: string; priceEur?: number | null }>;
              userText?: string;
            }) => { url: string };
          };
          const { parseEurNumber } = require('../affiliate/quotePriceParse') as {
            parseEurNumber: (r?: string | null) => number | null;
          };
          const price =
            e.ticketPriceEur ??
            parseEurNumber(extractSpokenPriceEur(`${e.summary} ${e.title}`));
          ticket =
            preferTicketSource({
              priced: [{ url: ticket, priceEur: price }],
              userText: research.userText,
            }).url || ticket;
        }
      } catch {
        /* keep usable */
      }
      const tasting = /weinprobe|verkostung|probe|confetti|konfetti/i.test(
        `${e.title} ${e.summary} ${ticket}`,
      );
      const priceLabel =
        namedAsk && e.ticketPriceEur != null
          ? `🎫 Tickets ab ${String(e.ticketPriceEur).replace('.', ',')}€`
          : tasting
            ? '🎫 Probe buchen'
            : namedAsk
              ? '🎫 Tickets'
              : `🎫 Ticket ${e.title}`;
      actions.push({
        type: 'OPEN_URL',
        label: shortenActionLabel(priceLabel),
        payload: {
          url: ticket,
          destName: e.venue,
          entityName: e.title,
        },
      });
    }
    const program = resolveEventProgramAction(e, research.city);
    if (program.url && program.url !== ticket) {
      let programUrl = program.url;
      // Named schedule: Venue-Home / hollow raus — nur Deep-Schedule (analog Speisekarte)
      if (namedAsk) {
        try {
          const {
            isClubOrActHomepageUrl,
            isScheduleDeepPath,
          } = require('../actionBoard/scheduleDeepLink') as {
            isClubOrActHomepageUrl: (u: string) => boolean;
            isScheduleDeepPath: (u: string) => boolean;
          };
          const deepEnough =
            isScheduleDeepPath(programUrl) ||
            /\/(spielplan|fixtures?|schedule|tickets?|heimspiele?|spiele|kalender|ticketshop)(\/|\.|\?|#|$)/i.test(
              programUrl,
            );
          if (isClubOrActHomepageUrl(programUrl) || !deepEnough) {
            programUrl = '';
          }
        } catch {
          /* keep */
        }
      }
      if (programUrl) {
        const scheduleLabel = namedAsk ? '📅 Spielplan' : program.label;
        actions.push({
          type: 'OPEN_URL',
          label: shortenActionLabel(scheduleLabel),
          payload: {
            url: programUrl,
            destName: e.venue,
            entityName: e.title,
          },
        });
      }
    }
    if (
      briefing &&
      !namedAsk &&
      e.lat != null &&
      e.lng != null &&
      e.venue
    ) {
      try {
        const { isMonthOrDateOnlyNavName } = require('../research/htmlResearchGate') as {
          isMonthOrDateOnlyNavName: (n: string) => boolean;
        };
        if (isMonthOrDateOnlyNavName(e.venue)) {
          /* skip fake month nav */
        } else {
          actions.push({
            type: 'START_NAVIGATION',
            label: shortenActionLabel('📍 Navigation starten'),
            payload: {
              destName: e.venue,
              destLat: e.lat,
              destLng: e.lng,
              skipDestVerify: true,
              skipClosingGate: true,
            },
          });
        }
      } catch {
        actions.push({
          type: 'START_NAVIGATION',
          label: shortenActionLabel('📍 Navigation starten'),
          payload: {
            destName: e.venue,
            destLat: e.lat,
            destLng: e.lng,
            skipDestVerify: true,
            skipClosingGate: true,
          },
        });
      }
    } else if (!namedAsk) {
      // Maps nur mit Ortsnamen — nie nackte Koordinaten-Query
      const mapsUrl = buildNamedPlaceMapsUrl({
        placeName: e.venue || e.title,
        city: research.city,
      });
      if (mapsUrl) {
        actions.push({
          type: 'OPEN_URL',
          label: shortenActionLabel(`🗺️ Maps ${e.venue || e.title}`),
          payload: { url: mapsUrl, destName: e.venue || e.title },
        });
      }
    }
  }
  return actions.slice(0, 5);
}

function daypartMotivationLead(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'Passt gut in den Vormittag';
  if (h >= 11 && h < 17) return 'Passt super, um den Nachmittag zu füllen';
  if (h >= 17 && h < 21) return 'Passt gut, um in den Abend zu starten';
  return 'Passt, wenn du den Abend noch ausklingen lassen willst';
}

function stripAddressesFromEventText(text: string): string {
  return text
    .replace(
      /\b(?:[A-ZÄÖÜ][\wÄÖÜäöüß.-]*(?:straße|strasse|str\.|allee|weg|platz|gasse|ring|damm)|Am\s+[A-ZÄÖÜ][\wÄÖÜäöüß.-]+|An\s+der\s+[A-ZÄÖÜ][\wÄÖÜäöüß.-]+)\s+\d{1,4}[a-zA-Z]?(?:\s*,\s*\d{5})?/gu,
      '',
    )
    .replace(/\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)*/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function scheduleSpeechForEvent(e: ResearchedEvent): string {
  const later = isLaterPlanSchedule({
    startTime: e.startTime,
    whenText: e.summary,
  });
  if (later) {
    const rel = formatRelativeWhenSpeech({
      startTime: e.startTime,
      whenText: `${e.summary || ''} ${e.startTime || ''}`,
    });
    if (rel) return `${rel.charAt(0).toUpperCase()}${rel.slice(1)}. `;
  }
  const start = e.startTime || extractSpokenClock(e.summary);
  const end = extractSpokenEndClock(e.summary);
  if (!start && !end) return '';
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const parseHm = (c: string): number | null => {
    const m = c.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const startMin = start ? parseHm(start) : null;
  const timedShow =
    looksLikeTimedStartShow(`${e.title} ${e.summary}`) &&
    !looksLikeOngoingDayEvent(`${e.title} ${e.summary}`);
  if (startMin != null && nowMin >= startMin) {
    if (timedShow) return '';
    if (end) return `Läuft noch bis ${end} Uhr. `;
    return `Läuft schon (seit ${start} Uhr). `;
  }
  if (start && end) return `Ab ${start} Uhr bis ${end} Uhr. `;
  if (start) return `Ab ${start} Uhr. `;
  if (end) return `Bis ${end} Uhr. `;
  return '';
}

function etaSpeechForEvent(e: ResearchedEvent): string {
  try {
    if (e.lat == null || e.lng == null) return '';
    const later = isLaterPlanSchedule({
      startTime: e.startTime,
      whenText: `${e.summary || ''} ${e.title}`,
    });
    const { useGpsStore } = require('../../store/useGpsStore') as {
      useGpsStore: { getState: () => { lat: number | null; lng: number | null } };
    };
    const {
      eventTravelHintFromCoords,
      weaveEventTravelIntoSpeech,
      formatLaterPlanClosenessSpeech,
    } = require('./eventTravelSpeech') as {
      eventTravelHintFromCoords: (o: {
        fromLat: number;
        fromLng: number;
        toLat: number;
        toLng: number;
        liveTransitMin?: number | null;
        liveArrivalAt?: Date | null;
      }) => { speech: string; meters?: number } | null;
      weaveEventTravelIntoSpeech: (
        clause: string,
        style?: 'continue' | 'tail',
      ) => string;
      formatLaterPlanClosenessSpeech: (m: number | null | undefined) => string;
    };
    const gps = useGpsStore.getState();
    if (gps.lat == null || gps.lng == null) return '';
    const hint = eventTravelHintFromCoords({
      fromLat: gps.lat,
      fromLng: gps.lng,
      toLat: e.lat,
      toLng: e.lng,
      liveTransitMin: e.liveTransitMin,
      liveArrivalAt:
        e.liveArrivalAtMs != null ? new Date(e.liveArrivalAtMs) : null,
    });
    if (!hint) return '';
    if (later) {
      const close = formatLaterPlanClosenessSpeech(hint.meters);
      return close ? ` ${close.charAt(0).toUpperCase()}${close.slice(1)}.` : '';
    }
    return weaveEventTravelIntoSpeech(hint.speech, 'tail');
  } catch {
    return '';
  }
}

function distBulletForEvent(e: ResearchedEvent): string | null {
  try {
    if (e.lat == null || e.lng == null) return null;
    const { useGpsStore } = require('../../store/useGpsStore') as {
      useGpsStore: { getState: () => { lat: number | null; lng: number | null } };
    };
    const { eventTravelHintFromCoords } = require('./eventTravelSpeech') as {
      eventTravelHintFromCoords: (o: {
        fromLat: number;
        fromLng: number;
        toLat: number;
        toLng: number;
        liveTransitMin?: number | null;
        liveArrivalAt?: Date | null;
      }) => {
        distLabel: string;
        minutes: number;
        mode: string;
        arrivalClock: string;
      } | null;
    };
    const gps = useGpsStore.getState();
    if (gps.lat == null || gps.lng == null) return null;
    const hint = eventTravelHintFromCoords({
      fromLat: gps.lat,
      fromLng: gps.lng,
      toLat: e.lat,
      toLng: e.lng,
      liveTransitMin: e.liveTransitMin,
      liveArrivalAt:
        e.liveArrivalAtMs != null ? new Date(e.liveArrivalAtMs) : null,
    });
    if (!hint) return null;
    const modeLabel =
      hint.mode === 'transit'
        ? 'ÖPNV'
        : hint.mode === 'bike'
          ? 'Rad'
          : hint.mode === 'taxi'
            ? 'Taxi'
            : 'Fuß';
    return `${hint.distLabel} · Ankunft ~${hint.arrivalClock} ${modeLabel}`;
  } catch {
    return null;
  }
}

export function synthesizeEventSpeech(research: EventResearchResult): string {
  const ranked = [...research.events].sort(
    (a, b) => b.sourceTrust - a.sourceTrust,
  );
  const city = research.city || 'der Umgebung';
  const userBlob = (research.userText || '').toLowerCase();
  const namedAsk =
    looksLikeNamedScheduleQuery(research.userText || '') ||
    isSportsScheduleQuery(research.userText || '');
  if (namedAsk) {
    if (!ranked.length) {
      const notes = (research.researchNotes || '').toLowerCase();
      if (/offline/.test(notes)) {
        return `Die Frage kann ich gerade nicht beantworten. Geh wieder online, dann hake ich nach.`;
      }
      if (/api-key|fehlgeschlagen|nicht verfügbar|research_unavailable/.test(notes)) {
        return `Die Live-Suche zum genannten Termin hakt gerade. Ich erfinde nichts und ersetze das nicht durch Club oder Konzert — gleich nochmal, oder nenn mir Datum/Ort.`;
      }
      return `Zum genannten Termin finde ich gerade keinen belegten Eintrag. Ich ersetze das nicht durch Club, Konzert oder ein anderes Programm — nenn mir gern Datum oder Ort, dann such ich gezielter.`;
    }
    const topN = ranked.slice(0, 2);
    const weaveOne = (e: ResearchedEvent): string => {
      const whenRaw = formatNamedScheduleDateSpeech(
        e.dateIso,
        e.startTime,
        e.summary,
      )
        .replace(/\.\s*$/, '')
        .trim();
      // „Sonntag, 27. Dezember, Anpfiff …“ → „am Sonntag, 27. Dezember …“
      const whenBit = whenRaw
        ? /^anpfiff\b/iu.test(whenRaw)
          ? whenRaw
          : `am ${whenRaw.replace(/^am\s+/iu, '')}`
        : '';
      const venueBit = e.venue
        ? /\b(arena|halle|stadion|park)\b/iu.test(e.venue)
          ? ` in der ${e.venue}`
          : ` in ${e.venue}`
        : '';
      const title = stripAddressesFromEventText(e.title).trim();
      // Titel oft schon „Team gegen Gegner“ — nicht doppelt „Spiel:“ davor
      const core = whenBit
        ? `${title} spielen als nächstes ${whenBit}${venueBit}`
        : `${title}${venueBit}`;
      return core.replace(/\s+/g, ' ').trim();
    };
    let speech = weaveOne(topN[0]!);
    if (topN[1]) {
      const e2 = topN[1]!;
      const when2 = formatNamedScheduleDateSpeech(
        e2.dateIso,
        e2.startTime,
        e2.summary,
      )
        .replace(/\.\s*$/, '')
        .replace(/^am\s+/iu, '')
        .trim();
      const opp =
        e2.title
          .replace(/^.*?gegen\s+/iu, '')
          .replace(/\s+/g, ' ')
          .trim() || e2.title;
      if (when2) {
        speech += ` und am ${when2.replace(/,?\s*Anpfiff\b.*/iu, '').trim()} gegen ${opp}`;
      }
    }
    const priceEur =
      topN[0]?.ticketPriceEur ??
      ranked.find((e) => e.ticketPriceEur != null)?.ticketPriceEur;
    const priceSpoken =
      priceEur != null
        ? `Tickets gehen ab ${String(priceEur).replace('.', ',')} Euro los`
        : extractSpokenPriceEur(topN[0]?.summary || '')
          ? `Tickets liegen bei ${extractSpokenPriceEur(topN[0]?.summary || '')}`
          : '';
    if (priceSpoken) {
      speech = `${speech}. ${priceSpoken}`;
    } else {
      speech = `${speech}.`;
    }
    const hasTicket = ranked.some((e) => Boolean(usableTicketUrl(e.ticketUrl)));
    const hasSchedule = ranked.some((e) => {
      try {
        const {
          isClubOrActHomepageUrl,
          isScheduleDeepPath,
        } = require('../actionBoard/scheduleDeepLink') as {
          isClubOrActHomepageUrl: (u: string) => boolean;
          isScheduleDeepPath: (u: string) => boolean;
        };
        const u = e.infoUrl || '';
        return (
          /^https?:\/\//i.test(u) &&
          !isClubOrActHomepageUrl(u) &&
          (isScheduleDeepPath(u) || /spielplan|fixtures?|schedule|ticket/i.test(u))
        );
      } catch {
        return Boolean(e.infoUrl && /^https?:\/\//i.test(e.infoUrl));
      }
    });
    // Weicher CTA — kein Button-Meta / kein Stakkato
    if (hasTicket || hasSchedule) {
      speech += priceSpoken
        ? ' Mehr Infos und Preise liegen bereit, wenn du willst.'
        : ' Spielplan und Tickets kann ich dir direkt öffnen, wenn du willst.';
    }
    return stripAddressesFromEventText(speech)
      .replace(/\s+/g, ' ')
      .replace(/\.\s*\./g, '.')
      .trim()
      .slice(0, 1200);
  }
  const festAsk = userAskedForFestival(research.userText || '');
  const festType = detectAskedFestivalType(research.userText || '');
  const deepenAsk = isEventFestivalDeepenQuery(research.userText || '');
  const typeLabel =
    festType === 'wine'
      ? 'Weinfest'
      : festType === 'beer'
        ? 'Bierfest'
        : festType === 'street'
          ? 'Straßenfest'
          : festType === 'city'
            ? 'Stadtfest'
            : festType === 'music'
              ? 'Musikfest'
              : festType === 'food'
                ? 'Food-Fest'
                : festAsk
                  ? 'Fest'
                  : null;

  if (!ranked.length) {
    const notes = (research.researchNotes || '').toLowerCase();
    const namedAsk =
      isSportsScheduleQuery(research.userText || '') ||
      looksLikeNamedScheduleQuery(research.userText || '');
    if (/offline/.test(notes)) {
      return `Die Frage kann ich gerade nicht beantworten. Geh wieder online, dann hake ich nach.`;
    }
    if (/api-key|fehlgeschlagen|nicht verfügbar|research_unavailable/.test(notes)) {
      return namedAsk
        ? `Die Live-Suche zum genannten Termin hakt gerade. Ich erfinde nichts und ersetze das nicht durch Club oder Konzert — gleich nochmal, oder nenn mir Datum/Ort.`
        : `Die Live-Event-Suche für ${city} hakt gerade. Sag mir gern einen Namen oder Stadtteil — dann versuche ich es gezielter.`;
    }
    if (namedAsk) {
      return `Zum genannten Termin finde ich gerade keinen belegten Eintrag. Ich ersetze das nicht durch Club, Konzert oder ein anderes Programm — nenn mir gern Datum oder Ort, dann such ich gezielter.`;
    }
    if (festType && festType !== 'generic') {
      return `Für ${typeLabel} in ${city} finde ich gerade kein belegtes aktuelles Programm. Ich ersetze das nicht durch ein anderes Fest — wenn du einen Namen oder Stadtteil hast, such ich gezielter.`;
    }
    return festAsk
      ? `Für heute in ${city} finde ich gerade kein belegtes Fest-Programm. Wenn du einen Stadtteil oder Namen hast, such ich gezielter — keine Weinläden als Ersatz.`
      : `Für heute in ${city} finde ich in den Kalendern gerade kein belegtes Programm. Wenn du einen konkreten Namen hast, such ich gezielter — ohne Ersatz-Kategorie.`;
  }
  const hasTicket = ranked.some((e) => {
    if (!e.ticketUrl || !/^https?:\/\//i.test(e.ticketUrl)) return false;
    try {
      const {
        isHollowTicketPartnerUrl,
      } = require('../affiliate/affiliateService') as {
        isHollowTicketPartnerUrl: (u: string) => boolean;
      };
      return !isHollowTicketPartnerUrl(e.ticketUrl);
    } catch {
      return true;
    }
  });
  const laterTop = isLaterPlanSchedule({
    startTime: ranked[0]?.startTime,
    whenText: `${ranked[0]?.summary || ''} ${ranked[0]?.title || ''}`,
  });
  const soft = (e: ResearchedEvent) =>
    e.sourceTrust < 0.5
      ? `laut ${e.sourceHint || 'Programmhinweis'} `
      : '';
  const top = ranked.slice(0, 2);
  const forceDeep =
    deepenAsk ||
    ranked.length === 1 ||
    wantsEventBriefingActions(research.userText || '');
  const cta = laterTop
    ? 'Was hältst du von der Idee — soll ich den Termin einplanen?'
    : forceDeep
      ? hasTicket
        ? 'Navigation und Programm liegen bereit — Tickets kannst du direkt buchen.'
        : 'Navigation und Programm liegen bereit.'
      : hasTicket
        ? 'Karten, Programm und Tickets sind dabei.'
        : 'Karten und Infos sind dabei.';
  const lead =
    festAsk && !laterTop
      ? `${daypartMotivationLead()} — ${typeLabel || (userBlob.includes('wein') ? 'Weinfest' : 'Fest')} in ${city} ist eine starke Idee. `
      : '';

  const hookBit = (e: ResearchedEvent) =>
    stripAddressesFromEventText(
      (e.summary || e.title).replace(/\s+/g, ' ').trim(),
    );

  const deepOne = (e: ResearchedEvent) => {
    const when = scheduleSpeechForEvent(e);
    const price = extractSpokenPriceEur(e.summary);
    const priceBit = price ? `Eintritt liegt bei ${price}. ` : '';
    const body = hookBit(e);
    const dense =
      body.length >= 80
        ? body
        : `${body} ${soft(e)}Mehr Details stehen im Programm — Acts, Stände und Preise prüfe ich live mit.`.trim();
    const eta = etaSpeechForEvent(e);
    const later = isLaterPlanSchedule({
      startTime: e.startTime,
      whenText: e.summary,
    });
    if (deepenAsk) {
      const core = later
        ? `${soft(e)}${e.title} im ${e.venue} ${when}${dense} ${priceBit}${eta}`
        : `${soft(e)}${e.title} an der ${e.venue}. ${when}${dense} ${priceBit}` +
          (eta ? ` ${eta.trim()}` : '');
      return stripAddressesFromEventText(core)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1150);
    }
    const core = later
      ? `${soft(e)}${e.title} im ${e.venue} ${when}${dense} ${priceBit}${eta}`
          .replace(/\s+/g, ' ')
          .trim()
      : `${soft(e)}${e.title} am ${e.venue}. ${when}${dense} ${priceBit}${eta}`
          .replace(/\s+/g, ' ')
          .trim();
    return stripAddressesFromEventText(core).slice(0, 1150);
  };

  const shortPitch = (e: ResearchedEvent, role: 'Favorit' | 'Alternative') => {
    const when = scheduleSpeechForEvent(e).trim();
    const price = extractSpokenPriceEur(e.summary);
    const priceBit = price ? ` Eintritt liegt bei ${price}.` : '';
    const hook = hookBit(e).slice(0, 220);
    const eta = etaSpeechForEvent(e);
    const later = isLaterPlanSchedule({
      startTime: e.startTime,
      whenText: e.summary,
    });
    const whenBit = when ? ` ${when.replace(/\.\s*$/, '')}` : '';
    if (later) {
      const leadBit =
        role === 'Favorit'
          ? `${e.title} im ${e.venue}`
          : `alternativ ${e.title} im ${e.venue}`;
      return stripAddressesFromEventText(
        `${leadBit}${whenBit ? ` ${whenBit}` : ''} — ${soft(e)}${hook}${priceBit}${eta}`,
      )
        .replace(/\s+/g, ' ')
        .trim();
    }
    const roleLead =
      role === 'Favorit'
        ? `Mein Favorit ist ${e.title} an der ${e.venue}.`
        : `Als Alternative liegt ${e.title} an der ${e.venue} nah.`;
    return stripAddressesFromEventText(
      `${roleLead}${whenBit}${priceBit} ${soft(e)}${hook}${eta}`,
    )
      .replace(/\s+/g, ' ')
      .trim();
  };

  let speech: string;
  // Stadtweite Fest-Frage → lieber Top-2 pitchen als ein Briefing erzwingen
  const preferDual =
    festAsk &&
    !deepenAsk &&
    ranked.length >= 2 &&
    !wantsEventBriefingActions(research.userText || '');
  if ((forceDeep || top.length === 1) && !preferDual) {
    speech = `${lead}${deepOne(top[0]!)} ${cta}`;
  } else if (festAsk || ranked.length >= 2 || preferDual) {
    speech = laterTop
      ? `${lead}${shortPitch(top[0]!, 'Favorit')}. Und wenn das nicht sitzt: ${shortPitch(top[1]!, 'Alternative')}. ${cta}`
      : `${lead}In ${city} läuft mehr als eins — meine Top-Favoriten: ` +
        `${shortPitch(top[0]!, 'Favorit')} ${shortPitch(top[1]!, 'Alternative')} ${cta}`;
  } else {
    speech = `${lead}${deepOne(top[0]!)} ${cta}`;
  }
  return speech.replace(/\s+/g, ' ').trim().slice(0, 1200);
}

export function eventFactBullets(research: EventResearchResult): string[] {
  return research.events.slice(0, 2).map((e) => {
    const when = e.startTime || extractSpokenClock(e.summary);
    const end = extractSpokenEndClock(e.summary);
    const dateBit = e.dateIso
      ? e.dateIso.split('-').reverse().join('.')
      : null;
    const schedule = dateBit
      ? when
        ? `${dateBit} ${when}`
        : dateBit
      : when && end
        ? `${when}–${end}`
        : when
          ? `Ab ${when}`
          : end
            ? `Bis ${end}`
            : null;
    const price =
      e.ticketPriceEur != null
        ? `ab ${String(e.ticketPriceEur).replace('.', ',')} €`
        : extractSpokenPriceEur(e.summary);
    const dist = distBulletForEvent(e);
    const bits = [schedule, e.title, price, dist].filter(Boolean);
    return bits.join(' · ');
  });
}

function resolveEventProgramUrl(e: ResearchedEvent, city: string): string | null {
  try {
    const { resolveEventProgramLink } = require('../research/eventInfoUrl') as {
      resolveEventProgramLink: (o: {
        candidate?: string | null;
        ticketUrl?: string | null;
        hints: { title?: string | null; venue?: string | null; city?: string | null };
        hasPdf?: boolean;
      }) => { url: string; kind: string; label: string };
    };
    return resolveEventProgramLink({
      candidate: e.infoUrl,
      ticketUrl: e.ticketUrl,
      hints: { title: e.title, venue: e.venue, city },
      hasPdf: e.hasPdf,
    }).url;
  } catch {
    return e.infoUrl;
  }
}

function resolveEventProgramAction(
  e: ResearchedEvent,
  city: string,
): { url: string; label: string } {
  try {
    const { resolveEventProgramLink } = require('../research/eventInfoUrl') as {
      resolveEventProgramLink: (o: {
        candidate?: string | null;
        ticketUrl?: string | null;
        hints: { title?: string | null; venue?: string | null; city?: string | null };
        hasPdf?: boolean;
      }) => { url: string; label: string };
    };
    const link = resolveEventProgramLink({
      candidate: e.infoUrl,
      ticketUrl: e.ticketUrl,
      hints: { title: e.title, venue: e.venue, city },
      hasPdf: e.hasPdf,
    });
    return { url: link.url, label: link.label };
  } catch {
    return {
      url: e.infoUrl || `https://www.google.com/search?q=${encodeURIComponent(e.title)}`,
      label: '🔍 Infos',
    };
  }
}

/** Zwei Event-Karten nebeneinander (live_split), inkl. Ticket pro Karte. */
export function publishEventLivePitch(
  research: EventResearchResult,
  speech: string,
): void {
  const top = [...research.events]
    .sort((a, b) => b.sourceTrust - a.sourceTrust)
    .slice(0, 2);
  if (!top.length) return;
  try {
    const { publishPitchResult } = require('../../module2/pitch/publishPitchUi') as {
      publishPitchResult: (
        r: import('../../module2/pitch/types').PitchResult,
        o: { stepKey: string; headline: string },
      ) => void;
    };
    const { buildPitchActions } = require('../../module2/pitch/pitchActions') as {
      buildPitchActions: (o: {
        kind: 'tour';
        name: string;
        lat: number;
        lng: number;
        mapsUrl: string;
        ticketUrl?: string | null;
        websiteUrl?: string | null;
        role?: 'favorite' | 'alternative';
        suppressNav?: boolean;
        websiteLabel?: string | null;
      }) => QuickAction[];
    };
    const options = top.map((e, i) => {
      const lat = typeof e.lat === 'number' ? e.lat : 0;
      const lng = typeof e.lng === 'number' ? e.lng : 0;
      const mapsUrl =
        buildNamedPlaceMapsUrl({
          placeName: e.venue || e.title,
          city: research.city,
        }) || '';
      const price = extractSpokenPriceEur(e.summary);
      const when = e.startTime || extractSpokenClock(e.summary);
      const end = extractSpokenEndClock(e.summary);
      const ticket = usableTicketUrl(e.ticketUrl);
      const program = resolveEventProgramAction(e, research.city);
      const role = i === 0 ? ('favorite' as const) : ('alternative' as const);
      return {
        id: `event_${i}_${e.title.slice(0, 24)}`,
        name: e.title,
        lat,
        lng,
        role,
        speechPitch: stripAddressesFromEventText(e.summary || e.title),
        bullets: [
          when && end ? `${when}–${end}` : when ? `Ab ${when}` : end ? `Bis ${end}` : null,
          price,
          e.venue,
          distBulletForEvent(e),
        ].filter(Boolean) as string[],
        mapsUrl,
        ticketUrl: ticket,
        websiteUrl: program.url,
        actions: buildPitchActions({
          kind: 'tour',
          name: e.title,
          lat,
          lng,
          mapsUrl,
          ticketUrl: ticket,
          websiteUrl: program.url,
          role,
          suppressNav: lat === 0 && lng === 0,
          websiteLabel: program.label,
        }),
      };
    });
    const { pitchHeadlineFromContext } = require('../../module2/pitch/pitchHeadline') as {
      pitchHeadlineFromContext: (o: {
        userText?: string | null;
        city?: string | null;
        fallback?: string | null;
      }) => string;
    };
    const headline = pitchHeadlineFromContext({
      userText: research.userText,
      city: research.city,
      fallback: 'Heute',
    });
    publishPitchResult(
      {
        requestId: `events_${Date.now()}`,
        softFail: false,
        spokenText: speech,
        summary: headline,
        options,
        uiLayout: 'live_split',
      },
      { stepKey: 'events_today', headline },
    );
  } catch {
    /* soft */
  }
}
