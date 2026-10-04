/**
 * Magazin-Story Compose: Journey, Wunschkapitel, Summary/Speech, Preise ohne „ab“.
 */

import type {
  FactThumb,
  JourneyBeat,
  MustHaveId,
  PriceBreakdownLine,
  ReiseLedger,
  ReiseOption,
  StayChoice,
  StorySectionAnchor,
  TransportChoice,
  WishChapter,
  BookingCheckItem,
} from '../types';
import type { WishEvidence } from './wishEvidenceHarvest';
import {
  extraNearbyFromLedger,
  formatWishCostHint,
  formatWishDistanceHint,
  formatWishEditorialBlurb,
  sameWishVenueName,
} from './wishEvidenceHarvest';
import { wishChapterBookUrl } from './wishBookLink';

import { filterRealStays } from './packagePartner';
import { HUB_IATA_CITY } from './hubPreNight';
import { formatWishPriceLabel, mergePriceIntoLabel, parseCostRange } from './wishPrice';

export const EXPERIENCE_SUMMARY_MAX = 300;
export const SPEECH_SUMMARY_MAX = 800;

/** Lodging-Musts gehören nicht in Punch-Titel (sonst „Wohnung, Hotel & Party“). */
const LODGING_MUST_IDS = new Set<MustHaveId>([
  'apartment',
  'hotel',
  'ferienhaus',
  'camping',
  'small_hotel',
]);

function outdoorEvidencePhoto(
  url: string | null | undefined,
  dest: string | null | undefined,
  stay: string | null | undefined,
): string | null {
  const u = (url || '').trim();
  if (!u) return null;
  if (dest && u === dest.trim()) return null;
  if (stay && u === stay.trim()) return null;
  return u;
}

function stayOf(opt: ReiseOption): StayChoice | null {
  return (
    opt.stays?.find((s) => s.id === opt.selectedStayId) || opt.stays?.[0] || null
  );
}

function transportOf(opt: ReiseOption): TransportChoice | null {
  return (
    opt.transports?.find((t) => t.id === opt.selectedTransportId) ||
    opt.transports?.[0] ||
    null
  );
}

/** Bestes Cover-/Hero-Foto aus Option + Stay + Beats (+ Static-Map Notnagel). */
export function resolveOptionPhoto(opt: ReiseOption): string | null {
  const live =
    opt.photoUrl ||
    stayOf(opt)?.photoUrl ||
    opt.stays?.find((s) => s.photoUrl)?.photoUrl ||
    opt.journeyBeats?.find((b) => b.photoUrl)?.photoUrl ||
    opt.wishChapters?.find((c) => c.photoUrl)?.photoUrl ||
    null;
  if (live) return live;
  try {
    const { staticMapTitlePhoto } = require('./placePhotoResolve') as {
      staticMapTitlePhoto: (
        lat?: number | null,
        lng?: number | null,
        zoom?: number,
      ) => string | null;
    };
    const stay = stayOf(opt);
    return (
      staticMapTitlePhoto(stay?.lat ?? opt.lat, stay?.lng ?? opt.lng, 11) ||
      null
    );
  } catch {
    return null;
  }
}

function shortenPlaceName(name: string): string {
  const cut = (name || '')
    .replace(/\s*\(.*\)\s*/g, '')
    .split(',')[0]
    ?.trim() || (name || '').trim();
  if (cut.length <= 18) return cut || 'Reise';
  return cut.split(/[\s-]/)[0] || cut.slice(0, 16);
}

