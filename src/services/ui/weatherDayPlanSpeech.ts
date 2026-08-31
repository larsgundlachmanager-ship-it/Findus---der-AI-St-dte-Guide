/**
 * Wetter-HUD Speech-Bausteine (kein RN).
 * Struktur, nicht Pflichtsätze — nie „nur eine Idee / nichts festgehalten“.
 */

import { buildOutfitAdviceFromWeather } from '../weather/outfitFromWeather';
import type { WeatherGuideMatrix } from '../persona/weatherGuideVoice';
import {
  weatherOpenerFromMatrix,
  weatherTimelineLineFromMatrix,
} from '../persona/weatherGuideVoice';

export type WeatherChatSnap = {
  currentTempC?: number | null;
  dayHighC?: number | null;
  precipitationMm?: number | null;
  nextRainProb?: number | null;
  rainStartsInMin?: number | null;
  nextRainAtMs?: number | null;
  summaryLine?: string | null;
  isHeavyRain?: boolean;
  tomorrowSummary?: string | null;
  nightLowC?: number | null;
  weatherCode?: number | null;
  sunsetMs?: number | null;
  rainWindows?: Array<{ startMs: number; endMs: number; pop: number }>;
};

export type InvitePoi = {
  name: string;
  lat: number;
  lng: number;
  kind?: string | null;
  category?: string | null;
  tags_json?: string | null;
};

function formatHm(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function roundDeg(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n);
}

function rainHowHard(
  snap: WeatherChatSnap | null,
  heavy: boolean,
  soon: boolean,
): string {
  const mm = snap?.precipitationMm;
  const prob = snap?.nextRainProb ?? 0;
  const inMin = snap?.rainStartsInMin;
  if (heavy || (typeof mm === 'number' && mm >= 2)) {
    return 'Das ist kein Niesel — richtig nass.';
  }
  if (typeof mm === 'number' && mm >= 0.6) {
    return 'Ziemlich nass, nicht nur ein paar Tropfen.';
  }
  if (soon && inMin != null && inMin <= 90) {
    if (prob >= 70) {
      return `Ab so in ${inMin} Minuten wird's nass, eher Schauer als Tropfen.`;
    }
    return `In etwa ${inMin} Minuten kann's nass werden.`;
  }
  if (soon && snap?.nextRainAtMs) {
    return `Später, so gegen ${formatHm(snap.nextRainAtMs)}, sieht's nach Regen aus.`;
  }
  if (prob >= 40) {
    return 'Schauer möglich — nichts Dramatisches, aber nicht staubtrocken.';
  }
  return 'Bleibt erstmal trocken.';
}

/** Flüssiges Wetter: Himmel + Temp + Regen + leichter Kleidungstipp. */
export function formatWeatherChat(opts: {
  snap: WeatherChatSnap | null;
  heavy: boolean;
  soon: boolean;
}): string {
  const snap = opts.snap;
  const nowT = roundDeg(snap?.currentTempC);
  const highT = roundDeg(snap?.dayHighC);
  const sky = skyPhraseFromCode(snap?.weatherCode);
  const rain = rainHowHard(snap, opts.heavy, opts.soon);
  const tip = clothingTipFromSnap(snap);
  const bits: string[] = [];
  if (sky && nowT != null && highT != null && highT > nowT + 1) {
    bits.push(
      `Gerade eher ${sky}, so um die ${nowT} Grad — bis heute Nachmittag Richtung ${highT}.`,
    );
  } else if (nowT != null && highT != null && highT > nowT + 1) {
    bits.push(
      `Gerade so um die ${nowT} Grad, bis heute Nachmittag Richtung ${highT}.`,
    );
  } else if (sky && highT != null) {
    bits.push(`Heute eher ${sky}, Spitze so um die ${highT} Grad.`);
  } else if (highT != null) {
    bits.push(`Heute Spitze so um die ${highT} Grad.`);
  } else if (nowT != null) {
    bits.push(
      sky
        ? `Gerade eher ${sky}, so um die ${nowT} Grad.`
        : `Gerade so um die ${nowT} Grad.`,
    );
  } else if (sky) {
    bits.push(`Gerade eher ${sky}.`);
  }
  bits.push(rain);
  if (tip) bits.push(`Von der Kleidung her: ${tip}.`);
  const line = bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return line || snap?.summaryLine?.trim() || 'Wetter hab ich gerade nicht frisch.';
}

function skyPhraseFromCode(code: number | null | undefined): string | null {
  if (code == null || !Number.isFinite(code)) return null;
  // OpenWeather condition ids (200–804)
  if (code >= 200) {
    if (code === 800) return 'klar / Sonne';
    if (code >= 801 && code <= 802) return 'Wolken und Sonne';
    if (code >= 803 && code <= 804) return 'bewölkt';
    if (code >= 200 && code < 300) return 'Gewitter';
    if (code >= 300 && code < 400) return 'Niesel';
    if (code >= 500 && code < 600) return 'Regen';
    if (code >= 600 && code < 700) return 'Schnee';
    if (code >= 700 && code < 800) return 'diesig';
    return null;
  }
  // WMO (Open-Meteo 0–99)
  if (code === 0) return 'klar / Sonne';
  if (code <= 3) return 'Wolken und Sonne';
  if (code <= 48) return 'neblig';
  if (code <= 57) return 'Niesel';
  if (code <= 67) return 'Regen';
  if (code <= 77) return 'Schnee';
  if (code <= 82) return 'Schauer';
  if (code <= 99) return 'Gewitter';
  return null;
}

