/**
 * Single-Shot Findus Story Engine.
 * Ein Gemini-Call + Master-Prompt → Sätze für TTS.
 * Offline: nur vorgefertigte [Erzählung]/general_info — kein Template-Stitching.
 */

import type { PoiWithFacts } from '../../db/types';
import type { MasterPromptContext, UserProfile } from '../../types/userProfile';
import { createDefaultProfile } from '../../types/userProfile';
import { GEMINI_STORY_MAX_OUTPUT_TOKENS, GEMINI_TEMPERATURE } from '../../constants/gemini';
import {
  generateGeminiText,
  hasGeminiApiKey,
} from '../geminiService';
import {
  buildMasterSystemInstruction,
  resolveMasterPromptContext,
  resolvePersonaEngine,
} from '../personaEngine';
import { getCachedUserProfile } from '../userProfileService';
import { sentencesFromFullText } from './sentenceStream';
import type { SessionMemory } from './sessionMemory';
import {
  loadFeatureTipState,
  type FeatureTipPlan,
} from './featureTips';
import {
  prepareNarrationFeatureTips,
  commitNarrationFeatureTips,
  getLastNarrationFeatureTipPlan,
} from '../../runtime/featureTipsModule';
import {
  findRelatedPlaceBridge,
  formatRelatedBridgeForPrompt,
} from './relatedPlaceBridge';
import { resolvePoiImportance } from '../personaEngine';
import { useFinnusStore } from '../../store/useFinnusStore';
import { looksLikeActivityVenue } from '../poi/module1LiveCard';
import {
  beginModule1PlaceNameQuotaForPoi,
  markModule1UserNameSpoken,
  module1QuotaPoiId,
  peekModule1PlaceNameAllowed,
} from '../poi/module1NameQuota';
import {
  limitUserFirstNameToOnce,
  scrubBlockedUserFirstName,
  scrubInventedVoiceNames,
  textContainsUserFirstName,
} from './spokenNameGuard';

export type FindusStoryMode = 'arrival' | 'approach';

/** Modul-1 Hauptpunkt (Ankunft): hartes Max — kein Mindestmaß */
export const MODULE1_MAIN_MAX_CHARS = 1200;
/** „Noch mehr“ / interestDeepDive — ausführlicher */
export const MODULE1_EXPAND_MAX_CHARS = 3000;

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

export type StreamFindusStoryInput = {
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  sessionMemory?: SessionMemory | null;
  mode?: FindusStoryMode;
  /** Approach wurde schon gehört → keine zweite Intro-Floskel. */
  approachAlreadyHeard?: boolean;
  /** Harte Obergrenze für den Gemini-Call (ms). */
  timeoutMs?: number;
  /** Sub/Punkt liegt in größerem Kontext (für Nav-Reminder). */
  parentIsMajor?: boolean;
  /**
   * Beat-Brief aus findusTourDirector (Historie/Heute/Fun).
   * Bei arrival: Pflicht-Dramaturgie erzwingen.
   */
  storyBriefBlock?: string | null;
  /** UI „Mehr Historie“ → langer Deep-Dive, am Ort bleiben. */
  deepDive?: boolean;
  /**
   * Eigentlich uninteressant, aber User-Hook → Meta + Fokus auf matched Detail.
   */
  interestOverride?: { hookText: string; matched: string } | null;
  /**
   * Modul-1 Namensquote — false = Vorname in diesem Spot verboten.
   * Wenn unset: Quota wird intern über poi.id gezogen.
   */
  allowUserName?: boolean;
};

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

/** Area-/Haupt-POIs ohne [Erzählung] → Dev-Warnung (P1 Offline-Pack). */
export function warnIfMissingOfflineNarration(poi: PoiWithFacts): void {
  if (!__DEV__) return;
  const kind = poi.kind ?? 'legacy';
  if (kind === 'approach' || kind === 'sub') return;
  if (extractOfflineGeneralInfo(poi)) return;
  console.warn(
    `[offline-pack] POI "${poi.name}" (id=${poi.id}) hat keine [Erzählung]/general_info — Offline-Story fällt flach`,
  );
}

