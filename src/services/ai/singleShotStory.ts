/**
 * Modul-1 Text-Helfer — Live-Pfad ist module1PoiChat.
 * Hier nur Caps, Offline-Fallback und Audio-Scrub.
 */

import type { PoiWithFacts } from '../../db/types';

/** Modul-1 Hauptpunkt (Ankunft, Default full): hartes Max — kein Mindestmaß */
export const MODULE1_MAIN_MAX_CHARS = 1000;
/** Ankunft Kurzantwort (Settings opt-in): Name + Zusammenfassung */
export const MODULE1_BRIEF_MAX_CHARS = 400;
/** „Mehr Historie“ / interestDeepDive */
export const MODULE1_EXPAND_MAX_CHARS = 2000;

/** Hartes Cap an Satzgrenze — nie mitten im Wort. */
export function clampModule1MainText(
  text: string,
  maxChars = MODULE1_MAIN_MAX_CHARS,
): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= maxChars) return t;
  const slice = t.slice(0, maxChars);
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('… '),
  );
  if (sentenceEnd >= Math.floor(maxChars * 0.55)) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }
  const wordEnd = slice.lastIndexOf(' ');
  return (wordEnd > 40 ? slice.slice(0, wordEnd) : slice).trim();
}

/** Nur vorgefertigte Erzählung / general_info — kein Satz-Basteln. */
export function extractOfflineGeneralInfo(poi: PoiWithFacts): string {
  for (const f of poi.facts) {
    const raw = (f.fact_text ?? '').trim();
    if (!raw) continue;
    if (/^\[Erzählung\]/i.test(raw) || /^\[Narration\]/i.test(raw)) {
      const text = raw.replace(/^\[(Erzählung|Narration)\]\s*/i, '').trim();
      if (text.length >= 20) return text;
    }
  }
  return '';
}

/** Area-/Haupt-POIs ohne [Erzählung] → Dev-Warnung. */
export function warnIfMissingOfflineNarration(poi: PoiWithFacts): void {
  if (!__DEV__) return;
  const kind = poi.kind ?? 'legacy';
  if (kind === 'approach' || kind === 'sub') return;
  if (extractOfflineGeneralInfo(poi)) return;
  console.warn(
    `[offline-pack] POI "${poi.name}" (id=${poi.id}) hat keine [Erzählung]/general_info — Offline-Story fällt flach`,
  );
}

/** Fast nur Adresse/GPS/LIVE-Platzhalter / Atmosphäre → kein Mystik-Roman. */
export function isThinModule1FactSet(poi: PoiWithFacts): boolean {
  const raw = (poi.facts ?? [])
    .map((f) => (f.fact_text ?? '').trim())
    .filter(Boolean);
  const teaser = (poi.teaser_text ?? '').trim();
  const pool = [...raw, teaser];
  const substantive = pool.filter((t) => {
    const plain = t
      .replace(
        /^\[(Kurzfakt|Erzählung|Detail|FAQ|Teaser|Hook|Narration|Thema:[^\]]+)\]\s*/iu,
        '',
      )
      .trim();
    if (plain.length < 36) return false;
    if (/\b(lat|lng|gps|adresse|anschrift|koordinate)\b/i.test(plain)) {
      return false;
    }
    if (/\b(-?\d{1,2}\.\d{3,})\s*[,;/]\s*(-?\d{1,3}\.\d{3,})\b/.test(plain)) {
      return false;
    }
    if (/\b\d{5}\s+[A-ZÄÖÜ]/.test(plain)) return false;
    if (
      /\b[\wÄÖÜäöüß.-]+(?:straße|strasse|str\.|allee|weg)\s+\d{1,4}\b/i.test(
        plain,
      ) &&
      plain.length < 80
    ) {
      return false;
    }
    if (
      /orientierung und offline|denkmal-punkt|kategorie \w+ für offline|live:\s*öffnung/i.test(
        plain,
      )
    ) {
      return false;
    }
    if (/^user-frage:\s*woran erkenne ich/i.test(plain)) return false;
    if (
      /^(hier|dort|man|es)\b.{0,40}\b(spür|riech|hör|atmosphäre|aura|geheimnis|mystik)/i.test(
        plain,
      ) &&
      !/\d{3,4}|seit\s+\d|gebaut|gegründet|eröffnet|museum|park|kirche/i.test(
        plain,
      )
    ) {
      return false;
    }
    return true;
  });
  return substantive.length < 2;
}

/** App-/Yorro-Selbstwerbung am Story-Ende (Feature-Tips, „frag mich“…). */
export function looksLikeModule1SelfPromo(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;
  return (
    /\bfrag\s+mich\b/i.test(s) ||
    /\b(du\s+kannst|kannst\s+du)\s+mich\s+(jederzeit\s+)?(fragen|ansprechen|rufen)\b/i.test(
      s,
    ) ||
    /\bwenn\s+du\s+(fragen|rückfragen|mehr)\s+hast\b/i.test(s) ||
    /\blöcher\s+in\s+den\s+bauch\b/i.test(s) ||
    /\b(ich\s+kann\s+dich|soll\s+ich\s+dich)\s+(auch\s+)?(hin\s*)?(navig|führ|fuehr|bugsier)/i.test(
      s,
    ) ||
    /\b(mikrofon|mikro\b|lange\s+halten|kurz\s+tippen)\b/i.test(s) ||
    (/\b(einstellungen|zahnrad|stempelkarte|tageskalender|mein\s+profil)\b/i.test(
      s,
    ) &&
      /\b(findus|app|oben|tippen|öffnen|schau)\b/i.test(s)) ||
    /\bich\s+bin\s+findus\b/i.test(s) ||
    /\b(app[- ]?feature|was\s+ich\s+alles\s+kann|meine\s+funktionen)\b/i.test(
      s,
    ) ||
    /\bsprich\s+mich\s+(einfach\s+)?an\b/i.test(s) ||
    /\bmeld(?:e)?\s+dich\s+(einfach\s+)?bei\s+mir\b/i.test(s)
  );
}

/** Entfernt typische Modul-1-Abschlussfragen / Meta-CTAs aus dem Audio-Text. */
export function stripModule1ClosingQuestions(text: string): string {
  if (!text.trim()) return text;
  const parts = text
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = parts.filter((s) => {
    if (looksLikeModule1SelfPromo(s)) return false;
    if (!/\?/.test(s)) {
      if (
        /frag\s+mich\s+einfach|wenn\s+du\s+noch\s+tiefer|wenn\s+du\s+mehr\s+(wissen|erfahren)\s+willst/i.test(
          s,
        )
      ) {
        return false;
      }
      return true;
    }
    if (
      /(after\s*work|afterwork|karaoke|party|biergarten|frühstück|fruehstueck|tisch|buch|spiel|golf|tennis|hotel|wandmalerei|foto|sommerfest|mitmachen|wasserski|wakeboard|baden|bock|probier|mitbringen|badehose|eintritt|€|euro)/i.test(
        s,
      ) &&
      !/frag\s+mich|was\s+macht\s+.+\s+besonders|was\s+steckt\s+noch/i.test(s)
    ) {
      return true;
    }
    if (
      /was\s+macht\s+.+\s+(besonders|kulinarisch)|was\s+steckt\s+(eigentlich\s+)?noch|magst\s+du\s+(einen|eine|eins)|willst\s+du\s+(hin|mehr|noch)|soll\s+ich\s+(dich|dir)|frag\s+mich/i.test(
        s,
      )
    ) {
      return false;
    }
    return true;
  });
  return (kept.length ? kept : parts).join(' ').replace(/\s+/g, ' ').trim();
}
