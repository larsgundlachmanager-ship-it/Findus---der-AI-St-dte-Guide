/**
 * Orts-/Bahnhof-Historie — nicht Stadtgeschichte.
 * Pack-Fakten + Online-Recherche; Bahnbezug (Linien, Güter, Eröffnung).
 */

import { getAllPois, getChildPois, getFactsForPoi } from '../../db/database';
import type { Poi } from '../../db/types';
import type { GeminiConciergeResponse, QuickAction } from '../../types/concierge';
import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { isDeviceOffline } from '../navigation/networkState';
import { runWebResearch } from '../research/webResearchService';
import { getCachedUserProfile } from '../userProfileService';
import { shortenActionLabel } from './actionLabelShorten';
import { extractHistoryFactBullets } from './historyFactBullets';
import {
  historyMaxChars,
  resolveHistoryDepthTier,
} from './cityHistoryNarrative';

const PLACE_KIND_RE =
  /\b(bahnhof|haltepunkt|güterbahn(?:hof|steig)?|gueterbahn(?:hof|steig)?|wartehäuschen|wartehaeuschen|kirche|museum|schloss|rathaus|hafen|leuchtturm|peiner\s*hof|goldschätzchen|goldschaetzchen|restaurant|hof|gut)\b/iu;

const PLACE_HISTORY_RE =
  /\b(geschichte|historie|historisch(?:er)?\s+hintergrund|früher|eröffnet|eroeffnet|gebaut|entstanden|entwickelt|über\s+die\s+jahre|wann\s+wurde).{0,60}\b(bahnhof|haltepunkt|güterbahn|gueterbahn|wartehäuschen|wartehaeuschen|kirche|museum|schloss|peiner\s*hof|goldschätzchen|goldschaetzchen|restaurant|hof)\b|\b(bahnhof|haltepunkt|güterbahn|gueterbahn|wartehäuschen|kirche|museum|peiner\s*hof|goldschätzchen|goldschaetzchen).{0,50}\b(geschichte|historie|früher|eröffnet|eroeffnet|gebaut|wann|bedeut|entwickelt)\b/iu;

/** „mehr über den Bahnhof“ / „erzähl über Peiner Hof“ ohne explizit „Geschichte“. */
const PLACE_STORY_RE =
  /\b(mehr\s+(?:über|zum|zur)|erzähl(?:e|)\s+(?:mir\s+)?(?:gerne\s+)?(?:ein\s+bisschen\s+)?(?:mehr\s+)?(?:was\s+)?(?:über\s+|vom\s+|von\s+(?:dem\s+|der\s+|das\s+)?)?|was\s+(?:ist|war)\s+(?:mit\s+)?(?:dem\s+|der\s+)?).{0,50}\b(bahnhof|haltepunkt|güterbahn|gueterbahn|wartehäuschen|wartehaeuschen|peiner\s*hof|goldschätzchen|goldschaetzchen)\b|\b(bahnhof|haltepunkt|güterbahn|peiner\s*hof|goldschätzchen).{0,40}\b(erzähl|erklär|erzaehl|bedeut|früher|geschichte|historie|entwickelt)\b/iu;

const TRAIN_LINES_RE =
  /\b(welche\s+(?:bahn)?linien|welche\s+z[uü]ge|was\s+fährt\s+(?:hier|da)|welche\s+rb|linien\s+(?:fahren|halten)|züge\s+(?:halten|fahren))\b/iu;

const OPENING_DATE_RE =
  /\b(wann\s+wurde|eröffnungsdatum|eroeffnungsdatum|seit\s+wann|in\s+welchem\s+jahr|gebaut|eröffnet|eroeffnet)\b/iu;

export function isPlaceHistoryQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  return PLACE_HISTORY_RE.test(t) || (PLACE_STORY_RE.test(t) && PLACE_KIND_RE.test(t));
}

export function isTrainLinesQuery(text: string): boolean {
  return TRAIN_LINES_RE.test(text.replace(/\s+/g, ' ').trim());
}