/** P1: Historie → Heute → Fun Fact Signale (ohne gesprochene Labels). */
const DRAM_PAST_RE =
  /(früher|damals|gebaut|gegründet|entstand|errichtet|jahrhundert|seit\s+\d|im\s+jahr|ursprung|erste[rn]?|eröffnet|krieg|geschichte)/i;
const DRAM_NOW_RE =
  /(heute|aktuell|jetzt|derzeit|mittlerweile|inzwischen|gilt|dient|nutzen|geworden|restauriert|umgebaut|genutzt)/i;
const DRAM_FUN_RE =
  /(kurios|witzig|spannend|kaum|besonders|übrigens|das\s+lustige|merkwürdig|einzig|älteste|größte|fun\b|überraschend|kaum\s+jemand)/i;

export function assertArrivalDramaturgy(text: string): {
  ok: boolean;
  past: boolean;
  now: boolean;
  fun: boolean;
} {
  const past = DRAM_PAST_RE.test(text);
  const now = DRAM_NOW_RE.test(text);
  const fun = DRAM_FUN_RE.test(text);
  // Mind. 2 Phasen + genug Länge; alle 3 → klar ok
  const phases = [past, now, fun].filter(Boolean).length;
  const ok = text.trim().length >= 120 && (phases >= 3 || (phases >= 2 && text.length >= 220));
  return { ok, past, now, fun };
}

/** Modul-1: keine App-/Selbst-Erklärungen im Audio (UI-Buttons statt Meta). */
export const MODULE1_NO_FEATURE_TIPS_BLOCK = `=== APP-POTENZIAL ===
- VERBOTEN in dieser Orts-Story: dich selbst vorschlagen, App-Features erklären, „frag mich“, Mikro/Einstellungen/Navigation/Kalender/Stempel anpreisen.
- Kein Meta-Outro. Geschichte endet am Ort — Tiefe nur über UI-Buttons.`;

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
      // Meta-CTAs killen, lebendige Orts-Einladungen behalten
      if (/frag\s+mich\s+einfach|wenn\s+du\s+noch\s+tiefer|wenn\s+du\s+mehr\s+(wissen|erfahren)\s+willst/i.test(s)) {
        return false;
      }
      return true;
    }
    // Soft, ortsbezogene Einladung behalten (Events / Aktivität / morgen früh…)
    if (
      /(after\s*work|afterwork|karaoke|party|biergarten|frühstück|fruehstueck|tisch|buch|spiel|golf|tennis|hotel|wandmalerei|foto|sommerfest|mitmachen|wasserski|wakeboard|baden|bock|probier|mitbringen|badehose|eintritt|€|euro)/i.test(
        s,
      ) &&
      !/frag\s+mich|was\s+macht\s+.+\s+besonders|was\s+steckt\s+noch/i.test(s)
    ) {
      return true;
    }
    // Rhetorische Abschlussfragen killen
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

/** App-/Findus-Selbstwerbung am Story-Ende (Feature-Tips, „frag mich“…). */
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
    /\b(app[- ]?feature|was\s+ich\s+alles\s+kann|meine\s+funktionen)\b/i.test(s) ||
    /\bsprich\s+mich\s+(einfach\s+)?an\b/i.test(s) ||
    /\bmeld(?:e)?\s+dich\s+(einfach\s+)?bei\s+mir\b/i.test(s)
  );
}

