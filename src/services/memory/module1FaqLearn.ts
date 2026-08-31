/**
 * Modul-1 FAQ-Lernen:
 * - Verifizierte Recherche-Fakten sofort in geteilten Store (alle User via Sync-Queue)
 * - askCount; must_say / „fett“ erst ab 3 verschiedenen Usern
 * - Geschmackssignale sammeln; Steuerung erst ab 150 User × 15 Fragen
 */

import * as FileSystem from 'expo-file-system';
import type { PoiWithFacts } from '../../db/types';
import { getCachedUserProfile } from '../userProfileService';
import { runWebResearch } from '../research/webResearchService';
import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { scheduleImmediateCommunityCachePush } from '../sync/nightlyCacheSync';

const PATH = `${FileSystem.documentDirectory}findus-module1-faq-learn.json`;

export const MODULE1_MUST_SAY_MIN_USERS = 3;
/** Geschmacksprofile Auto-ON */
export const TASTE_PROFILE_MIN_USERS = 150;
export const TASTE_PROFILE_MIN_QUESTIONS_PER_USER = 15;

export type FaqFactEntry = {
  id: string;
  poiKey: string;
  poiId: number | null;
  poiName: string;
  questionCluster: string;
  factText: string;
  sourceUrl: string | null;
  confidence: 'high' | 'medium' | 'low';
  askUserIds: string[];
  askCount: number;
  mustSay: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  synced: boolean;
};

export type TasteSignal = {
  userId: string;
  questionCount: number;
  lastAtMs: number;
  /** grobe Tags: numbers | people | scandal | food | activity | other */
  tags: Record<string, number>;
};

type StoreFile = {
  facts: FaqFactEntry[];
  taste: TasteSignal[];
};

let cache: StoreFile | null = null;

function empty(): StoreFile {
  return { facts: [], taste: [] };
}

async function load(): Promise<StoreFile> {
  if (cache) return cache;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) {
      cache = empty();
      return cache;
    }
    const raw = await FileSystem.readAsStringAsync(PATH);
    const data = JSON.parse(raw) as StoreFile;
    cache = {
      facts: Array.isArray(data.facts) ? data.facts : [],
      taste: Array.isArray(data.taste) ? data.taste : [],
    };
    return cache;
  } catch {
    cache = empty();
    return cache;
  }
}

async function save(state: StoreFile): Promise<void> {
  cache = state;
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(state));
  } catch {
    /* soft */
  }
}

function poiKeyOf(poi: { id: number; spot_key?: string | null; name: string }): string {
  const sk = (poi.spot_key ?? '').trim();
  return sk || `poi:${poi.id}`;
}

