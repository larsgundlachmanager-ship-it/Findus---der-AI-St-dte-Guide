/**
 * Slim Welcome-Fakten pro Stadt (< ~4 KB) — Stadtgeschichte + vorproduzierte Speech.
 * Datei: cities/<id>.welcome.json · Bucket: staedte/<id>.welcome.json
 */

import * as FileSystem from 'expo-file-system';
import { env } from '../config/env';

export type CityWelcomeFacts = {
  v: 1;
  cityId: string;
  name: string;
  history: string;
  highlights: string[];
  todayHint?: string;
  /** Vorproduzierte Welcome-Speech — sofort vorlesen, ohne Gemini-Warte. */
  speech?: string;
};

const DOC = FileSystem.documentDirectory;
const DIR = DOC ? `${DOC}cities/` : null;
const mem = new Map<string, CityWelcomeFacts>();
const inFlight = new Map<string, Promise<CityWelcomeFacts | null>>();

/** Max. Wartezeit für Remote-Welcome — sonst hängt der Switch-Button. */
export const CITY_WELCOME_FETCH_MS = 2_800;

function localPath(cityId: string): string | null {
  if (!DIR) return null;
  return `${DIR}${cityId.toLowerCase()}.welcome.json`;
}

function publicUrl(cityId: string): string | null {
  const base = env.supabaseUrl().replace(/\/$/, '');
  if (!base) return null;
  const id = encodeURIComponent(cityId.toLowerCase());
  return `${base}/storage/v1/object/public/staedte/${id}.welcome.json`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    void p.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(v);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

/** Einfache Speech aus Historie, falls Sidecar ohne speech-Feld. */
export function bakeWelcomeSpeechLocal(
  facts: Pick<CityWelcomeFacts, 'name' | 'history' | 'highlights' | 'todayHint'>,
): string {
  const name = (facts.name || 'dieser Stadt').trim();
  const hist = (facts.history || '').replace(/\s+/g, ' ').trim();
  const highlights = (facts.highlights || []).filter((h) => h.length >= 2);
  const sentences = hist
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 28);
  const origin = sentences[0] || hist.slice(0, 220);
  const turn =
    sentences.find((s, i) => i > 0 && !/^heute\b/i.test(s)) || sentences[1] || '';
  const today =
    facts.todayHint?.trim() ||
    sentences.find((s) => /^heute\b/i.test(s)) ||
    `Heute prägt ${name} ihr eigenes Tempo — nah und greifbar.`;
  const [a, b, c] = highlights;
  let tour = '';
  if (a && b && c) {
    tour = `Lass uns zuerst bei ${a} verlieren, dann den Kontrast bei ${b} spüren, und wenn es dämmert ${c}.`;
  } else if (a && b) {
    tour = `Lass uns ${a} entdecken und danach ${b}.`;
  } else if (a) {
    tour = `Lass uns bei ${a} starten.`;
  }
  const punct = (s: string) =>
    /[.!?]$/.test(s) ? s : `${s}.`;
  return [punct(origin), turn ? punct(turn) : null, punct(today), tour || null, 'Was wollen wir als Erstes entdecken?']
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1300);
}

function normalize(raw: unknown, fallbackId: string): CityWelcomeFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const history = String(o.history || '').trim();
  if (history.length < 40) return null;
  const highlights = Array.isArray(o.highlights)
    ? o.highlights
        .map((h) => String(h || '').trim())
        .filter((h) => h.length >= 2)
        .slice(0, 5)
    : [];
  const todayHint = String(o.todayHint || '').trim().slice(0, 280);
  const name = String(o.name || fallbackId).trim() || fallbackId;
  const speechRaw = String(o.speech || '').trim();
  const base = {
    v: 1 as const,
    cityId: String(o.cityId || fallbackId).toLowerCase(),
    name,
    history: history.slice(0, 1800),
    highlights,
    ...(todayHint ? { todayHint } : {}),
  };
  const speech =
    speechRaw.length >= 60
      ? speechRaw.slice(0, 1350)
      : bakeWelcomeSpeechLocal(base);
  return { ...base, speech };
}

export function peekCityWelcomeFacts(
  cityId: string | null | undefined,
): CityWelcomeFacts | null {
  if (!cityId) return null;
  return mem.get(cityId.toLowerCase()) ?? null;
}

async function readLocal(cityId: string): Promise<CityWelcomeFacts | null> {
  const p = localPath(cityId);
  if (!p) return null;
  try {
    const info = await FileSystem.getInfoAsync(p);
    if (!info.exists) return null;
    const text = await FileSystem.readAsStringAsync(p);
    return normalize(JSON.parse(text), cityId);
  } catch {
    return null;
  }
}