function buildPoiPayload(poi: PoiWithFacts): Record<string, unknown> {
  const facts = poi.facts
    .map((f) => (f.fact_text ?? '').trim())
    .filter(Boolean)
    // Telefon/Adresse/GPS nie in den Story-Prompt — sonst liest das Modell sie vor
    .filter(
      (t) =>
        !/\b(tel\.?|telefon|phone|fax)\b/i.test(t) &&
        !/\b0\d{2,5}[\s/-]?\d{3,}/.test(t) &&
        !/\b\d{5}\s+[A-ZÄÖÜ]/i.test(t) &&
        !/\b(-?\d{1,2}\.\d{3,})\s*[,;/]\s*(-?\d{1,3}\.\d{3,})\b/.test(t) &&
        !/\b(lat|lng|lon|koordinate|gps)\b/i.test(t) &&
        // Keine Adress-/Filial-Vorspanne („Peiner Hag 11, 25497…“)
        !/\bfiliale\b.{0,40}\d{1,4}\b/i.test(t) &&
        !/\b(straße|strasse|weg|hag|hof|allee)\s+\d{1,4}\b.{0,20}\d{5}/i.test(
          t,
        ) &&
        !/\b[\wÄÖÜäöüß.-]+(?:straße|strasse|str\.|allee)\s+\d{1,4}[a-zA-Z]?\b/i.test(
          t,
        ),
    )
    .slice(0, 40);

  return {
    id: poi.id,
    name: poi.name,
    category: poi.category ?? null,
    kind: poi.kind ?? null,
    tags: poi.tags_json ?? null,
    teaser_text: poi.teaser_text ?? null,
    facts,
  };
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
      .replace(/^\[(Kurzfakt|Erzählung|Detail|FAQ|Teaser|Hook|Narration|Thema:[^\]]+)\]\s*/iu, '')
      .trim();
    if (plain.length < 36) return false;
    if (/\b(lat|lng|gps|adresse|anschrift|koordinate)\b/i.test(plain)) return false;
    if (/\b(-?\d{1,2}\.\d{3,})\s*[,;/]\s*(-?\d{1,3}\.\d{3,})\b/.test(plain)) {
      return false;
    }
    if (/\b\d{5}\s+[A-ZÄÖÜ]/.test(plain)) return false;
    if (
      /\b[\wÄÖÜäöüß.-]+(?:straße|strasse|str\.|allee|weg)\s+\d{1,4}\b/i.test(plain) &&
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
    // Reine Stimmung ohne Fakt → zählt nicht
    if (
      /^(hier|dort|man|es)\b.{0,40}\b(spür|riech|hör|atmosphäre|aura|geheimnis|mystik)/i.test(
        plain,
      ) &&
      !/\d{3,4}|seit\s+\d|gebaut|gegründet|eröffnet|museum|park|kirche/i.test(plain)
    ) {
      return false;
    }
    return true;
  });
  return substantive.length < 2;
}

