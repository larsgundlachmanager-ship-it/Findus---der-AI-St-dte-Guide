/**
 * Wetter Call-2: 1–2 kurze umgangssprachliche Sätze, Answer-First.
 * Kein Opener („Also in Prisdorf…“ / „Zum Wetter:“) — das war Call 1.
 * Kleidung nur in Stichpunkten, nicht nochmal in der Speech.
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
  const eveningRain = Boolean(
    win &&
      win.startMs > nowMs &&
      (new Date(win.startMs).getHours() >= 16 || prob >= 45),
  );

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

  const bits: string[] = [];
  if (dayAhead) {
    const skyBit = sky ? sky.toLowerCase() : 'wechselhaft';
    let lead = `Tagesüber eher ${skyBit}`;
    if (eveningRain) {
      lead += win
        ? `, abends soll's dann regnen (so ab ${formatHm(win.startMs)})`
        : `, abends soll's dann regnen`;
    } else if (prob >= 55 || heavy) {
      lead += ', und Regen ist im Spiel';
    }
    if (highT != null) {
      lead += ` — Höchstwerte bis so um die ${highT} Grad${mild ? `, ${mild}` : ''}`;
    }
    bits.push(`${lead}.`);
  } else if (night) {
    const skyBit = sky ? sky.toLowerCase() : 'ruhig';
    if (namedCity && city && nowT != null) {
      bits.push(`In ${city} gerade ${nowT} Grad, ${skyBit}.`);
    } else if (nowT != null) {
      bits.push(`Gerade so um die ${nowT} Grad, ${skyBit}.`);
    } else {
      bits.push(`Gerade eher ${skyBit}.`);
    }
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
    if (eveningRain) {
      lead += win
        ? `, abends wird's nass (ab ${formatHm(win.startMs)})`
        : `, abends wird's nass`;
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

  const bullets = buildWeatherFactChips({
    snap: snapForRain,
    nowMs,
    dayAhead,
    night,
  });

  return { speech, bullets };
}

