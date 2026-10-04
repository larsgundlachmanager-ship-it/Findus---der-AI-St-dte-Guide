/**
 * Wetter-HUD Speech-Bausteine (kein RN).
 * Struktur, nicht Pflichtsätze — nie „nur eine Idee / nichts festgehalten“.
 */

import { buildOutfitAdviceFromWeather } from '../weather/outfitFromWeather';
import type { WeatherGuideMatrix } from '../persona/weatherGuideVoice';
import { weatherTimelineLineFromMatrix } from '../persona/weatherGuideVoice';
import { formatClockSpokenDe } from '../../utils/dateKeys';
import { isSunDownNow } from '../geo/solarTimes';
import {
  formatRainHudLine,
  isRainAlreadyFalling,
} from '../weather/rainIncomingPolicy';

export type WeatherChatSnap = {
  currentTempC?: number | null;
  dayHighC?: number | null;
  precipitationMm?: number | null;
  nextRainProb?: number | null;
  rainStartsInMin?: number | null;
  nextRainAtMs?: number | null;
  rainEndsAtMs?: number | null;
  summaryLine?: string | null;
  isHeavyRain?: boolean;
  tomorrowSummary?: string | null;
  day2Summary?: string | null;
  windSpeedMs?: number | null;
  windGustMs?: number | null;
  nightLowC?: number | null;
  weatherCode?: number | null;
  sunsetMs?: number | null;
  sunriseMs?: number | null;
  rainWindows?: Array<{ startMs: number; endMs: number; pop: number }>;
  /** Stunden-Wettercode (OWM oder WMO) für Zeitfenster-Chips */
  skyHours?: Array<{ ms: number; code: number }>;
};

export type InvitePoi = {
  name: string;
  lat: number;
  lng: number;
  kind?: string | null;
  category?: string | null;
  tags_json?: string | null;
};

/** Urban vs. ländlich — nur wenn belegt; sonst keine Sterne behaupten. */
export type SkySettlementHint = 'urban' | 'rural' | null;

function formatHm(ms: number): string {
  return formatClockSpokenDe(ms) || '';
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
  nowMs?: number;
  settlementHint?: SkySettlementHint;
}): string {
  const snap = opts.snap;
  const nowMs = opts.nowMs ?? Date.now();
  const night = isSunDownNow({
    nowMs,
    sunsetMs: snap?.sunsetMs,
    sunriseMs: snap?.sunriseMs,
  });
  const nowT = roundDeg(snap?.currentTempC);
  const highT = roundDeg(snap?.dayHighC);
  const sky = skyPhraseFromCode(snap?.weatherCode, { night });
  const rain = rainHowHard(snap, opts.heavy, opts.soon);
  const tip = clothingTipFromSnap(snap);
  const bits: string[] = [];
  if (sky && nowT != null && highT != null && highT > nowT + 1 && !night) {
    bits.push(
      `Gerade eher ${sky}, so um die ${nowT} Grad — bis heute Nachmittag Richtung ${highT}.`,
    );
  } else if (nowT != null && highT != null && highT > nowT + 1 && !night) {
    bits.push(
      `Gerade so um die ${nowT} Grad, bis heute Nachmittag Richtung ${highT}.`,
    );
  } else if (sky && highT != null && !night) {
    bits.push(`Heute eher ${sky}, Spitze so um die ${highT} Grad.`);
  } else if (highT != null && !night) {
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
  const stars = nightSkyStarsClause(sky, opts.settlementHint ?? null);
  if (stars) bits.push(stars);
  bits.push(rain);
  if (tip) bits.push(weaveClothingIntoProse(tip));
  const line = bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return (
    unwrapClothingParentheses(line) ||
    snap?.summaryLine?.trim() ||
    'Wetter hab ich gerade nicht frisch.'
  );
}

function skyPhraseFromCode(
  code: number | null | undefined,
  opts?: { night?: boolean },
): string | null {
  if (code == null || !Number.isFinite(code)) return null;
  const night = Boolean(opts?.night);
  // OpenWeather condition ids (200–804)
  if (code >= 200) {
    if (code === 800) return night ? 'klarer Himmel' : 'klar / Sonne';
    if (code >= 801 && code <= 802) {
      return night ? 'teilweise bewölkt' : 'Wolken und Sonne';
    }
    if (code >= 803 && code <= 804) return 'bewölkt';
    if (code >= 200 && code < 300) return 'Gewitter';
    if (code >= 300 && code < 400) return 'Niesel';
    if (code >= 500 && code < 600) return 'Regen';
    if (code >= 600 && code < 700) return 'Schnee';
    if (code >= 700 && code < 800) return 'diesig';
    return null;
  }
  // WMO (Open-Meteo 0–99)
  if (code === 0) return night ? 'klarer Himmel' : 'klar / Sonne';
  if (code <= 3) return night ? 'teilweise bewölkt' : 'Wolken und Sonne';
  if (code <= 48) return 'neblig';
  if (code <= 57) return 'Niesel';
  if (code <= 67) return 'Regen';
  if (code <= 77) return 'Schnee';
  if (code <= 82) return 'Schauer';
  if (code <= 99) return 'Gewitter';
  return null;
}

/** Sterne nur bei klar + belegtem Settlement-Hint — nie erfinden. */
function nightSkyStarsClause(
  sky: string | null | undefined,
  settlement: SkySettlementHint,
): string | null {
  if (!sky || !settlement) return null;
  const clear = /klarer himmel|klar\b/i.test(sky) && !/wolk|bewölk/i.test(sky);
  if (!clear) return null;
  if (settlement === 'rural') {
    return 'Draußen dürften die Sterne gut zu sehen sein.';
  }
  if (settlement === 'urban') {
    return 'Sterne sind in der Stadt oft kaum zu sehen.';
  }
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
  if (wet) return 'Nimm vorsichtshalber eine leichte Regenjacke mit';
  const dress = advice.dressForTempC;
  if (dress != null && dress >= 22) {
    return advice.morningFresher
      ? 'Leichte Kleidung reicht — morgens höchstens eine dünne Jacke, die du später ablegen kannst'
      : 'Leichte Kleidung reicht völlig aus';
  }
  if (dress != null && dress >= 18) {
    return 'Zieh dich eher leicht an, und nimm vorsichtshalber eine dünne Jacke mit';
  }
  if (dress != null && dress >= 14) {
    return 'Am besten eine Übergangsjacke oder Schichten, dann bleibst du flexibel';
  }
  if (dress != null && dress >= 8) {
    return 'Nimm auf jeden Fall einen warmen Pulli oder eine Jacke mit';
  }
  if (dress != null) {
    return 'Zieh dich richtig warm an, es wird kühl';
  }
  const bit = (advice.clothingBits ?? []).find(Boolean);
  if (bit) return expandClothingFragment(bit);
  return 'Am besten in Schichten anziehen, dann kannst du nachlegen';
}

/** Stichpunkt-/Hint-Fragmente → kurzer, sprechbarer Satzkern. */
function expandClothingFragment(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (!t) return 'Am besten in Schichten anziehen';
  if (/leichte\s+kleidung\s+reicht/i.test(t)) return 'Leichte Kleidung reicht völlig aus';
  if (/eher\s+leicht|kurze\s+hose|t-?shirt/i.test(t)) {
    return 'Zieh dich eher leicht an — T-Shirt reicht oft';
  }
  if (/übergangsjacke|schichten/i.test(t)) {
    return 'Am besten eine Übergangsjacke oder Schichten';
  }
  if (/regenjacke|wind/i.test(t)) {
    return 'Nimm vorsichtshalber eine Wind- oder Regenjacke mit';
  }
  if (/wärmere\s+jacke|pulli/i.test(t)) {
    return 'Nimm auf jeden Fall einen warmen Pulli oder eine Jacke mit';
  }
  if (/richtig\s+warm/i.test(t)) return 'Zieh dich richtig warm an';
  if (/flexibel/i.test(t)) return 'Am besten in Schichten anziehen, dann bleibst du flexibel';
  return t;
}

/**
 * Kleidung als voller kurzer Satz — kein Telegramm („Am besten leichte Lage“).
 * Tipps aus clothingTipFromSnap sind schon satzreif.
 */
function weaveClothingIntoProse(tip: string): string {
  const t = tip.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (!t) return '';
  // Schon satzreif (Verb / Imperativ / fertiger Hauptsatz)
  if (
    /^(nimm|pack|zieh|am besten|leichte\s+kleidung|ich\s+würde|ein\s+schirm)/i.test(
      t,
    ) ||
    /\b(reicht|mitnehmen|einpacken|anziehen|ablegen|mit)\b/i.test(t)
  ) {
    const s = t.charAt(0).toUpperCase() + t.slice(1);
    return /[.!?]$/.test(s) ? s : `${s}.`;
  }
  return `Am besten ${t.charAt(0).toLowerCase()}${t.slice(1)}.`;
}

/** Outfit-Klammern-Asides → eigenen Fließsatz (kein Meta in Parenthesen). */
export function unwrapClothingParentheses(speech: string): string {
  if (!speech) return speech;
  return speech
    .replace(
      /\s*\(([^)]*(?:jacke|pulli|schicht|hose|outfit|kleidung|schirm|anzug|schuhe|lagen?)[^)]*)\)/gi,
      (_m, inner: string) => {
        const bit = String(inner || '')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\.$/, '');
        if (!bit) return '';
        return ` ${weaveClothingIntoProse(bit)}`;
      },
    )
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
}

