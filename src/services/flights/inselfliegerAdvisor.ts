/**
 * Inselflieger (FLN Harle ⇄ Wangerooge) — Website-Recherche + Buchungs-Flow.
 *
 * Kein /api/flights: Yorro liest öffentliche Seiten (inselflieger.de) und
 * recherchiert Zeiten/Preise per Search Grounding. Konkrete Slots nur wenn
 * öffentlich; sonst ehrlich + Frisonaut-Link.
 */

import type { GeminiConciergeResponse, QuickAction } from '../../types/concierge';
import { getCachedUserProfile } from '../userProfileService';
import { getReservationContact } from '../../types/userProfile';
import { useFinnusStore } from '../../store/useFinnusStore';

const INSELFLIEGER_RE =
  /\b(inselflieger|insel\s*flieger|frisia\s*luft|\bfln\b|harle\s*(?:nach|⇄|↔)?\s*wangerooge|wangerooge\s*(?:flug|flieger)|flug\s*(?:nach|auf|von)\s*wangerooge|flugplatz\s*(?:harle|wangerooge)|zurück\s*flieg|zurückflieg|mit\s+dem\s+flieger|flug\s+(?:zum\s+)?festland|zum\s+festland\s+flieg|festland\s+flieg)\b/iu;

const BOOK_INTENT_RE =
  /\b(buch(?:en|ung)|flug\s+buch|ticket|verfügbar|wie\s+teuer|preis|kosten|wann\s+(?:kann|geht|flieg)|flugzeiten|abflugzeiten|flüge\s+(?:morgen|heute)|fliegen\s+(?:morgen|heute|zurück)|flug\s+(?:zum\s+)?festland)\b/iu;

const INFO_URL = 'https://www.inselflieger.de/wangerooge';
const BOOK_ASSISTANT_BASE =
  'https://www.frisonaut.de/de/mobilitaet/assistent';

export type IslandDirection = 'out' | 'in'; // out = Harle→Insel, in = Insel→Harle

/** Frisonaut-Link mit korrekter Richtung (Insel→Harle vs Harle→Insel). */
function frisonautBookUrl(dateIso: string, direction: IslandDirection): string {
  const u = new URL(BOOK_ASSISTANT_BASE);
  u.searchParams.set('tripType', 'ONEWAY');
  u.searchParams.set('start', dateIso);
  if (direction === 'in') {
    u.searchParams.set('destination', 'harle');
    u.searchParams.set('origin', 'wangerooge');
    u.searchParams.set('findus_dir', 'wangerooge-harle');
  } else {
    u.searchParams.set('destination', 'wangerooge');
    u.searchParams.set('origin', 'harle');
    u.searchParams.set('findus_dir', 'harle-wangerooge');
  }
  return u.toString();
}
export type IslandFlightSlot = {
  id: string;
  flightNumber: string;
  direction: IslandDirection;
  departureLocal: string;
  arrivalLocal: string;
  durationMin: number;
  availability: 'sold' | 'few' | 'good' | string;
  freeSeats: number;
  priceEur: number | null;
  deepLink: string;
  routeName: string;
};

export type IslandFlightTariff = {
  name: string;
  adultFromEur: number;
  childFromEur: number;
  baggageKg: number;
  note: string;
};

const TARIFFS: IslandFlightTariff[] = [
  {
    name: 'Basic',
    adultFromEur: 55,
    childFromEur: 45,
    baggageKg: 5,
    note: 'Nur online · keine Umbuchung/Storno',
  },
  {
    name: 'Flex',
    adultFromEur: 65,
    childFromEur: 55,
    baggageKg: 10,
    note: 'Umbuchung gebührenfrei · Storno nach AGB',
  },
  {
    name: 'Plus',
    adultFromEur: 79,
    childFromEur: 69,
    baggageKg: 15,
    note: 'Max. Flex · auch telefonisch',
  },
];

type PendingIslandBooking = {
  dateIso: string;
  direction: IslandDirection;
  slots: IslandFlightSlot[];
  preferredHour: number | null;
  baggageKg: number | null;
  atMs: number;
};

let pending: PendingIslandBooking | null = null;

export function getPendingIslandBooking(): PendingIslandBooking | null {
  if (!pending) return null;
  if (Date.now() - pending.atMs > 45 * 60_000) {
    pending = null;
    return null;
  }
  return pending;
}

