/**
 * Modul 5 — Master-Ingest: User-Nachricht + bestehende Timeline → kompletter Tagesplan.
 * Einmal alles durchrechnen (kein Step-by-Step beim Befüllen).
 */

import { generateGeminiText } from '../../services/geminiService';
import { geocodePlaceName } from '../../services/navigation/googleMapsNav';
import { todayDateKey, offsetDateKey, tryResolveDateKeyFromUserText, planningClockContextBlock } from '../../utils/dateKeys';
import { readRucksackSync, anchorCoords } from '../rucksack/rucksackStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import {
  FINDUS_DYNAMIC_STRUCTURE_DOCTRINE,
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_HELP_FIRST_MONETIZATION_BLOCK,
} from '../../services/concierge/findusResponsePolicy';
import { sanitizePlanSpeech } from './planSpeechSanitize';
import { patchPlanForDestinationCity } from './planDestinationCity';
import { mergeUtteranceSlotsIntoPlan } from './planUtteranceSlots';
import { applyTurnFrameToPlan } from './applyTurnFrame';
import { formatTurnFrameForPlanPrompt } from '../router/turnFrame';
import type { TurnFrame } from '../router/turnFrame';
import { usePlanSessionStore } from './planSessionState';
import { geminiOptsForPlanIngest, tryConsumePlanProSlot } from './planProScore';
import { prefsBlockForPrompt, loadPlanTripPrefs } from './planTripPrefs';
import { derivePlanTasks } from './derivePlanTasks';
export { derivePlanTasks } from './derivePlanTasks';
import {
  appointmentNeedsExactAddress,
} from './planLocationGranularity';
import {
  normalizeHmLoose,
  parseHmRangeFromText,
} from './planTimeRange';
import { FINDUS_PLAN_SMART_OVERVIEW_BLOCK } from './planSmartOverview';
import { planBaseSynonymPromptBlock } from './planBaseSynonyms';
import type {
  IngestedPlan,
  IngestFixedNode,
  IngestOpenWish,
  IngestGeoAnchor,
  PlanPriority,
  PlanTask,
  PlanLageMode,
  TaskCompleteness,
} from './planningTypes';