function buildUserPrompt(input: {
  poi: PoiWithFacts;
  mode: FindusStoryMode;
  approachAlreadyHeard: boolean;
  profile: UserProfile;
  storyBriefBlock?: string | null;
  deepDive?: boolean;
  interestOverride?: { hookText: string; matched: string } | null;
  allowUserName?: boolean;
}): string {
  const payload = buildPoiPayload(input.poi);
  const engine = resolvePersonaEngine(input.profile);
  const deepDive = Boolean(input.deepDive);
  const override = input.interestOverride;
  const activityVenue = looksLikeActivityVenue(input.poi);
  const thinFacts = isThinModule1FactSet(input.poi);
  const allowUserName = input.allowUserName !== false;
  const firstName = input.profile.firstName?.trim() || '';
  const nameLine = allowUserName && firstName
    ? `- Vorname: höchstens 1× „${firstName}“ in diesem Spot, sonst du/dein.`
    : firstName
      ? `- VORNAME VERBOTEN: nicht „${firstName}“ sagen — nur du/dein/deine.`
      : `- Kein Vorname — nur du/dein/deine.`;

  const thinBlock = thinFacts
    ? `
=== DATENSATZ DÜNN (STRENG) ===
Es gibt kaum echte Fakten zu diesem Ort.
- Maximal 2–4 kurze Sätze: Name, was es ist (wenn belegt), ehrlicher Hinweis dass Details fehlen / LIVE prüfen.
- VERBOTEN: Mystik, Aura, uralte Geheimnisse, „man munkelt“, Koordinaten-Romantik, erfundene Geschichte, Füllwörter, um den heißen Brei.
- Charakter darf Ton haben — aber KEIN Fake-Inhalt. Lieber kurz und ehrlich als lang und leer.
`
    : '';

  const modeLine = deepDive
    ? activityVenue
      ? 'MODUS: MEHR DAZU / Deep-Dive Aktivität. Was man hier macht, Preise/Dauer nur belegt, Tipps, Motivation — am Ort bleiben. Keine Timeline.'
      : 'MODUS: MEHR HISTORIE / Deep-Dive. Alles noch nicht Gesagte zu DIESEM Ort — am Thema bleiben. Keine anderen Orte, keine Timeline, keine Tagesplanung.'
    : override
      ? `MODUS: INTEREST-OVERRIDE. User mag diesen Ortstyp eigentlich nicht — trotzdem ausgelöst wegen Hook „${override.matched}". Meta ehrlich, dann Story NUR zum Hook.`
      : input.mode === 'approach'
        ? 'MODUS: Wegweiser. RICHTUNG (wohin schauen) → VISUELL erkennen → MOTIVATION/Hook (Prefs ehrlich, keine Fake-Versprechen). KEINE volle Story. KURZ.'
        : input.approachAlreadyHeard
          ? activityVenue
            ? 'MODUS: Ankunft nach Wegweiser — KALTSTART: sofort in Aktivität/Heute, Historie nur kurz wenn belegt.'
            : 'MODUS: Ankunft nach Wegweiser — KALTSTART: kein Intro-Schnickschnack, sofort in die HISTORIE. Visuell nur wenn noch nicht gesagt.'
          : activityVenue
            ? 'MODUS: Ankunft Aktivitäts-Ort — Visuell kurz → was man hier macht (Hauptteil) → Preise/Besonderheit nur belegt → Motivation.'
            : 'MODUS: Ankunft Hauptpunkt — Visuell (wie sieht der Ort aus) → volle HISTORIE (früher→Fun→Heute) → was man hier machen kann → optional Nähe ≤50m.';

  const deepDiveBlock = activityVenue
    ? `
=== PFLICHT DEEP-DIVE AKTIVITÄT „MEHR DAZU“ (STRENG) ===
Ziel: Mehrwert fürs Mitmachen — nichts erfinden.

1) Kurz was den Ort besonders macht (nur Datensatz).
2) Aktivität konkret: was man tut, Dauer/Preis/Mitbringen NUR wenn belegt.
3) Charakter-angepasste Motivation am Ende (Energie zum Ausprobieren) — keine Meta-„frag mich“.

VERBOTEN: Adresse/GPS/Tel, erfundene Preise, andere Orte, Timeline, Aufblasen.
LÄNGE: MAXIMAL ${MODULE1_MAIN_MAX_CHARS} Zeichen. Kein Mindestmaß.
`
    : `
=== PFLICHT DEEP-DIVE „MEHR HISTORIE“ (STRENG) ===
Ziel: Alles Bekannte zu DIESEM Ort, das noch fehlt — nichts erfinden.

1) EIN Hook (1 Satz, Du-Perspektive / Sinne) — DANN direkt in die Geschichte. Kein zweites/drittes Intro.
2) Gründungsgeschichte / Entstehung / wer dahintersteckt (nur Datensatz).
3) Was sie genau machen, wieso das cool/spannend ist, Tradition & heute.
4) Was der User HIER tun kann — NUR aus Ort-Angebote/Events im Brief (Recurring, buchen, mitmachen). Profil-Matches zuerst.
5) Optional spannende Details/Anekdoten aus dem Datensatz.

VERBOTEN:
- Andere Museen, Parks, Timeline, „zwei spannende Stationen in der Nähe“, Tagesplan, Explore-Drift.
- Cliché-Opener: „steckt mehr drin als der erste Blick“, „mehr drin als man denkt“, Nutzername, Adress-/Tel-Dump.
- Mehrfach anfangen („Du schaust… / Jetzt sind wir… / Hier stehst du…“ hintereinander).
- Telefonnummern vorlesen.
- Events/Angebote erfinden, die nicht im Datensatz stehen.
- Aufblasen / Mindestlänge — wenig Stoff = kürzer aufhören.

LÄNGE: MAXIMAL ${MODULE1_MAIN_MAX_CHARS} Zeichen. Alles Bekannte, nichts darüber. Kein Mindestmaß.
Keine Markdown-Überschriften, keine Aufzählungszeichen im Audio.
`;

  const overrideBlock = override
    ? `
=== PFLICHT INTEREST-OVERRIDE (STRENG) ===
Hook-Match: „${override.matched}"
Beleg aus Datensatz: ${override.hookText}

1) META (1 kurzer Satz, ehrlich): Du weißt, dass dieser Ortstyp eigentlich nicht sein Ding ist — und sag klar, WARUM du trotzdem auslöst (nur der Hook).
2) Dann gleicher Aufbau wie Hauptpunkt, aber INHALT nur auf diesen Hook: Visuell (kurz) → Historie hinter dem Hook → Heute → was man dazu hier machen kann.
3) KEINE Standard-Gebäude-/Kirchen-/Praxis-Tour. Keine falschen Versprechungen. Nichts erfinden.
LÄNGE: MAXIMAL ${MODULE1_MAIN_MAX_CHARS} Zeichen. Kein Mindestmaß.
`
    : '';

  const dramaturgyBlock = thinFacts
    ? thinBlock
    : deepDive
    ? deepDiveBlock
    : override
      ? overrideBlock
      : input.mode === 'arrival'
        ? activityVenue
          ? `
=== PFLICHT-DRAMATURGIE AKTIVITÄTS-ORT (STRENG) ===
Struktur (Labels NIE aussprechen) — EIN flüssiger Text, MEHRWERT zuerst:

${
  input.approachAlreadyHeard
    ? `KALTSTART: kein zweites Intro — sofort in die Aktivität.`
    : `1) VISUELL kurz — woran man den Ort erkennt, dann Name.`
}

2) LEBEN JETZT (Hauptteil) — was man HIER machen kann NUR aus Ort-Angebote/belegten Fakten:
   - Aktivität klar, was besonders ist
   - Preis / Dauer / Mitbringen NUR wenn im Datensatz belegt — sonst weglassen, nichts erfinden
3) Historie nur kurz, wenn belegt und nützlich — kein Museums-Vortrag über eine Sport-GmbH.
4) ABSCHLUSS: Charakter-angepasste Motivation zum Mitmachen (Energie wie „Bock?“), ohne Meta-Frage und ohne erfundene Zahlen.
VERBOTEN: Adresse, GPS, Koordinaten, Tel, PLZ vorlesen.
LÄNGE: MAXIMAL ${MODULE1_MAIN_MAX_CHARS} Zeichen. Kein Mindestmaß.
`
          : `
=== PFLICHT-DRAMATURGIE MODUL 1 HAUPTPUNKT (STRENG) ===
Struktur exakt in dieser Reihenfolge (Labels NIE aussprechen) — EIN flüssiger Text:

${
  input.approachAlreadyHeard
    ? `KALTSTART (Wegweiser war schon):
