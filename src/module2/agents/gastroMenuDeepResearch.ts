/**
 * Gastro Slow-Lane: Speisekarte / Getränke / Buchungslinks nachreichen.
 * Unterscheidet Essen- vs. Getränke-Karten; sucht OpenTable/Mailto.
 */

import type { AgentResult, Module2ActionButton } from '../types';
import { generateGeminiText, hasGeminiApiKey } from '../../services/geminiService';
import {
  extractLinksFromHtml,
  fetchPublicDocument,
} from '../../services/research/webFetch';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';
import {
  buildReservationMailtoDraft,
  parsePartySize,
  parseTimeHm,
  parseDateIso,
  parseReservationOccasion,
} from '../../services/reservation/reservationPrefill';
import { getCachedUserProfile } from '../../services/userProfileService';
import { getReservationContact } from '../../types/userProfile';
import {
  detectOfferKind,
  isSafeOfferUrl,
  offerLabel,
} from '../planning/offerActionUtils';

export type GastroMenuDeepInput = {
  userText: string;
  venues: Array<{
    name: string;
    websiteUrl?: string | null;
    menuUrl?: string | null;
  }>;
  alreadySaid: string;
  signal?: AbortSignal;
};

type MenuLink = {
  url: string;
  kind: 'food' | 'drinks' | 'menu' | 'booking' | 'mailto' | 'other';
  label: string;
};

function dishInterest(userText: string): string | null {
  const t = userText.toLowerCase();
  const m = t.match(
    /\b(zander|burger|pizza|pasta|sushi|steak|schnitzel|döner|doener|pommes|salat|frühstück|fruehstueck|brunch|fisch|ramen|bowl)\b/i,
  );
  return m?.[1]?.toLowerCase() ?? null;
}

