/**
 * Modul-1 LiveStage nach Orts-Story: Stichpunkte + Action-Buttons.
 * Audio bleibt Frage-frei — Tiefe/Navigation nur per Tap.
 */

import { getAllPois, getChildPois, haversineMeters } from '../../db/database';
import type { Poi, PoiWithFacts } from '../../db/types';
import type { QuickAction } from '../../types/concierge';
import { useFinnusStore } from '../../store/useFinnusStore';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import {
  applyActionBoardToResponse,
  buildHotelBookAction,
  labelForOpportunity,
  startActionBoardDeep,
} from '../actionBoard';
import type { DeepJob } from '../actionBoard/types';
import { parseTagsJson } from '../geo/triggerPolicy';
import { emojiForPlace } from '../navigation/stampBullets';
import { truncateToWholeWords } from '../../utils/wholeWords';
import {
  looksLikeAddressOrCoordBullet,
} from '../../utils/addressPrivacy';
import { deriveMemoryBullets } from '../concierge/speechMemoryBullets';
import { extractHistoryFactBullets } from '../concierge/historyFactBullets';
import {
  buildMatchedPackLinkActions,
  buildPlaceOfferUrlActions,
  extractPlaceOffers,
} from './placeOffers';
import { getCityPackLinks } from '../cityCatalogService';
import { getCachedUserProfile } from '../userProfileService';
import { env } from '../../config/env';

function displayPoiName(poi: { name: string }): string {
  return poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
}

function mapsOpenUrl(
  name: string,
  lat: number,
  lng: number,
  placeId?: string | null,
): string {
  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`;
  }
  const q = encodeURIComponent(`${name}@${lat},${lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

const NEARBY_M = 50;
/** Schon vor Ort — keine Navigation zu sich selbst / gleichem Spot */
const ALREADY_HERE_M = 35;
const MAX_BULLETS = 3;
/** Mehr Historie + bis 2 Ort-Links oder Nähe */
const MAX_ACTIONS = 4;
/** ~1 Zeile à ~42 Zeichen in BulletsSlot */
const BULLET_MAX_CHARS = 42;

const HARD_FACT_RE =
  /\b(seit|gebaut|eröffnet|eroeffnet|denkmal|rb\s*\d+|linie|rosen|topf|gutshof|haltepunkt|feuerwehr|jugendfeuerwehr|weihnachts|golf|zimmer|ferien|zufluss|reguliert|begradigt|fachwerk|walmdach)\b/iu;

const FACT_TAG_RE =
  /^\[(Kurzfakt|Erzählung|Detail|FAQ|Teaser|Hook|Narration|Thema:[^\]]+)\]\s*/iu;

function stripFactTag(raw: string): string {
  return raw
    .replace(FACT_TAG_RE, '')
    .replace(/^User-Frage:\s*.+?\s*Antwort:\s*/i, '')
    .trim();
}

function looksLikeContactDump(text: string): boolean {
  return (
    /\b(0\d{2,5}[\s/\-]?\d{4,}|\+49[\s\-]?\d|telefon|tel\.?|handy|e-?mail|@\w+\.\w+)/i.test(
      text,
    ) ||
    /\b(clubnummer|vorstand@|geschaeftsstelle.*erreichbar)/i.test(text)
  );
}

/** Adresse / GPS / Koordinaten — kein Mehrwert in Stichpunkten. */
function looksLikeAddressOrGeoDump(text: string): boolean {
  return looksLikeAddressOrCoordBullet(text);
}

function cleanBullet(raw: string): string {
  return stripFactTag(raw)
    .replace(/\s+/g, ' ')
    .replace(/^[\s•\-–—✨📌🗝️🧾]+/u, '')
    .replace(/[.!?…]+$/u, '')
    .replace(/^\(+Kurzfakt\)+\s*/iu, '')
    .replace(/\(+Kurzfakt\)+\s*$/iu, '')
    .trim();
}

function fitBulletLine(text: string): string {
  // Nie mitten im Wort kürzen, kein „…“ — lieber an Wortgrenze stoppen
  return truncateToWholeWords(text, BULLET_MAX_CHARS, { ellipsis: false });
}

function isHardFactBullet(clause: string): boolean {
  if (clause.length < 12 || clause.length > 140) return false;
  if (/\?$/.test(clause)) return false;
  if (looksLikeAddressOrGeoDump(clause) || looksLikeContactDump(clause)) {
    return false;
  }
  if (
    /\b(ausgeschrieben|buchstabier)\b/iu.test(clause) ||
    /[:：]\s*(\.\.\.|…)?\s*$/u.test(clause)
  ) {
    return false;
  }
  if (
    /\b(höhe|stufen|eintritt|preis)\b/iu.test(clause) &&
    !/\d/.test(clause)
  ) {
    return false;
  }
  if (
    /^(hörst|hörst du|siehst|riechst|willkommen|hallo|lass|magst|wenn du|pst)/iu.test(
      clause,
    )
  ) {
    return false;
  }
  if (/^\(+Kurzfakt\)+$/iu.test(clause)) return false;
  if (/\b(1[0-9]{3}|20[0-9]{2})\b/.test(clause)) return true;
  if (HARD_FACT_RE.test(clause)) return true;
  // Aktivität / Preis / Dauer = Mehrwert
  if (
    /\b(€|euro|pro\s*person|pro\s*stunde|halbe\s*stunde|\d+\s*min|wasserski|wakeboard|cable|eintritt|buchen|buchbar)\b/i.test(
      clause,
    )
  ) {
    return true;
  }
  if (/\b\d{2,}/.test(clause) && !looksLikeAddressOrGeoDump(clause)) {
    return true;
  }
  // Recurring / Angebot ohne Jahreszahl
  if (
    /\b(after\s*work|afterwork|karaoke|party|sommerfest|montags|dienstags|mittwochs|donnerstags|freitags|samstags|buchbar|online[- ]?buch)\b/i.test(
      clause,
    )
  ) {
    return true;
  }
  return false;
}

function normalizeNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*[·•|].*$/u, '')
    .replace(/[^a-zäöüß0-9]+/giu, '')
    .trim();
}

