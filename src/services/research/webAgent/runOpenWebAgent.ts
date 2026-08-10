/**
 * Open Web-Agent — beliebige öffentliche Websites bei Bedarf.
 * Multi-Step: Suchen → Seite laden → relevante Links „anklicken“ (fetch) →
 * Formulare vorbereiten → User mit Fakten + echten Buttons ausstatten.
 *
 * Limits (ehrlich): kein Login, kein JS-Click in SPAs, kein CAPTCHA.
 */

import { generateGeminiText, hasGeminiApiKey } from '../../geminiService';
import { isDeviceOffline } from '../../navigation/networkState';
import { getCachedUserProfile } from '../../userProfileService';
import { useFinnusStore } from '../../../store/useFinnusStore';
import type { QuickAction } from '../../../types/concierge';
import { websiteActionLabel } from '../../concierge/websiteActionLabel';
import {
  buildGetFormUrl,
  fetchPublicDocument,
  type FetchedDoc,
} from '../webFetch';
import type {
  FormPrefillDraft,
  ResearchFact,
  WebResearchResult,
} from '../webResearchService';
import {
  extractQueryIntentTokens,
  FRICTION_KEYS,
  frictionDomainHint,
  NOTICE_PATTERNS,
  PDF_BROCHURE_RE,
} from './frictionCategories';
import {
  buildConjunctiveSpeechHint,
  dateValidationPromptBlock,
  filterAndValidateFacts,
} from './datePlausibility';

export type WebAgentStep = {
  action: 'search' | 'open' | 'follow_link' | 'read_form' | 'done';
  url?: string;
  note: string;
};

const MAX_PAGES = 5;
const MAX_FOLLOW = 3;