export function clearPendingIslandBooking(): void {
  pending = null;
}

export function isInselfliegerQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (INSELFLIEGER_RE.test(t)) return true;
  // Soft: fliegen + wangerooge/insel/harle OR pending follow-up
  if (getPendingIslandBooking() && /\b(uhr|flug|flieger|€|euro|kg|koffer|gepäck|gepaeck|basic|flex|plus|buchen)\b/iu.test(t)) {
    return true;
  }
  if (
    /\b(flieg|flug)\b/iu.test(t) &&
    /\b(wangerooge|harle|insel|zurück)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, n: number): Date {
  const x = new Date(base);
  x.setDate(x.getDate() + n);
  return x;
}

import {
  resolveRelativeDay,
  resolveRelativeDayIsoFromText,
  ymdLocal,
} from '../time/temporalGerman';

/** Parse travel date from user speech. Default: tomorrow for booking questions. */
export function resolveIslandTravelDate(text: string, now = new Date()): string {
  const fromSsot = resolveRelativeDayIsoFromText(text, now);
  if (fromSsot) return fromSsot;

  const t = text.toLowerCase();
  const dm = t.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]) - 1;
    let year = dm[3] ? Number(dm[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (Number.isFinite(d.getTime())) return ymdLocal(d);
  }
  // Booking / „wann kann ich“ without day → morgen (Post-Midnight aware)
  if (BOOK_INTENT_RE.test(text) || /\bzurück\b/iu.test(text)) {
    return ymdLocal(resolveRelativeDay('morgen', now));
  }
  return ymdLocal(now);
}

/**
 * Direction: zurück / von der Insel → in (Wangerooge→Harle).
 * nach Wangerooge / zur Insel → out.
 * Heuristic from GPS city if ambiguous.
 */
export function resolveIslandDirection(text: string): IslandDirection {
  const t = text.toLowerCase();
  // Abreise / Festland / Rückflug — IMMER Wangerooge → Harle
  if (
    /\b(zurück|rueck|rückflug|rueckflug|von\s+(?:der\s+)?insel|wangerooge\s+nach|ab\s+wangerooge|zum\s+festland|aufs?\s+festland|festland|heimflieg|heim\s*flieg|nach\s+hause\s*flieg|abreise|abreisen|weg\s*flieg)\b/.test(
      t,
    )
  ) {
    return 'in';
  }
  if (
    /\b(nach\s+wangerooge|zur\s+insel|aufs?\s+insel|hinflug|ab\s+harle|von\s+harle|anreise)\b/.test(
      t,
    )
  ) {
    return 'out';
  }
  const city = (
    getCachedUserProfile()?.cityName ||
    useFinnusStore.getState().currentLocationName ||
    ''
  ).toLowerCase();
  // Auf der Insel + „fliegen“ ohne „nach Wangerooge“ → Abreise
  if (/wangerooge/.test(city)) return 'in';
  return 'out';
}

