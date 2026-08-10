/**
 * Kurze, sprech-/UI-taugliche POI-Namen aus langen OSM/DB-Titeln.
 * Vollname bleibt für Matching; Speech/HUD bekommen die Kurzform.
 */

import { userAskedForAddressOrCoords } from './addressPrivacy';

const WEGWEISER_TAIL_RE = /\s*[·•|]\s*Wegweiser\s*$/i;
const SLOGAN_SPLIT_RE = /\s+[–—-]\s+/;
const INSTITUTION_RE =
  /\b(kurverwaltung|rathaus|museum|kirche|schule|bahnhof|hafen|leuchtturm|bibliothek|theater|klinik|krankenhaus|hotel|pension|café|cafe|restaurant|bistro|imbiss|apotheke|tourist|info|verwaltung|strand|promenade|wartehalle|inselbahnhof)\b/i;

function stripWegweiser(raw: string): string {
  return raw.replace(WEGWEISER_TAIL_RE, '').replace(/\s+/g, ' ').trim();
}

function shortenInstitutionLabel(label: string): string {
  const t = label.replace(/\s+/g, ' ').trim();
  // „Kurverwaltung Nordseeheilbad Wangerooge“ → „Kurverwaltung“
  const m = t.match(
    /^(Kurverwaltung|Rathaus|Museum|Kirche|Bahnhof|Hafen|Leuchtturm|Bibliothek|Theater|Apotheke|Tourist[- ]?Info|Bistro|Café|Cafe|Restaurant|Hotel|Pension)\b/i,
  );
  if (m) return m[1];
  const words = t.split(/\s+/);
  if (words.length <= 3) return t;
  return words.slice(0, 3).join(' ');
}

/**
 * Sprech-/Display-Kurzname:
 * 1) Klammern-Typ bevorzugen (Kurverwaltung…)
 * 2) Slogan nach „ - “ streichen
 * 3) Länge deckeln
 */
export function shortPoiDisplayName(rawTitle: string, maxChars = 42): string {
  let name = stripWegweiser(rawTitle);
  if (!name) return rawTitle.trim();

  const paren = name.match(/\(([^)]+)\)/);
  if (paren?.[1] && INSTITUTION_RE.test(paren[1])) {
    name = shortenInstitutionLabel(paren[1]);
  } else {
    name = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const dashParts = name.split(SLOGAN_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
    if (dashParts.length >= 2) {
      // „Wangerooge - Erholung ist eine Insel“ → rechter Slogan weg,
      // wenn links ein Ortsname und rechts ein Satz/Slogan wirkt.
      const right = dashParts[dashParts.length - 1];
      const left = dashParts[0];
      const rightLooksSlogan =
        /\bist\b|eine\s+insel|erholung|paradies|traum|urlaub/i.test(right) ||
        right.split(/\s+/).length >= 3;
      name = rightLooksSlogan ? left : dashParts[dashParts.length - 1];
    }
    name = name
      .split(/\s*[|/]\s*|\s+\boder\b\s+/i)[0]
      ?.trim() ?? name;
  }

  name = name.replace(/\s+/g, ' ').trim();
  if (name.length > maxChars) {
    const cut = name.slice(0, maxChars - 1);
    const lastSpace = cut.lastIndexOf(' ');
    name = `${(lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trim()}…`;
  }
  return name || stripWegweiser(rawTitle);
}

/** Ob der User explizit nach Adresse / GPS / Koordinaten fragt. */
export function userAskedForAddress(text: string): boolean {
  return userAskedForAddressOrCoords(text);
}
