/**
 * Flipchart-Sticker: Labels nur vom LLM — kein Code-Template-Wortlaut.
 * Ledger/Fakten bleiben strukturiert; der Text auf dem Board schreibt die KI.
 */

import type { FlipchartNote, NoteTier } from './flipchartNotes';
import { emojiForWishText } from './flipchartNotes';
import type { ReiseLedger, ChatTurn } from './types';

const TIERS: NoteTier[] = ['critical', 'high', 'wish', 'optional', 'nope'];

/** Generische Pins / Platzhalter — nie auf dem Board lassen. */
const BORING_EMOJI_RE = /^[📌📍✨📝•·\*]$/u;

/**
 * Sticker-Emoji: cool & inhaltlich.
 * 📌 nie. 📍 nur wenn Label klar Lage/Ort ist und kein besserer Match.
 */
export function resolveNoteEmoji(rawEmoji: unknown, label: string, id: string): string {
  if (id === 'open_q' || id === 'openQ') return '❓';
  const matched = emojiForWishText(label, '✨');
  // Inhaltlicher Match schlägt LLM-Pin immer
  if (matched && matched !== '✨' && matched !== '📌') return matched;

  const e = String(rawEmoji || '')
    .trim()
    .slice(0, 8);
  if (e && !BORING_EMOJI_RE.test(e) && e !== '❓') return e;

  // Letzter Fallback: Lage → 📍, sonst ✨ — nie 📌
  if (/\b(lage|ort|stadt|pin|karte)\b/i.test(label)) return '📍';
  return matched === '📌' ? '✨' : matched || '✨';
}
const SKIP_KEYS = new Set([
  'recapDone',
  'originLat',
  'originLng',
  'boardPins',
  'tasteSeed',
]);

/** Kompakte Fakten fürs Prompt — Rohwerte, keine UI-Sätze. */
export function ledgerFactsForFlipchart(ledger: ReiseLedger): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(ledger as unknown as Record<string, unknown>)) {
    if (SKIP_KEYS.has(key)) continue;
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { value?: unknown; source?: string; hardness?: string };
    if (e.value == null || e.value === '') continue;
    if (e.source !== 'user' && e.source !== 'profile' && e.source !== 'inferred') continue;
    out[key] = {
      value: e.value,
      source: e.source,
      hardness: e.hardness || null,
    };
  }
  return out;
}

function slugId(raw: string, i: number): string {
  const s = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 28);
  return s || `n${i}`;
}

