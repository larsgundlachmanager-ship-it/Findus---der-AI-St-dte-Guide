/**
 * Conversation Threads — SSOT für Themen-Kontinuität.
 * Aktiv = Vordergrund-Kontext; geparkt = resumierbar (auch nach Stunden).
 * Keine Stadt-/Satz-Hardcodes — nur Struktur + Entities.
 */

import * as FileSystem from 'expo-file-system';
import { getCachedUserProfile } from '../userProfileService';
import { useUserProfileStore } from '../../store/useUserProfileStore';
import { foldCityKey } from '../navigation/landmarkAliases';
import {
  looksLikeNewConcreteDestination,
  wantsTaxiRide,
} from '../mobility/taxiRideIntent';

export type ThreadCategory =
  | 'cinema'
  | 'transit'
  | 'dining'
  | 'nav'
  | 'planning'
  | 'emergency'
  | 'poi'
  | 'booking'
  | 'weather'
  | 'memory'
  | 'chat'
  | 'other';

export type ThreadStatus = 'active' | 'parked' | 'closed';

export type ConversationThread = {
  id: string;
  label: string;
  category: ThreadCategory;
  status: ThreadStatus;
  createdAt: number;
  updatedAt: number;
  /** Rollierende Kurzsummary — kein Transcript-Dump */
  summary: string;
  entities: Record<string, string>;
  openLoops: string[];
  lastUserText: string;
  lastAssistantSnippet: string;
  lastIntent: string | null;
  /** Display-Label der Stadt */
  cityHint: string | null;
  /**
   * Harte Partition (foldCityKey). Pflicht — Legacy ohne Key → 'unknown'.
   * Resume/Continue nur bei gleichem cityKey.
   */
  cityKey: string;
};

export type TopicRouteMode = 'continue' | 'new' | 'resume' | 'parallel';

export type TopicRouteDecision = {
  mode: TopicRouteMode;
  thread: ConversationThread;
  /** IDs die gerade geparkt wurden */
  parkedIds: string[];
};

type ThreadStoreState = {
  threads: ConversationThread[];
  foregroundId: string | null;
};

const PATH = `${FileSystem.documentDirectory}findus-conversation-threads.json`;
const MAX_THREADS = 20;
const SOFT_PARK_IDLE_MS = 90 * 60_000;
/** Resume auch nach längerem Idle (User-Beispiel: ~5 h) */
export const THREAD_RESUME_HORIZON_MS = 7 * 24 * 60 * 60_000;

let cache: ThreadStoreState | null = null;
let loaded = false;
let loadPromise: Promise<ThreadStoreState> | null = null;
/** Letztes abgeschlossenes Thema (nach Park/beantworteter Frage). */
let lastClosedTopicMemo: string | null = null;

function nowMs(): number {
  return Date.now();
}

