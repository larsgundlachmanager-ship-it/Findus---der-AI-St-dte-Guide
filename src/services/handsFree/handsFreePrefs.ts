/**
 * Hands-free / Live-Chat Prefs — alles einstellbar.
 */

import * as FileSystem from 'expo-file-system';

export type LiveChatIdleSeconds = 15 | 30 | 45 | 60;

/** In-Ear Play/Pause / Hook */
export type HeadsetButtonMode = 'off' | 'once' | 'livechat';

export type HandsFreePrefs = {
  stickyListenNotification: boolean;
  micStartCue: boolean;
  preferAsDigitalAssistant: boolean;
  /** „Sprechen“ startet Live-Chat statt Einmal-Mikro */
  liveChatOnHandsFree: boolean;
  /** Idle ohne Findus-Adresse → Mikro aus */
  liveChatIdleSeconds: LiveChatIdleSeconds;
  /**
   * false (Default): nach Start/Antwort freie Follow-ups ohne Keyword
   * (z. B. „führ mich dahin“). true: klarere Adressierung nötig.
   */
  requireKeywordEveryTurn: boolean;
  /** Menschlicher Kurz-Ton, Fast-Lane, keine Brief-Antworten */
  humanConversationTone: boolean;
  /** Deep Research erst nach Rückfrage / Button */
  askBeforeDeepResearch: boolean;
  /**
   * In-Ear: aus | einmal Mikro | Live-Chat
   * (wenn Findus die MediaSession hält — nicht während Spotify).
   */
  headsetButtonMode: HeadsetButtonMode;
};

const PATH = `${FileSystem.documentDirectory}findus-handsfree.json`;
const DEFAULTS: HandsFreePrefs = {
  stickyListenNotification: true,
  micStartCue: true,
  preferAsDigitalAssistant: false,
  liveChatOnHandsFree: true,
  liveChatIdleSeconds: 30,
  requireKeywordEveryTurn: false,
  humanConversationTone: true,
  askBeforeDeepResearch: true,
  headsetButtonMode: 'livechat',
};

let cache: HandsFreePrefs | null = null;
let loaded = false;

function clampIdle(n: unknown): LiveChatIdleSeconds {
  if (n === 15 || n === 30 || n === 45 || n === 60) return n;
  return 30;
}

function clampHeadsetMode(
  parsed: Partial<HandsFreePrefs> & { headsetButtonActivates?: boolean },
): HeadsetButtonMode {
  const mode = parsed.headsetButtonMode;
  if (mode === 'off' || mode === 'once' || mode === 'livechat') return mode;
  // Legacy boolean
  if (parsed.headsetButtonActivates === false) return 'off';
  if (parsed.headsetButtonActivates === true) {
    return parsed.liveChatOnHandsFree === false ? 'once' : 'livechat';
  }
  return 'livechat';
}

async function persist(p: HandsFreePrefs): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(p));
  } catch {
    /* soft */
  }
}

function normalize(
  parsed: Partial<HandsFreePrefs> & { headsetButtonActivates?: boolean },
): HandsFreePrefs {
  return {
    stickyListenNotification: parsed.stickyListenNotification !== false,
    micStartCue: parsed.micStartCue !== false,
    preferAsDigitalAssistant: parsed.preferAsDigitalAssistant === true,
    liveChatOnHandsFree: parsed.liveChatOnHandsFree !== false,
    liveChatIdleSeconds: clampIdle(parsed.liveChatIdleSeconds),
    requireKeywordEveryTurn: parsed.requireKeywordEveryTurn === true,
    humanConversationTone: parsed.humanConversationTone !== false,
    askBeforeDeepResearch: parsed.askBeforeDeepResearch !== false,
    headsetButtonMode: clampHeadsetMode(parsed),
  };
}

export async function loadHandsFreePrefs(): Promise<HandsFreePrefs> {
  if (loaded && cache) return cache;
  loaded = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(PATH);
      cache = normalize(
        JSON.parse(raw) as Partial<HandsFreePrefs> & {
          headsetButtonActivates?: boolean;
        },
      );
      return cache;
    }
  } catch {
    /* fresh */
  }
  cache = { ...DEFAULTS };
  return cache;
}

export function getHandsFreePrefsSync(): HandsFreePrefs {
  return cache ?? { ...DEFAULTS };
}

export async function patchHandsFreePrefs(
  patch: Partial<HandsFreePrefs>,
): Promise<HandsFreePrefs> {
  const cur = await loadHandsFreePrefs();
  const next = normalize({ ...cur, ...patch });
  cache = next;
  await persist(next);
  return next;
}
