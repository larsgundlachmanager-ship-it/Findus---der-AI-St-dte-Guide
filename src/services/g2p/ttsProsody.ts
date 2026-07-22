/**
 * TTS-Prosodie: sauberer Redefluss wie bei den Hörproben-WAVs.
 * Keine künstlichen Atempausen (…), keine Extra-Puffer.
 * Kommas = kurze natürliche Pausen; Punkt = Satzende.
 */

/** Mischwörter leicht trennen — ohne Ellipsen. */
const COMPOUND_PRONUNCIATION: [RegExp, string][] = [
  [/\bStadt\s*guides?\b/gi, 'Stadtguide'],
  [/\bStadtguide\b/gi, 'Stadtguide'],
  [/\bAudio\s*guides?\b/gi, 'Audioguide'],
  [/\bAudioguide\b/gi, 'Audioguide'],
];

/**
 * Entfernt LLM-/Engine-Atempausen, die Kokoro zäh und geröchelt wirken lassen.
 * Ellipsen, Gedankenstriche, gestapelte Punkte → Komma oder einzelner Punkt.
 */
export function stripArtificialBreathPauses(text: string): string {
  let s = text.normalize('NFKC');
  s = s.replace(/\u2026+/g, ',');
  s = s.replace(/\.{2,}/g, '.');
  s = s.replace(/[\u2010-\u2015―─–—−]+/g, ',');
  s = s.replace(/([!?])\1+/g, '$1');
  s = s.replace(/(\s*,\s*){2,}/g, ', ');
  s = s.replace(/(\s*\.\s*){2,}/g, '. ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Leichte, natürliche Interpunktion — kein Silence-Stacking.
 * Komma bleibt am Wort (kurze Pause); Satzende mit einem Leerzeichen danach.
 */
export function normalizeNaturalPunctuation(text: string): string {
  let s = stripArtificialBreathPauses(text);
  s = s.replace(/\s*,\s*/g, ', ');
  s = s.replace(/\s+([.!?])/g, '$1');
  s = s.replace(/([.!?])(?=\p{L})/gu, '$1 ');
  s = s.replace(/([.!?])\s+/g, '$1 ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Defensive Prosodie für Kokoro — flüssig wie Sample-WAVs.
 * Injiziert KEINE Ellipsen und KEINE Extra-Atemholen-Marker.
 */
export function applyTtsProsodyPolish(text: string): string {
  let s = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!s) return s;

  for (const [pattern, replacement] of COMPOUND_PRONUNCIATION) {
    s = s.replace(pattern, replacement);
  }

  s = stripArtificialBreathPauses(s);
  s = normalizeNaturalPunctuation(s);
  return s;
}