async function writeLocal(
  cityId: string,
  facts: CityWelcomeFacts,
): Promise<void> {
  const p = localPath(cityId);
  if (!p || !DIR) return;
  try {
    const info = await FileSystem.getInfoAsync(DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    }
    await FileSystem.writeAsStringAsync(p, JSON.stringify(facts));
  } catch {
    /* soft */
  }
}

async function fromLocalFullPack(
  cityId: string,
): Promise<CityWelcomeFacts | null> {
  const p = DIR ? `${DIR}${cityId.toLowerCase()}.json` : null;
  if (!p) return null;
  try {
    const info = await FileSystem.getInfoAsync(p);
    if (!info.exists) return null;
    const size = 'size' in info && typeof info.size === 'number' ? info.size : 0;
    if (size > 2_500_000) return null;
    const text = await FileSystem.readAsStringAsync(p);
    const pack = JSON.parse(text) as Record<string, unknown>;
    const history = String(pack._city_history || pack.city_history || '').trim();
    if (history.length < 40) return null;
    const spots = Array.isArray(pack.spots) ? pack.spots : [];
    const highlights: string[] = [];
    for (const s of spots) {
      if (!s || typeof s !== 'object') continue;
      const row = s as Record<string, unknown>;
      const n = String(row.name || '').trim();
      if (n.length < 2) continue;
      if (String(row.tier || '').toLowerCase() === 'directory') continue;
      highlights.push(n);
      if (highlights.length >= 3) break;
    }
    return normalize(
      {
        v: 1,
        cityId: cityId.toLowerCase(),
        name: String(pack.city_name || pack.name || cityId),
        history,
        highlights,
      },
      cityId,
    );
  } catch {
    return null;
  }
}

async function downloadRemote(
  cityId: string,
): Promise<CityWelcomeFacts | null> {
  const url = publicUrl(cityId);
  if (!url) return null;
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl
      ? setTimeout(() => ctrl.abort(), CITY_WELCOME_FETCH_MS)
      : null;
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return normalize(json, cityId);
  } catch {
    return null;
  }
}

/**
 * Holt Slim-Welcome (Cache → Remote mit Timeout → optional kleines lokales Pack).
 * Darf den Switch-UI-Thread nie länger als ~CITY_WELCOME_FETCH_MS blockieren.
 * allowFullPack=false (Default am Switch): kein Mega-JSON-Parse.
 */
export async function ensureCityWelcomeFacts(
  cityId: string | null | undefined,
  opts?: { allowFullPack?: boolean },
): Promise<CityWelcomeFacts | null> {
  if (!cityId) return null;
  const id = cityId.toLowerCase();
  const allowFullPack = opts?.allowFullPack === true;
  const hit = mem.get(id);
  if (hit) return hit;

  const pending = inFlight.get(id);
  if (pending) return withTimeout(pending, CITY_WELCOME_FETCH_MS);

  const job = (async () => {
    try {
      const local = await readLocal(id);
      if (local) {
        mem.set(id, local);
        return local;
      }
      const remote = await downloadRemote(id);
      if (remote) {
        mem.set(id, remote);
        void writeLocal(id, remote);
        return remote;
      }
      if (allowFullPack) {
        const fromPack = await fromLocalFullPack(id);
        if (fromPack) {
          mem.set(id, fromPack);
          void writeLocal(id, fromPack);
          return fromPack;
        }
      }
      return null;
    } finally {
      inFlight.delete(id);
    }
  })();

  inFlight.set(id, job);
  return withTimeout(job, CITY_WELCOME_FETCH_MS + 400);
}

export function formatWelcomeFactsForPrompt(
  facts: CityWelcomeFacts | null | undefined,
): string {
  if (!facts?.history) return '';
  const lines = [
    'BELEGTE STADT-FAKTEN (nur daraus schöpfen — nichts erfinden):',
    `Historie-Rohstoff:\n${facts.history}`,
  ];
  if (facts.highlights.length) {
    lines.push(
      `Highlight-Orte (für die 3 Tour-Stops, Namen beibehalten):\n- ${facts.highlights.join('\n- ')}`,
    );
  }
  if (facts.todayHint) {
    lines.push(`Heute-Hinweis (belegt): ${facts.todayHint}`);
  }
  if (facts.speech) {
    lines.push(
      '(Optional: eine vorproduzierte Speech existiert bereits — wenn du neu schreibst, gleiche Struktur, anderer Wortlaut.)',
    );
  }
  return lines.join('\n');
}
