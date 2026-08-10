/**
 * Tagesaktuelle Event-Recherche (Web/PDF/Flyer via Gemini Google Search).
 * Keine generischen „Kulturverwaltung“-Platzhalter — nur konkrete heutige Events.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { isDeviceOffline } from '../navigation/networkState';
import { getCachedUserProfile } from '../userProfileService';
import { useFinnusStore } from '../../store/useFinnusStore';
import type { QuickAction } from '../../types/concierge';
import type { PendingNavOffer } from '../navigation/navigationTypes';
import { shortenActionLabel } from './actionLabelShorten';

export type ResearchedEvent = {
  title: string;
  venue: string;
  startTime: string | null;
  summary: string;
  /** Official / flyer / PDF URL if found */
  infoUrl: string | null;
  /** Ticket / booking URL if found */
  ticketUrl: string | null;
  /** Whether a PDF/flyer was cited */
  hasPdf: boolean;
  sourceHint: string | null;
  /**
   * Quellen-Vertrauen 0–1 (PDF/Ticket/Venue-Site > vager Hinweis).
   * Speech/Buttons priorisieren hohe Werte; niedrige ehrlich relativieren.
   */
  sourceTrust: number;
};

export type EventResearchResult = {
  dateLabel: string;
  city: string;
  events: ResearchedEvent[];
  researchNotes: string;
  promptBlock: string;
  /** Suggested nav offers for venues (geocode later) */
  venueOffers: PendingNavOffer[];
};

const EVENT_QUERY_RE =
  /\b(was\s+(heute\s+)?geht|was\s+geht\s+heute|was\s+läuft\s+heute|was\s+laeuft\s+heute|was\s+ist\s+(heute\s+)?los|heute\s+abend|heut\s+abend|events?|veranstaltung|veranstaltungen|programm|party|konzert|live\s*musik|dj|festival|turnier|wochenprogramm|was\s+geht\s+(heute\s+)?abend|abendprogramm|ausgehen|nightlife|nachtleben)\b/iu;

export function isEventResearchQuery(text: string): boolean {
  return EVENT_QUERY_RE.test(text.replace(/\s+/g, ' ').trim());
}

