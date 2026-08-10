/**
 * Modul-1 POI-Chatfenster — Multi-Turn pro Spot.
 * Seed einmal (System + Datensatz); Folge-Turns nur Instruction.
 */

import * as FileSystem from 'expo-file-system';
import type { PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  generateGeminiText,
  hasGeminiApiKey,
  type GeminiChatTurn,
} from '../geminiService';
import {
  buildModule1ArrivalInstruction,
  buildModule1DeepInstruction,
  buildModule1FollowupInstruction,
  buildModule1SeedUserMessage,
  buildModule1SystemInstruction,
  type Module1ChatMode,
} from './module1PromptBuilders';
import type { Module1LookCue } from '../navigation/module1Facing';
import { extractOfflineGeneralInfo } from './storyService';
import { sentencesFromFullText } from './sentenceStream';
import {
  MODULE1_EXPAND_MAX_CHARS,
  MODULE1_MAIN_MAX_CHARS,
  clampModule1MainText,
} from './singleShotStory';
import { looksLikeActivityVenue } from '../poi/module1LiveCard';
import { getMustSayFactTexts } from '../memory/module1FaqLearn';
import { createDefaultProfile } from '../../types/userProfile';

export type Module1ChatTurn = GeminiChatTurn;

export type Module1PoiChatSession = {
  key: string;
  poiId: number;
  spotKey: string | null;
  poiName: string;
  systemInstruction: string;
  contents: Module1ChatTurn[];
  seeded: boolean;
  approachTeaserText: string | null;
  spokenTranscript: string;
  updatedAtMs: number;
  packFingerprint: string;
};

const PATH = `${FileSystem.documentDirectory}findus-module1-poi-chats.json`;
const MAX_SESSIONS = 24;

type StoreFile = { sessions: Module1PoiChatSession[] };

const memory = new Map<string, Module1PoiChatSession>();
let hydrated = false;

function chatKey(poi: { id: number; spot_key?: string | null }): string {
  const sk = (poi.spot_key ?? '').trim();
  return sk ? `spot:${sk}` : `poi:${poi.id}`;
}

function fingerprint(poi: PoiWithFacts): string {
  const n = (poi.facts ?? []).length;
  const t = (poi.teaser_text ?? '').slice(0, 40);
  return `${poi.id}:${n}:${t}`;
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(PATH);
    const data = JSON.parse(raw) as StoreFile;
    for (const s of data.sessions ?? []) {
      if (s?.key) memory.set(s.key, s);
    }
  } catch {
    /* soft */
  }
}

async function persist(): Promise<void> {
  try {
    const sessions = [...memory.values()]
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, MAX_SESSIONS);
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify({ sessions }));
  } catch {
    /* soft */
  }
}

export function getModule1PoiChat(poi: {
  id: number;
  spot_key?: string | null;
}): Module1PoiChatSession | null {
  return memory.get(chatKey(poi)) ?? null;
}

export function getActiveModule1PoiChat(): Module1PoiChatSession | null {
  let best: Module1PoiChatSession | null = null;
  for (const s of memory.values()) {
    if (!best || s.updatedAtMs > best.updatedAtMs) best = s;
  }
  return best;
}

export async function ensureModule1PoiChatHydrated(): Promise<void> {
  await hydrate();
}

function ensureSession(
  poi: PoiWithFacts,
  profile: UserProfile,
): Module1PoiChatSession {
  const key = chatKey(poi);
  const existing = memory.get(key);
  const fp = fingerprint(poi);
  if (existing && existing.packFingerprint === fp) {
    return existing;
  }
  const session: Module1PoiChatSession = {
    key,
    poiId: poi.id,
    spotKey: poi.spot_key ?? null,
    poiName: poi.name,
    systemInstruction: buildModule1SystemInstruction(profile),
    contents: [],
    seeded: false,
    approachTeaserText: null,
    spokenTranscript: '',
    updatedAtMs: Date.now(),
    packFingerprint: fp,
  };
  memory.set(key, session);
  return session;
}

export type Module1ChatGenerateInput = {
  poi: PoiWithFacts;
  mode: Module1ChatMode;
  profile?: UserProfile | null;
  lookCue?: Module1LookCue | null;
  userQuestion?: string;
  approachAlreadyHeard?: boolean;
  timeoutMs?: number;
};

export type Module1ChatGenerateResult = {
  text: string;
  session: Module1PoiChatSession;
  usedLlm: boolean;
  promptPreview?: string;
};