/** 1–3 knackige Stichpunkte — Speech zuerst, Pack-Kurzfakte nur als Floor. */
export function buildModule1Bullets(
  spokenText: string,
  poi?: PoiWithFacts,
): string[] {
  const speech = spokenText.trim();
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string, mode: 'extracted' | 'clause' | 'pack') => {
    const cleaned = cleanBullet(raw);
    if (
      !cleaned ||
      looksLikeContactDump(cleaned) ||
      looksLikeAddressOrGeoDump(cleaned)
    ) {
      return;
    }
    const c = fitBulletLine(cleaned);
    if (
      !c ||
      looksLikeContactDump(c) ||
      looksLikeAddressOrGeoDump(c) ||
      /\?$/.test(c) ||
      c.length < 8
    ) {
      return;
    }
    if (
      /^(hörst|hörst du|siehst|riechst|willkommen|hallo|lass|magst|wenn du|pst|schau)/iu.test(
        c,
      )
    ) {
      return;
    }
    if (mode === 'clause' && !isHardFactBullet(c) && !isHardFactBullet(cleaned)) {
      return;
    }
    if (
      mode === 'extracted' &&
      !/\d/.test(c) &&
      !/·/.test(c) &&
      !HARD_FACT_RE.test(c) &&
      !/€|uhr|min|km|\bm\b|stufen|punkte|pkt/i.test(c)
    ) {
      return;
    }
    if (
      mode === 'pack' &&
      !/\d/.test(c) &&
      !HARD_FACT_RE.test(c) &&
      !/€|uhr|min|km|seit|gebaut|eröffnet|museum|park|hafen|kirche|turm/i.test(c)
    ) {
      return;
    }
    const key = c.toLowerCase().slice(0, 48);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  if (speech) {
    for (const b of extractHistoryFactBullets(speech, null, MAX_BULLETS)) {
      push(b, 'extracted');
      if (out.length >= MAX_BULLETS) return out;
    }
    for (const b of deriveMemoryBullets(speech, null, {})) {
      push(b, 'extracted');
      if (out.length >= MAX_BULLETS) return out;
    }
    for (const part of speech.split(/(?<=[.!?…])\s+/u)) {
      push(part, 'clause');
      if (out.length >= MAX_BULLETS) return out;
    }
  }

  // Floor: wenn Speech zu wenig harte Fakten liefert → Pack-Kurzfakte (nie Adresse)
  if (out.length < 2 && poi && Array.isArray(poi.facts)) {
    const packFacts = [...poi.facts]
      .map((f) => stripFactTag((f.fact_text ?? '').trim()))
      .filter((t) => t.length >= 12 && t.length <= 120)
      .sort((a, b) => {
        const score = (t: string) =>
          (/\d/.test(t) ? 2 : 0) + (HARD_FACT_RE.test(t) ? 2 : 0) +
          (/\[Kurzfakt\]/i.test(t) ? 1 : 0);
        return score(b) - score(a);
      });
    for (const f of packFacts) {
      push(f, 'pack');
      if (out.length >= MAX_BULLETS) break;
    }
  }

  return out.slice(0, MAX_BULLETS);
}