function clothingTipFromSnap(snap: WeatherChatSnap | null): string {
  const advice = buildOutfitAdviceFromWeather({
    nowTempC: snap?.currentTempC ?? null,
    dayHighC: snap?.dayHighC ?? null,
    precipProbPct: snap?.nextRainProb ?? null,
  });
  const wet =
    Boolean(snap?.isHeavyRain) ||
    (typeof snap?.precipitationMm === 'number' && snap.precipitationMm >= 0.4) ||
    (typeof snap?.nextRainProb === 'number' && snap.nextRainProb >= 40) ||
    (typeof snap?.rainStartsInMin === 'number' && snap.rainStartsInMin <= 180);
  if (wet) return 'leichte Regenjacke mitnehmen';
  const bit = (advice.clothingBits ?? []).find(Boolean);
  if (bit) return bit.replace(/\.$/, '').slice(0, 48);
  const high = roundDeg(snap?.dayHighC);
  if (high != null && high >= 20) return 'locker und luftig reicht';
  if (high != null && high >= 14) return 'leichte Lage, evtl. dünne Jacke';
  return 'Schichten — etwas Wärmeres dabei';
}

/** Morgen-Vorhersage locker — nur mit belegtem tomorrowSummary. */
export function formatTomorrowWeatherChat(snap: WeatherChatSnap | null): {
  speech: string;
  bullets: string[];
} {
  const raw = (snap?.tomorrowSummary ?? '').trim();
  if (!raw) {
    return { speech: '', bullets: [] };
  }
  const tempM = raw.match(/(-?\d+)\s*[–\-]\s*(-?\d+)\s*°/);
  const untilM = raw.match(/bis\s+(-?\d+)\s*°/i);
  const skyM = raw.match(
    /(klar|Sonne|bewölkt|Wolken|Regen|Schauer|Niesel|Gewitter|Schnee|diesig)[^,]*/i,
  );
  const rainM = raw.match(/Regenrisiko\s+(\d+)\s*%/i);
  const sky = skyM?.[0]?.trim() || 'wechselhaft';
  let tempBit: string | null = null;
  if (tempM) {
    tempBit = `${tempM[1]} bis ${tempM[2]} Grad`;
  } else if (untilM) {
    tempBit = `bis so um die ${untilM[1]} Grad`;
  }
  const rainBit =
    rainM && Number(rainM[1]) >= 30
      ? Number(rainM[1]) >= 60
        ? `Mit Regen solltest du rechnen (so um die ${rainM[1]} Prozent).`
        : `Schauer möglich, so um die ${rainM[1]} Prozent.`
      : 'Weitgehend trocken sieht gut aus.';
  const tip = clothingTipFromSnap({
    ...snap,
    dayHighC: tempM ? Number(tempM[2]) : untilM ? Number(untilM[1]) : snap?.dayHighC,
    nextRainProb: rainM ? Number(rainM[1]) : snap?.nextRainProb,
  });

  const speech = [
    `Morgen wird's ${sky.toLowerCase()}`,
    tempBit ? `Temperaturen liegen ungefähr ${tempBit}` : null,
    rainBit,
    tip ? `Von der Kleidung her: ${tip}` : null,
  ]
    .filter(Boolean)
    .join('. ')
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();

  const bullets = [
    sky.charAt(0).toUpperCase() + sky.slice(1),
    tempBit
      ? tempM
        ? `${tempM[1]}–${tempM[2]}°`
        : untilM
          ? `~${untilM[1]}°`
          : tempBit
      : raw.split(',')[0]?.trim() || 'Temperatur offen',
    tip,
  ].filter(Boolean) as string[];

  return { speech, bullets: bullets.slice(0, 3) };
}

function mergeRainWindows(
  windows: Array<{ startMs: number; endMs: number; pop: number }>,
  nowMs: number,
): Array<{ startMs: number; endMs: number; pop: number }> {
  const sorted = windows
    .filter((w) => w.endMs > nowMs && w.startMs < nowMs + 18 * 3600_000)
    .sort((a, b) => a.startMs - b.startMs);
  const merged: Array<{ startMs: number; endMs: number; pop: number }> = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.startMs <= last.endMs + 45 * 60_000) {
      last.endMs = Math.max(last.endMs, w.endMs);
      last.pop = Math.max(last.pop, w.pop);
    } else {
      merged.push({ startMs: w.startMs, endMs: w.endMs, pop: w.pop });
    }
  }
  return merged;
}

function rainTodayLine(
  snap: WeatherChatSnap | null,
  nowMs: number,
  heavy: boolean,
  soon: boolean,
): string {
  const story = rainStoryLine(snap, nowMs, heavy, snap?.nextRainProb ?? 0);
  if (story) return story;
  return rainHowHard(snap, heavy, soon);
}

function outfitLine(snap: WeatherChatSnap | null, nowMs: number): string | null {
  const hour = new Date(nowMs).getHours();
  if (hour >= 11) return null;
  const advice = buildOutfitAdviceFromWeather({
    nowTempC: snap?.currentTempC ?? null,
    dayHighC: snap?.dayHighC ?? null,
    precipProbPct: snap?.nextRainProb ?? null,
    hour,
  });
  const bits = (advice.clothingBits ?? []).filter(Boolean).slice(0, 2);
  if (!bits.length) return null;
  return `Outfit: ${bits.join(', ')}.`;
}