function todayDe(): string {
  return new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

import { scoreSourceTrust } from '../research/sourceTrust';

function scoreEventSourceTrust(e: {
  infoUrl: string | null;
  ticketUrl: string | null;
  hasPdf: boolean;
  sourceHint: string | null;
  startTime: string | null;
  summary: string;
}): number {
  return scoreSourceTrust({
    url: e.infoUrl,
    ticketUrl: e.ticketUrl,
    hasPdf: e.hasPdf,
    sourceHint: e.sourceHint,
    hasTime: Boolean(e.startTime),
    detailLen: e.summary.trim().length,
  });
}

function asEvents(data: unknown): ResearchedEvent[] {
  if (!data || typeof data !== 'object') return [];
  const root = data as { events?: unknown[] };
  if (!Array.isArray(root.events)) return [];
  const out: ResearchedEvent[] = [];
  for (const row of root.events) {
    if (!row || typeof row !== 'object') continue;
    const e = row as Record<string, unknown>;
    const title = String(e.title ?? e.name ?? '').trim();
    const venue = String(e.venue ?? e.location ?? e.place ?? '').trim();
    if (title.length < 3 && venue.length < 3) continue;
    const infoUrl =
      typeof e.infoUrl === 'string' && /^https?:\/\//i.test(e.infoUrl)
        ? e.infoUrl
        : typeof e.pdfUrl === 'string' && /^https?:\/\//i.test(e.pdfUrl)
          ? e.pdfUrl
          : typeof e.url === 'string' && /^https?:\/\//i.test(e.url)
            ? e.url
            : null;
    const ticketUrl =
      typeof e.ticketUrl === 'string' && /^https?:\/\//i.test(e.ticketUrl)
        ? e.ticketUrl
        : null;
    const hasPdf =
      Boolean(e.hasPdf) ||
      /\.pdf(\?|$)/i.test(infoUrl ?? '') ||
      /pdf|flyer|programm/i.test(String(e.sourceHint ?? ''));
    const startTime =
      typeof e.startTime === 'string' && e.startTime.trim()
        ? e.startTime.trim()
        : null;
    const summary = String(e.summary ?? e.detail ?? '').trim().slice(0, 220);
    const sourceHint =
      typeof e.sourceHint === 'string' ? e.sourceHint.slice(0, 120) : null;
    const sourceTrust = scoreEventSourceTrust({
      infoUrl,
      ticketUrl,
      hasPdf,
      sourceHint,
      startTime,
      summary,
    });
    out.push({
      title: title || venue,
      venue: venue || title,
      startTime,
      summary,
      infoUrl,
      ticketUrl,
      hasPdf,
      sourceHint,
      sourceTrust,
    });
  }
  return out.sort((a, b) => b.sourceTrust - a.sourceTrust).slice(0, 4);
}

/**
 * Live research for today's local program (calendars, news, PDF flyers, venue sites).
 */
export async function researchTodaysEvents(
  userText: string,
): Promise<EventResearchResult | null> {
  if (!isEventResearchQuery(userText)) return null;
  const offline = await isDeviceOffline();
  if (offline || !hasGeminiApiKey()) return null;

  const store = useFinnusStore.getState();
  const city =
    getCachedUserProfile()?.cityName?.trim() ||
    store.currentLocationName?.trim() ||
    'Wangerooge';
  const dateLabel = todayDe();
  const dateIso = todayIso();

  const prompt = [
    `Du bist ein hyperlokaler Event-Researcher für ${city}.`,
    `HEUTE ist ${dateLabel} (ISO ${dateIso}).`,
    `User-Frage: „${userText.trim().slice(0, 200)}“`,
    '',
    'AUFGABE: Recherche mit Google Search — finde TATSÄCHLICHE Events/Programme für HEUTE (oder heute Abend), nicht generische Orte.',
    'Quellen priorisieren: lokale Eventkalender, Kurverwaltung/Tourismus, Wochenprogramm-PDFs, Flyer, Strandbar-/Venue-Websites, Lokalzeitung, Gemeindeblatt, Facebook-Events der Locations (nur mit klarem Heute-Bezug).',
    `KLEINORT-EXTRA (Stadt „${city}“): Wenn wenig Treffer — aktiv nach „${city} Wochenprogramm“, „${city} Veranstaltungen heute“, „${city} Strandbar Programm“, PDF-Flyer und Kurhaus/Kurverwaltung suchen. Lieber 1–2 belegte Events als 4 vage.`,
    'Für jede Location: was läuft KONKRET heute (DJ, Party-Name, Sunset, Live-Musik, Turnier) + Uhrzeit + Eintritt wenn bekannt.',
    'Wenn ein PDF/Flyer/Wochenprogramm gefunden wird: URL mitnehmen (hasPdf=true).',
    'VERBOTEN: nur „Kulturverwaltung“, „Tourist-Info“, Bars ohne heutiges Programm nennen.',
    'Wenn wirklich nichts gefunden: events=[] und researchNotes ehrlich.',
    '',
    'Antworte NUR mit JSON (kein Markdown außerhalb):',
    '{',
    '  "researchNotes": "kurz was du geprüft hast",',
    '  "events": [',
    '    {',
    '      "title": "Event-Name",',
    '      "venue": "Ort/Location",',
    '      "startTime": "20:00" | null,',
    '      "summary": "1 Satz was passiert",',
    '      "infoUrl": "https://..." | null,',
    '      "ticketUrl": "https://..." | null,',
    '      "hasPdf": true|false,',
    '      "sourceHint": "z.B. Wochenprogramm PDF / Strandbar Website"',
    '    }',
    '  ]',
    '}',
    'Max 4 events. Nur belegte heutige Sachen.',
  ].join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      enableGoogleSearch: true,
      maxTokens: 1200,
      temperature: 0.25,
      useFindusSystem: false,
    });
    const parsed = extractJsonObject(raw);
    const events = asEvents(parsed);
    const notes =
      parsed && typeof parsed === 'object' && 'researchNotes' in parsed
        ? String((parsed as { researchNotes?: string }).researchNotes ?? '')
        : '';

    const venueOffers: PendingNavOffer[] = events.map((e, i) => ({
      poiId: -(9000 + i),
      name: e.venue,
      lat: store.lastGpsLat ?? undefined,
      lng: store.lastGpsLng ?? undefined,
    }));

    const promptBlock = [
      '=== TAGESAKTUELLE EVENT-RECHERCHE (PFLICHT) ===',
      `Stadt: ${city} · Datum: ${dateLabel}`,
      notes ? `Research-Notizen: ${notes}` : '',
      events.length
        ? events
            .map(
              (e, i) =>
                `${i + 1}) ${e.title} @ ${e.venue}` +
                `${e.startTime ? ` · Start ${e.startTime}` : ''}` +
                `${e.summary ? ` — ${e.summary}` : ''}` +
                `${e.infoUrl ? ` · Info/PDF: ${e.infoUrl}` : ''}` +
                `${e.ticketUrl ? ` · Ticket: ${e.ticketUrl}` : ''}` +
                `${e.hasPdf ? ' · PDF/Flyer' : ''}` +
                `${e.sourceHint ? ` · Quelle: ${e.sourceHint}` : ''}` +
                ` · Vertrauen ${Math.round(e.sourceTrust * 100)}%`,
            )
            .join('\n')
        : 'Keine belegten heutigen Events gefunden — ehrlich sagen, Alternativen kurz anbieten (ohne Fake-Programm).',
      '',
      'ANTWORT-REGELN:',
      '- speechText: 2–3 KONKRETE heutige Events mit Uhrzeit/was passiert — höchste Quellen-Vertrauen zuerst.',
      '- Bei Vertrauen <50%: als Hinweis formulieren („laut … / scheint …“), nicht als harte Tatsache.',
      '- quickActions MÜSSEN exakt zu den genannten Orten/Links passen:',
      '  START_NAVIGATION Label „📍 Route: <Venue>“ für genannte Locations,',
      '  OPEN_URL für PDF/Flyer („📄 PDF Programm“) und Tickets („🎫 Tickets“ / Affiliate-Buchen).',
      '- 3–4 Buttons erlaubt wenn hilfreich. Keine fremden Orte als Buttons.',
      '- Extra-Mile: PDF/Flyer erwähnen wenn in der Recherche vorhanden.',
    ]
      .filter(Boolean)
      .join('\n');

    void noteEventVenuesForCollective(city, events);

    return {
      dateLabel,
      city,
      events,
      researchNotes: notes,
      promptBlock,
      venueOffers,
    };
  } catch (err) {
    if (__DEV__) console.warn('[eventResearch] failed', err);
    return null;
  }
}

