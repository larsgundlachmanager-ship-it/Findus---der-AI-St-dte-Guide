/**
 * Modul-1 Prompt-Texte (Reboot) — System + Turn-Aufgaben.
 * Voller Review: docs/modul1-prompt-preview.md
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import {
  buildMasterSystemInstruction,
  resolveMasterPromptContext,
  resolvePersonaEngine,
} from '../personaEngine';
import type { Module1LookCue } from '../navigation/module1Facing';
import { formatModule1LookCueForPrompt } from '../navigation/module1Facing';
import { FINDUS_MODULE1_IMMERSIVE_STORY_BLOCK } from '../concierge/findusResponsePolicy';
import { extractPlaceOffers, formatPlaceOffersForPrompt } from '../poi/placeOffers';
import { formatModule1CharacterVoice } from '../persona/personalityMatrixPrompt';
import {
  isThinModule1FactSet,
  MODULE1_BRIEF_MAX_CHARS,
  MODULE1_EXPAND_MAX_CHARS,
  MODULE1_MAIN_MAX_CHARS,
} from './singleShotStory';

/** Pack-Fakten, die das Heute anfassbar machen — Öffnung, Preis, Exponat, Programm. */
const LEBEN_JETZT_FACT_RE =
  /\b(geöffnet|geoeffnet|öffnung|oeffnung|öffnungszeit|oeffnungszeit|bis\s+\d{1,2}(?::\d{2})?\s*uhr|eintritt|ticketpreis|\d+\s*€|€\s*\d|\d+\s*euro|ausstellung|exponat|führung|fuehrung|rundgang|spielplan|aufführung|auffuehrung|heute\s+abend|saisonal|live\s*:)/i;

function lebenJetztFactsBlock(poi: PoiWithFacts): string {
  const facts = (poi.facts ?? [])
    .map((f) => (f.fact_text ?? '').trim())
    .filter(Boolean)
    .filter((t) => LEBEN_JETZT_FACT_RE.test(t))
    .filter(
      (t) =>
        !/\b(tel\.?|telefon|phone|fax|adresse|anschrift|gps|lat|lng|lon)\b/i.test(t),
    )
    .slice(0, 8);
  if (!facts.length) {
    return 'LEBEN-JETZT-BELEGE: (keine Öffnung/Preis/Programm/Exponat im Pack — nichts erfinden; LIVE-Block nutzen falls vorhanden)';
  }
  return `LEBEN-JETZT-BELEGE (Payoff der Historie — nur diese, nichts erfinden; Uhrzeit/Preis/Titel aussprechen wenn hier oder im LIVE-Block):\n${facts
    .map((t, i) => `${i + 1}. ${t}`)
    .join('\n')}`;
}

export type Module1ChatMode =
  | 'approach'
  | 'arrival'
  | 'deep'
  | 'followup';

function packFactsBlock(poi: PoiWithFacts): string {
  const facts = (poi.facts ?? [])
    .map((f) => (f.fact_text ?? '').trim())
    .filter(Boolean)
    .filter(
      (t) =>
        !/\b(tel\.?|telefon|phone|fax)\b/i.test(t) &&
        !/\b0\d{2,5}[\s/-]?\d{3,}/.test(t) &&
        !/\b(lat|lng|lon|koordinate|gps)\b/i.test(t),
    );
  if (!facts.length) return '(keine Facts im Pack)';
  return facts.map((t, i) => `${i + 1}. ${t}`).join('\n');
}

function prefsSummary(profile: UserProfile): {
  yes: string;
  no: string;
  want: string;
  line: string;
} {
  const prefs = profile.experiencePrefs ?? {};
  const yes = Object.entries(prefs)
    .filter(([, v]) => v === 'yes')
    .map(([k]) => k)
    .slice(0, 12);
  const no = Object.entries(prefs)
    .filter(([, v]) => v === 'no')
    .map(([k]) => k)
    .slice(0, 8);
  const want = (profile.wantToExperience ?? '').trim().slice(0, 160);
  return {
    yes: yes.join(', ') || '—',
    no: no.join(', ') || '—',
    want: want || '—',
    line: `gerne: ${yes.join(', ') || '—'} · eher nicht: ${no.join(', ') || '—'}`,
  };
}

export function buildModule1SystemInstruction(
  profile: UserProfile,
  opts?: { deepDive?: boolean },
): string {
  return buildMasterSystemInstruction(
    profile,
    resolveMasterPromptContext({
      sessionVisitedCount: 1,
      module1Narration: true,
      module1DeepDive: Boolean(opts?.deepDive),
      featureTipsBlock:
        '=== APP-POTENZIAL ===\n- VERBOTEN: dich selbst / die App vorschlagen. Kein „frag mich“.',
      relatedBridgeBlock:
        '- Verwandte Orte: NICHT im Audio auflisten. Die App zeigt Buttons.',
    }),
  );
}

