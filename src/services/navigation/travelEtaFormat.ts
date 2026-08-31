/**
 * Dauer menschenfreundlich — nie „200 Minuten“ / „742 Minuten“.
 * Reines Modul (ohne RN), SSOT für Speech + Stichpunkte.
 */

const HOUR_WORD_DE: Record<number, string> = {
  1: 'eine',
  2: 'zwei',
  3: 'drei',
  4: 'vier',
  5: 'fünf',
  6: 'sechs',
  7: 'sieben',
  8: 'acht',
  9: 'neun',
  10: 'zehn',
  11: 'elf',
  12: 'zwölf',
};

function roundDurationMinutes(raw: number): number {
  if (raw < 20) return raw;
  if (raw < 60) return Math.round(raw / 5) * 5;
  if (raw < 180) return Math.round(raw / 5) * 5;
  return Math.round(raw / 15) * 15;
}

function speechHoursCompound(h: number, rest: number): string | null {
  if (rest >= 20 && rest <= 40 && h >= 1 && h <= 12) {
    if (h === 1) return 'eineinhalb Stunden';
    const w = HOUR_WORD_DE[h];
    if (w) return `${w}einhalb Stunden`;
  }
  return null;
}

/**
 * Ab 60 Min: Stunden + Viertel (eine Stunde 15, eineinhalb, zweieinhalb).
 * short: „ca. 45 Min“ / „ca. 1 Std 15“
 * speech: „etwa 45 Minuten“ / „eine Stunde 15“ / „gut eineinhalb Stunden“
 */
export function formatDurationMinutesDe(
  mins: number,
  style: 'short' | 'speech' = 'short',
): string {
  const raw = Math.max(1, Math.round(Number(mins) || 1));
  const m = roundDurationMinutes(raw);

  if (style === 'speech') {
    if (m < 60) return `etwa ${m} Minuten`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    const half = speechHoursCompound(h, rest);
    if (half) {
      return h === 1 ? `gut ${half}` : half;
    }
    if (rest === 0) {
      return h === 1 ? 'etwa eine Stunde' : `rund ${h} Stunden`;
    }
    if (rest <= 10) {
      return h === 1 ? 'gut eine Stunde' : `rund ${h} Stunden`;
    }
    if (rest >= 50) {
      return h === 1 ? 'knapp 2 Stunden' : `rund ${h + 1} Stunden`;
    }
    if (h === 1 && rest === 15) return 'eine Stunde 15';
    if (h === 1 && rest === 45) return 'eine Stunde 45';
    if (h === 1) return `eine Stunde ${rest}`;
    return `${h} Stunden ${rest}`;
  }

  if (m < 60) return `ca. ${m} Min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (rest === 0) return `ca. ${h} Std`;
  if (rest === 30 && h >= 1) return `ca. ${h}½ Std`;
  return `ca. ${h} Std ${rest} Min`;
}

/** Offener Aufenthalt: „22 Std 9 Min“, nie „1329 Min“. */
export function formatDwellSinceDe(mins: number): string {
  const raw = Math.max(1, Math.round(Number(mins) || 1));
  if (raw < 60) return `${raw} Min`;
  const h = Math.floor(raw / 60);
  const rest = raw % 60;
  if (rest < 8) return h === 1 ? '1 Std' : `${h} Std`;
  if (rest >= 52) return `${h + 1} Std`;
  return `${h} Std ${rest} Min`;
}
