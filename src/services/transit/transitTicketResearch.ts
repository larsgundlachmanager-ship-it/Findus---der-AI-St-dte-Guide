/**
 * ÖPNV-Ticketpreis + Kauf-Button zur laufenden Verbindung.
 *
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an
 * den aktuellen Kontext und die aktuelle Stadt an.
 */

import type { QuickAction } from '../../types/concierge';
import { useFinnusStore } from '../../store/useFinnusStore';
import { extractSpokenPriceEur } from '../research/extractSpokenPrice';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import {
  dbJourneySearchUrl,
  extractTicketProductName,
  pickTransitTicketShopUrls,
} from './transitTicketFareParse';

export {
  dbJourneySearchUrl,
  extractTicketProductName,
  pickTransitTicketShopUrls,
  scoreTransitTicketShopUrl,
  wantsTransitTicketFare,
} from './transitTicketFareParse';

export type TransitTicketContext = {
  fromName: string;
  toName: string;
  line: string | null;
  fromLat: number | null;
  fromLng: number | null;
  toLat: number | null;
  toLng: number | null;
};

export type TransitTicketFareHit = {
  speech: string;
  price: string | null;
  product: string | null;
  bullets: string[];
  actions: QuickAction[];
};

export function activeTransitTicketContext(): TransitTicketContext | null {
  try {
    const st = useFinnusStore.getState();
    const tour = st.multiStopTour;
    const destName = (st.navTargetName || '').trim();
    const stops = tour?.stops ?? [];
    const board =
      stops.find(
        (s) =>
          (s.role === 'board' || s.role === 'walk' || Boolean(s.line)) &&
          (s.name || '').trim(),
      ) ?? stops[0];
    const destStop =
      [...stops].reverse().find((s) => s.role === 'dest') ??
      stops[stops.length - 1];
    const line =
      stops.find((s) => (s.line || '').trim())?.line?.trim() || null;
    const fromName = (board?.name || '').trim();
    const toName = (destStop?.name || destName || '').trim();
    if (!fromName && !toName) return null;
    const transitish = stops.some(
      (s) => s.role === 'alight' || s.role === 'board' || Boolean(s.line),
    );
    if (!transitish && !destName) return null;
    return {
      fromName: fromName || 'Haltestelle',
      toName: toName || destName || 'Ziel',
      line,
      fromLat: board?.lat ?? st.lastGpsLat ?? null,
      fromLng: board?.lng ?? st.lastGpsLng ?? null,
      toLat: destStop?.lat ?? null,
      toLng: destStop?.lng ?? null,
    };
  } catch {
    return null;
  }
}

function buildSpeech(opts: {
  price: string | null;
  product: string | null;
  fromName: string;
  toName: string;
  hasShop: boolean;
}): string {
  const { price, product, fromName, toName, hasShop } = opts;
  if (price && product) {
    return hasShop
      ? `${price} — nimm ${product}. Tippe den Button, dann genau das kaufen.`
      : `${price} — nimm ${product}.`;
  }
  if (price) {
    return hasShop
      ? `${price} für ${fromName} nach ${toName}. Im Shop das Einzelfahrt-Ticket wählen und kaufen.`
      : `${price} für ${fromName} nach ${toName}.`;
  }
  if (product && hasShop) {
    return `Den Live-Preis zeigt der Shop. Dort ${product} auswählen und kaufen.`;
  }
  if (hasShop) {
    return `Den genauen Preis zeigt der Ticket-Shop live — dort das passende Einzelfahrt-Ticket wählen und kaufen.`;
  }
  return `Für ${fromName} nach ${toName} habe ich gerade keinen belegten Ticketpreis.`;
}

function ticketActions(
  shops: Array<{ url: string; title?: string | null }>,
  product: string | null,
): QuickAction[] {
  return shops.slice(0, 2).map((s, i) => ({
    type: 'OPEN_URL' as const,
    label: shortenActionLabel(
      i === 0
        ? product
          ? `🎫 ${product}`
          : '🎫 Ticket kaufen'
        : '🎫 Weiterer Shop',
    ),
    payload: { url: s.url },
  }));
}

export async function researchTransitTicketFare(opts: {
  userText: string;
  lat?: number | null;
  lng?: number | null;
  cityHint?: string | null;
}): Promise<TransitTicketFareHit> {
  const ctx = activeTransitTicketContext();
  const fromName = ctx?.fromName || 'der Haltestelle';
  const toName = ctx?.toName || 'Ziel';
  const line = ctx?.line;

  let googleFare: string | null = null;
  if (
    ctx?.fromLat != null &&
    ctx.fromLng != null &&
    ctx.toLat != null &&
    ctx.toLng != null
  ) {
    try {
      const { fetchRouteDirectionsResult } = await import(
        '../navigation/googleMapsNav'
      );
      const dir = await fetchRouteDirectionsResult(
        { lat: ctx.fromLat, lng: ctx.fromLng },
        { lat: ctx.toLat, lng: ctx.toLng },
        'transit',
      );
      googleFare = dir?.fareText ?? null;
    } catch {
      /* soft */
    }
  }

  let webFactsBlob = '';
  let sources: Array<{ url: string; title?: string | null }> = [];
  try {
    const { runWebResearch } = await import('../research/webResearchService');
    const q = [
      'Fahrkarte Einzelkarte Preis kaufen',
      fromName,
      toName,
      line,
      opts.cityHint,
    ]
      .filter(Boolean)
      .join(' ');
    const web = await runWebResearch(q, { force: true });
    webFactsBlob = [
      web?.speechHint,
      ...(web?.facts ?? []).map((f) => `${f.label} ${f.value}`),
    ]
      .filter(Boolean)
      .join(' · ');
    sources = web?.sources ?? [];
  } catch {
    /* soft */
  }

  const price =
    extractSpokenPriceEur(googleFare) ||
    googleFare ||
    extractSpokenPriceEur(webFactsBlob);
  const product = extractTicketProductName(webFactsBlob);
  const extra: string[] = [];
  const db = dbJourneySearchUrl(
    fromName === 'der Haltestelle' ? '' : fromName,
    toName === 'Ziel' ? '' : toName,
  );
  if (db) extra.push(db);
  const shops = pickTransitTicketShopUrls({
    sources,
    extraUrls: extra,
  });
  let actions = ticketActions(shops, product);
  try {
    const { resolveLiveOpenUrlActions } = await import('../research/liveDeepLink');
    const live = await resolveLiveOpenUrlActions(actions, {
      userText: opts.userText,
      city: opts.cityHint,
    });
    if (live.actions.length) actions = live.actions;
  } catch {
    /* Shop-URL ungeprüft weitergeben */
  }
  const speech = buildSpeech({
    price,
    product,
    fromName,
    toName,
    hasShop: actions.length > 0,
  });
  const bullets = [price, product, line ? `Linie ${line}` : null]
    .filter((x): x is string => Boolean(x))
    .slice(0, 3);

  return { speech, price, product, bullets, actions };
}
