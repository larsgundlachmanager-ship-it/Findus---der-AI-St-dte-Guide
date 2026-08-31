/**
 * Nebenbei-Mitdenken: Hotel klar → still speichern; unklar → nachfragen;
 * Flug → nachfragen; Place-Feedback still merken.
 */

import { getAllPois } from '../../db/database';
import { parseTagsJson } from '../geo/triggerPolicy';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { extractFlightCode } from '../flights/flightAdvisor';
import { capturePlaceFeedback } from './placeFeedbackIntent';
import {
  isParkingSpotSaveIntent,
  parseParkingMaxDurationMin,
  saveParkingSpot,
} from '../timeline/parkingSpotStore';

const HOTEL_STOP =
  /^(moment|prinzip|griff|weg|zentrum|café|cafe|park|museum|bahnhof|restaurant|supermarkt|markt|laden|dm|rossmann|aldi|lidl|rewe|edeka|apotheke|toilette|klo|meer|strand|hafen|insel|stadt|zimmer|bett|frühstück|fruehstueck|zahnbürste|zahnbuerste|cola|bier|wegbier|wasser|einkauf|kaufen|brauch|benötig)$/i;

const EXPLICIT_HOTEL_SAVE =
  /\b(?:mein\s+hotel\s+(?:heißt|heisst|ist)|ich\s+(?:bin|wohne|schlafe|übernachte|uebernachte)\s+(?:im|in|beim)|zum\s+hotel|ins\s+hotel|navigier(?:e|en)?\s+(?:mich\s+)?(?:zum\s+)?hotel|merk(?:e)?\s+(?:dir|das)|als\s+(?:meine?\s+)?(?:homebase|basis|unterkunft)|homebase|neue\s+basis)\b/iu;

const CLEAR_HOTEL_STAY =
  /\b(?:mein|unser)\s+hotel\b|\b(?:ich|wir)\s+(?:wohne|wohnen|schlafe|schlafen|übernachte|uebernachte|übernachten|uebernachten|bin)\b.*\b(?:hotel|pension|hostel|unterkunft)\b|\b(?:hotel|pension|hostel)\b.*\b(?:merk(?:e)?\s+dir|homebase|als\s+basis)\b/iu;

/** „Das ist mein Haus / meine Ferienwohnung / Startpunkt hier“ → Unterkunft speichern */
const HOME_STAY_RE =
  /\b(?:das\s+ist\s+(?:mein|unser)\s+(?:haus|zuhause|home)|hier\s+(?:ist|wohn(?:e|en)\s+ich)\s+(?:mein|unser)?\s*(?:haus|zuhause)|(?:mein|unsere?)\s+(?:ferienwohnung|ferienhaus|apartment|wohnung)\b|das\s+ist\s+(?:meine|unsere)\s+(?:ferienwohnung|ferienhaus|wohnung)|hier\s+(?:ist|als)\s+(?:mein\s+)?startpunkt|setz(?:e)?\s+(?:mein\s+)?(?:zuhause|hotel|startpunkt)\s+hier|startpunkt\s+hier)\b/iu;

const INCIDENTAL_FLY =
  /\b(?:flieg(?:e|en|st)?|fliegen\s+wir|flieg\s+ich|mein\s+flug|unser\s+flug|abflug|zum\s+flughafen|flughafen|boarding)\b/iu;

export type SideChannelAsk = {
  hotelAsk: string | null;
  flightAsk: string | null;
  parkingAck: string | null;
};

function normalizeHotelLabel(raw: string): string | null {
  let name = raw.replace(/\s+/g, ' ').trim();
  name = name
    .replace(
      /\s+(kannst|könntest|koenntest|bitte|oder|und|wo|gibt|gibt.?s|ist|sind|noch).*$/iu,
      '',
    )
    .trim();
  if (name.length < 2 || name.length > 48) return null;
  if (HOTEL_STOP.test(name)) return null;
  if (/^(hotel|pension|hostel)$/i.test(name)) return null;
  if (
    !/^hotel\b/i.test(name) &&
    !/^pension\b/i.test(name) &&
    !/^hostel\b/i.test(name)
  ) {
    name = `Hotel ${name}`;
  }
  return name;
}

