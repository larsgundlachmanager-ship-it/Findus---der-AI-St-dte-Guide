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
import { isThinModule1FactSet } from './singleShotStory';

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

  const dataset = `=== VOLLER ORT-DATENSATZ (einmalig für diesen Chat) ===
Name: ${input.poi.name}
Kategorie: ${input.poi.category ?? '—'}
Kind: ${input.poi.kind ?? '—'}
Tags: ${input.poi.tags_json ?? '—'}
teaser_text: ${(input.poi.teaser_text ?? '').trim() || '—'}

Facts / deep_data_pool:
${packFactsBlock(input.poi)}
${mustSay}
Datensatz dünn: ${thin ? 'JA — max 2–4 ehrliche Sätze, kein Aufblasen' : 'nein'}`;

  if (input.mode === 'approach') {
    return `=== CHAT-SEED FÜR DIESEN ORT ===
Ab jetzt bist du im Gesprächskontext GENAU dieses Ortes.
Merke dir den kompletten Datensatz unten für alle späteren Turns.
Du bekommst den Datensatz in diesem Chat nicht noch einmal.

=== AUFGABE JETZT: WEGWEISER / ANNÄHERUNG ===
GENAU 2 SÄTZE — dann fertig. Gleich zu Fuß und Rad.

SATZ 1 — Richtung + visuelles Erkennen (ein Satz, flüssig):
- Nutze EISERN die Code-Vorgabe lookPhrase (nicht spiegeln, nicht raten).
- Sofort danach: woran man den Ort erkennt — NUR aus Datensatz.
- Beschreiben bevor Name (wenn noch nicht klar).
- pathHint nur nutzen wenn gesetzt — keine erfundenen Straßennamen.

SATZ 2 — Motivation / TikTok-Teaser-Hook:
- Neugierig machen (~2 Sekunden Hörzeit). Bester echter Hook aus dem Datensatz.
- Prefs ehrlich (vor allem was der User mag). Kein Spoiler der ganzen Historie.
- Keine Fake-Versprechen. Dann schweigen — keine Frage.

${lookBlock}

NUTZER FÜR DEN HOOK
- Mag u.a.: ${prefs.yes}
- Will erleben: ${prefs.want}

Persona: ${engine.persona}, Ton: ${engine.toneStyle}

${dataset}

=== AUSGABE ===
Nur die 2 gesprochenen Sätze. Nichts sonst.`;
  }

  return `=== CHAT-SEED FÜR DIESEN ORT ===
(Direkt-Ankunft ohne Wegweiser — Datensatz einmalig.)

=== AUFGABE: HAUPTSTORY / ANKUNFT ===
Struktur: Visuell → Historie (~70 %) → Leben jetzt (~30 %).
Max 1200 Zeichen. Nichts erfinden. Kein Mindestmaß.
Keine Adresse/Tel/GPS. Kein App-Pitch. Keine Abschlussfrage.

Persona: ${engine.persona}, Ton: ${engine.toneStyle}
Prefs: ${prefs.line}

${dataset}

=== AUSGABE ===
Nur den gesprochenen Fließtext.`;
}

export function buildModule1ArrivalInstruction(input: {
  approachAlreadyHeard: boolean;
  activityVenue?: boolean;
}): string {
  return `=== NEUE AUFGABE: HAUPTSTORY / ANKUNFT ===
Der komplette Datensatz und die Regeln stehen bereits in diesem Chat.
Kein erneuter Datensatz-Dump.

KALTSTART:
- Wegweiser schon gehört: ${input.approachAlreadyHeard ? 'ja' : 'nein'}.
- Wenn ja: KEIN zweites Richtungs-Intro. Sofort in die Geschichte.
- TEASER-HOOK: Irgendwo mittendrin (nicht zwingend am Anfang) den Hook
  vom Wegweiser einlösen — dramaturgisch wo es am besten passt.
  Hauptsache: in dieser Story einlösen.

STRUKTUR (Labels nie sagen):
1) Einstieg — nach Wegweiser sofort Historie; sonst Visuell→Name.
2) HISTORIE (~70 % wenn Stoff): wann/wie/wo/warum, Gründe, Personen, Fun —
   flüssig → HEUTE und warum es heute so ist.
3) LEBEN JETZT (~30 %): rein/mitmachen, Touren/Events/Tickets nur belegt.
4) Nähe ≤50 m optional ein Halbsatz.

${input.activityVenue ? 'ORTSTYP activity: Historie nicht weglassen wenn Stoff da; Leben-jetzt stärker.' : 'ORTSTYP Kultur/Kirche/Museum: Historie dominiert.'}

LÄNGE: ziel 800–1200 wenn Stoff; max 1200; kein Aufblasen.
Wegweiser-Sätze nicht 1:1 wiederholen.

=== AUSGABE ===
Nur Fließtext Hauptstory.`;
}

export function buildModule1DeepInstruction(input: {
  activityVenue?: boolean;
}): string {
  return `=== NEUE AUFGABE: MEHR HISTORIE / VERTIEFUNG ===
Gleicher Ort. Datensatz + bisherige Turns im Chat.

ZIEL: Datensatz ausschöpfen bis max 3000 Zeichen.
Fakten weglassen die den Bogen sprengen.
Wenn der Teaser-Hook in der Hauptstory schon voll aufgelöst wurde:
kein Hook-Ritual — nur neues Material.
Wenn etwas nur angerissen war: kurz ankern, dann deutlich tiefer.

${input.activityVenue ? 'Modus „Mehr dazu“: Mitmachen/Preise nur belegt.' : ''}
Am Ort bleiben. Kein Explore-Drift. Persona-Stil aus System gilt weiter.

=== AUSGABE ===
Nur Fließtext.`;
}

export function buildModule1FollowupInstruction(userQuestion: string): string {
  const q = userQuestion.trim();
  return `=== NEUE AUFGABE: RÜCKFRAGE ZU DIESEM ORT ===
USER-FRAGE (wörtlich):
„${q}“

ABLAUF:
1) Zuerst 1 kurze, klare Antwort.
2) Dann 2–8 Sätze Ausbau — NUR Bezug zu dieser Frage (kein Themen-Drift).
3) Fun-Fact nur wenn belegt und zur Frage passend.
4) Fehlt etwas im Datensatz: nichts erfinden — die App recherchiert ggf. parallel.
Max 1200 Zeichen. Fließtext. Kein App-Pitch.

=== AUSGABE ===
Nur die gesprochene Antwort.`;
}