function parseJson(raw: string): Record<string, unknown> | null {
  const t = raw.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function classifyLink(href: string, label: string): MenuLink['kind'] {
  const blob = `${href} ${label}`.toLowerCase();
  if (/^mailto:/i.test(href) || /reserv|platz|tisch|anfrage/.test(blob) && /mailto/.test(blob)) {
    return 'mailto';
  }
  if (
    /opentable|quandoo|resmio|bookatable|tischreserv|reservier|booking/.test(
      blob,
    )
  ) {
    return 'booking';
  }
  if (/getränk|getraenk|drinks?|beverage|wein\s*karte|bier\s*karte/.test(blob)) {
    return 'drinks';
  }
  if (
    /speisekarte|speisen|food\s*menu|menükarte|menuekarte|\.pdf|karte/.test(blob) &&
    !/getränk|getraenk|drink/.test(blob)
  ) {
    return 'food';
  }
  if (/speise|menu|karte|\.pdf/.test(blob)) return 'menu';
  return 'other';
}

/** Auch Wix/PDF-URLs und mailto aus Roh-HTML. */
function harvestLinks(html: string, baseUrl: string): MenuLink[] {
  const out: MenuLink[] = [];
  const seen = new Set<string>();
  const push = (url: string, label: string) => {
    const u = url.trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push({ url: u, label: label.slice(0, 80), kind: classifyLink(u, label) });
  };

  for (const l of extractLinksFromHtml(html, baseUrl)) {
    push(l.href, l.label);
  }

  // mailto:
  const mailRe = /href\s*=\s*["'](mailto:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let mm: RegExpExecArray | null;
  while ((mm = mailRe.exec(html))) {
    push(mm[1].trim(), (mm[2] || 'Reservierung').replace(/<[^>]+>/g, '').trim());
  }

  // PDF / ugd (Wix) roh
  const pdfRe =
    /https?:\/\/[^\s"'<>]+(?:\.pdf|\/ugd\/[^\s"'<>]+)/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pdfRe.exec(html))) {
    push(pm[0].replace(/[),.;]+$/, ''), 'PDF');
  }

  // Label-nahe hrefs: „Speisekarte“ Text in 200 chars vor href
  const nearRe =
    /(speisekarte|getränkekarte|getraenkekarte|plätze\s*reservieren|plaetze\s*reservieren|reservieren)[\s\S]{0,220}?href\s*=\s*["']([^"']+)["']/gi;
  let nm: RegExpExecArray | null;
  while ((nm = nearRe.exec(html))) {
    const label = nm[1];
    let href = nm[2].trim();
    if (/^mailto:/i.test(href)) {
      push(href, label);
      continue;
    }
    try {
      href = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    push(href, label);
  }

  return out;
}

async function scrapeVenueAssets(opts: {
  name: string;
  url: string;
  dish: string | null;
  signal?: AbortSignal;
}): Promise<{
  foodUrl: string | null;
  drinksUrl: string | null;
  menuUrl: string | null;
  bookingUrl: string | null;
  mailto: string | null;
  dishPrices: Array<{ dish: string; priceEur: number }>;
  note: string | null;
}> {
  const doc = await fetchPublicDocument(opts.url);
  if (!doc.ok || (!doc.text && !doc.links?.length)) {
    return {
      foodUrl: null,
      drinksUrl: null,
      menuUrl: null,
      bookingUrl: null,
      mailto: null,
      dishPrices: [],
      note: null,
    };
  }

  const htmlBlob = `${doc.text}\n${(doc.links ?? [])
    .map((l) => `${l.label} ${l.href}`)
    .join('\n')}`;
  // fetchPublicDocument may already strip HTML — try links field + text URLs
  const fromLinks = (doc.links ?? []).map((l) => ({
    url: l.href,
    label: l.label,
    kind: classifyLink(l.href, l.label),
  }));
  const harvested = harvestLinks(
    // Re-fetch raw isn't available; use text + link list
    htmlBlob,
    opts.url,
  );
  const all = [...fromLinks, ...harvested];

  const food =
    all.find((l) => l.kind === 'food') ??
    all.find((l) => l.kind === 'menu' && /\.pdf/i.test(l.url));
  const drinks = all.find((l) => l.kind === 'drinks');
  const booking = all.find((l) => l.kind === 'booking');
  const mailto = all.find(
    (l) => l.kind === 'mailto' || /^mailto:/i.test(l.url),
  );

  let dishPrices: Array<{ dish: string; priceEur: number }> = [];
  let note: string | null = null;

  if (hasGeminiApiKey() && doc.text && doc.text.length > 80) {
    try {
      const raw = await generateGeminiText(
        `Restaurant: ${opts.name}\n` +
          (opts.dish ? `User interessiert an: ${opts.dish}\n` : '') +
          `Seitenauszug:\n${doc.text.slice(0, 9000)}\n\n` +
          `Extrahiere belegte Preise + direkte Karten-URLs wenn im Text.\n` +
          `JSON: {"foodMenuUrl":null|"https","drinksMenuUrl":null|"https","bookingUrl":null|"https","reservationEmail":null|"a@b.c","dishPrices":[{"dish":"...","priceEur":12.5}],"note":"kurz oder null"}`,
        {
          systemInstruction:
            'Du extrahierst Speisekarten, Getränkekarten, Buchungslinks und Preise. Erfinde nichts.',
          useFindusSystem: false,
          responseJson: true,
          jsonMimeOnly: true,
          maxTokens: 360,
          temperature: 0,
          signal: opts.signal,
          allowProEscalate: false,
        },
      );
      const j = parseJson(raw);
      if (typeof j?.foodMenuUrl === 'string' && isSafeOfferUrl(j.foodMenuUrl)) {
        fromLinks.push({
          url: j.foodMenuUrl,
          label: 'Speisekarte',
          kind: 'food',
        });
      }
      if (
        typeof j?.drinksMenuUrl === 'string' &&
        isSafeOfferUrl(j.drinksMenuUrl)
      ) {
        fromLinks.push({
          url: j.drinksMenuUrl,
          label: 'Getränkekarte',
          kind: 'drinks',
        });
      }
      if (typeof j?.bookingUrl === 'string' && isSafeOfferUrl(j.bookingUrl)) {
        fromLinks.push({
          url: j.bookingUrl,
          label: 'Reservieren',
          kind: 'booking',
        });
      }
      if (
        typeof j?.reservationEmail === 'string' &&
        /@/.test(j.reservationEmail)
      ) {
        fromLinks.push({
          url: `mailto:${j.reservationEmail.trim()}`,
          label: 'Reservierung',
          kind: 'mailto',
        });
      }
      if (Array.isArray(j?.dishPrices)) {
        for (const row of j.dishPrices) {
          if (!row || typeof row !== 'object') continue;
          const dish = String((row as { dish?: string }).dish ?? '').trim();
          const priceEur = Number((row as { priceEur?: number }).priceEur);
          if (
            dish &&
            Number.isFinite(priceEur) &&
            priceEur > 0 &&
            priceEur < 500
          ) {
            dishPrices.push({
              dish,
              priceEur: Math.round(priceEur * 10) / 10,
            });
          }
        }
      }
      note = typeof j?.note === 'string' ? j.note : null;
    } catch {
      /* soft */
    }
  }

  const merged = [...fromLinks, ...harvested];
  const food2 =
    merged.find((l) => l.kind === 'food') ??
    food ??
    merged.find((l) => l.kind === 'menu');
  const drinks2 = merged.find((l) => l.kind === 'drinks') ?? drinks;
  const booking2 = merged.find((l) => l.kind === 'booking') ?? booking;
  const mailto2 =
    merged.find((l) => l.kind === 'mailto' || /^mailto:/i.test(l.url)) ??
    mailto;

  return {
    foodUrl: food2?.url && isSafeOfferUrl(food2.url) ? food2.url : null,
    drinksUrl: drinks2?.url && isSafeOfferUrl(drinks2.url) ? drinks2.url : null,
    menuUrl:
      (food2?.url && isSafeOfferUrl(food2.url) ? food2.url : null) ||
      (drinks2?.url && isSafeOfferUrl(drinks2.url) ? drinks2.url : null) ||
      (opts.url && isSafeOfferUrl(opts.url) ? opts.url : null),
    bookingUrl:
      booking2?.url && isSafeOfferUrl(booking2.url) ? booking2.url : null,
    mailto: mailto2?.url ?? null,
    dishPrices: dishPrices.slice(0, 4),
    note,
  };
}

export async function runGastroMenuDeepResearch(
  input: GastroMenuDeepInput,
): Promise<AgentResult> {
  const dish = dishInterest(input.userText);
  const venues = input.venues.slice(0, 2);
  const wantsReserve = /\b(reservier|tisch\b)/i.test(input.userText);
  if (!venues.length) {
    return {
      agent: 'deep_research',
      ok: true,
      draftText: '',
      slowLane: true,
      meta: { silent: true, reason: 'no_venues' },
    };
  }

  const findings: string[] = [];
  const buttons: Module2ActionButton[] = [];
  let anyNew = false;
  const contact = getReservationContact(getCachedUserProfile());
  const party = parsePartySize(input.userText) ?? 2;
  const timeHm = parseTimeHm(input.userText);
  const dateIso = parseDateIso(input.userText);
  const occasion = parseReservationOccasion(input.userText);

  for (const v of venues) {
    const candidates: string[] = [v.websiteUrl, v.menuUrl].filter(
      (u): u is string => Boolean(u && isSafeOfferUrl(u)),
    );

    let best: Awaited<ReturnType<typeof scrapeVenueAssets>> | null = null;
    for (const url of candidates.slice(0, 2)) {
      try {
        const hit = await scrapeVenueAssets({
          name: v.name,
          url,
          dish,
          signal: input.signal,
        });
        if (
          hit.foodUrl ||
          hit.drinksUrl ||
          hit.bookingUrl ||
          hit.mailto ||
          hit.dishPrices.length
        ) {
          best = hit;
          if (hit.foodUrl || hit.drinksUrl || hit.bookingUrl) break;
        }
      } catch {
        /* soft */
      }
    }

    const venueKind = detectOfferKind(`${input.userText} ${v.name}`);
    const primaryLabel = offerLabel(
      venueKind === 'drinks' ? 'drinks' : venueKind === 'web' ? 'web' : 'menu',
    );

    if (!best) {
      // Keine Fake-Google-/Account-Links — nur echte Venue-URLs
      const fallback = candidates.find((u) => isSafeOfferUrl(u));
      if (fallback) {
        buttons.push({
          id: `menu_site_${buttons.length}`,
          label: shortenActionLabel(primaryLabel.label),
          payload: {
            kind: 'deep_link',
            url: fallback,
          },
        });
        anyNew = true;
      }
      continue;
    }

    const already = input.alreadySaid.toLowerCase();
    const venueKey = v.name.toLowerCase().slice(0, 8);
    const novel =
      best.dishPrices.some((p) => {
        const eur = String(Math.round(p.priceEur));
        return (
          !already.includes(eur) ||
          !already.includes(p.dish.toLowerCase().slice(0, 6))
        );
      }) ||
      (best.foodUrl != null && !already.includes(venueKey)) ||
      (best.drinksUrl != null &&
        (!/getränk/i.test(already) || !already.includes(venueKey))) ||
      (best.bookingUrl != null && !/opentable|quandoo|buchung/i.test(already)) ||
      (best.mailto != null && wantsReserve);

    const seenBtnUrls = new Set(
      buttons
        .map((b) =>
          b.payload && typeof b.payload === 'object' && 'url' in b.payload
            ? String((b.payload as { url?: string }).url ?? '')
            : '',
        )
        .filter(Boolean),
    );

    // Nur passende Karte zum Venue-Typ; keine Duplikate
    if (venueKind === 'drinks') {
      const drinksUrl =
        (best.drinksUrl && isSafeOfferUrl(best.drinksUrl) ? best.drinksUrl : null) ||
        (best.menuUrl && isSafeOfferUrl(best.menuUrl) ? best.menuUrl : null);
      if (drinksUrl && !seenBtnUrls.has(drinksUrl)) {
        buttons.push({
          id: `menu_drinks_${buttons.length}`,
          label: shortenActionLabel(offerLabel('drinks').label),
          payload: { kind: 'deep_link', url: drinksUrl },
        });
        seenBtnUrls.add(drinksUrl);
        anyNew = true;
      }
    } else if (venueKind === 'menu') {
      const foodUrl =
        (best.foodUrl && isSafeOfferUrl(best.foodUrl) ? best.foodUrl : null) ||
        (best.menuUrl && isSafeOfferUrl(best.menuUrl) ? best.menuUrl : null);
      if (foodUrl && !seenBtnUrls.has(foodUrl)) {
        buttons.push({
          id: `menu_food_${buttons.length}`,
          label: shortenActionLabel(offerLabel('menu').label),
          payload: { kind: 'deep_link', url: foodUrl },
        });
        seenBtnUrls.add(foodUrl);
        anyNew = true;
      }
    } else {
      const site =
        (best.menuUrl && isSafeOfferUrl(best.menuUrl) ? best.menuUrl : null) ||
        (best.foodUrl && isSafeOfferUrl(best.foodUrl) ? best.foodUrl : null) ||
        candidates.find((u) => isSafeOfferUrl(u)) ||
        null;
      if (site && !seenBtnUrls.has(site)) {
        buttons.push({
          id: `menu_web_${buttons.length}`,
          label: shortenActionLabel(offerLabel('web').label),
          payload: { kind: 'deep_link', url: site },
        });
        seenBtnUrls.add(site);
        anyNew = true;
      }
    }

    if (novel) {
      const priceBits = best.dishPrices
        .map((p) => `${p.dish} ${String(p.priceEur).replace('.', ',')} €`)
        .join('; ');
      const linkBits = [
        best.foodUrl ? 'Speisekarte' : null,
        best.drinksUrl ? 'Getränkekarte' : null,
        best.bookingUrl ? 'Online-Buchung' : null,
        best.mailto ? 'Mail-Reservierung' : null,
      ].filter(Boolean);

      const line = [
        priceBits ? `${v.name}: ${priceBits}` : null,
        linkBits.length ? `${v.name}: ${linkBits.join(' + ')} gefunden` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      if (line) {
        anyNew = true;
        findings.push(line);
      }
    }

    if (best.bookingUrl) {
      buttons.push({
        id: `book_deep_${buttons.length}`,
        label: shortenActionLabel('🌐 Tisch online'),
        payload: {
          kind: 'deep_link',
          url: best.bookingUrl,
          destName: v.name,
        },
      });
      anyNew = true;
    }
    if (best.mailto) {
      const email = best.mailto.replace(/^mailto:/i, '').split('?')[0]!;
      const draft = buildReservationMailtoDraft({
        restaurantEmail: email,
        restaurantName: v.name,
        guestName: contact.fullName || '',
        guestEmail: contact.email || '',
        guestPhone: contact.phoneNumber || null,
        partySize: party,
        timeHm,
        dateIso,
        notes: occasion,
      });
      buttons.push({
        id: `mail_deep_${buttons.length}`,
        label: shortenActionLabel('✉️ Mail-Entwurf'),
        payload: { kind: 'deep_link', url: draft },
      });
      anyNew = true;
    }
  }

  if (!anyNew || (!findings.length && !buttons.length)) {
    return {
      agent: 'deep_research',
      ok: true,
      draftText: '',
      slowLane: true,
      meta: { silent: true, reason: 'no_new_menu_facts' },
    };
  }

  const draft = findings.length
    ? [
        'FAKTEN Speisekarte/Buchung Deep-Research (nicht wörtlich vorlesen):',
        ...findings,
        'FLOW: Kurzes Nachreichen — Speisen vs. Getränke getrennt nennen wenn beide Links. Online-Tisch/OpenTable und Mail-Entwurf priorisieren. Keine erfundenen Preise.',
      ].join('\n')
    : '';

  return {
    agent: 'deep_research',
    ok: true,
    draftText: draft,
    bullets: findings.slice(0, 3),
    buttons: buttons.slice(0, 4),
    slowLane: true,
    meta: {
      silent: !findings.length,
      dish,
      buttonsOnly: !findings.length,
    },
  };
}