function extractHotelNameFromText(
  text: string,
  skipExplicitGuard: boolean,
): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (!skipExplicitGuard && EXPLICIT_HOTEL_SAVE.test(t)) return null;

  const patterns: RegExp[] = [
    /\b(?:hotel|pension|hostel)\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,5})/u,
    /\b(?:im|in|beim|bei)\s+hotel\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,5})/u,
    /\b(?:wir\s+(?:sind|wohnen|schlafen|übernachten|uebernachten)|unser\s+hotel(?:\s+(?:heißt|heisst|ist))?|mein\s+hotel(?:\s+(?:heißt|heisst|ist))?)\s+(?:im|in|beim|bei)?\s*(?:hotel\s+)?([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,5})/iu,
    // STT-Quirks: „Bett for Night“ / „… for Night“
    /\b((?:[\wÄÖÜäöüß\-']+\s+){0,3}bett\s+for\s+night)\b/iu,
    /\b((?:gold\s*)?schätze?\s+(?:will\s+das\s+)?bett\s+for\s+night)\b/iu,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const label = normalizeHotelLabel(m[1]);
      if (label) return label;
    }
  }
  return null;
}

export function extractIncidentalHotelName(text: string): string | null {
  return extractHotelNameFromText(text, false);
}

export function isIncidentalFlightMention(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (!INCIDENTAL_FLY.test(t)) return false;
  if (extractFlightCode(t)) return false;
  return true;
}

function isClearHotelMention(text: string): boolean {
  return CLEAR_HOTEL_STAY.test(text) || EXPLICIT_HOTEL_SAVE.test(text);
}

async function hotelNameLooksReal(name: string): Promise<boolean> {
  if (/^hotel\s+/i.test(name) || /^pension\s+/i.test(name)) return true;
  try {
    const pois = await getAllPois();
    const q = name.toLowerCase().replace(/^hotel\s+/i, '');
    return pois.some((poi) => {
      const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
      const blob = `${poi.name} ${poi.category ?? ''} ${tags}`.toLowerCase();
      const isHotel = /(hotel|pension|unterkunft|hostel)/i.test(blob);
      if (!isHotel) return false;
      const n = poi.name.toLowerCase().replace(/^hotel\s+/i, '');
      return n.includes(q) || q.includes(n);
    });
  } catch {
    return true;
  }
}

async function resolveHotelCoords(name: string): Promise<{
  lat?: number;
  lng?: number;
  poiId?: number;
}> {
  try {
    const pois = await getAllPois();
    const q = name.toLowerCase().replace(/^hotel\s+/i, '');
    for (const poi of pois) {
      const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
      const blob = `${poi.name} ${poi.category ?? ''} ${tags}`.toLowerCase();
      const isHotel = /(hotel|pension|unterkunft|hostel)/i.test(blob);
      if (!isHotel && !poi.name.toLowerCase().includes('hotel')) continue;
      const n = poi.name.toLowerCase().replace(/^hotel\s+/i, '');
      if (n.includes(q) || q.includes(n) || blob.includes(q)) {
        return { lat: poi.lat, lng: poi.lng, poiId: poi.id };
      }
    }
  } catch {
    /* ignore */
  }
  const gps = useFinnusStore.getState();
  return {
    lat: gps.lastGpsLat ?? undefined,
    lng: gps.lastGpsLng ?? undefined,
  };
}

async function silentSaveHotel(hotelName: string): Promise<void> {
  const mem = useUserMemoryStore.getState();
  const coords = await resolveHotelCoords(hotelName);
  mem.addOrUpdateEntity({
    type: 'hotel',
    name: hotelName,
    isConfirmed: true,
    lat: coords.lat,
    lng: coords.lng,
    poiId: coords.poiId,
    notes: 'Klar genannt — still gespeichert',
    visitedAt: new Date().toISOString(),
  });
  mem.setPendingHotelConfirm(null);
  mem.setAwaitingHotelName(false);
  try {
    const { applyConfirmedHotelAsDayBase } = await import('./hotelBasePresence');
    applyConfirmedHotelAsDayBase({
      name: hotelName,
      lat: coords.lat,
      lng: coords.lng,
    });
  } catch {
    /* soft */
  }
  if (__DEV__) console.log(`[memory] silent hotel save: ${hotelName}`);
}