function clusterKey(question: string): string {
  return question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function resolveUserId(): string {
  const p = getCachedUserProfile();
  const id =
    (p as { userId?: string } | null)?.userId ||
    p?.firstName?.trim() ||
    'local';
  return `u_${id.toLowerCase().replace(/\s+/g, '_').slice(0, 40)}`;
}

function tagQuestion(q: string): string {
  const t = q.toLowerCase();
  if (/\b(hoch|meter|höhe|hoehe|preis|kost|€|jahr|wann|alter)\b/i.test(t)) {
    return 'numbers';
  }
  if (/\b(wer|person|könig|architekt|erbauer|berühm)\b/i.test(t)) {
    return 'people';
  }
  if (/\b(skandal|krieg|brand|legende|geheim|mord)\b/i.test(t)) {
    return 'scandal';
  }
  if (/\b(essen|restaurant|café|cafe|trinken|bier)\b/i.test(t)) {
    return 'food';
  }
  if (/\b(mach|ticket|tour|wasserski|sport|buch)\b/i.test(t)) {
    return 'activity';
  }
  return 'other';
}

export async function recordTasteQuestionSignal(question: string): Promise<void> {
  const state = await load();
  const userId = resolveUserId();
  const tag = tagQuestion(question);
  let row = state.taste.find((t) => t.userId === userId);
  if (!row) {
    row = { userId, questionCount: 0, lastAtMs: Date.now(), tags: {} };
    state.taste.push(row);
  }
  row.questionCount += 1;
  row.lastAtMs = Date.now();
  row.tags[tag] = (row.tags[tag] ?? 0) + 1;
  await save(state);
}

/** true wenn ≥150 User mit je ≥15 Fragen — Geschmack darf steuern. */
export async function tasteProfilesUnlocked(): Promise<boolean> {
  const state = await load();
  const ripe = state.taste.filter(
    (t) => t.questionCount >= TASTE_PROFILE_MIN_QUESTIONS_PER_USER,
  );
  return ripe.length >= TASTE_PROFILE_MIN_USERS;
}

export async function getMustSayFactTexts(
  poi: { id: number; spot_key?: string | null; name?: string },
): Promise<string[]> {
  const state = await load();
  const key = poiKeyOf({
    id: poi.id,
    spot_key: poi.spot_key,
    name: poi.name ?? '',
  });
  // mustSay (≥3 User) zuerst; danach alle gelernten Fakten (Gerät wächst sofort)
  const rows = state.facts
    .filter((f) => f.poiKey === key && f.factText.trim())
    .sort((a, b) => {
      if (a.mustSay !== b.mustSay) return a.mustSay ? -1 : 1;
      return b.updatedAtMs - a.updatedAtMs;
    });
  return rows.map((f) => f.factText.trim()).slice(0, 8);
}

/**
 * Fakt aus verifizierter Recherche sofort speichern + Ask zählen.
 * mustSay erst ab 3 verschiedenen Usern.
 */
export async function ingestVerifiedFaqFact(input: {
  poi: PoiWithFacts;
  question: string;
  factText: string;
  sourceUrl?: string | null;
  confidence?: 'high' | 'medium' | 'low';
}): Promise<FaqFactEntry | null> {
  const text = input.factText.trim();
  if (text.length < 12) return null;
  const conf = input.confidence ?? 'medium';
  if (conf === 'low') return null;

  const state = await load();
  const userId = resolveUserId();
  const key = poiKeyOf(input.poi);
  const cluster = clusterKey(input.question);
  let row = state.facts.find(
    (f) =>
      f.poiKey === key &&
      (f.questionCluster === cluster ||
        f.factText.toLowerCase().slice(0, 60) === text.toLowerCase().slice(0, 60)),
  );

  if (!row) {
    row = {
      id: `faq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      poiKey: key,
      poiId: input.poi.id,
      poiName: input.poi.name,
      questionCluster: cluster,
      factText: text,
      sourceUrl: input.sourceUrl ?? null,
      confidence: conf,
      askUserIds: [userId],
      askCount: 1,
      mustSay: false,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      synced: false,
    };
    state.facts.push(row);
  } else {
    if (!row.askUserIds.includes(userId)) {
      row.askUserIds.push(userId);
      row.askCount = row.askUserIds.length;
    }
    if (text.length > row.factText.length) row.factText = text;
    if (input.sourceUrl) row.sourceUrl = input.sourceUrl;
    row.updatedAtMs = Date.now();
    row.synced = false;
  }

  row.mustSay = row.askUserIds.length >= MODULE1_MUST_SAY_MIN_USERS;
  await save(state);
  try {
    // Sofort in lokale Pack-SQLite — Datensatz wächst auf dem Gerät
    const { appendLearnedFactToPoi } = await import('../../db/database');
    if (input.poi.id != null && Number.isFinite(input.poi.id)) {
      void appendLearnedFactToPoi({
        poiId: input.poi.id,
        factText: row.factText,
        idHint: row.id,
      });
    }
  } catch {
    /* soft */
  }
  try {
    scheduleImmediateCommunityCachePush();
  } catch {
    /* soft */
  }
  void recordTasteQuestionSignal(input.question);
  return row;
}

export async function getUnsyncedFaqFacts(): Promise<FaqFactEntry[]> {
  const state = await load();
  return state.facts.filter((f) => !f.synced);
}

export async function markFaqFactsSynced(ids: string[]): Promise<void> {
  const state = await load();
  const set = new Set(ids);
  for (const f of state.facts) {
    if (set.has(f.id)) f.synced = true;
  }
  await save(state);
}

/**
 * Wenn Pack die Antwort nicht hergibt: Research → Speech-Fakt + sofort ingest.
 */
export async function researchModule1FollowupFact(input: {
  poi: PoiWithFacts;
  question: string;
}): Promise<{ factText: string; sourceUrl: string | null } | null> {
  if (!hasGeminiApiKey()) return null;
  const q = input.question.trim();
  if (q.length < 5) return null;

  let researchBlock = '';
  try {
    const wr = await runWebResearch(`${input.poi.name}: ${q}`, {
      force: true,
    });
    if (wr) {
      researchBlock = JSON.stringify({
        facts: wr.facts?.slice(0, 8),
        sources: wr.sources?.slice(0, 6),
        notes: wr.researchNotes?.slice(0, 500),
        speechHint: wr.speechHint,
      }).slice(0, 4000);
    }
  } catch {
    researchBlock = '';
  }

  const prompt = `Extrahiere EINE kurze, belegte Fakten-Antwort (1–3 Sätze Deutsch) zur Frage.
Ort: ${input.poi.name}
Frage: ${q}
Recherche-Rohstoff (kann leer sein):
${researchBlock || '—'}

Regeln: Nichts erfinden. Wenn unsicher: Antworte genau mit NO_FACT.
Ausgabe JSON: {"fact":"...","sourceUrl":null|"https://...","confidence":"high"|"medium"|"low"}`;

  try {
    const raw = await generateGeminiText(prompt, {
      maxTokens: 512,
      temperature: 0.2,
      responseJson: true,
      jsonMimeOnly: true,
      useFindusSystem: false,
      task: 'local_qa',
      allowProEscalate: false,
    });
    const parsed = JSON.parse(raw || '{}') as {
      fact?: string;
      sourceUrl?: string | null;
      confidence?: string;
    };
    const fact = (parsed.fact ?? '').trim();
    if (!fact || fact === 'NO_FACT' || parsed.confidence === 'low') {
      return null;
    }
    const conf =
      parsed.confidence === 'high'
        ? 'high'
        : parsed.confidence === 'medium'
          ? 'medium'
          : 'medium';
    await ingestVerifiedFaqFact({
      poi: input.poi,
      question: q,
      factText: fact,
      sourceUrl: parsed.sourceUrl ?? null,
      confidence: conf,
    });
    return { factText: fact, sourceUrl: parsed.sourceUrl ?? null };
  } catch {
    return null;
  }
}

/** Ob Pack-Text die Frage grob schon deckt. */
export function packLikelyAnswersQuestion(
  poi: PoiWithFacts,
  question: string,
): boolean {
  const blob = [
    poi.teaser_text ?? '',
    ...(poi.facts ?? []).map((f) => f.fact_text ?? ''),
  ]
    .join(' ')
    .toLowerCase();
  if (blob.length < 40) return false;
  const tokens = question
    .toLowerCase()
    .split(/[\s,.!?]+/)
    .filter((t) => t.length >= 4)
    .slice(0, 6);
  if (!tokens.length) return false;
  const hits = tokens.filter((t) => blob.includes(t)).length;
  return hits >= Math.min(2, tokens.length);
}
