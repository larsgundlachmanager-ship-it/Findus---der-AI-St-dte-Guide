/**
 * Stadtgeschichte narrativ — Modul-1 Kurzform + Nachfrage-Tiers.
 *
 * Modul 1 (Auto-Story Historie+Heute): max 1000 Zeichen
 * Nachfrage klein ~1500 · mittel ~2222 · groß max 3000
 * Nie mehr als 3000 Zeichen ausgeben.
 *
 * Orts-/Bahnhof-Historie → placeHistoryNarrative.ts (nicht hier).
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { isDeviceOffline } from '../navigation/networkState';
import { getCachedUserProfile } from '../userProfileService';
import type { GeminiConciergeResponse } from '../../types/concierge';
import { shortenActionLabel } from './actionLabelShorten';
import { extractHistoryFactBullets } from './historyFactBullets';

export const CITY_HISTORY_MODULE1_MAX = 1000;
export const CITY_HISTORY_SMALL_MAX = 1500;
export const CITY_HISTORY_MEDIUM_MAX = 2222;
export const CITY_HISTORY_LARGE_MAX = 3000;

const HISTORY_ASK_RE =
  /\b(geschichte\s+von|erzähl(?:e|)\s+(?:mir\s+)?(?:die\s+)?geschichte|historie|wie\s+(?:ist|wurde)\s+\w+\s+entstanden|woher\s+kommt\s+der\s+name|entstehung|früher\s+(?:hier|war)|chronik|wie\s+entstand)\b/iu;

const MORE_RE =
  /\b(mehr|ausführlich(?:er)?|länger|laenger|richtig\s+lang|ganze\s+geschichte|alles\s+dazu|vertief|details|spannend(?:er)?)\b/iu;

const SHORT_RE =
  /\b(kurz|knapp|in\s+zwei\s+sätzen|zusammenfassung)\b/iu;

/** Orts-Historie (Bahnhof/Kirche…) — wird in placeHistoryNarrative behandelt. */
const PLACE_SCOPED_HISTORY_RE =
  /\b(geschichte|historie|historisch|früher|eröffnet|gebaut).{0,50}\b(bahnhof|haltepunkt|güterbahn|gueterbahn|wartehäuschen|wartehaeuschen|kirche|museum|schloss)\b|\b(bahnhof|haltepunkt|güterbahn|kirche|museum).{0,50}\b(geschichte|historie|früher|eröffnet|gebaut)\b/iu;

export type HistoryDepthTier = 'module1' | 'small' | 'medium' | 'large';

export function isCityHistoryQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (PLACE_SCOPED_HISTORY_RE.test(t)) return false;
  return HISTORY_ASK_RE.test(t);
}

export function resolveHistoryDepthTier(
  userText: string,
  opts?: { module1Auto?: boolean },
): HistoryDepthTier {
  if (opts?.module1Auto) return 'module1';
  const t = userText.replace(/\s+/g, ' ').trim();
  if (SHORT_RE.test(t) && !MORE_RE.test(t)) return 'small';
  if (
    /\b(richtig\s+lang|ganz\s+ausführlich|maximale?\s+länge|alles\s+was\s+du\s+hast|3000)\b/iu.test(
      t,
    )
  ) {
    return 'large';
  }
  if (MORE_RE.test(t) || /\b(cool|spannend|lebendig|packend)\b/iu.test(t)) {
    return 'medium';
  }
  // Explizite Geschichtsfrage ohne „mehr“ → schon mittel-packend
  if (isCityHistoryQuery(t) || HISTORY_ASK_RE.test(t)) return 'medium';
  return 'small';
}

export function historyMaxChars(tier: HistoryDepthTier): number {
  switch (tier) {
    case 'module1':
      return CITY_HISTORY_MODULE1_MAX;
    case 'small':
      return CITY_HISTORY_SMALL_MAX;
    case 'medium':
      return CITY_HISTORY_MEDIUM_MAX;
    case 'large':
      return CITY_HISTORY_LARGE_MAX;
  }
}

function narrativeStyleBlock(cityName: string, maxChars: number): string {
  return [
    'Rolle & Stil:',
    'Agiere als packender Geschichtenerzähler und Reportage-Autor.',
    `Schreibe eine spannende, dynamische und bildhafte Geschichte über ${cityName}.`,
    '',
    'Regeln:',
    '- Keine Begrüßung, kein Lagerfeuer-Intro, kein „Alles klar ich gucke nach“.',
    '- Spring direkt ins Geschehen (Zeitreise / Urkunde / Kontrast).',
    `- MAXIMAL ${maxChars} Zeichen — hartes Limit, lieber knapper enden als kürzen mit „…“.`,
    '- Du-Form erlaubt, aber nicht plapperig. Kein Markdown außer einer Überschrift für „Heute“.',
    '- Währungsangaben als „Euro“. Keine erfundenen Personen/Könige.',
    '- Wenn Fakten fehlen: ehrlich kürzer, nichts erfinden.',
    '- Struktur chronologisch: Ursprung → prägende Orte/Ereignisse → Bruch/Wandel → Heute mit Pointe.',
    '- Geschichte zum Anfassen: Schlamm, Höfe, Flüsse, Menschen — nicht Wikipedia-Trokenheit.',
    '- Mindestens 2–3 konkrete Jahreszahlen oder datierte Meilensteine im Text (Urkunde, Bahn, Krieg, Eingemeindung…).',
  ].join('\n');
}