async function silentSaveHomeStay(opts: {
  label: string;
  kind: 'haus' | 'ferienwohnung' | 'wohnung';
}): Promise<void> {
  const mem = useUserMemoryStore.getState();
  const gps = useFinnusStore.getState();
  const name =
    opts.kind === 'haus'
      ? opts.label || 'Mein Haus'
      : opts.kind === 'ferienwohnung'
        ? opts.label || 'Meine Ferienwohnung'
        : opts.label || 'Meine Wohnung';
  mem.addOrUpdateEntity({
    type: 'hotel',
    name,
    isConfirmed: true,
    lat: gps.lastGpsLat ?? undefined,
    lng: gps.lastGpsLng ?? undefined,
    notes: `User: ${opts.kind} — als Unterkunft gespeichert`,
    visitedAt: new Date().toISOString(),
  });
  mem.setPendingHotelConfirm(null);
  mem.setAwaitingHotelName(false);
  try {
    const { applyConfirmedHotelAsDayBase } = await import('./hotelBasePresence');
    applyConfirmedHotelAsDayBase({
      name,
      lat: gps.lastGpsLat,
      lng: gps.lastGpsLng,
    });
  } catch {
    /* soft */
  }
  if (__DEV__) console.log(`[memory] home/stay save: ${name}`);
}

function detectHomeStayLabel(text: string): {
  label: string;
  kind: 'haus' | 'ferienwohnung' | 'wohnung';
} | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!HOME_STAY_RE.test(t)) return null;
  if (/\bferienwohnung|ferienhaus\b/i.test(t)) {
    return { label: 'Meine Ferienwohnung', kind: 'ferienwohnung' };
  }
  if (/\b(?:apartment|wohnung)\b/i.test(t) && !/\bhaus\b/i.test(t)) {
    return { label: 'Meine Wohnung', kind: 'wohnung' };
  }
  if (/\bhotel\b/i.test(t)) {
    return { label: 'Mein Hotel', kind: 'haus' };
  }
  return { label: 'Mein Haus', kind: 'haus' };
}

let parkingJustSaved = false;

export function consumeParkingJustSaved(): boolean {
  const v = parkingJustSaved;
  parkingJustSaved = false;
  return v;
}