export const MASTER_INGEST_SYSTEM = `Du bist der MASTERPLANER für Yorro Modul 5.
Du bekommst: User-Nachricht + Snapshot der Timeline für den Zieldatum-Tag.
Du baust EINMAL den kompletten Tagesplan — nicht Stück für Stück.

${FINDUS_DYNAMIC_STRUCTURE_DOCTRINE}

${FINDUS_PLAN_SMART_OVERVIEW_BLOCK}

ABLAUF (verbindlich):
1) Lage: Welcher Tag? Neu / hinzu / ändern? Was steht SCHON in der Timeline?
   Wenn etwas SCHON eingetragen ist und der User es ändern will (Ort, Zeit, Adresse): lageMode=change, fixedNodes aktualisieren — NIEMALS nachfragen „ist das schon eingetragen?“ oder neu anlegen.
2) User-Wünsche vollständig extrahieren — nichts weglassen (Meeting, Hotel, Frühstück, Fahrt, Essen, genannte Orte).
   Jeder genannte Ort/Aktivität = eigener openWish mit Uhrzeit. Nicht auf einen Slot kollabieren.
3) Rückwärts um harte Anker planen. Konflikte selbst lösen nach Opfer-Reihenfolge:
   Prio 6 frei → Prio 5 löschen nur markieren als Frage → Prio 4 nur verschieben → Prio 3 Frage → Prio 1–2 heilig.
4) JEDEN Slot mit realistischer Uhrzeit (HH:mm) befüllen — auch offene Wünsche.
   HEUTE — nur openWishesQueue (Prio 4–6): nie Zeiten in der Vergangenheit; sonst auf nächste volle :00/:30 runden (mind. ~20–30 Min voraus).
   fixedNodes / Prio 1–2 mit User-Uhrzeit: Zeit NIEMALS wegen „jetzt“ verschieben — exakt so lassen, auch wenn die Zeit schon (knapp) vorbei ist.
   Abend/Spaziergang/Dinner/„heute Abend“ → estimatedTime ab ~18:30–20:30, NIE Mittag (11–15 Uhr).
   Soft-Wünsche (Essen/Mittag) NIEMALS über feste Termine (Bewerbung/Meeting) legen — freie Lücke davor/danach.
5) Prio 6 (Erkunden/Inspiration/Spaziergang) NUR wenn der User ERKENNEN/SPAZIEREN/BUMMELN/HIGHLIGHTS explizit will.
   NIEMALS von allein „Stadt erkunden“, „Freizeit“, „Inspiration“ oder 17:00-Default-Erkunden erfinden.
   Wenn User nur Frühstück/Termin/Hotel/Essen plant → openWishesQueue OHNE Prio-6.
   Spaziergang/Abendspaziergang/Bummel = Outdoor/Erkunden (Prio 6), KEINE Restaurant-Wünsche daraus.
6) Travel-Lücken als Hinweis in openQuestions nennen (z. B. „Fahrt nach Hamburg“), nicht als Fake-Ort.
7) Titel kurz zusammenfassen (max ~40 Zeichen) — NIEMALS die ganze User-Frage als Titel.
8) Outfit/Kleidung/Wetter-Fragen gehören NICHT hierher — wenn die Nachricht primär „was anziehen“ ist: fixedNodes=[], openWishesQueue=[], bridgeSpeech kurz ablehnen („das ist Outfit, kein Plan“) und initialVoiceConfirm leer.
9) targetDate: NIEMALS ein Datum in der Vergangenheit. „Dienstag“ an einem Mittwoch = nächster Dienstag (Zukunft), nie gestern.
10) ZIELSTADT vs GPS-PACK: STADT-HINT ist oft nur wo der User JETZT steht, NICHT der Plan-Ort.
    Nennt der User eine andere Stadt (in/nach/für X, Tagesplan X): das ist die ZIELSTADT für Wünsche, Recherche und Touren.
    geoAnchor bleibt der Start (GPS/Hotel). Fahrt dorthin = Travel-Lücke, kein Fake-Ort in der Startstadt.
    „um 9:00 los“ / „Bahn ab 9“ = ABFAHRT vom Start (Zug/Bahn), kein Frühstück und keine Aktivität um 9 am GPS-Ort.
    Frühstück „dann bei Ankunft“ / „voraussichtlich ab 10“ = in der ZIELSTADT NACH der Anreise.
    Nennt der User eine Ankunfts-/Frühstückszeit → diese Zeit; sonst grob ~60 Min nach Abfahrt.
    Alle genannten Zielstadt-Wünsche behalten — jeder genannte Ort ein Slot. Nicht auf einen leeren „Start 09:00“-Slot in der GPS-Stadt kollabieren.
    Reihenfolge: erst Fixpunkte, dann weiche Wünsche (Bahn, Frühstück, genannte Orte, Essen), Touren/Erkunden der Zielstadt zuletzt (ein openWish Prio 6).
    Wecker/Aufstehen NIEMALS jetzt stellen — „um X los“ ist Abfahrt, nicht Weckzeit. Wecker kommt erst, wenn der Plan steht (Code, rückwärts von der ersten Abfahrt).
    Recherche-Reihenfolge (Code): erst das Gerüst in die Timeline, dann Step-Pitches Frühstück → Abend/Sunset → genannte Landmarke/Ticket, danach eine Tour in der Lücke. Timeline bleibt chronologisch. Genannte Orte ohne Uhrzeit = eigener Slot ohne estimatedTime. Sunset-Essen grob ~19:30 (vor dem Sonnenuntergang), nicht 19:00.
    Sunset+Essen: Wetter ehrlich — wenn Sunset schlecht, nicht extra drauf optimieren; Blick trotzdem halten wenn der Ort ihn hergibt.

TASK-VOLLSTÄNDIGKEIT:
- completeness 0: Zeit + Titel + Ort fest (fixedNodes)
- completeness 1: Zeit + Titel, Ort unklar → needsClarification / openQuestion
- completeness 2: Thema/Ort-Wunsch ohne finalen Place → openWishesQueue mit estimatedTime

PRIORITÄTEN:
1 Sonnenuntergang/Flug/hartes Meeting · 2 Tickets/Reservation · 3 loses Treffen
4 Zeitfenster · 5 flexibler Wunsch · 6 Erkunden (zuletzt!)

SPEECH:
- bridgeSpeech: IMMER leer lassen (""). Planungsmodus spricht keine Bridge — Confirm/Rückfragen/Pitches kommen separat im Code.
- initialVoiceConfirm: EINE kurze Confirm-Frage — nur wenn fixedNodes mit Zeit/Prio≤2 vorliegen. Sonst leer lassen.
- openQuestions: intern für Code ok, nie vorlesen.

STADT ERKUNDEN / MUST-SEES / HIGHLIGHTS-ROUTE:
- GENANNTE Orte (Name, Viertel, Aktivität) = JEWEILS ein eigener openWish mit Zeit. Nicht in Prio-6 zusammenquetschen.
- Nur unbenanntes „Stadt erkunden / Highlights / Must-Sees“ = EIN openWish mit priority 6 am Ende.
- Nach Confirm legt der Code eine Mehr-Stopp-Highlight-Route für den Prio-6-Rest — genannte Orte bleiben eigene Slots.

${FINDUS_HELP_FIRST_MONETIZATION_BLOCK}

fixedNodes = nur Prio 1–3 mit time (+ optional endTime bei von–bis). openWishesQueue = Prio 4–6, JEDE mit estimatedTime, Prio 6 am Ende.

TERMINE / BEWERBUNG / MEETING:
- Bei konkretem Termin (Bewerbung, Meeting, Arzt, Tennis/Turnier…): wenn Ort nur Stadt / „Tennisplätze“ ohne Club/Adresse → needsClarification true; location trotzdem grob setzen. Nie Stadtmitte als Fake-GPS für Turniere.
- endTime setzen wenn User „von … bis …“ / „14–20“ sagt (time=Start, endTime=Ende) — außer Hotel.
- Hotel/Übernachtung: NUR Check-in als estimatedTime (eine Uhrzeit), endTime IMMER null — kein 18–19-Band. Check-in smart nach vorherigem Fixtermin (+~30 Min) oder User-Zeit.

${FINDUS_FEW_SHOT_DISCLAIMER}

GIB NUR JSON:
{
  "targetDate": "YYYY-MM-DD",
  "lageMode": "new" | "add" | "change",
  "geoAnchor": { "name": "...", "type": "CURRENT_GPS" | "HOTEL_START", "needsClarification": false },
  "fixedNodes": [
    { "title": "Meeting Café", "time": "15:00", "endTime": null, "priority": 1, "location": "Café unklar", "needsClarification": true },
    { "title": "Bewerbungsgespräch", "time": "10:00", "endTime": "12:00", "priority": 1, "location": "Stadtteil", "needsClarification": true }
  ],
  "openWishesQueue": [
    { "title": "Bahn", "priority": 4, "context": "Abfahrt Richtung Zielstadt", "estimatedTime": "09:00", "completeness": 2 },
    { "title": "Frühstück", "priority": 4, "context": "Frühstück nach Ankunft in der Zielstadt", "estimatedTime": "10:00", "completeness": 2 },
    { "title": "Hotel Check-in", "priority": 4, "context": "neues Hotel Hamburg, nach Meeting", "estimatedTime": "16:00", "completeness": 2 },
    { "title": "Italiener Elbblick", "priority": 4, "context": "Abendessen Italiener mit echtem Elbblick", "estimatedTime": "19:30", "completeness": 2 }
  ],
  "openQuestions": [
    "Welches Café fürs Meeting um 15?",
    "Frühstück nach Ankunft — welcher Laden?",
    "Welches Hotel zum Einchecken?",
    "Italiener mit echtem Elbblick — welche zwei Optionen?"
  ],
  "bridgeSpeech": "",
  "initialVoiceConfirm": "Passt der grobe Plan so für dich?"
}`;

