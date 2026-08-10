/**
 * Web Research — öffentliche Seiten + PDFs durchsuchen, strukturieren, Formulare vorbereiten.
 * Kein Login, kein DOM-Automation im System-Browser.
 * Ehrliche Failures → Speech + kein Fake-Button.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { isDeviceOffline } from '../navigation/networkState';
import { getCachedUserProfile } from '../userProfileService';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import type { QuickAction } from '../../types/concierge';
import { fetchPublicDocument } from './webFetch';
import { isEventResearchQuery } from '../concierge/eventResearchService';
import {
  buildConjunctiveSpeechHint,
  dateValidationPromptBlock,
  filterAndValidateFacts,
} from './webAgent/datePlausibility';
import { frictionDomainHint, NOTICE_PATTERNS } from './webAgent/frictionCategories';
import { websiteActionLabel } from '../concierge/websiteActionLabel';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import {
  scoreSourceTrust,
  formatTrustedFactLine,
} from './sourceTrust';

export type ResearchFact = {
  label: string;
  value: string;
  date?: string | null;
  time?: string | null;
  place?: string | null;
  sourceUrl?: string | null;
  confidence: 'high' | 'medium' | 'low';
  /** Disruption/banner/notice */
  isNotice?: boolean;
  /** Notice without usable date */
  undated?: boolean;
  /** Explicit notice date ISO if known */
  noticeDate?: string | null;
};

export type FormPrefillDraft = {
  purpose: string;
  fields: Record<string, string>;
  /** mailto: oder https Booking-URL wenn möglich */
  actionUrl?: string | null;
  /** Text den User absenden / kopieren kann */
  bodyText?: string | null;
  /** true = wir können nur vorbereiten, nicht die Website selbst ausfüllen */
  needsUserConfirm: boolean;
};

export type WebResearchResult = {
  query: string;
  city: string;
  facts: ResearchFact[];
  sources: Array<{ url: string; kind: 'html' | 'pdf' | 'search' | 'other'; title?: string }>;
  formPrefill: FormPrefillDraft | null;
  failures: string[];
  researchNotes: string;
  promptBlock: string;
  speechHint: string | null;
};

const RESEARCH_CACHE_TTL_MS = 20 * 60_000;
const researchResultCache = new Map<
  string,
  { at: number; result: WebResearchResult }
>();

function researchCacheKey(query: string, city: string): string {
  return `${city.trim().toLowerCase()}|${query.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 180)}`;
}

function getCachedResearch(key: string): WebResearchResult | null {
  const hit = researchResultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RESEARCH_CACHE_TTL_MS) {
    researchResultCache.delete(key);
    return null;
  }
  return hit.result;
}

function putCachedResearch(key: string, result: WebResearchResult): void {
  researchResultCache.set(key, { at: Date.now(), result });
  if (researchResultCache.size > 40) {
    const oldest = [...researchResultCache.entries()].sort(
      (a, b) => a[1].at - b[1].at,
    )[0];
    if (oldest) researchResultCache.delete(oldest[0]);
  }
}

const RESEARCH_RE =
  /\b(recherch|nachschau|guck\s+(?:mal\s+)?(?:online|nach)|schau\s+(?:mal\s+)?(?:online|nach)|google|webseite|website|homepage|pdf|flyer|programm|öffnungszeit|oeffnungszeit|frühstückszeit|fruehstueckszeit|check[- ]?out|auscheck|turnierplan|spielplan|ansetzung|fahrplan|fahrzeiten|abfahrtszeit|speisekarte|menü|menu|preis|wie\s+teuer|ticket|tickets|eintritt|verlänger|verlaenger|nacht\s+(?:dazu|verläng)|formular|anmeld|buch(?:en|ung)|historie|geschichte|eröffnungsdatum|eroeffnungsdatum|wann\s+wurde|jahreszahl|fahrrad(?:verleih|mieten)?|radverleih|e-?bike|miet\s*-?\s*rad|verleih|mieten)\b/iu;

/** Bergbahn / Seilbahn / eigene Betreiber-Websites mit Ticket & Fahrplan */
const OPERATOR_SITE_RE =
  /\b(bergbahn|seilbahn|zahnradbahn|standseilbahn|gondel|kabinenbahn|schwebebahn|sessellift|bergbahn\s*ticket|online\s*ticket|fahrplan|abfahrt(?:en|szeiten)?|takt(?:ung)?)\b/iu;

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;