/** Morgen-Vorhersage — kurz, Answer-First; Chips wie heute. */
export function formatTomorrowWeatherChat(snap: WeatherChatSnap | null): {
  speech: string;
  bullets: string[];
} {
  const raw = (snap?.tomorrowSummary ?? '').trim();
  const highT = roundDeg(snap?.dayHighC);
  const lowT = roundDeg(snap?.nightLowC);
  if (!raw && highT == null && !snap?.weatherCode) {
    return {
      speech: 'Für morgen hab ich gerade keinen frischen Ausblick.',
      bullets: ['Morgen-Ausblick fehlt', 'Gleich nochmal versuchen'],
    };
  }

  const tempM = raw.match(/(-?\d+)\s*[–\-]\s*(-?\d+)\s*°/);
  const untilM = raw.match(/bis\s+(-?\d+)\s*°/i);
  const skyM = raw.match(
    /(klar|Sonne|bewölkt|Wolken|Regen|Schauer|Niesel|Gewitter|Schnee|diesig)[^,]*/i,
  );
  const rainM = raw.match(/Regenrisiko\s+(\d+)\s*%/i);
  const skyFromCode = skyPhraseFromCode(snap?.weatherCode, { night: false });
  const sky = skyM?.[0]?.trim() || skyFromCode || 'wechselhaft';
  let lo: number | null = lowT;
  let hi: number | null = highT;
  if (tempM) {
    lo = Number(tempM[1]);
    hi = Number(tempM[2]);
  } else if (untilM) {
    hi = Number(untilM[1]);
  }
  const rainPct = rainM ? Number(rainM[1]) : snap?.nextRainProb ?? null;
  const eveningRain = typeof rainPct === 'number' && rainPct >= 45;

  const skyLc = sky.toLowerCase();
  let speech: string;
  if (hi != null) {
    speech = `Morgen eher ${skyLc}${
      eveningRain ? ', abends mit Regen' : ''
    } — Höchstwerte bis so um die ${hi} Grad.`;
  } else {
    speech = `Morgen eher ${skyLc}${eveningRain ? ', und Regen ist im Spiel' : ''}.`;
  }

  const fakeSnap: WeatherChatSnap = {
    ...snap,
    dayHighC: hi ?? snap?.dayHighC,
    nightLowC: lo ?? snap?.nightLowC,
    nextRainProb: rainPct ?? snap?.nextRainProb,
    weatherCode: snap?.weatherCode,
  };
  const timeline = buildTomorrowTimelineChips(snap, Date.now());
  let bullets =
    timeline.length >= 2
      ? timeline
      : buildWeatherFactChips({
        snap: fakeSnap,
        dayAhead: true,
        night: false,
        skyOverride: sky,
      });
  if (!bullets.length) {
    bullets = [
      sky.charAt(0).toUpperCase() + sky.slice(1),
      lo != null && hi != null ? `${lo}° bis ${hi}°` : hi != null ? `bis ${hi}°` : '',
      clothingChipFromSnap(fakeSnap, eveningRain),
    ].filter(Boolean);
  }

  return {
    speech: unwrapClothingParentheses(speech),
    bullets: bullets.slice(0, 4),
  };
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
  return weaveClothingIntoProse(clothingTipFromSnap(snap));
}

