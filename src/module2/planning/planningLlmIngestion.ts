/**
 * Modul 5 — Master-Ingest: User-Nachricht + bestehende Timeline → kompletter Tagesplan.
 * Einmal alles durchrechnen (kein Step-by-Step beim Befüllen).
 */

import { generateGeminiText } from '../../services/geminiService';
import { geocodePlaceName } from '../../services/navigation/googleMapsNav';
import { todayDateKey, offsetDateKey } from '../../utils/dateKeys';
import { readRucksackSync, anchorCoords } from '../rucksack/rucksackStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import {
  FINDUS_DYNAMIC_STRUCTURE_DOCTRINE,
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_HELP_FIRST_MONETIZATION_BLOCK,
} from '../../services/concierge/findusResponsePolicy';
import { sanitizePlanSpeech } from './planSpeechSanitize';
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

export const MASTER_INGEST_SYSTEM = `Du bist der MASTERPLANER für Findus Modul 5.
Du bekommst: User-Nachricht + Snapshot der Timeline für den Zieldatum-Tag.
Du baust EINMAL den kompletten Tagesplan — nicht Stück für Stück.

${FINDUS_DYNAMIC_STRUCTURE_DOCTRINE}

ABLAUF (verbindlich):
1) Lage: Welcher Tag? Neu / hinzu / ändern? Was steht SCHON in der Timeline?
2) User-Wünsche vollständig extrahieren — nichts weglassen (Meeting, Hotel, Frühstück, Fahrt, Essen, Erkunden).
3) Rückwärts um harte Anker planen. Konflikte selbst lösen nach Opfer-Reihenfolge:
   Prio 6 frei → Prio 5 löschen nur markieren als Frage → Prio 4 nur verschieben → Prio 3 Frage → Prio 1–2 heilig.
4) JEDEN Slot mit realistischer Uhrzeit (HH:mm) befüllen — auch offene Wünsche.
   HEUTE: nie Zeiten in der Vergangenheit. Liegt „jetzt“ nach deinem Slot → auf nächste volle :00/:30 in der Zukunft runden (mind. ~20–30 Min voraus).
   Abend/Spaziergang/Dinner/„heute Abend“ → estimatedTime ab ~18:30–20:30, NIE Mittag (11–15 Uhr).
5) Prio 6 (Erkunden/Inspiration/Spaziergang) IMMER zuletzt in openWishesQueue — erst nachdem der Wunschplan steht.
   Spaziergang/Abendspaziergang/Bummel = Outdoor/Erkunden (Prio 6), KEINE Restaurant-Wünsche daraus.
6) Travel-Lücken als Hinweis in openQuestions nennen (z. B. „Fahrt nach Hamburg“), nicht als Fake-Ort.
7) Titel kurz zusammenfassen (max ~40 Zeichen) — NIEMALS die ganze User-Frage als Titel.
8) Outfit/Kleidung/Wetter-Fragen gehören NICHT hierher — wenn die Nachricht primär „was anziehen“ ist: fixedNodes=[], openWishesQueue=[], bridgeSpeech kurz ablehnen („das ist Outfit, kein Plan“) und initialVoiceConfirm leer.

TASK-VOLLSTÄNDIGKEIT:
- completeness 0: Zeit + Titel + Ort fest (fixedNodes)
- completeness 1: Zeit + Titel, Ort unklar → needsClarification / openQuestion
- completeness 2: Thema/Ort-Wunsch ohne finalen Place → openWishesQueue mit estimatedTime

PRIORITÄTEN:
1 Sonnenuntergang/Flug/hartes Meeting · 2 Tickets/Reservation · 3 loses Treffen
4 Zeitfenster · 5 flexibler Wunsch · 6 Erkunden (zuletzt!)

SPEECH:
- bridgeSpeech: max 1–2 kurze Sätze — EINZIGES Vorgeplänkel: grobe Tages-Zusammenfassung + Motivation/Anerkennung (Bezug zu Bekanntem ok). KEINE Liste aller offenen Fragen. KEINE Wiederholung der User-Frage. KEINE Confirm-Frage („Passt der…?“ / „Passt der Fokus…?“) — Confirm kommt separat genau 1× und NUR bei Fixterminen. KEINE konkreten Stopps/Tipps in der Bridge (die kommen in der Hauptantwort).
- initialVoiceConfirm: EINE kurze Confirm-Frage — nur wenn fixedNodes mit Zeit/Prio≤2 vorliegen. Sonst leer lassen.
- openQuestions: intern für Code ok, aber bridgeSpeech nicht damit vollstopfen.

STADT ERKUNDEN / MUST-SEES / HIGHLIGHTS-ROUTE:
- Als EINEN openWish mit priority 6 (Erkunden), NICHT als feste 2er-Auswahl-Pitches (kein Ort-A vs. Ort-B vor Confirm).
- estimatedTime = grobes Fenster-Start (z. B. 10:00), nicht zig Einzelwünsche.
- Nach Confirm legt der Code selbst eine Mehr-Stopp-Highlight-Route in Laufreihenfolge — LLM soll keine Einzel-Sehenswürdigkeiten als openWishes vorab listen.

${FINDUS_HELP_FIRST_MONETIZATION_BLOCK}

fixedNodes = nur Prio 1–3 mit time. openWishesQueue = Prio 4–6, JEDE mit estimatedTime, Prio 6 am Ende.

${FINDUS_FEW_SHOT_DISCLAIMER}

GIB NUR JSON:
{
  "targetDate": "YYYY-MM-DD",
  "lageMode": "new" | "add" | "change",
  "geoAnchor": { "name": "...", "type": "CURRENT_GPS" | "HOTEL_START", "needsClarification": false },
  "fixedNodes": [
    { "title": "Meeting Café", "time": "15:00", "priority": 1, "location": "Café unklar", "needsClarification": true }
  ],
  "openWishesQueue": [
    { "title": "Frühstück Prisdorf", "priority": 4, "context": "Frühstück in Prisdorf", "estimatedTime": "09:00", "completeness": 2 },
    { "title": "Hotel Check-in", "priority": 4, "context": "neues Hotel Hamburg, nach Meeting", "estimatedTime": "16:00", "completeness": 2 },
    { "title": "Italiener Elbblick", "priority": 4, "context": "Abendessen Italiener mit echtem Elbblick", "estimatedTime": "19:00", "completeness": 2 },
    { "title": "Hamburg erkunden", "priority": 6, "context": "ein bisschen Stadt erleben", "estimatedTime": "17:00", "completeness": 2 }
  ],
  "openQuestions": [
    "Welches Café fürs Meeting um 15?",
    "Frühstück in Prisdorf — welcher Laden?",
    "Welches Hotel zum Einchecken?",
    "Italiener mit echtem Elbblick — welche zwei Optionen?"
  ],
  "bridgeSpeech": "Kurz: du willst Montag Frühstück in Prisdorf, Meeting 15 Uhr, danach Hotel und abends Italiener mit Elbblick — Erkunden erst danach. Ich hab den Tag grob durchgerechnet. Offen: Café, Frühstücksladen, Hotel, Italiener.",
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
    const time =
      normalizeHm(o.time) ??
      (o.time == null || o.time === '' ? null : String(o.time).trim());
    out.push({
      title,
      time,
      priority: prio as 1 | 2 | 3,
      location,
      needsClarification:
        o.needsClarification === true || (!location && prio <= 2),
      lat: typeof o.lat === 'number' ? o.lat : null,
      lng: typeof o.lng === 'number' ? o.lng : null,
      address: typeof o.address === 'string' ? o.address : null,
    });
  }
  return out;
}

function sanitizeWishes(raw: unknown): IngestOpenWish[] {
  if (!Array.isArray(raw)) return [];
  const soft: IngestOpenWish[] = [];
  const explore: IngestOpenWish[] = [];
  let i = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const titleRaw = String(o.title ?? '').trim();
    if (!titleRaw) continue;
    const title =
      titleRaw.length <= 48
        ? titleRaw
        : `${titleRaw.slice(0, 46).replace(/\s+\S*$/u, '').trim()}…`;
    let prio = clampPrio(o.priority, 5);
    if (prio < 4) prio = 5;
    const estimatedTime = normalizeHm(o.estimatedTime);
    const context = String(o.context ?? '').trim() || title;
    const completeness = inferCompleteness({
      time: estimatedTime,
      location: context,
      completeness: o.completeness,
    });
    const wish: IngestOpenWish = {
      id: `wish_${Date.now()}_${i++}`,
      title,
      priority: prio as 4 | 5 | 6,
      context,
      estimatedTime,
      completeness,
    };
    if (prio === 6) explore.push(wish);
    else soft.push(wish);
  }
  // Prio 6 immer zuletzt
  return [...soft, ...explore];
}

export function derivePlanTasks(plan: {
  fixedNodes: IngestFixedNode[];
  openWishesQueue: IngestOpenWish[];
  targetDate: string;
}): PlanTask[] {
  const tasks: PlanTask[] = [];
  for (const n of plan.fixedNodes) {
    const completeness = inferCompleteness({
      time: n.time,
      location: n.location,
      needsClarification: n.needsClarification,
      lat: n.lat,
      lng: n.lng,
    });
    tasks.push({
      id: `fix_${plan.targetDate}_${n.title.replace(/\W+/g, '_').slice(0, 24)}_${n.priority}`,
      title: n.title,
      priority: n.priority,
      completeness,
      timeHm: n.time,
      location: n.location,
      context: n.location || n.title,
      lat: n.lat,
      lng: n.lng,
      address: n.address,
      hard: true,
      status:
        completeness === 0
          ? 'inserted'
          : completeness === 1
            ? 'needs_place'
            : 'queued',
    });
  }
  plan.openWishesQueue.forEach((w, i) => {
    const completeness =
      w.completeness ??
      inferCompleteness({
        time: w.estimatedTime ?? null,
        location: w.context,
        lat: w.lat,
        lng: w.lng,
      });
    tasks.push({
      id: w.id ?? `wish_${plan.targetDate}_${i}`,
      title: w.title,
      priority: w.priority,
      completeness,
      timeHm: w.estimatedTime ?? null,
      location: w.address ?? null,
      context: w.context,
      lat: w.lat,
      lng: w.lng,
      address: w.address,
      hard: false,
      status: completeness === 0 ? 'inserted' : 'queued',
    });
  });
  return tasks.sort((a, b) => {
    // Prio 6 ans Ende der Abarbeitung; sonst nach Zeit dann Prio
    if (a.priority === 6 && b.priority !== 6) return 1;
    if (b.priority === 6 && a.priority !== 6) return -1;
    const ta = a.timeHm || '99:99';
    const tb = b.timeHm || '99:99';
    if (ta !== tb) return ta.localeCompare(tb);
    return a.priority - b.priority;
  });
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

function normalizeTargetDate(raw: unknown, utterance: string): string {
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  if (/\bmorgen\b/i.test(utterance)) return offsetDateKey(1);
  if (/\bübermorgen\b|\buebermorgen\b/i.test(utterance)) {
    return offsetDateKey(2);
  }
  // Wochentage grob: nächster Montag etc.
  const wd = utterance.match(
    /\b(nächste[rn]?\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i,
  );
  if (wd) {
    const map: Record<string, number> = {
      sonntag: 0,
      montag: 1,
      dienstag: 2,
      mittwoch: 3,
      donnerstag: 4,
      freitag: 5,
      samstag: 6,
    };
    const target = map[wd[2]!.toLowerCase()]!;
    const now = new Date();
    const cur = now.getDay();
    let delta = (target - cur + 7) % 7;
    if (delta === 0 || /nächste/i.test(wd[1] ?? '')) {
      if (delta === 0) delta = 7;
    }
    return offsetDateKey(delta);
  }
  return todayDateKey();
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
  const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
  const lines = plan.stops
    .filter((s) => s.status !== 'done' && !s.id.startsWith('choice_'))
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0))
    .slice(0, 40)
    .map((s) => {
      const t =
        s.plannedStartMs != null
          ? new Date(s.plannedStartMs).toLocaleTimeString('de-DE', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'ohne Zeit';
      return `- ${t} | ${s.kind ?? 'stop'} | prio=${s.planPriority ?? '?'} | ${s.title}`;
    });
  if (lines.length === 0) {
    return `(Timeline ${dayKey}: noch leer)`;
  }
  return `BESTEHENDE TIMELINE ${dayKey}:\n${lines.join('\n')}`;
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
  if (/\b(essen|restaurant|dinner)\b/i.test(t)) return 'Abendessen';
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

function bumpPastTimesOnDay(
  nodes: IngestFixedNode[],
  dayKey: string,
  nowMs = Date.now(),
): IngestFixedNode[] {
  if (dayKey !== todayDateKey()) return nodes;
  const floor = nextFutureHalfHourSlot(dayKey, nowMs);
  return nodes.map((n) => {
    if (!n.time) return n;
    const ms = hmToTodayMs(dayKey, n.time, nowMs);
    if (ms == null || ms >= nowMs + 20 * 60_000) return n;
    return { ...n, time: floor };
  });
}

/** Abend-/Spazier-Wunsch: Mittags-Slot (11–15) ist Quatsch → Abend. */
function looksLikeEveningWish(w: IngestOpenWish): boolean {
  const t = `${w.title} ${w.context}`.toLowerCase();
  return /\b(abend|dinner|spazier|bummel|nacht|tonight)\b/i.test(t);
}

function eveningSlotFloor(dayKey: string, nowMs = Date.now()): string {
  const evening = '19:00';
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
): IngestOpenWish[] {
  const isToday = dayKey === todayDateKey();
  const floor = isToday
    ? nextFutureHalfHourSlot(dayKey, nowMs)
    : '20:00';
  return wishes.map((w) => {
    let time = w.estimatedTime;
    if (!time) {
      time = looksLikeEveningWish(w)
        ? eveningSlotFloor(dayKey, nowMs)
        : floor;
      return { ...w, estimatedTime: time };
    }
    const hm = time.match(/^(\d{1,2}):(\d{2})$/);
    const hour = hm ? Number(hm[1]) : null;
    // Abend-Wunsch mit Mittagszeit → auf Abend schieben
    if (
      looksLikeEveningWish(w) &&
      hour != null &&
      hour >= 11 &&
      hour < 16
    ) {
      return { ...w, estimatedTime: eveningSlotFloor(dayKey, nowMs) };
    }
    if (!isToday) return w;
    const ms = hmToTodayMs(dayKey, time, nowMs);
    if (ms == null || ms >= nowMs + 20 * 60_000) return w;
    return {
      ...w,
      estimatedTime: looksLikeEveningWish(w)
        ? eveningSlotFloor(dayKey, nowMs)
        : floor,
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
        const geo = await geocodePlaceName(n.location, bias);
        if (!geo) return n;
        return {
          ...n,
          lat: geo.lat,
          lng: geo.lng,
          address: geo.label || n.location,
          needsClarification: false,
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
  opts?: { signal?: AbortSignal; dayKeyHint?: string | null },
): Promise<IngestedPlan> {
  const text = utterance.replace(/\s+/g, ' ').trim();
  if (!text) return geocodeIngestedPlan(heuristicFallback(''));

  const geoDefault = resolveDefaultAnchor();
  const bag = readRucksackSync();
  const guessedDate = normalizeTargetDate(opts?.dayKeyHint, text);
  const timelineSnap = snapshotTimelineForDay(guessedDate);

  const userPrompt = [
    `JETZT: ${new Date().toISOString()}`,
    `HEUTE: ${todayDateKey()}`,
    `STADT-HINT: ${bag.cityHint || 'unbekannt'}`,
    `DEFAULT_GEO: ${geoDefault.name} (${geoDefault.type}) lat=${geoDefault.lat} lng=${geoDefault.lng}`,
    `GEGUESSTER_TAG: ${guessedDate}`,
    timelineSnap,
    `USER: ${text}`,
    'Baue den kompletten Masterplan für genau diesen Tag. Behalte bestehende Fix-Termine. Kein Tag-Sprung ohne klaren User-Hinweis.',
  ].join('\n');

  try {
    const raw = await generateGeminiText(userPrompt, {
      systemInstruction: MASTER_INGEST_SYSTEM,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
      temperature: 0.25,
      maxTokens: 4096,
      signal: opts?.signal,
      task: 'itinerary',
    });
    const parsed = parseJsonObject(raw);
    if (!parsed) return geocodeIngestedPlan(heuristicFallback(text));

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
      sanitizeWishes(parsed.openWishesQueue),
      targetDate,
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

    const bridgeSpeech = stripConfirm(
      sanitizePlanSpeech(
        String(parsed.bridgeSpeech ?? '').trim() ||
          defaultBridge(lageMode, targetDate),
      ),
    );
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
    plan.tasks = derivePlanTasks(plan);
    return geocodeIngestedPlan(plan);
  } catch (err) {
    console.warn('[module5] master ingest failed', err);
    return geocodeIngestedPlan(heuristicFallback(text));
  }
}
