/**
 * Welcome-Back Protocol:
 * - Volle Willkommensnachricht höchstens 1× / 72 h
 * - Nach App-Schließen: Begrüßung erst ab ≥ 24 h Idle (selber Kalendertag = still)
 * - Kein Chat-Thread-Continue; kein leeres „Womit starten wir?“ — User startet Themen selbst
 * - Nur sprechen bei Substanz: Morgen-Briefing und/oder offener Timeline-Plan
 * - Frühestens 2 h nach Einrichtung
 * - Gesagtes merken → kein identischer Text bei jedem Neustart
 */

import { AppState, type AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { getCachedUserProfile } from '../userProfileService';
import {
  formatUserMemoryForPrompt,
  useUserMemoryStore,
} from '../../store/useUserMemoryStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useSessionPlanStore } from '../../store/useSessionPlanStore';
import {
  speakAssistantText,
  getVoiceSettingsForTour,
} from '../ttsService';

const STATE_PATH = `${FileSystem.documentDirectory}findus-welcome-back.json`;

/**
 * Mind. Pause bevor begrüßt / Vorschläge gemacht werden.
 * Darunter / selber Kalendertag: still (User öffnet App → normal, Themen selbst).
 */
export const LIGHT_GREETING_IDLE_MS = 24 * 60 * 60_000;
/** Timeline-Plan-Recall (gleicher Floor wie Begrüßung) */
export const PLAN_RECALL_IDLE_MS = 24 * 60 * 60_000;
/** Alias / Fallback wenn lastActiveAtMs fehlt — gleiche 24h-Schwelle */
export const WELCOME_IDLE_MS = LIGHT_GREETING_IDLE_MS;
/** „Cool dass du wieder da bist“-Schwelle */
export const LONG_AWAY_IDLE_MS = 48 * 60 * 60_000;
/** Volle Welcome-Back-Nachricht max. alle 72 h */
export const FULL_WELCOME_COOLDOWN_MS = 72 * 60 * 60_000;
/** Nach Einrichtung: kein Welcome-Back / Check-in vor Ablauf */
export const POST_SETUP_QUIET_MS = 2 * 60 * 60_000;
const RECENT_SPEECH_MAX = 8;

type Daypart = 'morning' | 'midday' | 'evening' | 'night';

type WelcomeBackState = {
  lastActiveDay: string | null;
  lastWelcomeDay: string | null;
  /** Wann die App zuletzt in den Hintergrund / geschlossen ging */
  lastActiveAtMs: number | null;
  /** Wann die volle Welcome-Back-Nachricht zuletzt gesprochen wurde */
  lastFullWelcomeAtMs: number | null;
  /** Letzte Begrüßungstexte (normalisiert) — gegen Wiederholung */
  recentSpeeches: string[];
};

let cached: WelcomeBackState | null = null;
let speaking = false;
let sessionWelcomed = false;
let appStateBooted = false;

function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function yesterdayKey(from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - 1);
  return localDayKey(d);
}