export function isStationOpeningQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  return OPENING_DATE_RE.test(t) && PLACE_KIND_RE.test(t);
}

function detectPlaceHint(userText: string): string {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (/\bgoldschätzchen|goldschaetzchen/i.test(t)) return 'Goldschätzchen';
  if (/\bpeiner\s*hof/i.test(t)) return 'Peiner Hof';
  if (/\bgüterbahn|gueterbahn/i.test(t)) return 'Güterbahnhof';
  if (/\bwartehäuschen|wartehaeuschen/i.test(t)) return 'Wartehäuschen';
  if (/\bbahnhof|haltepunkt/i.test(t)) return 'Bahnhof';
  const m = t.match(PLACE_KIND_RE);
  return m?.[1] ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : 'Ort';
}

async function loadPackFactsForPlace(
  placeHint: string,
  cityName: string,
): Promise<{ poi: Poi | null; factBlock: string }> {
  const pois = await getAllPois();
  const hint = placeHint.toLowerCase();
  const city = cityName.toLowerCase();

  const scored = pois
    .map((p) => {
      const n = `${p.name} ${p.category ?? ''} ${p.spot_key ?? ''}`.toLowerCase();
      let score = 0;
      if (hint.includes('güter') || hint.includes('gueter')) {
        if (/güter|gueter/.test(n)) score += 8;
      }
      if (hint.includes('warte')) {
        if (/warte/.test(n)) score += 8;
      }
      if (/bahnhof|haltepunkt|station/.test(hint)) {
        if (/bahnhof|haltepunkt|station/.test(n)) score += 6;
        if (p.category === 'bahnhof') score += 4;
      }
      if (city && n.includes(city.slice(0, 6))) score += 2;
      if (n.includes(hint.slice(0, 8))) score += 3;
      return { p, score };
    })
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score);

  const poi = scored[0]?.p ?? null;
  if (!poi) return { poi: null, factBlock: '' };

  const facts = await getFactsForPoi(poi.id);
  const children = await getChildPois(poi.id);
  const childBits: string[] = [];
  for (const c of children.slice(0, 4)) {
    const cf = await getFactsForPoi(c.id);
    childBits.push(
      `Sub: ${c.name}${c.teaser_text ? ` — ${c.teaser_text}` : ''}${
        cf[0] ? ` — ${cf[0].fact_text}` : ''
      }`,
    );
  }

  const factBlock = [
    `Pack-Ort: ${poi.name} (${poi.category ?? 'poi'})`,
    ...facts.map((f) => `• ${f.fact_text}`),
    ...childBits,
  ]
    .join('\n')
    .slice(0, 7000);

  return { poi, factBlock };
}

function linesFromFacts(factBlock: string): string[] {
  const lines = new Set<string>();
  const re = /\b((?:RB|RE|S)\s*\d{1,3})\b/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(factBlock))) {
    lines.add(m[1].replace(/\s+/g, '').toUpperCase());
  }
  return [...lines];
}

