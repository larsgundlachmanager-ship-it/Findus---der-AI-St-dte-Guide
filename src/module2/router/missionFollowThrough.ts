/**
 * Mission Follow-Through + Kontrolldistanz.
 *
 * Root-Ziel (Taxi Flughafen / Tisch reservieren / Sport / offene Quest)
 * über Zwischenfragen halten. Nie „fertig“ solange Musts/Buchungs-Link fehlen.
 */

import type { Call1ProximityMode, Call1WorkItem } from './call1TaskBrief';

export type FollowThroughKind =
  | 'taxi_airport'
  | 'table_reserve'
  | 'open_sport'
  | 'open_quest';

export type FollowThroughGoal = {
  kind: FollowThroughKind;
  rootLabel: string;
  /** Bekannte Slots — null = noch offen */
  slots: {
    flightTime?: string | null;
    luggage?: 'hand' | 'checked' | 'unknown' | null;
    cuisineOrVenue?: string | null;
    sportToken?: string | null;
    /** Offene Quest: verdichtete Must-Hints aus Zwischenfragen */
    questHints?: string | null;
    /** Abflugstadt wenn ≠ GPS */
    originCity?: string | null;
    gpsCity?: string | null;
    /** Anreise-Task Status */
    accessLeg?: 'needed' | 'already_there' | 'hotel' | 'train' | 'unknown' | null;
  };
  needBookingLink: boolean;
  startedAtMs: number;
  /** Zuletzt angefasst — für Focus bei Multi-Root */
  touchedAtMs?: number;
  /**
   * Sticky Auftrag-Gedächtnis: Wunsch + offene Tasks + Kontext.
   * Überlebt Persist mit dem Root — Call-1 liest denselben Block.
   */
  auftrag?: import('./missionAuftragMemory').AuftragMemory | null;
};

export type FollowThroughSnapshot = {
  savedAtMs: number;
  focusKind: FollowThroughKind | null;
  roots: FollowThroughGoal[];
};

const TTL_MS = 90 * 60_000;
const MAX_ROOTS = 4;
const STORAGE_KEY = '@findus/follow_through_v1';

/** Multi-Root: Compound (Tisch+Taxi) hält beide Stränge. */
const rootsByKind = new Map<FollowThroughKind, FollowThroughGoal>();
let focusKind: FollowThroughKind | null = null;
let hydrateStarted = false;
let hydrateDone = false;
let hydratePromise: Promise<void> | null = null;

type AsyncStorageLike = {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
  removeItem?: (k: string) => Promise<void>;
};

function getAsyncStorage(): AsyncStorageLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return null;
  }
}

function pickNewestKind(): FollowThroughKind | null {
  let best: FollowThroughKind | null = null;
  let bestMs = 0;
  for (const [k, g] of rootsByKind) {
    const t = g.touchedAtMs ?? g.startedAtMs;
    if (t >= bestMs) {
      bestMs = t;
      best = k;
    }
  }
  return best;
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [k, g] of [...rootsByKind.entries()]) {
    if (now - g.startedAtMs > TTL_MS) rootsByKind.delete(k);
  }
  if (focusKind && !rootsByKind.has(focusKind)) {
    focusKind = pickNewestKind();
  }
}

function schedulePersist(): void {
  const AsyncStorage = getAsyncStorage();
  if (!AsyncStorage) return;
  pruneExpired();
  const snap = snapshotFollowThrough();
  void (async () => {
    try {
      if (!snap) {
        if (AsyncStorage.removeItem) await AsyncStorage.removeItem(STORAGE_KEY);
        else await AsyncStorage.setItem(STORAGE_KEY, '');
        return;
      }
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch {
      /* soft */
    }
  })();
}

function applyRootsFromSnapshot(snap: FollowThroughSnapshot): void {
  rootsByKind.clear();
  const now = Date.now();
  for (const g of snap.roots || []) {
    if (!g?.kind || !g.rootLabel) continue;
    if (now - g.startedAtMs > TTL_MS) continue;
    rootsByKind.set(g.kind, {
      ...g,
      slots: { ...(g.slots || {}) },
      touchedAtMs: g.touchedAtMs ?? g.startedAtMs,
    });
  }
  focusKind =
    snap.focusKind && rootsByKind.has(snap.focusKind)
      ? snap.focusKind
      : pickNewestKind();
}

function ensureHydrateStarted(): void {
  if (hydrateStarted) return;
  hydrateStarted = true;
  const AsyncStorage = getAsyncStorage();
  if (!AsyncStorage) {
    hydrateDone = true;
    return;
  }
  hydratePromise = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw || rootsByKind.size > 0) return;
      try {
        const snap = JSON.parse(raw) as FollowThroughSnapshot;
        if (snap?.roots?.length) applyRootsFromSnapshot(snap);
      } catch {
        /* soft */
      }
    })
    .catch(() => undefined)
    .finally(() => {
      hydrateDone = true;
    });
}

/** Boot / vor erstem Turn — RAM aus Persist laden. */
export function ensureFollowThroughHydrated(): Promise<void> {
  ensureHydrateStarted();
  return hydratePromise ?? Promise.resolve();
}

export function snapshotFollowThrough(): FollowThroughSnapshot | null {
  pruneExpired();
  if (!rootsByKind.size) return null;
  return {
    savedAtMs: Date.now(),
    focusKind,
    roots: [...rootsByKind.values()],
  };
}

/** Sync-Restore (Tests / Kill-Simulation). */
export function applyFollowThroughSnapshot(
  snap: FollowThroughSnapshot | null,
): void {
  rootsByKind.clear();
  focusKind = null;
  if (snap?.roots?.length) applyRootsFromSnapshot(snap);
  hydrateStarted = true;
  hydrateDone = true;
  schedulePersist();
}

/** RAM leeren, Persist unberührt — App-Kill-Simulation in Smokes. */
export function clearFollowThroughRamOnly(): void {
  rootsByKind.clear();
  focusKind = null;
}

function upsertRoot(goal: FollowThroughGoal): FollowThroughGoal {
  const prev = rootsByKind.get(goal.kind);
  const next: FollowThroughGoal = {
    ...goal,
    startedAtMs:
      prev && prev.kind === goal.kind ? prev.startedAtMs : goal.startedAtMs,
    touchedAtMs: Date.now(),
    slots: { ...(goal.slots || {}) },
    // Auftrag behalten wenn Caller keinen frischen mitgibt
    auftrag: goal.auftrag !== undefined ? goal.auftrag : prev?.auftrag ?? null,
  };
  rootsByKind.set(goal.kind, next);
  focusKind = goal.kind;
  // Cap: älteste Non-Focus droppen
  while (rootsByKind.size > MAX_ROOTS) {
    let drop: FollowThroughKind | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [k, g] of rootsByKind) {
      if (k === focusKind) continue;
      const t = g.touchedAtMs ?? g.startedAtMs;
      if (t < oldest) {
        oldest = t;
        drop = k;
      }
    }
    if (!drop) break;
    rootsByKind.delete(drop);
  }
  schedulePersist();
  return next;
}

export function clearFollowThroughGoal(): void {
  rootsByKind.clear();
  focusKind = null;
  schedulePersist();
}