function formatDateShort(iso: string | null | undefined): string | null {
  const s = (iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const [, m, d] = s.slice(0, 10).split('-');
  if (!m || !d) return null;
  return `${Number(d)}.${Number(m)}.`;
}

/** Datum mit Wochentag — „Fr 11.9.“ */
export function formatDateJourney(iso: string | null | undefined): string | null {
  const short = formatDateShort(iso);
  if (!short) return null;
  const key = (iso || '').slice(0, 10);
  const d = new Date(`${key}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return short;
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()] || '';
  return wd ? `${wd} ${short}` : short;
}

/** Abfahrt/Ankunft als HH:MM — aus ISO, Date-String oder schon Uhrzeit. */
export function formatJourneyClock(raw: string | Date | null | undefined): string | null {
  if (raw == null) return null;
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return `${String(raw.getHours()).padStart(2, '0')}:${String(raw.getMinutes()).padStart(2, '0')}`;
  }
  const s = String(raw).trim();
  if (!s) return null;
  const iso = s.match(/T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;
  const clock = s.match(/^(\d{1,2}):(\d{2})/);
  if (clock) return `${clock[1]!.padStart(2, '0')}:${clock[2]}`;
  return null;
}

/**
 * Check-in-Uhr: Hotel-Policy (üblich 15:00) vs. Ankunft+30 Min — das Spätere.
 * Honesty: „üblich“ wenn nur Policy — kein Fake aus Partner-API.
 */
export function estimateCheckInClock(
  arriveAt: string | Date | null | undefined,
  stayPolicyFrom?: string | null,
): string {
  const policy = formatJourneyClock(stayPolicyFrom) || '15:00';
  const arrive = formatJourneyClock(arriveAt);
  const [ph, pm] = policy.split(':').map((x) => Number(x));
  const policyMin =
    Number.isFinite(ph) && Number.isFinite(pm) ? ph! * 60 + pm! : 15 * 60;
  if (!arrive) {
    return `${String(Math.floor(policyMin / 60) % 24).padStart(2, '0')}:${String(policyMin % 60).padStart(2, '0')}`;
  }
  const [h, m] = arrive.split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return policy;
  }
  const arriveMin = h! * 60 + m!;
  const checkMin = Math.max(policyMin, arriveMin + 30);
  const hh = Math.floor(checkMin / 60) % 24;
  const mm = checkMin % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Erlebnis-Hook für Cover/Titel — Party/Pool/Strand vor Wohnung/Hotel. */
export function pickExperienceHook(ledger: ReiseLedger): string | null {
  const must = ledger.mustHaves?.value ?? [];
  const wish = ledger.wishHaves?.value ?? [];
  const ordered = [...must, ...wish.filter((id) => !must.includes(id))];
  for (const id of ordered) {
    if (LODGING_MUST_IDS.has(id)) continue;
    const label = MUST_META[id]?.label;
    if (label) return label.replace(/\s*\/\s*.*$/, '').trim();
  }
  if (ledger.energy?.value === 'chill_pool') return 'Pool';
  if (ledger.energy?.value === 'active_out') return 'Aktiv';
  if (ledger.partyGrain?.value === 'clubs' || ledger.partyGrain?.value === 'bars') {
    return 'Party';
  }
  const purpose = (ledger.purpose?.value || '').trim();
  if (/party|feier|wochenende|club/i.test(purpose)) return 'Party';
  return null;
}

/** Cover-Punchline: Ort + Hook + Preis — nur glaubwürdiger Fixpreis (Buy-in mit Stay). */
export function buildCoverHeadline(opt: ReiseOption, ledger: ReiseLedger): string {
  const place = shortenPlaceName(opt.placeName);
  const hook = pickExperienceHook(ledger);
  const purpose = (ledger.purpose?.value || '').trim();
  // Merkbarer Trip-Titel — Preis steht separat im Badge, Ort nicht 3×
  if (purpose && purpose.length >= 4 && purpose.length <= 40 && !/pool|brief/i.test(purpose)) {
    return purpose.slice(0, 52);
  }
  if (hook) return `${hook} in ${place}`.slice(0, 52);
  return place.slice(0, 52);
}


/** Cover-Unterzeile: Reisedaten + Ort + Wetter. */
export function buildCoverSubline(opt: ReiseOption, ledger: ReiseLedger): string {
  const start = formatDateShort(ledger.dateStart?.value);
  const end = formatDateShort(ledger.dateEnd?.value);
  const dateBit =
    start && end && start !== end ? `${start}–${end}` : start ? `ab ${start}` : null;
  const place = (opt.placeName || '').trim();
  const fenster = (opt.decisionNotes ?? [])
    .find((d) => /^Fenster:/i.test(d))
    ?.replace(/^Fenster:\s*/i, '')
    .trim();
  // Wetter nur in Facts/Chip — nicht nochmal in der Cover-Zeile
  return [dateBit, place, fenster ? `Fenster ${fenster}` : null].filter(Boolean).join(' · ') || place || 'Reisedaten folgen';
}

const MUST_META: Record<MustHaveId, { emoji: string; label: string }> = {
  sand: { emoji: '🏖️', label: 'Sandstrand' },
  pool: { emoji: '🏊', label: 'Pool' },
  sea: { emoji: '🌊', label: 'Meer' },
  warm: { emoji: '☀️', label: 'Warm' },
  grill: { emoji: '🍖', label: 'Grill' },
  boat: { emoji: '🚤', label: 'Boot' },
  rental_car: { emoji: '🚗', label: 'Mietwagen' },
  padel: { emoji: '🎾', label: 'Padel' },
  paddle: { emoji: '🛶', label: 'Paddeln' },
  spikeball: { emoji: '🏐', label: 'Spikeball' },
  party: { emoji: '🎉', label: 'Party' },
  ferienhaus: { emoji: '🏡', label: 'Ferienhaus' },
  apartment: { emoji: '🔑', label: 'Wohnung' },
  hotel: { emoji: '🏨', label: 'Hotel' },
  camping: { emoji: '⛺', label: 'Camping' },
  vegan: { emoji: '🌱', label: 'Vegan' },
  view: { emoji: '🌅', label: 'Ausblick' },
  no_carpet: { emoji: '🚫', label: 'Ohne Teppich' },
  spa: { emoji: '🧖', label: 'Spa' },
  sauna: { emoji: '♨️', label: 'Sauna' },
  massage: { emoji: '💆', label: 'Massage' },
  tennis: { emoji: '🎾', label: 'Tennis' },
  wine: { emoji: '🍷', label: 'Wein' },
  cruise: { emoji: '🛳️', label: 'Kreuzfahrt' },
  ferry: { emoji: '⛴️', label: 'Fähre' },
  river_cruise: { emoji: '🏞️', label: 'Flusskreuzfahrt' },
  water_slide: { emoji: '💦', label: 'Wasserrutsche' },
  paddle_board: { emoji: '🏄', label: 'Paddel an Bord' },
  culinary: { emoji: '🍽️', label: 'Kulinarik' },
  kids_club: { emoji: '🧒', label: 'Kids-Club' },
  teens_club: { emoji: '🧑', label: 'Teens-Club' },
  running_track: { emoji: '🏃', label: 'Laufbahn' },
  seniors: { emoji: '🧓', label: 'Senioren-Tempo' },
  adult_only: { emoji: '🔞', label: 'Adult-only' },
  riding: { emoji: '🐴', label: 'Reiten' },
  parking: { emoji: '🅿️', label: 'Parkplatz' },
  baby_bed: { emoji: '🍼', label: 'Babybett' },
  breakfast: { emoji: '🥐', label: 'Frühstück' },
  half_board: { emoji: '🍽️', label: 'Halbpension' },
  quiet: { emoji: '🤫', label: 'Ruhig' },
  short_transfer: { emoji: '🚐', label: 'Kurzer Transfer' },
  small_hotel: { emoji: '🏡', label: 'Kleineres Hotel' },
};

/** Finaler Preis-Copy — nie „ab“. */
export function formatFinalPriceEur(eur: number | null | undefined): string {
  if (eur == null || !(eur >= 0)) return 'Preis noch offen';
  return `${Math.round(eur)}€`;
}

/** Entfernt „ab …€“ / „ab 89“ aus Labels — Abflug bleibt. */
export function stripAbPriceWording(text: string): string {
  return text
    .replace(/\bab\s*\d+([.,]\d+)?\s*€/gi, '')
    .replace(/\bab\s*\d+([.,]\d+)?(?=\s|$|·|,|;)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*·\s*·/g, ' · ')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .trim();
}

/**
 * Flug-Label: Route + Abflug (+ Flugnr.) + finaler Preis — nie „ab …€“.
 */
export function formatFlightTransportLabel(opts: {
  fromIata: string;
  toIata: string;
  departAt?: string | null;
  flightNumber?: string | null;
  priceEur?: number | null;
  transfers?: number | null;
}): string {
  const bits = [
    `Flug ${opts.fromIata.toUpperCase()}→${opts.toIata.toUpperCase()}`,
    opts.flightNumber ? opts.flightNumber.trim() : null,
    opts.departAt ? `Abflug ${opts.departAt}` : null,
    opts.priceEur != null && opts.priceEur >= 0 ? formatFinalPriceEur(opts.priceEur) : null,
    opts.transfers === 0 ? 'Direkt' : opts.transfers != null ? `${opts.transfers} Stop` : null,
  ].filter(Boolean);
  return stripAbPriceWording(bits.join(' · '));
}

/** Label aktualisieren: „ab“-Preis raus, finalen Preis anhängen. */
export function withFinalFlightPriceLabel(label: string, priceEur: number): string {
  const cleaned = stripAbPriceWording(label)
    .replace(/\s*·?\s*\d+([.,]\d+)?\s*€/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*·\s*$/g, '')
    .trim();
  return stripAbPriceWording(`${cleaned} · ${formatFinalPriceEur(priceEur)}`);
}

export function clampChars(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/** Grobe Transfer-Minuten aus km (Stadt/Airport). */
export function estimateTransferMinutes(km: number): number {
  if (!(km > 0)) return 20;
  return Math.max(12, Math.round(8 + km * 2.4));
}

function wishIds(ledger: ReiseLedger): MustHaveId[] {
  const must = ledger.mustHaves?.value ?? [];
  const wish = ledger.wishHaves?.value ?? [];
  const seen = new Set<string>();
  const out: MustHaveId[] = [];
  for (const id of [...must, ...wish]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function chapterBlurb(
  id: MustHaveId,
  met: boolean,
  stay: StayChoice | null,
  placeName: string,
  evidence?: WishEvidence | null,
): { blurb: string; distanceHint?: string; costHint?: string } {
  const label = MUST_META[id]?.label || id;
  const dist = evidence ? formatWishDistanceHint(evidence) : undefined;
  const cost = evidence ? formatWishCostHint(evidence) : undefined;

  if (evidence?.onProperty && met) {
    return {
      blurb: stay?.name
        ? `${label} direkt bei ${stay.name} — wie gewünscht.`
        : `${label} an der Unterkunft — wie gewünscht.`,
      distanceHint: dist || 'an der Unterkunft',
      costHint: cost || undefined,
    };
  }
  if (evidence && !evidence.onProperty && evidence.name && met) {
    const editorial = formatWishEditorialBlurb(evidence);
    const extras = [dist, cost].filter(Boolean).join(' · ');
    const head = extras
      ? `${label}: ${evidence.name}. ${extras}.`
      : stay?.name
        ? `${label}: ${evidence.name} — Entfernung von ${stay.name} folgt.`
        : `${label}: ${evidence.name} in ${placeName}.`;
    // Distanzzeile ohne Namens-Wiederholung (Titel = Name)
    const distOnly =
      evidence.distanceAnchor === 'stay' && evidence.distanceM != null
        ? formatWishDistanceHint(evidence)
        : undefined;
    return {
      blurb: editorial ? `${head} ${editorial}` : head,
      distanceHint: distOnly || undefined,
      costHint: cost || undefined,
    };
  }
  if (id === 'pool') {
    return {
      blurb: met
        ? stay?.name
          ? `Genau der Pool, den du wolltest — bei ${stay.name}.`
          : `Pool am Spot — passt zu deinem Brief.`
        : `Pool war Wunsch — hier noch nicht klar belegt.`,
      distanceHint: dist,
      costHint: cost,
    };
  }
  if (id === 'grill') {
    return {
      blurb: met
        ? `Grillplatz dabei — Abende draußen, ohne Extra-Suche.`
        : `Grill gewünscht — Beleg in der Unterkunft noch dünn.`,
      distanceHint: dist,
      costHint: cost,
    };
  }
  if (id === 'padel' || id === 'tennis') {
    return {
      blurb: met
        ? evidence?.name
          ? `${label} bei ${evidence.name}${cost ? ` — ${cost}` : ''}.`
          : `${label} in der Nähe von ${placeName}.`
        : `${label} gewünscht — Live-Plätze vor Ort noch prüfen.`,
      distanceHint: dist || (met ? 'in der Nähe' : undefined),
      costHint: cost || undefined,
    };
  }
  if (id === 'sand' || id === 'sea') {
    return {
      blurb: met
        ? evidence?.name
          ? `${label}: ${evidence.name}${dist ? ` (${dist})` : ''}.`
          : `${label} erreichbar — ruhiger Strand-Vibe, wenn der Ort das hergibt.`
        : `${label} war im Brief — Distanz/Lage noch prüfen.`,
      distanceHint: dist || (met ? 'vom Spot erreichbar' : undefined),
      costHint: cost,
    };
  }
  if (id === 'spa' || id === 'sauna' || id === 'massage') {
    return {
      blurb: met
        ? `${label} am Ort — Wellness ohne Umweg.`
        : `${label} gewünscht — Amenities noch gegenprüfen.`,
      distanceHint: dist,
      costHint: cost,
    };
  }
  if (id === 'quiet') {
    return {
      blurb: met
        ? `Ruhige Lage — weg vom Lärmkorridor.`
        : `Ruhe war Wunsch — Partymeile ausgeschlossen halten.`,
      distanceHint: dist,
      costHint: cost,
    };
  }
  if (id === 'party') {
    const clubName = evidence?.name;
    return {
      blurb: met
        ? clubName
          ? `Nightlife wie gewünscht — ${clubName} ist im Plan.`
          : `Party/Nightlife ist für ${placeName} mitgedacht.`
        : `Party war Wunsch — Clubs/Events vor Ort noch belegen.`,
      distanceHint: dist,
      costHint: cost,
    };
  }
  return {
    blurb: met
      ? `${label} ist in diesem Plan mitgedacht.`
      : `${label} noch in Klärung — erst wenn belegt, kommt’s ins Magazin.`,
    distanceHint: dist,
    costHint: cost,
  };
}

/** Wish-Chapter „met“: Evidence true gewinnt; unmet-Stubs dürfen Place-Facts nicht killen. */
export function resolveWishChapterMet(opts: {
  id: MustHaveId;
  ev?: WishEvidence | null;
  fact?: FactThumb | null;
  evidenceList?: WishEvidence[] | null;
  ledger: ReiseLedger;
  stay?: StayChoice | null;
}): boolean {
  const { id, ev, fact, evidenceList, ledger, stay } = opts;
  if (ev?.met === true) return true;
  if (fact?.met === true) return true;

  if (id === 'party') {
    const nightlife = (evidenceList ?? []).some(
      (e) =>
        (e.mustHaveId === 'club' || e.mustHaveId === 'concert') &&
        (e.met || Boolean(e.name)),
    );
    if (nightlife) return true;
    if (ledger.partyGrain?.value === 'private_house') return true;
    return false;
  }

  if (id === 'pool') {
    const blob = `${stay?.name || ''} ${stay?.why || ''} ${(stay as any)?.amenities || ''}`.toLowerCase();
    if (/pool|schwimm/.test(blob)) return true;
    // unmet on-property evidence ohne Namen = noch kein Beleg
    return false;
  }

  // Stub-Evidence (kein Name, unmet) → Fact entscheiden lassen
  if (ev && ev.met === false && !ev.name && !ev.onProperty) {
    return fact?.met ?? false;
  }
  if (ev?.met === false) return false;
  return fact?.met ?? false;
}

export function buildWishChapters(
  opt: ReiseOption,
  ledger: ReiseLedger,
  evidenceList?: WishEvidence[] | null,
): WishChapter[] {
  const stay = stayOf(opt);
  const ids = wishIds(ledger);
  const factBy = new Map((opt.facts ?? []).map((f) => [f.id, f]));
  const softBy = new Map((opt.softFacts ?? []).map((f) => [f.id.replace(/^wish_/, ''), f]));
  const evBy = new Map((evidenceList ?? []).map((e) => [e.mustHaveId, e]));
  const chapters: WishChapter[] = [];

  for (const id of ids) {
    const meta = MUST_META[id];
    if (!meta) continue;
    const fact = factBy.get(id) || softBy.get(id);
    const ev = evBy.get(id);
    const met = resolveWishChapterMet({
      id,
      ev,
      fact,
      evidenceList,
      ledger,
      stay,
    });
    // Party-Chapter: Club-Evidence für Blurb/Distanz mitnehmen
    const partyClub =
      id === 'party' && met
        ? (evidenceList ?? []).find(
            (e) => (e.mustHaveId === 'club' || e.mustHaveId === 'concert') && (e.met || e.name),
          )
        : null;
    const blurbEv = ev?.met || (ev?.name && ev.met !== false) ? ev : partyClub || ev;
    const { blurb, distanceHint, costHint } = chapterBlurb(
      id,
      met,
      stay,
      opt.placeName,
      blurbEv ?? undefined,
    );
    const onProperty =
      ev?.onProperty ??
      (id === 'pool' || id === 'grill' || id === 'spa' || id === 'sauna' || id === 'view');
    const photoEv = blurbEv || ev;
    const range = parseCostRange(`${photoEv?.costHint || ''} ${photoEv?.editorial || ''}`);
    const priceLabel = formatWishPriceLabel({
      priceEur: range.exact,
      priceMinEur: range.min,
      priceMaxEur: range.max,
      costHint: costHint || range.label,
    });
    chapters.push({
      id: `wish-${id}`,
      mustHaveId: id,
      title: meta.label,
      blurb,
      photoUrl: onProperty
        ? photoEv?.photoUrl || stay?.photoUrl || null
        : outdoorEvidencePhoto(photoEv?.photoUrl, opt.photoUrl, stay?.photoUrl),
      distanceHint: distanceHint ?? null,
      costHint: priceLabel ?? costHint ?? null,
      priceEur: range.exact,
      priceMinEur: range.min,
      priceMaxEur: range.max,
      met,
      bookUrl: photoEv?.bookUrl || (onProperty ? null : wishChapterBookUrl(id, photoEv ?? undefined, opt, ledger)),
      emoji: meta.emoji,
      lat: onProperty ? null : photoEv?.lat ?? null,
      lng: onProperty ? null : photoEv?.lng ?? null,
    });
  }

  for (const ev of (evidenceList ?? []).filter((e) => e.mustHaveId === 'activity')) {
    const t = (ev.name || '').trim();
    if (!t) continue;
    if (chapters.some((c) => sameWishVenueName(c.title, t))) continue;
    const editorial = formatWishEditorialBlurb(ev);
    const range = parseCostRange(`${ev.costHint || ''} ${ev.editorial || ''}`);
    const priceLabel = formatWishPriceLabel({
      priceEur: range.exact,
      priceMinEur: range.min,
      priceMaxEur: range.max,
      costHint: formatWishCostHint(ev) || range.label,
    });
    chapters.push({
      id: `act-${t.slice(0, 24)}`,
      mustHaveId: 'activity',
      title: t,
      blurb:
        editorial ||
        `Programmpunkt aus deinem Brief — in ${opt.placeName} einplanen.`,
      photoUrl: outdoorEvidencePhoto(ev.photoUrl, opt.photoUrl, stay?.photoUrl),
      met: true,
      emoji: '✨',
      distanceHint: formatWishDistanceHint(ev),
      costHint: priceLabel,
      priceEur: range.exact,
      priceMinEur: range.min,
      priceMaxEur: range.max,
      bookUrl: ev.bookUrl || wishChapterBookUrl('activity', ev, opt, ledger),
      lat: ev.lat ?? null,
      lng: ev.lng ?? null,
    });
  }

  if (!(evidenceList ?? []).some((e) => e.mustHaveId === 'activity')) {
    for (const act of (ledger.mustActivities?.value ?? []).slice(0, 4)) {
      const t = act.trim();
      if (!t) continue;
      if (chapters.some((c) => sameWishVenueName(c.title, t))) continue;
      chapters.push({
        id: `act-${t.slice(0, 24)}`,
        mustHaveId: 'activity',
        title: t,
        blurb: `Programmpunkt aus deinem Brief — in ${opt.placeName} einplanen.`,
        photoUrl: null,
        met: true,
        emoji: '✨',
        bookUrl: wishChapterBookUrl('activity', undefined, opt, ledger),
      });
    }
  }

  // Extra POIs (Tour/Stadion/Sight) — Evidence oder Brief-Stub
  const extrasSeen = new Set<string>();
  for (const ev of (evidenceList ?? []).filter(
    (e) =>
      e.mustHaveId === 'stadium' ||
      e.mustHaveId === 'tour' ||
      e.mustHaveId === 'sight' ||
      e.mustHaveId === 'club' ||
      e.mustHaveId === 'concert' ||
      e.mustHaveId === 'museum',
  )) {
    extrasSeen.add(ev.mustHaveId);
    const t = (ev.name || ev.mustHaveId).trim();
    // Gleicher Club schon als Activity/Moment → nicht nochmal
    if (chapters.some((c) => sameWishVenueName(c.title, t))) continue;
    const editorial = formatWishEditorialBlurb(ev);
    const distLine = formatWishDistanceHint(ev);
    const range = parseCostRange(`${ev.costHint || ''} ${ev.editorial || ''}`);
    const priceLabel = formatWishPriceLabel({
      priceEur: range.exact,
      priceMinEur: range.min,
      priceMaxEur: range.max,
      costHint: formatWishCostHint(ev) || range.label,
    });
    chapters.push({
      id: `extra-${ev.mustHaveId}-${t.slice(0, 16)}`,
      mustHaveId: ev.mustHaveId,
      title: t,
      blurb: editorial
        ? `${t}${distLine ? ` · ${distLine}` : ''}. ${editorial}`
        : ev.met
          ? `${t}${distLine ? ` · ${distLine}` : ''} — passt zu deinem Brief.`
          : `${t} war im Brief — Live-Treffer noch dünn.`,
      photoUrl: outdoorEvidencePhoto(ev.photoUrl, opt.photoUrl, stay?.photoUrl),
      met: ev.met,
      emoji:
        ev.mustHaveId === 'stadium'
          ? '🏟️'
          : ev.mustHaveId === 'tour'
            ? '🧭'
            : ev.mustHaveId === 'club'
              ? '🎶'
              : ev.mustHaveId === 'concert'
                ? '🎤'
                : ev.mustHaveId === 'museum'
                  ? '🏛️'
                  : '🏛️',
      distanceHint: distLine,
      costHint: priceLabel,
      priceEur: range.exact,
      priceMinEur: range.min,
      priceMaxEur: range.max,
      bookUrl: ev.bookUrl || wishChapterBookUrl(ev.mustHaveId, ev, opt, ledger),
      lat: ev.lat ?? null,
      lng: ev.lng ?? null,
    });
  }
  for (const extra of extraNearbyFromLedger(ledger)) {
    if (extrasSeen.has(extra.id)) continue;
    if (chapters.some((c) => sameWishVenueName(c.title, extra.title) || c.mustHaveId === extra.id)) {
      continue;
    }
    chapters.push({
      id: `extra-${extra.id}-brief`,
      mustHaveId: extra.id,
      title: extra.title,
      blurb: `${extra.title} steckt in deinem Brief — wir ziehen Nearby-Fotos nach.`,
      photoUrl: null,
      met: false,
      emoji:
        extra.id === 'stadium'
          ? '🏟️'
          : extra.id === 'tour'
            ? '🧭'
            : extra.id === 'club'
              ? '🎶'
              : extra.id === 'concert'
                ? '🎤'
                : extra.id === 'museum'
                  ? '🏛️'
                  : '🏛️',
      bookUrl: wishChapterBookUrl(extra.id, undefined, opt, ledger),
    });
  }

  return chapters;
}

const IATA_CITY = HUB_IATA_CITY;

function isAirportCityName(name: string): boolean {
  return Object.values(IATA_CITY).some((c) => c.toLowerCase() === name.trim().toLowerCase());
}

function bahnFeederUrl(from: string, to: string, dateKey?: string | null): string {
  try {
    const { buildDbJourneySearchUrl } = require('../../services/transit/transitTicketFareParse') as {
      buildDbJourneySearchUrl: (o: { from: string; to: string; dateKey?: string | null }) => string | null;
    };
    return (
      buildDbJourneySearchUrl({ from, to: `${to} Hbf`, dateKey }) ||
      `https://www.bahn.de/buchung/fahrplan/suche?so=${encodeURIComponent(from)}&zo=${encodeURIComponent(`${to} Hbf`)}`
    );
  } catch {
    const so = encodeURIComponent(from);
    const zo = encodeURIComponent(`${to} Hbf`);
    const hd = (dateKey || '').slice(0, 10);
    const dateQ = hd ? `&hd=${encodeURIComponent(`${hd}T08:00:00`)}` : '';
    return `https://www.bahn.de/buchung/fahrplan/suche?so=${so}&zo=${zo}${dateQ}`;
  }
}