export function isOperatorScheduleQuery(text: string): boolean {
  return OPERATOR_SITE_RE.test(text.replace(/\s+/g, ' ').trim());
}

export function isWebResearchQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 8) return false;
  if (URL_IN_TEXT.test(t)) return true;
  if (isEventResearchQuery(t)) return false; // events have own pipeline
  if (isOperatorScheduleQuery(t)) return true;
  if (RESEARCH_RE.test(t)) return true;
  // Open agent gate (breit) — lazy to avoid circular import at load
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { webAgentIsNeeded } = require('./webAgent/runOpenWebAgent') as {
      webAgentIsNeeded: (s: string) => boolean;
    };
    return webAgentIsNeeded(t);
  } catch {
    return false;
  }
}

function extractJsonObject(raw: string): unknown | null {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function cityHint(): string {
  return (
    getCachedUserProfile()?.cityName?.trim() ||
    useFinnusStore.getState().currentLocationName?.trim() ||
    'Wangerooge'
  );
}

function urlsInText(text: string): string[] {
  return [...new Set(text.match(URL_IN_TEXT) ?? [])].slice(0, 5);
}

async function discoverSourcesWithSearch(
  userText: string,
  city: string,
): Promise<{
  urls: string[];
  notes: string;
  facts: ResearchFact[];
  failures: string[];
}> {
  const operator = isOperatorScheduleQuery(userText);
  const prompt = [
    `Du bist Findus Web-Researcher für ${city}.`,
    `User: „${userText.slice(0, 280)}“`,
    '',
    'Nutze Google Search. Finde ÖFFENTLICHE Quellen (HTML/PDF) — keine Login-only Portale als „gefunden“ verkaufen.',
    operator
      ? [
          'FOKUS BETREIBER-WEBSITE (Bergbahn/Seilbahn/ähnliches):',
          '- Offizielle Betreiber-Domain priorisieren (nicht nur Wikipedia/TripAdvisor).',
          '- Extrahiere: Fahrplan/Abfahrten, Betriebszeiten, Ticketpreise (€), Ticket-Shop-URL.',
          '- Wenn Fahrplan nur hinter Buchungs-Widget/Login: facts mit bekannten Preisen/Zeiten, failures ehrlich, Shop-URL trotzdem liefern.',
          '- Labels klar: „Abfahrt“, „Preis Erwachsener“, „Ticket-Shop“, „Betriebszeit“.',
        ].join('\n')
      : 'Extrahiere wenn möglich: Datum, Uhrzeit, Ort, Öffnungs-/Frühstücks-/Checkout-Zeiten, Preise.',
    'Wenn Login/Paywall nötig: klar in failures nennen.',
    frictionDomainHint(userText),
    dateValidationPromptBlock(),
    '',
    'JSON only:',
    '{',
    '  "researchNotes": "string",',
    '  "urls": ["https://..."],',
    '  "facts": [{"label":"Checkout","value":"bis 11:00","date":null,"time":"11:00","place":"Hotel X","sourceUrl":"https://...","confidence":"high|medium|low","isNotice":false,"undated":false,"noticeDate":null}],',
    '  "failures": ["string"]',
    '}',
    'Max 5 urls, max 8 facts. Nur Belege — nichts erfinden (keine Rabatte/Zeiten ohne Quelltext).',
  ].join('\n');

  const raw = await generateGeminiText(prompt, {
    task: 'generic',
    enableGoogleSearch: true,
    maxTokens: 1400,
    temperature: 0.2,
    useFindusSystem: false,
  });
  const parsed = extractJsonObject(raw) as Record<string, unknown> | null;
  const urls = Array.isArray(parsed?.urls)
    ? (parsed!.urls as unknown[])
        .map((u) => String(u).trim())
        .filter((u) => /^https?:\/\//i.test(u))
        .slice(0, 5)
    : [];
  const facts = parseFacts(parsed?.facts);
  const failures = Array.isArray(parsed?.failures)
    ? (parsed!.failures as unknown[]).map((f) => String(f).slice(0, 160))
    : [];
  const notes =
    typeof parsed?.researchNotes === 'string' ? parsed.researchNotes : '';
  return { urls, notes, facts, failures };
}

function parseFacts(raw: unknown): ResearchFact[] {
  if (!Array.isArray(raw)) return [];
  const out: ResearchFact[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const label = String(r.label ?? '').trim();
    const value = String(r.value ?? '').trim();
    if (label.length < 2 || value.length < 1) continue;
    const conf = String(r.confidence ?? 'medium');
    const noticeDate =
      typeof r.noticeDate === 'string'
        ? r.noticeDate
        : typeof r.date === 'string'
          ? r.date
          : null;
    const isNotice =
      Boolean(r.isNotice) || NOTICE_PATTERNS.test(`${label} ${value}`);
    const undated = Boolean(r.undated) || (isNotice && !noticeDate);
    out.push({
      label: label.slice(0, 60),
      value: value.slice(0, 200),
      date: typeof r.date === 'string' ? r.date : noticeDate,
      time: typeof r.time === 'string' ? r.time : null,
      place: typeof r.place === 'string' ? r.place : null,
      sourceUrl:
        typeof r.sourceUrl === 'string' && /^https?:\/\//i.test(r.sourceUrl)
          ? r.sourceUrl
          : null,
      confidence:
        undated || conf === 'low'
          ? 'low'
          : conf === 'high'
            ? 'high'
            : 'medium',
      isNotice,
      undated,
      noticeDate,
    });
  }
  return out.slice(0, 8);
}

async function deepenFromDocuments(
  userText: string,
  urls: string[],
  city: string,
): Promise<{
  facts: ResearchFact[];
  sources: WebResearchResult['sources'];
  failures: string[];
  notes: string;
}> {
  const sources: WebResearchResult['sources'] = [];
  const failures: string[] = [];
  const docSnippets: string[] = [];

  for (const url of urls.slice(0, 3)) {
    const doc = await fetchPublicDocument(url);
    if (!doc.ok) {
      failures.push(
        doc.reason === 'pdf_unreadable_or_scanned'
          ? `PDF nicht lesbar (Scan/geschützt): ${url}`
          : doc.reason === 'empty_or_js_spa'
            ? `Seite liefert kaum Text (JS/Login?): ${url}`
            : `Abruf fehlgeschlagen (${doc.reason}): ${url}`,
      );
      // Trotzdem als Quelle merken zum Öffnen
      sources.push({
        url,
        kind: /\.pdf(\?|$)/i.test(url) ? 'pdf' : 'other',
        title: 'Quelle (nicht voll lesbar)',
      });
      continue;
    }
    sources.push({
      url: doc.url,
      kind: doc.kind === 'pdf' ? 'pdf' : doc.kind === 'html' ? 'html' : 'other',
    });
    docSnippets.push(
      `--- SOURCE ${doc.kind.toUpperCase()} ${doc.url} ---\n${doc.text.slice(0, 9000)}`,
    );
  }

  if (!docSnippets.length) {
    return { facts: [], sources, failures, notes: 'Keine lesbaren Dokumente.' };
  }

  const prompt = [
    `Extrahiere aus den Quelltexten Fakten für ${city}.`,
    `User-Frage: „${userText.slice(0, 240)}“`,
    frictionDomainHint(userText),
    dateValidationPromptBlock(),
    'Nur was im Text steht. Banner/Hinweise mit Datum. Preise/Zeiten nie erfinden.',
    'PDFs programm_*/prospekt_*/speisekarte_* beachten.',
    'JSON:',
    '{"researchNotes":"…","facts":[{"label":"…","value":"…","date":null,"time":null,"place":null,"sourceUrl":"https://…","confidence":"high|medium|low","isNotice":false,"undated":false,"noticeDate":null}],"failures":[]}',
    '',
    docSnippets.join('\n\n').slice(0, 26_000),
  ].join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'intent',
      maxTokens: 1000,
      temperature: 0.1,
      useFindusSystem: false,
      enableGoogleSearch: false,
    });
    const parsed = extractJsonObject(raw) as Record<string, unknown> | null;
    return {
      facts: parseFacts(parsed?.facts),
      sources,
      failures: [
        ...failures,
        ...(Array.isArray(parsed?.failures)
          ? (parsed!.failures as unknown[]).map((f) => String(f).slice(0, 160))
          : []),
      ],
      notes:
        typeof parsed?.researchNotes === 'string'
          ? parsed.researchNotes
          : 'Dokumente ausgewertet.',
    };
  } catch {
    return {
      facts: [],
      sources,
      failures: [...failures, 'Dokument-Auswertung fehlgeschlagen'],
      notes: 'Dokumente geladen, Auswertung fehlgeschlagen.',
    };
  }
}

