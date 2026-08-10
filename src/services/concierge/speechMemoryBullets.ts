/**
 * Memory-Stichpunkte aus Speech — SSOT.
 * Priorität: Zahlen, Zeiten, Fakten, Orte/Eckpunkte die man schlecht behält.
 * Keine Meta-Chips, keine Nebensachen.
 */

import { extractHistoryFactBullets } from './historyFactBullets';
import {
  extractSpokenAddresses,
  looksLikeAddressOrCoordBullet,
  userAskedForAddressOrCoords,
} from '../../utils/addressPrivacy';

const FLUFF_RE =
  /^(lebendig|kompakt|ausführlich|offline|kurzfassung|meilensteine\s+folgen|bahn-historie|ok|super|cool|genau|historie\s*→\s*heute|venue-offers|maps-pitch)$/iu;

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function isFluff(b: string, allowAddress = false): boolean {
  const t = b.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '').trim();
  if (t.length < 4 || FLUFF_RE.test(t) || /^📜\s+\w+$/u.test(b)) return true;
  if (!allowAddress && looksLikeAddressOrCoordBullet(t)) return true;
  if (
    /\b(ausgeschrieben|buchstabier|in worten)\b/iu.test(t) ||
    /[:：]\s*(\.\.\.|…)?\s*$/u.test(t)
  ) {
    return true;
  }
  if (
    /\b(höhe|stufen|eintritt|preis|länge|breite)\b/iu.test(t) &&
    !/\d/.test(t)
  ) {
    return true;
  }
  return false;
}

/** Uhrzeiten / Leave-by */
function extractTimes(speech: string): string[] {
  const out: string[] = [];
  const re =
    /\b(?:(?:gegen|um|ab|bis|gegen)\s+)?(\d{1,2}[:.]\d{2}|\d{1,2}\s*Uhr)(?:\s*Uhr)?\b/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(speech))) {
    const raw = clean(m[0]).replace(/\s+/g, ' ');
    if (raw.length >= 3) out.push(`⏰ ${raw}`);
  }
  return out;
}

/** Dauern / Distanzen / Preise / Maße / Punkte (Höhe, Stufen, Ranking…) */
function extractQuantities(speech: string): string[] {
  const out: string[] = [];
  const re =
    /\b(\d{1,3}\s*(?:–|-|bis\s+)?\d{0,3}\s*(?:Min(?:uten)?|Std\.?|Stunden?|km|m|€|Euro|Pkt\.?|Punkte?)|ca\.\s*\d{1,3}\s*(?:Min|km|Pkt|Punkte)|~\s*\d{1,3}\s*(?:Min|km))\b/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(speech))) {
    out.push(clean(m[1]).replace(/\s+/g, ' '));
  }
  // Ranking / Turnier-Punkte mit optionaler Stufe
  const pointRes: Array<{ re: RegExp; fmt: (a: string, b?: string) => string }> = [
    {
      re: /\b(?:erste|1\.?|erst)\s*runde[^\d]{0,40}(\d{2,4})\s*(?:punkte?|pkt\.?)?\b/giu,
      fmt: (n) => `1. Runde · ${n} Pkt`,
    },
    {
      re: /\b(?:zweite|2\.?)\s*runde[^\d]{0,40}(\d{2,4})\s*(?:punkte?|pkt\.?)?\b/giu,
      fmt: (n) => `2. Runde · ${n} Pkt`,
    },
    {
      re: /\b(?:dritte|3\.?)\s*runde[^\d]{0,40}(\d{2,4})\s*(?:punkte?|pkt\.?)?\b/giu,
      fmt: (n) => `3. Runde · ${n} Pkt`,
    },
    {
      re: /\b(\d{2,4})\s*(?:punkte?|pkt\.?)\b/giu,
      fmt: (n) => `${n} Punkte`,
    },
  ];
  for (const { re: rx, fmt } of pointRes) {
    rx.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = rx.exec(speech))) {
      const n = mm[1];
      if (n) out.push(fmt(n));
    }
  }
  // Höhe / Meter / Stufen — mit Label
  const measureRes: Array<{ re: RegExp; fmt: (n: string, unit: string) => string }> = [
    {
      re: /\b(?:höhe|hoch|turmhöhe|gesamt(?:höhe)?)\b[^\d]{0,24}(\d{2,4})\s*(m|meter|metern)?\b/giu,
      fmt: (n, u) => `Höhe ${n} ${u || 'm'}`,
    },
    {
      re: /\b(\d{2,4})\s*(m|meter|metern)\b(?:\s*(?:hoch|höhe|turm))?/giu,
      fmt: (n, u) => `${n} ${u === 'm' ? 'm' : 'm'}`,
    },
    {
      re: /\b(\d{2,4})\s*(stufen|treppenstufen|stiege)\b/giu,
      fmt: (n, u) => `${n} ${/stufe/i.test(u) ? 'Stufen' : u}`,
    },
  ];
  for (const { re: rx, fmt } of measureRes) {
    rx.lastIndex = 0;
    let mm: RegExpExecArray | null;
    while ((mm = rx.exec(speech))) {
      const n = mm[1];
      const unit = (mm[2] ?? 'm').toLowerCase().replace(/metern?/, 'm');
      if (n) out.push(fmt(n, unit));
    }
  }
  // Linien
  const lines = speech.match(/\b((?:RB|RE|S)\s*\d{1,3})\b/giu) ?? [];
  for (const l of lines) out.push(`🚆 ${l.replace(/\s+/g, '').toUpperCase()}`);
  return out;
}