/** Auftrag-Memory am Fokus-Root aktualisieren (Gap-Engine). */
export function upsertFollowThroughAuftrag(
  mem: FollowThroughGoal['auftrag'],
): void {
  ensureHydrateStarted();
  const focus = getFollowThroughGoal();
  if (!focus || !mem) return;
  upsertRoot({ ...focus, auftrag: mem });
}

/** Task 1 (Flug) gelöst — Slot + Fokus für Sticky Task-2. */
export function markTaxiAirportFlightResolved(opts: {
  flightTimeLabel: string;
  originCity?: string | null;
  gpsCity?: string | null;
}): void {
  ensureHydrateStarted();
  const prev = rootsByKind.get('taxi_airport');
  if (!prev) return;
  const originCity = opts.originCity ?? prev.slots.originCity ?? null;
  const gpsCity = opts.gpsCity ?? prev.slots.gpsCity ?? null;
  const mismatch =
    Boolean(originCity && gpsCity) &&
    originCity!.toLowerCase() !== gpsCity!.toLowerCase();
  upsertRoot({
    ...prev,
    slots: {
      ...prev.slots,
      flightTime: opts.flightTimeLabel || prev.slots.flightTime || null,
      originCity,
      gpsCity,
      accessLeg:
        prev.slots.accessLeg && prev.slots.accessLeg !== 'unknown'
          ? prev.slots.accessLeg
          : mismatch
            ? 'needed'
            : prev.slots.accessLeg ?? null,
    },
    needBookingLink: true,
    startedAtMs: prev.startedAtMs,
  });
  focusKind = 'taxi_airport';
  schedulePersist();
}

/** Anreise-Task Slot setzen (schon vor Ort / Bahn / Hotel). */
export function markTaxiAirportAccessLeg(
  leg: 'already_there' | 'hotel' | 'train' | 'needed' | 'unknown',
): void {
  ensureHydrateStarted();
  const prev = rootsByKind.get('taxi_airport');
  if (!prev) return;
  upsertRoot({
    ...prev,
    slots: { ...prev.slots, accessLeg: leg },
    needBookingLink: leg !== 'already_there',
    startedAtMs: prev.startedAtMs,
  });
  focusKind = 'taxi_airport';
  schedulePersist();
}

/** Task 2 Deep-Link ausgeliefert — Kontrolldistanz Buchungs-Link erfüllt. */
export function markTaxiAirportDeepLinkReady(): void {
  ensureHydrateStarted();
  const prev = rootsByKind.get('taxi_airport');
  if (!prev) return;
  upsertRoot({
    ...prev,
    needBookingLink: false,
    startedAtMs: prev.startedAtMs,
  });
  focusKind = 'taxi_airport';
  schedulePersist();
}

export function getFollowThroughGoals(): FollowThroughGoal[] {
  ensureHydrateStarted();
  pruneExpired();
  return [...rootsByKind.values()].sort(
    (a, b) =>
      (b.touchedAtMs ?? b.startedAtMs) - (a.touchedAtMs ?? a.startedAtMs),
  );
}

export function getFollowThroughGoal(): FollowThroughGoal | null {
  ensureHydrateStarted();
  pruneExpired();
  if (focusKind && rootsByKind.has(focusKind)) {
    return rootsByKind.get(focusKind) ?? null;
  }
  return getFollowThroughGoals()[0] ?? null;
}

ensureHydrateStarted();

function looksLikeTaxiCue(text: string): boolean {
  return /\b(taxi|uber|bolt|transfer|welcome\s*pick)\b/iu.test(text || '');
}

function looksLikeTaxiAirport(text: string): boolean {
  const t = text || '';
  try {
    const { looksLikeTaxiTransferHub } = require('../../reisebuero/research/accessTransfer') as {
      looksLikeTaxiTransferHub: (s: string) => boolean;
    };
    if (looksLikeTaxiTransferHub(t)) return true;
  } catch {
    /* soft */
  }
  const taxiCue = looksLikeTaxiCue(t);
  const airportCue =
    /(flughafen|airport|zum\s+flug|zum\s+flieger|boarding|terminal)/iu.test(t) ||
    (/\b(pünktlich|puenktlich)\b/iu.test(t) &&
      /\b(flug|flieger|flughafen|airport)\b/iu.test(t));
  return taxiCue && airportCue;
}

/**
 * „Bestell wieder Taxi“ ohne Flughafen-Wort — Root aus Bag/Persist.
 * Nur wenn schon ein Taxi-Root existiert (oder explizites „wieder“).
 */
function looksLikeTaxiResume(text: string): boolean {
  const t = text || '';
  if (!looksLikeTaxiCue(t) || looksLikeTaxiAirport(t)) return false;
  const againCue =
    /\b(wieder|nochmal|noch\s+mal|erneut|dasselbe|wie\s+(?:eben|vorhin|zuletzt)|noch\s+eins?)\b/iu.test(
      t,
    );
  const orderCue =
    /\b(bestell|buchen|vorbestell|organi|noch\s+mal)\b/iu.test(t) ||
    /^(?:bitte\s+)?(?:noch\s+mal\s+|wieder\s+)?taxi\b/iu.test(t);
  if (againCue && orderCue) return true;
  if (againCue && looksLikeTaxiCue(t)) return true;
  if (rootsByKind.has('taxi_airport') && orderCue) return true;
  return false;
}

function buildTaxiRootLabel(t: string): string {
  const airportish = /\b(flughafen|airport|zum\s+flug|zum\s+flieger|abflug)\b/iu.test(
    t,
  );
  if (!airportish && /kreuzfahrt|einschiff|terminal/iu.test(t)) {
    return 'Taxi zum Kreuzfahrtterminal';
  }
  if (/\b(fähre|faehre|fährhafen)\b/iu.test(t)) return 'Taxi zum Fährhafen';
  if (/\b(bahnhof|hbf)\b/iu.test(t)) return 'Taxi zum Bahnhof';
  if (/\bzwischenstopp\b/iu.test(t)) {
    return 'Taxi Zwischenstopp (Originalziel bleibt)';
  }
  if (/\bhotel|unterkunft\b/iu.test(t) && !airportish) return 'Taxi zum Hotel';
  return 'Taxi zum Flughafen vorbestellen (pünktlich)';
}

function looksLikeTableReserve(text: string): boolean {
  return /\b(reservier(?:en|ung)?|tisch\s+(?:für|fuer|reserv|buch)|vorbestell(?:en)?\s+(?:einen\s+)?tisch)\b/iu.test(
    text || '',
  );
}

function looksLikeHotelStay(text: string): boolean {
  return /\b(hotel|übernacht|uebernacht|zimmer\s+(?:für|fuer)\s+heute|unterkunft\s+suchen)\b/iu.test(
    text || '',
  );
}

