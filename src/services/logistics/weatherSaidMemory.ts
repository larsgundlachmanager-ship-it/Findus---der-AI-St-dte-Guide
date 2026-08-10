/**
 * Wetter-Aussagen der letzten 30 Min — keine Wiederholung („regnet in Strömen“).
 * (früher module2 — bleibt für Modul-4 Weather-Tracker)
 */

const WINDOW_MS = 30 * 60_000;

type WeatherSaid = {
  atMs: number;
  summaryKey: string;
  speechSnippet: string;
};

const said: WeatherSaid[] = [];

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\wäöüß]+/giu, ' ')
    .trim()
    .slice(0, 80);
}

export function noteWeatherSaid(speech: string, summary?: string): void {
  const now = Date.now();
  const key = normalizeKey(summary || speech);
  if (!key) return;
  said.push({
    atMs: now,
    summaryKey: key,
    speechSnippet: speech.slice(0, 120),
  });
  while (said.length && now - said[0]!.atMs > WINDOW_MS) said.shift();
  while (said.length > 12) said.shift();
}

export function wasWeatherThemeSaidRecently(
  theme: string,
  withinMs = WINDOW_MS,
): boolean {
  const now = Date.now();
  const t = normalizeKey(theme);
  if (!t) return false;
  return said.some((s) => {
    if (now - s.atMs > withinMs) return false;
    if (s.summaryKey.includes(t) || t.includes(s.summaryKey.slice(0, 20))) {
      return true;
    }
    const weatherish =
      /regen|ström|sturm|sonne|wind/i.test(s.summaryKey) &&
      /regen|ström|sturm|sonne|wind/i.test(t);
    return weatherish;
  });
}

export function formatWeatherSaidForPrompt(): string {
  const now = Date.now();
  const recent = said.filter((s) => now - s.atMs <= WINDOW_MS);
  if (!recent.length) return '';
  return [
    '=== WETTER BEREITS GESAGT (letzte 30 Min — NICHT wiederholen) ===',
    ...recent.map((s) => `· ${s.speechSnippet}`),
    'Erwähne Regen/Sturm nur wenn NEU oder sich die Lage geändert hat.',
  ].join('\n');
}
