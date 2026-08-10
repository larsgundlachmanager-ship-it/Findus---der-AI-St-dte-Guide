/**
 * Speisekarten-Advisor: Karte finden, Gerichte empfehlen (Prefs + belegter Text).
 * „Auf der Karte empfehlen“ = Speisekarte des gewählten Restaurants — keine Nearby-Orte.
 */

import { getFactsForPoi, getPoiWithFacts, getAllPois } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useGpsStore } from '../../store/useGpsStore';
import type { QuickAction } from '../../types/concierge';
import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { fetchPublicDocument, extractLinksFromHtml } from './webFetch';
import { isDeviceOffline } from '../navigation/networkState';
import {
  getShortTerm,
  setLastPlaceName,
  setLastMenuUrl,
} from '../../module2/context/shortTermContext';
import { searchPlacesByText } from '../navigation/googleMapsNav';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import { useUserProfileStore } from '../../store/useUserProfileStore';

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/** Klassische Übersetz-/Zusammenfassungs-Muster. */
const MENU_READ_RE =
  /\b(speisekarte|menükarte|menuekarte|menü\b|menu\b|karte\s+(lesen|übersetz|uebersetz)|übersetz(?:e|ung)?\s+(?:die\s+)?(?:speisekarte|menü|menu)|was\s+(gibt|steht)\s+(es\s+)?(auf\s+der\s+)?karte|gerichte\s+erkl[äa]r)\b/iu;

/** Entscheidungshilfe auf der Speisekarte (nicht Stadtplan). */
const MENU_ADVISE_RE =
  /\b((auf|von)\s+der\s+(speise)?karte.{0,48}(empfehl|wählen|waehlen|nehmen|bestellen|satt|scharf|sushi|gericht)|(?:empfehl|vorschlagen|tipps?).{0,48}(auf|von)\s+der\s+(speise)?karte|(was|welche[sr]?)\s+(soll|kann|darf)\s+ich\s+(nehmen|wählen|waehlen|essen|bestellen|holen)|hilfe\s+bei\s+der\s+(auswahl|entscheidung)|entscheidungshilfe|explizit.{0,24}(karte|gerichte|empfehl)|konkret.{0,24}(karte|gerichte|empfehl)|große\s+karte|was\s+nehmen)\b/iu;

export type MenuPrefs = {
  filling: boolean;
  mild: boolean;
  lightFresh: boolean;
  sushi: boolean;
  vegetarianHint: string | null;
};