/** Orte / Themen als Eckpunkte (Proper Names + bekannte Labels) */
function extractThemes(speech: string): string[] {
  const out: string[] = [];
  const themes =
    speech.match(
      /\b((?:Bahnhof|Haltepunkt|Güterbahnhof|Gütergleis|Wartehäuschen|Museum|Kirche|Hafen|Strand|Düne|Aussicht|Rathaus|Markt|Hafen|Bootsverleih|Kletter(?:park|kurs|halle)|Tour|Toilette|Restaurant|Café|Cafe)[\wÄÖÜäöüß\-]*)\b/gu,
    ) ?? [];
  for (const t of themes) {
    const c = clean(t);
    if (c.length >= 4) out.push(c);
  }
  // „X oder Y“ Choice-Namen
  const orPair = speech.match(
    /\b([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-&.']*){0,3})\s+oder\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-&.']*){0,3})\b/u,
  );
  if (orPair) {
    out.push(clean(orPair[1]));
    out.push(clean(orPair[2]));
  }
  return out;
}

function dedupePush(
  out: string[],
  seen: Set<string>,
  raw: string,
  max: number,
  allowAddress = false,
): void {
  if (out.length >= max) return;
  const t = clean(raw);
  if (!t || isFluff(t, allowAddress)) return;
  const key = t.toLowerCase().replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '');
  if (seen.has(key)) return;
  // Cap length for display — Adressen etwas länger erlauben
  const cap = allowAddress && looksLikeAddressOrCoordBullet(t) ? 64 : 48;
  const clipped =
    t.length > cap ? `${t.slice(0, cap - 2).replace(/\s+\S*$/u, '').trim()}…` : t;
  seen.add(key);
  out.push(clipped);
}

export type SpeechScene =
  | 'history'
  | 'transit'
  | 'food_choice'
  | 'place_choice'
  | 'booking'
  | 'navigation'
  | 'activity'
  | 'fact_answer'
  | 'general';