async function noteEventVenuesForCollective(
  city: string,
  events: ResearchedEvent[],
): Promise<void> {
  try {
    const { contributePlacesFromResearchResult } = await import(
      '../memory/collectiveLearning'
    );
    contributePlacesFromResearchResult({
      query: 'events today',
      city,
      venues: events.map((e) => ({
        name: e.venue,
        factText: `${e.title}${e.startTime ? ` · ${e.startTime}` : ''}`.slice(
          0,
          400,
        ),
        sourceUrl: e.infoUrl || e.ticketUrl,
        sourceTrust: Math.max(0.4, e.sourceTrust || 0.45),
        placeType: 'venue',
      })),
    });
  } catch {
    /* soft */
  }
}

/** Build deterministic quick actions from researched events (speech sync base). */
export function eventResearchToActions(
  research: EventResearchResult,
): QuickAction[] {
  const actions: QuickAction[] = [];
  const ranked = [...research.events].sort(
    (a, b) => b.sourceTrust - a.sourceTrust,
  );
  // Just-Do-It: zuerst 2 Routen zu den empfohlenen Locations
  for (const e of ranked.slice(0, 2)) {
    actions.push({
      type: 'START_NAVIGATION',
      label: shortenActionLabel(`📍 ${e.venue}`),
      payload: {
        destName: e.venue,
        targetPoiId: -1,
      },
    });
  }
  for (const e of ranked.slice(0, 3)) {
    if (e.infoUrl && actions.length < 4) {
      actions.push({
        type: 'OPEN_URL',
        label: shortenActionLabel(
          e.hasPdf ? '📄 PDF' : `ℹ️ ${e.title}`,
        ),
        payload: { url: e.infoUrl },
      });
    }
    // Ein-Tap-Buchung: echte Ticket-URL zuerst, sonst Affiliate-Deep-Link
    if (actions.length < 4) {
      if (e.ticketUrl) {
        actions.push({
          type: 'OPEN_URL',
          label: shortenActionLabel('🎫 Jetzt buchen'),
          payload: { url: e.ticketUrl },
        });
      } else if (e.sourceTrust >= 0.45) {
        try {
          const { buildTourBookingAction } = require('../affiliate/affiliateService') as {
            buildTourBookingAction: (input: {
              kind?: 'attraction' | 'generic';
              query?: string;
              city?: string;
            }) => {
              type: 'OPEN_URL' | 'OPEN_GYG_WIDGET';
              label: string;
              payload: { url?: string; gygTourSlug?: string; gygLocationId?: string };
            };
          };
          const book = buildTourBookingAction({
            kind: 'attraction',
            query: `${e.title} ${e.venue} ${research.city}`.trim(),
            city: research.city,
          });
          if (book.type === 'OPEN_URL' && book.payload.url) {
            actions.push({
              type: 'OPEN_URL',
              label: shortenActionLabel('🎫 Jetzt buchen'),
              payload: { url: book.payload.url },
            });
          } else if (book.type === 'OPEN_GYG_WIDGET') {
            actions.push({
              type: 'OPEN_GYG_WIDGET',
              label: shortenActionLabel(book.label || '🎫 Jetzt buchen'),
              payload: book.payload,
            });
          }
        } catch {
          /* soft */
        }
      }
    }
  }
  if (ranked.length >= 1 && actions.length < 4) {
    actions.push({
      type: 'SHOW_MORE',
      label: shortenActionLabel('✨ Mehr'),
      payload: {
        textPrompt:
          'Zeig mir noch zwei andere Party- oder Nightlife-Locations für heute Abend — mit Route-Buttons.',
      },
    });
  }
  return actions.slice(0, 4);
}