/** Wann der Agent überhaupt losläuft — offen für alle Domains + Friction. */
export function webAgentIsNeeded(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 6) return false;
  if (/https?:\/\//i.test(t)) return true;
  if (NOTICE_PATTERNS.test(t)) return true;
  if (
    /\b(webseite|website|homepage|online|google|recherch|nachschau|guck\s+mal|pdf|flyer|ticket|tickets|fahrplan|öffnung|oeffnung|preis|wie\s+teuer|buch(?:en|ung)|formular|anmeld|abfahrt|bergbahn|seilbahn|flug|fähre|faehre|speisekarte|menü|menu|check[- ]?out|frühstück|fruehstueck|verfügbar|verfuegbar|termin|öffnungzeit|sauna|wellness|prospekt|gezeiten|tide|kurkarte|notdienst|apotheke)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(wann|wie\s+viel|gibt\s+es|wo\s+(kann|gibt)|öffnungszeit|oeffnungszeit|gesperrt|ausfall)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  // Any friction key hit
  const lower = t.toLowerCase();
  for (const k of FRICTION_KEYS) {
    if (k.length >= 5 && lower.includes(k.toLowerCase())) return true;
  }
  return false;
}

function cityHint(): string {
  return (
    getCachedUserProfile()?.cityName?.trim() ||
    useFinnusStore.getState().currentLocationName?.trim() ||
    'unterwegs'
  );
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

/**
 * Dynamic Category Generalization + friction keys.
 * keys are a boost list, NOT a hard limit — query tokens (>4 letters) always score.
 */
export function scoreLink(
  link: { href: string; label: string },
  goal: string,
): number {
  const g = goal.toLowerCase();
  const blob = `${link.label} ${link.href}`.toLowerCase();
  let score = 0;

  // A–H friction categories (boost, not ceiling)
  for (const k of FRICTION_KEYS) {
    const key = k.toLowerCase();
    if (key.length < 3) continue;
    const inGoal = g.includes(key);
    const inLink = blob.includes(key);
    if (inGoal && inLink) score += 4;
    else if (inLink) score += 1;
  }

  // Fuzzy semantic: ANY query token >4 letters vs anchor/href
  const tokens = extractQueryIntentTokens(goal);
  for (const tok of tokens) {
    if (blob.includes(tok)) score += 3;
  }

  // PDF brochures / programm / prospekt
  if (PDF_BROCHURE_RE.test(link.href) || PDF_BROCHURE_RE.test(link.label)) {
    score += 4;
  } else if (/\.pdf(\?|$)/i.test(link.href)) {
    score += 2;
  }

  // Alert / notice pages
  if (NOTICE_PATTERNS.test(blob) && NOTICE_PATTERNS.test(g)) score += 3;

  if (/login|signin|account|warenkorb|cart|cookie/i.test(blob)) score -= 2;
  return score;
}

function pickLinksToFollow(
  docs: FetchedDoc[],
  goal: string,
  visited: Set<string>,
): string[] {
  const scored: Array<{ href: string; score: number }> = [];
  for (const d of docs) {
    for (const l of d.links ?? []) {
      if (visited.has(l.href)) continue;
      const s = scoreLink(l, goal);
      if (s >= 2) scored.push({ href: l.href, score: s });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_FOLLOW).map((s) => s.href);
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
    const isNotice = Boolean(r.isNotice) || NOTICE_PATTERNS.test(`${label} ${value}`);
    const undated = Boolean(r.undated) || (isNotice && !noticeDate);
    out.push({
      label: label.slice(0, 60),
      value: value.slice(0, 220),
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
  return out.slice(0, 12);
}

async function discoverSeedUrls(
  userText: string,
  city: string,
): Promise<{ urls: string[]; notes: string; failures: string[] }> {
  const domain = frictionDomainHint(userText);
  const prompt = [
    `Open Web-Agent für ${city}. Beliebige öffentliche Websites.`,
    `Ziel: „${userText.slice(0, 300)}“`,
    domain,
    'Self-Prompt: Das ist eine lokale Friction-Frage. Scanne PDFs, Unterseiten, Banner und Hinweise — mit Datumsprüfung.',
    'Priorisiere: offizielle Betreiber, Ticket-Shop, Fahrplan, programm_*.pdf / prospekt_*.pdf / speisekarte_*.pdf, Alert-Banner-Seiten.',
    'Keine Login-only als „fertig“. Max 5 https-URLs.',
    'Keine erfundenen Rabatte/Öffnungszeiten.',
    'JSON: {"notes":"…","urls":["https://…"],"failures":["…"]}',
  ].join('\n');

  const raw = await generateGeminiText(prompt, {
    task: 'generic',
    enableGoogleSearch: true,
    maxTokens: 900,
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
  return {
    urls,
    notes: typeof parsed?.notes === 'string' ? parsed.notes : '',
    failures: Array.isArray(parsed?.failures)
      ? (parsed!.failures as unknown[]).map((f) => String(f).slice(0, 160))
      : [],
  };
}

function buildFormDrafts(
  docs: FetchedDoc[],
  userText: string,
): FormPrefillDraft | null {
  const withForms = docs.find((d) => (d.forms?.length ?? 0) > 0);
  if (!withForms?.forms?.length) return null;
  const form = withForms.forms[0]!;
  const fields: Record<string, string> = {};
  for (const f of form.fields) {
    if (f.value) fields[f.name] = f.value;
    else if (/date|datum|start/i.test(f.name) && /\d{4}-\d{2}-\d{2}/.test(userText)) {
      const m = userText.match(/\d{4}-\d{2}-\d{2}/);
      if (m) fields[f.name] = m[0];
    } else if (/email|mail/i.test(f.name)) {
      fields[f.name] = getCachedUserProfile()?.email?.trim() || '';
    } else if (/name|vorname|firstname/i.test(f.name)) {
      fields[f.name] = getCachedUserProfile()?.firstName?.trim() || '';
    } else if (/phone|tel/i.test(f.name)) {
      fields[f.name] = '';
    }
  }

  if (form.method === 'get') {
    const url = buildGetFormUrl(form.action, fields);
    return {
      purpose: `Formular auf ${withForms.url}`,
      fields,
      actionUrl: url,
      bodyText: Object.entries(fields)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
      needsUserConfirm: true,
    };
  }

  // POST: cannot submit silently — prepare + open page
  return {
    purpose: `Formular (POST) auf ${withForms.url} — bitte im Browser bestätigen`,
    fields,
    actionUrl: withForms.url,
    bodyText: [
      'Vorausgefüllte Felder (manuell im Formular eintragen):',
      ...Object.entries(fields).map(([k, v]) => `- ${k}: ${v || '(leer)'}`),
    ].join('\n'),
    needsUserConfirm: true,
  };
}

async function synthesizeFromPages(
  userText: string,
  city: string,
  docs: FetchedDoc[],
): Promise<{
  facts: ResearchFact[];
  notes: string;
  failures: string[];
  nextLinks: string[];
}> {
  const blob = docs
    .filter((d) => d.ok && d.text)
    .map(
      (d) =>
        `=== ${d.url} (${d.kind}) ===\n${d.text.slice(0, 7000)}\nLINKS:\n${(d.links ?? [])
          .slice(0, 12)
          .map((l) => `- ${l.label} → ${l.href}`)
          .join('\n')}`,
    )
    .join('\n\n')
    .slice(0, 24_000);

  if (!blob) {
    return {
      facts: [],
      notes: 'Keine lesbaren Seiten',
      failures: ['Seiten leer oder JS-only'],
      nextLinks: [],
    };
  }

  const prompt = [
    `Open Web-Agent Extraktion für ${city}.`,
    `User-Ziel: „${userText.slice(0, 240)}“`,
    frictionDomainHint(userText),
    dateValidationPromptBlock(),
    'Aus den Seiten: Fakten (Datum/Zeit/Ort/Preis/Fahrplan/Banner). Nichts erfinden.',
    'Top-Banner & Alerts prüfen — nur mit Datum als starker Fakt.',
    'PDFs programm_*/prospekt_*/speisekarte_* bevorzugen.',
    'Schlage bis zu 3 weitere Links vor (follow).',
    'JSON:',
    '{"notes":"…","facts":[{"label":"…","value":"…","date":null,"time":null,"place":null,"sourceUrl":"https://…","confidence":"high|medium|low","isNotice":false,"undated":false,"noticeDate":null}],"failures":[],"followUrls":["https://…"]}',
    '',
    blob,
  ].join('\n');

  const raw = await generateGeminiText(prompt, {
    task: 'intent',
    maxTokens: 1100,
    temperature: 0.1,
    useFindusSystem: false,
    enableGoogleSearch: false,
  });
  const parsed = extractJsonObject(raw) as Record<string, unknown> | null;
  return {
    facts: parseFacts(parsed?.facts),
    notes: typeof parsed?.notes === 'string' ? parsed.notes : '',
    failures: Array.isArray(parsed?.failures)
      ? (parsed!.failures as unknown[]).map((f) => String(f).slice(0, 160))
      : [],
    nextLinks: Array.isArray(parsed?.followUrls)
      ? (parsed!.followUrls as unknown[])
          .map((u) => String(u).trim())
          .filter((u) => /^https?:\/\//i.test(u))
          .slice(0, 3)
      : [],
  };
}

/**
 * Haupt-Entry: offener Multi-Step Browse für beliebige Websites.
 */
export async function runOpenWebAgent(
  userText: string,
): Promise<WebResearchResult | null> {
  if (!webAgentIsNeeded(userText)) return null;

  const city = cityHint();
  const steps: WebAgentStep[] = [];
  const failures: string[] = [];
  const visited = new Set<string>();
  const docs: FetchedDoc[] = [];

  if (await isDeviceOffline()) {
    return {
      query: userText,
      city,
      facts: [],
      sources: [],
      formPrefill: null,
      failures: ['Offline — Web-Agent pausiert'],
      researchNotes: 'offline',
      promptBlock:
        '=== OPEN WEB-AGENT ===\nOffline. Ehrlich sagen, nichts erfinden.',
      speechHint:
        'Gerade bin ich offline — Webseiten kann ich so nicht durchstöbern.',
    };
  }
  if (!hasGeminiApiKey()) {
    return {
      query: userText,
      city,
      facts: [],
      sources: [],
      formPrefill: null,
      failures: ['Kein Gemini-Key'],
      researchNotes: 'no key',
      promptBlock: '=== OPEN WEB-AGENT ===\nRecherche nicht verfügbar.',
      speechHint: 'Live-Web-Recherche ist gerade nicht verfügbar.',
    };
  }

  // 1) Seeds from user URLs + search
  const seedFromUser = [
    ...new Set(userText.match(/https?:\/\/[^\s<>"']+/gi) ?? []),
  ].slice(0, 3);
  let seeds = [...seedFromUser];
  try {
    steps.push({ action: 'search', note: 'Google Search nach Quellen' });
    const disc = await discoverSeedUrls(userText, city);
    failures.push(...disc.failures);
    for (const u of disc.urls) if (!seeds.includes(u)) seeds.push(u);
  } catch (err) {
    failures.push(
      `Search: ${err instanceof Error ? err.message : 'fehlgeschlagen'}`,
    );
  }

  // 2) Open pages + follow links (simulate clicks)
  const queue = [...seeds];
  while (queue.length && docs.length < MAX_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    steps.push({ action: 'open', url, note: 'Seite laden' });
    const doc = await fetchPublicDocument(url);
    docs.push(doc);
    if (!doc.ok) {
      failures.push(`${url}: ${doc.reason}`);
      continue;
    }
    // Auto-follow high-score links
    const follow = pickLinksToFollow([doc], userText, visited);
    for (const f of follow) {
      if (!queue.includes(f) && docs.length + queue.length < MAX_PAGES) {
        queue.push(f);
        steps.push({
          action: 'follow_link',
          url: f,
          note: 'Relevanter Link (Klick-Simulation)',
        });
      }
    }
  }

  // 3) LLM may suggest more follows once
  let facts: ResearchFact[] = [];
  let notes = '';
  try {
    const syn = await synthesizeFromPages(userText, city, docs);
    facts = syn.facts;
    notes = syn.notes;
    failures.push(...syn.failures);
    for (const u of syn.nextLinks) {
      if (visited.has(u) || docs.length >= MAX_PAGES) continue;
      steps.push({
        action: 'follow_link',
        url: u,
        note: 'Agent folgt empfohlenem Link',
      });
      visited.add(u);
      const doc = await fetchPublicDocument(u);
      docs.push(doc);
      if (doc.ok) {
        const again = await synthesizeFromPages(userText, city, [doc]);
        for (const f of again.facts) {
          if (
            !facts.some(
              (x) =>
                x.label === f.label &&
                x.value.toLowerCase() === f.value.toLowerCase(),
            )
          ) {
            facts.push(f);
          }
        }
        failures.push(...again.failures);
      } else {
        failures.push(`${u}: ${doc.reason}`);
      }
    }
  } catch (err) {
    failures.push(
      `Auswertung: ${err instanceof Error ? err.message : 'fehlgeschlagen'}`,
    );
  }

  const formPrefill = buildFormDrafts(docs, userText);
  if (formPrefill) {
    steps.push({
      action: 'read_form',
      url: formPrefill.actionUrl ?? undefined,
      note: 'Formular erkannt — vorausgefüllt für User-Bestätigung',
    });
  }

  steps.push({ action: 'done', note: `${docs.length} Seiten, ${facts.length} Fakten` });

  const sources = docs
    .filter((d) => /^https?:\/\//i.test(d.url))
    .slice(0, 6)
    .map((d) => ({
      url: d.url,
      kind: (d.kind === 'pdf'
        ? 'pdf'
        : d.ok
          ? 'html'
          : 'other') as 'html' | 'pdf' | 'other',
      title: d.ok ? undefined : d.reason,
    }));

  const uniqueFails = [...new Set(failures)].slice(0, 8);

  // SPA / login honesty
  if (docs.some((d) => d.reason === 'empty_or_js_spa')) {
    uniqueFails.push(
      'Mindestens eine Seite ist stark JavaScript-basiert — Inhalt nur teilweise lesbar; Shop-Link trotzdem anbieten',
    );
  }

  // Date & plausibility: drop outdated notices; conjunctive for undated
  const { keep: validated, droppedOutdated } = filterAndValidateFacts(facts);
  for (const d of droppedOutdated) {
    uniqueFails.push(
      `Veralteter Hinweis ignoriert: ${d.label} (${d.noticeDateIso ?? d.caveat ?? 'outdated'})`,
    );
  }
  const finalFacts: ResearchFact[] = validated.slice(0, 10).map((v) => ({
    label: v.label,
    value: v.value,
    date: v.noticeDateIso ?? v.date ?? null,
    time: v.time ?? null,
    place: v.place ?? null,
    sourceUrl: v.sourceUrl ?? null,
    confidence: v.confidence,
    isNotice: v.isNotice ?? v.plausibility === 'undated_uncertain',
    undated: v.plausibility === 'undated_uncertain' || v.undated,
    noticeDate: v.noticeDateIso ?? v.noticeDate ?? null,
  }));

  const conjunctive = buildConjunctiveSpeechHint(validated, droppedOutdated);
  const speechHint = conjunctive
    ? `Ich hab online nachgeschaut: ${conjunctive}${
        formPrefill
          ? ' Ein Formular hab ich vorausgefüllt — du bestätigst nur noch.'
          : ''
      }${
        uniqueFails.some((f) => /Login|JS|JavaScript/i.test(f))
          ? ' Ein paar Schritte waren blockiert (Login/JS) — ich sag dir ehrlich Bescheid.'
          : ''
      }`
    : uniqueFails.length
      ? `Ich war auf den Websites unterwegs, komme aber nicht an alle Details ran: ${uniqueFails[0]}. Soll ich dir die Seite trotzdem öffnen?`
      : 'Online nichts Verlässliches gefunden — ohne zu raten.';

  const promptBlock = [
    '=== OPEN WEB-AGENT (beliebige Websites) ===',
    `Stadt/Kontext: ${city}`,
    frictionDomainHint(userText),
    dateValidationPromptBlock(),
    `Schritte: ${steps.map((s) => s.action + (s.url ? `(${s.url})` : '')).join(' → ')}`,
    notes ? `Notizen: ${notes}` : '',
    validated.length
      ? 'FAKTEN (datumsgeprüft):\n' +
        validated
          .map((f, i) => {
            const tag =
              f.plausibility === 'verified_current'
                ? 'VERIFIED'
                : f.plausibility === 'undated_uncertain'
                  ? 'UNCERTAIN — konjunktiv / Rezeption'
                  : f.plausibility === 'dated_current'
                    ? 'DATED_OK'
                    : f.plausibility;
            return (
              `${i + 1}) [${tag}] ${f.label}: ${f.value}` +
              `${f.time ? ` · ${f.time}` : ''}` +
              `${f.place ? ` · ${f.place}` : ''}` +
              `${f.sourceUrl ? ` · ${f.sourceUrl}` : ''}` +
              `${f.caveat ? ` · ⚠ ${f.caveat}` : ''}` +
              `${f.useConjunctive ? ' · SPRACHE: konjunktiv' : ''}`
            );
          })
          .join('\n')
      : 'Keine harten Fakten.',
    droppedOutdated.length
      ? 'IGNORIERT (veraltet):\n' +
        droppedOutdated
          .map((d) => `- ${d.label}: ${d.value} (${d.noticeDateIso ?? '?'})`)
          .join('\n')
      : '',
    sources.length
      ? 'QUELLEN:\n' + sources.map((s) => `- [${s.kind}] ${s.url}`).join('\n')
      : '',
    uniqueFails.length
      ? 'PROBLEME (ehrlich):\n' + uniqueFails.map((f) => `- ${f}`).join('\n')
      : '',
    formPrefill
      ? `FORMULAR: ${formPrefill.purpose} — User muss bestätigen (kein stilles Absenden).`
      : '',
    'LIMITS: Kein Login, kein CAPTCHA, kein echter DOM-Click in SPAs — Link-Follow + Form-Prefill + OPEN_URL.',
    'ANTWORT: Verifizierte Fakten direkt; undatierte Hinweise konjunktiv + „vor Ort nachfragen“; nichts erfinden (keine Rabatte/Zeiten ohne Beleg).',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    query: userText,
    city,
    facts: finalFacts,
    sources,
    formPrefill,
    failures: uniqueFails.slice(0, 10),
    researchNotes: [notes, ...steps.map((s) => s.note)].filter(Boolean).join(' · '),
    promptBlock,
    speechHint,
  };
}

export function webAgentToActions(result: WebResearchResult): QuickAction[] {
  const actions: QuickAction[] = [];
  if (result.formPrefill?.actionUrl) {
    actions.push({
      type: 'OPEN_URL',
      label: result.formPrefill.actionUrl.startsWith('mailto:')
        ? '✉️ Anfrage senden'
        : '📝 Formular / weiter',
      payload: { url: result.formPrefill.actionUrl },
    });
  }
  for (const s of result.sources.slice(0, 3)) {
    if (!/^https?:\/\//i.test(s.url)) continue;
    if (actions.some((a) => a.payload.url === s.url)) continue;
    actions.push({
      type: 'OPEN_URL',
      label:
        s.kind === 'pdf'
          ? '📄 PDF'
          : /ticket|buch|shop/i.test(s.url)
            ? '🎫 Tickets'
            : websiteActionLabel(s.title, s.url),
      payload: { url: s.url },
    });
  }
  return actions.slice(0, 4);
}