function buildHomeFeederBeats(
  opt: ReiseOption,
  ledger: ReiseLedger | null | undefined,
  tr: TransportChoice | null,
): JourneyBeat[] {
  if (!ledger) return [];
  try {
    const { buildHubFeederPlan, hubFeederToJourneyBeats } = require('./hubFeederPlan') as typeof import('./hubFeederPlan');
    const plan = buildHubFeederPlan({ ledger, transport: tr });
    const beats = hubFeederToJourneyBeats(plan);
    if (beats.length) return beats;
  } catch {
    /* soft fallback below */
  }
  // Fallback: ein Beat Heimat→Hub
  const { isJunkPlaceName, sanitizeTravelPlaceName } = require('../placeNameSanity') as typeof import('../placeNameSanity');
  const homeRaw = ledger.originCity?.value?.trim() || '';
  if (!homeRaw || isJunkPlaceName(homeRaw)) return [];
  const home = sanitizeTravelPlaceName(homeRaw, 'Hamburg');
  if (!home) return [];
  const hubIata = (tr?.fromIata || '').toUpperCase();
  const hubCity = hubIata ? IATA_CITY[hubIata] || null : null;
  const flyCities = ledger.originCities?.value ?? [];
  const destCity = hubCity || flyCities.find((c) => isAirportCityName(c)) || null;
  if (!destCity) return [];
  if (home.toLowerCase() === destCity.toLowerCase()) return [];
  const dateKey = (tr?.departAt || '').slice(0, 10) || ledger.dateStart?.value || null;
  return [
    {
      id: 'feeder-home-hub',
      kind: 'train_out',
      title: `${home} → ${destCity}`,
      detail: `Zubringer zum ${hubIata || 'Abflug'} — Bahn/Flix, damit der Anschluss sitzt.`,
      bookUrl: bahnFeederUrl(home, destCity, dateKey),
      icon: '🚆',
      photoUrl: null,
    },
  ];
}