0) KEIN Richtungs-Intro, KEIN zweites „schau mal da vorne“, KEIN Schnickschnack.
1) Sofort catchen und in die HISTORIE — Visuell nur nachreichen wenn im Wegweiser NICHT schon gesagt.`
    : `1) VISUELL — wie sieht der Ort JETZT aus? Beschreiben, dann benennen.
   - VERBOTEN: Nutzername, Willkommen-bei, Adress-/Tel-/PLZ-Dump, Cliché „steckt mehr drin…“.`
}

2) HISTORIE (Hauptteil) — alles Bekannte aus dem Datensatz, nichts erfinden:
   - Früher: wann / wie / wo / warum / was passiert ist
   - Fun Facts der alten Geschichte
   - Flüssiger Übergang → HEUTE: was daraus geworden ist, was jetzt passiert
   - Jahreszahlen als Wörter (Dichte nach User-Prefs)

3) LEBEN JETZT — was man HIER machen kann NUR aus Ort-Angebote/belegten Fakten.
   Abschluss: Charakter-angepasste Motivation ok, wenn Angebote belegt.
   VERBOTEN bei Mystik-Persona: Aura/Geheimnis/„man munkelt“ ohne Beleg im Datensatz.

4) NÄHE ≤50 m (optional, ein Halbsatz): wenn ein Nebenpunkt/Nachbar sinnvoll ist — „wenn du willst, wegen …“ — keine Museums-Tour.

5) STADT-/DORFGESCHICHTE (optional): Wenn im Datensatz/Brief ein thematischer Link zur Ortsgeschichte steckt und das noch nicht erzählt wurde — einen flüssigen Halbsatz einweben. Nie erzwingen, nie erfinden.

Wiederhole NICHTS, was im Wegweiser schon gesagt wurde.
LÄNGE: MAXIMAL ${MODULE1_MAIN_MAX_CHARS} Zeichen. Kein Mindestmaß. Keine Markdown-Aufzählungen im Audio.
`
        : input.mode === 'approach'
          ? `
=== WEGWEISER (Approach) — Reihenfolge STRENG ===
1) RICHTUNG ZUERST (GPS/Facing): wohin schauen — rechts/links/geradeaus (Grad-Logik intern, natürlich sprechen).
2) VISUELL erkennen: woran erkennt man den Ort (Gebäude/Fassade/…) — Wort „Wegweiser“ NIE.
3) MOTIVATION / HOOK: wieso hingehen? Bester echter Grund aus dem Datensatz.
   - Prefs des Users ehrlich spiegeln (was er mag).
   - KEINE falschen Versprechungen. Zielgefühl: „da will ich hin“.
   - Kurz teasen — keine volle Historie, kein Spoiler-Dump.
Dann SCHWEIGEN — keine Ja/Nein-Nachfrage.
LÄNGE: wenige Sätze. Wenn User weg vom Hauptort: Text wird nicht gesprochen (Gate).
`
          : '';

  const brief =
    input.storyBriefBlock?.trim()
      ? `\nBeat-Fakten (Pflicht nutzen, nichts erfinden):\n${input.storyBriefBlock.trim()}\n`
      : '';

  const lengthRule = thinFacts
    ? 'LÄNGE: maximal 2–4 Sätze. Kein Aufblasen.'
    : input.mode === 'approach'
      ? 'LÄNGE: Wegweiser kurz — nur Teaser, keine volle Story.'
      : input.deepDive
        ? `LÄNGE (Noch mehr / Deep-Dive): Alles noch nicht Gesagte aus dem Datensatz, erfinde nichts. MAXIMAL ${MODULE1_EXPAND_MAX_CHARS} Zeichen. Am Ort bleiben.`
        : `LÄNGE (Hauptpunkt): Erzähle alles Bekannte aus dem Datensatz, erfinde nichts. MAXIMAL ${MODULE1_MAIN_MAX_CHARS} Zeichen. Kein Mindestmaß — weniger Stoff = kürzer.`;

  return `${modeLine}
${dramaturgyBlock}${brief}
Erstelle das gesprochene Live-Audio-Skript für Findus aus diesen Ort-Daten.
${lengthRule}
Schluss: ${
    thinFacts
      ? 'Ehrlich aufhören — kein Mystik-Nachsatz.'
      : activityVenue
        ? 'Charakter-angepasste Motivation zum Mitmachen (ohne Meta-Frage). Keine „mehr Infos? / was macht besonders?“-Floskeln.'
        : 'still oder ein kurzer Impuls OHNE Frage. Keine Abschlussfragen. Keine „mehr Infos? / was macht besonders?“-Floskeln.'
  }
Nur Fließtext zum Vorlesen. Kein Markdown, keine Labels, keine Aufzählungen, keine leeren Klammern.
Kein „Wenn du keine Fragen mehr hast…“. Keine Adressen/PLZ/Telefon/E-Mail/GPS-Koordinaten.
Kein Nutzername im Text. Kein „Willkommen bei/am …“ als Standardopener.
VERBOTEN am Ende: dich selbst vorschlagen, „frag mich“, Mikro/Einstellungen/Navigation/App-Features anpreisen.
HOOK-REGEL: Erster Satz sinnlich/ortsspezifisch. Kein Essens-Humor an Geldautomaten, Apotheken, Behörden. Jeder Opener frisch aus den Ort-Daten.
Jahreszahlen und Mengen als Wörter. Namen vollständig aussprechen.
VERBOTEN immer: erfundene Geheimnisse, Aura, „Akten im Nebel“, Koordinaten als Mystik.

Nutzer-Kurzprofil (zusätzlich zur System-Instruction):
- Persona: ${engine.persona}, Ton: ${engine.toneStyle}
- Alter: ${engine.age ?? 'unbekannt'}
- Gelernt: ${engine.learnedFacts.slice(0, 8).join('; ') || '—'}
${nameLine}

Ort-Daten:
${JSON.stringify(payload, null, 0)}`;
}