function humanSkyPhrase(
  sky: string | null | undefined,
  opts?: { night?: boolean },
): string | null {
  if (!sky) return null;
  const night = Boolean(opts?.night);
  const s = sky.toLowerCase();
  if (night) {
    if (/klarer himmel|klar/.test(s) && !/wolke|bewölk/.test(s)) {
      return 'klarem Himmel';
    }
    if (/teilweise|wolken und|leicht/.test(s)) return 'teilweise bewölktem Himmel';
    if (/bewölkt|bedeckt/.test(s)) return 'bewölktem Himmel';
    if (/regen|schauer/.test(s)) return 'nasser Luft';
    if (/gewitter/.test(s)) return 'Gewitterstimmung';
    if (/nebel|diesig/.test(s)) return 'diesigem Wetter';
    if (/schnee/.test(s)) return 'Schneeluft';
    return sky.replace(/klar\s*\/\s*sonne/i, 'klarem Himmel').replace(/sonne/gi, 'Himmel');
  }
  if (/klar|sonne/.test(s) && !/wolke/.test(s)) return 'Sonnenschein';
  if (/wolken und sonne|leicht bewölkt/.test(s)) return 'Wolken und Sonne';
  if (/bewölkt|bedeckt/.test(s)) return 'bewölktem Himmel';
  if (/regen|schauer/.test(s)) return 'nasser Luft';
  if (/gewitter/.test(s)) return 'Gewitterstimmung';
  if (/nebel|diesig/.test(s)) return 'diesigem Wetter';
  if (/schnee/.test(s)) return 'Schneeluft';
  return sky.replace(/^klar \/ sonne$/i, 'Sonnenschein');
}

function skyHudAdjective(
  sky: string | null | undefined,
  opts?: { night?: boolean },
): string {
  if (!sky) return 'wechselhaft';
  const night = Boolean(opts?.night);
  const s = sky.toLowerCase();
  if (night) {
    // Nacht: Sonne/Klar → Sternenhimmel; kein „nass“-Telegramm.
    if (/klarer himmel|klar/.test(s) && !/wolke|bewölk/.test(s)) {
      return 'Sternenhimmel';
    }
    if (/teilweise|wolken/.test(s)) return 'teilweise bewölkt';
    if (/bewölkt|bedeckt/.test(s)) return 'bewölkt';
    if (/regen|schauer|nass|niesel/.test(s)) return 'regnerisch';
    if (/gewitter/.test(s)) return 'gewittrig';
    return 'bewölkt';
  }
  if (/klar|sonne/.test(s) && !/wolke/.test(s)) return 'sonnig';
  if (/wolken und sonne|leicht/.test(s)) return 'wechselhaft';
  if (/bewölkt|bedeckt/.test(s)) return 'bewölkt';
  if (/regen|schauer|nass|niesel/.test(s)) return 'regnerisch';
  if (/gewitter/.test(s)) return 'gewittrig';
  return 'wechselhaft';
}

function sameLocalCalendarDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** „Regen ab 8 Uhr“ → bei nächstem Kalendertag „… morgen“. Mitternacht = morgen früh. */
function formatRainAbLabel(startMs: number, nowMs: number): string {
  const d = new Date(startMs);
  if (d.getHours() === 0 && d.getMinutes() === 0) {
    return sameLocalCalendarDay(nowMs, startMs) ? 'Regen ab Mitternacht' : 'Regen morgen früh';
  }
  const hm = formatHm(startMs);
  if (!sameLocalCalendarDay(nowMs, startMs)) {
    return `Regen ab ${hm} morgen`;
  }
  return `Regen ab ${hm}`;
}

function hudWeatherEmoji(opts: {
  night: boolean;
  adj: string;
  rainingNow: boolean;
  rainHud: string | null;
}): string {
  const { night, adj, rainingNow, rainHud } = opts;
  if (rainingNow || rainHud) return '🌧';
  if (night) {
    if (/stern|klar/i.test(adj)) return '🌙';
    if (/regen|regnerisch|schauer|gewitter/i.test(adj)) return '🌧';
    // Bewölkt / wechselhaft nachts: Wolke, nie Sonne.
    return '☁️';
  }
  if (/sonnig|klar/i.test(adj)) return '☀️';
  if (/bewölkt|wechselhaft|teilweise/i.test(adj)) return '⛅';
  if (/regen|regnerisch|schauer|gewitter/i.test(adj)) return '🌧';
  return '🌤';
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
  const night = isSunDownNow({
    nowMs,
    sunsetMs: snap.sunsetMs,
    sunriseMs: snap.sunriseMs,
  });
  const nowT = roundDeg(snap.currentTempC);
  const highT = roundDeg(snap.dayHighC);
  const nightT = roundDeg(snap.nightLowC);
  const rainOpts = {
    nowMs,
    currentPrecipMm: snap.precipitationMm,
    nextRainAtMs: snap.nextRainAtMs,
    rainStartsInMin: snap.rainStartsInMin,
    rainEndsAtMs: snap.rainEndsAtMs,
    rainWindows: snap.rainWindows,
    weatherCode: snap.weatherCode,
    isHeavyRain: snap.isHeavyRain,
  };
  const rainHud = formatRainHudLine(rainOpts);
  const rainingNow = isRainAlreadyFalling(rainOpts);
  const skyRaw =
    skyPhraseFromCode(snap.weatherCode, { night }) ??
    (snap.summaryLine
      ? snap.summaryLine
          .replace(/^aktuell\s*-?\d+\s*°\s*[·,|\-–]?\s*/i, '')
          .split(/\s*[·|]\s*/)[0]
          ?.trim()
      : null);
  let adj = rainingNow
    ? 'regnerisch'
    : skyHudAdjective(skyRaw, { night });
  // Regen erst in Stunden: Himmel = Wolken, nicht „nass/regnerisch“ vortäuschen.
  if (
    !rainingNow &&
    /regnerisch|nass/.test(adj) &&
    (!rainHud || !/^(Aktuell\s+)?(Starker\s+|Leichter\s+)?Regen(\s+(jetzt|noch |in |bis )|$)/i.test(rainHud))
  ) {
    adj = 'bewölkt';
  }
  const emoji = hudWeatherEmoji({ night, adj, rainingNow, rainHud });

  // Nach Sonnenuntergang: kein Tageshoch mehr („bis 18°“ wirkt falsch um 23 Uhr).
  const showHigh =
    !night && highT != null && (nowT == null || highT >= nowT + 2);

  let title: string;
  // Regenradar SSOT: Timing in der Headline — Temp nicht daneben doppeln.
  if (rainHud) {
    const headline = rainHud
      .replace(/^Regen in (\d+) Min/, 'Regen in ~$1 Min')
      .replace(/^Regen ab (\d{1,2} Uhr(?: \d{1,2})?|Mitternacht)$/, (_m, hm: string) => {
        const start =
          typeof snap.nextRainAtMs === 'number' ? snap.nextRainAtMs : null;
        if (start != null && !sameLocalCalendarDay(nowMs, start)) {
          if (/mitternacht/i.test(hm) || hm === '0 Uhr') return 'Regen morgen früh';
          return `Regen ab ${hm} morgen`;
        }
        return `Regen ab ${hm}`;
      });
    title =
      nowT != null && !showHigh
        ? `🌧 ${headline} · ${nowT}°`
        : `🌧 ${headline}`;
  } else if (nowT != null) {
    // Flüssig: „☁️ Bewölkt · 16°“ / „🌙 Sternenhimmel · 12°“ — kein „Jetzt nass“.
    const skyLabel = adj.charAt(0).toUpperCase() + adj.slice(1);
    title = `${emoji} ${skyLabel} · ${nowT}°`;
  } else {
    const skyLabel = adj.charAt(0).toUpperCase() + adj.slice(1);
    title = `${emoji} ${skyLabel}`;
  }

  const metaBits: string[] = [];
  if (showHigh) {
    metaBits.push(`bis ${highT}°`);
  } else if (night && nightT != null && (nowT == null || nightT <= nowT - 1)) {
    metaBits.push(`Nacht um ${nightT}°`);
  }
  if (!rainHud) {
    const win = mergeRainWindows(snap.rainWindows ?? [], nowMs)[0];
    if (win && win.startMs > nowMs) {
      metaBits.push(formatRainAbLabel(win.startMs, nowMs));
    } else if ((snap.nextRainProb ?? 0) < 30 && !snap.isHeavyRain) {
      metaBits.push('bleibt trocken');
    }
  }
  if (!metaBits.length && night && nightT != null) {
    metaBits.push(`Nacht um ${nightT}°`);
  }

  // Nur „bis 18°“ als Meta → ausgeschrieben (nicht mickrig).
  let meta = metaBits.length ? metaBits.join(' · ') : undefined;
  if (meta && highT != null && /^bis -?\d+°$/.test(meta)) {
    meta = `bis zu Temperaturen von ${highT} Grad`;
  }

  return {
    title,
    meta,
  };
}

