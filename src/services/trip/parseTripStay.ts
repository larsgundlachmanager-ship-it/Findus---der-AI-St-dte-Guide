/**
 * Touristen-Trip: „4 Tage München“, „Wochenende in Lübeck“, „Tagestrip …“.
 * Struktur-Parser — kein Hardcode-Wortlaut für Speech.
 */

import { offsetDateKey, todayDateKey } from '../../utils/dateKeys';

const DAY_WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  eins: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
};

export type TripStayParse = {
  /** Aufenthaltsdauer in Kalendertagen (1–14) */
  dayCount: number;
  /** Optionaler Stadtname aus der Äußerung */
  cityName: string | null;
  /** Start-Tag YYYY-MM-DD (heute, außer „ab morgen“) */
  startDayKey: string;
  sourceText: string;
};

function clampDays(n: number): number | null {
  if (!Number.isFinite(n) || n < 1 || n > 14) return null;
  return Math.round(n);
}

function parseDayCountToken(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  if (/^\d{1,2}$/.test(t)) return clampDays(Number(t));
  return clampDays(DAY_WORDS[t] ?? NaN);
}

function cleanCityName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,!?;:]+$/g, '')
    .replace(
      /\b(erkunden|erleben|fliegen|fahren|reisen|urlaub|trip|aufenthalt|mit|und|dann|heute|morgen)\b.*$/iu,
      '',
    )
    .trim();
  // „die Stadt München“ / „nach München rein“
  s = s
    .replace(/^(die|der|das|stadt|insel)\s+/iu, '')
    .replace(/\s+rein$/iu, '')
    .trim();
  if (s.length < 2 || s.length > 48) return null;
  if (/^(tage?|nächte?|naechte?|wochen?)$/iu.test(s)) return null;
  return s;
}

/**
 * Erkennt Touristen-Aufenthalt (N Tage / Wochenende / Tagestrip + optional Stadt).
 */
