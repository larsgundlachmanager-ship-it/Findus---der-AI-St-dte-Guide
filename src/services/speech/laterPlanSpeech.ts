/**
 * Zeit-ehrliche Pitch-Speech — ohne App-/RN-Imports (Smoke-Tests).
 * SSOT-Policy: FINDUS_WOVEN_PITCH_SPEECH_BLOCK.
 */

export function parseSpokenClockToMinutes(text: string): number | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const hm = t.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
  }
  const um = t.match(/\b(?:um|ab)\s+(\d{1,2})(?:\s*uhr)?\b/iu);
  if (um) {
    const h = Number(um[1]);
    if (h >= 0 && h <= 23) return h * 60;
  }
  const uhr = t.match(/\b(\d{1,2})\s*uhr\b/iu);
  if (uhr) {
    const h = Number(uhr[1]);
    if (h >= 0 && h <= 23) return h * 60;
  }
  return null;
}

function collectStartClocksMinutes(text: string): number[] {
  const stripped = text
    .replace(/\bbis\s+\d{1,2}(?:[:.]\d{2})?(?:\s*uhr)?\b/giu, ' ')
    .replace(/\bläuft\s+noch\b/giu, ' ');
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (h: number, m: number) => {
    if (h < 0 || h > 23 || m < 0 || m > 59) return;
    const minutes = h * 60 + m;
    if (seen.has(minutes)) return;
    seen.add(minutes);
    out.push(minutes);
  };
  for (const m of stripped.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)) {
    push(Number(m[1]), Number(m[2]));
  }
  for (const m of stripped.matchAll(/\b(?:um|ab)\s+(\d{1,2})(?:\s*uhr)?\b/giu)) {
    push(Number(m[1]), 0);
  }
  for (const m of stripped.matchAll(/\b(\d{1,2})\s*uhr\b/giu)) {
    push(Number(m[1]), 0);
  }
  return out;
}

/**
 * Zeitgenaue Vorstellungen: Start vorbei → skip, kein „läuft noch“.
 * Stadt-agnostisch (Kino, Konzert, Auftritt, Finsternis, Screening).
 */
export function looksLikeTimedStartShow(text: string): boolean {
  return /\b(kino|cinema|filmvorstellung|filmabend|open[\s-]?air[\s-]?kino|konzert|concert|auftritt|gigs?|vorstellung|aufführung|auffuehrung|screening|premiere|lesung|theaterstück|theaterstueck|musical|\boper\b|operette|sonnenfinsternis|mondfinsternis|finsternis|eclipse|anpfiff|spielbeginn|showtime|show[\s-]?start)\b/iu.test(
    text,
  );
}

/**
 * Tages-/Straßenfeste: dürfen „läuft noch bis …“ (Ende nur belegt).
 * Weinfest, Umzug, Hafengeburtstag, Kinderschminken, Markt.
 */
export function looksLikeOngoingDayEvent(text: string): boolean {
  return /\b(straßenfest|strassenfest|landstraßenfest|landstrassenfest|stadtfest|stadt\s*fest|weinfest|wein\s*fest|bierfest|oktoberfest|volksfest|sommerfest|hafengeburtstag|hafenfest|umzug|festumzug|korso|laternenumzug|kinderschmink|kinderprogramm|familienfest|wochenmarkt|flohmarkt|jahrmarkt|kirmes|weihnachtsmarkt|kiezfest|viertelfest|dorfest|dorffest|weinmarkt|fest(?:ival)?)\b/iu.test(
    text,
  );
}

function pitchKindFromHint(kindHint?: string | null): 'timed_show' | 'day_festival' | null {
  const k = String(kindHint || '').trim().toLowerCase();
  if (!k) return null;
  if (k === 'festival' || k === 'markt' || k === 'market' || k === 'kids') {
    return 'day_festival';
  }
  return null;
}

function resolveLiveEventPitchKind(
  text: string,
  kindHint?: string | null,
): 'timed_show' | 'day_festival' | 'unknown' {
  const day = looksLikeOngoingDayEvent(text) || pitchKindFromHint(kindHint) === 'day_festival';
  const timed = looksLikeTimedStartShow(text);
  if (day) return 'day_festival';
  if (timed) return 'timed_show';
  return 'unknown';
}

