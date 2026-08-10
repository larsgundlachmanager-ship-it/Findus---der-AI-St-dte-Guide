/**
 * Reservierungs-URLs so weit wie möglich vorausfüllen (Query-Params).
 * Absenden bleibt dem User / Partner-API vorbehalten (Captcha/Login/Recht).
 *
 * Kette: Partner-API → Web (Prefill) → Anrufen → Mail-Entwurf.
 * Viele Restaurant-Seiten ignorieren URL-Params — dann helfen Call/Mail.
 */

export type ReservationPrefill = {
  partySize?: number | null;
  /** ISO date YYYY-MM-DD */
  dateIso?: string | null;
  /** HH:mm */
  timeHm?: string | null;
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  /** Geburtstag, Fensterplatz, … */
  notes?: string | null;
};

/** Uhrzeit aus User-Text → HH:mm */
export function parseTimeHm(text: string): string | null {
  const m =
    text.match(/\bum\s+(\d{1,2})(?:[.:](\d{2}))?\s*(?:uhr)?\b/i) ||
    text.match(/\b(\d{1,2})[.:](\d{2})\s*uhr\b/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] != null ? Number(m[2]) : 0;
  if (!Number.isFinite(h) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function parsePartySize(text: string): number | null {
  const m = text.match(
    /\b(?:für|fuer|zu)\s+(\d{1,2})\s*(?:person|personen|leute|gäste|gaeste|pax)?\b/i,
  );
  if (!m) {
    const alt = text.match(
      /\b(\d{1,2})\s*(?:person|personen|leute|gäste|gaeste|pax)\b/i,
    );
    if (!alt) return null;
    const n = Number(alt[1]);
    if (!Number.isFinite(n) || n < 1 || n > 20) return null;
    return n;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 20) return null;
  return n;
}

/** Datum aus Text → ISO YYYY-MM-DD (heute/morgen/Wochentag/TT.MM.) */
export function parseDateIso(text: string, now = new Date()): string | null {
  const t = text.toLowerCase();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  if (/\bheute\b/.test(t)) return iso(now);
  if (/\bmorgen\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return iso(d);
  }
  if (/\bübermorgen\b|\buebermorgen\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return iso(d);
  }

  const days: Array<[RegExp, number]> = [
    [/\bsonntag\b/, 0],
    [/\bmontag\b/, 1],
    [/\bdienstag\b/, 2],
    [/\bmittwoch\b/, 3],
    [/\bdonnerstag\b/, 4],
    [/\bfreitag\b/, 5],
    [/\bsamstag\b|\bsonnabend\b/, 6],
  ];
  for (const [re, weekday] of days) {
    if (!re.test(t)) continue;
    const d = new Date(now);
    const cur = d.getDay();
    let add = (weekday - cur + 7) % 7;
    if (add === 0 && !/\bheute\b/.test(t)) add = 7;
    d.setDate(d.getDate() + add);
    return iso(d);
  }

  const dm = t.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    let year = dm[3] ? Number(dm[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      if (d.getTime() < now.getTime() - 12 * 3600_000 && !dm[3]) {
        d.setFullYear(d.getFullYear() + 1);
      }
      return iso(d);
    }
  }

  if (/\bnächstes\s+wochenende\b|\bnaechstes\s+wochenende\b|\bwochenende\b/.test(t)) {
    const d = new Date(now);
    const cur = d.getDay();
    const add = cur === 6 ? 0 : cur === 0 ? 6 : 6 - cur;
    d.setDate(d.getDate() + (add === 0 && cur !== 6 ? 7 : add));
    return iso(d);
  }

  return null;
}

/** Anlass / Sonderwünsche aus Kontext (Geburtstag, Fensterplatz, …) */
export function parseReservationOccasion(text: string): string | null {
  const bits: string[] = [];
  if (/geburtstag/i.test(text)) bits.push('Geburtstag');
  if (/jahrestag|hochzeitstag/i.test(text)) bits.push('Jahrestag');
  if (/geschäftlich|business|kundenessen/i.test(text)) bits.push('geschäftlich');
  if (/fensterplatz|am\s+fenster/i.test(text)) bits.push('bitte Fensterplatz');
  if (/ruhe|ruhig|leise/i.test(text)) bits.push('möglichst ruhiger Platz');
  if (/terrasse|draußen|draussen|outdoor/i.test(text)) bits.push('Terrasse/draußen');
  if (/kinder|hochstuhl/i.test(text)) bits.push('mit Kind(ern)');
  if (/rollstuhl|barrierefrei/i.test(text)) bits.push('barrierefrei');
  if (!bits.length) return null;
  return bits.join(', ');
}

/**
 * Hängt gängige Prefill-Parameter an Booking-/Formular-URLs.
 * Unbekannte Shops ignorieren Extra-Params harmlos.
 */
export function withReservationPrefill(
  url: string,
  prefill: ReservationPrefill,
): string {
  try {
    const u = new URL(url);
    const covers = prefill.partySize;
    if (covers != null && covers > 0) {
      for (const key of [
        'covers',
        'partySize',
        'party_size',
        'guests',
        'persons',
        'people',
        'seats',
      ]) {
        if (!u.searchParams.has(key)) u.searchParams.set(key, String(covers));
      }
    }
    if (prefill.dateIso) {
      for (const key of ['date', 'reservationDate', 'day', 'booking_date']) {
        if (!u.searchParams.has(key)) u.searchParams.set(key, prefill.dateIso);
      }
    }
    if (prefill.timeHm) {
      for (const key of ['time', 'reservationTime', 'hour', 'booking_time']) {
        if (!u.searchParams.has(key)) u.searchParams.set(key, prefill.timeHm);
      }
    }
    if (prefill.guestName?.trim()) {
      for (const key of ['name', 'guestName', 'customer_name', 'fullname']) {
        if (!u.searchParams.has(key))
          u.searchParams.set(key, prefill.guestName.trim());
      }
    }
    if (prefill.guestEmail?.trim()) {
      for (const key of ['email', 'guestEmail', 'customer_email']) {
        if (!u.searchParams.has(key))
          u.searchParams.set(key, prefill.guestEmail.trim());
      }
    }
    if (prefill.guestPhone?.trim()) {
      for (const key of ['phone', 'tel', 'guestPhone', 'customer_phone']) {
        if (!u.searchParams.has(key))
          u.searchParams.set(key, prefill.guestPhone.trim());
      }
    }
    if (prefill.notes?.trim()) {
      for (const key of ['notes', 'comment', 'message', 'special_requests']) {
        if (!u.searchParams.has(key))
          u.searchParams.set(key, prefill.notes.trim());
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Mailto-Entwurf — User muss nur noch absenden (ggf. Empfänger eintragen).
 * restaurantEmail optional: ohne Adresse → mailto:?subject=…&body=…
 */
export function buildReservationMailtoDraft(opts: {
  restaurantEmail?: string | null;
  restaurantName: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string | null;
  partySize: number;
  timeHm: string | null;
  dateIso: string | null;
  notes?: string | null;
}): string {
  const when = [
    opts.dateIso
      ? opts.dateIso.split('-').reverse().join('.')
      : null,
    opts.timeHm ? `um ${opts.timeHm} Uhr` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const subject = `Reservierungsanfrage: ${opts.restaurantName}${when ? ` – ${when}` : ''}`;
  const body = [
    'Guten Tag,',
    '',
    `hiermit möchte ich einen Tisch bei ${opts.restaurantName} reservieren:`,
    '',
    `Name: ${opts.guestName || '—'}`,
    `Personen: ${opts.partySize}`,
    opts.dateIso
      ? `Datum: ${opts.dateIso.split('-').reverse().join('.')}`
      : null,
    opts.timeHm ? `Uhrzeit: ${opts.timeHm} Uhr` : null,
    opts.notes ? `Hinweis: ${opts.notes}` : null,
    '',
    'Rückmeldung bitte an:',
    opts.guestEmail || null,
    opts.guestPhone || null,
    '',
    'Viele Grüße',
    opts.guestName || '',
    '',
    '(Anfrage über die Findus App)',
  ]
    .filter((l) => l != null && l !== '')
    .join('\n');

  const to = (opts.restaurantEmail ?? '').trim();
  return (
    `mailto:${to ? encodeURIComponent(to) : ''}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}
