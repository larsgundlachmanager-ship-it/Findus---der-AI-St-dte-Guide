/**
 * Kokoro-kompatible deutsche TTS-Prosodie (regelbasiert, ohne Latenz).
 * Übersetzt die 6 Prosodie-Regeln in Satzzeichen, die eSpeak/Kokoro versteht:
 * - Aufzählungen: Komma → Punkt (Mikro-Pause, kein Hetzen)
 * - Gesprochene Kontraktionen
 * - LLM-Marker ([Pause: …], [ʔ], Pfeile) → bereinigte Interpunktion
 */

/** Gesprochene Kontraktionen für flüssigeren Redefluss. */
const SPOKEN_CONTRACTIONS: [RegExp, string][] = [
  [/\bhaben\s+(wir|ihr|sie|Wir|Ihr|Sie)\b/g, "hab'n $1"],
  [/\b([Hh]at)\s+(er|sie|es)\b/g, "$1 $2"],
  [/\b([Ii]st)\s+es\b/g, "is'es"],
  [/\b([Ww]ar)\s+es\b/g, "war's"],
  [/\b([Ww]ird)\s+es\b/g, "wird's"],
  [/\b([Gg]ibt)\s+es\b/g, "gibt's"],
  [/\b([Mm]achen)\s+wir\b/g, "mach'n wir"],
  [/\b([Gg]ehen)\s+wir\b/g, "geh'n wir"],
  [/\b([Ss]ehen)\s+wir\b/g, "seh'n wir"],
  [/\b([Ee]in)\s+ein\b/g, "ein'n"],
  [/\b([Ee]inen)\s+([A-ZÄÖÜ])/g, "ein'n $2"],
];

/** LLM-Prosodie-Marker → Kokoro-Interpunktion. */
const LLM_MARKER_REPLACEMENTS: [RegExp, string][] = [
  [/\[Pause:\s*800\s*ms\]/gi, '. '],
  [/\[Pause:\s*500\s*ms\]/gi, '. '],
  [/\[Pause:\s*300\s*ms\]/gi, ', '],
  [/\[Pause:\s*250\s*ms\]/gi, '. '],
  [/\[Pause:\s*200\s*ms\]/gi, ', '],
  [/\[ʔ\]/g, ''],
  [/[↓↑→↗↘]/g, ''],
  [/\*{2,}([^*]+)\*{2,}/g, '$1'],
];

/**
 * Aufzählungen: Komma → Punkt für gleichmäßigen Rhythmus.
 * „Apfel, Birne, Traube und Kirsche" → „Apfel. Birne. Traube und Kirsche"
 * „rot, grün, blau" → „rot. grün. blau"
 */
export function applyEnumerationRhythm(text: string): string {
  let s = text;

  // Mit „und"/„oder" am Ende: interne Kommata → Punkte
  s = s.replace(
    /((?:\b[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*)(?:,\s+(?:\b[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*)){1,})\s+(und|oder)\s+(\b[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*)/giu,
    (_match, listPart: string, conj: string, lastItem: string) => {
      const items = listPart.split(/,\s*/).filter(Boolean);
      if (items.length < 2) return _match;
      return `${items.join('. ')} ${conj} ${lastItem}`;
    },
  );

  // Reine Aufzählung ohne Konjunktion (mind. 3 Elemente)
  s = s.replace(
    /\b([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*),\s+([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*),\s+([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*)\b/giu,
    (_match, a: string, b: string, c: string) => `${a}. ${b}. ${c}`,
  );

  return s;
}

/** Gesprochene Kontraktionen einsetzen. */
export function applySpokenContractions(text: string): string {
  let s = text;
  for (const [pattern, replacement] of SPOKEN_CONTRACTIONS) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

/** LLM-Prosodie-Marker in Kokoro-taugliche Form bringen. */
export function stripLlmProsodyMarkers(text: string): string {
  let s = text;
  for (const [pattern, replacement] of LLM_MARKER_REPLACEMENTS) {
    s = s.replace(pattern, replacement);
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Vollständige regelbasierte Prosodie-Pipeline für Kokoro-Audio.
 * Läuft synchron in prepareAudioText — keine LLM-Latenz.
 */
export function applyGermanTtsProsodyRules(text: string): string {
  let s = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!s) return s;

  s = stripLlmProsodyMarkers(s);
  s = applyEnumerationRhythm(s);
  s = applySpokenContractions(s);

  return s.replace(/\s+/g, ' ').trim();
}