function parseEndClockMinutes(text: string): number | null {
  const strippedBis = text.match(
    /\b(?:bis|endet|ende|schließt|schliesst)\s*(?:um\s*)?(\d{1,2})[:.](\d{2})(?:\s*uhr)?\b/iu,
  );
  if (strippedBis) {
    const h = Number(strippedBis[1]);
    const m = Number(strippedBis[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
  }
  const uhr = text.match(
    /\b(?:bis|endet|ende|schließt|schliesst)\s*(?:um\s*)?(\d{1,2})\s*uhr(?:\s*(\d{1,2}))?\b/iu,
  );
  if (uhr) {
    const h = Number(uhr[1]);
    const m = uhr[2] != null ? Number(uhr[2]) : 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
  }
  return null;
}

export type LiveEventPitchOpts = {
  kindHint?: string | null;
};

/**
 * Live-Events pitchen: Tagesfeste dürfen schon laufen („läuft noch bis“).
 * Zeitgenaue Starts (Kino/Konzert/Auftritt/Finsternis) nur vor dem Start.
 */
export function isUpcomingForUnsolicitedPitch(
  text: string,
  now: Date = new Date(),
  opts?: LiveEventPitchOpts,
): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (
    /\b(morgen|übermorgen|uebermorgen|nächste[nr]?\s+(woche|wochenende))\b/iu.test(
      t,
    )
  ) {
    return true;
  }

  const kind = resolveLiveEventPitchKind(t, opts?.kindHint);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const starts = collectStartClocksMinutes(t);
  const endMin = parseEndClockMinutes(t);
  const futureStart = starts.some((c) => c > nowMin);
  const pastStart = starts.some((c) => c <= nowMin);
  const stillBeforeEnd = endMin == null || endMin > nowMin;

  if (endMin != null && endMin <= nowMin && !futureStart) return false;

  if (kind === 'timed_show') {
    return futureStart;
  }

  if (kind === 'day_festival') {
    if (futureStart) return true;
    if (!stillBeforeEnd) return false;
    if (/\bläuft\s+(schon|noch)\b/iu.test(t)) return true;
    if (pastStart) {
      if (endMin != null) return true;
      return now.getHours() < 22;
    }
    if (endMin != null) return true;
    if (/\bheute\s+abend|abends\b/iu.test(t)) return now.getHours() < 23;
    if (/\bheute\b/iu.test(t)) return now.getHours() < 22;
    return now.getHours() >= 10 && now.getHours() < 22;
  }

  if (futureStart) return true;
  if (pastStart) return false;
  if (/\bläuft\s+(schon|noch)\b/iu.test(t)) return false;
  if (/\bheute\s+abend|abends\b/iu.test(t)) return now.getHours() < 20;
  if (/\bheute\b/iu.test(t)) return now.getHours() < 18;
  return false;
}

export function formatClockMinutesForSpeech(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} Uhr`;
  return `${h}:${String(m).padStart(2, '0')} Uhr`;
}

/**
 * Start liegt klar später (heute Abend / in ≥ ~45 Min) — kein Los-jetzt-Ton.
 */
export function isLaterPlanSchedule(opts: {
  whenText?: string | null;
  startTime?: string | null;
  now?: Date;
  minAheadMin?: number;
}): boolean {
  const now = opts.now ?? new Date();
  const minAhead = opts.minAheadMin ?? 45;
  const blob = `${opts.startTime || ''} ${opts.whenText || ''}`.replace(
    /\s+/g,
    ' ',
  );
  if (!blob.trim()) return false;
  if (/\bläuft\s+(schon|noch)\b/iu.test(blob) || /\bläuft\s+schon\b/iu.test(blob)) {
    return false;
  }
  if (/\b(morgen|übermorgen|am\s+wochenende|dieses\s+wochenende)\b/iu.test(blob)) {
    return true;
  }
  const clock =
    parseSpokenClockToMinutes(opts.startTime || '') ??
    parseSpokenClockToMinutes(blob);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (clock != null) {
    return clock >= nowMin + minAhead;
  }
  if (/\b(heute\s+abend|abends|tonight)\b/iu.test(blob)) {
    return now.getHours() < 18;
  }
  return false;
}

/** „heute Abend um 21 Uhr“ — nur wenn Start wirklich später ist. */
export function formatRelativeWhenSpeech(opts: {
  startTime?: string | null;
  whenText?: string | null;
  now?: Date;
}): string {
  const now = opts.now ?? new Date();
  const clock =
    parseSpokenClockToMinutes(opts.startTime || '') ??
    parseSpokenClockToMinutes(opts.whenText || '');
  if (!isLaterPlanSchedule({ ...opts, now }) || clock == null) {
    return '';
  }
  const label = formatClockMinutesForSpeech(clock);
  if (clock >= 17 * 60) return `heute Abend um ${label}`;
  return `um ${label}`;
}

/** Nähe nebenbei — nie als Sofort-Los. */
export function formatLaterPlanClosenessSpeech(
  meters: number | null | undefined,
): string {
  if (meters == null || !Number.isFinite(meters) || meters <= 0) return '';
  if (meters <= 1200) return 'liegt nicht weit';
  if (meters <= 4000) return 'ist gut zu erreichen';
  return '';
}

function colloquialDistanceHint(meters: number): string {
  if (meters <= 40) return ' — direkt vor dir';
  if (meters <= 100) return ' — so um die Ecke';
  if (meters <= 400) return ` — so um die ${Math.round(meters / 10) * 10} Meter`;
  if (meters < 1000) return ` — noch so 'ne ${Math.round(meters / 50) * 50} Meter`;
  const km = Math.round((meters / 1000) * 10) / 10;
  return ` — so um die ${km.toString().replace('.', ',')} km`;
}