export function extractMenuPrefs(text: string): MenuPrefs {
  const t = text.toLowerCase();
  const profile = useUserProfileStore.getState().profile;
  const diet = [
    ...(profile?.dietaryTags ?? []),
    profile?.allergies ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return {
    filling: /\b(satt|hunger|hungrig|große\s+portion|richtig\s+essen|füllen)\b/i.test(
      t,
    ),
    mild: /\b(nicht\s+zu\s+scharf|nicht\s+scharf|mild|ohne\s+scharf|wenig\s+scharf)\b/i.test(
      t,
    ),
    lightFresh:
      /\b(gesund|frisch|leicht|nicht\s+schwer|keinen\s+schweren\s+magen|leichter\s+magen)\b/i.test(
        t,
      ),
    sushi: /\b(sushi|sashimi|maki|nigiri|uramaki)\b/i.test(t),
    vegetarianHint: /vegetar|vegan|tofu/i.test(`${t} ${diet}`)
      ? 'vegetarisch/vegan bevorzugt wenn möglich'
      : null,
  };
}

export function detectMenuTranslateIntent(text: string): boolean {
  return detectMenuAdvisorIntent(text, Boolean(getShortTerm().lastPlaceName));
}

/**
 * Speisekarten-Hilfe: lesen, übersetzen ODER Gerichte empfehlen.
 * Ohne Restaurant-Kontext: „auf der Karte entdecken“ bleibt Map/Knowledge.
 */
export function detectMenuAdvisorIntent(
  text: string,
  hasRestaurantContext = false,
): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (MENU_READ_RE.test(t)) return true;
  if (MENU_ADVISE_RE.test(t)) return true;
  if (preferMenuUrl(extractUrlsFromText(t)) && hasRestaurantContext) return true;
  if (
    hasRestaurantContext &&
    /\b(speise|gericht|vorspeise|hauptspeise|was\s+bestellen|auswahl)\b/i.test(t) &&
    /\b(empfehl|tipp|wählen|waehlen|nehmen|satt|scharf|sushi|karte)\b/i.test(t)
  ) {
    return true;
  }
  // „Geh auf die Seite von X und such die Speisekarte“
  if (
    /\b(speisekarte|menü|menu)\b/i.test(t) &&
    /\b(seite|website|link|raus|suchen|find)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

function extractUrlsFromText(blob: string): string[] {
  const out: string[] = [];
  const m = blob.match(URL_RE);
  if (m) {
    for (const u of m) {
      const clean = u.replace(/[.,;:!?)]+$/, '');
      if (!out.includes(clean)) out.push(clean);
    }
  }
  return out;
}

function preferMenuUrl(urls: string[]): string | null {
  if (!urls.length) return null;
  const scored = urls.map((u) => {
    let s = 0;
    if (/speisekarte|menu|menue|karte|pdf|menucat/i.test(u)) s += 5;
    if (/\.pdf(\?|$)/i.test(u)) s += 3;
    if (/\/menus?\/?/i.test(u)) s += 4;
    return { u, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0]?.u ?? null;
}

/** Venue aus Text — „bei Lee“, „Lee 1996“, „vom Lee“. */
export function extractVenueNameForMenu(
  text: string,
  lastPlaceName?: string | null,
): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const m =
    t.match(
      /(?:bei|im|in\s+der|in\s+dem|vom|von|für|fuer|zu)\s+(?:dem\s+|der\s+)?([A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']+){0,4})/i,
    ) ||
    t.match(
      /\b([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+\d{4})?)\s+(?:in\s+\w+)?\s*(?:speisekarte|menü|menu)/i,
    );
  if (m?.[1]) {
    const name = m[1]
      .replace(/\s+(um|heute|abend|mittag|uhr|und|oder)\b.*$/i, '')
      .replace(/[.,!?].*$/, '')
      .trim();
    if (
      name.length >= 2 &&
      !/^(hier|der|die|das|dem|den|nähe|nahe|stadt|ort|karte|seite|website|link)$/i.test(
        name,
      )
    ) {
      return name;
    }
  }
  if (
    lastPlaceName?.trim() &&
    /\b(dort|da|davon|dazu|dem\s+laden|dem\s+restaurant|dieser\s+karte|der\s+karte|speisekarte|empfehl|wählen|waehlen|nehmen)\b/i.test(
      t,
    )
  ) {
    return lastPlaceName.trim();
  }
  if (lastPlaceName?.trim() && detectMenuAdvisorIntent(t, true)) {
    return lastPlaceName.trim();
  }
  return lastPlaceName?.trim() || null;
}

function prefsPromptBlock(prefs: MenuPrefs, userText: string): string {
  const bits: string[] = [];
  if (prefs.filling) bits.push('richtig satt / große Portionen');
  if (prefs.mild) bits.push('nicht scharf / mild');
  if (prefs.lightFresh) bits.push('frisch, gesund, leichter Magen');
  if (prefs.sushi) bits.push('Sushi-Option gewünscht');
  if (prefs.vegetarianHint) bits.push(prefs.vegetarianHint);
  bits.push(`User-Wortlaut: ${userText.slice(0, 400)}`);
  return bits.join('; ');
}

async function harvestMenuCandidateUrls(
  baseUrl: string,
  htmlOrText: string,
  links?: Array<{ href: string; label: string }>,
): Promise<string[]> {
  const out: string[] = [];
  const push = (u: string | null | undefined) => {
    const x = (u || '').trim();
    if (!x || !/^https?:/i.test(x) || out.includes(x)) return;
    out.push(x);
  };
  push(baseUrl);
  for (const l of links ?? []) {
    if (/menu|speise|karte|pdf|menucat|essen|food/i.test(`${l.href} ${l.label}`)) {
      push(l.href);
    }
  }
  try {
    for (const l of extractLinksFromHtml(htmlOrText, baseUrl)) {
      if (/menu|speise|karte|pdf|menucat|essen|food/i.test(`${l.href} ${l.label}`)) {
        push(l.href);
      }
    }
  } catch {
    /* soft */
  }
  // Typische WordPress-Pfade am Host
  try {
    const u = new URL(baseUrl);
    push(`${u.origin}/menus/`);
    push(`${u.origin}/menu/`);
    push(`${u.origin}/speisekarte/`);
    push(`${u.origin}/menucats/with-picture/`);
  } catch {
    /* soft */
  }
  return out;
}

async function fetchBestMenuText(urls: string[]): Promise<{
  url: string;
  text: string;
} | null> {
  let best: { url: string; text: string; score: number } | null = null;
  for (const url of urls.slice(0, 5)) {
    try {
      const doc = await fetchPublicDocument(url);
      if (!doc.ok || !doc.text.trim()) continue;
      const t = doc.text.replace(/\s+/g, ' ').trim();
      let score = Math.min(t.length, 8000);
      if (/€|\d+,\d{2}|edamame|sushi|nr\.?\s*\d+|nummer\s*\d+/i.test(t)) {
        score += 2000;
      }
      if (/speise|vorspeise|haupt|maki|pho|curry|wok/i.test(t)) score += 800;
      if (!best || score > best.score) best = { url, text: t, score };
      // Folge-Links von der Startseite
      if (doc.links?.length && score < 2500) {
        const more = await harvestMenuCandidateUrls(url, doc.text, doc.links);
        for (const m of more) {
          if (!urls.includes(m)) urls.push(m);
        }
      }
    } catch {
      /* soft */
    }
  }
  return best ? { url: best.url, text: best.text } : null;
}

async function resolveMenuTarget(userText: string): Promise<{
  url: string | null;
  placeName: string | null;
  websiteUrl: string | null;
  reason: string;
  reviewHints: string[];
}> {
  const short = getShortTerm();
  const explicit = preferMenuUrl(extractUrlsFromText(userText));
  const placeHint = extractVenueNameForMenu(userText, short.lastPlaceName);

  if (explicit) {
    return {
      url: explicit,
      placeName: placeHint,
      websiteUrl: explicit,
      reason: 'url_in_utterance',
      reviewHints: [],
    };
  }

  if (short.lastMenuUrl && placeHint && short.lastPlaceName) {
    // Wiederverwenden wenn gleicher Ort
    if (
      placeHint
        .toLowerCase()
        .includes(short.lastPlaceName.toLowerCase().slice(0, 6)) ||
      short.lastPlaceName
        .toLowerCase()
        .includes(placeHint.toLowerCase().slice(0, 6))
    ) {
      return {
        url: short.lastMenuUrl,
        placeName: short.lastPlaceName,
        websiteUrl: short.lastMenuUrl,
        reason: 'short_term_menu',
        reviewHints: [],
      };
    }
  }

  const store = useFinnusStore.getState();
  const offer = store.pendingNavOffer;
  const poiId =
    store.currentPoiId ??
    (typeof offer?.poiId === 'number' && offer.poiId > 0 ? offer.poiId : null);

  if (poiId != null && placeHint) {
    const facts = await getFactsForPoi(poiId);
    const blob = facts.map((f) => f.fact_text).join('\n');
    const fromFacts = preferMenuUrl(extractUrlsFromText(blob));
    const poi = await getPoiWithFacts(poiId);
    if (
      fromFacts &&
      poi?.name &&
      poi.name.toLowerCase().includes(placeHint.toLowerCase().slice(0, 4))
    ) {
      return {
        url: fromFacts,
        placeName: poi.name,
        websiteUrl: fromFacts,
        reason: 'poi_facts',
        reviewHints: [],
      };
    }
  }

  // Places: Website zum Restaurant (nie GPS-POI-Namen ohne Treffer)
  if (placeHint) {
    try {
      const gps = useGpsStore.getState();
      const hits = await searchPlacesByText({
        query: placeHint,
        lat: gps.lat ?? 53.687,
        lng: gps.lng ?? 9.66,
        radiusM: 25_000,
      });
      const hit =
        hits.find((h) =>
          h.name.toLowerCase().includes(placeHint.toLowerCase().slice(0, 6)),
        ) ?? hits[0];
      if (hit?.websiteUri) {
        const candidates = await harvestMenuCandidateUrls(hit.websiteUri, '');
        const best = await fetchBestMenuText(candidates);
        setLastPlaceName(hit.name);
        if (best) setLastMenuUrl(best.url);
        return {
          url: best?.url ?? hit.websiteUri,
          placeName: hit.name,
          websiteUrl: hit.websiteUri,
          reason: best ? 'places_menu_scrape' : 'places_website',
          reviewHints: [],
        };
      }
      if (hit) {
        setLastPlaceName(hit.name);
        return {
          url: null,
          placeName: hit.name,
          websiteUrl: null,
          reason: 'places_no_website',
          reviewHints: [],
        };
      }
    } catch {
      /* soft */
    }

    // Pack-POIs
    const pois = await getAllPois();
    const q = placeHint.toLowerCase();
    const packHit = pois.find((p) => p.name.toLowerCase().includes(q.slice(0, 8)));
    if (packHit) {
      const facts = await getFactsForPoi(packHit.id);
      const fromFacts = preferMenuUrl(
        extractUrlsFromText(facts.map((f) => f.fact_text).join('\n')),
      );
      if (fromFacts) {
        return {
          url: fromFacts,
          placeName: packHit.name,
          websiteUrl: fromFacts,
          reason: 'named_poi',
          reviewHints: [],
        };
      }
    }
  }

  return {
    url: null,
    placeName: placeHint,
    websiteUrl: null,
    reason: 'no_url',
    reviewHints: [],
  };
}

function presentMenuCard(opts: {
  speech: string;
  bullets: string[];
  actions: QuickAction[];
  title?: string;
}): void {
  useFinnusStore.getState().setActiveConciergeCard({
    id: `menu-${Date.now()}`,
    createdAtMs: Date.now(),
    cardTitle: opts.title ?? 'Speisekarte',
    speechText: opts.speech,
    visualBullets: opts.bullets,
    quickActions: opts.actions.slice(0, 4),
  });
}

function menuOpenAction(url: string, placeName?: string | null): QuickAction {
  const label = placeName
    ? shortenActionLabel(`${placeName} → Speisekarte`)
    : shortenActionLabel('🍽 Speisekarte öffnen');
  return {
    type: 'OPEN_URL',
    label,
    payload: { url },
  };
}

async function buildDishAdviceSpeech(opts: {
  placeName: string | null;
  menuText: string;
  userText: string;
  prefs: MenuPrefs;
}): Promise<{ speech: string; bullets: string[] }> {
  const prefsLine = prefsPromptBlock(opts.prefs, opts.userText);
  const excerpt = opts.menuText.slice(0, 10_000);

  if (!hasGeminiApiKey()) {
    const snippet = excerpt.slice(0, 320);
    return {
      speech: `Kurz aus der Karte${opts.placeName ? ` von ${opts.placeName}` : ''}: ${snippet}${snippet.length >= 320 ? '…' : ''}`,
      bullets: [opts.placeName ?? 'Speisekarte'],
    };
  }

  let raw = '';
  try {
    raw = await generateGeminiText(
      `Du bist Findus. Der User hat Restaurant „${opts.placeName ?? 'dieses Restaurant'}“ schon gewählt und will GERICHTE von der Speisekarte — keine anderen Restaurants, keine Stadtplan-Orte, keine Atmosphäre-Floskeln.\n` +
        `Präferenzen: ${prefsLine}\n\n` +
        `SPEISEKARTEN-TEXT (nur daraus empfehlen; Nummern/Namen exakt übernehmen wenn vorhanden):\n${excerpt}\n\n` +
        `Antwort auf Deutsch, gesprochen, max ~90 Wörter:\n` +
        `- 1 Satz Intro mit Ortsnamen\n` +
        `- Dann 3–4 konkrete Tipps: Vorspeise, Hauptspeise (satt+mild+frisch wenn Prefs), optional Sushi, optional Alternative\n` +
        `- Pro Tipp: Name + Nummer falls im Text + 1 kurze Begründung an Prefs\n` +
        `- Preise nur wenn im Text belegt. Nichts erfinden. Kein „La Fattoria“ o.ä.`,
      { temperature: 0.25, maxTokens: 420 },
    );
  } catch {
    raw = '';
  }

  const speech =
    (raw || '').replace(/\s+/g, ' ').trim() ||
    'Ich hab die Karte gelesen, aber die Empfehlung klappt gerade nicht — Link ist bereit.';

  const bullets = speech
    .split(/(?<=[.!?])\s+|(?=\d+[).]\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 18)
    .slice(0, 4);

  return {
    speech,
    bullets: bullets.length ? bullets : [opts.placeName ?? 'Speisekarte'],
  };
}

export type MenuAdvisorResult = {
  handled: boolean;
  reply?: string;
  bullets?: string[];
  menuUrl?: string | null;
  placeName?: string | null;
  actions?: QuickAction[];
};

/**
 * Speisekarte laden + Gerichte empfehlen (Prefs).
 * Für Intent-Service und Gastro-Agent.
 */
export async function adviseMenuDishes(
  text: string,
): Promise<MenuAdvisorResult> {
  const prefs = extractMenuPrefs(text);
  const offline = await isDeviceOffline();
  if (offline) {
    const speech =
      'Offline — Speisekarte kann ich gerade nicht laden. Wenn du die Website-URL hast, schick sie mir später.';
    presentMenuCard({ speech, bullets: ['Offline'], actions: [] });
    return { handled: true, reply: speech, bullets: ['Offline'], actions: [] };
  }

  const resolved = await resolveMenuTarget(text);
  const placeName = resolved.placeName;
  if (placeName) setLastPlaceName(placeName);

  const googleMenuSearch = placeName
    ? `https://www.google.com/search?q=${encodeURIComponent(`${placeName} Speisekarte`)}`
    : null;

  if (!resolved.url && !resolved.websiteUrl) {
    const place = placeName ? ` für ${placeName}` : '';
    // Nie den aktuellen GPS-POI-Namen erfinden — nur placeHint / lastPlace
    const speech =
      `Ich hab noch keine Speisekarte-URL${place}. ` +
      (placeName
        ? `Such kurz „${placeName} Speisekarte“ oder schick mir den Link — dann empfehle ich dir konkrete Gerichte.`
        : `Sag mir den Restaurantnamen oder schick den Speisekarten-Link.`);
    const actions: QuickAction[] = googleMenuSearch
      ? [menuOpenAction(googleMenuSearch, placeName)]
      : [];
    presentMenuCard({
      speech,
      bullets: placeName
        ? [`Keine Menü-URL · ${placeName}`, 'Link schicken → Empfehlung']
        : ['Keine Menü-URL gefunden', 'Link schicken → Empfehlung'],
      actions,
      title: placeName ? `Menü · ${placeName.slice(0, 28)}` : 'Speisekarte',
    });
    return {
      handled: true,
      reply: speech,
      bullets: [placeName ?? 'Keine URL'],
      menuUrl: googleMenuSearch,
      placeName,
      actions,
    };
  }

  const seedUrl = resolved.url || resolved.websiteUrl!;
  const candidates = await harvestMenuCandidateUrls(seedUrl, '');
  const best = await fetchBestMenuText(candidates);

  if (!best || best.text.length < 80) {
    const openUrl = best?.url ?? seedUrl;
    setLastMenuUrl(openUrl);
    const speech =
      `Die Speisekarte${placeName ? ` von ${placeName}` : ''} lässt sich gerade nicht gut auslesen. ` +
      `Hier ist der Link — öffne ihn und frag mich erneut mit dem Link, dann tippe ich dir Gerichte passend zu: ` +
      [
        prefs.filling ? 'satt' : null,
        prefs.mild ? 'mild' : null,
        prefs.lightFresh ? 'frisch/leicht' : null,
        prefs.sushi ? 'mit Sushi' : null,
      ]
        .filter(Boolean)
        .join(', ') +
      '.';
    const actions = [menuOpenAction(openUrl, placeName)];
    presentMenuCard({
      speech,
      bullets: [placeName ?? 'Speisekarte', openUrl],
      actions,
      title: placeName ? `Menü · ${placeName.slice(0, 28)}` : 'Speisekarte',
    });
    return {
      handled: true,
      reply: speech,
      bullets: [placeName ?? 'Speisekarte'],
      menuUrl: openUrl,
      placeName,
      actions,
    };
  }

  setLastMenuUrl(best.url);
  const { speech, bullets } = await buildDishAdviceSpeech({
    placeName,
    menuText: best.text,
    userText: text,
    prefs,
  });
  const actions = [menuOpenAction(best.url, placeName)];
  if (googleMenuSearch && googleMenuSearch !== best.url) {
    // optional second: nothing — keep Speisekarte primary
  }
  presentMenuCard({
    speech,
    bullets,
    actions,
    title: placeName ? `Menü · ${placeName.slice(0, 28)}` : 'Speisekarte',
  });
  return {
    handled: true,
    reply: speech,
    bullets,
    menuUrl: best.url,
    placeName,
    actions,
  };
}

export async function handleMenuTranslateIntent(
  text: string,
): Promise<{ handled: boolean; reply?: string }> {
  if (!detectMenuAdvisorIntent(text, Boolean(getShortTerm().lastPlaceName))) {
    return { handled: false };
  }
  const r = await adviseMenuDishes(text);
  return { handled: r.handled, reply: r.reply };
}
