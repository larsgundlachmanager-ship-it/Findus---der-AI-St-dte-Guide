/**
 * Welcome-Back Protocol:
 * - Volle Willkommensnachricht höchstens 1× / 72 h
 * - Nach App-Schließen: Guten Morgen / Tag / Abend nur wenn ≥ 4,5 h Idle
 * - Frühestens 2 h nach Einrichtung (kein „alles klar bei dir“ direkt nach Setup)
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

/** Mind. Pause bevor überhaupt begrüßt wird — darunter keine Begrüßung */
export const LIGHT_GREETING_IDLE_MS = 30 * 60_000;
/** Plan-/Erlebnis-Recall */
export const PLAN_RECALL_IDLE_MS = 3 * 60 * 60_000;
/** Mind. Pause für volle Willkommens-/Tageszeit-Begrüßung */
export const WELCOME_IDLE_MS = 4.5 * 60 * 60_000;
/** „Cool dass du wieder da bist“-Schwelle */
export const LONG_AWAY_IDLE_MS = 6 * 60 * 60_000;
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

  let threadRecall = '';
  try {
    const {
      loadConversationThreads,
      formatResumableThreadsForWelcome,
    } = require('./conversationThreads') as {
      loadConversationThreads: () => Promise<unknown>;
      formatResumableThreadsForWelcome: (max?: number) => string;
    };
    await loadConversationThreads();
    threadRecall = formatResumableThreadsForWelcome(3);
  } catch {
    threadRecall = '';
  }

  if (hasGeminiApiKey()) {
    const prompt = [
      'Du bist Findus — lockerer Reisebegleiter auf Deutsch.',
      isMorning && briefing
        ? 'Schreib GENAU EINEN Morgen-Bericht (max. 95 Wörter). FLOW: Gruß → gestern kurz → heute Highlights → Druck/entspannt → Wetter+Kleidung → ggf. Todos/Reise. Leere Slots stumm. Wortlaut frei.'
        : 'Schreib GENAU EINE kurze Welcome-Back-Begrüßung (max. 42 Wörter).',
      'Regeln:',
      '- Du-Form, natürlich, kein Markdown, kein Emoji-Overkill.',
      '- Nur Belegtes aus KONTEXT — nichts erfinden, nichts Leeres erwähnen.',
      isMorning && briefing
        ? '- Wenn offener Wecker + User schon wach: anerkennen und fragen, ob der Wecker gelöscht werden soll.'
        : '- Referenziere KONKRET etwas aus dem Kontext (Ort, Plan, Hotel, Absicht oder offenes Gesprächsthema).',
      isMorning && briefing
        ? '- Kein Aufsatz. Dicht, natürlich, wie ein guter Reise-Manager am Morgen.'
        : '- Biete an, dort weiterzumachen — als Frage, nicht als Befehl. Bei offenem Thread: direkt anknüpfen.',
      '- Wenn Kontext dünn: freundlich begrüßen und fragen, was heute dran ist.',
      '- Jede Begrüßung soll sich anders anfühlen als die vermiedenen.',
      name ? `User-Name: ${name}` : 'Kein Name.',
      city ? `Aktuelle Stadt: ${city}` : 'Stadt unbekannt.',
      `Bezugstag: ${opts.yesterday}.`,
      threadRecall
        ? `Offene Gesprächsthemen:\n${threadRecall}`
        : '',
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
      `${hey}${place} Kurzer Blick auf den Tag — sag Bescheid, wenn wir starten.`,
    );
  }
  const variants = [
    `${hey}${place} Schön, dass du wieder da bist — wollen wir dort weitermachen, wo wir aufgehört haben?`,
    `${hey}${place} Neuer Anlauf — soll ich kurz anknüpfen an das Letzte?`,
    `${name ? `Hey ${name}!` : 'Hey!'}${place} Bereit für den nächsten Schritt — was steht an?`,
  ];
  const picked =
    variants.find((v) => !opts.avoid.some((a) => normalizeSpeech(v) === a)) ??
    variants[0]!;
  return fallbackSpeech('WelcomeBack-Heuristik', picked);
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
        `${greet}${who}! Frischer Start${place} — worauf hast du Lust?`,
        `${greet}${who}. Schön dich zu sehen${place}. Was steht als Erstes an?`,
        `Moin${who}! Bereit für den Tag${place}?`,
      ];
    case 'midday':
      return [
        `${greet}${who}! Mitten am Tag${place} — brauchst du eine Idee?`,
        `Hey${who}, willkommen zurück${place}. Weiter geht's?`,
        `${greet}${who}. Kurz checken: was machst du als Nächstes?`,
      ];
    case 'evening':
      return [
        `${greet}${who}! Schöner Abend${place} — noch was vor?`,
        `Hey${who}, abends wieder da${place}. Soll ich was vorschlagen?`,
        `${greet}${who}. Entspannen oder noch raus?`,
      ];
    default:
      return [
        `Hey${who} — spät unterwegs${place}? Ich bin da.`,
        `Noch wach${who}? Sag Bescheid, wenn ich helfen soll.`,
        `Na${who}, Mitternachtstour${place}?`,
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
      ? 'länger weg (≥6h): kurzes Wiedersehen + optional Plan-Recall'
      : idle >= PLAN_RECALL_IDLE_MS
        ? 'mittel (≥3h): Tageszeit-Begrüßung + optional was im Plan lag'
        : 'leicht (≥30 Min): nur kurze Tageszeit-Begrüßung, kein langer Welcome';

  let threadRecall = '';
  if (idle >= PLAN_RECALL_IDLE_MS) {
    try {
      const {
        loadConversationThreads,
        formatResumableThreadsForWelcome,
      } = require('./conversationThreads') as {
        loadConversationThreads: () => Promise<unknown>;
        formatResumableThreadsForWelcome: (max?: number) => string;
      };
      await loadConversationThreads();
      threadRecall = formatResumableThreadsForWelcome(3);
    } catch {
      threadRecall = '';
    }
  }

  if (hasGeminiApiKey()) {
    const prompt = [
      'Du bist Findus — lockerer Reisebegleiter auf Deutsch.',
      `FLOW-BLAUPAUSE (${intensity}) — Wortlaut frei, nie festen Satz übernehmen.`,
      `Schreib GENAU EINE kurze ${daypartLabel(part)}-Begrüßung (max. 28 Wörter).`,
      'Du-Form, kein Markdown.',
      opts.userName ? `Name: ${opts.userName}` : 'Kein Name.',
      opts.cityName ? `Stadt: ${opts.cityName}` : '',
      threadRecall
        ? `Offene Gesprächsthemen (höchstens EINS kurz anbieten, nicht alle aufzählen):\n${threadRecall}`
        : '',
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

    const continueAction = {
      type: 'SHOW_MORE' as const,
      label: 'Ja, weitermachen',
      payload: {
        textPrompt:
          'Ja, lass uns dort weitermachen, wo wir aufgehört haben.',
      },
    };

    useFinnusStore.getState().setActiveConciergeCard({
      id: `welcome-back-${Date.now()}`,
      createdAtMs: Date.now(),
      cardTitle: opts.full
        ? daypartNow() === 'morning'
          ? 'Guten Morgen'
          : 'Willkommen zurück'
        : daypartLabel(daypartNow()),
      speechText: speech,
      visualBullets: opts.full
        ? daypartNow() === 'morning'
          ? unfinishedActions.length
            ? ['Gestern offen', 'Heute', 'Wetter']
            : ['Heute', 'Wetter', 'Plan']
          : ['Wieder da', 'Kontext im Blick', 'Weiter?']
        : [daypartLabel(daypartNow())],
      quickActions: opts.full
        ? ([
            ...wakeActions,
            ...unfinishedActions,
            continueAction,
          ] as import('../../types/concierge').QuickAction[]).slice(0, 4)
        : (wakeActions as import('../../types/concierge').QuickAction[]),
    });
  }
  const voice = await getVoiceSettingsForTour();
  await speakAssistantText(speech, {
    voiceId: voice.voiceId,
    speechRate: voice.speechRate,
  });
}

/**
 * Nach Idle ≥ 4,5 h: Tageszeit-Gruß oder (alle 72 h) volle Welcome-Back-Nachricht.
 * Unter 4,5 h Idle: still.
 * Frühestens 2 h nach Einrichtung.
 */
export async function maybeSpeakWelcomeBack(): Promise<boolean> {
  if (speaking || sessionWelcomed) return false;
  if (useFinnusStore.getState().isSimulationMode) return false;

  const profile = getCachedUserProfile();
  if (!profile?.setupComplete) return false;

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

  // < 30 Min → keine Begrüßung
  if (idleMs < LIGHT_GREETING_IDLE_MS) {
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
    if (wantFull) {
      const yesterday =
        state.lastActiveDay && state.lastActiveDay !== today
          ? state.lastActiveDay
          : yesterdayKey();
      const highlights = buildYesterdayHighlights(yesterday);
      let morningBriefing: string | null = null;
      let pendingWakeAtMs: number | null = null;
      if (daypartNow() === 'morning') {
        try {
          const {
            collectMorningBriefingFacts,
            formatMorningBriefingContext,
          } = await import('./morningBriefingContext');
          const facts = collectMorningBriefingFacts({ yesterdayKey: yesterday });
          morningBriefing = formatMorningBriefingContext(facts);
          pendingWakeAtMs = facts.pendingWake?.wakeAtMs ?? null;
        } catch {
          /* soft */
        }
      }
      speech = await composeFullWelcomeSpeech({
        cityName: profile.cityName ?? null,
        userName: profile.firstName ?? null,
        yesterday,
        highlights,
        avoid: state.recentSpeeches,
        morningBriefing,
      });
      // Falls Gemini denselben Text liefert → Daypart-Fallback
      if (wasSaidRecently(state, speech)) {
        speech = await composeDaypartSpeech({
          userName: profile.firstName ?? null,
          cityName: profile.cityName ?? null,
          avoid: state.recentSpeeches,
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

    // Auch leichte Morgen-Begrüßung: Briefing wenn Idle ≥ 3h und Morgen
    if (daypartNow() === 'morning' && idleMs >= PLAN_RECALL_IDLE_MS) {
      try {
        const {
          collectMorningBriefingFacts,
          formatMorningBriefingContext,
        } = await import('./morningBriefingContext');
        const facts = collectMorningBriefingFacts();
        const morningBriefing = formatMorningBriefingContext(facts);
        speech = await composeFullWelcomeSpeech({
          cityName: profile.cityName ?? null,
          userName: profile.firstName ?? null,
          yesterday: yesterdayKey(),
          highlights: buildYesterdayHighlights(yesterdayKey()),
          avoid: state.recentSpeeches,
          morningBriefing,
        });
        await deliverSpeech(speech, {
          full: true,
          card: true,
          pendingWakeAtMs: facts.pendingWake?.wakeAtMs ?? null,
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
      } catch {
        /* fall through to daypart */
      }
    }

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