export function synthesizeEventSpeech(research: EventResearchResult): string {
  const ranked = [...research.events].sort(
    (a, b) => b.sourceTrust - a.sourceTrust,
  );
  if (!ranked.length) {
    return `Für heute in ${research.city} finde ich in den Kalendern gerade kein belegtes Programm. Sag mir gern Live-Musik, Strandbar oder Sport — dann such ich gezielter.`;
  }
  const soft = (e: ResearchedEvent) =>
    e.sourceTrust < 0.5
      ? `laut ${e.sourceHint || 'Programmhinweis'} `
      : '';
  const top = ranked.slice(0, 2);
  if (top.length === 1) {
    const e = top[0];
    const when = e.startTime ? ` ab ${e.startTime}` : '';
    return `Heute lohnt sich ${e.venue}${when}: ${soft(e)}${e.summary || e.title}. Route und Tickets sind bereit.`;
  }
  const a = top[0];
  const b = top[1];
  const aWhen = a.startTime ? ` ab ${a.startTime}` : '';
  const bWhen = b.startTime ? ` ab ${b.startTime}` : '';
  return (
    `An der Straße ist heute richtig was los — am besten diese beiden: ` +
    `${a.venue}${aWhen} (${soft(a)}${a.summary || a.title}) und ` +
    `${b.venue}${bWhen} (${soft(b)}${b.summary || b.title}). ` +
    `Route und Buchung sind einen Tap entfernt — welchen nehmen wir?`
  );
}