/** LLM-JSON → sichere FlipchartNote[] (Tier/Id säubern, Label unverändert vom LLM). */
export function normalizeLlmFlipchartNotes(raw: unknown): FlipchartNote[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { notes?: unknown }).notes)
      ? (raw as { notes: unknown[] }).notes
      : [];
  const out: FlipchartNote[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < arr.length && out.length < 22; i++) {
    const row = arr[i];
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const label = String(r.label || r.text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    if (label.length < 2) continue;
    // Keine Roh-Slot-Keys als Label
    if (/^(active_out|chill_pool|cov:|must:|wish:)/i.test(label)) continue;
    if (/^[a-z_]+$/i.test(label) && label.includes('_')) continue;
    let tier = String(r.tier || 'wish').toLowerCase() as NoteTier;
    if (!TIERS.includes(tier)) tier = 'wish';
    let id = String(r.id || slugId(label, i)).slice(0, 36);
    if (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const emoji = resolveNoteEmoji(r.emoji, label, id);
    const category =
      typeof r.category === 'string' && r.category.trim()
        ? r.category.trim().slice(0, 18)
        : undefined;
    out.push({
      id,
      tier,
      emoji,
      label,
      category,
      hint: typeof r.hint === 'string' ? r.hint.slice(0, 24) : undefined,
    });
  }
  return out;
}

function buildPrompt(opts: {
  facts: Record<string, unknown>;
  openQuestion?: string | null;
  openAskKey?: string | null;
  lastUserLine?: string | null;
  phase?: string | null;
  recentChat?: string[];
}): string {
  return `Du schreibst die Sticker-Texte für Yorros Reisebüro-Flipchart (Papier-Board).

AUFGABE
- Aus den Fakten knappe, präzise, menschliche Stichpunkte (Deutsch).
- Jeder Sticker = ein klarer Punkt. Kein Bullshit, keine Intern-Keys, kein Jargon.
- Nie Rohwerte wie "active_out", "chill_pool", "cov:…", Slot-Namen.
- Formuliere so, dass ein Mensch sofort versteht.
- Pflicht/hart → tier "critical" oder "high". Wunsch → "wish". Optional → "optional". No-Go → "nope".
- Offene Frage (falls gegeben): genau EIN Sticker id "open_q", emoji "❓", tier "wish", label = ganzer klarer Fragesatz (nicht nur ein Wort).
- Nur belegte Fakten — nichts erfinden. Unklare Werte weglassen statt raten.
- Max 18 Sticker. Labels ≤ 40 Zeichen, trotzdem verständlich.
- emoji: IMMER ein konkretes, passendes Emoji zum Inhalt (Pool→🏊, Flug→✈️, Budget→💶, Datum→📅, Gruppe→👥, Stadt-Flagge wenn Ziel klar).
- VERBOTEN als emoji: 📌 📍 ✨ 📝 — das sind Platzhalter, keine Stichpunkt-Icons.

ZUSAMMENFASSUNGS-STIL (Pflicht — verdichten, nicht abschreiben):
Lange User-Antworten in knappe Stichpunkte pressen. Struktur > Wortlaut.
Beispiele nur für den logischen Ablauf — nie den genauen Wortlaut übernehmen:

User monologisiert zu Daten → Sticker wie:
"Anreise: 16.10. / (15.10. ab 14 Uhr)"
"Abreise: 20.10. / (notfalls 21.10.)"

User zu Reisemitteln → Sticker wie:
"Reisemittel: egal · günstig"
"Auto max ~4–5 h · Bahn max 6 h"
"Flug ~4 h (max 5) · Direkt"

User zu Gruppe/Alter/Bahncard → Sticker wie:
"Alter: 1×24 + BC25 / 1×24 / 1×26"

OUTPUT nur JSON:
{"notes":[{"id":"dest","tier":"critical","emoji":"🇬🇷","label":"Richtung Griechenland","category":"ZIEL"}]}

PHASE: ${opts.phase || 'briefing'}
OFFENE_FRAGE_KEY: ${opts.openAskKey || ''}
OFFENE_FRAGE_HINT: ${opts.openQuestion || ''}
LETZTE_USER_ZEILE: ${opts.lastUserLine || ''}
RECENT_CHAT: ${JSON.stringify((opts.recentChat || []).slice(-4))}
FAKTEN: ${JSON.stringify(opts.facts)}`;
}

/**
 * Live: Gemini schreibt die Board-Labels.
 * Bei Fehler/leer → [] (UI zeigt kein Code-Fallback).
 */
export async function generateLlmFlipchartNotes(opts: {
  ledger: ReiseLedger;
  openQuestion?: string | null;
  openAskKey?: string | null;
  lastUserLine?: string | null;
  phase?: string | null;
  chat?: ChatTurn[];
}): Promise<FlipchartNote[]> {
  const facts = ledgerFactsForFlipchart(opts.ledger);
  const recentChat = (opts.chat || [])
    .slice(-6)
    .map((c) => `${c.role}: ${c.text}`.slice(0, 120));
  if (!Object.keys(facts).length && !(opts.openQuestion || '').trim()) {
    return [];
  }
  try {
    const { generateGeminiText } = await import('../services/geminiService');
    const raw = await generateGeminiText(
      buildPrompt({
        facts,
        openQuestion: opts.openQuestion,
        openAskKey: opts.openAskKey,
        lastUserLine: opts.lastUserLine,
        phase: opts.phase,
        recentChat,
      }),
      {
        tier: 'lite',
        temperature: 0.35,
        maxTokens: 1100,
        responseJson: true,
        jsonMimeOnly: true,
        useFindusSystem: false,
      },
    );
    if (!raw?.trim()) return [];
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          return [];
        }
      }
    }
    return normalizeLlmFlipchartNotes(parsed);
  } catch (e) {
    if (__DEV__) console.warn('[Reisebuero] llmFlipchart failed', e);
    return [];
  }
}

let flipGen = 0;

/** Debounced Refresh → Store.llmFlipchartNotes (nur LLM). */
export function scheduleLlmFlipchartRefresh(): void {
  const gen = ++flipGen;
  void (async () => {
    await new Promise((r) => setTimeout(r, 280));
    if (gen !== flipGen) return;
    try {
      const { useReisebueroStore } = await import('./store');
      const trip = useReisebueroStore.getState().trip;
      const lastUser = [...trip.chat].reverse().find((c) => c.role === 'user')?.text || '';
      const askKey = trip.askedSlotKeys[trip.askedSlotKeys.length - 1] || null;
      const notes = await generateLlmFlipchartNotes({
        ledger: trip.ledger,
        openQuestion: trip.questionHint,
        openAskKey: askKey,
        lastUserLine: lastUser,
        phase: trip.phase,
        chat: trip.chat,
      });
      if (gen !== flipGen) return;
      useReisebueroStore.getState().setLlmFlipchartNotes(notes);
    } catch {
      /* soft */
    }
  })();
}