function normalizeSpeech(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function daypartNow(d = new Date()): Daypart {
  const h = d.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'midday';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

function daypartLabel(p: Daypart): string {
  switch (p) {
    case 'morning':
      return 'Guten Morgen';
    case 'midday':
      return 'Guten Tag';
    case 'evening':
      return 'Guten Abend';
    default:
      return 'Hey';
  }
}

async function loadState(): Promise<WelcomeBackState> {
  if (cached) return cached;
  try {
    const info = await FileSystem.getInfoAsync(STATE_PATH);
    if (info.exists) {
      const raw = JSON.parse(
        await FileSystem.readAsStringAsync(STATE_PATH),
      ) as Partial<WelcomeBackState>;
      cached = {
        lastActiveDay:
          typeof raw.lastActiveDay === 'string' ? raw.lastActiveDay : null,
        lastWelcomeDay:
          typeof raw.lastWelcomeDay === 'string' ? raw.lastWelcomeDay : null,
        lastActiveAtMs:
          typeof raw.lastActiveAtMs === 'number' ? raw.lastActiveAtMs : null,
        lastFullWelcomeAtMs:
          typeof raw.lastFullWelcomeAtMs === 'number'
            ? raw.lastFullWelcomeAtMs
            : null,
        recentSpeeches: Array.isArray(raw.recentSpeeches)
          ? raw.recentSpeeches.map(String).slice(0, RECENT_SPEECH_MAX)
          : [],
      };
      return cached;
    }
  } catch {
    /* ignore */
  }
  cached = {
    lastActiveDay: null,
    lastWelcomeDay: null,
    lastActiveAtMs: null,
    lastFullWelcomeAtMs: null,
    recentSpeeches: [],
  };
  return cached;
}

async function persist(state: WelcomeBackState): Promise<void> {
  cached = state;
  try {
    await FileSystem.writeAsStringAsync(
      STATE_PATH,
      JSON.stringify(state),
      { encoding: FileSystem.EncodingType.UTF8 },
    );
  } catch (err) {
    console.warn('[welcomeBack] persist failed:', err);
  }
}

function rememberSpeech(
  state: WelcomeBackState,
  speech: string,
): WelcomeBackState {
  const n = normalizeSpeech(speech);
  if (!n) return state;
  const recent = [n, ...state.recentSpeeches.filter((x) => x !== n)].slice(
    0,
    RECENT_SPEECH_MAX,
  );
  return { ...state, recentSpeeches: recent };
}

function wasSaidRecently(state: WelcomeBackState, speech: string): boolean {
  const n = normalizeSpeech(speech);
  return state.recentSpeeches.some(
    (x) => x === n || (n.length > 20 && (x.includes(n) || n.includes(x))),
  );
}

/**
 * Nur offener Timeline-/Session-Plan — keine Chat-Threads (Kathedrale/Tower…).
 * User startet Gesprächsthemen selbst nach App-Öffnen.
 */
function formatOpenTimelinePlanForWelcome(max = 4): string {
  const lines: string[] = [];
  try {
    const plan = useSessionPlanStore.getState().plan;
    if (plan?.active && Array.isArray(plan.stops)) {
      for (const s of plan.stops) {
        if (s.done) continue;
        const label = String(s.label || '').trim();
        if (label) lines.push(label);
        if (lines.length >= max) break;
      }
    }
  } catch {
    /* soft */
  }
  if (lines.length < max) {
    try {
      const { todayDateKey } = require('../../utils/dateKeys') as {
        todayDateKey: () => string;
      };
      const { readFuturePlanSnapshot } = require('../../module2/timeline/futurePlanState') as {
        readFuturePlanSnapshot: () => {
          dayKey?: string;
          stops?: Array<{ title?: string; status?: string; plannedStartMs?: number | null }>;
        };
      };
      const snap = readFuturePlanSnapshot();
      const today = todayDateKey();
      if (snap?.dayKey === today && Array.isArray(snap.stops)) {
        const now = Date.now();
        for (const s of snap.stops) {
          if (s.status === 'done') continue;
          const title = String(s.title || '').trim();
          if (!title) continue;
          if (
            typeof s.plannedStartMs === 'number' &&
            Number.isFinite(s.plannedStartMs) &&
            s.plannedStartMs < now - 30 * 60_000
          ) {
            continue;
          }
          if (lines.some((l) => l.toLowerCase() === title.toLowerCase())) continue;
          lines.push(title);
          if (lines.length >= max) break;
        }
      }
    } catch {
      /* soft */
    }
  }
  if (!lines.length) return '';
  return lines.map((l) => `• ${l}`).join('\n');
}

/** Mark today as active calendar day (ohne Idle-Reset). */
export async function touchActiveDay(): Promise<string> {
  const today = localDayKey();
  const state = await loadState();
  if (state.lastActiveDay !== today) {
    await persist({ ...state, lastActiveDay: today });
  }
  return today;
}

/** Session läuft — Idle-Uhr fürs nächste Schließen/Öffnen. */
export async function markSessionActive(): Promise<void> {
  const state = await loadState();
  await persist({
    ...state,
    lastActiveDay: localDayKey(),
    lastActiveAtMs: Date.now(),
  });
}

/** App geht in Hintergrund / wird geschlossen. */
export async function noteAppBackgrounded(): Promise<void> {
  sessionWelcomed = false;
  const state = await loadState();
  await persist({
    ...state,
    lastActiveDay: localDayKey(),
    lastActiveAtMs: Date.now(),
  });
}

function buildYesterdayHighlights(yesterday: string): string {
  const mem = useUserMemoryStore.getState();
  const sinceIso = `${yesterday}T00:00:00.000`;
  const until = new Date(`${yesterday}T23:59:59.999`).getTime();

  const recent = mem
    .findEntities({ sinceIso })
    .filter((e) => {
      if (!e.visitedAt) return true;
      const t = Date.parse(e.visitedAt);
      return !Number.isFinite(t) || t <= until;
    })
    .slice(0, 8);

  const hotel = mem.getConfirmedHotel();
  const plan = useSessionPlanStore.getState().plan;
  const planHint =
    plan?.active && plan.stops?.length
      ? `Offener Session-Plan: ${plan.stops
          .filter((s) => !s.done)
          .slice(0, 4)
          .map((s) => s.label)
          .join(', ')}`
      : null;

  let unfinishedPlan: string | null = null;
  try {
    const {
      collectUnfinishedYesterday,
    } = require('./morningBriefingContext') as {
      collectUnfinishedYesterday: (key: string) => string[];
    };
    const left = collectUnfinishedYesterday(yesterday);
    if (left.length) {
      unfinishedPlan = `Gestern nicht geschafft (heute vorschlagen): ${left.join(', ')}`;
    }
  } catch {
    unfinishedPlan = null;
  }

  const lines: string[] = [];
  if (hotel) {
    lines.push(`Hotel/Stay: ${hotel.name}`);
  }
  for (const e of recent) {
    lines.push(
      `${e.type}: ${e.name}${e.notes ? ` (${e.notes.slice(0, 60)})` : ''}`,
    );
  }
  if (planHint) lines.push(planHint);
  if (unfinishedPlan) lines.push(unfinishedPlan);

  const memoryBlock = formatUserMemoryForPrompt();
  if (lines.length === 0) {
    return memoryBlock;
  }
  return `Gestern (${yesterday}) — Highlights:
${lines.map((l) => `- ${l}`).join('\n')}

${memoryBlock}`;
}

async function composeFullWelcomeSpeech(opts: {
  cityName: string | null;
  userName: string | null;
  yesterday: string;
  highlights: string;
  avoid: string[];
  morningBriefing?: string | null;
}): Promise<string> {
  const name = opts.userName?.trim() || null;
  const city = opts.cityName?.trim() || null;
  const avoidBlock =
    opts.avoid.length > 0
      ? `Sag NICHT dasselbe wie zuvor. Vermeide diese Formulierungen:\n${opts.avoid
          .slice(0, 5)
          .map((a) => `- ${a.slice(0, 100)}`)
          .join('\n')}`
      : '';

  const isMorning = daypartNow() === 'morning';
  const briefing = opts.morningBriefing?.trim() || '';

  const timelinePlan = formatOpenTimelinePlanForWelcome(4);

  if (hasGeminiApiKey()) {
    const prompt = [
      'Du bist Yorro — lockerer Reisebegleiter auf Deutsch.',
      isMorning && briefing
        ? 'Schreib GENAU EINEN Morgen-Bericht (max. 95 Wörter). FLOW: Gruß → gestern kurz → heute Highlights → Druck/entspannt → Wetter+Kleidung → ggf. Todos/Reise. Leere Slots stumm. Wortlaut frei. Keine Meta („erst sag ich…“, „jetzt zum Wetter“) — flüssig einweben.'
        : 'Schreib GENAU EINE kurze Welcome-Back-Notiz (max. 36 Wörter) — nur wegen offenem Timeline-Plan.',
      'Regeln:',
      '- Du-Form, natürlich, kein Markdown, kein Emoji-Overkill.',
      '- Nur Belegtes aus KONTEXT — nichts erfinden, nichts Leeres erwähnen.',
      isMorning && briefing
        ? '- Wenn offener Wecker + User schon wach: anerkennen und fragen, ob der Wecker gelöscht werden soll.'
        : '- Referenziere KONKRET den offenen Timeline-Plan — NIEMALS Straßennamen/Adressen, NIEMALS alte Chat-Themen als „weitermachen“.',
      isMorning && briefing
        ? '- Kein Aufsatz. Dicht, natürlich, wie ein guter Reise-Manager am Morgen.'
        : '- Kurz den Plan nennen. Keine Fangfrage („womit starten wir?“, „was steht an?“, „worauf hast du Lust?“).',
      '- NIEMALS leere Einladungsfragen („womit starten wir?“, „was soll ich tun?“, „was steht auf dem Plan?“). App-Öffnen = still, User startet Themen.',
      '- Jede Begrüßung soll sich anders anfühlen als die vermiedenen.',
      name ? `User-Name: ${name}` : 'Kein Name.',
      city ? `Aktuelle Stadt: ${city}` : 'Stadt unbekannt.',
      `Bezugstag: ${opts.yesterday}.`,
      timelinePlan
        ? `Offener Timeline-Plan (erwähnen):\n${timelinePlan}`
        : 'Kein offener Timeline-Plan.',
      avoidBlock,
      '',
      'KONTEXT:',
      briefing
        ? briefing.slice(0, 1600)
        : opts.highlights.slice(0, 1200),
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const live = await generateGeminiText(prompt, {
        task: 'generic',
        maxTokens: isMorning && briefing ? 220 : 120,
        temperature: 0.85,
      });
      const cleaned = live
        .replace(/^["„]|["“]$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length >= 12) return cleaned;
    } catch (err) {
      console.warn('[welcomeBack] gemini failed:', err);
    }
  }

  const hey = name ? `Moin ${name}!` : 'Moin!';
  const place = city ? ` Hier in ${city}` : '';
  const { fallbackSpeech } = await import('../debug/fallbackLabel');
  if (isMorning && briefing) {
    return fallbackSpeech(
      'WelcomeBack-Heuristik',
      `${hey}${place} Kurzer Blick auf den Tag — sag Bescheid, wenn du magst.`,
    );
  }
  if (timelinePlan) {
    const first = timelinePlan.split('\n')[0]?.replace(/^•\s*/, '').trim();
    return fallbackSpeech(
      'WelcomeBack-Heuristik',
      first
        ? `${hey}${place} Auf dem Plan steht noch ${first}.`
        : `${hey}${place} Du hast noch etwas Offenes in der Timeline.`,
    );
  }
  return fallbackSpeech(
    'WelcomeBack-Heuristik',
    `${hey}${place} Schön, dass du wieder da bist.`,
  );
}

function buildDaypartFallbacks(opts: {
  part: Daypart;
  userName: string | null;
  cityName: string | null;
}): string[] {
  const name = opts.userName?.trim();
  const city = opts.cityName?.trim();
  const greet = daypartLabel(opts.part);
  const who = name ? ` ${name}` : '';
  const place = city ? ` in ${city}` : '';
  switch (opts.part) {
    case 'morning':
      return [
        `${greet}${who}! Frischer Start${place}.`,
        `${greet}${who}. Schön dich zu sehen${place}.`,
        `Moin${who}! Guten Rutsch in den Tag${place}.`,
      ];
    case 'midday':
      return [
        `${greet}${who}! Mitten am Tag${place}.`,
        `Hey${who}, schön dich wiederzusehen${place}.`,
        `${greet}${who}.`,
      ];
    case 'evening':
      return [
        `${greet}${who}! Schöner Abend${place}.`,
        `Hey${who}, abends wieder da${place}.`,
        `${greet}${who}.`,
      ];
    default:
      return [
        `Hey${who} — spät unterwegs${place}.`,
        `Noch wach${who}? Ich bin da.`,
        `Na${who}, Mitternachtstour${place}.`,
      ];
  }
}

async function composeDaypartSpeech(opts: {
  userName: string | null;
  cityName: string | null;
  avoid: string[];
  idleMs?: number;
}): Promise<string> {
  const part = daypartNow();
  const fallbacks = buildDaypartFallbacks({
    part,
    userName: opts.userName,
    cityName: opts.cityName,
  });
  const pick =
    fallbacks.find((v) => !opts.avoid.includes(normalizeSpeech(v))) ??
    fallbacks[Math.floor(Math.random() * fallbacks.length)]!;

  const idle = opts.idleMs ?? 0;
  const intensity =
    idle >= LONG_AWAY_IDLE_MS
      ? 'länger weg (≥48h): kurzes Wiedersehen; Timeline-Plan nur wenn unten Themen stehen'
      : 'mittel (≥24h): kurze Tageszeit-Begrüßung; Timeline-Plan nur wenn unten Themen stehen';

  const timelinePlan =
    idle >= PLAN_RECALL_IDLE_MS ? formatOpenTimelinePlanForWelcome(3) : '';

  if (hasGeminiApiKey()) {
    const prompt = [
      'Du bist Yorro — lockerer Reisebegleiter auf Deutsch.',
      `FLOW-BLAUPAUSE (${intensity}) — Wortlaut frei, nie festen Satz übernehmen.`,
      `Schreib GENAU EINE kurze ${daypartLabel(part)}-Begrüßung (max. 28 Wörter).`,
      'Du-Form, kein Markdown.',
      'KEINE alten Chat-Themen anbieten (Kathedrale, Tower, Filme…) — User startet Gespräche selbst.',
      'NIEMALS Fangfragen: „womit starten wir?“, „was steht an?“, „worauf hast du Lust?“, „brauchst du eine Idee?“.',
      opts.userName ? `Name: ${opts.userName}` : 'Kein Name.',
      opts.cityName ? `Stadt: ${opts.cityName}` : '',
      timelinePlan
        ? `Offener Timeline-Plan (höchstens EINS kurz erwähnen, keine Frage danach):\n${timelinePlan}`
        : 'Nur knappe Begrüßung — keine Vorschläge, keine Fragen, keine „soll ich …?“-Angebote.',
      opts.avoid.length
        ? `Vermeide diese früheren Formulierungen:\n${opts.avoid
            .slice(0, 4)
            .map((a) => `- ${a.slice(0, 80)}`)
            .join('\n')}`
        : '',
      `Fallback-Idee (variiere stark): ${pick}`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      const live = await generateGeminiText(prompt, {
        task: 'generic',
        maxTokens: 80,
        temperature: 0.95,
      });
      const cleaned = live
        .replace(/^["„]|["“]$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (
        cleaned.length >= 8 &&
        !opts.avoid.includes(normalizeSpeech(cleaned))
      ) {
        return cleaned;
      }
    } catch {
      /* soft */
    }
  }
  const { fallbackSpeech } = await import('../debug/fallbackLabel');
  return fallbackSpeech('WelcomeBack-Daypart', pick);
}

async function deliverSpeech(
  speech: string,
  opts: {
    full: boolean;
    card?: boolean;
    pendingWakeAtMs?: number | null;
  },
): Promise<void> {
  const voice = await getVoiceSettingsForTour();
  // Speech zuerst — Karte/Stichpunkte erst danach (sonst UI vor Audio).
  const speakP = speakAssistantText(speech, {
    voiceId: voice.voiceId,
    speechRate: voice.speechRate,
  });

  useFinnusStore.getState().addChatMessage({
    role: 'assistant',
    content: speech,
  });

  if (opts.card) {
    const wakeActions =
      opts.pendingWakeAtMs != null
        ? [
            {
              type: 'SET_WAKE_ALARM' as const,
              label: 'Wecker löschen',
              payload: {
                dateIso: new Date(opts.pendingWakeAtMs).toISOString(),
                wakeMode: 'cancel' as const,
                replaceWakeAtMs: opts.pendingWakeAtMs,
                destName: 'Wecker',
              },
            },
          ]
        : [];

    let unfinishedActions: Array<{
      type: 'SHOW_MORE';
      label: string;
      payload: { textPrompt: string };
    }> = [];
    try {
      const { dateKeyFromMs } = require('../../utils/dateKeys') as {
        dateKeyFromMs: (ms: number) => string;
      };
      const {
        collectUnfinishedYesterday,
      } = require('./morningBriefingContext') as {
        collectUnfinishedYesterday: (key: string) => string[];
      };
      const y = dateKeyFromMs(Date.now() - 24 * 60 * 60_000);
      const left = collectUnfinishedYesterday(y).slice(0, 2);
      unfinishedActions = left.map((title) => ({
        type: 'SHOW_MORE' as const,
        label: `↩ ${title.slice(0, 22)}`,
        payload: {
          textPrompt: `Lass uns heute nachholen: ${title}. Schlage einen konkreten Plan mit Route vor.`,
        },
      }));
    } catch {
      unfinishedActions = [];
    }

    // Kein „Ja, weitermachen“ für Chat-Threads — User startet Themen selbst.
    // Offener Timeline-Plan: optionaler Chip nur wenn wirklich Stops offen.
    let planContinueAction: {
      type: 'SHOW_MORE';
      label: string;
      payload: { textPrompt: string };
    } | null = null;
    const openPlan = formatOpenTimelinePlanForWelcome(2);
    if (openPlan) {
      planContinueAction = {
        type: 'SHOW_MORE',
        label: 'Plan ansehen',
        payload: {
          textPrompt:
            'Zeig mir kurz meinen offenen Timeline-Plan und was als Nächstes ansteht.',
        },
      };
    }

    const visualBullets = bulletsFromWelcomeSpeech(speech, {
      full: opts.full,
      morning: daypartNow() === 'morning',
      unfinished: unfinishedActions.length > 0,
    });

    useFinnusStore.getState().setActiveConciergeCard({
      id: `welcome-back-${Date.now()}`,
      createdAtMs: Date.now(),
      cardTitle: opts.full
        ? daypartNow() === 'morning'
          ? 'Guten Morgen'
          : 'Willkommen zurück'
        : daypartLabel(daypartNow()),
      speechText: speech,
      visualBullets,
      quickActions: opts.full
        ? ([
            ...wakeActions,
            ...unfinishedActions,
            ...(planContinueAction ? [planContinueAction] : []),
          ] as import('../../types/concierge').QuickAction[]).slice(0, 4)
        : (wakeActions as import('../../types/concierge').QuickAction[]),
    });
  }

  try {
    await speakP;
  } catch (err) {
    console.warn('[welcomeBack] speak failed:', err);
  }
}

/** Stichpunkte aus dem gesprochenen Text — max 3 × ~2 Zeilen, nie Platzhalter. */
function bulletsFromWelcomeSpeech(
  speech: string,
  opts: { full: boolean; morning: boolean; unfinished: boolean },
): string[] {
  const { rewriteBulletToFit, BULLET_SURFACE_MAX_CHARS } =
    require('../concierge/visualBullets') as {
      rewriteBulletToFit: (raw: string, max: number) => string;
      BULLET_SURFACE_MAX_CHARS: { default: number };
    };
  const maxChars = BULLET_SURFACE_MAX_CHARS.default;
  const parts = speech
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.replace(/^["„]|["“.!?]+$/g, '').trim())
    .filter((p) => p.length >= 8);
  const fromSpeech = parts
    .slice(0, 3)
    .map((p) => rewriteBulletToFit(p, maxChars))
    .filter(Boolean);
  if (fromSpeech.length >= 2) return fromSpeech.slice(0, 3);
  if (!opts.full) return [daypartLabel(daypartNow())];
  if (opts.morning) {
    return opts.unfinished
      ? ['Gestern offen', 'Heute', 'Wetter'].slice(0, 3)
      : ['Heute', 'Wetter'].slice(0, 3);
  }
  return fromSpeech.length ? fromSpeech : ['Willkommen zurück'];
}

/**
 * Nach Idle ≥ 24 h (und nicht am selben Kalendertag): nur bei Substanz sprechen
 * (Morgen-Briefing / offener Timeline-Plan) — nie leeres „Womit starten wir?“.
 * Unter 24 h / selber Tag: still — User startet Themen selbst.
 * Frühestens 2 h nach Einrichtung.
 */
export async function maybeSpeakWelcomeBack(): Promise<boolean> {
  if (speaking || sessionWelcomed) return false;
  if (useFinnusStore.getState().isSimulationMode) return false;

  try {
    const { isOpenQuietActive } = require('../navigation/modulePriorityPolicy') as {
      isOpenQuietActive: (n?: number) => boolean;
    };
    if (isOpenQuietActive()) return false;
  } catch {
    /* soft */
  }

  const profile = getCachedUserProfile();
  if (!profile?.setupComplete) return false;
  try {
    const { isProactiveAlertEnabled } = require('../notifications/proactiveAlerts') as {
      isProactiveAlertEnabled: (k: 'welcomeBack', p?: unknown) => boolean;
    };
    if (!isProactiveAlertEnabled('welcomeBack', profile)) return false;
  } catch {
    /* soft */
  }

  const now = Date.now();
  const setupAt = profile.completedAt ? Date.parse(profile.completedAt) : NaN;
  if (Number.isFinite(setupAt) && now - setupAt < POST_SETUP_QUIET_MS) {
    sessionWelcomed = true;
    return false;
  }

  const today = localDayKey();
  const state = await loadState();

  // Erste Session überhaupt — nur stempeln, kein Welcome-Back
  if (state.lastActiveAtMs == null && state.lastFullWelcomeAtMs == null) {
    await persist({
      ...state,
      lastActiveDay: today,
      lastActiveAtMs: now,
    });
    sessionWelcomed = true;
    return false;
  }

  const idleMs =
    state.lastActiveAtMs != null ? now - state.lastActiveAtMs : WELCOME_IDLE_MS;

  // Selber Kalendertag ODER < 24 h → keine Begrüßung, keine Chat-Continues
  if (idleMs < LIGHT_GREETING_IDLE_MS || state.lastActiveDay === today) {
    await persist({
      ...state,
      lastActiveDay: today,
      lastActiveAtMs: now,
    });
    sessionWelcomed = true;
    return false;
  }

  const timelinePlan = formatOpenTimelinePlanForWelcome(4);
  let morningBriefing: string | null = null;
  let pendingWakeAtMs: number | null = null;
  if (daypartNow() === 'morning') {
    try {
      const {
        collectMorningBriefingFacts,
        formatMorningBriefingContext,
      } = await import('./morningBriefingContext');
      const yesterdayHint =
        state.lastActiveDay && state.lastActiveDay !== today
          ? state.lastActiveDay
          : yesterdayKey();
      const facts = collectMorningBriefingFacts({ yesterdayKey: yesterdayHint });
      morningBriefing = formatMorningBriefingContext(facts);
      pendingWakeAtMs = facts.pendingWake?.wakeAtMs ?? null;
    } catch {
      /* soft */
    }
  }

  const hasSubstance = Boolean(
    (morningBriefing && morningBriefing.trim().length >= 12) ||
      (timelinePlan && timelinePlan.trim().length >= 2),
  );
  if (!hasSubstance) {
    // Kein leeres „Hey, womit starten wir?“ — User startet Themen selbst.
    await persist({
      ...state,
      lastActiveDay: today,
      lastActiveAtMs: now,
    });
    sessionWelcomed = true;
    return false;
  }

  const wantFull =
    state.lastFullWelcomeAtMs == null ||
    now - state.lastFullWelcomeAtMs >= FULL_WELCOME_COOLDOWN_MS;

  sessionWelcomed = true;
  speaking = true;
  try {
    let speech: string;
    if (wantFull || (morningBriefing && morningBriefing.trim())) {
      const yesterday =
        state.lastActiveDay && state.lastActiveDay !== today
          ? state.lastActiveDay
          : yesterdayKey();
      const highlights = buildYesterdayHighlights(yesterday);
      speech = await composeFullWelcomeSpeech({
        cityName: profile.cityName ?? null,
        userName: profile.firstName ?? null,
        yesterday,
        highlights,
        avoid: state.recentSpeeches,
        morningBriefing,
      });
      if (wasSaidRecently(state, speech)) {
        speech = await composeFullWelcomeSpeech({
          cityName: profile.cityName ?? null,
          userName: profile.firstName ?? null,
          yesterday,
          highlights,
          avoid: [...state.recentSpeeches, normalizeSpeech(speech)],
          morningBriefing,
        });
      }
      await deliverSpeech(speech, {
        full: true,
        card: true,
        pendingWakeAtMs,
      });
      let next = rememberSpeech(state, speech);
      next = {
        ...next,
        lastActiveDay: today,
        lastWelcomeDay: today,
        lastActiveAtMs: now,
        lastFullWelcomeAtMs: now,
      };
      await persist(next);
      return true;
    }

    // Nur Timeline-Plan: knappe Notiz, keine Fangfrage
    speech = await composeDaypartSpeech({
      userName: profile.firstName ?? null,
      cityName: profile.cityName ?? null,
      avoid: state.recentSpeeches,
      idleMs,
    });
    await deliverSpeech(speech, { full: false, card: false });
    let next = rememberSpeech(state, speech);
    next = {
      ...next,
      lastActiveDay: today,
      lastActiveAtMs: now,
    };
    await persist(next);
    return true;
  } catch (err) {
    console.warn('[welcomeBack] speak failed:', err);
    sessionWelcomed = false;
    return false;
  } finally {
    speaking = false;
  }
}

/** AppState: Background merken, Resume ggf. begrüßen. */
export function bootstrapWelcomeBackAppState(): void {
  if (appStateBooted) return;
  appStateBooted = true;
  let last: AppStateStatus = AppState.currentState;
  AppState.addEventListener('change', (next) => {
    const prev = last;
    last = next;
    if (
      (next === 'background' || next === 'inactive') &&
      prev === 'active'
    ) {
      void noteAppBackgrounded();
      return;
    }
    if (next === 'active' && prev !== 'active') {
      void (async () => {
        const profile = getCachedUserProfile();
        if (!profile?.setupComplete) return;
        await maybeSpeakWelcomeBack();
      })();
    }
  });
}

/** Test / Settings reset */
export async function resetWelcomeBackState(): Promise<void> {
  sessionWelcomed = false;
  await persist({
    lastActiveDay: null,
    lastWelcomeDay: null,
    lastActiveAtMs: null,
    lastFullWelcomeAtMs: null,
    recentSpeeches: [],
  });
}