function looksLikeOpenSport(text: string): boolean {
  const t = text || '';
  try {
    const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    if (isExplicitNavIntent(t)) return false;
  } catch {
    /* soft */
  }
  if (
    /\b(bock\s+auf\s+sport|lust\s+auf\s+sport|irgend(?:wo|wie)\s+sport|sport\s+(?:machen|treiben)|was\s+kann\s+ich\s+(?:hier\s+)?(?:sportlich|an\s+sport)|sportmöglichkeiten)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return (
    /\b(sport)\b/iu.test(t) &&
    /\b(bock|lust|was\s+kann|möglichkeit|moeglichkeit|hier|jetzt)\b/iu.test(t) &&
    !/\b(spielplan|wann\s+spielt|ticket)\b/iu.test(t)
  );
}

const QUEST_STOP =
  /^(der|die|das|ein|eine|einen|mein|meine|dein|deine|in|im|an|am|auf|zu|zum|zur|und|oder|ist|hat|war|mit|von|den|dem|des|ich|du|wir|mal|hier|da|dort|bitte|so|noch|auch|nicht|heute|jetzt|ne|wa|gell|ey|digga|alter|jo|jaja|halt|eben|eh|uff|boah|krass|irgendwie|irgendwo|irgendwas|voll|richtig|echt|schon|dann|aber|also)$/iu;

function questContentTokens(text: string): string[] {
  return String(text || '')
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3 && !QUEST_STOP.test(w))
    .slice(0, 5);
}

