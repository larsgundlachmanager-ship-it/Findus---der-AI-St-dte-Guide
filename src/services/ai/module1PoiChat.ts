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
  streamGeminiSentences,
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
import { formatLookCueSpeech } from '../navigation/module1Facing';
import { sentencesFromFullText } from './sentenceStream';
import {
  MODULE1_BRIEF_MAX_CHARS,
  MODULE1_EXPAND_MAX_CHARS,
  MODULE1_MAIN_MAX_CHARS,
  clampModule1MainText,
  extractOfflineGeneralInfo,
  stripModule1ClosingQuestions,
  warnIfMissingOfflineNarration,
} from './singleShotStory';
import { looksLikeActivityVenue } from '../poi/module1LiveCard';
import { getMustSayFactTexts } from '../memory/module1FaqLearn';
import { createDefaultProfile } from '../../types/userProfile';
import {
  detectVenueProgramKind,
  researchVenueProgram,
} from '../research/venueProgramResearch';

function looksLikeLargeAreaVenue(poi: PoiWithFacts): boolean {
  const blob = `${poi.name} ${poi.category ?? ''} ${poi.tags_json ?? ''}`.toLowerCase();
  if (/\b(altstadt|unesco|welterbe|insel|stadtinsel|quartier|viertel|promenade|hauptstraße|hauptstrasse)\b/i.test(blob)) {
    return true;
  }
  try {
    const { approxPolygonAreaM2, parsePolygonJson } = require('../geo/polygon') as {
      approxPolygonAreaM2: (poly: unknown[]) => number;
      parsePolygonJson: (raw: string | null | undefined) => unknown[] | null;
    };
    const poly = parsePolygonJson(poi.polygon_json);
    if (poly && poly.length >= 3) {
      return approxPolygonAreaM2(poly) >= 40_000; // ~200×200 m
    }
  } catch {
    /* soft */
  }
  return false;
}
import { isDeicticPoiQuestion } from '../intent/poiInfoVsNav';
import { isMoreHistoryUtterance } from '../../module2/reboot/packMatchFacts';

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
  /** Beat-Brief aus findusTourDirector — Pflicht nutzen, nichts erfinden. */
  storyBriefBlock?: string | null;
  /** Pref sagt nein, starker User-Hook → Meta ehrlich, Inhalt nur auf den Hook. */
  interestOverride?: { hookText: string; matched: string } | null;
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

