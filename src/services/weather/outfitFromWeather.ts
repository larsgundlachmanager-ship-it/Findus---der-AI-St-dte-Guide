/**
 * Outfit-Hinweise aus Wetter — Tagesverlauf vor „nur Jetzt-Wert“.
 * Wortlaut frei für die Synthese; hier nur Fakten/Struktur-Hints.
 */

export type OutfitWeatherInputs = {
  nowTempC: number | null;
  dayHighC: number | null;
  /** Abend/Spätnachmittag, falls bekannt — sonst abgeleitet */
  eveningTempC?: number | null;
  precipProbPct: number | null;
  windy?: boolean;
};

export type OutfitAdvice = {
  /** Primäre Kleidungs-Hints (für den Tag, nicht nur die erste Stunde) */
  clothingBits: string[];
  /** Kurzer Trend-Satz für FLOW */
  trendHint: string | null;
  dressForTempC: number | null;
  eveningTempC: number | null;
  morningFresher: boolean;
};

function parseDayHighFromText(blob: string): number | null {
  const m =
    blob.match(/Tageshoch[^\d-]{0,24}(-?\d+(?:[.,]\d+)?)\s*°/i) ||
    blob.match(/heute\s+bis\s+(-?\d+(?:[.,]\d+)?)\s*°/i);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseNowTempFromSummary(summary: string): number | null {
  const m = summary.match(/Aktuell\s+(-?\d+(?:[.,]\d+)?)\s*°/i);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Temp + Tageshoch aus Snapshot-Zeilen (falls Felder fehlen). */
export function extractTempsFromWeatherText(opts: {
  summaryLine?: string | null;
  promptBlock?: string | null;
  currentTempC?: number | null;
  dayHighC?: number | null;
}): { nowTempC: number | null; dayHighC: number | null } {
  const blob = `${opts.summaryLine ?? ''}\n${opts.promptBlock ?? ''}`;
  const now =
    opts.currentTempC ??
    (opts.summaryLine ? parseNowTempFromSummary(opts.summaryLine) : null);
  const high = opts.dayHighC ?? parseDayHighFromText(blob);
  return { nowTempC: now, dayHighC: high };
}

/**
 * Anziehen für den Tag: Tageshoch / typische Tagestemperatur schlägt
 * die erste kühle Morgenstunde (kein dicker Pulli nur wegen 10-Uhr-Wert).
 */
export function buildOutfitAdviceFromWeather(
  opts: OutfitWeatherInputs,
): OutfitAdvice {
  const now = opts.nowTempC;
  const high = opts.dayHighC;
  const dressFor =
    high != null && now != null
      ? Math.max(now, high)
      : high ?? now;
  const morningFresher =
    now != null &&
    high != null &&
    high - now >= 4 &&
    new Date().getHours() < 14;

  let evening =
    opts.eveningTempC ??
    (high != null
      ? Math.round(high - 3)
      : now != null
        ? Math.round(now - 1)
        : null);
  if (evening != null && high != null) {
    // Abend nicht kälter rechnen als sinnvoll — nie „jetzt−2“ als Fake-Abend
    evening = Math.min(evening, high);
  }

  const clothingBits: string[] = [];
  if (opts.windy || (opts.precipProbPct != null && opts.precipProbPct >= 35)) {
    clothingBits.push('Wind-/Regenjacke sinnvoll');
  }

  if (dressFor == null) {
    clothingBits.push('Schichten — flexibel bleiben');
  } else if (dressFor >= 22) {
    clothingBits.push('leichte Kleidung reicht tagsüber');
    if (morningFresher) {
      clothingBits.push(
        'morgens nur kurz frischer — dünne Jacke mitnehmen, kein dicker Pulli',
      );
    }
  } else if (dressFor >= 18) {
    clothingBits.push('tagsüber eher leicht (kurze Hose / T-Shirt ok)');
    if (morningFresher) {
      clothingBits.push(
        'erste Stunde etwas frischer — leichte Jacke oder Überwurf, später ablegen',
      );
    } else {
      clothingBits.push('leichte Schicht reicht oft');
    }
  } else if (dressFor >= 14) {
    clothingBits.push('Übergangsjacke / Schichten');
    if (morningFresher && high != null && high >= 18) {
      clothingBits.push(
        'nicht für den kühlen Start überziehen — es wird tagsüber wärmer',
      );
    }
  } else if (dressFor >= 8) {
    clothingBits.push('wärmere Jacke / Pulli');
  } else {
    clothingBits.push('richtig warm anziehen');
  }

  let trendHint: string | null = null;
  if (now != null && high != null && high - now >= 3) {
    trendHint = `Jetzt ~${Math.round(now)}°C, im Laufe des Tages bis ~${Math.round(high)}°C — Outfit am Tageshoch ausrichten, morgens nur eine leichte Extra-Lage.`;
  } else if (high != null) {
    trendHint = `Tageshoch bis Abend ca. ${Math.round(high)}°C — danach anziehen.`;
  } else if (now != null) {
    trendHint = `Aktuell ~${Math.round(now)}°C.`;
  }

  return {
    clothingBits,
    trendHint,
    dressForTempC: dressFor != null ? Math.round(dressFor) : null,
    eveningTempC: evening,
    morningFresher,
  };
}