function clampPrio(n: unknown, fallback: PlanPriority): PlanPriority {
  const v = Number(n);
  if (v >= 1 && v <= 6) return v as PlanPriority;
  return fallback;
}

function clampCompleteness(n: unknown, fallback: TaskCompleteness): TaskCompleteness {
  const v = Number(n);
  if (v === 0 || v === 1 || v === 2) return v;
  return fallback;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() || t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeHm(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function resolveDefaultAnchor(): IngestGeoAnchor {
  const bag = readRucksackSync();
  const gps = anchorCoords(bag);
  const hotel =
    useUserMemoryStore.getState().getConfirmedHotel() ??
    useUserMemoryStore.getState().getHotelCandidate();
  if (
    hotel?.name &&
    typeof hotel.lat === 'number' &&
    typeof hotel.lng === 'number' &&
    Number.isFinite(hotel.lat) &&
    Number.isFinite(hotel.lng)
  ) {
    return {
      name: hotel.name,
      type: 'HOTEL_START',
      needsClarification: false,
      lat: hotel.lat,
      lng: hotel.lng,
    };
  }
  return {
    // Kurz — nie „Aktuelle GPS-Position“ (landet sonst in Distanz-Stichpunkten)
    name: bag.cityHint ? `Start (${bag.cityHint})` : 'Start',
    type: 'CURRENT_GPS',
    needsClarification: false,
    lat: gps.lat,
    lng: gps.lng,
  };
}

function inferCompleteness(opts: {
  time: string | null;
  location: string | null;
  needsClarification?: boolean;
  lat?: number | null;
  lng?: number | null;
  completeness?: unknown;
}): TaskCompleteness {
  if (opts.completeness != null) {
    return clampCompleteness(opts.completeness, 2);
  }
  const hasTime = Boolean(opts.time);
  const hasPlace =
    Boolean(opts.location?.trim()) ||
    (typeof opts.lat === 'number' && typeof opts.lng === 'number') ||
    opts.needsClarification === false;
  if (hasTime && hasPlace && !opts.needsClarification) return 0;
  if (hasTime && (!hasPlace || opts.needsClarification)) return 1;
  return 2;
}

function sanitizeFixed(raw: unknown): IngestFixedNode[] {
  if (!Array.isArray(raw)) return [];
  const out: IngestFixedNode[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const titleRaw = String(o.title ?? '').trim();
    if (!titleRaw) continue;
    const title =
      titleRaw.length <= 48
        ? titleRaw
        : `${titleRaw.slice(0, 46).replace(/\s+\S*$/u, '').trim()}…`;
    const prio = clampPrio(o.priority, 3);
    if (prio > 3) continue;
    const location =
      o.location == null || o.location === ''
        ? null
        : String(o.location).trim();
    let time =
      normalizeHm(o.time) ??
      (o.time == null || o.time === '' ? null : String(o.time).trim());
    let endTime =
      normalizeHm(o.endTime) ??
      normalizeHmLoose(o.endTime) ??
      null;
    const rangeFromBlob = parseHmRangeFromText(
      `${title} ${location ?? ''} ${String(o.context ?? '')}`,
    );
    if (rangeFromBlob) {
      if (!time) time = rangeFromBlob.start;
      if (!endTime) endTime = rangeFromBlob.end;
    }
    const hotelFix =
      /\b(hotel|übernacht|uebernacht|pension|unterkunft|hostel|zimmer|airbnb|ferienwohnung)\b/i.test(
        `${title} ${location ?? ''}`,
      );
    if (hotelFix) {
      endTime = null;
    }
    const needsAddr = appointmentNeedsExactAddress(title, location);
    out.push({
      title,
      time,
      endTime,
      priority: prio as 1 | 2 | 3,
      location,
      needsClarification:
        o.needsClarification === true ||
        (!location && prio <= 2) ||
        needsAddr,
      lat: typeof o.lat === 'number' ? o.lat : null,
      lng: typeof o.lng === 'number' ? o.lng : null,
      address: typeof o.address === 'string' ? o.address : null,
    });
  }
  return out;
}

/** Ganze Plan-Aufforderung ist kein Timeline-Stopp („Plane mir eine Tour durch …“). */
export function looksLikePlanCommandEcho(
  title: string,
  utterance?: string,
): boolean {
  const t = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (
    /^(plane?\s+mir|mach\s+mir(?:\s+einen)?|organisiere|tour\s+durch|tagesplan)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\bplane?\s+mir\b/i.test(t) && /\b(tour|tag|durch|plan)\b/i.test(t)) {
    return true;
  }
  const utt = (utterance ?? '').replace(/\s+/g, ' ').trim();
  if (!utt) return false;
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const tn = norm(t);
  const un = norm(utt);
  if (tn.length < 12) return false;
  if (un.startsWith(tn) || un.includes(tn)) {
    return /\b(plane?|tour durch|tagesplan|mach mir)\b/i.test(tn);
  }
  return false;
}

function sanitizeWishes(raw: unknown, utterance?: string): IngestOpenWish[] {
  if (!Array.isArray(raw)) return [];
  const soft: IngestOpenWish[] = [];
  const explore: IngestOpenWish[] = [];
  let i = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const titleRaw = String(o.title ?? '').trim();
    if (!titleRaw) continue;
    if (looksLikePlanCommandEcho(titleRaw, utterance)) continue;
    const title =
      titleRaw.length <= 48
        ? titleRaw
        : `${titleRaw.slice(0, 46).replace(/\s+\S*$/u, '').trim()}…`;
    let prio = clampPrio(o.priority, 5);
    if (prio < 4) prio = 5;
    const context = String(o.context ?? '').trim() || title;
    const estimatedTime = normalizeHm(o.estimatedTime);
    let endTime =
      normalizeHm(o.endTime) ?? normalizeHmLoose(o.endTime) ?? null;
    const range = parseHmRangeFromText(
      `${title} ${context} ${String(o.estimatedTime ?? '')} ${String(o.endTime ?? '')}`,
    );
    if (range) {
      endTime = endTime || range.end;
    }
    // Hotel = nur Check-in-Zeit, nie 18–19-Band
    const hotelWish =
      /\b(hotel|übernacht|uebernacht|pension|unterkunft|hostel|zimmer|airbnb|ferienwohnung)\b/i.test(
        `${title} ${context}`,
      );
    if (hotelWish) {
      endTime = null;
    }
    const completeness = inferCompleteness({
      time: estimatedTime || range?.start || null,
      location: context,
      completeness: o.completeness,
    });
    const wish: IngestOpenWish = {
      id: `wish_${Date.now()}_${i++}`,
      title,
      priority: prio as 4 | 5 | 6,
      context,
      estimatedTime: estimatedTime || range?.start || null,
      endTime,
      completeness,
    };
    if (prio === 6) explore.push(wish);
    else soft.push(wish);
  }
  // Prio 6 immer zuletzt
  return [...soft, ...explore];
}

/** Kein erfundenes Erkunden — außer User will es oder nennt eine Zielstadt ≠ GPS. */
function dropInventedExploreWishes(
  utterance: string,
  wishes: IngestOpenWish[],
  gpsCity?: string | null,
): IngestOpenWish[] {
  const cleaned = wishes.filter(
    (w) => !looksLikePlanCommandEcho(w.title, utterance),
  );
  const t = utterance.toLowerCase();
  const userWantsExplore =
    /\b(erkunden|erleben|sightseeing|must[-\s]?see|highlights?|sehenswürdig|tour|stadtrund|bummel|spazier|inspiration|frei\s*zeit|was\s+(geht|machen)|stadt\s+ansehen|tagesplan|tag\s+in|plan(?:e|en|ung)?)\b/i.test(
      t,
    );
  if (userWantsExplore) return cleaned;
  try {
    const { keepExploreWishForDestination } = require('./planDestinationCity') as {
      keepExploreWishForDestination: (u: string, g?: string | null) => boolean;
    };
    if (keepExploreWishForDestination(utterance, gpsCity)) return cleaned;
  } catch {
    /* soft */
  }
  return cleaned.filter((w) => {
    if (w.priority !== 6) return true;
    const blob = `${w.title} ${w.context}`.toLowerCase();
    return !/\b(erkunden|erleben|sightseeing|highlight|tour|bummel|spazier|inspiration|sehenswürdig)\b/i.test(
      blob,
    );
  });
}

function patchIngestDestination(
  plan: IngestedPlan,
  utterance: string,
  gpsCity?: string | null,
  frame?: TurnFrame | null,
): IngestedPlan {
  try {
    if (frame) {
      return applyTurnFrameToPlan(plan, frame, utterance, gpsCity);
    }
    const dested = patchPlanForDestinationCity(plan, utterance, gpsCity);
    return mergeUtteranceSlotsIntoPlan(dested, utterance);
  } catch {
    try {
      return mergeUtteranceSlotsIntoPlan(plan, utterance);
    } catch {
      return plan;
    }
  }
}

function normalizeLageMode(raw: unknown, utterance: string): PlanLageMode {
  if (raw === 'add' || raw === 'change' || raw === 'new') return raw;
  if (/\b(änder|aender|verschieb|stattdessen|statt)\b/i.test(utterance)) {
    return 'change';
  }
  if (/\b(auch|dazu|noch|ergänz|ergaenz|hinzu)\b/i.test(utterance)) {
    return 'add';
  }
  return 'new';
}

/** Ziel-Tag aus Rohwert / Utterance (Wochentag, morgen, …). */
export function normalizeTargetDate(raw: unknown, utterance: string): string {
  const t = utterance.replace(/\s+/g, ' ').trim();
  const hasMorgen =
    /\bmorgen\b/i.test(t) &&
    !/\bguten\s+morgen\b/i.test(t) &&
    !/\bheut(?:e)?\s+morgen\b/i.test(t);
  const hasUebermorgen = /\bübermorgen\b|\buebermorgen\b/i.test(t);
  const hasHeute = /\bheute\b/i.test(t);
  const hasWeekday =
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i.test(t);
  // Nur bei echtem Mehr-Tage-Mix („heute … und morgen …“) Primärtag = heute.
  // „Morgen um 11 Termin“ darf NIEMALS auf heute fallen.
  const mixedHeuteMorgen = hasMorgen && hasHeute && !hasUebermorgen;
  const fromUtterance = mixedHeuteMorgen
    ? todayDateKey()
    : tryResolveDateKeyFromUserText(t);

  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    // LLM-Datum nur übernehmen wenn Utterance keinen klaren anderen Tag nennt
    if (
      fromUtterance &&
      fromUtterance !== raw &&
      (hasMorgen || hasUebermorgen || hasWeekday) &&
      !mixedHeuteMorgen
    ) {
      return fromUtterance;
    }
    // Nie Vergangenheitstage akzeptieren
    const today = todayDateKey();
    if (raw < today) {
      return fromUtterance && fromUtterance >= today
        ? fromUtterance
        : today;
    }
    return raw;
  }
  return fromUtterance ?? todayDateKey();
}