export function formatWeatherBriefing(opts: {
  snap: WeatherChatSnap | null;
  heavy: boolean;
  soon: boolean;
  nowMs?: number;
  settlementHint?: SkySettlementHint;
}): { speech: string; bullets: string[] } {
  const nowMs = opts.nowMs ?? Date.now();
  const hour = new Date(nowMs).getHours();
  const snap = opts.snap;
  const night = isSunDownNow({
    nowMs,
    sunsetMs: snap?.sunsetMs,
    sunriseMs: snap?.sunriseMs,
  });
  const nowT = roundDeg(snap?.currentTempC);
  const highT = roundDeg(snap?.dayHighC);
  const nightT = roundDeg(snap?.nightLowC);
  const skyRaw =
    skyPhraseFromCode(snap?.weatherCode, { night }) ??
    (snap?.summaryLine
      ? snap.summaryLine
          .replace(/^aktuell\s*-?\d+\s*°\s*[·,|\-–]?\s*/i, '')
          .split(/\s*[·|]\s*/)[0]
          ?.trim()
      : null);
  const skyHuman = humanSkyPhrase(skyRaw, { night });
  const skyAdj = skyHudAdjective(skyRaw, { night });

  const sentences: string[] = [];

  if (nowT != null && skyHuman) {
    sentences.push(
      night
        ? `Aktuell so um die ${nowT} Grad bei ${skyHuman}.`
        : `Aktuell haben wir ${nowT} Grad bei ${skyHuman}.`,
    );
  } else if (nowT != null) {
    sentences.push(`Aktuell so um die ${nowT} Grad.`);
  } else if (skyHuman) {
    sentences.push(`Draußen gerade eher ${skyAdj}.`);
  }

  const stars = nightSkyStarsClause(skyRaw, opts.settlementHint ?? null);
  if (stars) sentences.push(stars);

  if (!night && highT != null && (nowT == null || highT > nowT + 1)) {
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
    !night &&
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
    sentences.push(wear);
  }

  const speech =
    sentences.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() ||
    formatWeatherChat({
      snap,
      heavy: opts.heavy,
      soon: opts.soon,
      nowMs,
      settlementHint: opts.settlementHint,
    });

  // Kein „heute heute heute“ — doppeltes heute glätten
  const speechClean = unwrapClothingParentheses(
    speech
      .replace(/\bHeute\s+heute\b/gi, 'Heute')
      .replace(/\bheute\s+heute\b/gi, 'heute'),
  );

  const bullets: string[] = [];
  if (nowT != null && highT != null && highT !== nowT && !night) {
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

function clothingChipFromSnap(
  snap: WeatherChatSnap | null,
  eveningRain: boolean,
): string {
  const tip = clothingTipFromSnap(snap);
  const wet =
    eveningRain ||
    Boolean(snap?.isHeavyRain) ||
    (typeof snap?.nextRainProb === 'number' && snap.nextRainProb >= 40) ||
    /regenjacke|regenschirm|\bschirm\b/i.test(tip);
  if (wet) {
    if (/übergang|schicht/i.test(tip)) return 'Übergangsjacke, abends Regenschirm';
    if (/leichte|dünne|regenjacke/i.test(tip)) return 'Leichte Jacke, Regenschirm';
    return 'Regenschirm';
  }
  if (/übergang|schicht/i.test(tip)) return 'Übergangsjacke';
  if (/leichte kleidung|t-?shirt/i.test(tip)) return 'Leichte Kleidung';
  if (/dünne jacke|leichte jacke/i.test(tip)) return 'Leichte Jacke';
  if (/warm|pulli/i.test(tip)) return 'Warme Jacke / Pulli';
  if (/jacke/i.test(tip)) return 'Jacke mitnehmen';
  return 'Dem Wetter anpassen';
}

function weatherSkyEmoji(
  code: number | null | undefined,
  raining: boolean,
  night: boolean,
): string {
  if (raining) return '🌧️';
  if (code == null || !Number.isFinite(code)) return night ? '☁️' : '⛅';
  if (code >= 200) {
    if (code >= 200 && code < 300) return '⛈️';
    if (code >= 300 && code < 600) return '🌧️';
    if (code === 800) return night ? '🌙' : '☀️';
    if (code >= 801 && code <= 802) return '⛅';
    return '☁️';
  }
  if (code === 0) return night ? '🌙' : '☀️';
  if (code <= 3) return '⛅';
  if (code <= 67) return '🌧️';
  if (code <= 99) return '⛈️';
  return '⛅';
}

/** UI-Chips wie Wetter-App: Tagesüber / Abends / Temp / Outfit — max 4. */
export function buildWeatherFactChips(opts: {
  snap: WeatherChatSnap | null;
  nowMs?: number;
  dayAhead?: boolean;
  night?: boolean;
  /** Wenn kein weatherCode (z. B. Morgen-Summary-Text). */
  skyOverride?: string | null;
}): string[] {
  const snap = opts.snap;
  const nowMs = opts.nowMs ?? Date.now();
  const night = Boolean(opts.night);
  const dayAhead = Boolean(opts.dayAhead);
  const highT = roundDeg(snap?.dayHighC);
  const lowT = roundDeg(snap?.nightLowC);
  const nowT = roundDeg(snap?.currentTempC);
  const skyRaw =
    (opts.skyOverride || '').trim() ||
    skyPhraseFromCode(snap?.weatherCode, {
      night: night && !dayAhead,
    }) ||
    '';
  const skyLabel = skyRaw
    ? skyRaw.charAt(0).toUpperCase() + skyRaw.slice(1)
    : null;
  const win = mergeRainWindows(snap?.rainWindows ?? [], nowMs)[0];
  const rainLater = Boolean(
    win && win.startMs > nowMs && (snap?.nextRainProb ?? 0) >= 40,
  );
  const rainHour = win ? new Date(win.startMs).getHours() : -1;
  const rainSlotLabel =
    rainHour >= 17 ? 'Abends Regen' : rainHour >= 12 ? 'Nachmittags Regen' : 'Später Regen';
  const rainingNow =
    Boolean(snap?.isHeavyRain) ||
    (typeof snap?.precipitationMm === 'number' && snap.precipitationMm >= 0.4);
  const rainLikely =
    rainLater ||
    (!win && typeof snap?.nextRainProb === 'number' && snap.nextRainProb >= 45);
  const chips: string[] = [];
  if (skyLabel) {
    const emoji = weatherSkyEmoji(
      snap?.weatherCode,
      rainingNow && !rainLikely,
      night && !dayAhead,
    );
    if (dayAhead || (!night && (highT != null || skyLabel))) {
      chips.push(`${emoji} Tagesüber ${skyLabel}`);
    } else {
      chips.push(`${emoji} ${skyLabel}`);
    }
  }
  if (rainLater) {
    const when =
      win && win.startMs > nowMs
        ? `${rainSlotLabel} ab ${formatHm(win.startMs)}`
        : rainSlotLabel;
    chips.push(`🌧️ ${when}`);
  } else if (rainLikely) {
    chips.push('🌧️ Regen möglich');
  } else if ((snap?.nextRainProb ?? 0) < 30 && !rainingNow && chips.length < 3) {
    chips.push('☀️ Weitgehend trocken');
  }
  if (lowT != null && highT != null && lowT !== highT) {
    chips.push(`${lowT}° bis ${highT}°`);
  } else if (nowT != null && highT != null && nowT !== highT) {
    chips.push(`${nowT}° bis ${highT}°`);
  } else if (highT != null) {
    chips.push(`bis ${highT}°`);
  } else if (nowT != null) {
    chips.push(`${nowT}°`);
  }
  const wear = clothingChipFromSnap(snap, rainLikely || rainingNow);
  if (wear) chips.push(wear);
  return chips.slice(0, 4);
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
 * Wetter Call-2: 1–2 kurze umgangssprachliche Sätze, Answer-First.
 * Kein Opener („Also in Prisdorf…“ / „Zum Wetter:“) — das war Call 1.
 * Kleidung nur in Stichpunkten, nicht nochmal in der Speech.
 */

type ForecastDayBit = {
  label: string;
  sky: string;
  rainy: boolean;
  highC: number | null;
};

function skyBucket(sky: string): string {
  const s = sky.toLowerCase();
  if (/schauer|regen|niesel|gewitter/.test(s)) return 'nass';
  if (/dicht|bewölkt|bewoelkt|wolken/.test(s) && !/sonne/.test(s)) return 'bewölkt';
  if (/sonne|klar|wolken und sonne|leicht/.test(s)) return 'sonnig';
  return s || 'wechselhaft';
}

function parseDaySummary(raw: string | null | undefined): {
  sky: string;
  rainy: boolean;
  highC: number | null;
} {
  const t = (raw || '').trim();
  const tempM = t.match(/(-?\d+)\s*[–\-]\s*(-?\d+)\s*°/);
  const untilM = t.match(/bis\s+(-?\d+)\s*°/i);
  const skyM = t.match(
    /(klar\s*\/\s*Sonne|klar|Sonne|bewölkt|bewoelkt|Wolken und Sonne|leicht bewölkt|Regen|Schauer|Niesel|Gewitter|Schnee|diesig|neblig|wechselhaft)[^,]*/i,
  );
  const rainM = t.match(/Regenrisiko\s+(\d+)\s*%/i);
  const rainPct = rainM ? Number(rainM[1]) : null;
  const sky = (skyM?.[0] || 'wechselhaft').trim();
  const rainy =
    (typeof rainPct === 'number' && rainPct >= 40) ||
    /regen|schauer|niesel|gewitter/i.test(sky);
  let highC: number | null = null;
  if (tempM) highC = Number(tempM[2]);
  else if (untilM) highC = Number(untilM[1]);
  return { sky, rainy, highC };
}


function skyWindowEmoji(code: number | null | undefined): string {
  if (code == null || !Number.isFinite(code)) return '⛅';
  if (code >= 200) {
    if (code >= 200 && code < 300) return '⛈️';
    if (code >= 520 && code <= 531) return '🌦️';
    if (code >= 300 && code < 600) return '🌧️';
    if (code >= 600 && code < 700) return '❄️';
    if (code === 800) return '☀️';
    if (code >= 801 && code <= 802) return '⛅';
    return '☁️';
  }
  if (code === 0) return '☀️';
  if (code <= 2) return '⛅';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 99) return '⛈️';
  return '⛅';
}

/** Morgen-Zeitfenster: Temp-Spanne, dann Icon + Uhr (letzte Phase „ab“). */
export function buildTomorrowTimelineChips(
  snap: WeatherChatSnap | null,
  nowMs = Date.now(),
): string[] {
  if (!snap) return [];
  const raw = (snap.tomorrowSummary || '').trim();
  const tempM = raw.match(/(-?\d+)\s*[–\-]\s*(-?\d+)\s*°/);
  const parsed = parseDaySummary(raw);
  const lo = tempM ? Number(tempM[1]) : null;
  const hi = parsed.highC;
  const chips: string[] = [];
  if (lo != null && hi != null && lo !== hi) chips.push(`🌡️ ${lo}° bis ${hi}°`);
  else if (hi != null) chips.push(`🌡️ bis ${hi}°`);
  else if (lo != null) chips.push(`🌡️ ${lo}°`);

  const day = new Date(nowMs);
  day.setDate(day.getDate() + 1);
  day.setHours(0, 0, 0, 0);
  const start = day.getTime();
  const end = start + 24 * 3600_000;
  const hours = (snap.skyHours ?? [])
    .filter((h) => h.ms >= start && h.ms < end)
    .filter((h) => {
      const hr = new Date(h.ms).getHours();
      return hr >= 6 && hr <= 23;
    })
    .sort((a, b) => a.ms - b.ms);

  type Win = { emoji: string; startH: number; endH: number };
  const wins: Win[] = [];
  for (const h of hours) {
    const emoji = skyWindowEmoji(h.code);
    const hr = new Date(h.ms).getHours();
    const last = wins[wins.length - 1];
    if (last && last.emoji === emoji && hr <= last.endH + 1) {
      last.endH = Math.max(last.endH, hr);
    } else {
      wins.push({ emoji, startH: hr, endH: hr });
    }
  }
  while (wins.length > 3) {
    let idx = 1;
    let best = Infinity;
    for (let i = 1; i < wins.length; i++) {
      const len = wins[i]!.endH - wins[i]!.startH;
      if (len < best) {
        best = len;
        idx = i;
      }
    }
    wins[idx - 1]!.endH = Math.max(wins[idx - 1]!.endH, wins[idx]!.endH);
    wins.splice(idx, 1);
  }
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i]!;
    const last = i === wins.length - 1;
    const label = last
      ? `ab ${w.startH} Uhr`
      : `${w.startH} bis ${wins[i + 1]!.startH} Uhr`;
    chips.push(`${w.emoji} ${label}`);
  }
  return chips.slice(0, 4);
}