export function parseTripStayUtterance(
  text: string,
  nowMs = Date.now(),
): TripStayParse | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 8) return null;

  let startDayKey = todayDateKey();
  if (/\bab\s+übermorgen\b|\bab\s+uebermorgen\b/iu.test(t)) {
    startDayKey = offsetDateKey(2, nowMs);
  } else if (/\bab\s+morgen\b/iu.test(t)) {
    startDayKey = offsetDateKey(1, nowMs);
  } else if (/\bin\s+(zwei|2)\s+wochen?\b/iu.test(t)) {
    startDayKey = offsetDateKey(14, nowMs);
  } else if (/\bin\s+(drei|3)\s+wochen?\b/iu.test(t)) {
    startDayKey = offsetDateKey(21, nowMs);
  } else if (/\bin\s+(einer?\s+)?(eine[rn]?\s+)?woche\b/iu.test(t) && !/\bwochenende\b/iu.test(t)) {
    startDayKey = offsetDateKey(7, nowMs);
  } else {
    const inDays = t.match(/\bin\s+(\d{1,2})\s*tagen?\b/iu);
    if (inDays) {
      const n = Number(inDays[1]);
      if (n >= 1 && n <= 60) startDayKey = offsetDateKey(n, nowMs);
    }
  }

  let dayCount: number | null = null;
  let cityName: string | null = null;

  // Tagestrip / Städtetrip X
  const dayTrip = t.match(
    /\b(?:tages\s*trip|tagestrip|städtetrip|staedtetrip|day\s*trip)\s+(?:nach\s+|in\s+|auf\s+)?([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\- ]{1,40})/iu,
  );
  if (dayTrip) {
    dayCount = 1;
    cityName = cleanCityName(dayTrip[1]);
  }

  // Wochenende in/nach X / für ein Wochenende nach X
  if (!dayCount) {
    const we =
      t.match(
        /\bwochenende\s+(?:in|nach|auf)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\- ]{1,40})/iu,
      ) ||
      t.match(
        /\bfür\s+(?:ein\s+)?wochenende\s+(?:nach|in|auf)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\- ]{1,40})/iu,
      );
    if (we || /\bwochenende\b/iu.test(t)) {
      dayCount = 2;
      if (we) cityName = cleanCityName(we[1]);
    }
  }

  // „eine Woche in X“
  if (!dayCount && /\b(?:eine\s+)?woche\b/iu.test(t)) {
    const wk = t.match(
      /\b(?:eine\s+)?woche\s+(?:in|nach|auf)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\- ]{1,40})/iu,
    );
    dayCount = 7;
    if (wk) cityName = cleanCityName(wk[1]);
  }

  // „4 Tage in/nach München“ / „vier Tage München“
  if (!dayCount) {
    const m1 = t.match(
      /\b(\d{1,2}|ein|eine|eins|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)\s*tage?\s+(?:in|nach|auf)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\- ]{1,40})/iu,
    );
    if (m1) {
      dayCount = parseDayCountToken(m1[1]!);
      cityName = cleanCityName(m1[2]);
    }
  }
  if (!dayCount) {
    const m2 = t.match(
      /\b(\d{1,2}|ein|eine|eins|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)\s*tage?\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\- ]{1,40})/iu,
    );
    if (m2) {
      dayCount = parseDayCountToken(m2[1]!);
      cityName = cleanCityName(m2[2]);
    }
  }

  // „München für 4 Tage“ / „nach München für vier Tage“
  if (!dayCount) {
    const m3 = t.match(
      /\b(?:nach\s+|in\s+|auf\s+)?([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\- ]{1,40}?)\s+für\s+(\d{1,2}|ein|eine|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)\s*tage?\b/iu,
    );
    if (m3) {
      cityName = cleanCityName(m3[1]);
      dayCount = parseDayCountToken(m3[2]!);
    }
  }

  // „ich bin/flieg/fahre … N Tage …“
  if (!dayCount) {
    const m4 = t.match(
      /\b(?:bin|flieg\w*|fahr\w*|reis\w*|urlaub).{0,48}?\b(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|sieben)\s*tage?\b/iu,
    );
    if (m4) {
      dayCount = parseDayCountToken(m4[1]!);
      const cityHit = t.match(
        /\b(?:in|nach|auf)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\- ]{1,40})/iu,
      );
      if (cityHit) cityName = cleanCityName(cityHit[1]);
    }
  }

  if (!dayCount) return null;

  // Ohne Stadt nur akzeptieren, wenn klar Trip-Sprache (nicht „in 4 Tagen zum Arzt“)
  const tripCue =
    /\b(urlaub|trip|aufenthalt|erkunden|erleben|städtetrip|staedtetrip|tagestrip|wochenende|flieg|fahr|reis)\b/iu.test(
      t,
    ) || Boolean(cityName);
  if (!tripCue) return null;

  // „in 4 Tagen“ (Zukunfts-Offset) ≠ Aufenthaltsdauer — ausschließen wenn nur Offset
  if (
    !cityName &&
    /\bin\s+\d{1,2}\s*tagen?\b/iu.test(t) &&
    !/\b\d{1,2}\s*tage?\s+(?:in|nach|auf)\b/iu.test(t)
  ) {
    return null;
  }

  return {
    dayCount,
    cityName,
    startDayKey,
    sourceText: t.slice(0, 240),
  };
}

/** Reiner Trip-Setup ohne Chaos-Tagesplan-Details. */
export function looksLikeTripStayOnly(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!parseTripStayUtterance(t)) return false;
  // Mehrere Wunsch-Buckets → weiter in normalen Plan-Ingest
  const buckets =
    Number(/\b(frühstück|fruehstueck|breakfast)\b/i.test(t)) +
    Number(/\b(mittag|lunch)\b/i.test(t)) +
    Number(/\b(abendessen|dinner|restaurant)\b/i.test(t)) +
    Number(/\b(museum|theater|kino)\b/i.test(t)) +
    Number(/\b(party|club|bar|nightlife)\b/i.test(t)) +
    Number(/\b(meeting|termin)\b/i.test(t));
  if (buckets >= 2) return false;
  if (/\b(und\s+dann|danach|zuerst).{0,40}\b(essen|museum|hotel)\b/i.test(t)) {
    return false;
  }
  return true;
}

export function looksLikeTripStayUtterance(text: string): boolean {
  return parseTripStayUtterance(text) != null;
}