function looksLikeHotel(poi: Poi | PoiWithFacts): boolean {
  const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
  const factBlob =
    'facts' in poi && Array.isArray(poi.facts)
      ? poi.facts.map((f) => f.fact_text ?? '').join(' ')
      : '';
  const blob = `${poi.name} ${poi.category ?? ''} ${tags} ${factBlob}`;
  return /(hotel|pension|unterkunft|ferienwohnung|zimmer)/i.test(blob);
}

/** Sport / Erlebnis / Buchung — Historie-Button wäre Quatsch. */
export function looksLikeActivityVenue(poi: Poi | PoiWithFacts): boolean {
  const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
  const factBlob =
    'facts' in poi && Array.isArray(poi.facts)
      ? poi.facts.map((f) => f.fact_text ?? '').join(' ')
      : '';
  const blob = `${poi.name} ${poi.category ?? ''} ${tags} ${factBlob}`;
  return /\b(wasserski|wakeboard|cable\s*ski|surf|klettern|kletterhalle|minigolf|bowling|kart|escape|golf|tennis|sportzentrum|freizeitpark|baden|schwimm|tauchen|reiten|kanu|kajak|segelsport|sport\s*gmbh|erlebnis|aktivit)/i.test(
    blob,
  );
}

/** Generische Kurzlabels — keine Ortsnamen-Hardcodes. */
function shortNavLabel(name: string): string {
  let clean = name
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .replace(/^(zum|zur|zu den)\s+/i, '')
    .trim();
  clean = clean.split(/\s+mit\s+/i)[0]!.trim();
  const beforeUnd = clean.split(/\s+und\s+/i)[0]!.trim();
  if (beforeUnd.length >= 4 && beforeUnd.length < clean.length) {
    clean = beforeUnd;
  }
  const hotel = clean.match(/\bHotel\s+(\S+)/i);
  if (hotel) {
    clean = `Hotel ${hotel[1]}`;
  }
  const short = truncateToWholeWords(clean, 22, { ellipsis: false });
  return shortenActionLabel(`📍 ${short || clean}`);
}

function isNoiseNearby(
  self: Poi | PoiWithFacts,
  candidate: { name: string; category?: string | null },
): boolean {
  const selfBlob = `${self.name} ${self.category ?? ''}`.toLowerCase();
  const cBlob = `${candidate.name} ${candidate.category ?? ''}`.toLowerCase();
  if (
    /(golf|restaurant|hotel|sport|gastro|bar|club)/i.test(selfBlob) &&
    /(blume|floristik|blumen)/i.test(cBlob)
  ) {
    return true;
  }
  return false;
}

