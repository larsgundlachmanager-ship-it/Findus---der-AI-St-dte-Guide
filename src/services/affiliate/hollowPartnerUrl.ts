/**
 * SSOT: leere Partner-Links (Portal-Home / Suche ohne Produkt) erkennen.
 * Nie als „Jetzt buchen“ / Ticket / Zimmer-Buchung zeigen oder öffnen.
 *
 * Gilt für ALLE Affiliate-Partner (Tiqets, GYG, Musement, Viator, Klook,
 * Stay22, Expedia, Bounce, DiscoverCars, AWIN, Travelpayouts, …).
 */

/** Label behauptet konkrete Buchung / Ticket — nicht nur ehrliche Suche. */
export function looksLikePartnerBookClaim(label: string): boolean {
  const t = (label || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // Ehrliche Such-/Mehr-CTAs sind ok (auch wenn URL Suche ist)
  if (
    /\b(suchen|mehr\s+bei|mehr\s+unterkunft|touren\s+suchen|preise\s+ansehen)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  return /\b(jetzt\s*buch|buch(en|ung)?|ticket|eintritt|tiqets|musement|viator|getyourguide|klook|kkday|zimmer\s*buch|hotel\s*buch|mietwagen|gep[äa]ck|esim|buchen\s*★?)\b/iu.test(
    t,
  );
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** AWIN/CJ/Tracking-Wrapper → echte Landing-URL. */
export function unwrapPartnerLandingUrl(url: string): string {
  const u = (url || '').trim();
  if (!u) return '';

  // URLSearchParams auf RAW-URL: decoded custom_url sonst an & abgeschnitten
  try {
    const parsed = new URL(u);
    for (const key of [
      'ued',
      'landingPage',
      'custom_url',
      'k_site',
      'destination_url',
      'redirect',
    ]) {
      const v = parsed.searchParams.get(key)?.trim();
      if (v && /^https?:\/\//i.test(v)) return v;
    }
    // CJ / tp.media: u= oder url= (nur absolute http)
    for (const key of ['u', 'url']) {
      const v = parsed.searchParams.get(key)?.trim();
      if (v && /^https?:\/\//i.test(v)) return v;
    }
  } catch {
    /* soft — Regex-Fallback */
  }

  // Regex: immer RAW zuerst (nicht vorab decodeURIComponent der ganzen URL)
  const ued = u.match(/[?&]ued=([^&]+)/i)?.[1];
  if (ued) return safeDecode(ued);
  const lp = u.match(/[?&]landingPage=([^&]+)/i)?.[1];
  if (lp) return safeDecode(lp);
  const custom = u.match(/[?&]custom_url=([^&]+)/i)?.[1];
  if (custom) {
    const inner = safeDecode(custom);
    if (/^https?:\/\//i.test(inner)) return inner;
  }
  if (/tp\.media\/r\?/i.test(u)) {
    const tpU = u.match(/[?&]u=([^&]+)/i)?.[1];
    if (tpU) {
      const inner = safeDecode(tpU);
      if (/^https?:\/\//i.test(inner)) return inner;
    }
  }
  const kSite = u.match(/[?&]k_site=([^&]+)/i)?.[1];
  if (kSite) {
    const inner = safeDecode(kSite);
    if (/^https?:\/\//i.test(inner)) return inner;
  }
  const prf = u.match(/\/destination:(https?:\/\/[^\s]+)/i)?.[1];
  if (prf) {
    const inner = safeDecode(prf);
    if (/^https?:\/\//i.test(inner)) return inner;
  }
  const wrapped = u.match(/[?&]url=(https?[^&]+)/i)?.[1];
  if (wrapped) {
    const inner = safeDecode(wrapped);
    if (/^https?:\/\//i.test(inner)) return inner;
  }
  return safeDecode(u);
}

function isBareHostPath(landing: string, hostRe: RegExp): boolean {
  try {
    const href = /^https?:\/\//i.test(landing)
      ? landing
      : `https://${landing.replace(/^\/\//, '')}`;
    const parsed = new URL(href);
    if (!hostRe.test(parsed.hostname)) return false;
    const path = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
    // Nur Root oder Locale-Root (/de, /en, /de-de) — nicht Uber /ul Deeplink
    if (path === '/') return true;
    if (/^\/ul$/i.test(path)) return false;
    return /^\/[a-z]{2}(-[a-z]{2})?$/i.test(path);
  } catch {
    return hostRe.test(landing) && /\/?(?:[a-z]{2}\/?)?(?:\?|#|$)/i.test(landing);
  }
}

function queryParam(landing: string, key: string): string {
  try {
    const href = /^https?:\/\//i.test(landing)
      ? landing
      : `https://${landing}`;
    return new URL(href).searchParams.get(key)?.trim() || '';
  } catch {
    const m = landing.match(new RegExp(`[?&]${key}=([^&]*)`, 'i'));
    return m?.[1] ? safeDecode(m[1]).trim() : '';
  }
}

/**
 * true = Link ist Portal-Home oder leere/generische Suche ohne Produkt.
 * Solche URLs dürfen keine Buchungs-Claims erfüllen.
 */
export function isHollowPartnerUrl(url: string): boolean {
  const raw = (url || '').trim();
  if (!raw) return true;
  if (/findus\.local\/pending/i.test(raw)) return true;

  const landing = unwrapPartnerLandingUrl(raw);
  const blob = `${raw}\n${landing}`.toLowerCase();

  // --- Ticket / Tour Partner: Home oder Search ohne Produkt-Slug ---
  if (isBareHostPath(landing, /tiqets\.com$/i)) return true;
  if (/tiqets\.com\/[^?\s]*\/search\/?\?/i.test(blob)) return true;

  if (isBareHostPath(landing, /(?:www\.)?musement\.com$/i)) return true;
  if (/musement\.com\/.*\/search\/?\?/i.test(blob)) return true;
  if (isBareHostPath(landing, /tui\.com$/i)) return true;

  if (isBareHostPath(landing, /getyourguide\.com$/i)) return true;
  if (/getyourguide\.com\/(?:s|search)\/?\?/i.test(blob)) return true;

  if (isBareHostPath(landing, /viator\.com$/i)) return true;
  if (/viator\.com\/.*\/search/i.test(blob)) return true;
  if (isBareHostPath(landing, /tripadvisor\.com$/i)) return true;

  if (isBareHostPath(landing, /klook\.com$/i)) return true;
  if (/klook\.com\/.*\/search/i.test(blob)) return true;
  if (isBareHostPath(landing, /kkday\.com$/i)) return true;
  if (isBareHostPath(landing, /wegotrip\.com$/i)) return true;
  if (isBareHostPath(landing, /gocity\.com$/i)) return true;
  if (isBareHostPath(landing, /welcomepickups\.com$/i)) return true;
  if (isBareHostPath(landing, /gettransfer\.com$/i)) return true;
  if (isBareHostPath(landing, /kiwitaxi\.com$/i)) return true;
  if (isBareHostPath(landing, /intui\.travel$/i)) return true;
  if (isBareHostPath(landing, /localrent\.com$/i)) return true;
  if (isBareHostPath(landing, /getrentacar\.com$/i)) return true;
  if (isBareHostPath(landing, /autoeurope\.(eu|com)$/i)) return true;
  if (isBareHostPath(landing, /bikesbooking\.com$/i)) return true;
  if (isBareHostPath(landing, /radicalstorage\.com$/i)) return true;
  if (isBareHostPath(landing, /(?:funnel\.)?airhelp\.com$/i)) return true;
  if (isBareHostPath(landing, /compensair\.com$/i)) return true;
  if (isBareHostPath(landing, /qeeq\.com$/i)) return true;
  if (isBareHostPath(landing, /saily\.com$/i)) return true;
  if (isBareHostPath(landing, /yesim\.tech$/i)) return true;
  if (/qeeq\.com\/car\/search_map/i.test(blob)) {
    if (!queryParam(landing, 'pickup_lat')) return true;
  }
  if (/kiwitaxi\.com\/[^?\s]*checkout/i.test(blob)) {
    if (!queryParam(landing, 'booking_token')) return true;
  }
  if (/bikesbooking\.com\/[^?\s]*\/search/i.test(blob)) {
    if (!queryParam(landing, 'begin')) return true;
  }

  // Travelpayouts / Tiqets shortlinks ohne Deep-Ziel
  if (/tpx\.li\/?(\?|#|$)/i.test(landing)) return true;
  if (/c111\.travelpayouts\.com\/?(\?|#|$)/i.test(landing)) return true;
  if (isBareHostPath(landing, /kiwi\.com$/i)) return true;
  // /deep?from=&to= is a full search deeplink (never hollow)
  if (/kiwi\.com\/deep\?/i.test(landing)) {
    const from = queryParam(landing, 'from');
    const to = queryParam(landing, 'to');
    if (from && to) return false;
  }

  if (/aviasales\.(?:com|tpx\.li)\/search\/[A-Z]{3}\d{4}[A-Z]{3}/i.test(landing)) {
    return false;
  }
  if (/aviasales\.(?:com|tpx\.li)\/?(\?|#|$)/i.test(landing)) {
    const origin = queryParam(landing, 'origin_iata');
    const dest = queryParam(landing, 'destination_iata');
    if (!origin || !dest) return true;
  }

  // --- Hotel ---
  if (isBareHostPath(landing, /stay22\.com$/i)) return true;
  if (/stay22\.com\/allez\//i.test(landing)) {
    const address = queryParam(landing, 'address');
    if (!address || /^(germany|deutschland|europe|europa)$/i.test(address)) {
      return true;
    }
  }
  if (isBareHostPath(landing, /expedia\.(com|de|at|ch)$/i)) return true;
  // Property-Deep-Link ist nie hollow (DE: Hotel-Beschreibung, EN: Hotel-Information)
  if (
    /\/go\/hotel\/info\/\d+/i.test(landing) ||
    /\.h\d{5,}\.Hotel-(?:Information|Beschreibung)/i.test(landing)
  ) {
    return false;
  }
  if (/expedia\.[^/\s]+\/hotel-search/i.test(landing)) {
    const dest = queryParam(landing, 'destination');
    const selected =
      queryParam(landing, 'selected') ||
      queryParam(landing, 'hotelid') ||
      queryParam(landing, 'HotelID');
    // Ohne Property-Auswahl = Suche, kein Zimmerwahl-Link
    if (!selected || !/^\d{4,}$/.test(selected)) {
      if (!dest || /^(germany|deutschland)$/i.test(dest)) return true;
      // Nur Stadtname ohne Hotel → zu dünn
      if (
        /^(lübeck|luebeck|hamburg|berlin|münchen|muenchen|köln|koeln)\s*$/i.test(
          dest,
        )
      ) {
        return true;
      }
      // Auch „Hotel X, Stadt“-Suche ist noch kein Zimmerwahl-Deep-Link
      return true;
    }
  }
  if (/expedia\.com\/affiliate\?/i.test(raw)) {
    const inner = unwrapPartnerLandingUrl(raw);
    if (inner && inner !== raw) {
      if (isBareHostPath(inner, /expedia\.(com|de|at|ch)$/i)) return true;
      if (/expedia\.[^/\s]+\/hotel-search/i.test(inner)) {
        const dest = queryParam(inner, 'destination');
        if (!dest || /^(germany|deutschland)$/i.test(dest)) return true;
      }
    }
  }
  if (isBareHostPath(landing, /booking\.com$/i)) return true;
  if (isBareHostPath(landing, /hotels\.com$/i)) return true;
  if (isBareHostPath(landing, /vrbo\.com$/i)) return true;
  // Airbnb: bare home ohne /s/ oder /rooms/ = hollow; Search/Rooms ok
  if (/(?:^|\/\/)(?:www\.)?airbnb\.(?:com|de|at|ch)\b/i.test(landing)) {
    try {
      const href = /^https?:\/\//i.test(landing)
        ? landing
        : `https://${landing.replace(/^\/\//, '')}`;
      const path = (new URL(href).pathname || '/').toLowerCase();
      const hasSearchOrRooms =
        /\/s\//.test(path) || /\/rooms\//.test(path) || /\/luxury\/listing\//.test(path);
      if (!hasSearchOrRooms) return true;
    } catch {
      if (isBareHostPath(landing, /airbnb\.(com|de|at|ch)$/i)) return true;
    }
  }

  // --- Mobility / luggage ---
  if (isBareHostPath(landing, /discovercars\.com$/i)) {
    const hasPrefill =
      !!queryParam(landing, 'pickup_date') ||
      !!queryParam(landing, 'pickup_iata') ||
      !!queryParam(landing, 'pickup_location');
    if (!hasPrefill) return true;
  }
  if (isBareHostPath(landing, /economybookings\.com$/i)) return true;
  if (/economybookings\.com\/[^?\s]*\/referral\//i.test(blob)) return true;
  if (/economybookings\.com\/[^?\s]*\/cars\/results/i.test(blob)) {
    if (!queryParam(landing, 'py') && !queryParam(landing, 'plc')) return true;
  }
  if (isBareHostPath(landing, /gokonfetti\.com$/i)) return true;
  if (/gokonfetti\.com\/[^?\s]*\/search/i.test(blob)) return true;
  if (isBareHostPath(landing, /(?:go\.)?bounce\.com$/i)) return true;
  // m.uber.com/ul ist Deeplink-Pfad — nicht als Locale-Root (/ul) werten
  if (/m\.uber\.com/i.test(landing) || /(?:^|\/)uber\.com/i.test(landing)) {
    const hasDrop =
      /[?&]dropoff(?:%5B|\[)latitude(?:%5D|\])=/i.test(landing) ||
      /[?&]drop(?:%5B|\[)/i.test(landing) ||
      /[?&]dropoff%5Blatitude%5D=/i.test(landing);
    if (!hasDrop && isBareHostPath(landing, /(?:m\.)?uber\.com$/i)) return true;
    if (!hasDrop && /m\.uber\.com\/ul\/?(\?|#|$)/i.test(landing) && !/[?&]dropoff/i.test(landing)) {
      return true;
    }
    // mit Dropoff: nicht hollow
  } else if (isBareHostPath(landing, /uber\.com$/i)) {
    return true;
  }

  // --- eSIM / misc AWIN ---
  if (isBareHostPath(landing, /airalo\.com$/i)) return true;
  if (isBareHostPath(landing, /travsim\.com$/i)) return true;
  if (isBareHostPath(landing, /camping\.info$/i)) return true;
  if (/camping\.info\/[^?\s]*\/search/i.test(blob)) {
    const q = queryParam(landing, 'q');
    if (!q) return true;
  }
  if (isBareHostPath(landing, /(?:de|fr)\.camping-and-co\.com$/i)) return true;
  if (/(?:de|fr)\.camping-and-co\.com\/?$/i.test(landing)) {
    const q = queryParam(landing, 'q');
    if (!q) return true;
  }
  if (isBareHostPath(landing, /solmar\.de$/i)) return true;
  if (isBareHostPath(landing, /(?:www\.)?magiclife\.com$/i)) return true;
  if (isBareHostPath(landing, /(?:www\.)?aida\.de$/i)) return true;
  // Lidl Reisen: Portal-Home oder Soft-Suche ohne `q` = hollow
  // (/kreuzfahrten hat Pfad → nicht bare → nicht hollow)
  if (isBareHostPath(landing, /(?:www\.)?lidl-reisen\.de$/i)) {
    const q = queryParam(landing, 'q');
    if (!q) return true;
  }
  if (isBareHostPath(landing, /travelsecure\.de$/i)) return true;
  if (isBareHostPath(landing, /^(www\.)?reservix\.de$/i)) return true;
  if (/reservix\.de\/search/i.test(blob)) {
    const q = queryParam(landing, 'q');
    if (!q) return true;
  }
  if (isBareHostPath(landing, /^(www\.)?adticket\.de$/i)) return true;
  if (/adticket\.de\/search/i.test(blob)) {
    const q = queryParam(landing, 'q');
    if (!q) return true;
  }
  if (isBareHostPath(landing, /check24\.(de|net)$/i)) return true;
  if (isBareHostPath(landing, /ab-in-den-urlaub\.(de|at|ch)$/i)) return true;
  if (isBareHostPath(landing, /^(www\.)?weg\.de$/i)) {
    const hasSearch =
      !!queryParam(landing, 'dateFrom') ||
      !!queryParam(landing, 'origin') ||
      !!queryParam(landing, 'destination') ||
      !!queryParam(landing, 'q');
    if (!hasSearch) return true;
  }

  // AWIN cread ohne sinnvolles ued / nur Portal
  if (/awin1\.com\/cread\.php/i.test(raw)) {
    const ued = queryParam(raw, 'ued') || queryParam(safeDecode(raw), 'ued');
    if (!ued) return true;
  }

  return false;
}

/** @deprecated Alias — nutze isHollowPartnerUrl */
export function isHollowTicketPartnerUrl(url: string): boolean {
  return isHollowPartnerUrl(url);
}

/**
 * Darf dieser Button als Buchungs-/Ticket-CTA stehen?
 * Such-Labels mit Such-URL: ja. Buchungs-Label mit Hollow-URL: nein.
 */
export function mayShowAsPartnerBookAction(opts: {
  label: string;
  url?: string | null;
}): boolean {
  const url = (opts.url ?? '').trim();
  if (!url) return !looksLikePartnerBookClaim(opts.label);
  if (!looksLikePartnerBookClaim(opts.label)) return true;
  return !isHollowPartnerUrl(url);
}

/** Action-Filter für QuickActions (alle Partner). */
export function rejectHollowPartnerBookAction(action: {
  type: string;
  label: string;
  payload?: { url?: string; pending?: boolean };
}): boolean {
  if (action.payload?.pending === true) return false;
  if (action.type !== 'OPEN_URL' && action.type !== 'OPEN_GYG_WIDGET') {
    return false;
  }
  const url = action.payload?.url ?? '';
  if (action.type === 'OPEN_GYG_WIDGET' && !url) {
    // Widget ohne Tour-Slug wird woanders geprüft
    return false;
  }
  return !mayShowAsPartnerBookAction({ label: action.label, url });
}

/**
 * Buchungs-Claim + Suche/Portal-URL → ehrliches Such-Label behalten statt Button droppen.
 * Final-Deep-Link bleibt Buchungs-Label; nur Hollow wird entschärft.
 */
export function softenHollowPartnerBookAction<
  T extends {
    type: string;
    label: string;
    payload?: { url?: string; pending?: boolean };
  },
>(action: T): T {
  if (action.payload?.pending === true) return action;
  if (action.type !== 'OPEN_URL' && action.type !== 'OPEN_GYG_WIDGET') {
    return action;
  }
  const url = (action.payload?.url ?? '').trim();
  if (!url || !looksLikePartnerBookClaim(action.label)) return action;
  if (!isHollowPartnerUrl(url)) return action;

  const blob = `${url}\n${unwrapPartnerLandingUrl(url)}`.toLowerCase();
  let label = action.label;
  if (/expedia|stay22|booking\.com|hotels\.com|vrbo/i.test(blob)) {
    label = '🏨 Hotels suchen';
  } else if (/airbnb\./i.test(blob)) {
    label = '🔑 Airbnb suchen';
  } else if (/getyourguide|tiqets|musement|viator|klook|kkday/i.test(blob)) {
    label = '🎟️ Touren suchen';
  } else if (/reservix|adticket|ticketmaster|eventim/i.test(blob)) {
    label = '🎟️ Tickets suchen';
  } else if (/uber\.com/i.test(blob)) {
    label = '🚗 Uber öffnen';
  } else if (!/\bsuchen\b/iu.test(label)) {
    label = label.replace(/\b(jetzt\s*)?buch(?:en|ung)?\b/giu, 'suchen').trim() ||
      '🔍 Suchen';
  }
  return { ...action, label };
}