function buildFormPrefill(
  userText: string,
  facts: ResearchFact[],
): FormPrefillDraft | null {
  const t = userText.toLowerCase();
  const hotel =
    useUserMemoryStore.getState().getConfirmedHotel()?.name ??
    facts.find((f) => /hotel|unterkunft/i.test(f.place ?? f.label))?.place ??
    null;

  const wantsExtend =
    /\b(verlänger|verlaenger|eine\s+nacht|extra\s+nacht|noch\s+eine\s+nacht|bis\s+donnerstag)\b/iu.test(
      t,
    );
  const wantsReserve =
    /\b(reserv|buch|tisch|anmeld|formular)\b/iu.test(t);

  if (wantsExtend && hotel) {
    const body = [
      `Guten Tag,`,
      ``,
      `ich bin derzeit bei Ihnen im ${hotel} untergebracht und möchte gerne um eine weitere Nacht verlängern.`,
      `Können Sie mir bitte kurz Rückmeldung geben, ob das möglich ist und zu welchem Preis?`,
      ``,
      `Vielen Dank`,
      getCachedUserProfile()?.firstName?.trim() || 'Lars',
    ].join('\n');
    const subject = encodeURIComponent(`Verlängerung — ${hotel}`);
    const mailto = `mailto:?subject=${subject}&body=${encodeURIComponent(body)}`;
    return {
      purpose: `Hotel-Verlängerung bei ${hotel}`,
      fields: {
        hotel,
        request: '1 Nacht verlängern',
        guest: getCachedUserProfile()?.firstName?.trim() || '',
      },
      actionUrl: mailto,
      bodyText: body,
      needsUserConfirm: true,
    };
  }

  if (wantsReserve) {
    const time =
      facts.find((f) => f.time)?.time ||
      userText.match(/\b(\d{1,2})(?::(\d{2}))?\s*uhr\b/i)?.[0] ||
      '';
    const place =
      facts.find((f) => f.place)?.place ||
      hotel ||
      '';
    const party =
      userText.match(/\b(\d{1,2})\s*(?:personen|leute|pax)\b/i)?.[1] || '2';
    const body = [
      `Reservierungsanfrage`,
      place ? `Ort: ${place}` : null,
      time ? `Zeit: ${time}` : null,
      `Personen: ${party}`,
      ``,
      `Bitte um kurze Bestätigung.`,
    ]
      .filter(Boolean)
      .join('\n');
    return {
      purpose: 'Reservierung vorbereiten',
      fields: {
        place: String(place),
        time: String(time),
        partySize: String(party),
      },
      actionUrl: `mailto:?subject=${encodeURIComponent('Reservierung')}&body=${encodeURIComponent(body)}`,
      bodyText: body,
      needsUserConfirm: true,
    };
  }

  return null;
}