function humanSkyPhrase(sky: string | null | undefined): string | null {
  if (!sky) return null;
  const s = sky.toLowerCase();
  if (/klar|sonne/.test(s) && !/wolke/.test(s)) return 'Sonnenschein';
  if (/wolken und sonne|leicht bewölkt/.test(s)) return 'Wolken und Sonne';
  if (/bewölkt|bedeckt/.test(s)) return 'bewölktem Himmel';
  if (/regen|schauer/.test(s)) return 'nasser Luft';
  if (/gewitter/.test(s)) return 'Gewitterstimmung';
  if (/nebel|diesig/.test(s)) return 'diesigem Wetter';
  if (/schnee/.test(s)) return 'Schneeluft';
  // „bei Wolken und Sonne“ / „bei bewölktem Himmel“
  return sky.replace(/^klar \/ sonne$/i, 'Sonnenschein');
}

function skyHudAdjective(sky: string | null | undefined): string {
  if (!sky) return 'wechselhaft';
  const s = sky.toLowerCase();
  if (/klar|sonne/.test(s) && !/wolke/.test(s)) return 'sonnig';
  if (/wolken und sonne|leicht/.test(s)) return 'wechselhaft';
  if (/bewölkt|bedeckt/.test(s)) return 'bewölkt';
  if (/regen|schauer|nass/.test(s)) return 'nass';
  if (/gewitter/.test(s)) return 'gewittrig';
  return 'wechselhaft';
}

/**
 * Tap auf Wetter-HUD: voller Tagesbericht.
 * Ab 16 Uhr + morgen (nur belegt). Bis 11 Uhr Outfit.
 * Wortlaut frei, leere Slots stumm.
 */
/** Kompakte Live-HUD-Zeile — menschlicher Mini-Bericht, kein nacktes „18°“. */
export function formatWeatherHudCard(opts: {
  snap: WeatherChatSnap | null;
  nowMs?: number;
}): { title: string; meta?: string } | null {
  const snap = opts.snap;
  if (!snap) return null;
  const nowMs = opts.nowMs ?? Date.now();
  const nowT = roundDeg(snap.currentTempC);
  const highT = roundDeg(snap.dayHighC);
  const skyRaw =
    skyPhraseFromCode(snap.weatherCode) ??
    (snap.summaryLine
      ? snap.summaryLine
          .replace(/^aktuell\s*-?\d+\s*°\s*[·,|\-–]?\s*/i, '')
          .split(/\s*[·|]\s*/)[0]
          ?.trim()
      : null);
  const adj = skyHudAdjective(skyRaw);
  const rainingNow =
    Boolean(snap.isHeavyRain) ||
    (typeof snap.precipitationMm === 'number' && snap.precipitationMm >= 0.4);
  const emoji = rainingNow
    ? '🌧'
    : /sonnig|klar/.test(adj)
      ? '☀️'
      : /bewölkt|wechselhaft/.test(adj)
        ? '⛅'
        : '🌤';

  let title: string;
  if (nowT != null) {
    title = `${emoji} Heute ${adj} · ${nowT}°`;
  } else {
    title = `${emoji} Heute ${adj}`;
  }

  const metaBits: string[] = [];
  if (highT != null && (nowT == null || highT >= nowT + 2)) {
    metaBits.push(`bis ${highT}°`);
  }
  const win = mergeRainWindows(snap.rainWindows ?? [], nowMs)[0];
  if (rainingNow) {
    metaBits.push('regnet gerade');
  } else if (win && win.startMs > nowMs) {
    metaBits.push(`Regen ab ${formatHm(win.startMs)}`);
  } else if ((snap.nextRainProb ?? 0) < 30 && !snap.isHeavyRain) {
    metaBits.push('bleibt trocken');
  } else if (snap.rainStartsInMin != null && snap.rainStartsInMin <= 90) {
    metaBits.push(`Regen in ~${snap.rainStartsInMin} Min`);
  }
  const hour = new Date(nowMs).getHours();
  const nightT = roundDeg(snap.nightLowC);
  if (!metaBits.length && hour >= 18 && nightT != null) {
    metaBits.push(`Nacht ${nightT}°`);
  }

  return {
    title,
    meta: metaBits.length ? metaBits.join(' · ') : undefined,
  };
}