/**
 * Heute: Mittag · Nachmittag · Abend (aus Stunden-Matrix).
 * Max 3 Ablauf-Chips + optional Temp — für Tagesfrage in den Stichpunkten.
 */
export function buildTodayDayPartChips(
  snap: WeatherChatSnap | null,
  nowMs = Date.now(),
): string[] {
  if (!snap) return [];
  const day = new Date(nowMs);
  day.setHours(0, 0, 0, 0);
  const start = day.getTime();
  const end = start + 24 * 3600_000;
  const hours = (snap.skyHours ?? [])
    .filter((h) => h.ms >= start && h.ms < end)
    .sort((a, b) => a.ms - b.ms);

  const pick = (
    fromH: number,
    toH: number,
  ): { emoji: string; code: number } | null => {
    const slice = hours.filter((h) => {
      const hr = new Date(h.ms).getHours();
      return hr >= fromH && hr < toH;
    });
    if (!slice.length) return null;
    // Mitte des Fensters bevorzugen
    const mid = slice[Math.floor(slice.length / 2)]!;
    return { emoji: skyWindowEmoji(mid.code), code: mid.code };
  };

  const noon = pick(11, 14);
  const afternoon = pick(14, 17);
  const evening = pick(17, 22);
  const chips: string[] = [];
  if (noon) chips.push(`${noon.emoji} Mittag`);
  if (afternoon) chips.push(`${afternoon.emoji} Nachmittag`);
  if (evening) chips.push(`${evening.emoji} Abend`);

  const highT = roundDeg(snap.dayHighC);
  const nowT = roundDeg(snap.currentTempC);
  if (chips.length >= 2) {
    if (nowT != null && highT != null && nowT !== highT) {
      chips.unshift(`${nowT}° → ${highT}°`);
    } else if (highT != null) {
      chips.unshift(`bis ${highT}°`);
    }
    return chips.slice(0, 4);
  }
  return [];
}

