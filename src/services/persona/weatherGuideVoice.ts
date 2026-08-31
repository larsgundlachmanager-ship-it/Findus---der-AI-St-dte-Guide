/**
 * Wetter-Speech: Matrix-färbt Opener/Hooks — kein LLM, aber gleiche Stimme wie Call-2.
 * Nur constants — kein personalityMatrixPrompt (vermeidet schwere Import-Kette in Smoke-Tests).
 */

import type { CoreRoleId, VibeToneId } from '../../constants/personalityMatrix';

export type WeatherGuideMatrix = {
  coreRole: CoreRoleId;
  vibeTone?: VibeToneId;
};

export function weatherOpenerFromMatrix(opts: {
  matrix?: WeatherGuideMatrix | null;
  cityHint?: string | null;
}): string {
  const role = opts.matrix?.coreRole ?? 'classic_guide';
  const vibe = opts.matrix?.vibeTone ?? 'balanced';
  const city = (opts.cityHint || '').replace(/\s+/g, ' ').trim();
  const serious = vibe === 'serious';

  if (serious && role === 'classic_guide') {
    return city
      ? `Kurz zum Wetter in ${city}:`
      : 'Kurz zum Wetter heute:';
  }

  switch (role) {
    case 'buddy':
      return city ? `Kurz zum Wetter in ${city}:` : 'Kurz zum Wetter heute:';
    case 'heartfelt_oldie':
      return city
        ? `Mal schauen, wie es heute in ${city} aussieht:`
        : 'Mal schauen, wie es heute so aussieht:';
    case 'aristocrat':
      return city
        ? `In ${city} präsentiert sich das Wetter so:`
        : 'Das Wetter heute stellt sich so dar:';
    case 'nerd':
      return city ? `Datenlage für ${city}:` : 'Kurz die Wetterlage:';
    case 'innocent_child':
      return city ? `Schau mal, in ${city}:` : 'Schau mal, heute:';
    case 'classic_guide':
    default:
      return city ? `Also, in ${city} sieht es so aus:` : 'Also, kurz für heute:';
  }
}

export function weatherTimelineLineFromMatrix(
  hints: string[],
  matrix?: WeatherGuideMatrix | null,
): string | null {
  const timelineRaw = hints.slice(0, 2).filter(Boolean);
  if (!timelineRaw.length) return null;

  const role = matrix?.coreRole ?? 'classic_guide';
  if (timelineRaw.length === 1) {
    const h = timelineRaw[0]!.replace(/\.$/, '');
    if (role === 'buddy') return `Und zu deinem Plan: ${h}.`;
    if (role === 'heartfelt_oldie') return `Und für deinen Plan: ${h}.`;
    if (role === 'aristocrat') return `Bezogen auf deinen Plan: ${h}.`;
    return `Ach, und zu deinem Plan: ${h}.`;
  }
  const joined = timelineRaw.join(' ').replace(/\s+/g, ' ').trim();
  if (role === 'buddy') return `Zu deinem Plan: ${joined}`;
  if (role === 'heartfelt_oldie') return `Kurz zu deinem Tagesplan: ${joined}`;
  return `Kurz zu deinem Plan: ${joined}`;
}