export function formatWeatherBriefing(opts: {
  snap: WeatherChatSnap | null;
  heavy: boolean;
  soon: boolean;
  nowMs?: number;
}): { speech: string; bullets: string[] } {
  const nowMs = opts.nowMs ?? Date.now();
  const hour = new Date(nowMs).getHours();
  const snap = opts.snap;
  const nowT = roundDeg(snap?.currentTempC);
  const highT = roundDeg(snap?.dayHighC);
  const nightT = roundDeg(snap?.nightLowC);
  const skyRaw =
    skyPhraseFromCode(snap?.weatherCode) ??
    (snap?.summaryLine
      ? snap.summaryLine
          .replace(/^aktuell\s*-?\d+\s*°\s*[·,|\-–]?\s*/i, '')
          .split(/\s*[·|]\s*/)[0]
          ?.trim()
      : null);
  const skyHuman = humanSkyPhrase(skyRaw);
  const skyAdj = skyHudAdjective(skyRaw);

  const sentences: string[] = [];

  if (nowT != null && skyHuman) {
    sentences.push(`Aktuell haben wir ${nowT} Grad bei ${skyHuman}.`);
  } else if (nowT != null) {
    sentences.push(`Aktuell haben wir so um die ${nowT} Grad.`);
  } else if (skyHuman) {
    sentences.push(`Draußen gerade eher ${skyAdj}.`);
  }

  if (highT != null && (nowT == null || highT > nowT + 1)) {
    sentences.push(
      `Im weiteren Verlauf des Tages erreichen wir bis zu ${highT} Grad.`,
    );
  }

  const rainStory = rainStoryLine(
    snap,
    nowMs,
    opts.heavy,
    snap?.nextRainProb ?? 0,
  );
  if (rainStory) {
    sentences.push(rainStory);
  } else if (!opts.heavy && (snap?.nextRainProb ?? 0) < 25) {
    sentences.push(`Regen wird's heute nicht geben.`);
  } else {
    sentences.push(rainHowHard(snap, opts.heavy, opts.soon));
  }

  if (nightT != null && hour >= 12) {
    sentences.push(`Nachts geht's runter auf etwa ${nightT} Grad.`);
  }
  const sunset = snap?.sunsetMs;
  if (
    typeof sunset === 'number' &&
    Number.isFinite(sunset) &&
    sunset > nowMs &&
    sunset - nowMs < 10 * 3600_000
  ) {
    sentences.push(`Sonnenuntergang so gegen ${formatHm(sunset)}.`);
  }

  if (hour >= 16) {
    const tom = (snap?.tomorrowSummary ?? '').trim();
    if (tom) {
      sentences.push(`Morgen: ${tom.replace(/\.$/, '')}.`);
    }
  }

  const wear = outfitLine(snap, nowMs);
  if (wear) {
    sentences.push(
      wear.replace(/^Outfit:\s*/i, 'Von der Kleidung her: ').replace(/\.$/, '') +
        '.',
    );
  }

  const speech =
    sentences.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() ||
    formatWeatherChat({ snap, heavy: opts.heavy, soon: opts.soon });

  // Kein „heute heute heute“ — doppeltes heute glätten
  const speechClean = speech
    .replace(/\bHeute\s+heute\b/gi, 'Heute')
    .replace(/\bheute\s+heute\b/gi, 'heute');

  const bullets: string[] = [];
  if (nowT != null && highT != null && highT !== nowT) {
    bullets.push(`${nowT}° jetzt · bis ${highT}°`);
  } else if (nowT != null) {
    bullets.push(`${nowT}° jetzt`);
  }
  if (skyAdj) bullets.push(skyAdj);
  const win = mergeRainWindows(snap?.rainWindows ?? [], nowMs)[0];
  if (win && win.startMs > nowMs) {
    bullets.push(`Regen ab ${formatHm(win.startMs)}`);
  } else if (opts.heavy || (snap?.precipitationMm ?? 0) > 0.3) {
    bullets.push('Regen');
  } else {
    bullets.push('trocken');
  }
  if (nightT != null && hour >= 12 && bullets.length < 3) {
    bullets.push(`Nacht ${nightT}°`);
  }
  if (hour >= 16 && snap?.tomorrowSummary?.trim() && bullets.length < 3) {
    bullets.push(`Morgen: ${snap.tomorrowSummary.trim()}`);
  }

  return { speech: speechClean, bullets: bullets.slice(0, 3) };
}

/** Outdoor-OK nur aus Live-Snap — nie aus LLM-Flag. */
export function weatherOkOutdoorFromSnap(snap: WeatherChatSnap | null): boolean {
  if (!snap) return false;
  if (snap.isHeavyRain) return false;
  if (typeof snap.precipitationMm === 'number' && snap.precipitationMm >= 0.4) {
    return false;
  }
  if (typeof snap.nextRainProb === 'number' && snap.nextRainProb >= 40) {
    return false;
  }
  if (typeof snap.rainStartsInMin === 'number' && snap.rainStartsInMin <= 120) {
    return false;
  }
  return true;
}

function isThunderCode(code: number | null | undefined): boolean {
  return code != null && code >= 200 && code < 300;
}

/** Frühmorgens-Tagesausblick: Regen vor 6 Uhr ausblenden. */
function filterPreDawnRainWindows(
  windows: Array<{ startMs: number; endMs: number; pop: number }>,
  nowMs: number,
  minHour = 6,
): Array<{ startMs: number; endMs: number; pop: number }> {
  const cutoff = new Date(nowMs);
  cutoff.setHours(minHour, 0, 0, 0);
  const minMs = cutoff.getTime();
  return windows.filter((w) => w.startMs >= minMs);
}

function describeDrySpell(
  snap: WeatherChatSnap | null,
  nowMs: number,
): string | null {
  const windows = mergeRainWindows(snap?.rainWindows ?? [], nowMs);
  if (!windows.length) return null;
  const first = windows[0]!;
  if (first.startMs > nowMs + 25 * 60_000) {
    return `Bis gegen ${formatHm(first.startMs)} hält's noch trocken — danach wird's nasser.`;
  }
  return null;
}

/** Regen heute — umgangssprachlich, nicht „Regenfenster“. */
function rainStoryLine(
  snap: WeatherChatSnap | null,
  nowMs: number,
  heavy: boolean,
  prob: number,
): string | null {
  const windows = mergeRainWindows(snap?.rainWindows ?? [], nowMs);
  if (windows.length) {
    const first = windows[0]!;
    const popBit =
      first.pop >= 55
        ? `, da ist ziemlich sicher was mit dabei`
        : first.pop >= 30
          ? `, Schauer sind gut drin`
          : '';
    if (first.startMs <= nowMs + 20 * 60_000) {
      const more =
        windows[1] != null
          ? ` Später nochmal so gegen ${formatHm(windows[1].startMs)}.`
          : '';
      return `Gerade zieht Regen rein, hält ungefähr bis ${formatHm(first.endMs)}${popBit}.${more}`;
    }
    const second = windows[1];
    if (second) {
      return `Regen kommt eher ab ${formatHm(first.startMs)}${popBit}, und nochmal später gegen ${formatHm(second.startMs)}.`;
    }
    return `Regen kommt eher ab ${formatHm(first.startMs)}${popBit}.`;
  }
  if (heavy || prob >= 75) {
    return `Da wird's ziemlich nass — Schirm oder Jacke lohnen sich.`;
  }
  if (prob >= 45) {
    return `Wechselhaft — zwischendurch kann's schauern.`;
  }
  if (prob >= 20) {
    return `Leichtes Regenrisiko, aber nichts Dramatisches.`;
  }
  return null;
}