function decapitalizeLead(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

function hasSoftOpener(text: string): boolean {
  return /\b(ich hab|ich habe|geschaut|geguckt|mal nach|kurzer tipp|pass auf)\b/iu.test(
    text,
  );
}

function hasInvite(text: string): boolean {
  return /\b(was hältst du|soll ich.{0,24}(einplanen|merken)|lust hast|wie klingt)\b/iu.test(
    text,
  );
}

export type TemporaryLiveSpeechSpot = {
  name: string;
  whenLabel: string;
  distanceHintM: number | null;
  hook: string;
};

/** Umgangssprachliche Ansage — Zeit weben, kein Los-jetzt bei Abend-Events. */
export function formatTemporaryLiveSpeech(
  spot: TemporaryLiveSpeechSpot,
  now = new Date(),
): string {
  const hook = spot.hook.replace(/\s+/g, ' ').trim().replace(/[.!?\s]+$/u, '');
  const name = spot.name.replace(/\s+/g, ' ').trim();
  const when = (spot.whenLabel || '').trim();
  const hasName =
    name.length >= 3 && hook.toLowerCase().includes(name.toLowerCase());
  let body = hasName ? hook : `${hook} — ${name}`;

  const later = isLaterPlanSchedule({
    whenText: `${when} ${body}`,
    now,
  });
  const whenSpeech = formatRelativeWhenSpeech({ whenText: when, now });
  const bodyHasClock = parseSpokenClockToMinutes(body) != null;
  const whenHasClock = parseSpokenClockToMinutes(when) != null;

  if (later && whenSpeech && whenHasClock && !bodyHasClock) {
    if (/heute\s+abend/iu.test(body)) {
      body = body.replace(/heute\s+abend/iu, whenSpeech);
    } else {
      body = `${whenSpeech} ${decapitalizeLead(body)}`;
    }
  } else if (
    later &&
    whenSpeech &&
    !/heute\s+abend|\b\d{1,2}\s*uhr\b/iu.test(body)
  ) {
    body = `${whenSpeech} ${decapitalizeLead(body)}`;
  }

  if (later && !hasSoftOpener(body)) {
    body = `Ich hab mal geschaut, was heute noch geht — ${body}`;
  }

  if (later) {
    const close = formatLaterPlanClosenessSpeech(spot.distanceHintM);
    if (close && !/nicht weit|gut zu erreichen|um die ecke/iu.test(body)) {
      body = `${body}, ${close}`;
    }
  } else if (spot.distanceHintM != null && spot.distanceHintM > 0) {
    body = `${body}${colloquialDistanceHint(spot.distanceHintM)}`;
  }

  body = body.replace(/[,;\s]+$/u, '');
  if (!/[.!?]$/.test(body)) body += '.';

  if (later && !hasInvite(body)) {
    body +=
      ' Wenn du Lust hast, können wir uns das merken — soll ich den Termin einplanen?';
  }
  return body.replace(/\s+/g, ' ').trim();
}