export function buildModule1SeedUserMessage(input: {
  poi: PoiWithFacts;
  profile: UserProfile;
  mode: 'approach' | 'arrival';
  lookCue?: Module1LookCue | null;
  mustSayFacts?: string[];
}): string {
  const engine = resolvePersonaEngine(input.profile);
  const prefs = prefsSummary(input.profile);
  const thin = isThinModule1FactSet(input.poi);
  const mustSay =
    input.mustSayFacts && input.mustSayFacts.length
      ? `\nMUST_SAY (ab 3 User-Fragen priorisiert — einbauen wenn passend):\n${input.mustSayFacts.map((t) => `- ${t}`).join('\n')}\n`
      : '';

  const lookBlock = input.lookCue
    ? formatModule1LookCueForPrompt(input.lookCue)
    : 'RICHTUNG_CODE: lookPhrase: "vor dir" (Facing unklar)';

  const offers = extractPlaceOffers(input.poi, input.profile);
  const dataset = `=== VOLLER ORT-DATENSATZ (einmalig für diesen Chat) ===
Name: ${input.poi.name}
Kategorie: ${input.poi.category ?? '—'}
Kind: ${input.poi.kind ?? '—'}
Tags: ${input.poi.tags_json ?? '—'}
teaser_text: ${(input.poi.teaser_text ?? '').trim() || '—'}

Facts / deep_data_pool:
${packFactsBlock(input.poi)}
${mustSay}
${lebenJetztFactsBlock(input.poi)}

${formatPlaceOffersForPrompt(offers)}
${input.mode === 'approach' ? '\nHINWEIS: Im aktuellen WEGWEISER-Turn Angebote/Preise/Programm NICHT erwähnen — erst in der Hauptstory als Payoff.\n' : ''}
Datensatz dünn: ${thin ? 'JA — max 2–4 ehrliche Sätze, kein Aufblasen' : 'nein'}`;

  if (input.mode === 'approach') {
    return `=== CHAT-SEED FÜR DIESEN ORT ===
Ab jetzt bist du im Gesprächskontext GENAU dieses Ortes.
Merke dir den kompletten Datensatz unten für alle späteren Turns.
Du bekommst den Datensatz in diesem Chat nicht noch einmal.

=== AUFGABE JETZT: WEGWEISER / ANNÄHERUNG ===
GENAU 2 SÄTZE — dann fertig. Gleich zu Fuß und Rad.

SATZ 1 — Richtung + Distanz + visuelles Erkennen (ein Satz, flüssig):
- Nutze EISERN lookSpeech (lookPhrase + Distanz aus distToHauptM). Nicht spiegeln, nicht raten.
- Wenn pathHint gesetzt: Richtung an diesem Landmark ausrichten („Richtung Haltestelle / Kirche / …“), nicht nur links/rechts wiederholen.
- Sofort danach: woran JEDER den Ort in 2 Sekunden erkennt — NUR aus Datensatz.
- Mindestens 2 konkrete Merkmale: Farbe/Material (Ziegel, Glas, Holz), Form (Turm, Kuppel, Giebel), Größe/Höhe-Gefühl, Schild/Schriftzug, typisches Detail (Uhr, Fahne, Brücke, Hafenkran).
- Beschreiben bevor Name (wenn noch nicht klar). Kein vages „das Gebäude da“ / „Haupteingang“ ohne sichtbares Merkmal.
- pathHint nur nutzen wenn gesetzt — keine erfundenen Straßennamen.

SATZ 2 — Motivation / TikTok-Teaser-Hook:
- EIN klarer Hook (~2 Sekunden Hörzeit). Bester echter Grund aus dem Datensatz — WARUM hingehen.
- Kategorie/Laden-Typ höchstens einmal kurz; NICHT 2–3× erklären „was für ein Laden das ist“.
- Prefs ehrlich (vor allem was der User mag). Kein Spoiler der ganzen Historie.
- Keine Fake-Versprechen. Dann schweigen — keine Frage.
- Nie das Wort „Wegweiser“. Nie „soll ich navigieren?“ — Route-Button + Karte kommen von der App.

${lookBlock}

NUTZER FÜR DEN HOOK
- Mag u.a.: ${prefs.yes}
- Will erleben: ${prefs.want}

Persona: ${engine.persona}, Ton: ${engine.toneStyle}
${formatModule1CharacterVoice(input.profile)}

${dataset}

=== AUSGABE ===
Nur die 2 gesprochenen Sätze. Nichts sonst.`;
  }

  return `=== CHAT-SEED FÜR DIESEN ORT ===
(Direkt-Ankunft ohne Wegweiser — Datensatz einmalig.)

=== AUFGABE: HAUPTSTORY / ANKUNFT ===
Struktur: Visuell → User ist Teil der Geschichte → flüssige Brücke (derselbe Fleck) → Leben jetzt als Payoff (anfassbar, nur belegt).
Max ${MODULE1_MAIN_MAX_CHARS} Zeichen. Nichts erfinden. Kein Mindestmaß.
Keine Adresse/Tel/GPS. Kein App-Pitch. Keine Abschlussfrage.

${FINDUS_MODULE1_IMMERSIVE_STORY_BLOCK}

Persona: ${engine.persona}, Ton: ${engine.toneStyle}
${formatModule1CharacterVoice(input.profile)}
Prefs: ${prefs.line}

${dataset}

=== AUSGABE ===
Nur den gesprochenen Fließtext.`;
}