function clothingGuideLine(opts: {
  snap: WeatherChatSnap | null;
  prob: number;
  heavy: boolean;
  nowT: number | null;
  highT: number | null;
}): string | null {
  const tips: string[] = [];
  if (opts.prob >= 40 || opts.heavy) {
    tips.push('ich würde auf jeden Fall was Regenfestes einpacken');
  }
  if (opts.prob >= 55 || opts.heavy) {
    tips.push('ein Schirm schadet auch nicht');
  }
  if (
    ((opts.nowT ?? opts.highT ?? 99) <= 17 || (opts.highT ?? 99) <= 18) &&
    (opts.prob >= 30 || opts.heavy)
  ) {
    tips.push('und im Nassen friert man schneller — vielleicht noch ein Pulli');
  } else {
    const tip = clothingTipFromSnap(opts.snap);
    if (tip && opts.prob < 40) {
      tips.push(tip.replace(/^pack\s+/i, 'pack dir ').replace(/^nimm\s+/i, 'nimm dir '));
    }
  }
  if (!tips.length) return null;
  if (tips.length === 1) {
    return tips[0]!.charAt(0).toUpperCase() + tips[0]!.slice(1) + '.';
  }
  const last = tips.pop()!;
  return `${tips.join(', ')} — ${last}.`.replace(/^./, (c) => c.toUpperCase());
}