function buildStationActions(opts: {
  placeName: string;
  poi: Poi | null;
  cityName: string;
  includeHistorie: boolean;
  includeLines: boolean;
  includeMoreHistory: boolean;
}): QuickAction[] {
  const actions: QuickAction[] = [];
  const destName =
    opts.poi?.name?.trim() ||
    `${opts.placeName} ${opts.cityName}`.trim() ||
    opts.placeName;

  // Route nur als Button — nie in der Speech „Navigation starten“ bei Historie-Fragen
  if (opts.poi && Number.isFinite(opts.poi.lat) && Number.isFinite(opts.poi.lng)) {
    actions.push({
      type: 'START_NAVIGATION',
      label: shortenActionLabel(`📍 ${destName}`),
      payload: {
        destName,
        destLat: opts.poi.lat,
        destLng: opts.poi.lng,
        targetPoiId: opts.poi.id,
      },
    });
  }

  if (opts.includeHistorie) {
    actions.push({
      type: 'SHOW_MORE',
      label: shortenActionLabel('📜 Historie'),
      payload: {
        textPrompt: `Erzähl mir den historischen Hintergrund vom ${destName}: Eröffnung, Strecke, Güterbahnhof, Wartehäuschen — mit Jahreszahlen. Wenn Pack-Daten dünn sind, recherchiere online.`,
      },
    });
  }

  if (opts.includeLines) {
    actions.push({
      type: 'SHOW_MORE',
      label: shortenActionLabel('🚆 Linien'),
      payload: {
        textPrompt: `Welche Bahnlinien fahren am ${destName}? Nenne die Linien, Richtungen und kurz den Takt — keine Stadtgeschichte.`,
      },
    });
  }

  if (opts.includeMoreHistory) {
    actions.push({
      type: 'SHOW_MORE',
      label: shortenActionLabel('📜 Mehr'),
      payload: {
        textPrompt: `Erzähl noch mehr Bahn-Geschichte zu ${destName}: Güterumschlag, Weichen, Empfangsgebäude, Wandel zum Haltepunkt — mit Jahreszahlen. Recherchiere online wenn nötig.`,
      },
    });
  }

  return actions.slice(0, 4);
}

/**
 * Linienfrage am Bahnhof — Antwort aus Pack (+ Web falls nötig).
 */
export async function runTrainLinesAnswer(opts: {
  userText: string;
  cityName?: string | null;
}): Promise<{ promptBlock: string; response: GeminiConciergeResponse } | null> {
  const profile = getCachedUserProfile();
  const city =
    opts.cityName?.trim() || profile?.cityName?.trim() || 'hier';
  const placeHint = detectPlaceHint(opts.userText);
  const { poi, factBlock } = await loadPackFactsForPlace(placeHint, city);
  const lines = linesFromFacts(factBlock);

  let webExtra = '';
  if (lines.length < 1) {
    try {
      const web = await runWebResearch(
        `Bahnlinien Züge Haltepunkt Bahnhof ${city} RB RE Fahrplan`,
      );
      if (web?.promptBlock) webExtra = web.promptBlock;
    } catch {
      /* soft */
    }
  }

  const allFacts = `${factBlock}\n${webExtra}`;
  const found = linesFromFacts(allFacts);
  const lineList =
    found.length > 0
      ? found.join(' und ')
      : 'die Regionalbahnen auf der Strecke Richtung Hamburg';

  const speech =
    found.length > 0
      ? `Am ${poi?.name ?? `Bahnhof ${city}`} halten vor allem ${lineList}. ` +
        `Richtung Hamburg und Richtung Elmshorn/Westen — mit HVV-Ticket. ` +
        ( /ohne\s+.*bus|kein(?:en)?\s+.*bus/i.test(allFacts)
          ? 'Busanschluss gibt’s hier praktisch nicht — wer wegwill, steigt in die Bahn. '
          : '') +
        `Soll ich dir mehr zur Bahn-Historie erzählen?`
      : `Genau welche Linien gerade halten, ziehe ich aus dem lokalen Pack und Fahrplan — ` +
        `typisch sind Regionalbahnen Richtung Hamburg. Frag nochmal „Linien“, dann hake ich online nach.`;

  const bullets =
    found.length > 0
      ? found.slice(0, 3).map((l) => `🚆 ${l}`)
      : extractHistoryFactBullets(speech, allFacts, 3);

  return {
    promptBlock: `=== BAHNLINIEN ===\n${allFacts.slice(0, 2000)}`,
    response: {
      speechText: speech.trim(),
      visualBullets: bullets.length
        ? bullets
        : [`🚆 ${city}`, 'Richtung Hamburg'],
      quickActions: buildStationActions({
        placeName: placeHint,
        poi,
        cityName: city,
        includeHistorie: true,
        includeLines: false,
        includeMoreHistory: false,
      }),
      cardTitle: `Linien ${poi?.name ?? city}`,
    },
  };
}