function uid(): string {
  return `th_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Kanonischer Stadt-Key für Partition (nie leer). */
export function normalizeThreadCityKey(
  raw: string | null | undefined,
): string {
  const k = foldCityKey(raw);
  return k || 'unknown';
}

function migrateThread(t: ConversationThread): ConversationThread {
  const hint = t.cityHint?.trim() || null;
  const key =
    (t as ConversationThread & { cityKey?: string }).cityKey ||
    (hint ? foldCityKey(hint) : '') ||
    'unknown';
  return {
    ...t,
    cityHint: hint,
    cityKey: normalizeThreadCityKey(key),
  };
}

function emptyState(): ThreadStoreState {
  return { threads: [], foregroundId: null };
}

async function persist(state: ThreadStoreState): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({
        threads: state.threads.slice(-MAX_THREADS),
        foregroundId: state.foregroundId,
      }),
    );
  } catch {
    /* soft */
  }
}

function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(text: string): string[] {
  const stop = new Set([
    'ich',
    'du',
    'wir',
    'mir',
    'dir',
    'und',
    'oder',
    'der',
    'die',
    'das',
    'ein',
    'eine',
    'einen',
    'mit',
    'nach',
    'zum',
    'zur',
    'von',
    'für',
    'fuer',
    'bitte',
    'mal',
    'noch',
    'kannst',
    'kann',
    'will',
    'willst',
    'wo',
    'was',
    'wie',
    'wann',
    'gibt',
    'es',
    'hier',
    'dort',
    'dazu',
    'mehr',
    'auch',
    'dann',
    'aber',
    'nicht',
    'schon',
    'heute',
    'morgen',
    'finden',
    'suchen',
    'zeig',
    'zeigen',
    'sag',
    'sagen',
  ]);
  return normalizeToken(text)
    .split(' ')
    .filter((t) => t.length >= 3 && !stop.has(t))
    .slice(0, 24);
}

function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let n = 0;
  for (const t of a) if (setB.has(t)) n += 1;
  return n;
}

/** Intent/Text → Kategorie (Blaupause, keine Ortsnamen). */
export function inferThreadCategory(opts: {
  userText: string;
  intent?: string | null;
  subject?: string | null;
}): ThreadCategory {
  const t = (opts.userText || '').toLowerCase();
  const intent = (opts.intent || '').toLowerCase();
  const subject = (opts.subject || '').toLowerCase();
  const blob = `${t} ${subject}`;

  try {
    const { looksLikeStreetAddress } = require('../navigation/streetAddressQuery') as {
      looksLikeStreetAddress: (s: string) => boolean;
    };
    const { looksLikeSpokenCityCorrection } = require('../navigation/navDestCityCorrection') as {
      looksLikeSpokenCityCorrection: (s: string) => boolean;
    };
    if (
      looksLikeStreetAddress(opts.userText) ||
      looksLikeSpokenCityCorrection(opts.userText)
    ) {
      return 'nav';
    }
  } catch {
    /* soft */
  }

  if (intent === 'emergency' || /\b(notfall|rettung|krankenwagen|112|arzt|apotheke)\b/u.test(blob)) {
    return 'emergency';
  }
  if (
    intent === 'gastro' ||
    /\b(essen|restaurant|café|cafe|hunger|speisekarte|gastro|imbiss|pizza|sushi)\b/u.test(blob)
  ) {
    return 'dining';
  }
  if (
    /\b(kino|film|vorstellung|kinoprogramm|leinwand|showtimes?)\b/u.test(blob)
  ) {
    return 'cinema';
  }
  if (
    intent === 'mobility' ||
    wantsTaxiRide(opts.userText) ||
    /\b(taxi|uber|bolt|freenow)\b/u.test(blob)
  ) {
    if (
      /\b(bahn|zug|bus|u-bahn|s-bahn|hafas|verbindung|abfahrt|ankunft|hbf|fahrplan)\b/u.test(
        blob,
      ) &&
      !wantsTaxiRide(opts.userText)
    ) {
      return 'transit';
    }
    return 'nav';
  }
  if (
    /\b(bahn|zug|bus|u-bahn|s-bahn|hafas|verbindung|abfahrt|ankunft|hbf|fahrplan)\b/u.test(
      blob,
    )
  ) {
    return 'transit';
  }
  if (
    intent === 'booking' ||
    /\b(hotel|übernacht|uebernacht|buchen|booking|airbnb|unterkunft)\b/u.test(blob)
  ) {
    return 'booking';
  }
  if (
    /\b(flug|fliegen|flieger|flughafen|airport|boarding)\b/u.test(blob)
  ) {
    return 'transit';
  }
  if (
    intent === 'planning' ||
    /\b(plan|einplanen|eintragen|timeline|itinerary|tagesplan|morgen\s+früh|leave[- ]?by)\b/u.test(blob)
  ) {
    return 'planning';
  }
  if (intent === 'umwelt' || /\b(wetter|regen|sonne|temperatur|jacke|kleidung)\b/u.test(blob)) {
    return 'weather';
  }
  if (intent === 'memory' || /\b(merk\s+dir|erinnerst|was\s+weißt\s+du\s+noch)\b/u.test(blob)) {
    return 'memory';
  }
  if (
    intent === 'mobility' ||
    /\b(route|navigat|führ\s+mich|fuehr\s+mich|bring\s+mich|weg\s+zu)\b/u.test(blob)
  ) {
    return 'nav';
  }
  if (intent === 'knowledge' || /\b(museum|geschichte|denkmal|kirche|schloss|park)\b/u.test(blob)) {
    return 'poi';
  }
  if (intent === 'chat' || /\b(quatsch|plauder|wie\s+geht|alles\s+klar)\b/u.test(blob)) {
    return 'chat';
  }
  return intent ? 'other' : 'other';
}

function buildLabel(opts: {
  category: ThreadCategory;
  subject?: string | null;
  userText: string;
  cityHint?: string | null;
}): string {
  const sub = opts.subject?.trim();
  if (sub && sub.length >= 2 && sub.length <= 48) {
    return sub;
  }
  const catLabel: Record<ThreadCategory, string> = {
    cinema: 'Kino / Film',
    transit: 'ÖPNV / Bahn',
    dining: 'Essen',
    nav: 'Navigation',
    planning: 'Planung',
    emergency: 'Notfall',
    poi: 'Ort / Wissen',
    booking: 'Unterkunft',
    weather: 'Wetter',
    memory: 'Gedächtnis',
    chat: 'Plaudern',
    other: 'Gespräch',
  };
  const base = catLabel[opts.category];
  const city = opts.cityHint?.trim();
  if (city && city.length <= 24) return `${base} · ${city}`;
  const toks = significantTokens(opts.userText).slice(0, 3);
  if (toks.length) return `${base}: ${toks.join(' ')}`.slice(0, 56);
  return base;
}

function extractEntities(opts: {
  userText: string;
  subject?: string | null;
  cityHint?: string | null;
  category: ThreadCategory;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (opts.subject?.trim()) out.subject = opts.subject.trim().slice(0, 80);
  if (opts.cityHint?.trim()) out.city = opts.cityHint.trim().slice(0, 48);

  const t = opts.userText;
  const film =
    t.match(/[„""]([^„""]{2,60})[„""]/)?.[1] ||
    t.match(
      /\b([A-ZÄÖÜ][\wÄÖÜäöüß'’\-]*(?:\s+[A-ZÄÖÜ\d][\wÄÖÜäöüß'’\-]*){0,4})\s+(?:im\s+Kino|schauen|ansehen)/u,
    )?.[1];
  if (film) out.film = film.trim().slice(0, 80);

  const dest = t.match(
    /\b(?:nach|Richtung|bis)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]{2,})?(?:\s+Hbf)?)/u,
  )?.[1];
  if (dest) out.destination = dest.trim().slice(0, 80);

  if (opts.category === 'cinema' && !out.film && opts.subject) {
    out.film = opts.subject.slice(0, 80);
  }
  if (opts.category === 'transit' && !out.destination && opts.subject) {
    out.destination = opts.subject.slice(0, 80);
  }
  return out;
}

function hasAnaphora(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (
    /\b(dort|da|davon|dazu|dahin|dorthin|dasselbe|dieselbe|derselbe|weiter|nochmal|noch\s+mal|mehr\s+dazu|und\s+dann|und\s+jetzt|der\s+andere|die\s+andere|das\s+andere|und\s+der|und\s+die)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(wie\s+weit|wie\s+lange|wie\s+teuer|wie\s+viel|öffnungszeiten|oeffnungszeiten|eintritt|tickets?|geschlossen|geöffnet|geoeffnet)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(und|auch|mehr|weiter|erzähl|erzaehl|wann|wohin|wozu)\b/iu.test(t)) {
    return true;
  }
  return false;
}

/** Neue Blaupause / neuer Chat-Tab — nicht an alten Thread kleben. */
export function looksLikeFreshSessionOpener(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 8) return false;
  if (wantsTaxiRide(t)) return true;
  if (hasAnaphora(t)) return false;
  try {
    const {
      looksLikeExplicitNavOrAddress,
      looksLikeWhereAmIQuery,
      decideTopicCut,
    } = require('../../module2/kernel/turnKernel') as {
      looksLikeExplicitNavOrAddress: (s: string) => boolean;
      looksLikeWhereAmIQuery: (s: string) => boolean;
      decideTopicCut: (o: {
        userText: string;
        openLoop?: string | null;
        lastClosedTopic?: string | null;
        foregroundLabel?: string | null;
      }) => string;
    };
    if (looksLikeExplicitNavOrAddress(t) || looksLikeWhereAmIQuery(t)) return true;
    const ctx = getTopicCutContext();
    const mode = decideTopicCut({
      userText: t,
      openLoop: ctx.openLoop,
      lastClosedTopic: ctx.lastClosedTopic,
      foregroundLabel: ctx.foregroundLabel,
    });
    if (mode === 'weave' || mode === 'continue') return false;
    if (mode === 'new' || mode === 'closed_new') return true;
  } catch {
    /* soft */
  }
  return /\b(?:welche\s+filme|ins\s+kino|kino\s+gehen|kinoprogramm|empfehl\w*.{0,48}\b(?:film|kino)|(?:morgen|heute)\s+abend.{0,40}\b(?:kino|film)|wo\s+(?:kann|gibt).{0,48}\b(?:essen|trinken|restaurant)|ich\s+(?:hab|habe|hätt|haette?)\b.{0,24}\büberlegt|lass\s+uns\b|was\s+geht\s+(?:heute|morgen)|tagesplan|unterkunft|\bhotel\b|friseur|frisör|frisoer|eis\s+(?:essen|wäre|waere)|einplanen|eintragen)\b/iu.test(
    t,
  );
}

/** Offener Auftrag / totes Thema für Kernel-Topic-Cut. */
export function getTopicCutContext(): {
  openLoop: string | null;
  lastClosedTopic: string | null;
  foregroundLabel: string | null;
} {
  const fg = getForegroundThread();
  const openFromLoops = fg?.openLoops[0]?.trim() || null;
  const openFromCat =
    fg && (fg.category === 'nav' || fg.category === 'planning')
      ? fg.label?.trim() || null
      : null;
  return {
    openLoop: openFromLoops || openFromCat,
    lastClosedTopic:
      lastClosedTopicMemo || fg?.entities?.lastClosedTopic || null,
    foregroundLabel: fg?.label?.trim() || null,
  };
}

/** Thema tot: nicht mehr resumierbar, nicht in Welcome/Prompt. */
export function closeThreadsMatchingHint(hint: string): number {
  const q = hint.replace(/\s+/g, ' ').trim().toLowerCase();
  if (q.length < 2) return 0;
  let n = 0;
  mutate((s) => {
    for (const t of s.threads) {
      if (t.status === 'closed') continue;
      const hay = [
        t.label,
        t.summary,
        ...t.openLoops,
        ...Object.values(t.entities),
      ]
        .join(' ')
        .toLowerCase();
      const label = (t.label || '').toLowerCase();
      const hit =
        hay.includes(q) ||
        q.includes(label) ||
        (label.length >= 4 && q.includes(label.slice(0, 12)));
      if (!hit) continue;
      t.status = 'closed';
      t.openLoops = [];
      t.updatedAt = nowMs();
      t.entities = { ...t.entities, retired: '1' };
      n += 1;
      if (s.foregroundId === t.id) s.foregroundId = null;
    }
  });
  return n;
}

export function closeForegroundThread(reason?: string): boolean {
  const fg = getForegroundThread();
  if (!fg) return false;
  mutate((s) => {
    const t = s.threads.find((x) => x.id === fg.id);
    if (!t) return;
    t.status = 'closed';
    t.openLoops = [];
    t.updatedAt = nowMs();
    if (reason) {
      t.entities = { ...t.entities, retiredReason: reason.slice(0, 80) };
    }
    if (s.foregroundId === t.id) s.foregroundId = null;
  });
  return true;
}

/** Frage beantwortet — Loop bleibt wenn Nav/Plan noch offen. */
export function markQuestionClosed(label: string): void {
  const t = label.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!t) return;
  lastClosedTopicMemo = t;
  const fg = getForegroundThread();
  if (!fg) return;
  mutate((s) => {
    const th = s.threads.find((x) => x.id === fg.id);
    if (!th) return;
    th.entities = { ...th.entities, lastClosedTopic: t };
    th.updatedAt = nowMs();
  });
}

/** Cue-Wörter für Rückfragen (ohne reine Längen-Heuristik). */
function hasFollowUpCue(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (wantsTaxiRide(t) || looksLikeNewConcreteDestination(t)) return false;
  return /\b(?:warum|wieso|weshalb|und\s+dann|was\s+noch|mehr\s+dazu|erzähl|erzaehl|geschlossen|wann|wie\s+(?:weit|lange|teuer|viel)|noch\s+mehr|welche\s+uhrzeit|um\s+wie\s*viel|tickets?|davon|dazu|dahin|dorthin|und\s+der|und\s+die|der\s+andere|die\s+andere|öffnungszeiten|oeffnungszeiten|eintritt)\b/iu.test(
    t,
  );
}

/** Kurze Rückfrage im laufenden Blaupausen-Chat. */
export function isLikelyShortFollowUp(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  try {
    const { looksLikeSpokenCityCorrection } = require('../navigation/navDestCityCorrection') as {
      looksLikeSpokenCityCorrection: (s: string) => boolean;
    };
    if (looksLikeSpokenCityCorrection(t)) return false;
  } catch {
    /* soft */
  }
  try {
    const { looksLikeStreetAddress } = require('../navigation/streetAddressQuery') as {
      looksLikeStreetAddress: (s: string) => boolean;
    };
    if (looksLikeStreetAddress(t)) return false;
  } catch {
    /* soft */
  }
  if (hasFollowUpCue(t) || hasAnaphora(t)) return true;
  // Sehr kurz + kein frischer Opener → oft „und dann?“ ohne Cue-Wort
  if (t.length > 0 && t.length <= 36 && !looksLikeFreshSessionOpener(t)) {
    return true;
  }
  return false;
}

/**
 * Mic-Early-Bridge: ohne Thread zu mutieren — Follow-up im offenen Chat → keine Bridge.
 */
export function shouldSuppressEarlyBridge(userText: string): boolean {
  const text = (userText || '').trim();
  if (!text) return true;
  if (looksLikeFreshSessionOpener(text)) return false;
  const fg = getForegroundThread();
  if (!fg) return false;
  const recent = nowMs() - fg.updatedAt < 45 * 60_000;
  if (!recent) return false;
  if (hasAnaphora(text)) return true;
  const category = inferThreadCategory({ userText: text });
  const sameCat =
    fg.category === category ||
    category === 'other' ||
    fg.category === 'other' ||
    category === 'chat';
  if (sameCat && isLikelyShortFollowUp(text)) return true;
  // Frische Cue-/Anapher-Rückfrage — auch bei Kategorie-Mismatch
  if (
    nowMs() - fg.updatedAt < 12 * 60_000 &&
    (hasAnaphora(text) || hasFollowUpCue(text))
  ) {
    return true;
  }
  return false;
}

function wantsExplicitNewTopic(text: string): boolean {
  return /\b(was\s+anderes|anderes\s+thema|neues\s+thema|egal\s+(?:das|davon)|vergiss\s+(?:das|es)|ganz\s+was\s+anderes|zurück\s+zum\s+thema|wechsel(?:n)?\s+(?:wir\s+)?(?:das\s+)?thema)\b/iu.test(
    text,
  );
}

function wantsParallel(text: string): boolean {
  return /\b(auch\s+noch|daneben|parallel|zusätzlich|zusaetzlich|nebenbei|und\s+gleichzeitig)\b/iu.test(
    text,
  );
}

function wantsExplicitResume(text: string): boolean {
  return /\b(nochmal\s+(?:wegen|zu|zum|zur)|wo\s+waren\s+wir|wo\s+war(?:en)?\s+wir|zurück\s+(?:zum|zur|zu)|weiter\s+(?:mit|beim)|erinnerst\s+du\s+(?:dich|noch)|wegen\s+dem|wegen\s+der|wegen\s+des)\b/iu.test(
    text,
  );
}

function scoreResumeMatch(
  thread: ConversationThread,
  userText: string,
): number {
  const age = nowMs() - thread.updatedAt;
  if (age > THREAD_RESUME_HORIZON_MS) return 0;
  const toks = significantTokens(userText);
  const hay = significantTokens(
    [
      thread.label,
      thread.summary,
      ...Object.values(thread.entities),
      thread.lastUserText,
    ].join(' '),
  );
  let score = tokenOverlap(toks, hay) * 3;
  for (const v of Object.values(thread.entities)) {
    const nv = normalizeToken(v);
    if (nv.length >= 3 && normalizeToken(userText).includes(nv)) score += 8;
  }
  if (wantsExplicitResume(userText)) score += 4;
  // Frischere Threads leicht bevorzugen
  if (age < 5 * 60 * 60_000) score += 2;
  return score;
}

async function mirrorOpenThreadsToProfile(
  state: ThreadStoreState,
): Promise<void> {
  try {
    const labels = state.threads
      .filter((t) => t.status === 'active' || t.status === 'parked')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((t) => {
        const loop = t.openLoops[0];
        return loop ? `${t.label}: ${loop}` : t.label;
      })
      .slice(0, 12);
    const profile = getCachedUserProfile();
    if (!profile) return;
    const prev = profile.openThreads ?? [];
    if (
      prev.length === labels.length &&
      prev.every((p, i) => p === labels[i])
    ) {
      return;
    }
    await useUserProfileStore.getState().patchProfile({ openThreads: labels });
  } catch {
    /* soft */
  }
}

function mutate(mutator: (s: ThreadStoreState) => void): ThreadStoreState {
  const state = cache ?? emptyState();
  mutator(state);
  // Cap + drop closed old
  state.threads = state.threads
    .filter((t) => t.status !== 'closed' || nowMs() - t.updatedAt < 48 * 60 * 60_000)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-MAX_THREADS);
  cache = state;
  void persist(state);
  void mirrorOpenThreadsToProfile(state);
  return state;
}

export async function loadConversationThreads(): Promise<ThreadStoreState> {
  if (loaded && cache) return cache;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    loaded = true;
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(PATH);
        const parsed = JSON.parse(raw) as Partial<ThreadStoreState>;
        const threads = Array.isArray(parsed.threads)
          ? (parsed.threads as ConversationThread[])
              .filter(
                (t) =>
                  t && typeof t.id === 'string' && typeof t.label === 'string',
              )
              .map(migrateThread)
          : [];
        cache = {
          threads,
          foregroundId:
            typeof parsed.foregroundId === 'string' ? parsed.foregroundId : null,
        };
        return cache;
      }
    } catch {
      /* fresh */
    }
    cache = emptyState();
    return cache;
  })();
  return loadPromise;
}

export function getConversationThreadsSync(): ThreadStoreState {
  return cache ?? emptyState();
}

export function getForegroundThread(): ConversationThread | null {
  const s = getConversationThreadsSync();
  if (!s.foregroundId) return null;
  return s.threads.find((t) => t.id === s.foregroundId) ?? null;
}

export function listResumableThreads(cityKey?: string | null): ConversationThread[] {
  const s = getConversationThreadsSync();
  const cutoff = nowMs() - THREAD_RESUME_HORIZON_MS;
  const key = cityKey ? normalizeThreadCityKey(cityKey) : null;
  return s.threads
    .filter(
      (t) =>
        (t.status === 'parked' || t.status === 'active') &&
        t.updatedAt >= cutoff &&
        (!key || normalizeThreadCityKey(t.cityKey || t.cityHint) === key),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function parkThread(state: ThreadStoreState, id: string): void {
  const t = state.threads.find((x) => x.id === id);
  if (!t) return;
  if (t.status === 'active') {
    t.status = 'parked';
    if (t.label?.trim()) {
      lastClosedTopicMemo = t.label.trim();
      t.entities = { ...t.entities, lastClosedTopic: t.label.trim() };
    }
  }
  t.updatedAt = nowMs();
}

function activateThread(state: ThreadStoreState, id: string): void {
  for (const t of state.threads) {
    if (t.id === id) {
      t.status = 'active';
      t.updatedAt = nowMs();
    } else if (t.status === 'active') {
      t.status = 'parked';
    }
  }
  state.foregroundId = id;
}

/**
 * Topic-Router: continue | new | resume | parallel.
 * Intent/Subject optional aber empfohlen (nach Intent-Route).
 */
export function routeConversationTopic(opts: {
  userText: string;
  intent?: string | null;
  subject?: string | null;
  cityHint?: string | null;
  /** Pflicht-Partition; fehlt → aus cityHint / unknown */
  cityKey?: string | null;
  /** Call-1 session=new / turns=0 — kein Resume, kein Continue. */
  forceNew?: boolean;
}): TopicRouteDecision {
  const text = (opts.userText || '').trim();
  const cityKey = normalizeThreadCityKey(
    opts.cityKey || opts.cityHint || null,
  );
  const cityHint = opts.cityHint?.trim() || null;
  const category = inferThreadCategory({
    userText: text,
    intent: opts.intent,
    subject: opts.subject,
  });
  const entities = extractEntities({
    userText: text,
    subject: opts.subject,
    cityHint,
    category,
  });
  const fg = getForegroundThread();
  const parkedIds: string[] = [];

  // Soft-park stale foreground
  if (fg && nowMs() - fg.updatedAt > SOFT_PARK_IDLE_MS && !hasAnaphora(text)) {
    mutate((s) => {
      parkThread(s, fg.id);
      if (s.foregroundId === fg.id) s.foregroundId = null;
    });
  }

  const freshFg = getForegroundThread();

  // Call-1 Isolation: session=new → nie geparkten Thread wiederbeleben.
  if (opts.forceNew) {
    if (freshFg) {
      mutate((s) => {
        parkThread(s, freshFg.id);
        parkedIds.push(freshFg.id);
        if (s.foregroundId === freshFg.id) s.foregroundId = null;
      });
    }
  } else {
  const resumable = listResumableThreads(cityKey).filter(
    (t) => t.id !== freshFg?.id,
  );

  // Explicit resume or strong entity match
  let best: { thread: ConversationThread; score: number } | null = null;
  for (const t of resumable) {
    const score = scoreResumeMatch(t, text);
    if (!best || score > best.score) best = { thread: t, score };
  }
  // Härterer Cut: Resume nur bei gleichem cityKey
  const resumeHit =
    best &&
    !looksLikeFreshSessionOpener(text) &&
    normalizeThreadCityKey(best.thread.cityKey || best.thread.cityHint) ===
      cityKey &&
    (wantsExplicitResume(text)
      ? best.score >= 8
      : best.score >= 14);

  if (resumeHit && best) {
    let thread = best.thread;
    mutate((s) => {
      activateThread(s, best!.thread.id);
      const th = s.threads.find((x) => x.id === best!.thread.id);
      if (th) {
        th.category = category !== 'other' ? category : th.category;
        th.entities = { ...th.entities, ...entities };
        th.lastUserText = text.slice(0, 240);
        th.lastIntent = opts.intent ?? th.lastIntent;
        th.cityKey = cityKey;
        if (cityHint) th.cityHint = cityHint;
        th.updatedAt = nowMs();
        thread = { ...th };
      }
    });
    return { mode: 'resume', thread, parkedIds };
  }

  // Continue foreground — nur gleiche Stadt
  if (freshFg) {
    const sameCity =
      normalizeThreadCityKey(freshFg.cityKey || freshFg.cityHint) === cityKey;
    const sameCat =
      freshFg.category === category ||
      category === 'other' ||
      freshFg.category === 'other' ||
      category === 'chat';
    const entityHit =
      tokenOverlap(
        significantTokens(text),
        significantTokens(
          [freshFg.label, ...Object.values(freshFg.entities)].join(' '),
        ),
      ) >= 1 ||
      Object.values(freshFg.entities).some((v) =>
        normalizeToken(text).includes(normalizeToken(v)),
      );
    const recent = nowMs() - freshFg.updatedAt < 45 * 60_000;
    const veryRecent = nowMs() - freshFg.updatedAt < 12 * 60_000;
    const cont =
      sameCity &&
      !wantsExplicitNewTopic(text) &&
      !looksLikeFreshSessionOpener(text) &&
      !wantsTaxiRide(text) &&
      !(looksLikeNewConcreteDestination(text) && !entityHit) &&
      (hasAnaphora(text) ||
        (sameCat && entityHit) ||
        (sameCat && recent && isLikelyShortFollowUp(text)) ||
        (veryRecent && (hasAnaphora(text) || hasFollowUpCue(text))));

    if (cont && !(wantsParallel(text) && !sameCat && !hasAnaphora(text))) {
      let thread = freshFg;
      mutate((s) => {
        const th = s.threads.find((x) => x.id === freshFg.id);
        if (!th) return;
        th.status = 'active';
        s.foregroundId = th.id;
        th.entities = { ...th.entities, ...entities };
        th.lastUserText = text.slice(0, 240);
        th.lastIntent = opts.intent ?? th.lastIntent;
        th.cityKey = cityKey;
        if (cityHint) th.cityHint = cityHint;
        if (category !== 'other' && category !== 'chat') th.category = category;
        th.updatedAt = nowMs();
        thread = { ...th };
      });
      return { mode: 'continue', thread, parkedIds };
    }
  }
  } // !forceNew

  // Parallel: keep previous parked, open new foreground
  const parallel =
    !opts.forceNew &&
    wantsParallel(text) &&
    freshFg &&
    normalizeThreadCityKey(freshFg.cityKey || freshFg.cityHint) === cityKey &&
    (freshFg.category !== category || wantsExplicitNewTopic(text));

  // New topic (default when not continue/resume)
  let created!: ConversationThread;
  mutate((s) => {
    const stillFg = getForegroundThread();
    if (stillFg) {
      parkThread(s, stillFg.id);
      parkedIds.push(stillFg.id);
    }
    // Park other actives
    for (const t of s.threads) {
      if (t.status === 'active' && t.id !== stillFg?.id) {
        parkThread(s, t.id);
        parkedIds.push(t.id);
      }
    }
    const thread: ConversationThread = {
      id: uid(),
      label: buildLabel({
        category,
        subject: opts.subject,
        userText: text,
        cityHint,
      }),
      category,
      status: 'active',
      createdAt: nowMs(),
      updatedAt: nowMs(),
      summary: text.slice(0, 160),
      entities,
      openLoops: [],
      lastUserText: text.slice(0, 240),
      lastAssistantSnippet: '',
      lastIntent: opts.intent ?? null,
      cityHint,
      cityKey,
    };
    s.threads.push(thread);
    s.foregroundId = thread.id;
    created = thread;
  });

  return {
    mode: parallel ? 'parallel' : 'new',
    thread: created,
    parkedIds,
  };
}

const SAID_FACTS_KEY = '_saidFacts';

function factFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** Bereits gesagte Fact-Fingerprints am Vordergrund-Thread (Story-Dedup). */
export function getForegroundSaidFacts(): string[] {
  const fg = getForegroundThread();
  if (!fg) return [];
  const raw = fg.entities[SAID_FACTS_KEY] || '';
  return raw.split('|').map((s) => s.trim()).filter(Boolean);
}

export function appendForegroundSaidFacts(texts: string[]): void {
  const fps = texts.map(factFingerprint).filter((t) => t.length >= 12);
  if (!fps.length) return;
  const fg = getForegroundThread();
  if (!fg) return;
  mutate((s) => {
    const th = s.threads.find((x) => x.id === fg.id);
    if (!th) return;
    const prev = (th.entities[SAID_FACTS_KEY] || '')
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
    const next = [...fps, ...prev.filter((p) => !fps.includes(p))].slice(0, 40);
    th.entities = { ...th.entities, [SAID_FACTS_KEY]: next.join('|') };
    th.updatedAt = nowMs();
  });
}

/** Nach Antwort: Summary + Snippet am Vordergrund-Thread. */
export function commitThreadTurn(opts: {
  userText: string;
  assistantSpeech: string;
  intent?: string | null;
  subject?: string | null;
  cityHint?: string | null;
  cityKey?: string | null;
  openLoop?: string | null;
  /** Fact-Zeilen die als „schon gesagt“ gelten */
  saidFactLines?: string[];
}): ConversationThread | null {
  const fg = getForegroundThread();
  if (!fg) return null;
  const speech = (opts.assistantSpeech || '').replace(/\s+/g, ' ').trim();
  const snippet = speech.slice(0, 180);
  const cityKey = normalizeThreadCityKey(
    opts.cityKey || opts.cityHint || fg.cityKey || fg.cityHint,
  );
  let updated: ConversationThread | null = null;
  mutate((s) => {
    const th = s.threads.find((x) => x.id === fg.id);
    if (!th) return;
    th.lastUserText = opts.userText.slice(0, 240);
    th.lastAssistantSnippet = snippet;
    th.lastIntent = opts.intent ?? th.lastIntent;
    if (opts.subject?.trim()) {
      th.entities = { ...th.entities, subject: opts.subject.trim().slice(0, 80) };
      if (!th.label || th.label.length < 3) {
        th.label = opts.subject.trim().slice(0, 56);
      }
    }
    th.cityKey = cityKey;
    if (opts.cityHint?.trim()) th.cityHint = opts.cityHint.trim();
    else if (!th.cityHint && opts.cityKey) th.cityHint = opts.cityKey.trim().slice(0, 48);
    if (opts.openLoop?.trim()) {
      const loop = opts.openLoop.trim().slice(0, 100);
      th.openLoops = [loop, ...th.openLoops.filter((x) => x !== loop)].slice(0, 5);
    } else {
      try {
        const { looksLikeOpenDestinationCommit } = require('../../module2/kernel/turnKernel') as {
          looksLikeOpenDestinationCommit: (s: string) => boolean;
        };
        if (looksLikeOpenDestinationCommit(opts.userText)) {
          const loop = (opts.subject || opts.userText).trim().slice(0, 100);
          th.openLoops = [loop, ...th.openLoops.filter((x) => x !== loop)].slice(
            0,
            5,
          );
        }
      } catch {
        /* soft */
      }
    }
    const nextSummary = [
      th.label,
      opts.userText.slice(0, 80),
      snippet.slice(0, 100),
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 280);
    th.summary = nextSummary;
    th.updatedAt = nowMs();
    th.status = 'active';
    s.foregroundId = th.id;
    if (opts.saidFactLines?.length) {
      const fps = opts.saidFactLines
        .map(factFingerprint)
        .filter((t) => t.length >= 12);
      const prev = (th.entities[SAID_FACTS_KEY] || '')
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean);
      const next = [...fps, ...prev.filter((p) => !fps.includes(p))].slice(
        0,
        40,
      );
      th.entities = { ...th.entities, [SAID_FACTS_KEY]: next.join('|') };
    }
    updated = { ...th };
  });
  return updated;
}

/** Expliziten „merk für später“-Loop am aktiven Thread. */
export function addOpenLoopToForeground(loop: string): void {
  const t = loop.trim();
  if (!t) return;
  const fg = getForegroundThread();
  if (!fg) {
    routeConversationTopic({ userText: t, intent: 'memory' });
  }
  mutate((s) => {
    const id = s.foregroundId;
    const th = s.threads.find((x) => x.id === id);
    if (!th) return;
    th.openLoops = [t.slice(0, 100), ...th.openLoops.filter((x) => x !== t)].slice(
      0,
      5,
    );
    th.updatedAt = nowMs();
  });
}

/**
 * Prompt-Pack: nur aktiver Thread + knapper Index geparkter Themen.
 * Kein fremder Dialog-Dump. Optional cityKey → nur gleiche Stadt.
 */
export function formatThreadContextForPrompt(opts?: {
  includeParkedIndex?: boolean;
  maxParked?: number;
  cityKey?: string | null;
  /** Max. kürzliche User/Assistant-Paare im Prompt (Call-1 topicScope). */
  maxRecentTurns?: number;
}): string {
  const scopeKey = opts?.cityKey
    ? normalizeThreadCityKey(opts.cityKey)
    : null;
  let fg = getForegroundThread();
  if (
    fg &&
    scopeKey &&
    normalizeThreadCityKey(fg.cityKey || fg.cityHint) !== scopeKey
  ) {
    fg = null;
  }
  const includeParked = opts?.includeParkedIndex !== false;
  const maxParked = opts?.maxParked ?? 3;
  const maxRecent = Math.max(0, Math.min(10, opts?.maxRecentTurns ?? 10));
  const lines: string[] = [
    '=== GESPRÄCHS-THREAD (SSOT — nur dieser Kontext für Kontinuität) ===',
  ];
  if (scopeKey) {
    lines.push(`cityKey=${scopeKey}`);
  }
  if (maxRecent <= 0) {
    lines.push('Kein Verlauf — frischer Start, nicht auf alte Themen beziehen.');
    return lines.join('\n');
  }
  if (!fg) {
    lines.push('Kein aktiver Thread — frischer Start, nicht auf alte Themen beziehen.');
    if (includeParked && maxParked > 0) {
      const parked = listResumableThreads(scopeKey).slice(0, maxParked);
      if (parked.length) {
        lines.push(
          `Geparkt (nur bei klarem Bezug/Resume aufgreifen): ${parked
            .map((t) => t.label)
            .join(' · ')}`,
        );
      }
    }
    lines.push(
      'Regel: Zuerst DIESE Äußerung. Geparktes nur bei klarem Bezug (gleiches Ziel/Thema). Uhrzeit+Tag allein = kein Resume.',
    );
    return lines.join('\n');
  }

  const ageMin = Math.round((nowMs() - fg.updatedAt) / 60_000);
  const ageH = Math.round((nowMs() - fg.updatedAt) / 3_600_000);
  const age =
    ageMin < 90 ? `vor ${ageMin} Min` : `vor ~${Math.max(1, ageH)} h`;
  lines.push(
    `Aktiv: ${fg.label} [${fg.category}] · cityKey=${normalizeThreadCityKey(fg.cityKey || fg.cityHint)} · ${age}`,
  );
  if (fg.summary && maxRecent >= 2) lines.push(`Stand: ${fg.summary}`);
  const ents = Object.entries(fg.entities);
  if (ents.length && maxRecent >= 2) {
    lines.push(
      `Entities: ${ents.map(([k, v]) => `${k}=${v}`).join(', ')}`,
    );
  }
  if (fg.openLoops.length && maxRecent >= 2) {
    lines.push(`Offene Punkte: ${fg.openLoops.slice(0, 3).join('; ')}`);
  }
  // Hartes Limit: bei maxRecent=1 nur letzte User-Zeile; sonst Kurzsnippet.
  if (fg.lastUserText) {
    lines.push(`Letzter User: ${fg.lastUserText.slice(0, maxRecent >= 3 ? 220 : 120)}`);
  }
  if (fg.lastAssistantSnippet && maxRecent >= 2) {
    lines.push(
      `Zuletzt gesagt (kurz): ${fg.lastAssistantSnippet.slice(0, maxRecent >= 3 ? 220 : 100)}`,
    );
  }
  if (includeParked && maxParked > 0 && maxRecent >= 3) {
    const parked = listResumableThreads(scopeKey || fg.cityKey || fg.cityHint)
      .filter((t) => t.id !== fg!.id)
      .slice(0, maxParked);
    if (parked.length) {
      lines.push(
        `Andere offene Themen (Index, nicht mischen): ${parked
          .map((t) => t.label)
          .join(' · ')}`,
      );
    }
  }
  lines.push(
    `Regel: Zuerst DIESE Äußerung. Max ${maxRecent} jüngste Bezugspunkte. Älteres ignorieren. Uhrzeit+Tag allein = kein Resume.`,
  );
  return lines.join('\n');
}

/** Straße/Hausadresse — kein „weitermachen“-Ziel für Welcome-Back. */
function isStreetLikeWelcomeTopic(label: string, category?: ThreadCategory): boolean {
  const t = (label || '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  try {
    const {
      looksLikeStreetAddress,
      parseStreetHouseQuery,
    } = require('../navigation/streetAddressQuery') as {
      looksLikeStreetAddress: (s: string) => boolean;
      parseStreetHouseQuery: (
        s: string,
      ) => { street: string; housenumber: string } | null;
    };
    if (looksLikeStreetAddress(t) || parseStreetHouseQuery(t)) return true;
  } catch {
    /* soft */
  }
  // „Heisterhoop“, „Hauptstraße“ ohne Nummer — oft Nav-Thread-Label
  if (
    category === 'nav' &&
    /\b(?:straße|strasse|str\.?|weg|allee|platz|gasse|ring|damm|hof|hoop)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Für Welcome-Back / Memory: resumierbare Kurzzeilen. */
export function formatResumableThreadsForWelcome(
  max = 3,
  cityKey?: string | null,
): string {
  const list = listResumableThreads(cityKey)
    .filter((t) => !isStreetLikeWelcomeTopic(t.label, t.category))
    .slice(0, max);
  if (!list.length) return '';
  return list
    .map((t) => {
      const agoH = Math.round((nowMs() - t.updatedAt) / 3_600_000);
      const age =
        agoH <= 0 ? 'gerade' : agoH === 1 ? 'vor ~1 h' : `vor ~${agoH} h`;
      const loop = t.openLoops[0] ? ` — ${t.openLoops[0]}` : '';
      return `• ${t.label} (${age})${loop}`;
    })
    .join('\n');
}

/** Place-Name für Query-Rewriter aus Thread-Entities. */
export function threadPlaceHint(): string | null {
  const fg = getForegroundThread();
  if (!fg) return null;
  return (
    fg.entities.subject ||
    fg.entities.place ||
    fg.entities.destination ||
    fg.entities.film ||
    null
  );
}

export function threadTopicHint(): string | null {
  const fg = getForegroundThread();
  if (!fg) return null;
  return fg.label || fg.summary.slice(0, 80) || null;
}

/**
 * Pack/GPS-Stadtwechsel: Foreground parken wenn andere Stadt —
 * neuer Chat startet beim nächsten Turn mit neuem cityKey.
 */
export function parkForegroundOnCitySwitch(nextCityName: string): void {
  const nextKey = normalizeThreadCityKey(nextCityName);
  if (nextKey === 'unknown') return;
  mutate((s) => {
    const fg = s.foregroundId
      ? s.threads.find((t) => t.id === s.foregroundId)
      : null;
    if (!fg) return;
    const prevKey = normalizeThreadCityKey(fg.cityKey || fg.cityHint);
    if (prevKey === nextKey) {
      fg.cityKey = nextKey;
      fg.cityHint = nextCityName.trim().slice(0, 48);
      return;
    }
    parkThread(s, fg.id);
    s.foregroundId = null;
  });
}