export function buildModule1ArrivalInstruction(input: {
  approachAlreadyHeard: boolean;
  activityVenue?: boolean;
  /** Theater/Kino/Museum/Konzert — Programm + Preis einbauen */
  programVenue?: boolean;
  /** Großraum (Altstadt, Insel, Straße) — kein „schau über 150 ha“ */
  largeAreaVenue?: boolean;
  profile?: UserProfile | null;
  /** brief = Name + Zusammenfassung (Settings Kurzantworten); full = immersiv (Default) */
  storyMode?: 'brief' | 'full';
}): string {
  const voice = input.profile
    ? `\n${formatModule1CharacterVoice(input.profile)}\n`
    : '';
  const brief = (input.storyMode ?? 'full') === 'brief';

  if (brief) {
    return `=== NEUE AUFGABE: HAUPTSTORY / ANKUNFT (KURZANTWORT) ===
Der komplette Datensatz und die Regeln stehen bereits in diesem Chat.
Kein erneuter Datensatz-Dump.

KALTSTART:
- Wegweiser schon gehört: ${input.approachAlreadyHeard ? 'ja' : 'nein'}.
- Wenn ja: KEIN zweites Richtungs-Intro.
- VERBOTEN als Einstieg: Meta-Geschichts-Marketing („hier flüstert Geschichte“…).

STRUKTUR (Labels nie sagen) — NUR:
1) NAME des Orts klar nennen (nach kurzem sichtbaren Detail ok).
2) ZUSAMMENFASSUNG: worum es geht + was man hier jetzt erleben/tun kann — belegt, umgangssprachlich.
Kein langer Historie-Roman. Kein Mindestmaß. Max ${MODULE1_BRIEF_MAX_CHARS} Zeichen.
„Mehr Historie“ / Vertiefung kommt später per Button — hier nicht vorwegnehmen.
${voice}
${
  input.programVenue
    ? 'Programm-Venue: nur heute/morgen belegt — Titel/Preis knapp wenn da.'
    : input.activityVenue
      ? 'Aktivität: Fokus Mitmachen/Besonderheit nur belegt — kurz.'
      : 'Kultur: ein prägnanter Kern, kein Aufsatz.'
}
${
  input.largeAreaVenue
    ? 'GROSSRAUM: was HIER vor Ort zählt — kein Flächenmaß als Blickbefehl.'
    : ''
}

=== AUSGABE ===
Nur Fließtext: Name + kurze Zusammenfassung.`;
  }

  return `=== NEUE AUFGABE: HAUPTSTORY / ANKUNFT ===
Der komplette Datensatz und die Regeln stehen bereits in diesem Chat.
Kein erneuter Datensatz-Dump.

KALTSTART:
- Wegweiser schon gehört: ${input.approachAlreadyHeard ? 'ja' : 'nein'}.
- Wenn ja: KEIN zweites Richtungs-Intro. Sofort in die Geschichte.
- VERBOTEN als Einstieg (auch ohne Wegweiser-Kaltstart): „hier flüstert Geschichte“,
  „richtig Geschichte“, „rollt Geschichte“, „Tüt-tüt … Schienen“, „nimm dir einen Moment — Geschichte“.
  Direkt mit sichtbarem Detail oder Fakt starten — kein Meta-Geschichts-Marketing.
- Moderne Orte (Schule/Neubau < ~30 Jahre): nicht als „uralte Geschichte“ verkaufen;
  Fokus auf was belegt ist (Baujahr, Kooperation, Nutzen heute).
- TEASER-HOOK: Irgendwo mittendrin (nicht zwingend am Anfang) den Hook
  vom Wegweiser einlösen — dramaturgisch wo es am besten passt.
  Hauptsache: in dieser Story einlösen.
${
  input.largeAreaVenue
    ? `- GROSSRAUM (Altstadt/Insel/Straße/UNESCO-Fläche): User kann nicht „alles auf einmal sehen“. Einstieg = was HIER vor Ort sichtbar/relevant ist (Fassade, Platz, ein markantes Detail) — nie Flächenmaß („150 Hektar“) als Blickbefehl.`
    : ''
}

ZIEL / ANPEILEN (Ortstyp darf dosieren — Labels nie sagen):
1) HISTORIE ~65 % — Geschichte zum Anfassen: User ist TEIL davon, spannend, viele belegte Fakten,
   keine Floskeln, kein Rumreden. Der User soll kleben bleiben und Neues lernen.
2) FLÜSSIGER ÜBERGANG + AKTUELLES ~25 % — was geht JETZT am Ort (nur belegt: Programm, Ausstellung, Betrieb).
3) REST — was man HIER jetzt konkret machen/sehen/anfassen kann (Offers/LIVE nur belegt).
Aktivität/Sport: Historie kürzer, Mitmachen stärker. Modernes Café: kein Pseudo-Epos.
Persönlichkeits-Matrix färbt Stimme/Anrede/Tempo — Struktur bleibt.

${FINDUS_MODULE1_IMMERSIVE_STORY_BLOCK}
${voice}
${
  input.programVenue
    ? 'ORTSTYP Programm-Venue (Theater/Kino/Museum/Konzert/Aktivität): Historie mittel + sinnlich (nicht zu dünn wenn Stoff da ist); LEBEN JETZT als Payoff. PROGRAMM nur HEUTE oder maximal MORGEN — nie „irgendwann / nächste Woche / Demnächst-unbestimmt“. Kino: Prefs (mag User Kino?) und Wetter ehrlich mitdenken (schönes Wetter → Kino eher leiser anbieten; schlecht → eher). Preise, Titel und worum es geht aussprechen wenn belegt. Kontrast früher↔heute nur mit Beleg.'
    : input.activityVenue
      ? 'ORTSTYP activity: Historie kürzer; Leben-jetzt stärker — trotzdem zweite Person am Ort, nicht wie eine Preisliste.'
      : 'ORTSTYP Kultur/Kirche/Museum: Historie dominiert, User mittendrin; Heute = Payoff (anfassbar, nur belegt).'
}

LÄNGE: ziel nahe ${MODULE1_MAIN_MAX_CHARS} wenn Stoff; max ${MODULE1_MAIN_MAX_CHARS}; kein Aufblasen, kein Mindestmaß.
Wegweiser-Sätze nicht 1:1 wiederholen.

=== AUSGABE ===
Nur Fließtext Hauptstory.`;
}

