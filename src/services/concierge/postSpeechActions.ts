/**
 * Post-Speech Action-Buttons — Text zuerst, dann helfen.
 *
 * Leitfrage: „Was steht im Text — wie helfe ich dem User JETZT am besten?“
 *
 * Struktur (Beispiele sind nur Beispiele):
 * - ≥2 genannte Optionen → Wahl-Hilfe (Routen ODER Detail-Chips je nach Kontext)
 * - Gastro-Wahl → Speisekarte/Web zum Entscheiden
 * - Supermarkt/Apotheke/Toilette/ATM/… → 2 Routen „welchen?“
 * - Tour/Kurs/Verleih erwähnt → Such-/Buchungs-Chip
 * - Geschichte → Folge-Thema aus dem Text
 */

import type { QuickAction } from '../../types/concierge';
import type { WebResearchResult } from '../research/webResearchService';
import type { EventResearchResult } from './eventResearchService';
import { shortenActionLabel } from './actionLabelShorten';
import {
  classifySpeechScene,
  type SpeechScene,
} from './speechMemoryBullets';
import { getAllPois } from '../../db/database';
import { namesAlign } from './canonicalDestination';
import { buildNamedBookingPortalActions } from './bookingPlatformActions';

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const STOP_PLACE =
  /^(Heute|Abend|Uhr|Oder|Auch|Hier|Mein|Dein|Einen|Eine|Dort|Dann|Noch|Sehr|Ganz|Zwei|Drei|Beide)$/iu;