/**
 * Bahnhof-/Ort-Geschichte: Pack zuerst, sonst klar sagen + online recherchieren.
 */
export async function runPlaceHistoryNarrative(opts: {
  userText: string;
  cityName?: string | null;
}): Promise<{ promptBlock: string; response: GeminiConciergeResponse } | null> {
  const profile = getCachedUserProfile();
  const city =
    opts.cityName?.trim() || profile?.cityName?.trim() || 'diesem Ort';
  const placeHint = detectPlaceHint(opts.userText);
  let tier = resolveHistoryDepthTier(opts.userText);
  // Ausführliche Ortsfragen (Peiner Hof / Restaurant-Historie) → mind. medium (~1000+)
  if (
    tier === 'small' &&
    /\b(entwickelt|über\s+die\s+jahre|geschichte|historie|wie\s+hat|erzähl|erzaehl|peiner|goldschätzchen)\b/iu.test(
      opts.userText,
    )
  ) {
    tier = 'medium';
  }
  const maxChars = Math.max(historyMaxChars(tier), 1000);
  const { poi, factBlock } = await loadPackFactsForPlace(placeHint, city);

  let webBlock = '';
  const forceWeb =
    isStationOpeningQuery(opts.userText) ||
    factBlock.length < 120 ||
    /\brecherch|online|genau|datum|jahr/i.test(opts.userText);

  try {
    const web = await runWebResearch(
      `${placeHint} ${city} Geschichte Historie Eröffnung Eisenbahn Güterbahnhof Strecke Jahreszahlen ${opts.userText}`.trim(),
    );
    if (web?.promptBlock) webBlock = web.promptBlock;
    else if (forceWeb && web?.speechHint) webBlock = web.speechHint;
  } catch {
    /* soft */
  }

  // Dünne lokale Daten → transparent ankündigen (kurz im Prompt, Speech darf recherchierten Stoff nutzen)
  const thinLocal = factBlock.length < 160;
  const combinedFacts = [
    factBlock || null,
    webBlock
      ? `Online-Recherche:\n${webBlock}`
      : thinLocal
        ? 'HINWEIS: Lokale Pack-Daten dünn — nutze glaubwürdige Online-Meilensteine, kennzeichne Unsicherheit ehrlich.'
        : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const promptBlock = [
    '=== ORTS-/BAHN-HISTORIE ===',
    `Ort: ${poi?.name ?? placeHint} · Stadt: ${city}`,
    `Tier: ${tier} · max ${maxChars}`,
  ].join('\n');

  const offline = await isDeviceOffline();
  if (offline || !hasGeminiApiKey()) {
    const bullets = extractHistoryFactBullets('', factBlock, 3);
    const speech =
      factBlock.length > 40
        ? factBlock
            .split('\n')
            .map((l) => l.replace(/^•\s*/, ''))
            .filter((l) => !l.startsWith('Pack-Ort') && !l.startsWith('Sub:'))
            .slice(0, 3)
            .join(' ')
            .slice(0, 500)
        : `${placeHint} in ${city}: offline kann ich die Bahn-Historie nur grob skizzieren — frag nochmal online.`;
    return {
      promptBlock,
      response: {
        speechText: speech,
        visualBullets: bullets.length ? bullets : [`📜 ${placeHint}`, 'Offline'],
        quickActions: buildStationActions({
          placeName: placeHint,
          poi,
          cityName: city,
          includeHistorie: false,
          includeLines: true,
          includeMoreHistory: false,
        }),
        cardTitle: `Historie ${poi?.name ?? placeHint}`,
      },
    };
  }

  const isRail =
    /bahnhof|haltepunkt|güter|gueter|warte|eisenbahn|schiene/i.test(
      `${placeHint} ${poi?.name ?? ''} ${poi?.category ?? ''}`,
    );

  const prompt = [
    'Rolle: packender Orts-Erzähler mit Fokus auf DIESEN Ort — nicht die ganze Stadtgeschichte wiederholen.',
    `Thema: ${poi?.name ?? placeHint} in ${city}.`,
    `MAXIMAL ${maxChars} Zeichen. Du-Form ok. Keine Begrüßung.`,
    isRail
      ? [
          'BAHN-PFLICHT:',
          '- Schwerpunkt Schiene: Anschluss-Jahr, Strecke (z. B. Hamburg–Kiel), Wandel Bahnhof→Haltepunkt.',
          '- Güterbahnhof/Gütergleis/Umschlag für Bauern & Betriebe ansprechen, wenn Fakten das hergeben.',
          '- Wartehäuschen / Empfangsgebäude mit Jahreszahl wenn bekannt.',
          '- Heutige Linien (RB…) nur kurz, wenn in den Fakten — sonst Button-Thema „Linien“ offen lassen.',
          '- Wenig Dorf-Allgemeinplatz (Felder/Marsch) — nur als kurzer Kontrast, wenn es zur Bahn passt.',
          '- Wenn Eröffnungsdatum unsicher: sag’s ehrlich, nenne aber belegte Meilensteine (z. B. Streckenanschluss 1844) und was Online hergibt.',
        ].join('\n')
      : [
          'ORT-PFLICHT (informativ, kein Märchen-Pathos):',
          '- Ziel: ~1000 Zeichen mit konkreten Infos, die ein Tourist braucht.',
          '- Zahlen & Meilensteine: seit wann, Größe/Umfang, Wandel der Nutzung.',
          '- Heute: was man dort machen/essen/trinken kann (Biergarten, Golf, Events, Küche) — nur wenn belegt.',
          '- Kein „Wir schreiben das Jahr…“-Kino. Klar, faktisch, nützlich.',
        ].join('\n'),
    thinLocal
      ? 'Pack war dünn: Du darfst Online-Recherche nutzen. Formuliere natürlich, erfinde nichts.'
      : 'Nutze Pack-Fakten primär; Online nur zur Ergänzung fehlender Jahreszahlen/Details.',
    combinedFacts
      ? `Fakten:\n${combinedFacts.slice(0, 8000)}`
      : `Recherchiere glaubwürdige Meilensteine zu ${placeHint} ${city}.`,
    'Ausgabe: NUR Erzähltext, keine Bullet-Liste, keine Meta-Labels (kein Speech text:/Card title:/Type:).',
    `Mindestziel: möglichst nahe ${maxChars} Zeichen (nicht knapper als nötig).`,
  ].join('\n\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      maxTokens: Math.min(2400, Math.ceil(maxChars / 2) + 200),
      temperature: 0.7,
    });
    let speech = (raw || '').replace(/\s+/g, ' ').trim();
    if (speech.length > maxChars) {
      speech = `${speech.slice(0, maxChars - 1).replace(/\s+\S*$/, '').trim()}…`;
    }
    if (!speech) return null;

    const bullets = extractHistoryFactBullets(speech, combinedFacts, 3);
    const wantsLinesFollowUp = !isTrainLinesQuery(opts.userText);
    const deep =
      /\b(mehr|ausführlich|historisch|hintergrund)\b/iu.test(opts.userText) ||
      tier === 'medium' ||
      tier === 'large';

    return {
      promptBlock,
      response: {
        speechText: speech,
        visualBullets: bullets.length
          ? bullets
          : [`📜 ${poi?.name ?? placeHint}`, 'Bahn-Historie'],
        quickActions: buildStationActions({
          placeName: placeHint,
          poi,
          cityName: city,
          includeHistorie: !deep,
          includeLines: wantsLinesFollowUp && isRail,
          includeMoreHistory: deep && tier !== 'large',
        }),
        cardTitle: `Historie ${poi?.name ?? placeHint}`,
      },
    };
  } catch {
    return null;
  }
}