function synthesizeSpeech(result: Omit<WebResearchResult, 'speechHint' | 'promptBlock'>): string {
  if (result.facts.length) {
    const ranked = [...result.facts]
      .map((f) => {
        const hoursIsh =
          /öffnung|oeffnung|open|schließt|geöffnet|stunden|opening/i.test(
            `${f.label} ${f.value}`,
          );
        const trust = scoreSourceTrust({
          url: f.sourceUrl,
          hasTime: Boolean(f.time),
          detailLen: (f.value || '').length,
          confidence: f.confidence,
          sourceHint: hoursIsh
            ? `opening_hours ${f.sourceUrl || ''}`.trim()
            : f.sourceUrl || f.confidence,
        });
        return { f, trust };
      })
      .sort((a, b) => b.trust - a.trust);

    const top = ranked.slice(0, 3).map(({ f, trust }) => {
      const bits = [f.value];
      if (f.time) bits.push(f.time);
      if (f.place) bits.push(f.place);
      return formatTrustedFactLine({
        label: f.label,
        value: bits.join(' · '),
        trust,
      });
    });
    let s = `Kurz recherchiert: ${top.join('. ')}.`;
    if (result.formPrefill) {
      s += ` Ich hab dir ${result.formPrefill.purpose} vorbereitet — du musst nur noch bestätigen.`;
    }
    if (result.failures.length) {
      s += ` Ein paar Quellen waren nicht voll lesbar — sag Bescheid, wenn ich tiefer graben soll.`;
    }
    return s;
  }
  if (result.failures.length) {
    return (
      `Ich hab online geguckt, komme aber nicht an die Details ran: ${result.failures[0]}. ` +
      `Oft hängt das hinter Login oder am schwarzen Brett vor Ort. Soll ich dir die öffentliche Seite trotzdem öffnen?`
    );
  }
  return 'Online hab ich dazu gerade nichts Verlässliches gefunden — ohne zu raten.';
}