/** ≥2 Optionen aus dem Text — egal ob Supermarkt, Toilette, Café, Apotheke… */
export function extractChoicePlaces(speech: string): string[] {
  const places: string[] = [];

  const orPair = speech.match(
    /\b([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,3})\s+oder\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,3})\b/u,
  );
  if (orPair) places.push(clean(orPair[1]), clean(orPair[2]));

  const fav = speech.match(
    /\b(?:Favorit|Tipp|hier)\s+(?:ist\s+)?([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-&.']*){0,3})/u,
  );
  const alt = speech.match(
    /\b(?:Alternative|oder\s+auch|zweitens|zweite\s+Option)\s*:?\s*([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-&.']*){0,3})/u,
  );
  if (fav?.[1]) places.push(clean(fav[1]));
  if (alt?.[1]) places.push(clean(alt[1]));

  const numbered =
    speech.match(
      /\b(?:\d+[).:]\s*|erstens\s+|zweitens\s+)([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-&.']*){0,3})/gu,
    ) ?? [];
  for (const n of numbered) {
    places.push(
      clean(n.replace(/^(?:\d+[).:]\s*|erstens\s+|zweitens\s+)/iu, '')),
    );
  }

  const labeled =
    speech.match(
      /\b(?:näher|sauberer|günstiger|guenstiger|besser|größer|groesser|offen)\s*[:=–-]?\s*([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-&.']*){0,2})/gu,
    ) ?? [];
  for (const n of labeled) {
    places.push(clean(n.replace(/^[\wÄÖÜäöüß]+\s*[:=–-]?\s*/u, '')));
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const p of places) {
    if (p.length < 3 || STOP_PLACE.test(p)) continue;
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(p);
  }
  return unique.slice(0, 3);
}

/** Gastro-Wahl → Speisekarte hilft beim Entscheiden; sonst Ort-Wahl → Routen. */
function isFoodSelectionContext(speech: string, userText?: string): boolean {
  return /\b(restaurant|essen|abendessen|mittag|bistro|café|cafe|imbiss|speise|pizzeria|sushi|burger|gastro|kneipe|bar\b(?!\s*geld))/iu.test(
    `${userText ?? ''} ${speech}`,
  );
}

function extractHistoryFollowUps(
  speech: string,
): Array<{ label: string; prompt: string }> {
  const follow: Array<{ label: string; prompt: string }> = [];
  const themeHits =
    speech.match(
      /\b((?:Güterbahnhof|Gütergleis|Güterumschlag|Wartehäuschen|Wartehaeuschen|Empfangsgebäude|Empfangsgebaeude|Fachwerk|Eisenbahn|Bahnstrecke|Haltepunkt|Weichen|Marsch|Urkunde|Ehrenmal|Kirche|Kloster|Hafen|Leuchtturm|Mühle|Muehle|Schloss|Burg)[\wÄÖÜäöüß\-]*)\b/gu,
    ) ?? [];
  const seen = new Set<string>();
  for (const raw of themeHits) {
    const name = clean(raw);
    const key = name.toLowerCase();
    if (seen.has(key) || name.length < 4) continue;
    seen.add(key);
    const short = name.length > 14 ? `${name.slice(0, 12)}…` : name;
    follow.push({
      label: `📜 ${short}`,
      prompt: `Erzähl mehr über „${name}“ im historischen Kontext, den du gerade angesprochen hast — mit Jahreszahlen. Recherchiere online wenn lokale Daten dünn sind. Keine Wiederholung der ganzen Stadtgeschichte.`,
    });
    if (follow.length >= 2) break;
  }
  if (follow.length === 0) {
    follow.push({
      label: '📜 Mehr',
      prompt:
        'Vertiefe den spannendsten historischen Punkt aus deinem letzten Text — mit konkreten Jahreszahlen. Online recherchieren wenn nötig.',
    });
  }
  return follow.slice(0, 2);
}

function extractBookingIntents(
  speech: string,
): Array<{ label: string; prompt: string }> {
  const out: Array<{ label: string; prompt: string }> = [];
  const patterns: Array<{ re: RegExp; label: string; kind: string }> = [
    {
      re: /\bboots?(?:verleih|tour)|kanu|kajak|segeln|boot\s+leihen/i,
      label: '🛶 Boot',
      kind: 'Bootsverleih',
    },
    {
      re: /\bkletter(?:kurs|park|halle)|kletterwald/i,
      label: '🧗 Klettern',
      kind: 'Kletterkurs/Kletterpark',
    },
    {
      re: /\b(?:fahrrad|bike|e[\s-]?bike|roller)\s*(?:verleih|leihen|mieten)?|\bradverleih/i,
      label: '🚲 Rad',
      kind: 'Fahrrad-/E-Bike-Verleih',
    },
    {
      re: /\btour\b|stadtrundgang|geführte\s+tour|gefuehrte\s+tour/i,
      label: '🎫 Tour',
      kind: 'geführte Tour',
    },
    {
      re: /\b(?:surf|segel|wetter|tauch|reit|yoga)kurs|\bkurs\b/i,
      label: '🎫 Kurs',
      kind: 'Kurs',
    },
    {
      re: /\bverleih|leihen|mieten\b/i,
      label: '🔍 Verleih',
      kind: 'Verleih',
    },
  ];
  for (const p of patterns) {
    if (!p.re.test(speech)) continue;
    out.push({
      label: p.label,
      prompt: `Such den genannten ${p.kind} aus deinem Text — mit Preis/Link wenn möglich. Zeig Buchung oder Web zum Anschauen; vor verbindlicher Buchung kurz bestätigen lassen.`,
    });
    if (out.length >= 2) break;
  }
  return out;
}

async function navActionForPlace(name: string): Promise<QuickAction> {
  try {
    const pois = await getAllPois();
    const needle = name.toLowerCase();
    const poi =
      pois.find((p) => p.name.toLowerCase() === needle) ||
      pois.find((p) => {
        const n = p.name.toLowerCase();
        return n.includes(needle.slice(0, 14)) || needle.includes(n.slice(0, 14));
      });
    if (poi && Number.isFinite(poi.lat) && Number.isFinite(poi.lng)) {
      return {
        type: 'START_NAVIGATION',
        label: shortenActionLabel(`📍 ${poi.name}`),
        payload: {
          destName: poi.name,
          destLat: poi.lat,
          destLng: poi.lng,
          targetPoiId: poi.id,
        },
      };
    }
  } catch {
    /* soft */
  }
  return {
    type: 'START_NAVIGATION',
    label: shortenActionLabel(`📍 ${name}`),
    payload: { destName: name, targetPoiId: -1 },
  };
}

function actionKey(a: QuickAction): string {
  return `${a.type}:${a.payload.url ?? ''}:${a.payload.destName ?? ''}:${a.payload.textPrompt ?? a.label}`;
}

/**
 * Dual-Option-Hilfe: Struktur, kein Whitelist-Orttyp.
 * Gastro → Speisekarte zum Entscheiden; sonst → Routen (Supermarkt, Toilette, Apotheke…).
 */
async function pushChoiceHelp(
  push: (a: QuickAction) => void,
  speech: string,
  userText: string | undefined,
  choices: string[],
  notes: string[],
): Promise<void> {
  if (choices.length < 2) return;
  const top = choices.slice(0, 2);

  if (isFoodSelectionContext(speech, userText)) {
    for (const name of top) {
      push({
        type: 'SHOW_MORE',
        label: shortenActionLabel(`🍽 ${name}`),
        payload: {
          textPrompt: `Zeig mir die Speisekarte oder Webseite von ${name} — mit OPEN_URL wenn möglich.`,
          destName: name,
        },
      });
    }
    if (
      /\b(route|hin|kompass|geh(?:en)?\s+wir|welcher|welche[rn]?)\b/iu.test(
        userText ?? '',
      )
    ) {
      for (const name of top) push(await navActionForPlace(name));
    }
    notes.push(`choice-food:${top.join('|')}`);
    return;
  }

  for (const name of top) {
    push(await navActionForPlace(name));
  }
  notes.push(`choice-nav:${top.join('|')}`);
}

/**
 * Leitet Hilfe-Buttons aus dem fertigen Speech-Text ab.
 */
export async function deriveHelpActionsFromSpeech(opts: {
  speech: string;
  userText?: string;
  existing?: QuickAction[];
  webResearch?: WebResearchResult | null;
  eventResearch?: EventResearchResult | null;
  maxActions?: number;
}): Promise<{ actions: QuickAction[]; notes: string[]; scene: SpeechScene }> {
  const speech = opts.speech.trim();
  const max = opts.maxActions ?? 4;
  const scene = classifySpeechScene(speech, opts.userText);
  const notes: string[] = [`scene:${scene}`];
  const derived: QuickAction[] = [];

  const push = (a: QuickAction) => {
    if (derived.length >= max) return;
    derived.push({
      ...a,
      label: shortenActionLabel(a.label || a.type),
    });
  };

  const web = opts.webResearch;
  if (web?.sources?.length) {
    for (const s of web.sources.slice(0, 2)) {
      if (!s.url) continue;
      const title = (s.title || 'Web').slice(0, 24);
      if (/\bspeise|menu|karte/i.test(`${title} ${speech}`)) {
        push({
          type: 'OPEN_URL',
          label: shortenActionLabel(`🍽 ${title}`),
          payload: { url: s.url, destName: title },
        });
      } else if (/\bbuch|ticket|tour|kurs|verleih|mietrad/i.test(`${title} ${s.url} ${speech}`)) {
        push({
          type: 'OPEN_URL',
          label: shortenActionLabel(
            /mietrad/i.test(s.url) ? '🚲 Mietrad' : `🎫 ${title}`,
          ),
          payload: { url: s.url },
        });
      } else if (namesAlign(speech, title) || speech.length > 40) {
        push({
          type: 'OPEN_URL',
          label: shortenActionLabel(`🌐 ${title}`),
          payload: { url: s.url },
        });
      }
    }
  }

  // Genanntes Buchungsportal (Mietrad, …) → direkter OPEN_URL
  for (const a of buildNamedBookingPortalActions({
    userText: opts.userText,
    speech,
    webResearch: web,
    existing: [...(opts.existing ?? []), ...derived],
  })) {
    push(a);
    notes.push(`portal:${a.payload.url ?? ''}`);
  }

  const choices = extractChoicePlaces(speech);

  if (
    choices.length >= 2 &&
    (scene === 'place_choice' ||
      scene === 'food_choice' ||
      scene === 'navigation' ||
      scene === 'general' ||
      /\boder\b|favorit|alternative|welcher|welche[rn]?/iu.test(
        `${opts.userText ?? ''} ${speech}`,
      ))
  ) {
    await pushChoiceHelp(push, speech, opts.userText, choices, notes);
  }

  if (scene === 'transit' || /\b(bahnhof|haltepunkt|rb\s*\d|verbindung)/i.test(speech)) {
    if (
      !derived.some((a) =>
        /linien|verbind/i.test(a.label + (a.payload.textPrompt ?? '')),
      )
    ) {
      push({
        type: 'SHOW_MORE',
        label: shortenActionLabel('🚆 Linien'),
        payload: {
          textPrompt:
            'Welche Bahnlinien und Verbindungen halten hier? Richtungen und kurz Takt — keine Stadtgeschichte.',
        },
      });
    }
    if (/\bbahnhof|haltepunkt/i.test(speech) && choices.length < 2) {
      const station =
        speech.match(/\bBahnhof\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-]+)/u)?.[0] ||
        speech.match(/\b([A-ZÄÖÜ][\wÄÖÜäöüß\-]+\s+Bahnhof)\b/u)?.[1] ||
        'Bahnhof';
      push(await navActionForPlace(clean(station)));
    }
  }

  if (scene === 'history') {
    for (const f of extractHistoryFollowUps(speech)) {
      push({
        type: 'SHOW_MORE',
        label: shortenActionLabel(f.label),
        payload: { textPrompt: f.prompt },
      });
    }
  }

  if (scene === 'booking' || scene === 'activity') {
    const hasBookingUrl = derived.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /mietrad|buch|book|verleih|ticket/i.test(
          `${a.payload.url ?? ''} ${a.label}`,
        ),
    );
    // Direkter Buchungs-Link schlägt generischen Such-Chip
    if (!hasBookingUrl) {
      for (const b of extractBookingIntents(speech)) {
        push({
          type: 'SHOW_MORE',
          label: shortenActionLabel(b.label),
          payload: { textPrompt: b.prompt },
        });
      }
    }
  }

  if (scene === 'navigation' && choices.length < 2) {
    const named = (
      speech.match(
        /\b(?:zum|zur|nach|Richtung)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-&.']*){0,3})/gu,
      ) ?? []
    ).map((x) => clean(x.replace(/^(?:zum|zur|nach|Richtung)\s+/i, '')));
    for (const n of named.slice(0, 2)) {
      if (n.length >= 3) push(await navActionForPlace(n));
    }
  }

  const merged: QuickAction[] = [];
  const seen = new Set<string>();
  const preferExisting = (opts.existing ?? []).filter((a) => {
    if (a.type === 'OPEN_URL' && a.payload.url) return true;
    if (a.type === 'DIAL_PHONE' && a.payload.phoneNumber) return true;
    if (
      a.type === 'START_NAVIGATION' &&
      (a.payload.destLat != null || a.payload.destName)
    ) {
      return (
        namesAlign(speech, String(a.payload.destName || a.label)) ||
        choices.length === 0
      );
    }
    if (a.type === 'SHOW_MORE' && a.payload.textPrompt) return true;
    if (
      a.type === 'CONFIRM_API_RESERVATION' ||
      a.type === 'OPEN_GYG_WIDGET' ||
      a.type.startsWith('BOOK_')
    ) {
      return true;
    }
    return false;
  });

  for (const a of [...preferExisting, ...derived]) {
    const k = actionKey(a);
    if (seen.has(k)) continue;
    if (a.type === 'START_NAVIGATION') {
      const dup = merged.some(
        (m) =>
          m.type === 'START_NAVIGATION' &&
          namesAlign(
            String(m.payload.destName || m.label),
            String(a.payload.destName || a.label),
          ),
      );
      if (dup) continue;
    }
    seen.add(k);
    merged.push({
      ...a,
      label: shortenActionLabel(a.label || a.type),
    });
    if (merged.length >= max) break;
  }

  notes.push(`help-actions=${merged.length}`);
  return { actions: merged, notes, scene };
}