function parsePreferredHour(text: string): number | null {
  const t = text.replace(/\s+/g, ' ').toLowerCase();
  const hm = t.match(/\b([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)\b/);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const uhr = t.match(/\b(?:um\s+)?([01]?\d|2[0-3])\s*uhr\b/);
  if (uhr) return Number(uhr[1]);
  if (/\bvormittag\b/.test(t)) return 10;
  if (/\bmittag\b/.test(t)) return 12.5;
  if (/\bnachmittag\b/.test(t)) return 15.5;
  if (/\babend\b/.test(t)) return 17.5;
  return null;
}

function parseBaggageKg(text: string): number | null {
  const m = text.match(/\b(\d{1,2})\s*kg\b/iu);
  if (m) return Number(m[1]);
  const k = text.match(/\b(koffer|gepäck|gepaeck|tasche)\b.{0,20}\b(\d{1,2})\b/iu);
  if (k?.[2]) return Number(k[2]);
  return null;
}

function minutesOf(local: string): number {
  const m = local.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatEur(centsOrEur: number | null, fromCents = false): string {
  if (centsOrEur == null || !Number.isFinite(centsOrEur)) return 'Preis auf Anfrage';
  const eur = fromCents ? centsOrEur / 100 : centsOrEur;
  return `${eur % 1 === 0 ? eur.toFixed(0) : eur.toFixed(2)} €`;
}

function contactHint(): string {
  const c = getReservationContact(getCachedUserProfile());
  if (c.fullName && c.email) {
    return `Dein Profil: ${c.fullName}, ${c.email} — Frisonaut füllt Passagierdaten leider nicht per Link vor; nach dem Tippen meist nur noch einmal eintragen und zahlen.`;
  }
  if (c.fullName) {
    return `Namen habe ich als ${c.fullName}. Frisonaut-Links können Passagierfelder nicht vorausfüllen — einmal manuell, dann zahlen.`;
  }
  return 'Tipp: Name und E-Mail in den Yorro-Einstellungen hinterlegen, dann geht Checkout schneller.';
}

/** Enrich Frisonaut deep link with date/time hints + profile query (best-effort; portal may ignore extras). */
function enrichDeepLink(
  slot: IslandFlightSlot,
  dateIso: string,
): string {
  try {
    const u = new URL(slot.deepLink);
    u.searchParams.set('tripType', 'ONEWAY');
    u.searchParams.set('start', dateIso);
    if (slot.direction === 'in') {
      u.searchParams.set('destination', 'harle');
      u.searchParams.set('origin', 'wangerooge');
      u.searchParams.set('findus_dir', 'wangerooge-harle');
    } else {
      u.searchParams.set('destination', 'wangerooge');
      u.searchParams.set('origin', 'harle');
      u.searchParams.set('findus_dir', 'harle-wangerooge');
    }
    if (slot.departureLocal) {
      u.searchParams.set('departureLocal', slot.departureLocal);
      u.searchParams.set('time', slot.departureLocal);
    }
    if (slot.flightNumber) {
      u.searchParams.set('flightNumber', slot.flightNumber);
    }
    if (slot.id) u.searchParams.set('flightId', slot.id);

    const c = getReservationContact(getCachedUserProfile());
    const profile = getCachedUserProfile();
    if (c.fullName) {
      const parts = c.fullName.split(/\s+/);
      if (parts[0]) u.searchParams.set('firstname', parts[0]);
      if (parts.length > 1) u.searchParams.set('lastname', parts.slice(1).join(' '));
    }
    if (c.email) u.searchParams.set('email', c.email);
    if (profile?.firstName) u.searchParams.set('findus_guest', profile.firstName);
    return u.toString();
  } catch {
    return slot.deepLink;
  }
}

function suggestTariffForBaggage(kg: number): IslandFlightTariff {
  if (kg <= 5) return TARIFFS[0];
  if (kg <= 10) return TARIFFS[1];
  return TARIFFS[2];
}

function excessBaggageCost(kg: number, tariff: IslandFlightTariff): number {
  const over = Math.max(0, kg - tariff.baggageKg);
  return over * 1.2;
}

async function fetchDaySlots(dateIso: string): Promise<IslandFlightSlot[]> {
  // Legacy name kept — intentionally unused. Website path only.
  void dateIso;
  return [];
}

/**
 * Website-only inventory (kein /api/flights).
 */
async function fetchDaySlotsFromWebsite(
  dateIso: string,
  direction: IslandDirection,
  userText: string,
): Promise<{
  slots: IslandFlightSlot[];
  tariffSpeech: string;
  failures: string[];
  sourceNotes: string[];
}> {
  const { researchIslandFlightsFromWebsite } = await import(
    './inselfliegerWebResearch'
  );
  const res = await researchIslandFlightsFromWebsite({
    dateIso,
    direction,
    userText,
  });

  const tariffBits: string[] = [];
  if (res.tariffs.basicAdultFrom != null) {
    tariffBits.push(`Basic ab ${res.tariffs.basicAdultFrom} €`);
  }
  if (res.tariffs.flexAdultFrom != null) {
    tariffBits.push(`Flex ab ${res.tariffs.flexAdultFrom} €`);
  }
  if (res.tariffs.plusAdultFrom != null) {
    tariffBits.push(`Plus ab ${res.tariffs.plusAdultFrom} €`);
  }
  if (res.tariffs.excessPerKg != null) {
    tariffBits.push(`Übergepäck ${res.tariffs.excessPerKg} €/kg`);
  }

  return {
    slots: res.slots,
    tariffSpeech: tariffBits.length
      ? `Tarife laut inselflieger.de: ${tariffBits.join(', ')}.`
      : 'Tarife: Basic/Flex/Plus — Details auf inselflieger.de.',
    failures: res.failures,
    sourceNotes: res.sourceNotes,
  };
}

function availableSlots(
  slots: IslandFlightSlot[],
  direction: IslandDirection,
): IslandFlightSlot[] {
  return slots
    .filter(
      (s) =>
        s.direction === direction &&
        s.availability !== 'sold' &&
        s.freeSeats > 0 &&
        s.priceEur != null &&
        s.priceEur > 0,
    )
    .sort((a, b) => minutesOf(a.departureLocal) - minutesOf(b.departureLocal));
}

function nearestAfterHour(
  slots: IslandFlightSlot[],
  hour: number,
  count = 2,
): IslandFlightSlot[] {
  const targetMin = Math.round(hour * 60);
  const after = slots.filter((s) => minutesOf(s.departureLocal) >= targetMin - 5);
  const pool = after.length ? after : slots;
  return pool.slice(0, count);
}

function directionLabel(d: IslandDirection): string {
  return d === 'in' ? 'Wangerooge → Harle' : 'Harle → Wangerooge';
}

function dateSpeech(dateIso: string): string {
  const today = ymd(new Date());
  const tomorrow = ymd(addDays(new Date(), 1));
  if (dateIso === today) return 'heute';
  if (dateIso === tomorrow) return 'morgen';
  const [y, m, d] = dateIso.split('-').map(Number);
  return `${d}.${m}.${y}`;
}

function slotActions(
  slots: IslandFlightSlot[],
  dateIso: string,
): QuickAction[] {
  return slots.slice(0, 3).map((s) => ({
    type: 'OPEN_URL' as const,
    label: `✈️ ${s.departureLocal} · ${formatEur(s.priceEur)}`,
    payload: { url: enrichDeepLink(s, dateIso) },
  }));
}

/**
 * Build speech from LIVE day inventory — morning / midday / afternoon samples
 * plus sold-out stretch explanation from real sold slots.
 */
function overviewSpeech(
  dateIso: string,
  direction: IslandDirection,
  allDay: IslandFlightSlot[],
  open: IslandFlightSlot[],
): string {
  const morning = open.filter((s) => minutesOf(s.departureLocal) < 12 * 60);
  const midday = open.filter(
    (s) =>
      minutesOf(s.departureLocal) >= 12 * 60 &&
      minutesOf(s.departureLocal) < 15 * 60,
  );
  const afternoon = open.filter((s) => minutesOf(s.departureLocal) >= 15 * 60);

  const samples: IslandFlightSlot[] = [];
  const push = (s?: IslandFlightSlot) => {
    if (s && !samples.find((x) => x.id === s.id)) samples.push(s);
  };
  push(morning[0]);
  push(midday[0] ?? afternoon[0]);
  // Max 2 Zeiten in der Speech — Rest auf Buttons
  if (samples.length < 2) {
    for (const s of open) {
      push(s);
      if (samples.length >= 2) break;
    }
  }

  const lines = samples.map((s) => {
    const seats =
      s.availability === 'few'
        ? `nur ${s.freeSeats} Platz`
        : `${s.freeSeats} frei`;
    return `${s.departureLocal} Uhr · ${formatEur(s.priceEur)} (${seats})`;
  });

  if (!open.length) {
    return `Für ${dateSpeech(dateIso)} ${directionLabel(direction)} finde ich gerade keinen freien Sitz. Anderen Tag prüfen?`;
  }

  return [
    `${dateSpeech(dateIso)}, ${directionLabel(direction)}:`,
    lines.join('; ') + '.',
    'Welche Uhrzeit — Buttons unten öffnen Frisonaut. Tarife und Details stehen auf der Karte.',
  ].join(' ');
}

function refineSpeech(
  dateIso: string,
  direction: IslandDirection,
  preferredHour: number,
  picks: IslandFlightSlot[],
  baggageKg: number | null,
): string {
  if (!picks.length) {
    return `Um ${Math.floor(preferredHour)} Uhr ${dateSpeech(dateIso)} finde ich live keinen freien Flug ${directionLabel(direction)}. Andere Zeit oder anderer Tag?`;
  }
  const first = picks[0];
  const second = picks[1];
  const parts = [
    `Gegen ${Math.floor(preferredHour)} Uhr: nächster freier Live-Slot ist ${first.departureLocal} Uhr für ${formatEur(first.priceEur)} (${first.freeSeats} Plätze, ${first.flightNumber}).`,
  ];
  if (second) {
    const cheaper =
      second.priceEur != null &&
      first.priceEur != null &&
      second.priceEur < first.priceEur;
    parts.push(
      `Daneben ${second.departureLocal} Uhr für ${formatEur(second.priceEur)}` +
        (cheaper
          ? ` — ${formatEur((first.priceEur ?? 0) - (second.priceEur ?? 0))} günstiger`
          : '') +
        '.',
    );
  }
  if (baggageKg != null) {
    const tar = suggestTariffForBaggage(baggageKg);
    const base = first.priceEur ?? tar.adultFromEur;
    const extra = excessBaggageCost(baggageKg, tar);
    parts.push(
      `Bei ${baggageKg} kg: Tarif ${tar.name} (Freigepäck ${tar.baggageKg} kg). ` +
        (extra > 0
          ? `Übergepäck ca. ${extra.toFixed(2)} € (1,20 €/kg) → grob ${formatEur(base + extra)} inkl. Übergepäck auf dem Live-Basispreis.`
          : `Passt in ${tar.name} — kein Übergepäck nötig auf dem Live-Preis ${formatEur(base)}.`),
    );
  } else {
    parts.push(
      'Wie schwer ist dein Koffer in kg? Dann rechne ich Basic/Flex/Plus inkl. Übergepäck dagegen.',
    );
  }
  parts.push('Buttons öffnen Frisonaut — bitte Richtung Wangerooge→Harle prüfen, nichts kaufen ohne dein OK.');
  return parts.join(' ');
}

/**
 * Full Concierge payload — never asks for commercial flight numbers.
 */
export async function prepareInselfliegerFollowUp(
  text: string,
): Promise<{
  reply: string;
  concierge: GeminiConciergeResponse;
} | null> {
  if (!isInselfliegerQuery(text) && !getPendingIslandBooking()) return null;

  const prev = getPendingIslandBooking();
  const baggageKg = parseBaggageKg(text) ?? prev?.baggageKg ?? null;
  const preferredHour = parsePreferredHour(text);
  const dateIso = prev?.dateIso ?? resolveIslandTravelDate(text);
  const direction = prev?.direction ?? resolveIslandDirection(text);

  let slots: IslandFlightSlot[] = [];
  let tariffSpeech = '';
  let webFailures: string[] = [];
  try {
    const web = await fetchDaySlotsFromWebsite(dateIso, direction, text);
    slots = web.slots;
    tariffSpeech = web.tariffSpeech;
    webFailures = web.failures;
  } catch (err) {
    if (__DEV__) console.warn('[inselflieger] website research failed', err);
    const reply =
      'Ich konnte die Flugzeiten gerade nicht von der Website lesen. Ich öffne dir Frisonaut — dort siehst du Verfügbarkeit und Preise live.';
    return {
      reply,
      concierge: {
        speechText: reply,
        visualBullets: ['Website-Recherche fehlgeschlagen', `Datum ${dateIso}`],
        quickActions: [
          {
            type: 'OPEN_URL',
            label: '✈️ Frisonaut öffnen',
            payload: {
              url: frisonautBookUrl(dateIso, direction),
            },
          },
          {
            type: 'OPEN_URL',
            label: 'Preise & Infos',
            payload: { url: INFO_URL },
          },
        ],
        cardTitle: 'Inselflieger',
      },
    };
  }

  // Keine Slot-Liste öffentlich → ehrlich + Tarif + Buchungslink (kein Fake)
  if (!slots.length) {
    const bookLink = frisonautBookUrl(dateIso, direction);
    const reply = [
      `Für ${dateSpeech(dateIso)} ${directionLabel(direction)} liegen die genauen Slots hinter dem Buchungsassistenten.`,
      'Tarife und Zeiten stehen auf der Karte — Button öffnet Frisonaut mit Datum.',
      direction === 'in'
        ? 'Wichtig: Richtung Wangerooge → Harle (Von der Insel). Nichts buchen ohne dein OK.'
        : 'Richtung Harle → Wangerooge. Nichts buchen ohne dein OK.',
    ].join(' ');
    return {
      reply,
      concierge: {
        speechText: reply,
        visualBullets: [
          tariffSpeech.replace(/^Tarife laut inselflieger\.de:\s*/i, '') ||
            'Tarife auf inselflieger.de',
          `Datum ${dateIso}`,
          directionLabel(direction),
          contactHint(),
        ].filter(Boolean),
        quickActions: [
          {
            type: 'OPEN_URL',
            label: '✈️ Zeiten & buchen',
            payload: { url: bookLink },
          },
          {
            type: 'OPEN_URL',
            label: '📄 Tarif-Infos',
            payload: { url: INFO_URL },
          },
        ],
        cardTitle: 'Inselflieger · Website',
      },
    };
  }

  const open = availableSlots(slots, direction);
  pending = {
    dateIso,
    direction,
    slots: open,
    preferredHour: preferredHour ?? prev?.preferredHour ?? null,
    baggageKg,
    atMs: Date.now(),
  };

  // Follow-up: user named a time (or baggage after time)
  if (preferredHour != null || (prev?.preferredHour != null && baggageKg != null)) {
    const hour = preferredHour ?? prev!.preferredHour!;
    const picks = nearestAfterHour(open, hour, 2);
    const reply = refineSpeech(dateIso, direction, hour, picks, baggageKg);
    return {
      reply,
      concierge: {
        speechText: reply,
        visualBullets: picks.map(
          (s) =>
            `${s.departureLocal} · ${formatEur(s.priceEur)} · ${s.freeSeats} Plätze · ${s.flightNumber}`,
        ),
        quickActions: [
          ...slotActions(picks, dateIso),
          {
            type: 'OPEN_URL' as const,
            label: 'Alle Flüge Tag',
            payload: {
              url: frisonautBookUrl(dateIso, direction),
            },
          },
        ].slice(0, 4) as QuickAction[],
        cardTitle: `Inselflieger · ${dateSpeech(dateIso)}`,
      },
    };
  }

  const tariffHint = tariffSpeech
    ? `${tariffSpeech} Preisunterschiede = Freigepäck Basic 5 kg / Flex 10 kg / Plus 15 kg. Tidefrei, ca. 5–15 Minuten.`
    : 'Preisunterschiede = Tarife Basic (5 kg), Flex (10 kg), Plus (15 kg Freigepäck). Tidefrei, ca. 5 Minuten.';

  // Overview from website research
  let reply = overviewSpeech(dateIso, direction, slots, open);
  reply = reply.replace(
    /Preisunterschiede = Tarife Basic[\s\S]*?Tidefrei, ca\. 5 Minuten\./,
    tariffHint,
  );
  if (!reply.includes('inselflieger.de') && !reply.includes('Website')) {
    reply = `Laut Website-Recherche: ${reply}`;
  }
  const showcase = [
    ...open.filter((s) => minutesOf(s.departureLocal) < 12 * 60).slice(0, 1),
    ...open.filter(
      (s) =>
        minutesOf(s.departureLocal) >= 12 * 60 &&
        minutesOf(s.departureLocal) < 15 * 60,
    ).slice(0, 1),
    ...open.filter((s) => minutesOf(s.departureLocal) >= 15 * 60).slice(0, 1),
  ].filter(
    (s, i, arr) => s && arr.findIndex((x) => x?.id === s.id) === i,
  ) as IslandFlightSlot[];

  return {
    reply,
    concierge: {
      speechText: reply,
      visualBullets: [
        `Live-API ${dateIso}`,
        directionLabel(direction),
        ...showcase.map(
          (s) => `${s.departureLocal} · ${formatEur(s.priceEur)} · ${s.freeSeats} Plätze`,
        ),
        'Basic 5kg / Flex 10kg / Plus 15kg',
      ].slice(0, 6),
      quickActions: [
        ...slotActions(showcase.slice(0, 2), dateIso),
        {
          type: 'OPEN_URL' as const,
          label: '✈️ Alle Zeiten buchen',
          payload: {
            url: frisonautBookUrl(dateIso, direction),
          },
        },
      ].slice(0, 4) as QuickAction[],
      cardTitle: `Inselflieger · ${dateSpeech(dateIso)}`,
    },
  };
}