export function classifySpeechScene(
  speech: string,
  userText?: string,
): SpeechScene {
  const blob = `${userText ?? ''} ${speech}`.slice(0, 1200);
  if (
    /\b(geschichte|historie|früher|jahrhundert|1844|1911|chronik|entstanden)\b/iu.test(
      blob,
    )
  ) {
    return 'history';
  }
  // Zahl-/Punkte-/Regel-Fragen → Fakten-Spickzettel priorisieren
  if (
    /\b(wie\s+viele|wieviel|wie\s+viel|punkte?|pkt\.?|runde|stufe|ranking|regel|kostet|preis|eintritt)\b/iu.test(
      blob,
    ) &&
    /\d/.test(speech)
  ) {
    return 'fact_answer';
  }
  if (
    /\b(bahnlinie|verbindung|rb\s*\d|re\s*\d|abfahrt|fahrplan|haltepunkt|zügen?\b)/iu.test(
      blob,
    )
  ) {
    return 'transit';
  }
  if (
    /\b(speisekarte|restaurant|essen|abendessen|mittag|bistro|imbiss|café|cafe)\b/iu.test(
      blob,
    ) &&
    (/\boder\b/iu.test(speech) || /\bfavorit|alternative\b/iu.test(speech))
  ) {
    return 'food_choice';
  }
  // Beliebige Dual-Option (Supermarkt, Apotheke, Toilette, Café, ATM…)
  if (
    /\boder\b/iu.test(speech) &&
    /[A-ZÄÖÜ]/.test(speech) &&
    /\b(welcher|welche[rn]?|nehmen|option|favorit|alternative|oder)\b/iu.test(blob)
  ) {
    return 'place_choice';
  }
  if (
    /\b(buchen|buchung|verleih|leihen|kurs|ticket|tour\b|boots?|kletter)\b/iu.test(
      blob,
    )
  ) {
    return 'booking';
  }
  if (
    /\b(route|kompass|navig|bring\s+dich|gehzeit|fu[sß]weg|leave[- ]?by|\d+\s*min(?:uten)?|\d+\s*km)\b/iu.test(
      blob,
    )
  ) {
    return 'navigation';
  }
  if (/\b(tour|ausflug|aktivit|kurs|verleih)\b/iu.test(blob)) {
    return 'activity';
  }
  return 'general';
}

/**
 * Baut 0–3 Memory-Stichpunkte aus dem gesprochenen Text.
 * Bestehende Bullets werden nur behalten, wenn sie schon zahlen-/faktstark sind.
 */
export function deriveMemoryBullets(
  speech: string,
  existing?: string[] | null,
  opts?: { userText?: string; factBlock?: string | null },
): string[] {
  const scene = classifySpeechScene(speech, opts?.userText);
  const out: string[] = [];
  const seen = new Set<string>();
  const max = 3;
  const allowAddress = userAskedForAddressOrCoords(opts?.userText ?? '');

  const pushSafe = (raw: string) => {
    if (!allowAddress && looksLikeAddressOrCoordBullet(raw)) return;
    dedupePush(out, seen, raw, max, allowAddress);
  };

  // User fragt nach Adresse → volle Adresse aus Speech zuerst
  if (allowAddress) {
    for (const addr of extractSpokenAddresses(speech)) {
      pushSafe(addr);
    }
  }

  // Bestehende starke Bullets behalten — nur mit Zahl/Maß/Zeit, keine leeren Labels
  for (const b of existing ?? []) {
    if (looksLikeAddressOrCoordBullet(b)) {
      if (allowAddress) pushSafe(b);
      continue;
    }
    if (isFluff(b, allowAddress)) continue;
    if (/\d/.test(b) || /€|Uhr|Min|km|\bm\b|RB|RE|·|Stufen/i.test(b)) {
      pushSafe(b);
    }
  }

  if (scene === 'history') {
    for (const b of extractHistoryFactBullets(speech, opts?.factBlock, max)) {
      pushSafe(b);
    }
  }

  // Faktenantworten: Zahlen zuerst (inkl. Runden/Punkte), dann Rest
  for (const b of extractQuantities(speech)) pushSafe(b);
  for (const b of extractTimes(speech)) pushSafe(b);

  if (scene === 'fact_answer' && out.length === 0) {
    const withNum = speech.match(/[^.!?]{0,36}\d[^.!?]{0,36}/gu) ?? [];
    for (const chunk of withNum) {
      pushSafe(clean(chunk));
    }
  }

  if (out.length < max) {
    for (const t of extractThemes(speech)) {
      // Keine nackten Straßennamen wenn volle Adresse schon da / erwartet
      if (
        allowAddress &&
        /(?:straße|strasse|str\.|allee|weg|platz)\b/i.test(t) &&
        !/\d/.test(t)
      ) {
        continue;
      }
      pushSafe(t);
    }
  }

  // Letzter Fallback: kurze Kernsätze mit Zahl
  if (out.length === 0) {
    const withNum = speech.match(/[^.!?]{0,40}\d[^.!?]{0,40}/gu) ?? [];
    for (const chunk of withNum) {
      pushSafe(clean(chunk));
    }
  }

  return out.slice(0, max);
}
