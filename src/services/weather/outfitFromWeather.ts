/**
 * Outfit-Hinweise aus Wetter — nur Jetzt + Zukunft (Rest des Tages).
 * Keine nachgetragenen Morgenkühle, keine Fake-Abendkälte aus „Hoch−3“.
 * Wortlaut frei für die Synthese; hier nur Fakten/Struktur-Hints.
 */

export type OutfitWeatherInputs = {
  nowTempC: number | null;
  dayHighC: number | null;
  /** Abend/Spätnachmittag nur wenn belegt (Forecast) — nie erfinden */
  eveningTempC?: number | null;
  precipProbPct: number | null;
  windy?: boolean;
  /** Stunde 0–23, Default: jetzt (lokal) */
  hour?: number | null;
};

export type OutfitAdvice = {
  /** Primäre Kleidungs-Hints (für den Tag, nicht nur die erste Stunde) */
  clothingBits: string[];
  /** Kurzer Trend-Satz für FLOW */
  trendHint: string | null;
  dressForTempC: number | null;
  eveningTempC: number | null;
  morningFresher: boolean;
  /** Abend wirklich kühl genug für Extra-Lage (belegt) */
  eveningCool: boolean;
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
 * Anziehen für Jetzt + Rest des Tages.
 * Tageshoch schlägt eine schon warme „Jetzt“-Temperatur nicht nach unten;
 * kühle Vergangenheit (z. B. 6 Uhr) zählt nicht.
 */
export function buildOutfitAdviceFromWeather(
  opts: OutfitWeatherInputs,
): OutfitAdvice {
  const now = opts.nowTempC;
  const high = opts.dayHighC;
  const hour =
    opts.hour != null && Number.isFinite(opts.hour)
      ? Math.min(23, Math.max(0, Math.floor(opts.hour)))
      : new Date().getHours();

  // Anziehen am wärmeren relevanten Wert (Jetzt oder Hoch) — Zukunft, nicht Vergangenheit
  const dressFor =
    high != null && now != null
      ? Math.max(now, high)
      : high ?? now;

  // Extra-Lage morgens nur wenn JETZT wirklich kühl ist und der Vormittag noch läuft
  const morningFresher =
    now != null &&
    high != null &&
    now < 15 &&
    high - now >= 5 &&
    hour < 11;

  // Abend nur übernehmen wenn belegt — nie aus Hoch−3 erfinden (wirkt „frisch“ obwohl 20–25°)
  const eveningRaw =
    opts.eveningTempC != null && Number.isFinite(opts.eveningTempC)
      ? opts.eveningTempC
      : null;
  let evening: number | null = eveningRaw;
  if (evening != null && high != null) {
    evening = Math.min(evening, high);
  }
  // „Abend kühl“ nur bei echtem Kühlegefühl — nicht bei 20–22°
  const eveningCool =
    evening != null &&
    evening < 16 &&
    (now == null || evening <= now - 3);

  const clothingBits: string[] = [];
  if (opts.windy || (opts.precipProbPct != null && opts.precipProbPct >= 35)) {
    clothingBits.push('Wind-/Regenjacke sinnvoll');
  }

  if (dressFor == null) {
    clothingBits.push('Schichten — flexibel bleiben');
  } else if (dressFor >= 22) {
    clothingBits.push('leichte Kleidung reicht');
    if (morningFresher) {
      clothingBits.push(
        'jetzt noch etwas frischer — dünne Jacke ok, später ablegen; kein dicker Pulli',
      );
    }
  } else if (dressFor >= 18) {
    clothingBits.push('eher leicht (kurze Hose / T-Shirt ok)');
    if (morningFresher) {
      clothingBits.push(
        'jetzt noch etwas kühler — leichte Jacke oder Überwurf, später ablegen',
      );
    }
  } else if (dressFor >= 14) {
    clothingBits.push('Übergangsjacke / Schichten');
    if (morningFresher && high != null && high >= 18) {
      clothingBits.push('wird tagsüber wärmer — nicht überziehen');
    }
  } else if (dressFor >= 8) {
    clothingBits.push('wärmere Jacke / Pulli');
  } else {
    clothingBits.push('richtig warm anziehen');
  }

  if (eveningCool && evening != null) {
    clothingBits.push(
      `Abend deutlich kühler (~${Math.round(evening)}°C) — Extra-Lage für später`,
    );
  }

  let trendHint: string | null = null;
  if (now != null && high != null && high - now >= 3) {
    trendHint = morningFresher
      ? `Jetzt ~${Math.round(now)}°C, später bis ~${Math.round(high)}°C — Outfit am Tageshoch ausrichten; jetzt nur leichte Extra-Lage.`
      : `Jetzt ~${Math.round(now)}°C, im Laufe des Tages bis ~${Math.round(high)}°C — leichte Kleidung reicht, keine Jacke nur wegen früherer Morgenkühle.`;
  } else if (high != null && now != null) {
    trendHint = `Jetzt ~${Math.round(now)}°C, Tageshoch ca. ${Math.round(high)}°C.`;
  } else if (high != null) {
    trendHint = `Tageshoch ca. ${Math.round(high)}°C.`;
  } else if (now != null) {
    trendHint = `Aktuell ~${Math.round(now)}°C.`;
  }

  return {
    clothingBits,
    trendHint,
    dressForTempC: dressFor != null ? Math.round(dressFor) : null,
    eveningTempC: evening != null ? Math.round(evening) : null,
    morningFresher,
    eveningCool,
  };
}