function weekdayLabelDe(ms: number): string {
  return new Date(ms).toLocaleDateString('de-DE', { weekday: 'long' });
}

function joinDayLabels(labels: string[]): string {
  if (!labels.length) return '';
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} und ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} und ${labels[labels.length - 1]}`;
}

function skySpeechPhrase(sky: string): string {
  const b = skyBucket(sky);
  if (b === 'bewölkt') return 'dicht bewölkt';
  if (b === 'sonnig') {
    if (/wolken und sonne|leicht/i.test(sky)) return 'zeitweiligen Sonnenschein';
    if (/klar/i.test(sky)) return 'überwiegend klar';
    return 'zeitweiligen Sonnenschein';
  }
  if (b === 'nass') return sky.toLowerCase();
  return sky.toLowerCase();
}

/** Allgemeine Vorhersage — Radio-/DWD-Struktur, Slots dynamisch. */
function formatGeneralForecastSpeech(opts: {
  snap: WeatherChatSnap;
  city?: string | null;
  namedCity?: boolean;
  nowMs: number;
}): string | null {
  const snap = opts.snap;
  const nowMs = opts.nowMs;
  const todaySky =
    skyPhraseFromCode(snap.weatherCode, { night: false }) || 'wechselhaft';
  const todayRain =
    (snap.nextRainProb ?? 0) >= 40 ||
    Boolean(snap.isHeavyRain) ||
    /regen|schauer/i.test(todaySky);
  const tom = parseDaySummary(snap.tomorrowSummary);
  const day2 = parseDaySummary(snap.day2Summary);
  const hasTom = Boolean((snap.tomorrowSummary || '').trim());
  const hasDay2 = Boolean((snap.day2Summary || '').trim());
  if (!hasTom && !hasDay2) return null;

  const days: ForecastDayBit[] = [
    {
      label: 'heute',
      sky: todaySky,
      rainy: todayRain,
      highC: roundDeg(snap.dayHighC),
    },
  ];
  if (hasTom) {
    days.push({
      label: 'morgen',
      sky: tom.sky,
      rainy: tom.rainy,
      highC: tom.highC,
    });
  }
  if (hasDay2) {
    days.push({
      label: `am ${weekdayLabelDe(nowMs + 2 * 24 * 3600_000)}`,
      sky: day2.sky,
      rainy: day2.rainy,
      highC: day2.highC,
    });
  }

  // Gruppe nach Himmel-Bucket
  const groups = new Map<string, ForecastDayBit[]>();
  for (const d of days) {
    const key = skyBucket(d.sky);
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const primary = ordered[0];
  const secondary = ordered.find((g) => g[0] !== primary?.[0]);

  const place =
    opts.city &&
    opts.city.length >= 2 &&
    !/^\d+$/u.test(opts.city) &&
    !/^(sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|grad)$/iu.test(opts.city)
      ? ` in ${opts.city}`
      : '';

  const sentences: string[] = [];
  if (primary && secondary) {
    const pLabels = joinDayLabels(primary[1].map((d) => d.label));
    const sLabels = joinDayLabels(secondary[1].map((d) => d.label));
    const pPhrase = skySpeechPhrase(primary[1][0]!.sky);
    const sPhrase = skySpeechPhrase(secondary[1][0]!.sky);
    // „gibt es … Sonnenschein“ vs „zeigt sich … bewölkt“
    const sVerb = /sonnenschein|klar/i.test(sPhrase)
      ? `gibt es ${sLabels} ${sPhrase}`
      : `zeigt sich ${sLabels} eher ${sPhrase}`;
    sentences.push(
      `Während sich das Wetter${place} ${pLabels} ${pPhrase} zeigt, ${sVerb}.`,
    );
  } else if (primary) {
    const pLabels = joinDayLabels(primary[1].map((d) => d.label));
    const pPhrase = skySpeechPhrase(primary[1][0]!.sky);
    sentences.push(
      `Das Wetter${place} zeigt sich ${pLabels} eher ${pPhrase}.`,
    );
  }

  const rainyLabels = days.filter((d) => d.rainy).map((d) => d.label);
  if (rainyLabels.length) {
    sentences.push(
      `Dabei muss ${joinDayLabels(rainyLabels)} mit Regenschauern gerechnet werden.`,
    );
  }

  const windMs = snap.windSpeedMs;
  const gustMs = snap.windGustMs;
  const windy =
    (typeof windMs === 'number' && windMs >= 8) ||
    (typeof gustMs === 'number' && gustMs >= 12);
  const highs = days
    .map((d) => d.highC)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const highAvg =
    highs.length > 0
      ? Math.round(highs.reduce((a, b) => a + b, 0) / highs.length)
      : roundDeg(snap.dayHighC);

  const tailBits: string[] = [];
  if (windy) {
    tailBits.push('weht ein böig auffrischender Wind');
  }
  if (highAvg != null) {
    tailBits.push(`werden Höchstwerte um ${highAvg} Grad erreicht`);
  }
  if (tailBits.length === 1) {
    sentences.push(`Dazu ${tailBits[0]}.`);
  } else if (tailBits.length === 2) {
    sentences.push(`Dazu ${tailBits[0]} und es ${tailBits[1]}.`);
  }

  const speech = sentences
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return speech || null;
}

export function formatWeatherVoiceAnswer(opts: {
  snap: WeatherChatSnap | null;
  cityHint?: string | null;
  nowMs?: number;
  timelineHints?: string[];
  matrix?: WeatherGuideMatrix | null;
  userText?: string | null;
  /** User nannte explizit eine Stadt — nicht „du liegst bei …“. */
  namedCity?: boolean;
  settlementHint?: SkySettlementHint;
}): { speech: string; bullets: string[] } {
  const snap = opts.snap;
  const nowMs = opts.nowMs ?? Date.now();
  const city = (opts.cityHint || '').replace(/\s+/g, ' ').trim() || null;
  const hour = new Date(nowMs).getHours();
  const night = isSunDownNow({
    nowMs,
    sunsetMs: snap?.sunsetMs,
    sunriseMs: snap?.sunriseMs,
  });
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
  // Explizite Stadt ohne „heute“: Ortsbezug behalten (nicht Frühmorgens-Tages-Lead ohne Stadt).
  if (
    namedCity &&
    dayAhead &&
    !/\bheut(?:e|en)\b/i.test(opts.userText ?? '')
  ) {
    dayAhead = false;
  }
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
  const sky = skyPhraseFromCode(snap.weatherCode, {
    night: night && !dayAhead,
  });
  const mild = tempMildLabel(highT);
  const win = mergeRainWindows(snapForRain?.rainWindows ?? [], nowMs)[0];
  const rainLater = Boolean(
    win && win.startMs > nowMs && (prob >= 40 || heavy),
  );
  const rainHour = win ? new Date(win.startMs).getHours() : -1;
  const rainWhenWord =
    rainHour >= 17 ? 'abends' : rainHour >= 12 ? 'nachmittags' : 'später';

  let rainFocus = false;
  try {
    const { looksLikeRainAsk } = require('../concierge/outfitWeatherPresent') as {
      looksLikeRainAsk: (s?: string | null) => boolean;
    };
    rainFocus = looksLikeRainAsk(opts.userText);
  } catch {
    rainFocus = /\b(regnet|regnen|regen|schauer|schirm)\b/iu.test(
      opts.userText ?? '',
    );
  }

  let generalForecast = false;
  try {
    const { weatherAskIsGeneralForecast } = require('../../module2/planning/planUtteranceGate') as {
      weatherAskIsGeneralForecast: (s: string) => boolean;
    };
    generalForecast = weatherAskIsGeneralForecast(opts.userText ?? '');
  } catch {
    generalForecast = /\bwettervorhersage\b/iu.test(opts.userText ?? '');
  }

  if (generalForecast && !rainFocus && !dayAhead) {
    const radio = formatGeneralForecastSpeech({
      snap,
      city,
      namedCity,
      nowMs,
    });
    if (radio) {
      const todayParts = buildTodayDayPartChips(snap, nowMs);
      const timeline = buildTomorrowTimelineChips(snap, nowMs);
      const bullets =
        todayParts.length >= 3
          ? todayParts
          : timeline.length >= 2
            ? timeline
            : buildWeatherFactChips({
              snap: snapForRain,
              nowMs,
              dayAhead: false,
              night: false,
            });
      return { speech: radio, bullets };
    }
  }

  const bits: string[] = [];
  if (dayAhead) {
    const skyBit = sky ? sky.toLowerCase() : 'wechselhaft';
    let lead = `Tagesüber eher ${skyBit}`;
    if (rainLater) {
      lead += win
        ? `, ${rainWhenWord} soll's dann regnen (so ab ${formatHm(win.startMs)})`
        : `, ${rainWhenWord} soll's dann regnen`;
    } else if (prob >= 55 || heavy) {
      lead += ', und Regen ist im Spiel';
    }
    if (highT != null) {
      lead += ` — Höchstwerte bis so um die ${highT} Grad${mild ? `, ${mild}` : ''}`;
    }
    bits.push(`${lead}.`);
  } else if (night) {
    const skyBit = sky ? sky.toLowerCase() : 'ruhig';
    let nightLead =
      namedCity && city && nowT != null
        ? `In ${city} gerade ${nowT} Grad, ${skyBit}`
        : nowT != null
          ? `Gerade so um die ${nowT} Grad, ${skyBit}`
          : `Gerade eher ${skyBit}`;
    const stars = nightSkyStarsClause(sky, opts.settlementHint ?? null);
    if (stars) nightLead += ` — ${stars.replace(/\.$/, '')}`;
    bits.push(`${nightLead}.`);
  } else {
    const skyBit = sky ? sky.toLowerCase() : 'wechselhaft';
    let lead =
      namedCity && city
        ? `In ${city} gerade ${skyBit}`
        : `Gerade eher ${skyBit}`;
    if (nowT != null) lead += ` bei ${nowT} Grad`;
    if (highT != null && (nowT == null || highT > nowT + 1)) {
      lead += ` — tagsüber bis so um die ${highT}${mild ? `, ${mild}` : ''}`;
    }
    if (rainLater) {
      lead += win
        ? `, ${rainWhenWord} wird's nass (ab ${formatHm(win.startMs)})`
        : `, ${rainWhenWord} wird's nass`;
    }
    bits.push(`${lead}.`);
  }

  if (rainFocus) {
    const dry = describeDrySpell(snapForRain, nowMs);
    const rainStory = dry || rainStoryLine(snapForRain, nowMs, heavy, prob);
    if (rainStory && bits.length < 2) bits.push(rainStory);
  } else if (thunder && bits.length < 2) {
    bits.push('Gewitter sind im Raum — draußen nicht zu lange festnageln.');
  }

  const timelineLine = weatherTimelineLineFromMatrix(
    opts.timelineHints ?? [],
    opts.matrix,
  );
  if (timelineLine && bits.length < 2) bits.push(timelineLine);

  let speech = joinGuideSentences(bits.slice(0, 2));
  if (!speech && snap.summaryLine?.trim()) {
    speech = snap.summaryLine.trim();
  }
  speech = unwrapClothingParentheses(speech);
  // Call-2 nie erneut wie Call-1 öffnen („Also…“, „so ist das Wetter in …“)
  speech = speech
    .replace(
      /^(also[,:]?\s+|kurz\s+zum\s+wetter[:\s]+|zum\s+wetter[:\s]+)/iu,
      '',
    )
    .replace(/^so\s+ist\s+das\s+wetter(?:\s+in\s+[^,:.]+)?[,:]?\s*/iu, '')
    .replace(
      /^das\s+wetter\s+(?:wird|soll)(?:\s+folgendermaßen)?[,:]?\s*/iu,
      '',
    )
    .replace(
      /^am\s+\w+\s+soll\s+das\s+wetter(?:\s+in\s+[^,:.]+)?(?:\s+folgendermaßen)?\s+werden[,:]?\s*/iu,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (speech && !/[.!?…]$/u.test(speech)) speech = `${speech}.`;

  const bulletsRaw = (() => {
    if (dayAhead || generalForecast) {
      const dayParts = buildTodayDayPartChips(snap, nowMs);
      if (dayParts.length >= 3) return dayParts;
    }
    return buildWeatherFactChips({
      snap: snapForRain,
      nowMs,
      dayAhead,
      night,
    });
  })();
  const bullets = bulletsRaw.map((b) => {
    try {
      const { compactBulletDigits } = require('../concierge/bulletDigits');
      return compactBulletDigits(b);
    } catch {
      return b;
    }
  });

  return { speech, bullets };
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
 * Wetter-Ort:
 * - Default = GPS (wo der User steht)
 * - Explizite Stadt („Wetter in London“) → Geocode
 * - „da/dort / aktuell da“ → Gesprächsstadt (Sticky), sonst GPS
 * Sticky/Flugziel allein reicht NICHT mehr.
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
    const {
      weatherAskWantsLocalGps,
      weatherAskWantsConversationPlace,
    } = require('../../module2/planning/planUtteranceGate') as {
      weatherAskWantsLocalGps: (s: string) => boolean;
      weatherAskWantsConversationPlace: (s: string) => boolean;
    };
    const explicit = extractCityFromText(text);
    if (explicit) {
      return { city: explicit, namedCity: true, useGps: false };
    }
    if (weatherAskWantsLocalGps(text)) {
      return { city: null, namedCity: false, useGps: true };
    }
    if (weatherAskWantsConversationPlace(text)) {
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
        speech:
          'Wetter hab ich gerade nicht frisch — in einer Minute nochmal versuchen.',
        bullets: ['Live-Wetter kurz nicht da', 'Gleich nochmal versuchen'],
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
      return tom.speech.trim() ? tom : null;
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
          // Nur harter Outdoor-Konflikt — kein weicher „bis Mittagessen kein Schirm“-Nachsatz
          const {
            evaluatePlanAgainstWeather,
            formatWeatherTimelineHints,
          } = require('./weatherPlanTimelineHints') as {
            evaluatePlanAgainstWeather: (nowMs?: number) => {
              ok: boolean;
              riskyStops: unknown[];
            };
            formatWeatherTimelineHints: (o: {
              nowMs?: number;
              snap?: WeatherChatSnap | null;
            }) => string[];
          };
          const fit = evaluatePlanAgainstWeather(Date.now());
          if (fit.ok || !fit.riskyStops.length) return [];
          return formatWeatherTimelineHints({ snap: cached }).filter((h) =>
            /bei[ßs]t|Regen|indoor|früher|vorziehen/i.test(h),
          );
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
  const night = isSunDownNow({
    nowMs: Date.now(),
    sunsetMs: snap?.sunsetMs,
    sunriseMs: snap?.sunriseMs,
  });
  const nowT = roundDeg(snap?.currentTempC);
  const highT = roundDeg(snap?.dayHighC);
  const sky =
    skyPhraseFromCode(snap?.weatherCode, { night }) ??
    (snap?.summaryLine
      ? snap.summaryLine
          .replace(/^aktuell\s*-?\d+\s*°\s*[·,|\-–]?\s*/i, '')
          .split(/\s*[·|]\s*/)[0]
          ?.trim()
      : null);
  const out: string[] = [];
  out.push(sky ? sky.charAt(0).toUpperCase() + sky.slice(1) : 'Himmel unklar');
  if (!night && nowT != null && highT != null && highT !== nowT) {
    out.push(`${nowT}–${highT}°`);
  } else if (!night && highT != null) {
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
