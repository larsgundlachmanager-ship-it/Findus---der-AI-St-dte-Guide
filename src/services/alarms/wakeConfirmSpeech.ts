/**
 * Wecker-Bestätigung — klar, echte Uhrzeit, optional Gute Nacht.
 * Choice: schon ein Wecker → Aktualisieren vs. zweiten.
 * Stimmanweisung → echte TTS-Parameter (nicht Regie-Text).
 */

import type { SpeakVoiceOptions } from '../AudioVoiceService';

export type WakeVoiceStyle = 'normal' | 'gentle';

export function formatWakeClockDe(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  if (m === 0) return `${h} Uhr`;
  return `${h}:${m.toString().padStart(2, '0')} Uhr`;
}

/**
 * Gesprochene Uhrzeit: volle Morgenstunden als „8 Uhr morgens“.
 */
export function formatWakeClockSpoken(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const base = formatWakeClockDe(ms);
  if (m === 0 && h >= 5 && h <= 11) return `${base} morgens`;
  return base;
}

/** Abends/nachts: ein kurzer Abschied — kein Mini-Essay. */
export function shouldAddNightFarewell(nowMs = Date.now()): boolean {
  const h = new Date(nowMs).getHours();
  return h >= 21 || h < 5;
}

export function parseWakeVoiceStyle(text: string): WakeVoiceStyle {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return 'normal';
  if (
    /\b(?:sanft(?:e|er)?|leise(?:r)?|flüster\w*|fluester\w*|ruhig(?:e|er)?|gentle|soft)\b/iu.test(
      t,
    ) &&
    /\b(?:stimme|voice|ton|sprech\w*)\b/iu.test(t)
  ) {
    return 'gentle';
  }
  if (
    /\b(?:mit\s+)?(?:sanft(?:er|e)?|leise(?:r)?|ruhig(?:er|e)?)\s+(?:stimme|voice)\b/iu.test(
      t,
    )
  ) {
    return 'gentle';
  }
  return 'normal';
}

/** Cartesia-Parameter — sanft/leise, nicht als Satz vorlesen. */
export function wakeVoiceSpeakOptions(
  style: WakeVoiceStyle,
): Pick<SpeakVoiceOptions, 'generationConfig' | 'resolveGenerationConfig'> {
  if (style !== 'gentle') return {};
  const cfg = { speed: 0.9, volume: 0.82 };
  return {
    generationConfig: cfg,
    resolveGenerationConfig: () => cfg,
  };
}

/**
 * Bestätigung nur mit der wirklich gesetzten Zeit.
 * Bei Replace: klingt wie „umgestellt“ — technisch Clock = löschen + neu.
 */
export function buildWakeConfirmSpeech(opts: {
  wakeAtMs: number;
  nowMs?: number;
  ok?: boolean;
  includeNightFarewell?: boolean;
  /** Alter Wecker wurde ersetzt */
  replaced?: boolean;
}): string {
  const clock = formatWakeClockSpoken(opts.wakeAtMs);
  if (opts.ok === false) {
    return `Wecker auf ${clock} ging gerade nicht — check kurz die Uhr-App oder Berechtigungen.`;
  }
  let speech = opts.replaced
    ? `Alles klar, ich habe den Wecker auf ${clock} umgestellt.`
    : `Alles klar, ich habe den Wecker auf ${clock} gestellt.`;
  if (
    opts.includeNightFarewell !== false &&
    shouldAddNightFarewell(opts.nowMs ?? Date.now())
  ) {
    speech += ' Gute Nacht.';
  }
  return speech;
}

/**
 * Schon ein Wecker am Tag → ehrlich fragen: Zeit aktualisieren oder zweiten.
 */
export function buildWakeChoiceSpeech(opts: {
  existingWakeAtMs: number;
  newWakeAtMs: number;
}): string {
  const oldClock = formatWakeClockSpoken(opts.existingWakeAtMs);
  const newClock = formatWakeClockSpoken(opts.newWakeAtMs);
  return (
    `Du hast schon einen Wecker auf ${oldClock} gestellt. ` +
    `Willst du die Zeit aktualisieren oder einen zweiten Wecker auf ${newClock} stellen?`
  );
}