function joinGuideSentences(sentences: Array<string | null | undefined>): string {
  return sentences
    .map((s) => (s || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
}

function tempMildLabel(highT: number | null): string | null {
  if (highT == null) return null;
  if (highT >= 24) return 'warm';
  if (highT >= 17) return 'relativ mild';
  return 'eher frisch';
}

/**
 * Voller Wetterbericht für Voice — Guide-Ton, Fakten nur belegt (Ziffern eher in Bullets).
 */
export function formatWeatherVoiceAnswer(opts: {
  snap: WeatherChatSnap | null;
  cityHint?: string | null;
  nowMs?: number;
  timelineHints?: string[];
  matrix?: WeatherGuideMatrix | null;
  userText?: string | null;
  /** User nannte explizit eine Stadt — nicht „du liegst bei …“. */
  namedCity?: boolean;
}): { speech: string; bullets: string[] } {
  const snap = opts.snap;
  const nowMs = opts.nowMs ?? Date.now();
  const city = (opts.cityHint || '').replace(/\s+/g, ' ').trim() || null;
  const hour = new Date(nowMs).getHours();
  let dayAhead = false;
  try {
    const { weatherAskIsTodayDayAhead } = require('../../module2/planning/planUtteranceGate') as {
      weatherAskIsTodayDayAhead: (s: string, h?: number) => boolean;
    };
    dayAhead = weatherAskIsTodayDayAhead(opts.userText ?? '', hour);
  } catch {
    dayAhead = false;
  }
  const namedCity = Boolean(opts.namedCity && city);
  const snapForRain: WeatherChatSnap | null =
    snap && dayAhead
      ? {
          ...snap,
          rainWindows: filterPreDawnRainWindows(snap.rainWindows ?? [], nowMs),
        }
      : snap;

  if (!snap) {
    return { speech: 'Wetter hab ich gerade nicht frisch.', bullets: [] };
  }

  const prob = snap.nextRainProb ?? 0;
  const heavy = Boolean(snap.isHeavyRain);
  const thunder = isThunderCode(snap.weatherCode);
  const nowT = roundDeg(snap.currentTempC);
  const highT = roundDeg(snap.dayHighC);
  const lowT = roundDeg(snap.nightLowC);
  const sky = skyPhraseFromCode(snap.weatherCode);
  const mild = tempMildLabel(highT);

  const opener = weatherOpenerFromMatrix({
    matrix: opts.matrix,
    cityHint: city,
  });

  let nowLine: string | null = null;
  if (dayAhead) {
    if (city && highT != null && sky) {
      nowLine = `Heute in ${city} ${sky.toLowerCase()} — tagsüber bis ${highT} Grad${mild ? `, ${mild}` : ''}.`;
    } else if (highT != null && sky) {
      nowLine = `Heute ${sky.toLowerCase()} — tagsüber bis ${highT} Grad${mild ? `, ${mild}` : ''}.`;
    } else if (city && highT != null) {
      nowLine = `Heute in ${city} wird's tagsüber bis ${highT} Grad${mild ? `, ${mild}` : ''}.`;
    } else if (highT != null) {
      nowLine = `Heute wird's tagsüber bis ${highT} Grad${mild ? `, ${mild}` : ''}.`;
    } else if (sky) {
      nowLine = `Heute ${sky.charAt(0).toLowerCase() + sky.slice(1)} — insgesamt eher entspannt.`;
    }
  } else if (namedCity && nowT != null && sky) {
    nowLine = `In ${city} sind es gerade ${nowT} Grad, ${sky.toLowerCase()}`;
    if (highT != null && highT > nowT + 1) {
      nowLine += ` — tagsüber geht's Richtung ${highT}${mild ? `, ${mild}` : ''}`;
    } else if (mild) {
      nowLine += `, insgesamt ${mild}`;
    }
    nowLine += '.';
  } else if (nowT != null && sky) {
    nowLine = `Gerade liegst du bei ${nowT} Grad, ${sky.toLowerCase()}`;
    if (highT != null && highT > nowT + 1) {
      nowLine += ` — tagsüber geht's Richtung ${highT}${mild ? `, ${mild}` : ''}`;
    } else if (mild) {
      nowLine += `, insgesamt ${mild}`;
    }
    nowLine += '.';
  } else if (nowT != null && highT != null) {
    const where = namedCity && city ? `In ${city}` : 'Gerade';
    nowLine = `${where} so um die ${nowT} Grad, später bis ${highT}${mild ? ` — ${mild}` : ''}.`;
  } else if (sky) {
    nowLine = `${sky.charAt(0).toUpperCase() + sky.slice(1)} — insgesamt eher entspannt.`;
  } else if (prob < 45 && !heavy) {
    nowLine = 'Sieht erstmal ganz okay aus.';
  }

  const dry = describeDrySpell(snapForRain, nowMs);
  let rainStory: string | null = dry;
  if (dry && prob >= 55) {
    rainStory = `${dry.replace(/\.$/, '')} — danach wird's richtig nass.`;
  } else if (!dry) {
    rainStory = rainStoryLine(snapForRain, nowMs, heavy, prob);
  }

  let eveningLine: string | null = null;
  if (hour >= 14 && sky) {
    const eveHi = highT ?? nowT;
    if (eveHi != null) {
      eveningLine =
        sky.includes('bewölkt') || sky.includes('Wolken')
          ? `Am Abend bleibt's eher wolkig, so um die ${eveHi} Grad.`
          : `Am Abend eher ${sky.toLowerCase()}${eveHi != null ? `, so um die ${eveHi} Grad` : ''}.`;
    }
  }

  const wearLine = clothingGuideLine({ snap, prob, heavy, nowT, highT });
  const thunderLine = thunder
    ? 'Gewitter sind im Raum — da würd ich draußen nicht zu lange festnageln.'
    : null;

  const timelineLine = weatherTimelineLineFromMatrix(
    opts.timelineHints ?? [],
    opts.matrix,
  );

  let speech = joinGuideSentences([
    opener,
    nowLine,
    rainStory,
    eveningLine,
    wearLine,
    thunderLine,
    timelineLine,
  ]);
  if (!speech && snap.summaryLine?.trim()) {
    speech = snap.summaryLine.trim();
  }

  const bullets: string[] = [];
  if (prob >= 25) bullets.push(`Regen ${Math.round(prob)}%`);
  if (nowT != null && highT != null && highT !== nowT) {
    bullets.push(`${nowT}–${highT}°`);
  } else if (highT != null) {
    bullets.push(`bis ${highT}°`);
  } else if (nowT != null) {
    bullets.push(`${nowT}°`);
  }
  if (thunder && bullets.length < 3) bullets.push('Gewitter möglich');
  const win = mergeRainWindows(snapForRain?.rainWindows ?? [], nowMs)[0];
  if (win && win.startMs > nowMs && bullets.length < 3) {
    bullets.push(`Regen ab ${formatHm(win.startMs)}`);
  }
  if (bullets.length < 3) {
    const tip = clothingTipFromSnap(snap);
    if (tip) bullets.push(tip.charAt(0).toUpperCase() + tip.slice(1));
  }

  return { speech, bullets: bullets.slice(0, 3) };
}

/**
 * Wetter-Antwort: Speech = flüssig; Bullets = Ziffern/Zeit — nicht wiederholen.
 */
export function formatWeatherPresentation(opts: {
  snap: WeatherChatSnap | null;
  heavy: boolean;
  soon: boolean;
  cityHint?: string | null;
}): { speech: string; bullets: string[] } {
  return formatWeatherVoiceAnswer({
    snap: opts.snap,
    cityHint: opts.cityHint ?? null,
  });
}

/**
 * Wetter-Ort: explizit → Gespräch/Flug-Ziel → sonst GPS.
 * „hier“ / „vor Ort“ ohne Stadtname → immer GPS.
 */
export function resolveWeatherPlaceTarget(
  userText: string,
  _cityHint?: string | null,
): { city: string | null; namedCity: boolean; useGps: boolean } {
  const text = (userText || '').replace(/\s+/g, ' ').trim();
  try {
    const { extractCityFromText, getLastMentionedCity } = require('../../module2/context/shortTermContext') as {
      extractCityFromText: (s: string) => string | null;
      getLastMentionedCity: () => string | null;
    };
    const { weatherAskWantsLocalGps } = require('../../module2/planning/planUtteranceGate') as {
      weatherAskWantsLocalGps: (s: string) => boolean;
    };
    const explicit = extractCityFromText(text);
    if (explicit) {
      return { city: explicit, namedCity: true, useGps: false };
    }
    if (weatherAskWantsLocalGps(text)) {
      return { city: null, namedCity: false, useGps: true };
    }
    const sticky = (getLastMentionedCity() || '').trim() || null;
    if (sticky) {
      return { city: sticky, namedCity: true, useGps: false };
    }
    try {
      const { getFlightTripSession } = require('../flights/flightTripSession') as {
        getFlightTripSession: () => { destCity?: string | null } | null;
      };
      const flightDest = (getFlightTripSession()?.destCity || '').trim() || null;
      if (flightDest) {
        return { city: flightDest, namedCity: true, useGps: false };
      }
    } catch {
      /* soft */
    }
  } catch {
    /* soft */
  }
  return { city: null, namedCity: false, useGps: true };
}

/** Live-Wetter laden + formatieren — für schnellen Chat-Pfad ohne LLM. */
export async function fetchAndFormatWeatherVoice(opts: {
  userText: string;
  cityHint?: string | null;
}): Promise<{ speech: string; bullets: string[] } | null> {
  try {
    const { looksLikeOutfitOrWeatherUtterance, weatherAskIsFutureDay } =
      require('../../module2/planning/planUtteranceGate') as {
        looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
        weatherAskIsFutureDay: (s: string) => boolean;
      };
    const { looksLikePicnicQuery } = require('../../module2/pitch/picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    const text = (opts.userText || '').trim();
    if (!looksLikeOutfitOrWeatherUtterance(text) || looksLikePicnicQuery(text)) {
      return null;
    }

    const { ensureWeatherFresh } = require('../weatherService') as {
      ensureWeatherFresh: (
        reason: 'tick' | 'force',
        coords?: { lat: number; lng: number } | null,
        opts?: { userAsked?: boolean },
      ) => Promise<WeatherChatSnap | null>;
    };
    const { useGpsStore } = require('../../store/useGpsStore') as {
      useGpsStore: { getState: () => { lat: number | null; lng: number | null } };
    };
    const gps = useGpsStore.getState();
    let coords =
      gps.lat != null && gps.lng != null ? { lat: gps.lat, lng: gps.lng } : null;
    const place = resolveWeatherPlaceTarget(text, opts.cityHint);
    let city = place.city;
    let namedCity = place.namedCity;

    // „hier“ / GPS: Anzeige-Stadt aus Pack-Hint, nie Sticky-Zahlwort („Sechzehn“).
    if (place.useGps) {
      const hint = (opts.cityHint || '').replace(/\s+/g, ' ').trim();
      if (hint && !/^\d+$/u.test(hint) && hint.length >= 2) {
        city = hint;
        namedCity = false; // Opener lokal, kein „In X sind es…“-Named-City-Stil erzwingen
      }
    }

    if (!place.useGps && city) {
      try {
        const { geocodePlaceNameOsmFirst } = require('../navigation/googleMapsNav') as {
          geocodePlaceNameOsmFirst: (
            q: string,
            o?: { cityHint?: string | null },
          ) => Promise<{ lat: number; lng: number } | null>;
        };
        const geo = await Promise.race([
          geocodePlaceNameOsmFirst(city, { cityHint: city }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
        ]);
        if (geo?.lat != null && geo?.lng != null) {
          coords = { lat: geo.lat, lng: geo.lng };
        }
      } catch {
        /* GPS fallback */
      }
    }

    const freshP = ensureWeatherFresh('force', coords, { userAsked: true });
    const snap = await Promise.race([
      freshP,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    const cached = snap ?? (require('../weatherService') as {
      getCachedWeatherSnapshot: () => WeatherChatSnap | null;
    }).getCachedWeatherSnapshot();
    if (!cached) {
      // Ambient/Home zeigt oft schon Temp — ehrlicher Mini-Fallback statt LLM-Leertext
      const cityLabel =
        city ||
        (opts.cityHint || '').trim() ||
        'hier';
      return {
        speech: `Zum Wetter in ${cityLabel} krieg ich gerade keinen frischen Live-Abruf. Versuch's in einer Minute nochmal — oder frag mich nach Outfit, dann nutz ich den letzten Stand.`,
        bullets: [
          'Live-Wetter kurz nicht da',
          cityLabel !== 'hier' ? `Ort: ${cityLabel}` : 'GPS / Ort offen',
          'Gleich nochmal versuchen',
        ].slice(0, 3),
      };
    }

    city =
      city ||
      (cached as { cityHint?: string | null }).cityHint?.trim() ||
      null;
    // Nie Temperatur-Zahlwörter als Stadt übernehmen
    if (
      city &&
      /^(sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|dreißig|dreissig|grad)$/iu.test(
        city,
      )
    ) {
      city = (opts.cityHint || '').trim() || null;
      namedCity = false;
    }

    if (weatherAskIsFutureDay(text)) {
      const tom = formatTomorrowWeatherChat(cached);
      if (!tom.speech.trim()) return null;
      return tom;
    }

    const { getCachedUserProfile } = require('../userProfileService') as {
      getCachedUserProfile: () => import('../../types/userProfile').UserProfile | null;
    };
    const { resolveEffectivePersonalityMatrix } = require('../persona/personalityMatrixPrompt') as {
      resolveEffectivePersonalityMatrix: (
        p: import('../../types/userProfile').UserProfile | null,
      ) => WeatherGuideMatrix;
    };
    const matrix = resolveEffectivePersonalityMatrix(getCachedUserProfile());

    const out = formatWeatherVoiceAnswer({
      snap: cached,
      cityHint: city,
      userText: text,
      namedCity,
      matrix,
      timelineHints: (() => {
        try {
          const { formatWeatherTimelineHints } = require('./weatherPlanTimelineHints') as {
            formatWeatherTimelineHints: (o: {
              nowMs?: number;
              snap?: WeatherChatSnap | null;
            }) => string[];
          };
          return formatWeatherTimelineHints({ snap: cached });
        } catch {
          return [];
        }
      })(),
    });
    return out.speech.trim() ? out : null;
  } catch {
    return null;
  }
}

/**
 * Wetter-Karte: Himmel · Temperatur · Kleidung (Regen im Kleidungstipp).
 */
export function formatWeatherBullets(snap: WeatherChatSnap | null): string[] {
  const nowT = roundDeg(snap?.currentTempC);
  const highT = roundDeg(snap?.dayHighC);
  const sky =
    skyPhraseFromCode(snap?.weatherCode) ??
    (snap?.summaryLine
      ? snap.summaryLine
          .replace(/^aktuell\s*-?\d+\s*°\s*[·,|\-–]?\s*/i, '')
          .split(/\s*[·|]\s*/)[0]
          ?.trim()
      : null);
  const out: string[] = [];
  out.push(sky ? sky.charAt(0).toUpperCase() + sky.slice(1) : 'Himmel unklar');
  if (nowT != null && highT != null && highT !== nowT) {
    out.push(`${nowT}–${highT}°`);
  } else if (highT != null) {
    out.push(`bis ${highT}°`);
  } else if (nowT != null) {
    out.push(`${nowT}°`);
  } else {
    out.push('Temperatur offen');
  }
  out.push(clothingTipFromSnap(snap));
  return out.slice(0, 3);
}

function metersBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = (bLat - aLat) * 111_320;
  const dLng = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function blobOf(poi: InvitePoi): string {
  return `${poi.name ?? ''} ${poi.category ?? ''} ${poi.tags_json ?? ''}`.toLowerCase();
}

function isStoryPoi(poi: InvitePoi): boolean {
  const tags = (poi.tags_json ?? '').toLowerCase();
  if (/\bdirectory\b|\bamenity_skip\b|\btier4\b/.test(tags)) return false;
  return /\bstory\b/.test(tags);
}

function placeType(poi: InvitePoi): string | null {
  const blob = blobOf(poi);
  if (/\b(hotel|hostel|pension|unterkunft)\b/i.test(blob)) return 'hotel';
  if (/\b(haltepunkt|haltestelle|bahnhof|bus)\b/i.test(blob)) return 'transit';
  if (/\bmuseum\b/i.test(blob)) return 'museum';
  if (/\b(galerie|kunst|kultur|theater|kino|kirche)\b/i.test(blob)) return 'kultur';
  if (/\b(café|cafe)\b/i.test(blob)) return 'cafe';
  if (/\b(restaurant|gastro)\b/i.test(blob)) return 'restaurant';
  if (/\b(park\b|garten|natur|aussicht|wald)\b/i.test(blob)) return 'natur';
  if (/\b(freizeit|zoo|strand)\b/i.test(blob)) return 'freizeit';
  return null;
}

function indoorishType(type: string | null): boolean {
  return (
    type === 'museum' ||
    type === 'kultur' ||
    type === 'cafe' ||
    type === 'restaurant'
  );
}

function outdoorishType(type: string | null): boolean {
  return type === 'natur' || type === 'freizeit';
}

export function pickInvitePlaceNames(opts: {
  rainy: boolean;
  lat?: number | null;
  lng?: number | null;
  pois: InvitePoi[];
}): string[] {
  const lat = opts.lat;
  const lng = opts.lng;
  const ranked: Array<{ name: string; score: number }> = [];
  for (const poi of opts.pois) {
    const kind = poi.kind ?? 'legacy';
    if (kind === 'approach' || kind === 'sub') continue;
    if (!isStoryPoi(poi)) continue;
    const name = (poi.name ?? '').trim();
    if (name.length < 3) continue;
    const type = placeType(poi);
    if (type === 'hotel' || type === 'transit') continue;
    let score = 8;
    if (opts.rainy && indoorishType(type)) score += 12;
    if (!opts.rainy && outdoorishType(type)) score += 12;
    if (type === 'museum' || type === 'kultur') score += 4;
    if (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(poi.lat) &&
      Number.isFinite(poi.lng)
    ) {
      const m = metersBetween(lat, lng, poi.lat, poi.lng);
      if (m < 800) score += 10;
      else if (m < 2500) score += 5;
      else if (m > 12_000) score -= 8;
    }
    ranked.push({ name, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  for (const r of ranked) {
    if (out.some((n) => n.toLowerCase() === r.name.toLowerCase())) continue;
    out.push(r.name);
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * Umgangssprachliche Einladung. Ablauf-Beispiel, Wortlaut frei rotieren —
 * nie „nur eine Idee / nichts festgehalten“.
 */
export function formatEmptyPlanInvite(places: string[], rainy: boolean): string {
  const a = places[0];
  const b = places[1];
  if (a && b) {
    if (rainy) {
      return `Dein Tag ist noch ziemlich leer. Bei dem Wetter eher drinnen — ${a} oder ${b}, was schwebt dir vor? Wollen wir nochmal einen richtigen Plan draus machen?`;
    }
    return `Hey, dein Plan ist gerade ziemlich leer. Lust auf irgendwas? ${a} oder ${b} — was schwebt dir vor?`;
  }
  if (a) {
    return `Dein Tag ist noch frei. ${a} wär ne Option — oder sag einfach, worauf du Bock hast.`;
  }
  return rainy
    ? 'Dein Tag ist noch ziemlich frei. Bei dem Wetter eher was Drinnen — worauf hast du Lust?'
    : 'Hey, du planst gerade noch ziemlich leer. Hast du Lust irgendwas zu machen? Sag einfach, was dir vorschwebt.';
}