/**
 * Haupt-Entry: Open Web-Agent (beliebige Sites) → Fakten + Formulare + Links.
 * `force: true` — auch ohne Research-Trigger (z. B. Expand-Ringe leer → Online).
 */
export async function runWebResearch(
  userText: string,
  opts?: { force?: boolean },
): Promise<WebResearchResult | null> {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (
    !opts?.force &&
    !isWebResearchQuery(t) &&
    urlsInText(t).length === 0
  ) {
    return null;
  }

  const cacheKey = researchCacheKey(t, cityHint());
  if (!opts?.force) {
    const cached = getCachedResearch(cacheKey);
    if (cached) return cached;
  }

  // Primär: offener Multi-Step-Agent (alle Websites)
  try {
    const { runOpenWebAgent } = await import('./webAgent/runOpenWebAgent');
    const agent = await runOpenWebAgent(t);
    if (agent) {
      putCachedResearch(cacheKey, agent);
      try {
        const { contributePlacesFromResearchResult } = await import(
          '../memory/collectiveLearning'
        );
        contributePlacesFromResearchResult({
          query: t,
          city: agent.city || cityHint(),
          facts: agent.facts,
          sources: agent.sources,
        });
      } catch {
        /* soft */
      }
      return agent;
    }
  } catch (err) {
    if (__DEV__) console.warn('[webResearch] open agent failed', err);
  }

  const offline = await isDeviceOffline();
  if (offline) {
    return {
      query: t,
      city: cityHint(),
      facts: [],
      sources: [],
      formPrefill: null,
      failures: ['Offline — Web-Recherche nicht möglich'],
      researchNotes: 'Gerät offline',
      promptBlock:
        '=== WEB-RECHERCHE ===\nOffline. Ehrlich sagen, kein Fake.',
      speechHint:
        'Gerade bin ich offline — Webseiten und PDFs kann ich so nicht checken.',
    };
  }
  if (!hasGeminiApiKey()) {
    return {
      query: t,
      city: cityHint(),
      facts: [],
      sources: [],
      formPrefill: null,
      failures: ['Kein Gemini-Key — Recherche nicht möglich'],
      researchNotes: 'API key missing',
      promptBlock: '=== WEB-RECHERCHE ===\nKeine Live-Recherche möglich.',
      speechHint:
        'Live-Recherche ist gerade nicht verfügbar — ich rate nichts dazu.',
    };
  }

  // Fallback: flache Search + Fetch (ohne Link-Follow)
  const city = cityHint();
  const explicitUrls = urlsInText(t);
  let searchFacts: ResearchFact[] = [];
  let searchFailures: string[] = [];
  let notes = '';
  let urls = [...explicitUrls];

  try {
    const discovered = await discoverSourcesWithSearch(t, city);
    notes = discovered.notes;
    searchFacts = discovered.facts;
    searchFailures = discovered.failures;
    for (const u of discovered.urls) {
      if (!urls.includes(u)) urls.push(u);
    }
  } catch (err) {
    searchFailures.push(
      `Search fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannt'}`,
    );
  }

  const deepened = urls.length
    ? await deepenFromDocuments(t, urls, city)
    : {
        facts: [],
        sources: [] as WebResearchResult['sources'],
        failures: [] as string[],
        notes: '',
      };

  const factKey = (f: ResearchFact) =>
    `${f.label.toLowerCase()}|${f.value.toLowerCase()}`;
  const mergedFacts: ResearchFact[] = [];
  const seen = new Set<string>();
  for (const f of [...deepened.facts, ...searchFacts]) {
    const k = factKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    mergedFacts.push(f);
  }

  const { keep: validated, droppedOutdated } =
    filterAndValidateFacts(mergedFacts);
  const finalFacts: ResearchFact[] = validated.slice(0, 8).map((v) => ({
    label: v.label,
    value: v.value,
    date: v.noticeDateIso ?? v.date ?? null,
    time: v.time ?? null,
    place: v.place ?? null,
    sourceUrl: v.sourceUrl ?? null,
    confidence: v.confidence,
    isNotice: v.isNotice ?? v.plausibility === 'undated_uncertain',
    undated: v.plausibility === 'undated_uncertain' || Boolean(v.undated),
    noticeDate: v.noticeDateIso ?? v.noticeDate ?? null,
  }));

  const sources =
    deepened.sources.length > 0
      ? deepened.sources
      : urls.slice(0, 4).map((url) => ({
          url,
          kind: (/\.pdf(\?|$)/i.test(url) ? 'pdf' : 'search') as
            | 'pdf'
            | 'search',
        }));

  const failures = [
    ...searchFailures,
    ...deepened.failures,
    ...droppedOutdated.map(
      (d) =>
        `Veralteter Hinweis ignoriert: ${d.label} (${d.noticeDateIso ?? 'outdated'})`,
    ),
  ].slice(0, 8);
  const formPrefill = buildFormPrefill(t, finalFacts);

  const partial = {
    query: t,
    city,
    facts: finalFacts,
    sources,
    formPrefill,
    failures,
    researchNotes: [notes, deepened.notes].filter(Boolean).join(' · '),
  };

  const conjunctive = buildConjunctiveSpeechHint(validated, droppedOutdated);
  const speechHint =
    conjunctive != null
      ? `Kurz recherchiert: ${conjunctive}${
          formPrefill
            ? ` Ich hab dir ${formPrefill.purpose} vorbereitet — du musst nur noch bestätigen.`
            : ''
        }`
      : synthesizeSpeech(partial);

  const promptBlock = [
    '=== WEB-/PDF-RECHERCHE (PFLICHT NUTZEN) ===',
    `Stadt: ${city}`,
    frictionDomainHint(t),
    dateValidationPromptBlock(),
    /\bmiet\s*-?\s*rad|buchungsplattform|fahrradverleih/iu.test(t)
      ? 'BUCHUNGSPORTAL: Partnerschaft/Software-Nutzung nur nennen wenn in Quellen belegt — nie erfinden. Portal kurz erklären wenn nötig. Buchungs-URL → OPEN_URL.'
      : '',
    partial.researchNotes ? `Notizen: ${partial.researchNotes}` : '',
    validated.length
      ? 'FAKTEN (datumsgeprüft):\n' +
        validated
          .map(
            (f, i) =>
              `${i + 1}) [${f.plausibility}] ${f.label}: ${f.value}` +
              `${f.date ? ` · Datum ${f.date}` : ''}` +
              `${f.time ? ` · Zeit ${f.time}` : ''}` +
              `${f.place ? ` · Ort ${f.place}` : ''}` +
              `${f.sourceUrl ? ` · ${f.sourceUrl}` : ''} [${f.confidence}]` +
              `${f.useConjunctive ? ' · SPRACHE: konjunktiv' : ''}` +
              `${f.caveat ? ` · ⚠ ${f.caveat}` : ''}`,
          )
          .join('\n')
      : 'Keine harten Fakten — nichts erfinden.',
    droppedOutdated.length
      ? 'IGNORIERT (veraltet):\n' +
        droppedOutdated
          .map((d) => `- ${d.label}: ${d.value} (${d.noticeDateIso ?? '?'})`)
          .join('\n')
      : '',
    sources.length
      ? 'QUELLEN:\n' +
        sources.map((s) => `- [${s.kind}] ${s.url}`).join('\n')
      : 'Keine öffentlichen Quellen.',
    failures.length
      ? 'PROBLEME (ehrlich erwähnen):\n' +
        failures.map((f) => `- ${f}`).join('\n')
      : '',
    formPrefill
      ? [
          'FORMULAR-VORBEREITUNG:',
          `- Zweck: ${formPrefill.purpose}`,
          `- Felder: ${JSON.stringify(formPrefill.fields)}`,
          formPrefill.needsUserConfirm
            ? '- WICHTIG: Website-Formulare kann die App NICHT selbst final absenden. Mailto/Text vorbereiten + User bestätigt.'
            : '',
          formPrefill.actionUrl
            ? `- Action: OPEN_URL ${formPrefill.actionUrl.startsWith('mailto:') ? '(E-Mail vorausgefüllt)' : formPrefill.actionUrl}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    'ANTWORT:',
    '- speechText: Verifizierte Fakten direkt; undatierte Hinweise konjunktiv + vor Ort nachfragen.',
    '- Keine erfundenen Rabatte/Öffnungszeiten/Flyer-Preise.',
    '- visualBullets: Datum/Uhrzeit/Ort/Bonus-Infos aus Fakten.',
    '- quickActions: nur echte https/mailto URLs — ZERO-FAKE.',
  ]
    .filter(Boolean)
    .join('\n');

  const result: WebResearchResult = {
    ...partial,
    promptBlock,
    speechHint,
  };
  putCachedResearch(researchCacheKey(t, city), result);
  try {
    const { contributePlacesFromResearchResult } = await import(
      '../memory/collectiveLearning'
    );
    contributePlacesFromResearchResult({
      query: t,
      city,
      facts: result.facts,
      sources: result.sources,
    });
  } catch {
    /* soft */
  }
  return result;
}

/** Deterministische Actions aus Research (Zero-Fake). */
export function webResearchToActions(
  research: WebResearchResult,
): QuickAction[] {
  try {
    // Prefer open-agent labels when present
    const { webAgentToActions } = require('./webAgent/runOpenWebAgent') as {
      webAgentToActions: (r: WebResearchResult) => QuickAction[];
    };
    if (/OPEN WEB-AGENT/i.test(research.promptBlock)) {
      return webAgentToActions(research).map((a) => ({
        ...a,
        label: shortenActionLabel(a.label),
      }));
    }
  } catch {
    /* fall through */
  }

  const actions: QuickAction[] = [];

  if (research.formPrefill?.actionUrl) {
    const url = research.formPrefill.actionUrl;
    actions.push({
      type: 'OPEN_URL',
      label: shortenActionLabel(
        url.startsWith('mailto:') ? '✉️ Anfrage' : '📝 Formular',
      ),
      payload: { url },
    });
  }

  if (
    /\b(hotel|nacht|unterkunft|verläng|verlaeng)\b/iu.test(research.query) &&
    !research.formPrefill
  ) {
    actions.push({
      type: 'BOOK_STAY22',
      label: shortenActionLabel('🏨 Unterkünfte'),
      payload: { destination: research.city },
    });
  }

  for (const s of research.sources.slice(0, 2)) {
    if (!/^https?:\/\//i.test(s.url)) continue;
    if (actions.some((a) => a.payload.url === s.url)) continue;
    const ticketish =
      /ticket|buch|shop|kaufen|online/i.test(s.url) ||
      /ticket|shop|buch/i.test(s.title ?? '');
    actions.push({
      type: 'OPEN_URL',
      label: shortenActionLabel(
        s.kind === 'pdf'
          ? '📄 PDF'
          : ticketish
            ? '🎫 Tickets'
            : websiteActionLabel(s.title, s.url),
      ),
      payload: { url: s.url },
    });
  }

  const place = research.facts.find((f) => f.place)?.place;
  if (place && place.length >= 3) {
    actions.push({
      type: 'START_NAVIGATION',
      label: shortenActionLabel(`📍 ${place}`),
      payload: { destName: place },
    });
  }

  return actions.slice(0, 4);
}

/**
 * Nach leeren Expanding-Ringen (~50 km): Wunsch online recherchieren.
 * Transparent: Stadt + optional GPS im Query; force=true umgeht Research-Gate.
 */
export async function runWishOnlineResearch(opts: {
  wishLabel: string;
  userText?: string | null;
  cityName?: string | null;
  lat?: number | null;
  lng?: number | null;
}): Promise<WebResearchResult | null> {
  const city = (opts.cityName?.trim() || cityHint()).trim();
  const gps =
    opts.lat != null &&
    opts.lng != null &&
    Number.isFinite(opts.lat) &&
    Number.isFinite(opts.lng)
      ? `nahe ${opts.lat.toFixed(4)},${opts.lng.toFixed(4)}`
      : '';
  const wish = (opts.userText || opts.wishLabel || '').replace(/\s+/g, ' ').trim();
  const query = [
    wish || opts.wishLabel,
    city ? `in/bei ${city}` : '',
    gps,
    'Empfehlung Orte Website Speisekarte Öffnungszeiten — recherchiere passende Treffer online',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (query.length < 8) return null;
  try {
    return await runWebResearch(query, { force: true });
  } catch {
    return null;
  }
}

/** Speech-Vorspann: Expand leer → Online. */
export function expandThenOnlineSpeechPrefix(wishLabel: string): string {
  const label = (wishLabel || 'das').trim();
  return (
    `In der Nähe und bis ~50 km nichts Passendes für ${label} — ` +
    `ich recherchiere jetzt online. `
  );
}