export async function captureSideChannelHints(
  text: string,
): Promise<SideChannelAsk> {
  const result: SideChannelAsk = {
    hotelAsk: null,
    flightAsk: null,
    parkingAck: null,
  };
  const mem = useUserMemoryStore.getState();

  capturePlaceFeedback(text);

  if (isParkingSpotSaveIntent(text)) {
    const gps = useFinnusStore.getState();
    const maxDurationMin = parseParkingMaxDurationMin(text);
    saveParkingSpot({
      label: 'Parkplatz',
      lat: gps.lastGpsLat,
      lng: gps.lastGpsLng,
      maxDurationMin,
    });
    parkingJustSaved = true;
    const untilClock = text.match(
      /\b(?:bis|gilt\s+bis|läuft\s+bis|laeuft\s+bis|ticket\s+bis)\s*(\d{1,2})[:.](\d{2})\b/iu,
    );
    if (untilClock?.[1] != null && untilClock[2] != null) {
      const hh = untilClock[1].padStart(2, '0');
      const mm = untilClock[2];
      result.parkingAck = `Parkplatz ist gespeichert — Ticket bis ${hh}:${mm}. Ich erinner dich rechtzeitig, bevor die Zeit abläuft.`;
    } else {
      result.parkingAck =
        maxDurationMin != null
          ? `Parkplatz ist gespeichert — max. ${Math.round(maxDurationMin / 60) >= 1 && maxDurationMin % 60 === 0 ? `${maxDurationMin / 60} Stunden` : `${maxDurationMin} Minuten`}. Ich zeig dir die Restzeit oben an.`
          : 'Parkplatz ist gespeichert. Ich merke mir den Spot und die Zeit.';
    }
  }

  const home = detectHomeStayLabel(text);
  if (home) {
    await silentSaveHomeStay(home);
  }

  try {
    const { tryConfirmPendingHotelFromUtterance } = await import(
      './hotelBasePresence'
    );
    if (tryConfirmPendingHotelFromUtterance(text)) {
      return result;
    }
  } catch {
    /* soft */
  }

  if (!mem.pendingHotelConfirmId && !mem.awaitingHotelName) {
    // Never invent hotel names from shopping / multi-goal speech
    const shoppingNoise =
      /\b(?:zahnbürste|zahnbuerste|cola|bier|wegbier|wasser|einkaufen|kaufen|supermarkt|drogerie)\b/iu.test(
        text,
      );
    const clear = isClearHotelMention(text);
    // Explizite Hotel-/Basis-Aussage: Länge egal (sonst blockt „merk dir … Homebase“)
    const multiGoal =
      !clear &&
      (/\b(?:vorher|außerdem|ausserdem|pünktlich|puenktlich|verabredung)\b/iu.test(
        text,
      ) ||
        text.length > 120);

    if (!shoppingNoise && !multiGoal) {
      const hotelName = clear
        ? extractHotelNameFromText(text, true)
        : extractIncidentalHotelName(text);

      if (hotelName && (await hotelNameLooksReal(hotelName))) {
        const confirmed = mem.getConfirmedHotel();
        const sameConfirmed =
          confirmed &&
          confirmed.name.toLowerCase().replace(/^hotel\s+/i, '') ===
            hotelName.toLowerCase().replace(/^hotel\s+/i, '');

        if (!sameConfirmed) {
          if (clear) {
            await silentSaveHotel(hotelName);
          } else {
            const coords = await resolveHotelCoords(hotelName);
            const short = hotelName.replace(/^Hotel\s+/i, '');
            const entity = mem.addOrUpdateEntity({
              type: 'hotel',
              name: hotelName,
              isConfirmed: false,
              lat: coords.lat,
              lng: coords.lng,
              poiId: coords.poiId,
              notes: 'Nebenbei erwähnt — wartet auf Bestätigung',
              visitedAt: new Date().toISOString(),
            });
            mem.setPendingHotelConfirm(entity.id);
            result.hotelAsk =
              `Ah — war „${short}“ ein Hotelname? Ist das dein Hotel?`;
          }
        } else if (clear && confirmed) {
          // Schon bekannt — trotzdem als Tages-Basis setzen
          await silentSaveHotel(hotelName);
        }
      }
    }
  }

  if (!mem.awaitingFlightDetails && isIncidentalFlightMention(text)) {
    mem.setAwaitingFlightDetails(true);
    result.flightAsk =
      'Hab ich richtig gehört, dass du fliegst? Wann ist das denn — und welche Flugnummer?';
  }

  return result;
}

export function formatSideChannelAsk(ask: SideChannelAsk): string | null {
  const parts = [ask.parkingAck, ask.hotelAsk, ask.flightAsk].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  if (!parts.length) return null;
  return parts.join(' ');
}

export function appendSideChannelAsk(
  reply: string,
  ask: SideChannelAsk | null | undefined,
): string {
  const extra = ask ? formatSideChannelAsk(ask) : null;
  if (!extra) return reply;
  const base = reply.trim();
  if (!base) return extra;
  if (ask?.hotelAsk && base.includes(ask.hotelAsk.slice(0, 18))) return base;
  if (ask?.flightAsk && base.includes('Flugnummer')) {
    return ask.hotelAsk && !base.includes('Hotelname')
      ? `${base} ${ask.hotelAsk}`
      : base;
  }
  return `${base} ${extra}`;
}