/** Tip-Plan der letzten Story — zum Abhaken nach dem Sprechen. */
let lastFeatureTipPlan: FeatureTipPlan | null = null;

/** Ob der letzte Single-Shot-Lauf von Gemini kam (sonst Offline-general_info). */
let lastStreamFromLlm = false;

export function lastSingleShotUsedLlm(): boolean {
  return lastStreamFromLlm;
}

export function getLastFeatureTipPlan(): FeatureTipPlan | null {
  return getLastNarrationFeatureTipPlan();
}

export async function commitFeatureTipsAfterStory(
  spokenText: string,
): Promise<void> {
  return commitNarrationFeatureTips(spokenText);
}

/**
 * @deprecated Live-Pfad ist module1PoiChat — dieser Export leitet nur noch um,
 * damit keine alten Single-Shot-Prompts mehr laufen können.
 */
export async function* streamFindusStorySentences(
  input: StreamFindusStoryInput,
): AsyncGenerator<string, void, unknown> {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  lastStreamFromLlm = false;
  lastFeatureTipPlan = null;
  warnIfMissingOfflineNarration(input.poi);

  const { streamModule1ChatSentences } = await import('./module1PoiChat');
  const mode = input.deepDive
    ? 'deep'
    : input.mode === 'approach'
      ? 'approach'
      : 'arrival';
  let yielded = false;
  for await (const s of streamModule1ChatSentences({
    poi: input.poi,
    profile,
    mode,
    approachAlreadyHeard: Boolean(input.approachAlreadyHeard),
    timeoutMs: input.timeoutMs,
  })) {
    yielded = true;
    lastStreamFromLlm = true;
    yield s;
  }
  if (yielded) return;

  const offline = extractOfflineGeneralInfo(input.poi);
  if (offline) {
    yield* sentencesFromFullText(offline);
  } else {
    yield 'Hier hab ich offline gerade keine fertige Story parat. Sobald du wieder Netz hast, erzähl ich dir richtig was.';
  }
}