async function nearbyRelatedPois(
  poi: PoiWithFacts,
): Promise<Array<{ id: number; name: string; lat: number; lng: number }>> {
  const out: Array<{ id: number; name: string; lat: number; lng: number }> =
    [];
  const seen = new Set<number>([poi.id]);
  const selfKey = normalizeNameKey(displayPoiName(poi));

  const consider = (c: {
    id: number;
    name: string;
    lat: number;
    lng: number;
    category?: string | null;
  }) => {
    if (seen.has(c.id)) return;
    if (isNoiseNearby(poi, c)) return;
    const d = haversineMeters(poi.lat, poi.lng, c.lat, c.lng);
    if (!Number.isFinite(d) || d < ALREADY_HERE_M) return;
    const name = displayPoiName(c);
    const key = normalizeNameKey(name);
    if (
      key &&
      selfKey &&
      (key === selfKey || key.includes(selfKey) || selfKey.includes(key))
    ) {
      return;
    }
    if (out.some((x) => normalizeNameKey(x.name) === key)) return;
    seen.add(c.id);
    out.push({ id: c.id, name, lat: c.lat, lng: c.lng });
  };

  try {
    const children = await getChildPois(poi.id);
    for (const c of children) {
      const d = haversineMeters(poi.lat, poi.lng, c.lat, c.lng);
      if (d > NEARBY_M * 4 && c.kind === 'sub') {
        if (d > 200) continue;
      } else if (d > NEARBY_M && c.kind !== 'sub') {
        continue;
      }
      consider(c);
      if (out.length >= 2) return out;
    }
  } catch {
    /* soft */
  }

  try {
    const all = await getAllPois();
    const scored = all
      .filter((p) => p.id !== poi.id && !seen.has(p.id))
      .map((p) => ({
        p,
        d: haversineMeters(poi.lat, poi.lng, p.lat, p.lng),
      }))
      .filter(
        (x) =>
          x.d >= ALREADY_HERE_M && x.d <= NEARBY_M && Number.isFinite(x.d),
      )
      .sort((a, b) => a.d - b.d);
    for (const { p } of scored) {
      consider(p);
      if (out.length >= 2) break;
    }
  } catch {
    /* soft */
  }

  return out.slice(0, 2);
}