function defaultBridge(mode: PlanLageMode, date: string): string {
  if (mode === 'add') {
    return `Ich schau mir ${date} an und packe deine neuen Wünsche in den bestehenden Plan.`;
  }
  if (mode === 'change') {
    return `Ich rechne ${date} um nach dem, was du ändern willst.`;
  }
  return `Ich baue den Masterplan für ${date} — einmal komplett durchgerechnet.`;
}

function snapshotTimelineForDay(dayKey: string): string {
  const { formatTimelineSnapshotForPrompt } = require('../timeline/timelineSnapshot') as {
    formatTimelineSnapshotForPrompt: (dayKey: string) => string;
  };
  return formatTimelineSnapshotForPrompt(dayKey);
}

function heuristicFallback(utterance: string): IngestedPlan {
  const geoAnchor = resolveDefaultAnchor();
  const targetDate = normalizeTargetDate(null, utterance);
  const lageMode = normalizeLageMode(null, utterance);
  const openWishesQueue: IngestOpenWish[] = [
    {
      id: `wish_${Date.now()}_0`,
      title: shortWishTitle(utterance),
      priority: 5,
      context: utterance.slice(0, 200),
      estimatedTime: nextFutureHalfHourSlot(targetDate),
      completeness: 2,
    },
  ];
  const fixedNodes: IngestFixedNode[] = [];
  const planBase = { fixedNodes, openWishesQueue, targetDate };
  return {
    targetDate,
    geoAnchor,
    destinationCity: null,
    fixedNodes,
    openWishesQueue,
    tasks: derivePlanTasks(planBase),
    lageMode,
    bridgeSpeech: sanitizePlanSpeech(defaultBridge(lageMode, targetDate)),
    openQuestions: ['Was genau soll ich als Erstes festmachen?'],
    initialVoiceConfirm: 'Passt der grobe Plan so für dich?',
  };
}

