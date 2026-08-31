/**
 * Generische Ort-Angebote / Recurring-Events aus Pack-Fakten.
 * Keine Stadt-/POI-Hardcodes — funktioniert in jeder Stadt (Afterwork, Karaoke,
 * Studentenparty, Online-Buchung, …) und boostet nach User-Profil.
 */

import type { PoiWithFacts } from '../../db/types';
import type { QuickAction } from '../../types/concierge';
import type { UserProfile } from '../../types/userProfile';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import { resolvePersonaEngine } from '../personaEngine';
import { getCachedUserProfile } from '../userProfileService';
import { parseTagsJson } from '../geo/triggerPolicy';

export type PlaceOfferKind =
  | 'recurring_event'
  | 'activity'
  | 'booking'
  | 'website'
  | 'cta';

export type PlaceOffer = {
  kind: PlaceOfferKind;
  /** Kurzer Fakt für Prompt / Bullet */
  text: string;
  url?: string;
  /** Profil-Match-Score (höher = relevanter für diesen User) */
  score: number;
  tags: string[];
};

const URL_RE = /https?:\/\/[^\s)\]>'",]+/gi;
/** Domains ohne Schema, die oft in Pack-Texten stehen */
const BARE_DOMAIN_RE =
  /\b((?:www\.)?[a-z0-9][-a-z0-9]{1,40}\.(?:de|com|net|org|eu|io|app)(?:\/[^\s)\]>'",]*)?)/gi;

const RECURRING_RE =
  /\b(after\s*work|afterwork|karaoke|studentenparty|party|sommerfest|open\s*mic|jam\s*session|quiz\s*night|glücksrad|tombola|turnier|brunch|happy\s*hour|feierabend|montags|dienstags|mittwochs|donnerstags|freitags|samstags|sonntags|jeden\s+(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)|jede[rn]?\s+\w+|ersten?\s+\w+\s+im\s+monat|zweiten?\s+\w+\s+im\s+monat)\b/i;

const ACTIVITY_RE =
  /\b(spielen|buchen|buchung|reserv|mitmachen|teilnehmen|singen|tanzen|golfen|tennis|angeln|wandern|besuchen|probieren|zuschauen|mitgrillen|übernachten|uebernachten|wasserski|wakeboard|cable\s*ski|surfen|klettern|baden|schwimmen|tauchen|reiten|kanu|kajak|minigolf|bowling|kartfahren|escape\s*room|eintritt|pro\s*person|halbe\s*stunde|pro\s*stunde)\b/i;

const BOOKING_RE =
  /\b(online[- ]?buch|buchbar|platz\s*buch|reservier|ticket|eintritt|anmeld|€|euro)\b/i;

const WEBSITE_HINT_RE =
  /\b(website|webseite|homepage|online\s+über|online\s+ueber|über\s+\w+\.(?:de|com))\b/i;

function normalizeUrl(raw: string): string | null {
  let u = raw.trim().replace(/[.,;:!?)]+$/g, '');
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (!/\./.test(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function collectFactTexts(poi: PoiWithFacts): string[] {
  const out: string[] = [];
  for (const f of poi.facts ?? []) {
    const t = (f.fact_text ?? '').trim();
    if (t) out.push(t);
  }
  if (poi.teaser_text?.trim()) out.push(poi.teaser_text.trim());
  const tags = parseTagsJson(poi.tags_json);
  if (tags.length) out.push(tags.join(' '));
  return out;
}

function extractUrlsFromText(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const n = normalizeUrl(m[0]!);
    if (n && !seen.has(n)) {
      seen.add(n);
      found.push(n);
    }
  }
  for (const m of text.matchAll(BARE_DOMAIN_RE)) {
    const n = normalizeUrl(m[1]!);
    if (n && !seen.has(n)) {
      seen.add(n);
      found.push(n);
    }
  }
  return found;
}

function profileBoostText(
  text: string,
  profile: UserProfile | null,
): { score: number; tags: string[] } {
  const engine = resolvePersonaEngine(profile);
  const blob = [
    text,
    ...(engine.learnedFacts ?? []),
    ...(engine.preferences.dislikes ?? []),
  ]
    .join(' ')
    .toLowerCase();
  const learned = (engine.learnedFacts ?? []).join(' ').toLowerCase();
  let score = 1;
  const tags: string[] = [];

  if (RECURRING_RE.test(text)) {
    score += 2;
    tags.push('recurring');
  }
  if (BOOKING_RE.test(text) || ACTIVITY_RE.test(text)) {
    score += 1;
    tags.push('activity');
  }

  if (engine.preferences.nightlifeAndEvents) {
    if (/(after\s*work|party|karaoke|nacht|feierabend|open\s*mic)/i.test(text)) {
      score += 4;
      tags.push('nightlife_match');
    }
  }

  if (/\bstudent/i.test(learned) && /studenten|uni|campus|party/i.test(text)) {
    score += 5;
    tags.push('student_match');
  }
  if (/karaoke/i.test(learned) && /karaoke/i.test(text)) {
    score += 5;
    tags.push('karaoke_match');
  }
  if (/tennis/i.test(learned) && /tennis|platz\s*buch/i.test(text)) {
    score += 4;
    tags.push('tennis_match');
  }
  if (/golf/i.test(learned) && /golf/i.test(text)) {
    score += 4;
    tags.push('golf_match');
  }
  if (
    /(vegetar|vegan)/i.test(learned) &&
    /(vegetar|vegan)/i.test(text)
  ) {
    score += 3;
    tags.push('diet_match');
  }

  // Dislikes senken
  for (const d of engine.preferences.dislikes ?? []) {
    const key = String(d).trim().toLowerCase();
    if (key.length >= 3 && blob.includes(key) && text.toLowerCase().includes(key)) {
      score -= 3;
      tags.push('dislike');
    }
  }

  void blob;
  return { score, tags };
}

function classifyOffer(
  text: string,
  hasUrl: boolean,
): PlaceOfferKind {
  if (RECURRING_RE.test(text)) return 'recurring_event';
  if (BOOKING_RE.test(text)) return 'booking';
  if (hasUrl && WEBSITE_HINT_RE.test(text)) return 'website';
  if (ACTIVITY_RE.test(text) || /cta|aufforderung|explore/i.test(text)) {
    return hasUrl ? 'booking' : 'activity';
  }
  if (hasUrl) return 'website';
  return 'cta';
}

/**
 * Extrahiert wiederkehrende Events, Aktivitäten und Links aus POI-Fakten.
 * Stadt-agnostisch — nur Datensatz + optional Profil-Boost.
 */
export function extractPlaceOffers(
  poi: PoiWithFacts,
  profile?: UserProfile | null,
): PlaceOffer[] {
  const p = profile ?? getCachedUserProfile();
  const offers: PlaceOffer[] = [];
  const seenText = new Set<string>();
  const seenUrl = new Set<string>();

  for (const raw of collectFactTexts(poi)) {
    const text = raw
      .replace(/^\[(Kurzfakt|Erzählung|Detail|FAQ|Teaser|Hook|Narration|CTA|Thema:[^\]]+)\]\s*/iu, '')
      .replace(/^User-Frage:\s*.+?\s*Antwort:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 12) continue;

    const urls = extractUrlsFromText(text);
    const isOfferish =
      RECURRING_RE.test(text) ||
      BOOKING_RE.test(text) ||
      ACTIVITY_RE.test(text) ||
      WEBSITE_HINT_RE.test(text) ||
      urls.length > 0 ||
      /\[Thema:(website|cta|events?|live)/i.test(raw) ||
      /\bLIVE\s*:/i.test(text) ||
      /\b(speisekarte|menü|menu|event|tour|kalender|veranstalt).{0,60}(suchen|aktuell|live|nachschauen|\.de|\.com)/i.test(
        text,
      ) ||
      /\b(hier\s+kann|wenn\s+du|als\s+gast|mitmachen|willkommen)\b/i.test(text);

    if (!isOfferish) continue;

    const key = text.toLowerCase().slice(0, 80);
    if (seenText.has(key)) continue;
    seenText.add(key);

    const { score, tags } = profileBoostText(text, p);
    const primaryUrl = urls[0];
    if (primaryUrl) seenUrl.add(primaryUrl);

    offers.push({
      kind: classifyOffer(text, Boolean(primaryUrl)),
      text: text.slice(0, 220),
      url: primaryUrl,
      score,
      tags,
    });

    // Extra-URLs aus demselben Satz als Website-Offers
    for (const u of urls.slice(1)) {
      if (seenUrl.has(u)) continue;
      seenUrl.add(u);
      offers.push({
        kind: 'website',
        text: `Link: ${u.replace(/^https?:\/\//i, '')}`,
        url: u,
        score: score - 1,
        tags: [...tags, 'extra_url'],
      });
    }
  }

  return offers.sort((a, b) => b.score - a.score);
}

/** Prompt-Block für Modul-1 Story — was man HIER machen / erleben kann. */
export function formatPlaceOffersForPrompt(offers: PlaceOffer[]): string {
  if (!offers.length) {
    return `## Ort-Angebote / Events
- (keine belegten Events/Angebote — nichts erfinden, keinen Fake-CTA)`;
  }
  const top = offers.slice(0, 6);
  const lines = top.map((o) => {
    const flag =
      o.tags.includes('student_match') ||
      o.tags.includes('karaoke_match') ||
      o.tags.includes('nightlife_match') ||
      o.tags.includes('tennis_match') ||
      o.tags.includes('golf_match')
        ? ' [PASST ZUM USER — unbedingt erwähnen]'
        : '';
    return `- (${o.kind}) ${o.text}${flag}`;
  });
  return `## Ort-Angebote / Events (NUR diese — nichts erfinden)
Pflicht: Belegte Aktivitäten/Events/Preise/Dauer/Mitbringen → im Audio als PAYOFF der Historie (Leben jetzt), nicht als Broschüre. Uhrzeit/Preis/Titel aussprechen wenn belegt.
Profil-Matches mit Flag haben Vorrang.
Abschluss: Charakter-angepasste Einladung zum Mitmachen (Energie wie „Bock?“), OHNE Meta-Frage und OHNE erfundene Preise.
${lines.join('\n')}`;
}

function urlButtonLabel(offer: PlaceOffer): string {
  const host = offer.url
    ? offer.url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] ?? ''
    : '';
  const blob = `${offer.text} ${offer.url ?? ''} ${offer.tags.join(' ')}`;
  if (
    offer.kind === 'recurring_event' ||
    /event|veranstalt|kalender|programm|fest|party/i.test(blob)
  ) {
    if (/ticket/i.test(blob)) return '🎫 Tickets';
    if (/pdf|flyer|programm/i.test(blob)) return '📄 Programm';
    return '📅 Events';
  }
  if (offer.kind === 'booking' || BOOKING_RE.test(offer.text)) {
    if (/wasserski|wakeboard|cable/i.test(offer.text)) return '🎿 Wasserski';
    if (/tennis|platz/i.test(offer.text)) return '🎾 Platz buchen';
    if (/ticket|eintritt/i.test(offer.text)) return '🎫 Tickets';
    if (/reserv/i.test(offer.text)) return '🔗 Reservieren';
    return '🔗 Online buchen';
  }
  if (/wasserski|wakeboard|cable/i.test(blob)) {
    return '🎿 Wasserski-Info';
  }
  if (/speisekarte|menü|menu/i.test(blob)) return '🍽️ Speisekarte';
  if (host) {
    const short = host.split('.')[0] ?? host;
    if (short.length <= 16) return `🌐 ${short}`;
    return '🌐 Website';
  }
  return '🌐 Website';
}

/** OPEN_URL-Buttons aus Pack-Links — max. 2, profil-sortiert. */
export function buildPlaceOfferUrlActions(offers: PlaceOffer[]): QuickAction[] {
  const withUrl = offers.filter((o) => o.url);
  // Events/Websites vor generischen CTAs
  const ranked = [...withUrl].sort((a, b) => {
    const rank = (o: PlaceOffer) =>
      o.kind === 'recurring_event'
        ? 40
        : o.kind === 'website'
          ? 30
          : o.kind === 'booking'
            ? 25
            : 10 + o.score;
    return rank(b) - rank(a) || b.score - a.score;
  });
  const seen = new Set<string>();
  const out: QuickAction[] = [];
  for (const o of ranked) {
    const u = o.url!;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push({
      type: 'OPEN_URL',
      label: shortenActionLabel(urlButtonLabel(o)),
      payload: { url: u },
    });
    if (out.length >= 2) break;
  }
  return out;
}

/** ASCII-Fold für Host↔POI-Matching (Vergnügen ↔ vergnuegen). */
export function foldDe(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Score: wie gut passt ein Pack-Link zu diesem Ort?
 * Generische Stadt-Domains (nur Ortsname) → niedrig, außer Rathaus/Gemeinde.
 */
export function scorePackLinkForPoi(
  link: { url: string; title?: string; tags?: string[] },
  poi: PoiWithFacts,
): number {
  let host = '';
  let path = '';
  try {
    const u = new URL(link.url);
    host = u.hostname.replace(/^www\./i, '');
    path = u.pathname;
  } catch {
    return 0;
  }
  const hostFold = foldDe(host);
  const tokens = hostFold
    .split(/[.\-_]/)
    .filter(
      (t) =>
        t.length >= 4 &&
        !/^(www|https?|html|index|com|net|org|de|eu|info)$/.test(t),
    );
  const factSample = (poi.facts ?? [])
    .slice(0, 12)
    .map((f) => f.fact_text ?? '')
    .join(' ');
  const blob = foldDe(
    `${poi.name} ${poi.category ?? ''} ${poi.tags_json ?? ''} ${factSample}`,
  );
  const titleFold = foldDe(`${link.title ?? ''} ${(link.tags ?? []).join(' ')}`);

  let score = 0;
  for (const t of tokens) {
    if (blob.includes(t)) score += t.length >= 8 ? 6 : 3;
  }
  // Event-Kalender-URLs bevorzugen bei Event-Orten
  if (
    /event|veranstalt|kalender|programm|fest|party|vergnueg/.test(
      hostFold + path + titleFold,
    )
  ) {
    if (/event|veranstalt|fest|party|vergnueg|pmv|kalender|dorf/.test(blob)) {
      score += 8;
    }
  }
  if (/arboretum|museum|hotel|feuerwehr|kirche|schule/.test(hostFold)) {
    const key = hostFold.match(
      /arboretum|museum|hotel|feuerwehr|kirche|schule|heimat|tsv|sport/,
    )?.[0];
    if (key && blob.includes(key)) score += 10;
  }

  // Nur Stadtname im Host → fast nie an einzelne Orte hängen
  const cityOnly =
    tokens.length <= 1 &&
    tokens[0] != null &&
    blob.includes(tokens[0]) &&
    !/event|veranstalt|rathaus|gemeinde|amt|tourist/.test(blob + titleFold);
  if (cityOnly) score = Math.min(score, 2);

  return score;
}

/** Pack-_links / Sources → OPEN_URL, die zum Ort passen (Schwelle ≥ 6). */
export function buildMatchedPackLinkActions(
  poi: PoiWithFacts,
  links: Array<{ id?: string; url: string; title?: string; tags?: string[] }>,
  opts?: { existingUrls?: Set<string>; max?: number },
): QuickAction[] {
  const existing = opts?.existingUrls ?? new Set<string>();
  const max = opts?.max ?? 2;
  const scored = links
    .map((l) => ({ l, score: scorePackLinkForPoi(l, poi) }))
    .filter((x) => x.score >= 6 && x.l.url && !existing.has(x.l.url))
    .sort((a, b) => b.score - a.score);

  const out: QuickAction[] = [];
  const seen = new Set<string>(existing);
  for (const { l, score } of scored) {
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    const kind: PlaceOfferKind =
      /event|veranstalt|kalender|programm|fest/i.test(
        `${l.url} ${l.title ?? ''} ${(l.tags ?? []).join(' ')}`,
      ) || score >= 10
        ? 'recurring_event'
        : 'website';
    out.push({
      type: 'OPEN_URL',
      label: shortenActionLabel(
        urlButtonLabel({
          kind,
          text: l.title ?? l.url,
          url: l.url,
          score,
          tags: l.tags ?? [],
        }),
      ),
      payload: { url: l.url },
    });
    if (out.length >= max) break;
  }
  return out;
}