async function* streamCallGemini(input: {
  systemInstruction: string;
  contents: Module1ChatTurn[];
  timeoutMs: number;
  task: 'teaser' | 'history_deep';
}): AsyncGenerator<string, void, unknown> {
  if (!hasGeminiApiKey()) return;
  const abortCtrl = new AbortController();
  const timeoutId = setTimeout(() => abortCtrl.abort(), input.timeoutMs);
  try {
    const last = input.contents[input.contents.length - 1];
    const prior = input.contents.slice(0, -1);
    const prompt = last?.parts?.[0]?.text ?? '';
    yield* streamGeminiSentences(prompt, {
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
    /* fallback: caller uses offline text */
  } finally {
    clearTimeout(timeoutId);
  }
}

function commitModule1ModelText(
  session: Module1PoiChatSession,
  input: Module1ChatGenerateInput,
  raw: string,
  userText: string,
): Module1ChatGenerateResult {
  let text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    warnIfMissingOfflineNarration(input.poi);
    const offline = extractOfflineGeneralInfo(input.poi);
    text =
      offline ||
      (input.mode === 'approach'
        ? `Schau ${
            input.lookCue
              ? formatLookCueSpeech(input.lookCue)
              : 'vor dir'
          } — ${input.poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim()}.`
        : 'Netz war gerade weg — offline liegt hier keine fertige Erzählung.');
  }

  if (input.mode === 'arrival' || input.mode === 'deep') {
    text = stripModule1ClosingQuestions(text);
    const storyMode =
      input.profile?.module1StoryMode ??
      getCachedUserProfile()?.module1StoryMode ??
      'full';
    const max =
      input.mode === 'deep'
        ? MODULE1_EXPAND_MAX_CHARS
        : storyMode === 'full'
          ? MODULE1_MAIN_MAX_CHARS
          : MODULE1_BRIEF_MAX_CHARS;
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

async function prepareModule1ChatTurn(
  input: Module1ChatGenerateInput,
): Promise<{
  session: Module1PoiChatSession;
  timeoutMs: number;
  task: 'teaser' | 'history_deep';
  userText: string;
}> {
  await hydrate();
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const session = ensureSession(input.poi, profile);
  const activity = looksLikeActivityVenue(input.poi);
  const programKind = detectVenueProgramKind(input.poi);
  const programVenue = programKind != null;
  const largeAreaVenue = looksLikeLargeAreaVenue(input.poi);
  let mustSay = await getMustSayFactTexts(input.poi);
  let liveProgramBlock: string | null = null;

  // Arrival/Deep an Programm-Venues: aktuelles Programm + Preis (belegt) parallel holen
  if (
    (input.mode === 'arrival' || input.mode === 'deep') &&
    programVenue &&
    hasGeminiApiKey()
  ) {
    try {
      const cityHint =
        (profile as { cityName?: string | null }).cityName ??
        (profile as { cityId?: string | null }).cityId ??
        null;
      const hit = await researchVenueProgram({
        poi: input.poi,
        cityHint,
        timeoutMs: 6_500,
      });
      if (hit?.promptBlock) {
        liveProgramBlock = hit.promptBlock;
        if (hit.bullets.length) {
          mustSay = [...hit.bullets, ...mustSay].slice(0, 8);
        }
        try {
          const { rememberVenueProgramHit } = require('../poi/venueProgramCache') as {
            rememberVenueProgramHit: (
              id: number,
              h: typeof hit,
            ) => void;
          };
          rememberVenueProgramHit(input.poi.id, hit);
        } catch {
          /* soft */
        }
      }
    } catch {
      /* soft — Story ohne Live-Programm */
    }
  }

  // Autonom: Follow-up-Frage ohne Pack-Antwort → Research → Datensatz + Speech
  let researchedFact: string | null = null;
  if (
    input.mode === 'followup' &&
    input.userQuestion?.trim() &&
    input.userQuestion.trim().length >= 5
  ) {
    try {
      const {
        packLikelyAnswersQuestion,
        researchModule1FollowupFact,
      } = await import('../memory/module1FaqLearn');
      if (!packLikelyAnswersQuestion(input.poi, input.userQuestion)) {
        const hit = await researchModule1FollowupFact({
          poi: input.poi,
          question: input.userQuestion,
        });
        if (hit?.factText) {
          researchedFact = hit.factText;
          mustSay = [hit.factText, ...mustSay.filter((x) => x !== hit.factText)].slice(
            0,
            8,
          );
        }
      }
    } catch {
      /* soft */
    }
  }

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
      if (researchedFact) {
        userText += `\n\nVERIFIZIERTER NEUER FAKT (PFLICHT nutzen, nichts erfinden):\n${researchedFact}`;
      }
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
      })}\n\n${buildModule1DeepInstruction({ activityVenue: activity, profile })}`;
    } else {
      userText = `${buildModule1SeedUserMessage({
        poi: input.poi,
        profile,
        mode: 'arrival',
        lookCue: input.lookCue,
        mustSayFacts: mustSay,
      })}\n\n${buildModule1ArrivalInstruction({
        approachAlreadyHeard:
          input.approachAlreadyHeard ?? Boolean(session.approachTeaserText),
        activityVenue: activity,
        programVenue,
        largeAreaVenue,
        profile,
        storyMode: profile.module1StoryMode ?? 'full',
      })}`;
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
      programVenue,
      largeAreaVenue,
      profile,
      storyMode: profile.module1StoryMode ?? 'full',
    });
  } else if (input.mode === 'deep') {
    userText = buildModule1DeepInstruction({ activityVenue: activity, profile });
  } else {
    let placeVerifyBlock: string | null = null;
    const q = input.userQuestion?.trim() || 'Erzähl noch etwas zu diesem Ort.';
    try {
      const {
        userDoubtsCurrentPlace,
        verifyNearestStoryPlace,
        formatPlaceVerifyPromptBlock,
      } = await import('../navigation/placeVerify');
      if (userDoubtsCurrentPlace(q)) {
        const { useFinnusStore } = await import('../../store/useFinnusStore');
        const { lastGpsLat, lastGpsLng, currentPoiId } =
          useFinnusStore.getState();
        if (
          typeof lastGpsLat === 'number' &&
          typeof lastGpsLng === 'number'
        ) {
          const hit = await verifyNearestStoryPlace({
            lat: lastGpsLat,
            lng: lastGpsLng,
            currentPoiId,
          });
          if (hit) placeVerifyBlock = formatPlaceVerifyPromptBlock(hit);
        }
      }
    } catch {
      /* soft */
    }
    userText = buildModule1FollowupInstruction(q, { placeVerifyBlock });
    if (researchedFact) {
      userText += `\n\nVERIFIZIERTER NEUER FAKT (PFLICHT nutzen, nichts erfinden):\n${researchedFact}`;
    }
  }

  if (liveProgramBlock) {
    userText += `\n\n${liveProgramBlock}`;
  }

  const brief = input.storyBriefBlock?.trim();
  if (brief && (input.mode === 'arrival' || input.mode === 'deep')) {
    userText += `\n\nBeat-Fakten (Pflicht nutzen, nichts erfinden):\n${brief}`;
  }

  const override = input.interestOverride;
  if (override && input.mode === 'arrival') {
    userText += `\n\n=== INTEREST-OVERRIDE ===
Hook-Match: „${override.matched}“
Beleg aus Datensatz: ${override.hookText}
1) META (1 kurzer Satz, ehrlich): dieser Ortstyp ist eigentlich nicht sein Ding — sag WARUM du trotzdem auslöst (nur der Hook).
2) Gleicher Aufbau wie Hauptstory, Inhalt NUR auf diesen Hook. Keine Standard-Tour, nichts erfinden.`;
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

  return { session, timeoutMs, task, userText };
}

export async function generateModule1ChatTurn(
  input: Module1ChatGenerateInput,
): Promise<Module1ChatGenerateResult> {
  const prepared = await prepareModule1ChatTurn(input);
  const text = await callGemini({
    systemInstruction: prepared.session.systemInstruction,
    contents: prepared.session.contents,
    timeoutMs: prepared.timeoutMs,
    task: prepared.task,
  });
  return commitModule1ModelText(
    prepared.session,
    input,
    text,
    prepared.userText,
  );
}

type ArrivalPrefetch = { poiId: number; promise: Promise<string> };
let arrivalPrefetch: ArrivalPrefetch | null = null;
const liveArrivalBusy = new Set<number>();

/** Während Wegweiser-TTS: Ankunfts-Story im Hintergrund, damit TTS sofort startet. */
export function prefetchModule1Arrival(
  input: Omit<Module1ChatGenerateInput, 'mode'> & { mode?: 'arrival' },
): void {
  const poiId = input.poi.id;
  if (liveArrivalBusy.has(poiId)) return;
  if (arrivalPrefetch?.poiId === poiId) return;
  arrivalPrefetch = {
    poiId,
    promise: generateModule1ChatTurn({ ...input, mode: 'arrival' })
      .then((r) => r.text.trim())
      .catch(() => ''),
  };
}

async function takePrefetchedArrival(poiId: number): Promise<string | null> {
  const hit = arrivalPrefetch;
  if (!hit || hit.poiId !== poiId) return null;
  arrivalPrefetch = null;
  const text = (await hit.promise).trim();
  return text || null;
}

export async function* streamModule1ChatSentences(
  input: Module1ChatGenerateInput,
): AsyncGenerator<string, void, unknown> {
  if (input.mode === 'arrival' && !input.interestOverride) {
    liveArrivalBusy.add(input.poi.id);
    try {
      const pre = await takePrefetchedArrival(input.poi.id);
      if (pre) {
        yield* sentencesFromFullText(pre);
        return;
      }
    } finally {
      liveArrivalBusy.delete(input.poi.id);
    }
  }

  if (input.mode === 'arrival') liveArrivalBusy.add(input.poi.id);
  try {
    const prepared = await prepareModule1ChatTurn(input);
    const storyMode =
      input.profile?.module1StoryMode ??
      getCachedUserProfile()?.module1StoryMode ??
      'full';
    const maxChars =
      input.mode === 'deep'
        ? MODULE1_EXPAND_MAX_CHARS
        : input.mode === 'arrival'
          ? storyMode === 'full'
            ? MODULE1_MAIN_MAX_CHARS
            : MODULE1_BRIEF_MAX_CHARS
          : null;
    let acc = '';
    for await (const sentence of streamCallGemini({
      systemInstruction: prepared.session.systemInstruction,
      contents: prepared.session.contents,
      timeoutMs: prepared.timeoutMs,
      task: prepared.task,
    })) {
      const next = acc ? `${acc} ${sentence}` : sentence;
      if (maxChars && acc.length >= Math.floor(maxChars * 0.55) && next.length > maxChars) {
        break;
      }
      acc = next;
      yield sentence;
      if (maxChars && acc.length >= maxChars) break;
    }
    const result = commitModule1ModelText(
      prepared.session,
      input,
      acc,
      prepared.userText,
    );
    if (!acc && result.text) {
      yield* sentencesFromFullText(result.text);
    }
  } finally {
    liveArrivalBusy.delete(input.poi.id);
  }
}

/**
 * Landmarken-Hinweis für Wegweiser (Richtung Haltestelle/Kirche… statt nur links/rechts).
 */
async function resolveApproachPathHint(opts: {
  userLat: number;
  userLng: number;
  excludePoiId: number;
  excludeParentId?: number | null;
}): Promise<string | null> {
  try {
    const { getAllPois, haversineMeters } = await import('../../db/database');
    const pois = await getAllPois();
    const exclude = new Set(
      [opts.excludePoiId, opts.excludeParentId ?? -1].filter((n) => n >= 0),
    );
    let best: { name: string; dist: number } | null = null;
    for (const p of pois) {
      if (exclude.has(p.id)) continue;
      const blob = `${p.name} ${p.category ?? ''}`.toLowerCase();
      if (
        !/\b(haltestelle|bahnhof|kirche|dom|brücke|bruecke|markt|rathaus|hafen|tor|platz)\b/i.test(
          blob,
        )
      ) {
        continue;
      }
      const d = haversineMeters(opts.userLat, opts.userLng, p.lat, p.lng);
      if (d < 12 || d > 120) continue;
      const name = (p.name || '')
        .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
        .trim();
      if (name.length < 3) continue;
      if (!best || d < best.dist) best = { name, dist: d };
    }
    return best ? `Richtung ${best.name}` : null;
  } catch {
    return null;
  }
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
    pathHint: await resolveApproachPathHint({
      userLat: input.userLat ?? input.poi.lat,
      userLng: input.userLng ?? input.poi.lng,
      excludePoiId: input.poi.id,
      excludeParentId: input.poi.parent_poi_id,
    }),
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
  if (!looksLikePoiFactQuestion(userText)) return false;

  const t = userText.toLowerCase().replace(/\s+/g, ' ').trim();
  const name = session.poiName
    .toLowerCase()
    .replace(/\s*[·•|]\s*wegweiser\s*$/i, '')
    .replace(/[^a-zäöüß0-9]+/giu, ' ')
    .trim();
  const nameTok = name.split(/\s+/).filter((w) => w.length >= 4);
  if (nameTok.some((w) => t.includes(w))) return true;
  if (ageMs < 20 * 60_000) return true;
  if (
    /\b(wann|warum|wieso|weshalb|wie\s+hoch|wie\s+viele|wer|was\s+kost|eintritt|gebaut|entstand|geschichte|historie|früher|heute|erzähl|mehr\s+(dazu|historie|geschichte)|treppe|stufen|stiege)\b/i.test(
      t,
    ) &&
    ageMs < 2 * 60 * 60_000
  ) {
    return true;
  }
  return false;
}

/** Frage nach Spot-Fakt (auch ohne aktive M1-Session — z. B. currentPoi). */
export function looksLikePoiFactQuestion(userText: string): boolean {
  const t = userText.toLowerCase().replace(/\s+/g, ' ').trim();
  if (t.length < 4) return false;

  try {
    const { isExplicitNavIntent } = require('../intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    if (isExplicitNavIntent(userText)) return false;
  } catch {
    /* soft */
  }
  try {
    const { shouldHandoffToPitchModule } = require('../../module2/pitch/shouldHandoffPitch') as {
      shouldHandoffToPitchModule: (s: string) => boolean;
    };
    if (shouldHandoffToPitchModule(userText)) return false;
  } catch {
    /* soft */
  }
  if (
    /\b(pizza|restaurant|essen|hotel|kino|tour|plan|bäcker|baecker|aldi|lidl|supermarkt)\b/i.test(
      t,
    )
  ) {
    return false;
  }

  if (isDeicticPoiQuestion(userText) || isMoreHistoryUtterance(userText)) {
    return true;
  }

  return /\b(wann|warum|wieso|weshalb|wie\s+hoch|wie\s+viele|wer|was\s+kost|eintritt|gebaut|entstand|geschichte|historie|früher|heute|erzähl|mehr\s+(dazu|historie|geschichte)|treppe|treppen|stufen|stiege|alter|jahr(?:hundert)?|architekt|was\s+ist\s+das|was\s+sehe\s+ich|wie\s+alt|dach|fassade|turm|portal|inschrift|statue|figur|glocke|wappen|kreuz)\b/i.test(
    t,
  );
}