/** Dialekt/STT-Glättung — keine Themenliste, nur Lautstand. */
export function normalizeQuestDialect(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bisch\b/giu, 'ich')
    .replace(/\b(net|ned|nich)\b/giu, 'nicht')
    .replace(/\bnix\b/giu, 'nichts')
    .replace(/\bkamma\b/giu, 'kann man')
    .replace(/\bmussma\b/giu, 'muss man')
    .replace(/\bgib'?s\b/giu, 'gibt es')
    .replace(/\bgibs\b/giu, 'gibt')
    .replace(/\bham\b/giu, 'haben')
    .replace(/\bwillste\b/giu, 'willst du')
    .replace(/\bkannste\b/giu, 'kannst du')
    .replace(/\bmachste\b/giu, 'machst du')
    .replace(/\bsuchste\b/giu, 'suchst du')
    .replace(/\bfindste\b/giu, 'findest du')
    .replace(/\bwoas\b/giu, 'was')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Zustand/Blockade — keine Wunsch-Floskel nötig. */
const SITUATION_BROKEN_RE =
  /\b(platt|kaputt|defekt|tot|leer|gerissen|gebrochen|undicht|klemmt|quietscht|blockiert|eingeklemmt|eingebrochen|ausgeschlossen|eingeschlossen|zugefallen|zugesperrt|abgebrochen)\b/iu;

const SITUATION_CANT_RE =
  /\b((?:geht|springt|startet|läuft|laeuft|fährt|faehrt|macht)\s+nicht|kommt\s+nicht\s+(?:auf|raus|rein|an|los)|kann\s+nicht\s+(?:rein|raus|auf|los|fahren|starten|aufmachen|reinkommen)|nicht\s+(?:auf(?:gehen|machen)|rein(?:kommen)?|los(?:fahren)?))\b/iu;

/** Geschlossene Orte — Objekt steckt, nicht „Museum in der Stadt“. */
const ENCLOSED_PLACE_RE =
  /\b(tiefgarage|parkhaus|garage|wohnung|auto|kofferraum|aufzug|fahrstuhl|keller|zimmer|zug|tram|kabine)\b/iu;

function looksLikeBareNavOrQuiz(t: string): boolean {
  if (
    /^(bitte\s+)?(zum|zur|nach)\s+\S+/iu.test(t) &&
    !SITUATION_BROKEN_RE.test(t) &&
    !SITUATION_CANT_RE.test(t)
  ) {
    return true;
  }
  if (
    /\b(wo\s+ist|wie\s+komme|öffnungszeit|eintritt|hauptstadt|wie\s+alt)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function looksLikeSmalltalkOnly(t: string): boolean {
  return (
    /^(hi|hallo|hey|yo|moin|servus|ciao|danke|thanks|ok|okay|jo|jaja|cool|nice)[\s!.?]*$/iu.test(
      t,
    ) || t.split(/\s+/).filter(Boolean).length <= 1
  );
}

/**
 * Alltagsproblem ohne Wunsch-Floskel: Reifen platt, Schlüssel in der Tiefgarage.
 * Struktur (Zustand / kann-nicht / Objekt-in-geschlossenem-Ort), keine Branchenliste.
 */
export function looksLikeSituationProblem(text: string): boolean {
  const t = normalizeQuestDialect(text);
  if (!t || t.length < 6) return false;
  if (looksLikeBareNavOrQuiz(t)) return false;
  const toks = questContentTokens(t);
  if (SITUATION_BROKEN_RE.test(t) && toks.length >= 1) return true;
  if (SITUATION_CANT_RE.test(t)) return true;
  if (ENCLOSED_PLACE_RE.test(t) && toks.length >= 2) return true;
  if (
    /\b(verloren|verlegt)\b/iu.test(t) &&
    toks.length >= 2 &&
    !/\b(weg\s+von|weit\s+weg)\b/iu.test(t)
  ) {
    return true;
  }
  if (
    /\bweg\b/iu.test(t) &&
    toks.length >= 2 &&
    !/\b(weg\s+von|weit\s+weg|hier\s+weg|geh\s+weg)\b/iu.test(t)
  ) {
    return true;
  }
  // Frist + Bedarf (Akku leer / Termin bald) — kein LLM, nur Struktur
  if (
    /\b(akku|batterie)\b/iu.test(t) &&
    /\b(leer|fast\s+leer|kritisch|0\s*%|null\s*prozent)\b/iu.test(t) &&
    toks.length >= 1
  ) {
    return true;
  }
  if (
    /\b(termin|meeting|flug|abfahrt|einlass)\b/iu.test(t) &&
    /\b(\d+\s*min|gleich|bald|pünktlich|puenktlich|schaffen)\b/iu.test(t) &&
    /\b(akku|laden|ladegerät|ladegeraet|powerbank|taxi|uber)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

export function extractQuestMustKeys(text: string): string[] {
  return questContentTokens(normalizeQuestDialect(text)).slice(0, 3);
}

/**
 * Offene Quest: Struktur + Dialekt, keine Pflicht-Floskeln
 * („zeig mir / irgendwie / organisiere“).
 */
export function looksLikeOpenQuest(text: string): boolean {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length < 6) return false;
  try {
    const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    if (isExplicitNavIntent(raw)) return false;
  } catch {
    /* soft */
  }
  try {
    const { detectHardNavOverride } = require('../../services/navigation/hardNavOverride') as {
      detectHardNavOverride: (s: string) => string | null;
    };
    if (detectHardNavOverride(raw)) return false;
  } catch {
    /* soft */
  }
  if (
    looksLikeTaxiAirport(raw) ||
    looksLikeTaxiResume(raw) ||
    looksLikeTableReserve(raw) ||
    looksLikeHotelStay(raw) ||
    looksLikeOpenSport(raw)
  ) {
    return false;
  }
  const t = normalizeQuestDialect(raw);
  try {
    const { isClosedFactAsk, isSlotOnlyWeatherAsk } = require('./call1IntentForesight') as {
      isClosedFactAsk: (s: string) => boolean;
      isSlotOnlyWeatherAsk: (s: string) => boolean;
    };
    if (isClosedFactAsk(t) || isSlotOnlyWeatherAsk(t)) return false;
  } catch {
    /* soft */
  }
  if (looksLikeBareNavOrQuiz(t) || looksLikeSmalltalkOnly(t)) return false;
  if (looksLikeSituationProblem(t)) return true;

  const toks = questContentTokens(t);
  if (toks.length < 1) return false;

  const hasSelf = /\b(ich|mir|mich|mein|meine|wir|uns|unser)\b/iu.test(t);
  const hasAsk =
    /\?/.test(t) ||
    /\b(was|wo|wie|welch|wohin|wovon|warum|wieso|ob)\b/iu.test(t);
  // Stämme — nicht die Phrasen „zeig mir“ / „organisiere das“
  const hasNeedVerb =
    /\b(brauch|will|hätt|hättest|möcht|moecht|könn|koenn|kann|soll|muss|such|find|hol|bring|mach|regel|klar|fix|check|hilf|krieg|schaff|lös|loes|besorg|fang|start|guck|schau|nehm|pack|lass|organi|zeig)\w{0,10}\b/iu.test(
      t,
    );
  const dialectParticle =
    /\b(ne|wa|gell|ey|digga|alter|jo|jaja|hä|haee|oder\s*so|halt|eben|eh|uff|boah|krass|voll|richtig)\b/iu.test(
      raw,
    ) || /\b(ne|wa|gell|ey|digga|alter|jo)\b/iu.test(t);
  const localNow =
    /\b(hier|jetzt|heute|vor\s+ort|in\s+der\s+nähe|in\s+der\s+naehe|lokal|umkreis)\b/iu.test(
      t,
    );
  const words = t.split(/\s+/).filter(Boolean).length;
  const ramble = words >= 8 && toks.length >= 2;

  if (hasNeedVerb && toks.length >= 1) return true;
  if (hasAsk && toks.length >= 1) return true;
  if (hasSelf && toks.length >= 2) return true;
  if (dialectParticle && toks.length >= 2) return true;
  if (localNow && (hasSelf || hasAsk || hasNeedVerb) && toks.length >= 1) {
    return true;
  }
  if (ramble && (hasSelf || hasAsk || hasNeedVerb || dialectParticle)) {
    return true;
  }
  // Kurzes Geschwafel mit klarem Content-Nomen + Ortsbezug
  if (localNow && toks.length >= 2) return true;
  return false;
}

function extractFlightTimeSlot(text: string): string | null {
  const m = text.match(/\b(?:um\s+)?(\d{1,2}(?::\d{2})?)\s*uhr\b/iu);
  if (m?.[1]) return `${m[1]} Uhr`;
  if (/\b(flug\s*[A-Z]{1,3}\s?\d{2,4})\b/iu.test(text)) {
    return text.match(/\b(flug\s*[A-Z]{1,3}\s?\d{2,4})\b/iu)?.[1] ?? null;
  }
  try {
    const { extractClockHm } = require('../../services/flights/flightTripIntent') as {
      extractClockHm: (s: string) => string | null;
    };
    const hm = extractClockHm(text);
    if (hm) {
      const [h, min] = hm.split(':');
      return min === '00' ? `${Number(h)} Uhr` : `${h}:${min} Uhr`;
    }
  } catch {
    /* soft */
  }
  return null;
}

function extractLuggageSlot(
  text: string,
): 'hand' | 'checked' | 'unknown' | null {
  const t = text || '';
  if (
    /\b(handgepäck|handgepaeck|nur\s+hand|cabin\s*bag|ohne\s+koffer|ohne\s+aufgabe)\b/iu.test(
      t,
    )
  ) {
    return 'hand';
  }
  if (
    /\b(aufgabegepäck|aufgabegepaeck|koffer|checked\s*bag|großes\s+gepäck|grosses\s+gepaeck)\b/iu.test(
      t,
    )
  ) {
    return 'checked';
  }
  return null;
}

function extractCuisineOrVenue(text: string): string | null {
  const t = text || '';
  if (/\b(steak|italiener|sushi|asia|burger|pizza|tapas|vegan)\b/iu.test(t)) {
    return (
      t.match(
        /\b(steak|italiener|sushi|asia|burger|pizza|tapas|vegan)\b/iu,
      )?.[1]?.toLowerCase() ?? null
    );
  }
  return null;
}

function extractQuestHint(text: string): string | null {
  const bits: string[] = [];
  const t = text || '';
  const cue =
    t.match(
      /\b(günstig|guenstig|nah|drinnen|draußen|draussen|heute\s+abend|mit\s+kind|barrierefrei|wetterfest|schnell|leise|romantisch|gruppe)\b/iu,
    )?.[1] ?? null;
  if (cue) bits.push(cue.toLowerCase());
  const cuisine = extractCuisineOrVenue(t);
  if (cuisine) bits.push(cuisine);
  return bits.length ? bits.join(',') : null;
}

function mergeSlotsIntoGoal(
  goal: FollowThroughGoal,
  t: string,
): FollowThroughGoal {
  const next = { ...goal, slots: { ...goal.slots } };
  const ft = extractFlightTimeSlot(t);
  if (ft) next.slots.flightTime = ft;
  const lug = extractLuggageSlot(t);
  if (lug) next.slots.luggage = lug;
  const cuisine = extractCuisineOrVenue(t);
  if (cuisine) next.slots.cuisineOrVenue = cuisine;
  const qh = extractQuestHint(t);
  if (qh) {
    next.slots.questHints = [next.slots.questHints, qh]
      .filter(Boolean)
      .join(',')
      .slice(0, 120);
  }
  if (goal.kind === 'taxi_airport') {
    try {
      const { parseOriginAccessReply, resolveStatedOriginAirport } =
        require('../../services/flights/flightOriginMismatch') as {
          parseOriginAccessReply: (
            s: string,
          ) => FollowThroughGoal['slots']['accessLeg'] | null;
          resolveStatedOriginAirport: (o: {
            userText?: string | null;
          }) => { city: string } | null;
        };
      const leg = parseOriginAccessReply(t);
      if (leg) next.slots.accessLeg = leg;
      const stated = resolveStatedOriginAirport({ userText: t });
      if (stated?.city) next.slots.originCity = stated.city;
    } catch {
      /* soft */
    }
  }
  if (
    goal.kind === 'table_reserve' &&
    /\b(das\s+nehme\s+ich|nehme\s+ich|die\s+erste|nummer\s+[12]|reservier)\b/iu.test(
      t,
    )
  ) {
    next.slots.cuisineOrVenue =
      next.slots.cuisineOrVenue || 'gewähltes_venue';
  }
  return next;
}

/**
 * Start/Update Follow-Through — Multi-Root (Compound upsertet beide).
 */
export function syncFollowThroughGoal(
  userText: string,
): FollowThroughGoal | null {
  ensureHydrateStarted();
  const t = String(userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return getFollowThroughGoal();

  let upserted = false;

  if (looksLikeTaxiAirport(t) || looksLikeTaxiResume(t)) {
    const prevTaxi = rootsByKind.get('taxi_airport');
    const label = looksLikeTaxiResume(t) && !looksLikeTaxiAirport(t)
      ? prevTaxi?.rootLabel || 'Taxi zum Flughafen vorbestellen (pünktlich)'
      : buildTaxiRootLabel(t);
    let originCity = prevTaxi?.slots.originCity ?? null;
    let gpsCity = prevTaxi?.slots.gpsCity ?? null;
    let accessLeg = prevTaxi?.slots.accessLeg ?? null;
    try {
      const {
        detectOriginGpsMismatch,
        parseOriginAccessReply,
      } = require('../../services/flights/flightOriginMismatch') as {
        detectOriginGpsMismatch: (o: {
          gpsLat?: number | null;
          gpsLng?: number | null;
          userText?: string | null;
        }) => {
          mismatch: boolean;
          statedAirport: { city: string } | null;
          gpsAirport: { city: string } | null;
        };
        parseOriginAccessReply: (
          s: string,
        ) => FollowThroughGoal['slots']['accessLeg'] | null;
      };
      let gpsLat: number | null = null;
      let gpsLng: number | null = null;
      try {
        const { useGpsStore } = require('../../store/useGpsStore') as {
          useGpsStore: {
            getState: () => { lat: number | null; lng: number | null };
          };
        };
        const g = useGpsStore.getState();
        gpsLat = g.lat;
        gpsLng = g.lng;
      } catch {
        /* soft */
      }
      const mm = detectOriginGpsMismatch({
        gpsLat,
        gpsLng,
        userText: t,
      });
      if (mm.statedAirport?.city) originCity = mm.statedAirport.city;
      if (mm.gpsAirport?.city) gpsCity = mm.gpsAirport.city;
      if (mm.mismatch && !accessLeg) accessLeg = 'needed';
      const leg = parseOriginAccessReply(t);
      if (leg) accessLeg = leg;
    } catch {
      /* soft */
    }
    upsertRoot({
      kind: 'taxi_airport',
      rootLabel: label,
      slots: {
        flightTime:
          extractFlightTimeSlot(t) ?? prevTaxi?.slots.flightTime ?? null,
        luggage:
          extractLuggageSlot(t) ?? prevTaxi?.slots.luggage ?? 'unknown',
        originCity,
        gpsCity,
        accessLeg,
      },
      needBookingLink: true,
      startedAtMs: prevTaxi?.startedAtMs ?? Date.now(),
    });
    upserted = true;
  }

  if (looksLikeTableReserve(t)) {
    const prevTable = rootsByKind.get('table_reserve');
    upsertRoot({
      kind: 'table_reserve',
      rootLabel: 'Tisch reservieren',
      slots: {
        cuisineOrVenue:
          extractCuisineOrVenue(t) ?? prevTable?.slots.cuisineOrVenue ?? null,
      },
      needBookingLink: true,
      startedAtMs: prevTable?.startedAtMs ?? Date.now(),
    });
    upserted = true;
  }

  if (looksLikeOpenSport(t)) {
    const prevSport = rootsByKind.get('open_sport');
    upsertRoot({
      kind: 'open_sport',
      rootLabel: 'Sport-Möglichkeiten vor Ort',
      slots: { sportToken: 'sport' },
      needBookingLink: false,
      startedAtMs: prevSport?.startedAtMs ?? Date.now(),
    });
    upserted = true;
  }

  if (looksLikeOpenQuest(t)) {
    const familySticky = [...rootsByKind.keys()].some(
      (k) =>
        k === 'taxi_airport' || k === 'table_reserve' || k === 'open_sport',
    );
    // Wunsch-Cues („irgendwie“) dürfen Taxi/Reserve/Sport nicht stehlen
    if (!(familySticky && !looksLikeSituationProblem(t))) {
      const prevQuest = rootsByKind.get('open_quest');
      const hint = extractQuestHint(t);
      upsertRoot({
        kind: 'open_quest',
        rootLabel: prevQuest?.rootLabel || t.slice(0, 160),
        slots: {
          questHints:
            [prevQuest?.slots.questHints, hint]
              .filter(Boolean)
              .join(',')
              .slice(0, 120) || null,
        },
        needBookingLink: /\b(buch|reserv|ticket|link)\b/iu.test(t),
        startedAtMs: prevQuest?.startedAtMs ?? Date.now(),
      });
      upserted = true;
    }
  }

  if (upserted) return getFollowThroughGoal();

  // Follow-up: nur in Roots mergen die zum Satz gehören — sonst Sticky unangetastet
  const candidates = getFollowThroughGoals().filter((g) =>
    shouldPreserveFollowThrough(t, g),
  );
  if (!candidates.length) return getFollowThroughGoal();
  for (const g of candidates) {
    upsertRoot(mergeSlotsIntoGoal(g, t));
  }
  if (candidates.length === 1) {
    focusKind = candidates[0]!.kind;
    schedulePersist();
  }
  return getFollowThroughGoal();
}

/** Kontrolldistanz — Author-Intent: nicht fertig ohne Beleg/Link. */
export function controlDistanceAuthorIntent(opts: {
  needBookingLink?: boolean;
  deepWebThin?: boolean;
  criticalPending?: boolean;
}): string {
  const bits = [
    'Kontrolldistanz: Auftrag erst erfüllt wenn Musts belegt',
    opts.needBookingLink
      ? 'und Buchungs-/Transfer-Link möglichst liefern'
      : null,
    'Prefill intern versuchen wenn Portal es kann — nie in Speech erwähnen (Button still)',
    'sonst weiter suchen oder ehrlich Lücke nennen — nie Fake-„fertig/alles klar“',
    opts.deepWebThin
      ? 'Deep-Web dünn: nicht abschließen, Query schärfen oder Lücke transparent'
      : null,
    opts.criticalPending
      ? 'Kritischer Slot offen → eine Klärfrage, Root-Ziel behalten'
      : null,
  ].filter(Boolean);
  return bits.join('. ');
}

/** Open-World Agent — neue Probleme: inventieren, merken, belegen. */
export function openWorldAgentAuthorIntent(): string {
  return [
    'Open-World: neue Frage selbst in Aufträge+Tools zerlegen (parallel recherchieren)',
    'Root über Zwischenfragen/Gedächtnis behalten bis Lösung sitzt',
    'Nur Treffer die Hard-Musts erfüllen — kein Soft-Fill, keine unpassende Gattung',
    'VERBOTEN: „was meinst du genau?“ / Ambiguity-Meta — still herleiten oder eine kritische Slot-Frage',
    'Nichts unbelegt behaupten; Lücke ehrlich statt Fake-Vorschlag',
  ].join('. ');
}

function stickyAuftragLine(goal: FollowThroughGoal): string {
  try {
    const { formatAuftragStickyBlock } = require('./missionAuftragMemory') as {
      formatAuftragStickyBlock: (
        kind: string,
        mem: FollowThroughGoal['auftrag'],
      ) => string;
    };
    return formatAuftragStickyBlock(goal.kind, goal.auftrag) || '';
  } catch {
    return '';
  }
}

function intentForOneGoal(goal: FollowThroughGoal): string {
  const sticky = stickyAuftragLine(goal);
  if (goal.kind === 'taxi_airport') {
    return [
      sticky || `ROOT behalten: ${goal.rootLabel}`,
      'Erkennung sticky: Wunsch+Tasks+Kontext im Auftrag-Block — nie droppen',
      !goal.slots.flightTime
        ? 'Task 1 zuerst: Abflugzeit/Flugnummer nur wenn Blocker + Startflughafen selbst herleiten'
        : `Abflug bekannt (${goal.slots.flightTime}) — Abflugtafel matchen, Timeline`,
      !goal.slots.luggage || goal.slots.luggage === 'unknown'
        ? 'Gepäck Live-Chips Handgepäck/Aufgabegepäck — nie unterstellen'
        : `Gepäck=${goal.slots.luggage}`,
      goal.slots.originCity &&
      goal.slots.gpsCity &&
      goal.slots.originCity !== goal.slots.gpsCity
        ? `GPS≠Abflugstadt (${goal.slots.gpsCity}≠${goal.slots.originCity}): Anreise-Task ${goal.slots.accessLeg || 'klären'} vor Taxi`
        : 'Leave-by rückwärts belegt',
      'Task 1 fertig → ggf. Anreise → Task Taxi Deep-Link Start+Flughafen+Abholzeit+Personen prefilled',
      controlDistanceAuthorIntent({ needBookingLink: true }),
    ]
      .filter(Boolean)
      .join('. ');
  }
  if (goal.kind === 'table_reserve') {
    return [
      sticky || `ROOT behalten: ${goal.rootLabel}`,
      !goal.slots.cuisineOrVenue
        ? 'Zwischenfrage wo/was essen ok — danach wieder Reservierung'
        : `Richtung ${goal.slots.cuisineOrVenue}`,
      'Nach Venue-Wahl: Reservierungs-URL Just-Do-It',
      'Prefill: TheFork/Quandoo/Widgets oft leeres Formular — bekannte Personen/Zeit in Speech nennen, Root behalten, nie „Formular schon voll“ lügen',
      controlDistanceAuthorIntent({ needBookingLink: true }),
    ].join('. ');
  }
  if (goal.kind === 'open_sport') {
    return [
      sticky || `ROOT: ${goal.rootLabel}`,
      '2–3 konkrete Optionen (Fitness / öffentlicher Sportplatz / Outdoor) mit Distanz — kein Quiz',
      controlDistanceAuthorIntent({ needBookingLink: false }),
    ].join('. ');
  }
  return [
    sticky || `ROOT behalten: ${goal.rootLabel.slice(0, 100)}`,
    goal.slots.questHints ? `Hints: ${goal.slots.questHints}` : null,
    'Aufträge inventieren + Tools nutzen; Zwischenantworten mergen',
    openWorldAgentAuthorIntent(),
    controlDistanceAuthorIntent({ needBookingLink: goal.needBookingLink }),
  ]
    .filter(Boolean)
    .join('. ');
}

export function followThroughAuthorIntent(
  goal: FollowThroughGoal | null,
): string {
  const goals = getFollowThroughGoals();
  if (!goals.length) {
    return goal ? intentForOneGoal(goal) : '';
  }
  if (goals.length === 1) return intentForOneGoal(goals[0]!);
  return [
    `Mehrere offene Roots (${goals.map((g) => g.kind).join('+')}): keinen Strang droppen`,
    ...goals.map((g) => intentForOneGoal(g)),
  ].join('. ');
}

function inventWorkForOne(
  goal: FollowThroughGoal,
  userText: string,
  proximity: Call1ProximityMode,
): Call1WorkItem[] {
  const out: Call1WorkItem[] = [];

  if (goal.kind === 'taxi_airport') {
    const needsFlight =
      /flughafen|airport/i.test(goal.rootLabel) ||
      /\b(flug|flieger|abflug)\b/iu.test(userText);
    const accessLeg = goal.slots.accessLeg || null;

    // GPS≠Abflugstadt → Anreise-Task in die Queue
    let mismatchWork: Call1WorkItem[] = [];
    try {
      const {
        detectOriginGpsMismatch,
        buildOriginAccessWorkChain,
        parseOriginAccessReply,
      } = require('../../services/flights/flightOriginMismatch') as {
        detectOriginGpsMismatch: (o: {
          gpsLat?: number | null;
          gpsLng?: number | null;
          originHint?: string | null;
          userText?: string | null;
        }) => import('../../services/flights/flightOriginMismatch').OriginGpsMismatch;
        buildOriginAccessWorkChain: (o: {
          mismatch: import('../../services/flights/flightOriginMismatch').OriginGpsMismatch;
          flightTaskId?: string;
          taxiTaskId?: string;
          accessLeg?: string | null;
        }) => Array<{
          id: string;
          worker: string;
          brief: string;
          dependsOn?: string | null;
          mustHaves?: string[];
          executeWhen?: 'now' | 'later' | 'on_confirm';
        }> | null;
        parseOriginAccessReply: (s: string) => string | null;
      };
      let gpsLat: number | null = null;
      let gpsLng: number | null = null;
      try {
        const { useGpsStore } = require('../../store/useGpsStore') as {
          useGpsStore: {
            getState: () => { lat: number | null; lng: number | null };
          };
        };
        const g = useGpsStore.getState();
        gpsLat = g.lat;
        gpsLng = g.lng;
      } catch {
        /* soft */
      }
      const parsedLeg = parseOriginAccessReply(userText);
      const leg =
        (parsedLeg as typeof accessLeg) ||
        accessLeg ||
        (goal.slots.originCity ? 'needed' : null);
      const mismatch = detectOriginGpsMismatch({
        gpsLat,
        gpsLng,
        originHint: goal.slots.originCity,
        userText,
      });
      if (mismatch.mismatch || leg === 'hotel' || leg === 'train' || leg === 'needed') {
        const chain = buildOriginAccessWorkChain({
          mismatch: mismatch.mismatch
            ? mismatch
            : {
                mismatch: true,
                gpsAirport: mismatch.gpsAirport,
                statedAirport: mismatch.statedAirport,
                distanceKm: mismatch.distanceKm,
              },
          flightTaskId: needsFlight
            ? goal.slots.flightTime
              ? 'ft_taxi_flight_leaveby'
              : 'ft_taxi_flight'
            : 'ft_taxi_flight',
          taxiTaskId: 'ft_taxi_transfer',
          accessLeg: (leg as 'needed') || 'needed',
        });
        if (chain) {
          mismatchWork = chain.map((w) => ({
            id: w.id,
            worker: w.worker as Call1WorkItem['worker'],
            brief: w.brief,
            proximity,
            executeWhen: w.executeWhen || 'now',
            dependsOn: w.dependsOn ?? null,
            wantBookingLink: w.id === 'taxi' || w.id === 'ft_taxi_transfer',
          }));
        }
      }
    } catch {
      /* soft */
    }

    if (needsFlight && !goal.slots.flightTime) {
      out.push({
        id: 'ft_taxi_flight',
        worker: 'flight',
        brief:
          'Task 1: Flug/Abflug klären → Leave-by — noch kein Taxi bestellen',
        proximity,
        executeWhen: 'now',
      });
      if (mismatchWork.length) {
        out.push(...mismatchWork);
      } else {
        out.push({
          id: 'ft_taxi_transfer',
          worker: 'taxi',
          brief:
            'Task 2 nach Leave-by: Taxi/Uber Deep-Link mit Abholzeit = Leave-by — Just-Do-It, nicht vergessen',
          proximity,
          executeWhen: 'later',
          dependsOn: 'ft_taxi_flight',
          wantBookingLink: true,
        });
      }
    } else {
      const flightId =
        needsFlight && goal.slots.flightTime
          ? 'ft_taxi_flight_leaveby'
          : null;
      if (flightId) {
        out.push({
          id: flightId,
          worker: 'flight',
          brief: `Task 1: Leave-by + Timeline für Abflug ${goal.slots.flightTime} — Gepäck beachten`,
          proximity,
          executeWhen: 'now',
        });
      }
      if (mismatchWork.length) {
        out.push(...mismatchWork.filter((w) => w.id !== flightId));
      } else {
        out.push({
          id: 'ft_taxi_transfer',
          worker: 'taxi',
          brief: needsFlight
            ? 'Task 2: Taxi/Uber Deep-Link — Abholzeit = Leave-by, 2 Optionen, Prefill soweit möglich'
            : `${goal.rootLabel}: 2 Transfer-Optionen (Uber Prefill + Alternative), Stopp einfügen — Originalziel bleibt`,
          proximity,
          executeWhen: 'now',
          dependsOn: flightId,
          wantBookingLink: true,
        });
      }
    }
    return out;
  }

  if (goal.kind === 'table_reserve') {
    out.push({
      id: 'ft_reserve_dining',
      worker: 'dining',
      brief: goal.slots.cuisineOrVenue
        ? `Gastro für Reservierung: ${goal.slots.cuisineOrVenue} — dann Buchungs-URL`
        : 'Gastro pitchen für spätere Reservierung — Root behalten',
      proximity,
      executeWhen: 'now',
    });
    if (
      goal.slots.cuisineOrVenue === 'gewähltes_venue' ||
      /\breservier/iu.test(userText) ||
      /\b(das\s+nehme\s+ich|nehme\s+ich|die\s+erste|nummer\s+[12])\b/iu.test(
        userText,
      )
    ) {
      out.push({
        id: 'ft_reserve_link',
        worker: 'deep_web',
        brief: 'Reservierungs-URL zum gewählten Ort — Prefill nur wenn Portal es annimmt (sonst leeres Formular ok)',
        proximity,
        executeWhen: 'now',
        wantBookingLink: true,
      });
    }
    return out;
  }

  if (goal.kind === 'open_sport') {
    out.push({
      id: 'ft_open_sport_pitch',
      worker: 'pitch',
      brief:
        'Sport vor Ort: 2–3 Optionen (Fitnessstudio / Sportplatz Basketball Volleyball / Outdoor) — Distanz, Just-Do-It',
      proximity: 'here_now',
      executeWhen: 'now',
      must: [
        { key: 'sport', role: 'must', weight: 20 },
        { key: 'fitness', role: 'soft', weight: 12 },
        { key: 'sportplatz', role: 'soft', weight: 12 },
      ],
    });
    return out;
  }

  if (goal.kind === 'open_quest') {
    const hints = goal.slots.questHints || '';
    const mustKeys = extractQuestMustKeys(
      `${goal.rootLabel} ${hints} ${userText}`,
    );
    out.push({
      id: 'ft_open_quest_pitch',
      worker: 'pitch',
      brief: `Open-Quest Root: ${goal.rootLabel.slice(0, 80)} — Lösung zum Problem, nur Must-Fit${hints ? ` (${hints})` : ''}`,
      proximity: 'here_now',
      executeWhen: 'now',
      must: mustKeys.map((key) => ({
        key,
        role: 'must' as const,
        weight: 22,
      })),
    });
    out.push({
      id: 'ft_open_quest_web',
      worker: 'deep_web',
      brief: 'Live-Web Belege/Links zur Quest — nichts erfinden',
      proximity,
      executeWhen: 'now',
      wantBookingLink: goal.needBookingLink,
    });
    if (
      /\b(regen|wetter|draußen|draussen|outdoor)\b/iu.test(
        goal.rootLabel + hints,
      )
    ) {
      out.push({
        id: 'ft_open_quest_weather',
        worker: 'weather',
        brief: 'Wetter-Fit für Open-Quest parallel',
        proximity,
        executeWhen: 'now',
        neededSlots: ['temp_c', 'sky', 'rain_timing'],
      });
    }
    return out;
  }

  return out;
}

function selectGoalsForInvent(userText: string): FollowThroughGoal[] {
  const all = getFollowThroughGoals();
  if (!all.length) return [];
  const t = userText || '';
  const matched: FollowThroughGoal[] = [];
  const push = (kind: FollowThroughKind) => {
    const g = rootsByKind.get(kind);
    if (g && !matched.some((x) => x.kind === kind)) matched.push(g);
  };
  if (looksLikeTaxiAirport(t) || looksLikeTaxiResume(t)) push('taxi_airport');
  if (looksLikeTableReserve(t)) push('table_reserve');
  if (looksLikeOpenSport(t)) push('open_sport');
  if (looksLikeOpenQuest(t) && rootsByKind.has('open_quest')) {
    push('open_quest');
  }
  if (matched.length) return matched;
  const focus = getFollowThroughGoal();
  if (focus && shouldPreserveFollowThrough(userText, focus)) return [focus];
  return [];
}

function refreshAuftragOnGoal(
  goal: FollowThroughGoal,
  work: Call1WorkItem[],
  userText: string,
): void {
  try {
    const {
      buildAuftragMemory,
      appendAuftragKnownBit,
      mirrorAuftragWishToSessionRoot,
    } = require('./missionAuftragMemory') as {
      buildAuftragMemory: (o: {
        kind: FollowThroughKind;
        rootLabel: string;
        slots: FollowThroughGoal['slots'];
        work: Call1WorkItem[];
        needBookingLink: boolean;
        prev?: FollowThroughGoal['auftrag'];
      }) => NonNullable<FollowThroughGoal['auftrag']>;
      appendAuftragKnownBit: (
        mem: FollowThroughGoal['auftrag'],
        bit: string | null,
      ) => FollowThroughGoal['auftrag'];
      mirrorAuftragWishToSessionRoot: (w: string | null) => void;
    };
    let mem = buildAuftragMemory({
      kind: goal.kind,
      rootLabel: goal.rootLabel,
      slots: goal.slots,
      work,
      needBookingLink: goal.needBookingLink,
      prev: goal.auftrag,
    });
    const clockBit = (userText || '').replace(/\s+/g, ' ').trim();
    if (clockBit.length > 0 && clockBit.length <= 48) {
      mem = appendAuftragKnownBit(mem, clockBit) || mem;
    }
    upsertRoot({ ...goal, auftrag: mem });
    mirrorAuftragWishToSessionRoot(mem.wish);
  } catch {
    /* soft */
  }
}

export function inventFollowThroughWork(
  userText: string,
  proximity: Call1ProximityMode,
): Call1WorkItem[] {
  syncFollowThroughGoal(userText);
  const goals = selectGoalsForInvent(userText);
  if (!goals.length) return [];
  const out: Call1WorkItem[] = [];
  const seen = new Set<string>();
  for (const goal of goals) {
    let items = inventWorkForOne(goal, userText, proximity);
    try {
      const { applyMissionGapsToWork } = require('./applyMissionGaps') as {
        applyMissionGapsToWork: (o: {
          userText: string;
          work: Call1WorkItem[];
          proximity?: Call1ProximityMode;
          existingAnchorName?: string | null;
        }) => { work: Call1WorkItem[]; plan: { presence?: unknown; setAnchor?: unknown; gaps: unknown[] } };
      };
      const gapped = applyMissionGapsToWork({
        userText,
        work: items,
        proximity,
        existingAnchorName: goal.auftrag?.anchor?.name ?? null,
      });
      items = gapped.work;
      if (gapped.plan.gaps.length) {
        try {
          const { buildAuftragMemory } = require('./missionAuftragMemory') as {
            buildAuftragMemory: (o: Record<string, unknown>) => FollowThroughGoal['auftrag'];
          };
          const mem = buildAuftragMemory({
            kind: goal.kind,
            rootLabel: goal.rootLabel,
            slots: goal.slots,
            work: items,
            needBookingLink: goal.needBookingLink,
            prev: goal.auftrag,
            presence: gapped.plan.presence ?? null,
            anchor: gapped.plan.setAnchor ?? null,
            gaps: (gapped.plan.gaps as Array<{ kind: string }>).map((g) => ({
              kind: g.kind,
              summary: g.kind,
            })),
          });
          upsertRoot({ ...goal, auftrag: mem });
        } catch {
          /* soft */
        }
      }
    } catch {
      /* soft */
    }
    try {
      const { runMissionTaskLoop } = require('./missionTaskLoop') as {
        runMissionTaskLoop: (o: {
          userText: string;
          wish?: string | null;
          work: Call1WorkItem[];
          auftrag?: FollowThroughGoal['auftrag'];
          flightTime?: string | null;
          luggage?: string | null;
          accessLeg?: string | null;
        }) => { work: Call1WorkItem[] };
      };
      const freshSlots = (rootsByKind.get(goal.kind) || goal).slots;
      items = runMissionTaskLoop({
        userText,
        wish: goal.rootLabel,
        work: items,
        auftrag: (rootsByKind.get(goal.kind) || goal).auftrag,
        flightTime: freshSlots.flightTime ?? null,
        luggage: freshSlots.luggage ?? null,
        accessLeg: freshSlots.accessLeg ?? null,
      }).work;
    } catch {
      /* soft */
    }
    const fresh = rootsByKind.get(goal.kind) || goal;
    refreshAuftragOnGoal(fresh, items, userText);
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/** Alle Sticky-Auftrag-Blöcke (Multi-Root) für Call-1. */
export function getAllAuftragStickyBlocks(): string {
  try {
    const { formatAuftragStickyBlock } = require('./missionAuftragMemory') as {
      formatAuftragStickyBlock: (
        kind: string,
        mem: FollowThroughGoal['auftrag'],
      ) => string;
    };
    return getFollowThroughGoals()
      .map((g) => formatAuftragStickyBlock(g.kind, g.auftrag))
      .filter(Boolean)
      .join('\n')
      .slice(0, 1400);
  } catch {
    return '';
  }
}

/** Deep-Web Ergebnis zu dünn für Buchungs-Need? */
export function isDeepWebTooThin(opts: {
  ok: boolean;
  buttonCount: number;
  wantBookingLink?: boolean;
}): boolean {
  if (!opts.wantBookingLink) return false;
  return !opts.ok || opts.buttonCount < 1;
}

function shouldPreserveFollowThrough(
  userText: string,
  prev: FollowThroughGoal | null,
): boolean {
  if (!prev) return false;
  const t = userText || '';
  if (
    looksLikeTaxiAirport(t) ||
    looksLikeTaxiResume(t) ||
    looksLikeTableReserve(t) ||
    looksLikeOpenSport(t) ||
    looksLikeOpenQuest(t)
  ) {
    return true;
  }
  if (prev.kind === 'taxi_airport') {
    return Boolean(
      extractFlightTimeSlot(t) ||
        extractLuggageSlot(t) ||
        looksLikeTaxiResume(t) ||
        /\b(flug|flieger|boarding|abhol|uber|bolt|welcome\s*pick|gepäck|gepaeck|handgepäck|handgepaeck|terminal|fähre|faehre|bahnhof|zwischenstopp|kreuzfahrt|taxi)\b/iu.test(
          t,
        ) ||
        (/\b(hotel|unterkunft)\b/iu.test(t) && looksLikeTaxiCue(t)),
    );
  }
  // Surprise-Anchor / Presence sticky: Essen danach, Anreise-Follow-up
  if (
    prev.auftrag?.anchor?.name ||
    prev.auftrag?.presence ||
    prev.auftrag?.gaps?.length
  ) {
    if (
      /\b(essen|danach|restaurant|anreise|theater|stück|stueck|ticket|karten)\b/iu.test(
        t,
      )
    ) {
      return true;
    }
  }
  if (prev.kind === 'table_reserve') {
    return Boolean(
      extractCuisineOrVenue(t) ||
        /\b(nehme\s+ich|die\s+erste|nummer\s+[12]|reservier|steak|italiener|sushi|tisch|heute\s+abend|lecker)\b/iu.test(
          t,
        ),
    );
  }
  if (prev.kind === 'open_sport') {
    try {
      const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
        isExplicitNavIntent: (s: string) => boolean;
      };
      if (isExplicitNavIntent(t)) return false;
    } catch {
      /* soft */
    }
    return /\b(sport|fitness|padel|basketball|tennis|halle|platz|volleyball)\b/iu.test(
      t,
    );
  }
  if (prev.kind === 'open_quest') {
    try {
      const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
        isExplicitNavIntent: (s: string) => boolean;
      };
      if (isExplicitNavIntent(t)) return false;
    } catch {
      /* soft */
    }
    if (/\b(vergiss|was\s+anderes|neuer\s+auftrag|egal\s+jetzt)\b/iu.test(t)) {
      return false;
    }
    return (
      looksLikeSituationProblem(t) ||
      Boolean(extractQuestHint(t)) ||
      /\b(eher|lieber|ohne|mit|heute|abend|nah|weiter|das\s+nehme|option|erste|zweite|mehr)\b/iu.test(
        t,
      ) ||
      t.split(/\s+/).filter(Boolean).length <= 14
    );
  }
  return false;
}

/**
 * Bei Topic-/Session-New: Bag nur droppen wenn der Satz zu keinem Root gehört.
 * Compound: Klärung an einem Strang lässt Geschwister-Roots stehen.
 */
export function onTopicBoundaryPreserveFollowThrough(userText: string): void {
  ensureHydrateStarted();
  const prev = getFollowThroughGoals();
  if (prev.length) {
    const anyKeep = prev.some((g) => shouldPreserveFollowThrough(userText, g));
    if (!anyKeep) {
      clearFollowThroughGoal();
    }
  }
  syncFollowThroughGoal(userText);
}