/**
 * Modul-1: Historie + Aktuelles zusammen ≤ 1000 Zeichen (~70% früherer Länge).
 */
export function module1HistoryLengthHint(): string {
  return [
    '=== MODUL-1 NARRATIV (Historie + Heute) ===',
    `Gesamt max. ${CITY_HISTORY_MODULE1_MAX} Zeichen für Historie UND Aktuelles zusammen.`,
    'Stil: packend, bildhaft, direkt ins Geschehen — kein Lexikon-Ton.',
    'Wer/was/warum damals → was heute davon spürbar ist. Lust auf mehr machen.',
    'Bei expliziter Nachfrage „mehr Geschichte“: längere Tiers (1500 / 2222 / max 3000).',
  ].join('\n');
}

export async function runCityHistoryNarrative(opts: {
  userText: string;
  cityName?: string | null;
  factBlock?: string | null;
  module1Auto?: boolean;
}): Promise<{ promptBlock: string; response: GeminiConciergeResponse } | null> {
  const profile = getCachedUserProfile();
  const city =
    opts.cityName?.trim() ||
    profile?.cityName?.trim() ||
    'diesem Ort';
  const tier = resolveHistoryDepthTier(opts.userText, {
    module1Auto: opts.module1Auto,
  });
  const maxChars = historyMaxChars(tier);

  const promptBlock = [
    '=== STADTGESCHICHTE NARRATIV ===',
    `Stadt: ${city}`,
    `Tier: ${tier} · max ${maxChars} Zeichen`,
    opts.factBlock?.trim() || null,
  ]
    .filter(Boolean)
    .join('\n');

  const offline = await isDeviceOffline();
  if (offline || !hasGeminiApiKey()) {
    const bullets = extractHistoryFactBullets(
      '',
      opts.factBlock,
      3,
    );
    return {
      promptBlock,
      response: {
        speechText:
          `${city} hat tiefe Wurzeln als Ort zwischen Feld, Bach und späterer Anbindung an die große Stadt. ` +
          `Die wahre Geschichte steckt in Höfen, Flussregulierung und dem Wandel vom Bauerndorf zur begehrten Gemeinde — ` +
          `frag nochmal online, dann erzähl ich sie dir richtig packend.`,
        visualBullets: bullets.length
          ? bullets
          : [`📜 ${city}`, 'Offline — Kurzfassung'],
        quickActions: [],
        cardTitle: `Geschichte ${city}`,
      },
    };
  }

  const prompt = [
    narrativeStyleBlock(city, maxChars),
    opts.factBlock?.trim()
      ? `Fakten/Pack-Material (nur nutzen, nichts erfinden):\n${opts.factBlock.trim().slice(0, 6000)}`
      : `Recherchiere glaubwürdige Meilensteine zu ${city} (erste Erwähnung, prägende Höfe/Flüsse/Kriegswandel, heutige Eigenheiten).`,
    `Ausgabe: NUR der Erzähltext, max ${maxChars} Zeichen. Jahreszahlen einweben.`,
  ].join('\n\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      maxTokens: Math.min(2400, Math.ceil(maxChars / 2) + 200),
      temperature: 0.85,
    });
    let speech = (raw || '').replace(/\s+/g, ' ').trim();
    if (speech.length > maxChars) {
      speech = `${speech.slice(0, maxChars - 1).replace(/\s+\S*$/, '').trim()}…`;
    }
    if (!speech) return null;

    const bullets = extractHistoryFactBullets(speech, opts.factBlock, 3);

    return {
      promptBlock,
      response: {
        speechText: speech,
        visualBullets: bullets.length
          ? bullets
          : [
              `📜 ${city}`,
              tier === 'large'
                ? 'Ausführliche Chronik'
                : 'Meilensteine folgen',
            ],
        quickActions:
          tier !== 'large'
            ? [
                {
                  type: 'SHOW_MORE' as const,
                  label: shortenActionLabel('📜 Mehr'),
                  payload: {
                    textPrompt: `Erzähl mir die Geschichte von ${city} noch ausführlicher und spannender — mit konkreten Jahreszahlen und Meilensteinen`,
                  },
                },
              ]
            : [],
        cardTitle: `Geschichte ${city}`,
      },
    };
  } catch {
    return null;
  }
}
