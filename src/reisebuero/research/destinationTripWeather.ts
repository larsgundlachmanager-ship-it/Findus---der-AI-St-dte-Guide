/**
 * Ziel-Wetter für Magazin: Forecast (≤16 Tage) oder typisches Klima (Archiv Vorjahr).
 * Open-Meteo, soft — nie Fake-Gradzahlen.
 */

export type DestTripWeather = {
  line: string;
  highC: number;
  lowC: number;
  kind: 'forecast' | 'typical';
  condition: string;
  emoji: string;
};

function wmoLabel(code: number | null): string {
  if (code == null) return 'wechselhaft';
  if (code === 0) return 'klar';
  if (code <= 3) return 'leicht bewölkt';
  if (code <= 48) return 'neblig';
  if (code <= 57) return 'Nieselregen';
  if (code <= 67) return 'Regen';
  if (code <= 77) return 'Schnee';
  if (code <= 82) return 'Schauer';
  if (code <= 99) return 'Gewitter';
  return 'wechselhaft';
}

function wmoEmoji(code: number | null): string {
  if (code == null) return '🌡️';
  if (code === 0) return '☀️';
  if (code <= 3) return '🌤️';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 99) return '⛈️';
  return '🌡️';
}

function parseYmd(s?: string | null): string | null {
  const t = (s || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

function daysFromToday(ymd: string): number {
  const t = Date.parse(`${ymd}T12:00:00Z`);
  if (!Number.isFinite(t)) return 999;
  const now = Date.now();
  return Math.floor((t - now) / 86_400_000);
}

function shiftYear(ymd: string, deltaYears: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${y! + deltaYears}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

type DailyPack = {
  time: string[];
  tmax: number[];
  tmin: number[];
  codes: number[];
};

function pickDays(pack: DailyPack, start: string, end: string): {
  highs: number[];
  lows: number[];
  codes: number[];
} {
  const highs: number[] = [];
  const lows: number[] = [];
  const codes: number[] = [];
  for (let i = 0; i < pack.time.length; i++) {
    const day = (pack.time[i] || '').slice(0, 10);
    if (day < start || day > end) continue;
    const hi = Number(pack.tmax[i]);
    const lo = Number(pack.tmin[i]);
    const code = Number(pack.codes[i]);
    if (Number.isFinite(hi)) highs.push(hi);
    if (Number.isFinite(lo)) lows.push(lo);
    if (Number.isFinite(code)) codes.push(code);
  }
  return { highs, lows, codes };
}

function modeCode(codes: number[]): number | null {
  if (!codes.length) return null;
  const counts = new Map<number, number>();
  for (const c of codes) counts.set(c, (counts.get(c) || 0) + 1);
  let best = codes[0]!;
  let n = 0;
  for (const [c, k] of counts) {
    if (k > n) {
      best = c;
      n = k;
    }
  }
  return best;
}

function formatLine(opts: {
  highC: number;
  lowC: number;
  code: number | null;
  kind: 'forecast' | 'typical';
}): DestTripWeather {
  const high = Math.round(opts.highC);
  const low = Math.round(opts.lowC);
  const condition = wmoLabel(opts.code);
  const emoji = wmoEmoji(opts.code);
  const range = low === high ? `${high}°` : `${low}–${high}°`;
  const prefix = opts.kind === 'typical' ? 'typisch ' : '';
  const line = `${emoji} ${prefix}${range} · ${condition}`.slice(0, 48);
  return {
    line,
    highC: high,
    lowC: low,
    kind: opts.kind,
    condition,
    emoji,
  };
}

async function fetchDailyJson(url: string): Promise<DailyPack | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        weather_code?: number[];
      };
    };
    const time = data.daily?.time ?? [];
    if (!time.length) return null;
    return {
      time,
      tmax: data.daily?.temperature_2m_max ?? [],
      tmin: data.daily?.temperature_2m_min ?? [],
      codes: data.daily?.weather_code ?? [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wetterzeile für Magazin-Hero/Cover. Soft null bei Netz/Fehler.
 */
export async function fetchDestinationTripWeather(opts: {
  lat: number;
  lng: number;
  dateStart?: string | null;
  dateEnd?: string | null;
}): Promise<DestTripWeather | null> {
  if (!Number.isFinite(opts.lat) || !Number.isFinite(opts.lng)) return null;
  const start = parseYmd(opts.dateStart) || parseYmd(new Date().toISOString());
  if (!start) return null;
  const end = parseYmd(opts.dateEnd) || start;
  const startOk = end < start ? start : start;
  const endOk = end < start ? start : end;
  const lead = daysFromToday(startOk);

  // Forecast-Fenster Open-Meteo ~16 Tage
  if (lead >= -1 && lead <= 15) {
    const u = new URL('https://api.open-meteo.com/v1/forecast');
    u.searchParams.set('latitude', String(opts.lat));
    u.searchParams.set('longitude', String(opts.lng));
    u.searchParams.set(
      'daily',
      'weather_code,temperature_2m_max,temperature_2m_min',
    );
    u.searchParams.set('forecast_days', '16');
    u.searchParams.set('timezone', 'auto');
    const pack = await fetchDailyJson(u.toString());
    if (pack) {
      const picked = pickDays(pack, startOk, endOk);
      if (picked.highs.length && picked.lows.length) {
        const highC = Math.max(...picked.highs);
        const lowC = Math.min(...picked.lows);
        return formatLine({
          highC,
          lowC,
          code: modeCode(picked.codes),
          kind: 'forecast',
        });
      }
    }
  }

  // Typisches Klima: gleiche Daten vor einem Jahr (Archiv)
  const aStart = shiftYear(startOk, -1);
  const aEnd = shiftYear(endOk, -1);
  const u = new URL('https://archive-api.open-meteo.com/v1/archive');
  u.searchParams.set('latitude', String(opts.lat));
  u.searchParams.set('longitude', String(opts.lng));
  u.searchParams.set('start_date', aStart);
  u.searchParams.set('end_date', aEnd);
  u.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min',
  );
  u.searchParams.set('timezone', 'auto');
  const pack = await fetchDailyJson(u.toString());
  if (!pack) return null;
  const picked = pickDays(pack, aStart, aEnd);
  if (!picked.highs.length || !picked.lows.length) return null;
  const highC =
    picked.highs.reduce((a, b) => a + b, 0) / picked.highs.length;
  const lowC = picked.lows.reduce((a, b) => a + b, 0) / picked.lows.length;
  return formatLine({
    highC,
    lowC,
    code: modeCode(picked.codes),
    kind: 'typical',
  });
}

/** Pure Format-Hilfe für Smokes. */
export function formatDestWeatherLine(opts: {
  highC: number;
  lowC: number;
  weatherCode?: number | null;
  kind?: 'forecast' | 'typical';
}): string {
  return formatLine({
    highC: opts.highC,
    lowC: opts.lowC,
    code: opts.weatherCode ?? 0,
    kind: opts.kind ?? 'forecast',
  }).line;
}
