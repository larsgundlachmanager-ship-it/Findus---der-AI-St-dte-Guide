/**
 * Live-Chat Endpointing — adaptive Stable-Delay + Soft-Commit-Konstanten.
 * Stadt-/Wortlaut-agnostisch: nur Struktur (Länge, offenes Ende, Klarheit).
 */

/** Default / Standard-Utterance */
export const ENDPOINT_BASE_MS = 450;
/** Kurze klare Turns („Ja.“ / „Wetter?“) */
export const ENDPOINT_FAST_MS = 350;
/** Offenes Ende / Denkpause („und dann…“, „ähm…“) */
export const ENDPOINT_SLOW_MS = 800;
/**
 * Nach Stable: kurze Gnadenfrist — wenn User doch weiterredet, Cut abbrechen.
 * Verhindert False Cuts ohne den Base-Delay wieder auf 700 zu heben.
 */
export const SOFT_COMMIT_MS = 160;
/** Klare Satzenden: kürzere Gnadenfrist */
export const SOFT_COMMIT_CLEAR_MS = 90;
/** VAD: so lange unter Schwelle, bevor Stille „echt“ zählt */
export const MIN_VAD_SILENCE_MS = 220;
/** Nach Mic-Resume: Volume ignorieren (TTS-Nachhall / Speaker-Echo) */
export const VAD_WARMUP_MS = 450;
/** Längerer Warmup wenn Mic während TTS wieder aufgeht */
export const VAD_ECHO_WARMUP_MS = 750;

const OPEN_TRAIL =
  /\b(und|oder|also|ähm|ah|äh|hm+|dann|weil|dass|daß|mit|von|zu|für|nach|aber|noch|bzw)\s*[.,]?\s*$/iu;
const CLEAR_END = /[?!…]\s*$/u;
const PERIOD_END = /\.\s*$/u;
const SHORT_ACK =
  /^(ja|nein|nee|nö|ok|okay|klar|danke|super|genau|richtig|passt|gut|weiter|stopp)\b/iu;
/** Frage-/Imperativ-Start ohne Satzzeichen (STT liefert oft keins). */
const CLEAR_START =
  /^(wo|was|wie|wann|wer|welch\w*|wieso|warum|gibt\s+es|kannst\s+du|kann\s+ich|zeig|zeig\s+mir|such|suche|finde|bring|f[uü]hr|navigier|geh|lauf|start|stopp|erz[aä]hl|erkl[aä]r|sag|mach|hilf|check|pr[uü]f)\b/iu;
/** Kurze Uhrzeit-Antworten auf Rückfragen („20:10“, „um 20 Uhr“). */
const BARE_CLOCK_RE =
  /^(?:um\s+|gegen\s+)?\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?\.?$/iu;
/**
 * Kurze Slot-Antworten auf Concierge-/Flug-Rückfragen
 * („Handgepäck“, „Aufgabegepäck“, „ÖPNV“, „Taxi“, „heute“).
 */
const SHORT_SLOT_ANSWER_RE =
  /^(?:(?:nur\s+)?handgep[äa]ck|(?:mit\s+)?aufgabegep[äa]ck|(?:mit\s+)?koffer|cabin\s*bag|checked\s*bag|öpnv|oepnv|taxi|uber|transfer|heute|morgen|mehr\s+puffer|weniger\s+puffer|puffer\s+passt(?:\s+so)?)\.?$/iu;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Adaptive Stable-Zeit bis Soft-Commit / Cut. */
export function computeEndpointDelayMs(text: string): number {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return ENDPOINT_BASE_MS;
  const words = wordCount(t);

  if (OPEN_TRAIL.test(t)) return ENDPOINT_SLOW_MS;

  if (words <= 4 && (CLEAR_END.test(t) || SHORT_ACK.test(t))) {
    return ENDPOINT_FAST_MS;
  }
  if (SHORT_SLOT_ANSWER_RE.test(t) || BARE_CLOCK_RE.test(t)) {
    return ENDPOINT_FAST_MS;
  }
  if (words <= 8 && CLEAR_END.test(t)) return ENDPOINT_FAST_MS;
  if (words >= 6 && PERIOD_END.test(t) && !OPEN_TRAIL.test(t)) {
    return ENDPOINT_FAST_MS;
  }
  // Unpunktierte Fragen/Befehle: nicht auf Lärm-VAD warten
  if (words >= 3 && CLEAR_START.test(t)) return ENDPOINT_FAST_MS;
  if (words >= 6 && !OPEN_TRAIL.test(t)) return ENDPOINT_FAST_MS;

  // Lange Monologe: etwas Geduld, aber nicht zurück auf 700+
  if (words >= 20) return Math.min(ENDPOINT_SLOW_MS, ENDPOINT_BASE_MS + 120);

  return ENDPOINT_BASE_MS;
}

/**
 * User ist klar fertig → VAD-Stille-Wait überspringen (sonst hängt Cut bei Lärm).
 * Offenes Ende („und…“) nie forcen.
 * STT liefert oft kein ?/. → Struktur reicht (Fragewort, Imperativ, genug Wörter).
 */
export function looksLikeFinishedUtterance(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2) return false;
  if (OPEN_TRAIL.test(t)) return false;
  if (CLEAR_END.test(t)) return true;
  if (SHORT_ACK.test(t) && wordCount(t) <= 4) return true;
  if (BARE_CLOCK_RE.test(t)) return true;
  if (SHORT_SLOT_ANSWER_RE.test(t)) return true;
  if (PERIOD_END.test(t) && wordCount(t) >= 4) return true;
  const words = wordCount(t);
  // Unpunktierte, aber klare Turns (häufigster STT-Fall)
  if (words >= 3 && CLEAR_START.test(t)) return true;
  if (words >= 6) return true;
  if (words >= 4 && /\b(bitte|danke|heute|jetzt|hier|in\s+der\s+n[aä]he)\b/iu.test(t)) {
    return true;
  }
  return false;
}

export function softCommitMsForText(text: string): number {
  return looksLikeFinishedUtterance(text) ? SOFT_COMMIT_CLEAR_MS : SOFT_COMMIT_MS;
}