/** Magazin-Titel — Erlebnis vor Lodging-Liste (kein „Wohnung, Hotel & Party“). */
export function buildMagazineTitle(opt: ReiseOption, ledger: ReiseLedger): string {
  return buildCoverHeadline(opt, ledger);
}

export function buildJourneyBeats(
  opt: ReiseOption,
  opts?: {
    transferMinutes?: number | null;
    destPhotoUrl?: string | null;
    ledger?: ReiseLedger | null;
  },
): { outbound: JourneyBeat[]; inbound: JourneyBeat[] } {
  const tr = transportOf(opt);
  const outbound: JourneyBeat[] = [];
  const inbound: JourneyBeat[] = [];
  const transferMin = opts?.transferMinutes ?? opt.transferMinutes ?? null;
  const destPhoto = opts?.destPhotoUrl ?? opt.photoUrl;

  const feederBeats = buildHomeFeederBeats(opt, opts?.ledger ?? null, tr);
  for (const feeder of feederBeats) outbound.push(feeder);

  const ledger = opts?.ledger ?? null;
  const flyDay = tr?.departDateKey || (tr?.departAt || '').slice(0, 10) || null;
  const wishDay = ledger?.dateStart?.value || null;

  const hubStay = tr?.hubPreNight ? opt.hubPreNightStay ?? null : null;
  if (tr?.hubPreNight) {
    const hubIata = (tr.fromIata || '').toUpperCase();
    const hubCity = hubIata ? IATA_CITY[hubIata] || hubIata : 'Hub';
    outbound.push({
      id: 'hub-prenight',
      kind: 'other',
      title: `Vornacht ${hubCity}`,
      detail: [
        hubStay?.name || `Hotel nahe ${hubIata || hubCity}`,
        tr.departAt ? `vor dem Start um ${tr.departAt}` : 'vor dem frühen Flug/Schiff',
        '1 Nacht, dann zum Gate.',
      ]
        .filter(Boolean)
        .join(' · '),
      priceEur: hubStay?.priceEur ?? null,
      bookUrl: hubStay?.bookUrl ?? null,
      photoUrl: hubStay?.photoUrl ?? null,
      icon: '🌙',
    });
  }

  const bookendStay = opt.bookendStartStay;
  if (bookendStay && bookendStay.id !== hubStay?.id) {
    outbound.push({
      id: 'bookend-start',
      kind: 'other',
      title: 'Hotel vor der Tour',
      detail: [
        bookendStay.name,
        bookendStay.why || '1 Nacht am Start, dann Zug oder Trail',
      ]
        .filter(Boolean)
        .join(' · '),
      priceEur: bookendStay.priceEur ?? null,
      bookUrl: bookendStay.bookUrl ?? null,
      photoUrl: bookendStay.photoUrl ?? null,
      icon: '🛏️',
    });
  }

  if (tr?.earlyArrival || (flyDay && wishDay && flyDay < wishDay && /^\d{4}-\d{2}-\d{2}$/.test(flyDay))) {
    outbound.push({
      id: 'early-arrive',
      kind: 'other',
      title: 'Einen Tag früher ankommen',
      detail: 'Günstigerer Kalendertag — Ankunft am Ziel einen Tag vor dem Wunschtermin, steckt im Zeitplan.',
      icon: '📅',
      photoUrl: null,
    });
  }

  if (tr) {
    const kind: JourneyBeat['kind'] =
      tr.kind === 'flight'
        ? 'flight_out'
        : tr.kind === 'train'
          ? 'train_out'
          : tr.kind === 'bus'
            ? 'other'
            : tr.kind === 'car'
              ? 'car_out'
              : 'other';
    const departClock = formatJourneyClock(tr.departAt);
    const arriveClock = formatJourneyClock(tr.arriveAt);
    const dateKey = tr.departDateKey || (tr.departAt || '').slice(0, 10) || wishDay;
    const dateBit = formatDateJourney(dateKey);
    const originFallback = ledger?.originCity?.value?.trim() || null;
    const fromLabel =
      tr.fromStation ||
      tr.fromIata ||
      (tr.kind === 'train' || tr.kind === 'bus'
        ? originFallback
          ? `${originFallback} Hbf`
          : 'Startbahnhof'
        : originFallback || 'Start');
    const toLabel = tr.toStation || tr.toIata || opt.placeName;
    const stopsHint =
      tr.viaHint ||
      (tr.transfers == null
        ? null
        : tr.transfers === 0
          ? 'Direkt'
          : `${tr.transfers}× umsteigen`);
    const flightNo =
      tr.kind === 'flight' && tr.flightNumber
        ? `${tr.carrier ? `${tr.carrier} ` : ''}${tr.flightNumber}`
        : null;

    let title: string;
    let detail: string;
    if (tr.kind === 'flight') {
      title = `${fromLabel} → ${toLabel}`;
      detail =
        [
          dateBit,
          departClock ? `Abflug ${departClock}` : null,
          arriveClock ? `Ankunft ${arriveClock}` : null,
          flightNo,
          stopsHint,
        ]
          .filter(Boolean)
          .join(' · ') || opt.placeName;
    } else if (tr.kind === 'train' || tr.kind === 'bus') {
      // „Fr 11.9. · 07:23 · Hamburg Hbf → Praha“
      title = departClock
        ? `${departClock} · ${fromLabel} → ${toLabel}`
        : `${fromLabel} → ${toLabel}`;
      const priceHint =
        tr.priceEur != null && tr.priceEur >= 0
          ? `${formatFinalPriceEur(tr.priceEur)} p.P.`
          : tr.kind === 'train'
            ? 'Sparpreis auf bahn.de'
            : null;
      detail =
        [
          dateBit,
          departClock ? `Abfahrt ${departClock}` : 'Abfahrt laut Fahrplan',
          arriveClock ? `Ankunft ${arriveClock}` : null,
          stopsHint,
          tr.durationHint,
          priceHint,
          tr.kind === 'train' && !departClock
            ? 'Live-Fahrplan auf bahn.de'
            : tr.kind === 'train'
              ? 'Beispielverbindung · Live prüfen'
              : null,
        ]
          .filter(Boolean)
          .join(' · ') || `${fromLabel} nach ${toLabel}`;
    } else {
      title = stripAbPriceWording(tr.label || 'Anreise');
      detail =
        [dateBit, departClock ? `Abfahrt ${departClock}` : null, arriveClock ? `Ankunft ${arriveClock}` : null]
          .filter(Boolean)
          .join(' · ') || opt.placeName;
    }

    const flightBooked = ledger?.bookedFlight?.value === true && tr.kind === 'flight';
    const railBooked = ledger?.bookedRail?.value === true && tr.kind === 'train';
    const busBooked = ledger?.bookedBus?.value === true && (tr.kind === 'bus' || tr.kind === 'train');
    const transportBooked = flightBooked || railBooked || busBooked;

    outbound.push({
      id: `out-${tr.id}`,
      kind,
      title: stripAbPriceWording(title),
      detail: transportBooked
        ? [detail, 'schon gebucht'].filter(Boolean).join(' · ')
        : detail,
      priceEur: transportBooked ? null : tr.priceEur ?? opt.flightPriceEur ?? null,
      photoUrl: null,
      bookUrl: transportBooked ? null : tr.bookUrl,
      icon: tr.kind === 'flight' ? '✈️' : tr.kind === 'train' ? '🚆' : tr.kind === 'bus' ? '🚌' : '🚗',
      durationHint: tr.durationHint ?? null,
      alreadyBooked: transportBooked || undefined,
    });
  } else if (ledger?.bookedFlight?.value === true || ledger?.bookedRail?.value === true) {
    outbound.push({
      id: 'anreise-have',
      kind: ledger.bookedFlight?.value === true ? 'flight_out' : 'train_out',
      title: ledger.bookedFlight?.value === true ? 'Flug · schon gebucht' : 'Bahn · schon gebucht',
      detail: formatDateJourney(wishDay) || 'Anreise steht',
      icon: ledger.bookedFlight?.value === true ? '✈️' : '🚆',
      photoUrl: null,
      alreadyBooked: true,
    });
  } else if (ledger) {
    // Kein Transport gewählt — trotzdem Datum + Route zeigen
    const origin = ledger.originCity?.value?.trim();
    const dateBit = formatDateJourney(wishDay);
    if (origin || dateBit) {
      outbound.push({
        id: 'anreise-pending',
        kind: 'other',
        title: origin ? `${origin} → ${opt.placeName}` : `Anreise ${opt.placeName}`,
        detail: [dateBit, 'Verbindung wird noch belegt — Zeiten folgen'].filter(Boolean).join(' · '),
        icon: '🗺️',
        photoUrl: null,
      });
    }
  }

  const arriveClockDest = formatJourneyClock(tr?.arriveAt);
  const arriveDateDest = formatDateJourney(
    tr?.departDateKey || (tr?.departAt || '').slice(0, 10) || wishDay,
  );
  const destStation = tr?.toStation || opt.placeName;
  outbound.push({
    id: 'dest',
    kind: 'destination',
    title: arriveClockDest
      ? `Ankunft ${arriveClockDest} · ${destStation}`
      : `Ankunft ${destStation}`,
    detail: [
      arriveDateDest,
      arriveClockDest ? `Bahnhof/Flughafen ${arriveClockDest}` : null,
      'dann weiter zur Unterkunft',
    ]
      .filter(Boolean)
      .join(' · ') || 'Willkommen am Ziel.',
    photoUrl: destPhoto,
    icon: '📍',
  });

  if (opt.transferEur != null || transferMin != null || opt.transferBookUrl || ledger?.bookedTransfer?.value === true) {
    const hasXferPrice = opt.transferEur != null && opt.transferEur > 0;
    const xferBooked = ledger?.bookedTransfer?.value === true;
    outbound.push({
      id: 'xfer',
      kind: 'transfer',
      title: xferBooked ? 'Transfer · schon gebucht' : 'Transfer vor Ort (Uber/Taxi)',
      detail: xferBooked
        ? 'steht'
        : transferMin != null
          ? hasXferPrice
            ? `Ca. ${transferMin} Min zur Unterkunft · Hin+Rück für die Gruppe`
            : `Ca. ${transferMin} Min zur Unterkunft — Preis noch offen`
          : hasXferPrice
            ? 'Transfer Flughafen/Bahnhof → Unterkunft · Hin+Rück'
            : 'Transfer — Preis noch offen',
      priceEur: xferBooked ? null : hasXferPrice ? opt.transferEur : null,
      durationHint: transferMin != null ? `${transferMin} Min` : null,
      bookUrl: xferBooked ? null : opt.transferBookUrl ?? null,
      photoUrl: null,
      icon: '🚕',
      alreadyBooked: xferBooked || undefined,
    });
  }

  const stay = stayOf(opt);
  const stayBooked = ledger?.bookedStay?.value === true;
  if (stay && !stayBooked) {
    const checkInClock = estimateCheckInClock(
      tr?.arriveAt,
      stay.checkInFrom,
    );
    const checkOutClock = formatJourneyClock(stay.checkOutUntil) || '11:00';
    const checkInDate = formatDateJourney(
      tr?.departDateKey || wishDay || opt.comboWindows?.[0]?.checkin,
    );
    const checkOutDate = formatDateJourney(
      ledger?.dateEnd?.value || opt.comboWindows?.[0]?.checkout,
    );
    outbound.push({
      id: 'checkin',
      kind: 'other',
      title: `Check-in · ${stay.name}`,
      detail: [
        checkInDate,
        `ab ${checkInClock} (Hotel-üblich)`,
        checkOutDate ? `Check-out ${checkOutDate} bis ${checkOutClock}` : `Check-out bis ${checkOutClock}`,
      ]
        .filter(Boolean)
        .join(' · '),
      priceEur: stay.priceEur ?? null,
      bookUrl: stay.bookUrl ?? null,
      photoUrl: stay.photoUrl ?? null,
      icon: '🔑',
    });
  } else if (stayBooked) {
    outbound.push({
      id: 'stay-have',
      kind: 'stay',
      title: stay?.name ? `${stay.name} · schon gebucht` : 'Unterkunft · schon gebucht',
      detail: 'steht — kein Partner-Link',
      photoUrl: stay?.photoUrl ?? null,
      icon: '🏨',
      alreadyBooked: true,
    });
  }

  for (const [i, act] of (ledger?.bookedActivities?.value ?? []).slice(0, 3).entries()) {
    if (!act?.name) continue;
    outbound.push({
      id: `act-have-${i}`,
      kind: 'activity',
      title: `${act.name} · schon gebucht`,
      detail: act.dayHint || 'Ticket steht',
      icon: '🎟️',
      alreadyBooked: true,
    });
  }

  if (tr && (tr.kind === 'flight' || tr.kind === 'train' || tr.kind === 'bus')) {
    const retKind: JourneyBeat['kind'] =
      tr.kind === 'flight' ? 'flight_return' : tr.kind === 'train' ? 'train_return' : 'other';
    const retStops =
      tr.viaHint ||
      (tr.transfers == null
        ? null
        : tr.transfers === 0
          ? 'Direkt'
          : `${tr.transfers}× umsteigen`);
    const retDate =
      formatDateJourney(ledger?.dateEnd?.value) ||
      formatDateJourney(tr.departDateKey) ||
      null;
    const fromHome =
      tr.fromStation ||
      tr.fromIata ||
      ledger?.originCity?.value?.trim() ||
      'Heim';
    const toDest = tr.toStation || tr.toIata || opt.placeName;
    if (tr.kind === 'flight') {
      inbound.push({
        id: `ret-${tr.id}`,
        kind: retKind,
        title: `${toDest} → ${fromHome}`,
        detail: [
          retDate,
          formatJourneyClock(tr.departAt) ? `Abflug ${formatJourneyClock(tr.departAt)}` : null,
          formatJourneyClock(tr.arriveAt) ? `Landung ${formatJourneyClock(tr.arriveAt)}` : null,
          retStops,
          tr.flightNumber ? `Flug ${tr.flightNumber}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || `Zurück von ${opt.placeName}`,
        priceEur: tr.priceEur ?? opt.flightPriceEur ?? null,
        photoUrl: null,
        bookUrl: tr.bookUrl,
        icon: '✈️',
      });
    } else {
      inbound.push({
        id: `ret-${tr.id}`,
        kind: retKind,
        title: `Rückfahrt · ${toDest} → ${fromHome}`,
        detail: [
          retDate,
          retStops,
          tr.durationHint ? `ca. ${tr.durationHint}` : null,
          tr.priceEur != null ? 'im Hin+Rück-Preis' : 'Preis auf bahn.de',
          'Abfahrtzeiten im Partner prüfen',
        ]
          .filter(Boolean)
          .join(' · '),
        // Hin+Rück-Preis nur einmal (Outbound) — sonst Doppelzählung in der UI
        priceEur: null,
        photoUrl: null,
        bookUrl: tr.bookUrl,
        icon: tr.kind === 'train' ? '🚆' : '🚌',
      });
    }
  }

  return { outbound, inbound };
}

/** Wiki-Titel für Beat-Fotos (stadt-agnostisch). */
export function beatPhotoWikiTitles(kind: JourneyBeat['kind']): string[] {
  switch (kind) {
    case 'flight_out':
    case 'flight_return':
      return ['Passagierflugzeug', 'Airplane', 'Aircraft'];
    case 'train_out':
    case 'train_return':
      return ['ICE (Zug)', 'High-speed rail', 'Passenger train'];
    case 'transfer':
      return ['Taxi', 'Taxicab', 'Airport bus'];
    case 'car_out':
      return ['Mietwagen', 'Car rental', 'Rental car'];
    case 'other':
      return ['Hotel overnight', 'Hotelzimmer'];
    default:
      return [];
  }
}

export function buildPriceBreakdown(opt: ReiseOption): PriceBreakdownLine[] {
  const stay = stayOf(opt);
  const tr = transportOf(opt);
  const lines: PriceBreakdownLine[] = [];
  if (tr?.kind === 'flight' || opt.flightPriceEur != null) {
    lines.push({
      id: 'flight',
      label: 'Flug Hin+Rück',
      amountEur: tr?.priceEur ?? opt.flightPriceEur ?? null,
      scope: 'per_person',
    });
  } else if (tr?.kind === 'train') {
    const rtHint = `${tr.label || ''} ${tr.durationHint || ''}`;
    const looksRoundtrip = /hin\+rück|hin.?rück/i.test(rtHint);
    lines.push({
      id: 'train',
      label: looksRoundtrip ? 'Bahn Hin+Rück' : 'Bahn',
      amountEur: tr.priceEur,
      scope: 'per_person',
    });
  }
  if (opt.transferEur != null && opt.transferEur > 0) {
    lines.push({
      id: 'transfer',
      label: 'Transfer Hin+Rück',
      amountEur: opt.transferEur,
      scope: 'group',
    });
  }
  if (stay?.priceEur != null || opt.stayPriceEur != null) {
    lines.push({
      id: 'stay',
      label: 'Unterkunft',
      amountEur: stay?.priceEur ?? opt.stayPriceEur ?? null,
      scope: 'group',
    });
  }
  const hubNightEur = opt.hubPreNightStay?.priceEur;
  if (hubNightEur != null && hubNightEur > 0 && tr?.hubPreNight) {
    lines.push({
      id: 'hub-prenight',
      label: 'Vornacht am Hub',
      amountEur: hubNightEur,
      scope: 'group',
    });
  }
  const bookendEur = opt.bookendStartStay?.priceEur;
  if (
    bookendEur != null &&
    bookendEur > 0 &&
    opt.bookendStartStay?.id !== opt.hubPreNightStay?.id
  ) {
    lines.push({
      id: 'bookend-start',
      label: 'Hotel vor der Tour',
      amountEur: bookendEur,
      scope: 'group',
    });
  }
  const carEur = opt.carPriceEur;
  if (carEur != null && carEur > 0) {
    lines.push({
      id: 'car',
      label: 'Mietwagen',
      amountEur: carEur,
      scope: 'group',
    });
  }
  const extraRest =
    (opt.extrasEur ?? 0) -
    (hubNightEur != null && tr?.hubPreNight ? hubNightEur : 0) -
    (bookendEur != null &&
    bookendEur > 0 &&
    opt.bookendStartStay?.id !== opt.hubPreNightStay?.id
      ? bookendEur
      : 0);
  if (extraRest > 0) {
    lines.push({
      id: 'extras',
      label: 'Extras / Events (nicht im Buy-in)',
      amountEur: extraRest,
      scope: 'group',
    });
  }
  // Buy-in p.P. nur als große Summe in der UI — nicht nochmal als Zeile
  return lines;
}

export function buildSectionAnchors(opt: ReiseOption, ledger: ReiseLedger): StorySectionAnchor[] {
  const anchors: StorySectionAnchor[] = [
    { id: 'hero', label: 'Intro' },
    { id: 'anreise', label: 'Anreise' },
  ];
  if ((opt.stays?.length ?? 0) > 1) anchors.push({ id: 'stay', label: 'Stay' });
  if ((opt.wishChapters?.length ?? 0) > 0 || wishIds(ledger).length) {
    anchors.push({ id: 'momente', label: 'Momente' });
  }
  // Tage bei Übernachtung / Programm — Reiter-Auswahl braucht Day-Blöcke
  if ((opt.days?.length ?? 0) > 0) {
    anchors.push({ id: 'tage', label: 'Tage' });
  }
  if ((opt.returnBeats?.length ?? 0) > 0) anchors.push({ id: 'rueckflug', label: 'Rück' });
  anchors.push({ id: 'kosten', label: 'Kosten' });
  anchors.push({ id: 'buchen', label: 'Buchen' });
  return anchors;
}

/** UI-Summary ≤300 — Erlebnis, keine Uhrzeiten, kein Preis, kein Gap-Jargon. */
export function buildExperienceSummary(opt: ReiseOption, ledger: ReiseLedger): string {
  const stay = stayOf(opt);
  const hook = pickExperienceHook(ledger);
  const must = (ledger.mustHaves?.value ?? [])
    .filter((id) => !LODGING_MUST_IDS.has(id))
    .map((id) => MUST_META[id]?.label || id)
    .filter(Boolean);
  const wishBits = must.slice(0, 3).join(', ');
  const editorial =
    opt.wishChapters
      ?.find((c) => c.met && c.blurb && c.blurb.length > 40 && !/noch (offen|in klärung|nicht belegt)|gap/i.test(c.blurb))
      ?.blurb?.split(/[.!]/)[0] || null;
  const bits = [
    hook
      ? `${opt.placeName} für ${hook.toLowerCase()} — genau euer Tempo.`
      : `${opt.placeName} — eine Variante, die sich für euch anfühlt.`,
    wishBits ? `Im Fokus: ${wishBits}.` : null,
    editorial ? `${editorial}.` : null,
    stay?.name
      ? `Basis: ${stay.name}${stay.why ? ` — ${stay.why.split(/[.!]/)[0]}` : ''}.`
      : 'Unterkunft wird noch final belegt.',
  ].filter(Boolean);
  return sanitizeMagazinProse(clampChars(bits.join(' '), EXPERIENCE_SUMMARY_MAX));
}

/** TTS/UI: keine Slash-Listen, kein „ehrlich als Gap“. */
export function sanitizeMagazinProse(raw: string): string {
  return String(raw || '')
    .replace(/\behrlich als [Gg]ap\b/giu, '')
    .replace(/\s*\/{1,2}\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ',')
    .trim();
}

/** Soft-Tagesplan: Übernachtungstrip oder explizites Programm im Brief. */
export function userWantsProgramDays(ledger: ReiseLedger): boolean {
  if ((ledger.mustActivities?.value?.length ?? 0) > 0) return true;
  const shape = ledger.tripShape?.value;
  if (shape === 'tour' || shape === 'hop' || shape === 'roadtrip' || shape === 'cruise') {
    return true;
  }
  const nights = ledger.stayNights?.value ?? 0;
  if (nights >= 1) return true;
  const start = ledger.dateStart?.value;
  const end = ledger.dateEnd?.value;
  if (start && end && start !== end) return true;
  const blob = [
    ledger.highlightWant?.value,
    ledger.extraWishes?.value,
    ledger.ideaHook?.value,
    ...(ledger.mustActivities?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ');
  return /\b(aktivit[aä]t(?:en)?|tagesplan|tagesprogramm|programm|sightseeing|sehensw[uü]rdig(?:keit(?:en)?)?|stadion|tour|bootsfahrt|ausflug|museen?|museum|konzert|festival|hellfest|ticket|esim|e-?sim|gef[uü]hrte\s+tour|was\s+kann\s+man|was\s+geht)\b/i.test(
    blob,
  );
}

/**
 * TTS-Speech ≤800 — eine flüssige Empfehlung (kein Brief, keine Checkliste).
 * Kultur: FINDUS_SPEECH_CULTURE_BLOCK — Trip-Rahmen → Ziel → Preis + Stay → Hook → Plan.
 */
export function buildSpeechSummary800(opt: ReiseOption, ledger: ReiseLedger): string {
  const stay = stayOf(opt);
  const place = shortenPlaceName(opt.placeName);
  const pl = (ledger.adults?.value ?? 1) > 1;
  const your = pl ? 'euer' : 'dein';
  const youDat = pl ? 'euch' : 'dir';
  const purpose = (ledger.purpose?.value || '').trim();
  const hook = pickExperienceHook(ledger);
  const tripLabel =
    purpose && purpose.length >= 4 && purpose.length <= 56
      ? purpose
      : hook
        ? `${hook}-Trip`
        : 'Trip';

  const stayKind =
    stay?.kind === 'hotel'
      ? 'Hotel'
      : stay?.kind === 'ferienhaus'
        ? 'Ferienhaus'
        : stay?.kind === 'hostel'
          ? 'Hostel'
          : 'Apartment';
  const stayName = stay?.name?.split(/[,·(]/)[0]?.trim() || null;
  const stayWhy = (stay?.why || '')
    .split(/[.!]/)[0]
    ?.trim()
    .slice(0, 56);
  const lage = stayWhy && stayWhy.length >= 8 ? stayWhy : null;

  const priceN = opt.buyInEur;
  const priceBit =
    priceN != null
      ? `für ${formatFinalPriceEur(priceN).replace(/€$/, '')} €`
      : null;

  const vibeChapter = (opt.wishChapters ?? [])
    .filter((c) => c.met)
    .find((c) => /club|party|bar|strand|pool|spa|konzert|event/i.test(`${c.title} ${c.body || ''}`));
  const walkHook = (() => {
    if (vibeChapter) {
      const t = vibeChapter.title.replace(/^[\d.\s]+/, '').trim();
      const bodyHook = (vibeChapter.body || '')
        .split(/[.!]/)[0]
        ?.trim()
        .slice(0, 72);
      if (t.length >= 4 && bodyHook && bodyHook.length >= 12 && bodyHook.toLowerCase() !== t.toLowerCase()) {
        return `Keine 20 Minuten zu Fuß gibt’s ${t}, ${bodyHook.charAt(0).toLowerCase()}${bodyHook.slice(1)}.`;
      }
      return t.length >= 4 ? `Keine 20 Minuten zu Fuß gibt’s ${t}.` : null;
    }
    if (hook && /party|club/i.test(hook)) {
      return 'Keine 20 Minuten zu Fuß gibt’s Clubs und Bars — passt zum Trip.';
    }
    if (hook && /pool|strand|spa/i.test(hook)) {
      return `${hook} ist nah dran — genau der Vibe.`;
    }
    return null;
  })();

  const opener = `Für ${your} ${tripLabel} würde ich nach ${place} fahren.`;
  const stayBit = stayName
    ? priceBit
      ? `${priceBit[0]!.toUpperCase()}${priceBit.slice(1)} habe ich ${youDat} ein schickes ${stayKind} rausgesucht${lage ? `, ${lage}` : ''}.`
      : `Ich habe ${youDat} ein schickes ${stayKind} rausgesucht${lage ? `, ${lage}` : ''}.`
    : priceBit
      ? `${priceBit[0]!.toUpperCase()}${priceBit.slice(1)} liegt das Paket — Unterkunft sitzt in ${place}.`
      : `Die Unterkunft sitzt gut in ${place}.`;

  const cta = pl
    ? 'Aber schaut euch gerne den genauen Plan an.'
    : 'Aber schau dir gerne den genauen Plan an.';
  const bits = [opener, stayBit, walkHook, cta].filter(Boolean);
  return sanitizeMagazinProse(clampChars(bits.join(' '), SPEECH_SUMMARY_MAX));
}

/** Hängt Magazin-Felder an eine Option (nach Stay/Transport-Select erneut aufrufen). */
export function enrichOptionMagazine(
  opt: ReiseOption,
  ledger: ReiseLedger,
  harvest?: {
    transferMinutes?: number | null;
    destPhotoUrl?: string | null;
    wishEvidence?: WishEvidence[] | null;
  },
): ReiseOption {
  const sanitizedTransports = (opt.transports ?? []).map((t) => {
    if (t.kind !== 'flight') return { ...t, label: stripAbPriceWording(t.label) };
    const from = t.fromIata || '';
    const to = t.toIata || '';
    if (from && to) {
      return {
        ...t,
        label: formatFlightTransportLabel({
          fromIata: from,
          toIata: to,
          departAt: t.departAt,
          flightNumber: t.flightNumber,
          priceEur: t.priceEur,
          transfers: t.transfers,
        }),
      };
    }
    const cleaned = stripAbPriceWording(t.label);
    return {
      ...t,
      label:
        t.priceEur != null && t.priceEur >= 0
          ? withFinalFlightPriceLabel(cleaned, t.priceEur)
          : cleaned,
    };
  });
  const realStays = filterRealStays(opt.stays);
  const base = {
    ...opt,
    stays: realStays,
    selectedStayId:
      realStays.some((s) => s.id === opt.selectedStayId)
        ? opt.selectedStayId
        : realStays[0]?.id ?? null,
    ...(sanitizedTransports.length ? { transports: sanitizedTransports } : {}),
  };
  const transferMinutes =
    harvest?.transferMinutes ??
    base.transferMinutes ??
    (base.transferEur != null && base.transferEur > 0 ? 25 : null);
  const wishChapters = buildWishChapters(
    base,
    ledger,
    harvest?.wishEvidence ?? base.wishEvidence,
  );
  const { outbound, inbound } = buildJourneyBeats(base, {
    transferMinutes,
    destPhotoUrl: harvest?.destPhotoUrl ?? base.photoUrl,
    ledger,
  });
  // Tagesplan: nie auf 1 Tag kollabieren, wenn Ledger 11.–13. / Nächte hat
  let days = userWantsProgramDays(ledger) ? base.days ?? [] : [];
  if (userWantsProgramDays(ledger)) {
    try {
      const { buildDayPlans } = require('./composePlan') as typeof import('./composePlan');
      const { resolveTripDaySpan, enumerateDateKeysInclusive } = require('./tripDaySpan') as typeof import('./tripDaySpan');
      const span = resolveTripDaySpan({
        checkin: base.days?.[0]?.dayKey || base.comboWindows?.[0]?.checkin,
        checkout:
          base.days?.[(base.days?.length ?? 0) - 1]?.dayKey ||
          base.comboWindows?.[0]?.checkout,
        ledger,
        comboCheckin: base.comboWindows?.[0]?.checkin,
        comboCheckout: base.comboWindows?.[0]?.checkout,
      });
      const expected = enumerateDateKeysInclusive(span.checkin, span.checkout);
      if (expected.length >= 2 && (days?.length ?? 0) < expected.length) {
        const tr =
          base.transports?.find((t) => t.id === base.selectedTransportId) ||
          base.transports?.[0] ||
          null;
        const stay =
          base.stays?.find((s) => s.id === base.selectedStayId) || base.stays?.[0] || null;
        days = buildDayPlans({
          checkin: span.checkin,
          checkout: span.checkout,
          placeName: base.placeName,
          transport: tr,
          stay,
          transferEur: base.transferEur,
          activities: ledger.mustActivities?.value ?? [],
          ledger,
        });
      }
    } catch {
      /* soft — bestehende days behalten */
    }
  }
  const next: ReiseOption = {
    ...base,
    title: buildMagazineTitle(base, ledger),
    transferMinutes,
    days,
    wishChapters,
    journeyBeats: outbound,
    returnBeats: inbound,
    priceBreakdown: buildPriceBreakdown(base),
    wishEvidence: harvest?.wishEvidence ?? base.wishEvidence,
  };
  next.experienceSummary = buildExperienceSummary(next, ledger);
  next.speechSummary = buildSpeechSummary800(next, ledger);
  next.sectionAnchors = buildSectionAnchors(next, ledger);
  next.bookingChecklist = syncActivityChecklistPrices(next);
  return next;
}

/** Aktivitäts-/Club-Zeilen in der Buchungs-Auswahl: Preis-Spanne sichtbar. */
export function syncActivityChecklistPrices(opt: ReiseOption): BookingCheckItem[] {
  const list = [...(opt.bookingChecklist ?? [])];
  const chapters = opt.wishChapters ?? [];

  const pricedChapters = chapters.filter(
    (c) =>
      c.bookUrl &&
      /club|concert|activity|stadium|tour|museum|sight/i.test(c.mustHaveId),
  );

  for (const ch of pricedChapters) {
    const priceLabel = formatWishPriceLabel({
      priceEur: ch.priceEur,
      priceMinEur: ch.priceMinEur,
      priceMaxEur: ch.priceMaxEur,
      costHint: ch.costHint,
    });
    const idx = list.findIndex(
      (b) =>
        b.kind === 'activity' &&
        (b.url === ch.bookUrl ||
          sameWishVenueName(b.label, ch.title) ||
          b.label.toLowerCase().includes(ch.title.slice(0, 10).toLowerCase())),
    );
    if (idx >= 0) {
      const cur = list[idx]!;
      list[idx] = {
        ...cur,
        label: mergePriceIntoLabel(ch.title, priceLabel),
        url: ch.bookUrl || cur.url,
        priceLabel: priceLabel || cur.priceLabel || null,
      };
    } else if (ch.bookUrl && !list.some((b) => sameWishVenueName(b.label, ch.title))) {
      list.push({
        id: `act-${ch.id}`,
        label: mergePriceIntoLabel(ch.title, priceLabel),
        url: ch.bookUrl,
        kind: 'activity',
        clickedAtMs: null,
        priceLabel: priceLabel || null,
      });
    }
  }
  // Generisches „Club“-Label droppen wenn konkreter Venue-Name schon da
  return list.filter((b, i, arr) => {
    if (b.kind !== 'activity') return true;
    const bare = (b.label || '').split('·')[0]!.trim();
    if (!/^(club|konzert|event|tour|museum)$/i.test(bare)) return true;
    return !arr.some(
      (o, j) =>
        j !== i &&
        o.kind === 'activity' &&
        !/^(club|konzert|event|tour|museum)$/i.test((o.label || '').split('·')[0]!.trim()),
    );
  });
}

/** @deprecated Alias — Magazin-Speech ≤800. */
export function speechSummary500(opt: ReiseOption, ledger: ReiseLedger): string {
  return buildSpeechSummary800(
    {
      ...opt,
      wishChapters: opt.wishChapters?.length ? opt.wishChapters : buildWishChapters(opt, ledger),
    },
    ledger,
  );
}