async function callGemini(input: {
  systemInstruction: string;
  contents: Module1ChatTurn[];
  timeoutMs: number;
  task: 'teaser' | 'history_deep';
}): Promise<string> {
  if (!hasGeminiApiKey()) return '';
  const abortCtrl = new AbortController();
  const timeoutId = setTimeout(() => abortCtrl.abort(), input.timeoutMs);
  try {
    const last = input.contents[input.contents.length - 1];
    const prior = input.contents.slice(0, -1);
    const prompt = last?.parts?.[0]?.text ?? '';
    return await generateGeminiText(prompt, {
      maxTokens: input.task === 'teaser' ? 1024 : 8192,
      temperature: 0.85,
      useFindusSystem: false,
      systemInstruction: input.systemInstruction,
      chatHistory: prior,
      task: input.task,
      allowProEscalate: false,
      signal: abortCtrl.signal,
    });
  } catch {
    return '';
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateModule1ChatTurn(
  input: Module1ChatGenerateInput,
): Promise<Module1ChatGenerateResult> {
  await hydrate();
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const session = ensureSession(input.poi, profile);
  const activity = looksLikeActivityVenue(input.poi);
  const mustSay = await getMustSayFactTexts(input.poi);

  let userText = '';
  let task: 'teaser' | 'history_deep' = 'history_deep';

  if (!session.seeded || session.contents.length === 0) {
    if (input.mode === 'followup' && input.userQuestion) {
      userText = `${buildModule1SeedUserMessage({
        poi: input.poi,
        profile,
        mode: 'arrival',
        lookCue: input.lookCue,
        mustSayFacts: mustSay,
      })}\n\n${buildModule1FollowupInstruction(input.userQuestion)}`;
    } else if (input.mode === 'approach') {
      userText = buildModule1SeedUserMessage({
        poi: input.poi,
        profile,
        mode: 'approach',
        lookCue: input.lookCue,
        mustSayFacts: mustSay,
      });
      task = 'teaser';
    } else if (input.mode === 'deep') {
      userText = `${buildModule1SeedUserMessage({
        poi: input.poi,
        profile,
        mode: 'arrival',
        lookCue: input.lookCue,
        mustSayFacts: mustSay,
      })}\n\n${buildModule1DeepInstruction({ activityVenue: activity })}`;
    } else {
      userText = buildModule1SeedUserMessage({
        poi: input.poi,
        profile,
        mode: 'arrival',
        lookCue: input.lookCue,
        mustSayFacts: mustSay,
      });
    }
    session.systemInstruction = buildModule1SystemInstruction(profile, {
      deepDive: input.mode === 'deep',
    });
    session.contents = [];
    session.seeded = true;
  } else if (input.mode === 'approach') {
    userText = buildModule1SeedUserMessage({
      poi: input.poi,
      profile,
      mode: 'approach',
      lookCue: input.lookCue,
      mustSayFacts: mustSay,
    });
    task = 'teaser';
  } else if (input.mode === 'arrival') {
    userText = buildModule1ArrivalInstruction({
      approachAlreadyHeard:
        input.approachAlreadyHeard ?? Boolean(session.approachTeaserText),
      activityVenue: activity,
    });
  } else if (input.mode === 'deep') {
    userText = buildModule1DeepInstruction({ activityVenue: activity });
  } else {
    userText = buildModule1FollowupInstruction(
      input.userQuestion?.trim() || 'Erzähl noch etwas zu diesem Ort.',
    );
  }

  if (__DEV__) {
    console.log(
      `[module1PoiChat] mode=${input.mode} turns=${session.contents.length} preview=${userText.slice(0, 160).replace(/\n/g, ' ')}`,
    );
  }

  session.contents.push({ role: 'user', parts: [{ text: userText }] });

  const timeoutMs =
    input.timeoutMs ??
    (input.mode === 'approach'
      ? 12_000
      : input.mode === 'followup'
        ? 28_000
        : input.mode === 'deep'
          ? 40_000
          : 28_000);

  let text = await callGemini({
    systemInstruction: session.systemInstruction,
    contents: session.contents,
    timeoutMs,
    task,
  });

  text = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    const offline = extractOfflineGeneralInfo(input.poi);
    text =
      offline ||
      (input.mode === 'approach'
        ? `Schau ${input.lookCue?.lookPhrase ?? 'vor dir'} — ${input.poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim()}.`
        : 'Netz war gerade weg — offline liegt hier keine fertige Erzählung.');
  }

  if (input.mode === 'arrival' || input.mode === 'deep') {
    const max =
      input.mode === 'deep'
        ? MODULE1_EXPAND_MAX_CHARS
        : MODULE1_MAIN_MAX_CHARS;
    text = clampModule1MainText(text, max);
  }

  session.contents.push({ role: 'model', parts: [{ text }] });
  session.spokenTranscript = [session.spokenTranscript, text]
    .filter(Boolean)
    .join('\n')
    .slice(-12_000);
  if (input.mode === 'approach') {
    session.approachTeaserText = text;
  }
  session.updatedAtMs = Date.now();
  memory.set(session.key, session);
  void persist();

  return {
    text,
    session,
    usedLlm: hasGeminiApiKey(),
    promptPreview: __DEV__ ? userText : undefined,
  };
}

export async function* streamModule1ChatSentences(
  input: Module1ChatGenerateInput,
): AsyncGenerator<string, void, unknown> {
  const result = await generateModule1ChatTurn(input);
  yield* sentencesFromFullText(result.text);
}

/**
 * Einziger Wegweiser-Einstieg (Prefetch / Flow A / Teaser-Watch).
 * Seedet den POI-Chat + Code-lookPhrase.
 */
export async function generateModule1ApproachSpeech(input: {
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  userLat?: number | null;
  userLng?: number | null;
  deviceHeadingDeg?: number | null;
  speedMs?: number | null;
}): Promise<{
  text: string;
  lookCue: Module1LookCue;
  skipped: boolean;
  session: Module1PoiChatSession;
}> {
  const { resolveModule1LookCue } = await import(
    '../navigation/module1Facing'
  );
  const { getPoiWithFacts } = await import('../../db/database');
  let hauptLat = input.poi.lat;
  let hauptLng = input.poi.lng;
  if (input.poi.parent_poi_id != null) {
    try {
      const parent = await getPoiWithFacts(input.poi.parent_poi_id);
      if (parent) {
        hauptLat = parent.lat;
        hauptLng = parent.lng;
      }
    } catch {
      /* soft */
    }
  }
  const lookCue = resolveModule1LookCue({
    userLat: input.userLat ?? input.poi.lat,
    userLng: input.userLng ?? input.poi.lng,
    hauptLat,
    hauptLng,
    speedMs: input.speedMs,
    deviceHeadingDeg: input.deviceHeadingDeg,
  });
  if (lookCue.shouldSkipTrigger) {
    const session =
      getModule1PoiChat(input.poi) ??
      ({
        key: '',
        poiId: input.poi.id,
        spotKey: input.poi.spot_key ?? null,
        poiName: input.poi.name,
        systemInstruction: '',
        contents: [],
        seeded: false,
        approachTeaserText: null,
        spokenTranscript: '',
        updatedAtMs: Date.now(),
        packFingerprint: '',
      } satisfies Module1PoiChatSession);
    return { text: '', lookCue, skipped: true, session };
  }
  const chat = await generateModule1ChatTurn({
    poi: input.poi,
    mode: 'approach',
    profile: input.profile,
    lookCue,
  });
  return {
    text: chat.text,
    lookCue,
    skipped: false,
    session: chat.session,
  };
}

export function module1FollowupFitsChat(
  userText: string,
  session: Module1PoiChatSession | null,
): boolean {
  if (!session) return false;
  const ageMs = Date.now() - session.updatedAtMs;
  if (ageMs > 6 * 60 * 60_000) return false;
  const t = userText.toLowerCase().replace(/\s+/g, ' ').trim();
  if (t.length < 4) return false;
  const name = session.poiName
    .toLowerCase()
    .replace(/\s*[·•|]\s*wegweiser\s*$/i, '')
    .replace(/[^a-zäöüß0-9]+/giu, ' ')
    .trim();
  const nameTok = name.split(/\s+/).filter((w) => w.length >= 4);
  if (nameTok.some((w) => t.includes(w))) return true;
  if (
    /\b(wann|warum|wieso|weshalb|wie\s+hoch|wer|was\s+kost|eintritt|gebaut|entstand|geschichte|historie|früher|heute|erzähl|mehr\s+(dazu|historie|geschichte))\b/i.test(
      t,
    ) &&
    ageMs < 2 * 60 * 60_000
  ) {
    return true;
  }
  if (
    /\b(der|die|das|dieser|diese|dort|hier)\b/i.test(t) &&
    ageMs < 20 * 60_000 &&
    /\?|wie|was|wann|warum|wieso|erzähl/i.test(t)
  ) {
    return true;
  }
  return false;
}