/** Dynamische Buttons: Maps Pflicht bei Orten · Hotel-Partner früh · URLs · Tiefe · Nähe. */
export async function buildModule1Actions(
  poi: PoiWithFacts,
): Promise<{ actions: QuickAction[]; deepJobs: DeepJob[]; cardId: string }> {
  const actions: QuickAction[] = [];
  const name = displayPoiName(poi);
  const activity = looksLikeActivityVenue(poi);
  const hotel = looksLikeHotel(poi);
  const offers = extractPlaceOffers(poi);
  let urlActions = buildPlaceOfferUrlActions(offers);

  // Pack-_links / _meta.sources matchen (wenn Fakten keine URL haben)
  if (urlActions.length < 2) {
    try {
      const cityId =
        getCachedUserProfile()?.cityId?.trim() || env.cityId() || null;
      const links = await getCityPackLinks(cityId);
      const existing = new Set(
        urlActions.map((a) => a.payload.url!).filter(Boolean),
      );
      const matched = buildMatchedPackLinkActions(poi, links, {
        existingUrls: existing,
        max: 2 - urlActions.length,
      });
      urlActions = [...urlActions, ...matched].slice(0, 2);
    } catch {
      /* soft */
    }
  }

  // 1) Maps immer zuerst bei Orten mit Koordinaten
  if (
    Number.isFinite(poi.lat) &&
    Number.isFinite(poi.lng) &&
    actions.length < MAX_ACTIONS
  ) {
    actions.push({
      type: 'OPEN_URL',
      label: shortenActionLabel('🗺️ Maps'),
      payload: {
        url: mapsOpenUrl(name, poi.lat, poi.lng, null),
      },
    });
  }

  // 2) Hotel: Expedia/Stay22 Pflicht-Slot (vor Nähe)
  if (hotel && actions.length < MAX_ACTIONS) {
    const stay = buildHotelBookAction({ name, rank: 1 });
    actions.push(stay);
  }

  // 3) Website / Events / Buchung
  for (const urlAction of urlActions) {
    if (actions.length >= MAX_ACTIONS) break;
    actions.push(urlAction);
  }

  if (actions.length < MAX_ACTIONS) {
    actions.push({
      type: 'SHOW_MORE',
      label: labelForOpportunity('expand', { name, rank: 1 }),
      payload: {
        module1DeepDive: true,
        targetPoiId: poi.id,
        expandKind: activity ? 'activity' : 'poi_history',
        entityName: name,
        actionBoardId: `expand:${poi.id}`,
        textPrompt: activity
          ? `Mehr zu diesem Aktivitäts-Ort — was man hier macht, Preise/Dauer nur wenn belegt, was besonders ist, praktische Tipps. Max 3000 Zeichen. Keine Planungsvorschläge, keine anderen Museen. Charakter-angepasste Motivation am Ende ok. Keine Meta-Abschlussfrage.`
          : `Mehr Historie zu diesem Ort hier vor Ort — tiefer, was du noch nicht gesagt hast. Max 3000 Zeichen. Keine Planungsvorschläge, keine anderen Museen. Keine Abschlussfrage.`,
      },
    });
  }

  const nearbySlots = Math.max(0, MAX_ACTIONS - actions.length);
  if (nearbySlots > 0) {
    const nearby = await nearbyRelatedPois(poi);
    const sortedNearby = [...nearby].sort((a, b) => {
      const ah = /hotel/i.test(a.name) ? 0 : 1;
      const bh = /hotel/i.test(b.name) ? 0 : 1;
      return ah - bh;
    });
    for (const n of sortedNearby.slice(0, nearbySlots)) {
      if (actions.length >= MAX_ACTIONS) break;
      actions.push({
        type: 'START_NAVIGATION',
        label: shortNavLabel(n.name),
        payload: {
          targetPoiId: n.id,
          destName: n.name,
          destLat: n.lat,
          destLng: n.lng,
          entityName: n.name,
        },
      });
    }
  }

  // ActionBoard: Labels + Pending Speisekarte + Expand vereinheitlichen
  const websiteFromOffers =
    urlActions.find((a) => a.payload.url)?.payload.url ?? null;
  const cardId = `m1_${poi.id}_${Date.now()}`;
  const boarded = applyActionBoardToResponse(
    {
      speechText: `Ort: ${name}. ${activity ? 'Aktivität' : hotel ? 'Hotel' : 'Kultur'}.`,
      visualBullets: [],
      quickActions: actions,
    },
    {
      cardId,
      startDeep: false,
      module1: {
        poiId: poi.id,
        name,
        lat: poi.lat,
        lng: poi.lng,
        activity,
        hotel,
        category: poi.category,
        websiteUrl: websiteFromOffers,
      },
    },
  );

  return {
    actions: boarded.response.quickActions.slice(0, MAX_ACTIONS),
    deepJobs: boarded.deepJobs,
    cardId,
  };
}

/** LiveStage-Karte — Stichpunkte erst mit Spoken-Text; Actions dürfen früh. */
export async function presentModule1LiveCard(opts: {
  poi: PoiWithFacts;
  spokenText: string;
  /** Nur Actions, keine Bullets (während Speech noch läuft). */
  actionsOnly?: boolean;
}): Promise<void> {
  const { poi, spokenText } = opts;
  const actionsOnly = Boolean(opts.actionsOnly) || !spokenText.trim();
  const bullets = actionsOnly ? [] : buildModule1Bullets(spokenText, poi);
  const built = await buildModule1Actions(poi);
  const title = truncateToWholeWords(
    `${emojiForPlace({
      name: poi.name,
      category: poi.category,
      kind: poi.kind,
    })} ${displayPoiName(poi)}`,
    52,
    { ellipsis: false },
  );

  const prev = useFinnusStore.getState().activeConciergeCard;
  const cardId =
    prev?.id &&
    typeof prev.id === 'string' &&
    prev.id.includes(`poi-${poi.id}`)
      ? prev.id
      : built.cardId;

  useFinnusStore.getState().setActiveConciergeCard({
    id: cardId,
    createdAtMs: prev?.createdAtMs ?? Date.now(),
    speechText: spokenText.trim()
      ? spokenText.slice(0, 280)
      : prev?.speechText ?? '',
    visualBullets: actionsOnly
      ? prev?.visualBullets?.length
        ? prev.visualBullets
        : []
      : bullets,
    quickActions: built.actions,
    cardTitle: title,
  });

  if (built.deepJobs.length > 0) {
    startActionBoardDeep({ jobs: built.deepJobs, cardId });
  }
}