/**
 * Hook/Body-Split für speakTwoPhase.
 * Wartet auf den Gemini-Volltext (RN), yieldet dann Satz 1 sofort als Hook.
 */
export async function beginSingleShotStoryStream(
  input: StreamFindusStoryInput,
): Promise<{
  hook: string;
  bodySentenceStream: AsyncIterable<string>;
  usedLlm: boolean;
  pipeline: 'single-shot-v1';
  masterContext: MasterPromptContext;
}> {
  const masterContext = resolveMasterPromptContext({
    sessionVisitedCount: input.sessionMemory?.entries?.length ?? 1,
    poi: input.poi,
  });

  const iter = streamFindusStorySentences(input)[Symbol.asyncIterator]();
  const first = await iter.next();
  const hook = first.done ? '' : String(first.value ?? '').trim();
  const usedLlm = lastStreamFromLlm;

  async function* rest(): AsyncGenerator<string, void, unknown> {
    if (first.done) return;
    while (true) {
      const next = await iter.next();
      if (next.done) break;
      const t = String(next.value ?? '').trim();
      if (t) yield t;
    }
  }

  return {
    hook,
    bodySentenceStream: rest(),
    usedLlm,
    pipeline: 'module1-poi-chat-v1' as 'single-shot-v1',
    masterContext,
  };
}
