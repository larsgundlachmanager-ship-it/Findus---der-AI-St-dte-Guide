/**
 * Leave-by-Speech aus Timeline-Uhren — eine Stimme, keine zweite Rechnung.
 * Struktur-Blaupause, Wortlaut frei genug für Fallback.
 */

export function clockFromMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const dt = new Date(ms);
  return `${dt.getHours().toString().padStart(2, '0')}:${dt
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

export function buildLeaveBySpeech(opts: {
  destCity: string;
  ident: string;
  depMs: number;
  leaveMs: number;
  airportMs: number;
  luggage: 'carry' | 'checked';
  leaveByAsk: boolean;
  /** Nach Puffer-Chip: neue Uhren bestätigen, nicht nochmal fragen. */
  bufferConfirm?: boolean;
  /** User sagt Zeitplan passt — kurze Bestätigung, kein Wien-Drift. */
  planAck?: boolean;
  transitLeaveMs?: number | null;
  accessRecommend?: 'taxi' | 'transit' | 'either';
  /** Check-in-Uhr nur bei Aufgabegepäck. */
  checkinClock?: string | null;
  /** Taxi-Fahrzeit für den geplanten Start — nie „aktuell nachts“. */
  taxiMin?: number | null;
  taxiPrice?: string | null;
  wakeClock?: string | null;
  /** „morgen“ / „heute“ — woher der Kalendertag kommt, Wortlaut frei. */
  daySpoken?: string | null;
}): { speech: string; bullets: string[] } {
  const dep = clockFromMs(opts.depMs);
  const leave = clockFromMs(opts.leaveMs);
  const airport = clockFromMs(opts.airportMs);
  const ident =
    opts.ident.startsWith('CLK') ? null : opts.ident.replace(/\s+/g, '');
  const bag =
    opts.luggage === 'checked' ? 'mit Aufgabegepäck' : 'nur mit Handgepäck';
  const city = opts.destCity.trim();
  const found = ident
    ? `${ident} nach ${city} um ${dep}`
    : `Abflug ${dep} nach ${city}`;
  const dayBit = opts.daySpoken?.trim()
    ? ` (${opts.daySpoken.trim()})`
    : '';
  const foundWithDay = `${found}${dayBit}`;
  const taxiBit =
    opts.taxiMin != null && opts.taxiMin >= 1
      ? ` Taxi etwa ${opts.taxiMin} Min${opts.taxiPrice ? ` (${opts.taxiPrice})` : ''}`
      : '';
  const accessAsk =
    opts.accessRecommend === 'transit'
      ? ` Mit den Öffis oder lieber Taxi?`
      : ` ÖPNV oder Taxi — was passt besser?`;
  const checkin =
    opts.luggage === 'checked' && opts.checkinClock
      ? ` Check-in um ${opts.checkinClock}.`
      : '';
  const wake =
    opts.wakeClock
      ? ` Soll ich den Wecker auf ${opts.wakeClock} stellen?`
      : '';
  const bufferAsk = ` Passt der Puffer so, oder brauchst du mehr oder weniger?`;
  const transitLeave = clockFromMs(opts.transitLeaveMs);
  const bufferRecalcSpeech =
    transitLeave && transitLeave !== '—' && leave !== '—'
      ? `Mit angepasstem Puffer: Öffis los um ${transitLeave}, Taxi um ${leave}${taxiBit}. Am Terminal ${airport}.`
      : `Neuer Puffer — Los ${leave}, am Terminal ${airport}. Steht so im Plan.${accessAsk}`;
  const speech = opts.planAck
    ? `Passt — der Zeitplan Richtung ${city} bleibt so. Los ${leave}, am Terminal ${airport}.`
    : opts.bufferConfirm
    ? bufferRecalcSpeech
    : opts.leaveByAsk
      ? `${foundWithDay}, laut Abflugtafel. Am Flughafen solltest du um ${airport} sein, ${bag}. Los ${leave}.${checkin}${bufferAsk}${accessAsk}${wake}`
      : `${foundWithDay}, laut Abflugtafel. Los ${leave}.${checkin}${bufferAsk}${accessAsk}${wake}`;
  return {
    speech,
    bullets: [
      ident ? `${ident} ${dep} · ${opts.destCity}` : `${dep} · ${opts.destCity}`,
      `Los ${leave} · Flughafen ${airport}`,
      opts.luggage === 'checked' ? 'Mit Aufgabegepäck' : 'Nur Handgepäck',
    ].filter(Boolean) as string[],
  };
}