/** Kurzer Timeline-Titel — nie die ganze User-Frage. */
function shortWishTitle(utterance: string): string {
  const t = utterance.replace(/\s+/g, ' ').trim();
  if (!t) return 'Offener Wunsch';
  if (/\b(spazier|bummel|raus)\b/i.test(t) && /\b(abend|heute)\b/i.test(t)) {
    return 'Abendspaziergang';
  }
  if (/\b(essen|restaurant|dinner)\b/i.test(t) && !/\bplan(e|en)?\b/i.test(t)) {
    return 'Abendessen';
  }
  if (looksLikePlanCommandEcho(t, t) || /\bplan(e|en)?\b/i.test(t)) {
    const city = t.match(/\b(?:durch|in)\s+([A-ZÄÖÜ][\p{L}'-]{2,})\b/u);
    return city?.[1] ? `Tag in ${city[1]}` : 'Tagesplan';
  }
  const first = (t.split(/[?.!]/)[0] ?? t).trim();
  if (first.length <= 36) return first;
  const cut = first.slice(0, 34);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 12 ? cut.slice(0, sp) : cut).trim()}…`;
}

/** Nächster :00/:30-Slot ≥ ~25 Min in der Zukunft (für HEUTE), sonst 20:00. */
function nextFutureHalfHourSlot(dayKey: string, nowMs = Date.now()): string {
  const today = todayDateKey();
  if (dayKey !== today) return '20:00';
  const now = new Date(nowMs);
  let totalMin = now.getHours() * 60 + now.getMinutes() + 25;
  totalMin = Math.ceil(totalMin / 30) * 30;
  if (totalMin >= 24 * 60) totalMin = 23 * 60 + 30;
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function hmToTodayMs(dayKey: string, hm: string, nowMs = Date.now()): number | null {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = dayKey.split('-').map(Number);
  return new Date(y!, mo! - 1, d!, Number(m[1]), Number(m[2]), 0, 0).getTime();
}

/** Feste Termine behalten ihre Uhrzeit — nie auf „jetzt+X“ schieben. */
function bumpPastTimesOnDay(
  nodes: IngestFixedNode[],
  _dayKey: string,
  _nowMs = Date.now(),
): IngestFixedNode[] {
  return nodes;
}

/** Abend-/Spazier-Wunsch: Mittags-Slot (11–15) ist Quatsch → Abend. */
function looksLikeEveningWish(w: IngestOpenWish): boolean {
  const t = `${w.title} ${w.context}`.toLowerCase();
  return /\b(abend|dinner|spazier|bummel|nacht|tonight)\b/i.test(t);
}

function eveningSlotFloor(dayKey: string, nowMs = Date.now()): string {
  const evening = '19:30';
  if (dayKey !== todayDateKey()) return evening;
  const floor = nextFutureHalfHourSlot(dayKey, nowMs);
  const floorMin = (() => {
    const m = floor.match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : 19 * 60;
  })();
  return floorMin >= 18 * 60 + 30 ? floor : evening;
}

function bumpPastWishTimesOnDay(
  wishes: IngestOpenWish[],
  dayKey: string,
  nowMs = Date.now(),
  fixedNodes: IngestFixedNode[] = [],
): IngestOpenWish[] {
  const isToday = dayKey === todayDateKey();
  const floor = isToday
    ? nextFutureHalfHourSlot(dayKey, nowMs)
    : '20:00';

  const hardIntervals: Array<{ start: number; end: number }> = [];
  for (const n of fixedNodes) {
    if (!n.time) continue;
    const start = hmToTodayMs(dayKey, n.time, nowMs);
    if (start == null) continue;
    const endHm = n.endTime ? hmToTodayMs(dayKey, n.endTime, nowMs) : null;
    hardIntervals.push({
      start,
      end: endHm != null && endHm > start ? endHm : start + 60 * 60_000,
    });
  }
  try {
    const { hardIntervalsFromStops } =
      require('./planHardLock') as typeof import('./planHardLock');
    hardIntervals.push(
      ...hardIntervalsFromStops(
        useFuturePlanStore.getState().getPlanForDay(dayKey).stops,
      ),
    );
  } catch {
    /* soft */
  }
  hardIntervals.sort((a, b) => a.start - b.start);

  const snapHm = (hm: string): string => {
    const ms = hmToTodayMs(dayKey, hm, nowMs);
    if (ms == null) return hm;
    try {
      const {
        dayBoundsMs,
        findFreeSlotStartMs,
        msToHmLabel,
      } = require('./planHardLock') as typeof import('./planHardLock');
      const bounds = dayBoundsMs(dayKey);
      const free = findFreeSlotStartMs({
        preferredStartMs: ms,
        durationMs: 45 * 60_000,
        hardIntervals,
        dayStartMs: bounds.start,
        dayEndMs: bounds.end,
        nowFloorMs: isToday ? nowMs + 15 * 60_000 : bounds.start,
      });
      return free != null ? msToHmLabel(free) : hm;
    } catch {
      return hm;
    }
  };

  return wishes.map((w) => {
    let time = w.estimatedTime;
    if (!time) {
      time = looksLikeEveningWish(w)
        ? eveningSlotFloor(dayKey, nowMs)
        : floor;
      return { ...w, estimatedTime: snapHm(time) };
    }
    const hm = time.match(/^(\d{1,2}):(\d{2})$/);
    const hour = hm ? Number(hm[1]) : null;
    if (
      looksLikeEveningWish(w) &&
      hour != null &&
      hour >= 11 &&
      hour < 16
    ) {
      return { ...w, estimatedTime: snapHm(eveningSlotFloor(dayKey, nowMs)) };
    }
    if (!isToday) return { ...w, estimatedTime: snapHm(time) };
    const ms = hmToTodayMs(dayKey, time, nowMs);
    if (ms == null || ms >= nowMs + 20 * 60_000) {
      return { ...w, estimatedTime: snapHm(time) };
    }
    return {
      ...w,
      estimatedTime: snapHm(
        looksLikeEveningWish(w) ? eveningSlotFloor(dayKey, nowMs) : floor,
      ),
    };
  });
}

export async function geocodeIngestedPlan(
  plan: IngestedPlan,
): Promise<IngestedPlan> {
  const bag = readRucksackSync();
  const gps = anchorCoords(bag);
  const bias = {
    biasLat: plan.geoAnchor.lat ?? gps.lat,
    biasLng: plan.geoAnchor.lng ?? gps.lng,
    cityHint: bag.cityHint ?? null,
  };

  const fixedNodes = await Promise.all(
    plan.fixedNodes.map(async (n) => {
      // Vage Sport-Venues nie blind geocoden (sonst „Lübeck Tennisplätze“ → Stadtmitte)
      if (appointmentNeedsExactAddress(n.title, n.location)) {
        return {
          ...n,
          lat: null,
          lng: null,
          needsClarification: true,
        };
      }
      if (!n.location?.trim() || n.needsClarification) return n;
      if (
        typeof n.lat === 'number' &&
        typeof n.lng === 'number' &&
        Number.isFinite(n.lat) &&
        Number.isFinite(n.lng)
      ) {
        return n;
      }
      try {
        const {
          resolvePlanBaseDestination,
        } = await import('./planBaseSynonyms');
        const baseHit = resolvePlanBaseDestination(
          `${n.title} ${n.location}`,
        );
        if (
          baseHit &&
          baseHit.lat != null &&
          baseHit.lng != null &&
          Number.isFinite(baseHit.lat) &&
          Number.isFinite(baseHit.lng)
        ) {
          return {
            ...n,
            location: baseHit.label,
            lat: baseHit.lat,
            lng: baseHit.lng,
            address: baseHit.label,
            needsClarification: false,
          };
        }
        const geo = await geocodePlaceName(n.location, bias);
        if (!geo) return n;
        // Stadtteil-Geocode ≠ Terminadresse — Klärung offen lassen
        const stillNeedsAddr = appointmentNeedsExactAddress(
          n.title,
          n.location,
        );
        return {
          ...n,
          lat: stillNeedsAddr ? null : geo.lat,
          lng: stillNeedsAddr ? null : geo.lng,
          address: geo.label || n.location,
          needsClarification: stillNeedsAddr ? true : false,
        };
      } catch {
        return n;
      }
    }),
  );

  const openWishesQueue = await Promise.all(
    plan.openWishesQueue.map(async (w) => {
      const q = [w.context, w.title].filter(Boolean).join(' ').trim();
      if (q.length < 3) return w;
      if (
        !/\d|straße|strasse|platz|allee|weg|hotel|cafe|café|restaurant|museum|bahnhof/i.test(
          q,
        )
      ) {
        return w;
      }
      // Kein Blind-Geocode bei „irgendwo“ / Themenwünschen
      if (/irgendwo|irgendwas|erkunden|elbblick|frühstück|fruehstueck/i.test(q)) {
        return w;
      }
      try {
        const geo = await geocodePlaceName(q, bias);
        if (!geo) return w;
        return {
          ...w,
          lat: geo.lat,
          lng: geo.lng,
          address: geo.label,
        };
      } catch {
        return w;
      }
    }),
  );

  const next = { ...plan, fixedNodes, openWishesQueue };
  return { ...next, tasks: derivePlanTasks(next) };
}

/**
 * Master-Ingest: Nachricht lesen + parallele Timeline-Lage → kompletter Plan.
 */
export async function runPlanningIngestion(
  utterance: string,
  opts?: {
    signal?: AbortSignal;
    dayKeyHint?: string | null;
    frame?: TurnFrame | null;
  },
): Promise<IngestedPlan> {
  const text = utterance.replace(/\s+/g, ' ').trim();
  if (!text) return geocodeIngestedPlan(heuristicFallback(''));

  void loadPlanTripPrefs();
  const geoDefault = resolveDefaultAnchor();
  const bag = readRucksackSync();
  const guessedDate = normalizeTargetDate(opts?.dayKeyHint, text);
  const timelineSnap = snapshotTimelineForDay(guessedDate);

  const sessionDest =
    usePlanSessionStore.getState().plan?.destinationCity?.trim() || null;
  const userPrompt = [
    planningClockContextBlock(),
    `STADT-HINT (GPS-Pack, oft NICHT der Zielort): ${bag.cityHint || 'unbekannt'}`,
    `ZIELSTADT (laufender Plan, oft ≠ GPS): ${opts?.frame?.destCity || sessionDest || 'noch unbekannt'}`,
    opts?.frame ? formatTurnFrameForPlanPrompt(opts.frame) : '',
    `DEFAULT_GEO: ${geoDefault.name} (${geoDefault.type}) lat=${geoDefault.lat} lng=${geoDefault.lng}`,
    `GEGUESSTER_TAG (verbindlich wenn User morgen/Wochentag nennt): ${guessedDate}`,
    `BEKANNTE_PREFS: ${prefsBlockForPrompt()}`,
    planBaseSynonymPromptBlock(),
    `LIVE_CHAT: an | idle_timeout_s: 60`,
    timelineSnap,
    `USER_ROHTEXT (unverändert):`,
    text,
    'Baue den kompletten Masterplan für GEGUESSTER_TAG. targetDate MUSS zu morgen/Wochentag im User-Text passen — nie heute erzwingen nur weil Uhrzeiten genannt werden. Feste Termine (Termin, Tennis) = Fix mit Uhrzeit. Keine Rückfrage nach aktueller Stadt wenn GPS klar und Zielort im Text steht. Titel kurz und userfreundlich.',
  ].join('\n');

  const geminiOpts = geminiOptsForPlanIngest(text);

  try {
    let raw = await generateGeminiText(userPrompt, {
      systemInstruction: MASTER_INGEST_SYSTEM,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
      temperature: 0.25,
      maxTokens: 4096,
      signal: opts?.signal,
      ...geminiOpts,
    });
    let parsed = parseJsonObject(raw);
    // Flash murkst → 1× Pro escalate (zählt gegen Deckel)
    if (!parsed && tryConsumePlanProSlot('flash_failed')) {
      raw = await generateGeminiText(userPrompt, {
        systemInstruction: MASTER_INGEST_SYSTEM,
        useFindusSystem: false,
        responseJson: true,
        jsonMimeOnly: true,
        temperature: 0.25,
        maxTokens: 4096,
        signal: opts?.signal,
        task: 'itinerary',
        forcePro: true,
        tier: 'pro',
      });
      parsed = parseJsonObject(raw);
    }
    if (!parsed) {
      const fb = {
        ...heuristicFallback(text),
        destinationCity: opts?.frame?.destCity || sessionDest,
      };
      return geocodeIngestedPlan(
        patchIngestDestination(fb, text, bag.cityHint, opts?.frame),
      );
    }

    const geoRaw =
      parsed.geoAnchor && typeof parsed.geoAnchor === 'object'
        ? (parsed.geoAnchor as Record<string, unknown>)
        : null;
    const geoAnchor: IngestGeoAnchor = {
      name: String(geoRaw?.name ?? geoDefault.name).trim() || geoDefault.name,
      type:
        geoRaw?.type === 'HOTEL_START' ? 'HOTEL_START' : geoDefault.type,
      needsClarification: geoRaw?.needsClarification === true,
      lat:
        typeof geoRaw?.lat === 'number'
          ? geoRaw.lat
          : geoDefault.lat ?? null,
      lng:
        typeof geoRaw?.lng === 'number'
          ? geoRaw.lng
          : geoDefault.lng ?? null,
    };

    const lageMode = normalizeLageMode(parsed.lageMode, text);
    // Tag festnageln: kein stiller Sprung weg vom geratenen Tag ohne explizites Datum im JSON das matched
    let targetDate = normalizeTargetDate(parsed.targetDate, text);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(String(parsed.targetDate ?? '')) &&
      guessedDate
    ) {
      targetDate = guessedDate;
    }

    const fixedNodes = bumpPastTimesOnDay(
      sanitizeFixed(parsed.fixedNodes),
      targetDate,
    );
    const openWishesQueue = bumpPastWishTimesOnDay(
      dropInventedExploreWishes(
        text,
        sanitizeWishes(parsed.openWishesQueue, text),
        bag.cityHint,
      ),
      targetDate,
      Date.now(),
      fixedNodes,
    );

    const openQuestions = Array.isArray(parsed.openQuestions)
      ? parsed.openQuestions
          .map((q) => sanitizePlanSpeech(String(q)))
          .filter(Boolean)
          .slice(0, 8)
      : [];

    const stripConfirm = (s: string) =>
      s
        .replace(
          /\s*(passt\s+der\s+(fokus|grobe\s+plan|plan)[^.?！？]*[.?!？]?)/giu,
          '',
        )
        .replace(/\s{2,}/g, ' ')
        .trim();

    const bridgeSpeech = ''; // Planungsmodus: keine Bridge-Speech
    let initialVoiceConfirm = sanitizePlanSpeech(
      String(parsed.initialVoiceConfirm ?? '').trim() ||
        'Passt der grobe Plan so für dich?',
    );
    // Nie zwei Confirm-Fragen: wenn Confirm schon in Bridge war, Standard nutzen
    if (!/passt/i.test(initialVoiceConfirm)) {
      initialVoiceConfirm = 'Passt der grobe Plan so für dich?';
    }
    // Confirm nur bei Fixterminen — sonst leer (Orchestrator überspringt Wait)
    const hasFixed =
      fixedNodes.some((n) => Boolean(n.time) || n.priority <= 2);
    if (!hasFixed) {
      initialVoiceConfirm = '';
    }

    const plan: IngestedPlan = {
      targetDate,
      geoAnchor,
      destinationCity: opts?.frame?.destCity || sessionDest,
      fixedNodes,
      openWishesQueue:
        openWishesQueue.length > 0
          ? openWishesQueue
          : heuristicFallback(text).openWishesQueue,
      tasks: [],
      lageMode,
      bridgeSpeech,
      openQuestions,
      initialVoiceConfirm,
    };
    const patched = patchIngestDestination(plan, text, bag.cityHint, opts?.frame);
    patched.tasks = derivePlanTasks(patched);
    console.log('[module5] ingest', {
      dest: patched.destinationCity,
      gps: bag.cityHint,
      wishes: patched.openWishesQueue.map((w) => w.title),
      fixed: patched.fixedNodes.map((n) => n.title),
    });
    return geocodeIngestedPlan(patched);
  } catch (err) {
    console.warn('[module5] master ingest failed', err);
    return geocodeIngestedPlan(
      patchIngestDestination(
        {
          ...heuristicFallback(text),
          destinationCity: opts?.frame?.destCity || sessionDest,
        },
        text,
        bag.cityHint,
        opts?.frame,
      ),
    );
  }
}