export function buildModule1DeepInstruction(input: {
  activityVenue?: boolean;
  profile?: UserProfile | null;
}): string {
  const voice = input.profile
    ? `\n${formatModule1CharacterVoice(input.profile)}\n`
    : '';
  return `=== NEUE AUFGABE: MEHR HISTORIE / VERTIEFUNG ===
Gleicher Ort. Datensatz + bisherige Turns im Chat.

ZIEL: Datensatz ausschöpfen bis max ${MODULE1_EXPAND_MAX_CHARS} Zeichen.
Fakten weglassen die den Bogen sprengen.
Wenn der Teaser-Hook in der Hauptstory schon voll aufgelöst wurde:
kein Hook-Ritual — nur neues Material.
Wenn etwas nur angerissen war: kurz ankern, dann deutlich tiefer.
Gleicher immersiver Stil: User ist Teil der Geschichte, Historie anfassbar, Brücke → Heute als Payoff nur belegt — in der gewählten Charakter-Stimme.
Max ${MODULE1_EXPAND_MAX_CHARS} Zeichen; kein Aufblasen ohne Stoff.

${FINDUS_MODULE1_IMMERSIVE_STORY_BLOCK}
${voice}
${input.activityVenue ? 'Modus „Mehr dazu“: Mitmachen/Preise nur belegt — sinnlich, nicht bürokratisch.' : ''}
Am Ort bleiben. Kein Explore-Drift. Charakter-Stimme aus Matrix gilt weiter.

=== AUSGABE ===
Nur Fließtext.`;
}

export function buildModule1FollowupInstruction(
  userQuestion: string,
  extras?: { placeVerifyBlock?: string | null },
): string {
  const q = userQuestion.trim();
  const verify = (extras?.placeVerifyBlock || '').trim();
  return `=== NEUE AUFGABE: RÜCKFRAGE ZU DIESEM ORT ===
USER-FRAGE (wörtlich):
„${q}“

ABLAUF:
1) Zuerst 1 kurze, klare Antwort.
2) Dann 2–8 Sätze Ausbau — NUR Bezug zu dieser Frage (kein Themen-Drift).
3) Fun-Fact nur wenn belegt und zur Frage passend.
4) Fehlt etwas im Datensatz: nichts erfinden — die App recherchiert ggf. parallel.
${verify ? `\n${verify}\n` : ''}
Max 500 Zeichen. Fließtext. Kein App-Pitch.

=== AUSGABE ===
Nur die gesprochene Antwort.`;
}
