/**
 * Action-Button Sync + Pre-Response Self-Reflection for Concierge.
 * Invariant: every START_NAVIGATION / event OPEN_URL must align with speechText.
 */

import type { GeminiConciergeResponse, QuickAction } from '../../types/concierge';
import { namesAlign } from './canonicalDestination';
import type { EventResearchResult } from './eventResearchService';
import { eventResearchToActions } from './eventResearchService';
import type { WebResearchResult } from '../research/webResearchService';
import { webResearchToActions } from '../research/webResearchService';
import { geocodePlaceNameOsmFirst } from '../navigation/googleMapsNav';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { stripUnbackedActions } from './zeroFakeActions';
import {
  speechJustifiesOpenUrl,
  websiteActionLabel,
} from './websiteActionLabel';
import {
  dialActionsFromPhones,
  extractPhoneNumbers,
  stripPermissionAsksWhenActionsReady,
} from './justDoItPolicy';
import { shortenActionLabel } from './actionLabelShorten';
import { getAllPois } from '../../db/database';
import type { Poi } from '../../db/types';
import { deriveMemoryBullets } from './speechMemoryBullets';
import { deriveHelpActionsFromSpeech } from './postSpeechActions';
import { clampVisualBullets } from './parseConciergeResponse';

const GENERIC_FORBIDDEN =
  /\b(kulturverwaltung|tourist[- ]?info|touristeninformation|stadtverwaltung|rathaus\b(?!\s+event)|kurverwaltung\b(?!\s*:))/iu;

function extractMentionedPlaces(speech: string): string[] {
  const t = speech.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const places: string[] = [];
  // „in/bei/zur/zum/im X“ + Capitalized multi-word — Monate/Daten nie als Ort
  const re =
    /\b(?:in|bei|zur|zum|im|auf|Richtung|Route(?:\s+zu)?)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,4})/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const p = m[1].replace(/[.,!?]+$/g, '').trim();
    if (p.length >= 3 && !/^(Heute|Abend|Uhr|Minuten)$/i.test(p)) {
      places.push(p);
    }
  }
  // Bare Proper Names that look like venues (Dicke Strandbar, Inselmarkt …)
  const bare =
    t.match(
      /\b((?:Dicke|Große|Kleine|Neue|Alte)\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-]+|(?:Strandbar|Beachbar|Beach\s*Bar|Inselmarkt|Tennis[- ]?Turnier|Kurhaus|Musikpavillon)[\wÄÖÜäöüß\-]*)\b/gu,
    ) ?? [];
  for (const b of bare) places.push(b.trim());
  const unique = [...new Set(places)];
  try {
    const { isMonthOrDateOnlyNavName, isBogusNavDestName } = require('../research/htmlResearchGate') as {
      isMonthOrDateOnlyNavName: (n: string) => boolean;
      isBogusNavDestName: (n: string) => boolean;
    };
    return unique
      .filter((p) => !isMonthOrDateOnlyNavName(p) && !isBogusNavDestName(p))
      .slice(0, 6);
  } catch {
    return unique.slice(0, 6);
  }
}

function speechMentionsAction(
  speech: string,
  a: QuickAction,
  research?: EventResearchResult | null,
): boolean {
  if (a.type === 'START_NAVIGATION') {
    const name = String(a.payload.destName || a.label || '');
    return namesAlign(speech, name);
  }
  if (a.type === 'OPEN_URL') {
    const url = String(a.payload.url ?? '');
    if (
      /kiwi\.com\/(?:de\/)?search|kiwi\.com\/deep|c111\.travelpayouts\.com|aviasales\.(?:tpx\.li|com)/i.test(
        url,
      )
    ) {
      return true;
    }
    if (speechJustifiesOpenUrl(speech, a.label, namesAlign)) return true;
    const entity = String(a.payload.entityName ?? '').trim();
    if (
      entity &&
      namesAlign(speech, entity) &&
      /ticket|pdf|programm|buchen|info|webseite|🌐|📄|🎫/i.test(a.label)
    ) {
      return true;
    }
    // Event-Turn: Venue/Titel in Speech → Ticket/PDF/Info behalten
    if (research?.events?.length) {
      const url = String(a.payload.url ?? '');
      const hit = research.events.some(
        (e) =>
          (namesAlign(speech, e.venue) || namesAlign(speech, e.title)) &&
          (Boolean(url) &&
            (url === e.infoUrl ||
              url === e.ticketUrl ||
              /ticket|pdf|programm|event|🎫|ℹ️|🌐|📄/i.test(a.label))),
      );
      if (hit) return true;
      if (
        research.events.some(
          (e) => namesAlign(speech, e.venue) || namesAlign(speech, e.title),
        ) &&
        /ticket|pdf|programm|buchen|info|webseite|navigation|🗺️|📍|🎫|🌐|📄/i.test(
          a.label,
        )
      ) {
        return true;
      }
    }
    return false;
  }
  return true;
}

async function lookupPackPoi(name: string): Promise<Poi | null> {
  const needle = name.trim().toLowerCase();
  if (needle.length < 3) return null;
  try {
    const pois = await getAllPois();
    const exact = pois.find((p) => p.name.toLowerCase() === needle);
    if (exact) return exact;
    const partial = pois.find((p) => {
      const n = p.name.toLowerCase();
      return (
        n.includes(needle.slice(0, 16)) ||
        needle.includes(n.slice(0, 16)) ||
        (/bahnhof|haltepunkt/.test(needle) && /bahnhof|haltepunkt/.test(n))
      );
    });
    return partial ?? null;
  } catch {
    return null;
  }
}

async function ensureNavCoords(actions: QuickAction[]): Promise<QuickAction[]> {
  const store = useFinnusStore.getState();
  const profile = getCachedUserProfile();
  const out: QuickAction[] = [];
  for (const a of actions) {
    if (a.type !== 'START_NAVIGATION') {
      out.push(a);
      continue;
    }
    const name = String(
      a.payload.destName || a.label.replace(/^📍\s*(?:Route:\s*)?/u, ''),
    ).trim();
    if (
      typeof a.payload.destLat === 'number' &&
      typeof a.payload.destLng === 'number'
    ) {
      out.push({
        ...a,
        label: shortenActionLabel(a.label.startsWith('📍') ? a.label : `📍 ${name}`),
      });
      continue;
    }

    const packPoi = await lookupPackPoi(name);
    if (
      packPoi &&
      Number.isFinite(packPoi.lat) &&
      Number.isFinite(packPoi.lng)
    ) {
      out.push({
        ...a,
        label: shortenActionLabel(`📍 ${packPoi.name}`),
        payload: {
          ...a.payload,
          destName: packPoi.name,
          destLat: packPoi.lat,
          destLng: packPoi.lng,
          targetPoiId: packPoi.id,
        },
      });
      continue;
    }

    try {
      const geo = await geocodePlaceNameOsmFirst(name, {
        biasLat: store.lastGpsLat ?? undefined,
        biasLng: store.lastGpsLng ?? undefined,
        cityHint: profile?.cityName ?? null,
      });
      if (geo) {
        out.push({
          ...a,
          label: shortenActionLabel(`📍 ${name}`),
          payload: {
            ...a.payload,
            destName: name,
            destLat: geo.lat,
            destLng: geo.lng,
            targetPoiId: -1,
          },
        });
        continue;
      }
    } catch {
      /* keep */
    }
    out.push({
      ...a,
      label: shortenActionLabel(`📍 ${name}`),
      payload: { ...a.payload, destName: name },
    });
  }
  return out;
}

export type ReflectionResult = {
  response: GeminiConciergeResponse;
  maxActions: number;
  notes: string[];
};

/**
 * Self-reflection + button sync before present.
 */
export async function reflectAndSyncConciergeActions(
  response: GeminiConciergeResponse,
  opts?: {
    eventResearch?: EventResearchResult | null;
    webResearch?: WebResearchResult | null;
    userText?: string;
  },
): Promise<ReflectionResult> {
  const notes: string[] = [];
  let speech = response.speechText.trim();
  let actions = [...response.quickActions];
  const research = opts?.eventResearch ?? null;
  const web = opts?.webResearch ?? null;
  const maxActions =
    research?.events?.length || web?.sources?.length || web?.facts?.length
      ? 5
      : 3;

  // 1) Relevance: event query must not be generic-only
  if (research) {
    if (GENERIC_FORBIDDEN.test(speech) && !research.events.length) {
      notes.push('generic-forbidden-without-events');
    }
    if (research.events.length && GENERIC_FORBIDDEN.test(speech) && speech.length < 80) {
      // Prefer researched fallback speech
      const { synthesizeEventSpeech } = await import('./eventResearchService');
      speech = synthesizeEventSpeech(research);
      notes.push('replaced-generic-with-research-speech');
    }
    if (
      research.events.length &&
      !research.events.some(
        (e) => namesAlign(speech, e.venue) || namesAlign(speech, e.title),
      )
    ) {
      const { synthesizeEventSpeech } = await import('./eventResearchService');
      speech = synthesizeEventSpeech(research);
      notes.push('speech-missed-researched-venues');
    }
  }

  // Web research: empty/generic speech → use speechHint
  if (web && (!speech || speech.length < 24) && web.speechHint) {
    speech = web.speechHint;
    notes.push('web-research-speech-hint');
  }

  // 2) Button sync: drop actions not mentioned; add missing from research/speech
  if (research?.events.length) {
    const base = eventResearchToActions(research);
    // Keep only actions that align with NEW speech (after possible rewrite)
    const syncedFromResearch = base.filter((a) =>
      speechMentionsAction(speech, a, research),
    );
    // Also keep Gemini actions that align
    const syncedFromGemini = actions.filter((a) =>
      speechMentionsAction(speech, a, research),
    );
    const merged: QuickAction[] = [];
    const seen = new Set<string>();
    for (const a of [...syncedFromResearch, ...syncedFromGemini]) {
      const key = `${a.type}:${a.payload.url ?? ''}:${a.payload.destName ?? a.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(a);
    }
    actions = merged;
    notes.push(`event-sync actions=${actions.length}`);
  } else if (web && (web.facts.length || web.sources.length || web.formPrefill)) {
    let keepFerryUrl = false;
    try {
      const { wantsFerryOperatorSite } = require('../transit/ferryTicketResearch') as {
        wantsFerryOperatorSite: (s: string) => boolean;
      };
      keepFerryUrl = wantsFerryOperatorSite(opts?.userText || '');
    } catch {
      keepFerryUrl = false;
    }
    const base = webResearchToActions(web).filter((a) =>
      a.type !== 'OPEN_URL'
        ? true
        : keepFerryUrl || speechMentionsAction(speech, a, null),
    );
    const merged: QuickAction[] = [];
    const seen = new Set<string>();
    for (const a of [...base, ...actions]) {
      if (
        a.type === 'OPEN_URL' &&
        !keepFerryUrl &&
        !speechMentionsAction(speech, a, null)
      ) {
        continue;
      }
      const key = `${a.type}:${a.payload.url ?? ''}:${a.payload.destName ?? a.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(a);
    }
    actions = merged;
    notes.push(`web-sync actions=${actions.length} fails=${web.failures.length}`);
  } else {
    // Strip nav chips for places not in speech; OPEN_URL nur mit Spoken-Grund
    const mentioned = extractMentionedPlaces(speech);
    actions = actions.filter((a) => {
      if (a.type === 'OPEN_URL') return speechMentionsAction(speech, a, null);
      if (a.type !== 'START_NAVIGATION') return true;
      if (!mentioned.length) return true;
      const name = String(a.payload.destName || a.label);
      return mentioned.some((m) => namesAlign(m, name)) || namesAlign(speech, name);
    });
  }

  // Event: Mehrfach-Pitch ohne Route; Briefing/Follow-up/Einzelfest → Nav + Programm
  if (research?.events.length) {
    let namedSchedule = false;
    try {
      const { looksLikeNamedScheduleQuery } = require('./sportsScheduleQuery') as {
        looksLikeNamedScheduleQuery: (s: string) => boolean;
      };
      namedSchedule = looksLikeNamedScheduleQuery(opts?.userText || '');
    } catch {
      namedSchedule = false;
    }
    const briefing =
      !namedSchedule &&
      (research.events.length === 1 ||
        (() => {
          try {
            const {
              wantsEventBriefingActions,
              isEventFestivalDeepenQuery,
            } = require('./eventResearchService') as {
              wantsEventBriefingActions: (s: string) => boolean;
              isEventFestivalDeepenQuery: (s: string) => boolean;
            };
            const ut = opts?.userText || '';
            return wantsEventBriefingActions(ut) || isEventFestivalDeepenQuery(ut);
          } catch {
            return false;
          }
        })());
    if (!briefing || namedSchedule) {
      actions = actions.filter((a) => a.type !== 'START_NAVIGATION');
    }
    // Monat/Datum nie als Nav behalten (auch aus LLM-Chips)
    try {
      const { isMonthOrDateOnlyNavName, isBogusNavDestName } = require('../research/htmlResearchGate') as {
        isMonthOrDateOnlyNavName: (n: string) => boolean;
        isBogusNavDestName: (n: string) => boolean;
      };
      actions = actions.filter((a) => {
        if (a.type !== 'START_NAVIGATION') return true;
        const dest = String(a.payload.destName || a.label || '');
        return !isMonthOrDateOnlyNavName(dest) && !isBogusNavDestName(dest);
      });
    } catch {
      /* soft */
    }
    for (const e of research.events.slice(0, briefing || namedSchedule ? 1 : 2)) {
      const titleCore = e.title.split(/[|/·•–—]/)[0]?.trim() || e.title;
      if (
        !namesAlign(speech, e.venue) &&
        !namesAlign(speech, e.title) &&
        !namesAlign(speech, titleCore)
      ) {
        continue;
      }
      if (e.ticketUrl && !actions.some((a) => a.payload.url === e.ticketUrl)) {
        if (actions.length >= maxActions) {
          const infoIdx = actions.findIndex(
            (a) =>
              a.type === 'OPEN_URL' &&
              a.payload.url === e.infoUrl &&
              a.payload.url !== e.ticketUrl,
          );
          if (infoIdx >= 0) actions.splice(infoIdx, 1);
        }
        if (actions.length < maxActions) {
          actions.push({
            type: 'OPEN_URL',
            label: shortenActionLabel(`🎫 ${e.title}`),
            payload: {
              url: e.ticketUrl,
              destName: e.venue,
              entityName: e.title,
            },
          });
          notes.push(`added-ticket:${e.title}`);
        }
      }
      if (
        !actions.some(
          (a) =>
            a.type === 'OPEN_URL' &&
            /programm|infos|website|pdf|spielplan/i.test(a.label),
        )
      ) {
        let programUrl: string | null = null;
        let programLabel = namedSchedule ? '📅 Spielplan' : '🌐 Programm';
        try {
          const {
            resolveEventProgramLink,
          } = require('../research/eventInfoUrl') as {
            resolveEventProgramLink: (o: {
              candidate?: string | null;
              ticketUrl?: string | null;
              hints: {
                title?: string | null;
                venue?: string | null;
                city?: string | null;
              };
              hasPdf?: boolean;
            }) => { url: string; label: string };
          };
          const link = resolveEventProgramLink({
            candidate: e.infoUrl,
            ticketUrl: e.ticketUrl,
            hints: {
              title: e.title,
              venue: e.venue,
              city: research.city,
            },
            hasPdf: e.hasPdf,
          });
          programUrl = link.url;
          programLabel = namedSchedule
            ? '📅 Spielplan'
            : link.label;
          if (namedSchedule && programUrl) {
            try {
              const {
                isClubOrActHomepageUrl,
              } = require('../actionBoard/scheduleDeepLink') as {
                isClubOrActHomepageUrl: (u: string) => boolean;
              };
              if (isClubOrActHomepageUrl(programUrl)) {
                programUrl = null;
              }
            } catch {
              /* soft */
            }
          }
        } catch {
          programUrl = e.infoUrl;
        }
        if (programUrl && actions.length < maxActions) {
          actions.unshift({
            type: 'OPEN_URL',
            label: shortenActionLabel(programLabel),
            payload: {
              url: programUrl,
              destName: e.venue,
              entityName: e.title,
            },
          });
          notes.push('added-program-link');
        }
      }
      if (
        briefing &&
        !namedSchedule &&
        e.lat != null &&
        e.lng != null &&
        !actions.some((a) => a.type === 'START_NAVIGATION')
      ) {
        if (actions.length >= maxActions) {
          const mapsIdx = actions.findIndex(
            (a) =>
              a.type === 'OPEN_URL' &&
              /maps\.google|🗺️/i.test(`${a.label} ${a.payload.url ?? ''}`),
          );
          if (mapsIdx >= 0) actions.splice(mapsIdx, 1);
        }
        if (actions.length < maxActions) {
          actions.push({
            type: 'START_NAVIGATION',
            label: shortenActionLabel('📍 Navigation starten'),
            payload: {
              destName: e.venue,
              destLat: e.lat,
              destLng: e.lng,
            },
          });
          notes.push('added-event-nav');
        }
      }
    }
  }

  // Labels vorbereiten — Koordinaten final nach Post-Speech
  actions = actions.map((a) => ({
    ...a,
    label: shortenActionLabel(a.label || a.type),
  }));

  // Telefon aus Speech/Research → DIAL_PHONE (nicht „Soll ich die Nummer suchen?“)
  const phonePool = [
    speech,
    ...(web?.facts ?? []).map((f) => `${f.label} ${f.value}`),
    ...(web?.sources ?? []).map((s) => s.title ?? ''),
    ...(research?.events ?? []).map((e) => `${e.title} ${e.venue}`),
  ].join(' ');
  const phones = extractPhoneNumbers(phonePool);
  if (phones.length) {
    const existing = new Set(
      actions
        .filter((a) => a.type === 'DIAL_PHONE')
        .map((a) => (a.payload.phoneNumber ?? '').replace(/\D/g, '')),
    );
    for (const dial of dialActionsFromPhones(phones)) {
      const key = (dial.payload.phoneNumber ?? '').replace(/\D/g, '');
      if (existing.has(key)) continue;
      if (actions.length >= maxActions) break;
      actions.push(dial);
      existing.add(key);
      notes.push(`dial:${key.slice(-4)}`);
    }
  }

  speech = stripPermissionAsksWhenActionsReady(speech, actions);
  if (!speech) {
    speech = response.speechText.trim();
  }

  // 2b) POST-SPEECH: Text steht — Buttons/Stichpunkte aus dem Gesagten ableiten
  try {
    const help = await deriveHelpActionsFromSpeech({
      speech,
      userText: opts?.userText,
      existing: actions,
      webResearch: web,
      eventResearch: research,
      maxActions,
    });
    actions = help.actions;
    notes.push(...help.notes);
  } catch (err) {
    notes.push('post-speech-actions-failed');
    if (__DEV__) console.warn('[actionButtonSync] post-speech', err);
  }

  // Offene Shopping-Todos: bei Abreise / „wo hin“ Abhaken-Buttons anbieten
  if (
    /\b(abreisen|abreise|verlassen|wo\s+hin|wohin|los\s+muss|noch\s+offen|to[\s-]?do|erledigen)\b/iu.test(
      speech,
    ) ||
    /\b(abreisen|abreise|verlassen|wo\s+hin|wohin|los\s+muss)\b/iu.test(
      response.speechText,
    )
  ) {
    try {
      const { useShoppingTaskStore } = await import(
        '../../store/useShoppingTaskStore'
      );
      const open = useShoppingTaskStore.getState().getOpenTasks().slice(0, 2);
      for (const t of open) {
        if (actions.length >= maxActions) break;
        if (
          actions.some(
            (x) =>
              x.type === 'COMPLETE_SHOPPING_TASK' &&
              x.payload.taskId === t.id,
          )
        ) {
          continue;
        }
        actions.push({
          type: 'COMPLETE_SHOPPING_TASK',
          label: shortenActionLabel(`✅ ${t.itemLabel}`),
          payload: { taskId: t.id },
        });
        notes.push(`todo-check:${t.id}`);
      }
    } catch {
      /* ignore */
    }
  }

  // 3) Extra-mile: PDF only if speech actually points the user to it
  if (research) {
    const pdfEvent = research.events.find((e) => e.hasPdf && e.infoUrl);
    if (
      pdfEvent?.infoUrl &&
      /\b(pdf|programm|flyer)\b/iu.test(speech) &&
      !actions.some((a) => a.type === 'OPEN_URL' && /pdf|programm|flyer/i.test(a.label))
    ) {
      if (actions.length >= maxActions) actions.pop();
      actions.push({
        type: 'OPEN_URL',
        label: shortenActionLabel('📄 PDF'),
        payload: {
          url: pdfEvent.infoUrl,
          destName: pdfEvent.venue,
          entityName: pdfEvent.title,
        },
      });
      notes.push('extra-mile-pdf-button');
    }
  }

  actions = await ensureNavCoords(actions);
  // Maps nur mit Ortsnamen; Programm: Event-Titel (entityName), nie Venue-as-Title / Label
  try {
    const {
      isCoordsOnlyMapsUrl,
      isEstablishedGoogleMapsPlaceUrl,
      resolveEventInfoUrl,
      keepFoundEventUrl,
      rewriteGoogleMapsOpenUrl,
      sanitizeMapsPlaceQuery,
    } = require('../research/eventInfoUrl') as {
      isCoordsOnlyMapsUrl: (u: string | null | undefined) => boolean;
      isEstablishedGoogleMapsPlaceUrl: (u: string | null | undefined) => boolean;
      resolveEventInfoUrl: (o: {
        candidate?: string | null;
        hints: {
          title?: string | null;
          venue?: string | null;
          city?: string | null;
        };
      }) => string | null;
      keepFoundEventUrl: (u: string | null | undefined) => string | null;
      rewriteGoogleMapsOpenUrl: (o: {
        url: string;
        destName?: string | null;
        entityName?: string | null;
      }) => string;
      sanitizeMapsPlaceQuery: (s: string | null | undefined) => string | null;
    };
    actions = actions.filter((a) => {
      if (a.type !== 'OPEN_URL' || !a.payload?.url) return true;
      const url = a.payload.url;
      if (/maps\.google|google\.[^/\s]+\/maps|maps\.app\.goo\.gl/i.test(url)) {
        if (isCoordsOnlyMapsUrl(url) || !isEstablishedGoogleMapsPlaceUrl(url)) {
          notes.push('dropped-unlisted-maps');
          return false;
        }
        const place =
          sanitizeMapsPlaceQuery(a.payload.destName) ||
          sanitizeMapsPlaceQuery(a.payload.entityName);
        a.payload.url = rewriteGoogleMapsOpenUrl({
          url,
          destName: a.payload.destName,
          entityName: a.payload.entityName,
        });
        if (place) {
          a.payload.destName = place.replace(/\s*@[\d.,\s-]+$/, '').trim() || place;
        }
        return true;
      }
      if (/programm|website|🌐|📄/i.test(a.label || '')) {
        const fromResearch = research?.events.find(
          (e) =>
            e.infoUrl === url ||
            e.ticketUrl === url ||
            (a.payload.entityName &&
              e.title.toLowerCase() === a.payload.entityName.toLowerCase()),
        );
        const title =
          a.payload.entityName ||
          fromResearch?.title ||
          null;
        const venue =
          a.payload.destName ||
          fromResearch?.venue ||
          null;
        // Nie Button-Label („🌐 Programm“) als Titel-Hint — das matched falsche /programm-Seiten
        if (title || venue) {
          const ok = resolveEventInfoUrl({
            candidate: url,
            hints: {
              title: title || venue,
              venue: venue || title,
              city: research?.city ?? null,
            },
          });
          if (ok) {
            a.payload.url = ok;
            if (title && !a.payload.entityName) a.payload.entityName = title;
            if (venue && !a.payload.destName) a.payload.destName = venue;
            return true;
          }
          notes.push('dropped-unmatched-program-url');
          return false;
        }
        // Legacy ohne Titel: nur Junk/Listing raus
        const kept = keepFoundEventUrl(url);
        if (!kept) {
          notes.push('dropped-junk-program-url');
          return false;
        }
        a.payload.url = kept;
      }
      return true;
    });
  } catch {
    /* soft */
  }
  actions = actions.map((a) => ({
    ...a,
    label: shortenActionLabel(a.label || a.type),
  }));
  actions = actions.slice(0, maxActions);

  try {
    const { resolveLiveOpenUrlActions } = require('../research/liveDeepLink') as {
      resolveLiveOpenUrlActions: (
        acts: QuickAction[],
        o?: {
          extraCandidates?: Array<{ url: string; verified?: boolean }>;
          userText?: string | null;
          city?: string | null;
        },
      ) => Promise<{ actions: QuickAction[]; notes: string[] }>;
    };
    const extra: Array<{ url: string; verified?: boolean }> = [];
    for (const s of web?.sources ?? []) {
      extra.push({
        url: s.url,
        verified: s.kind === 'html' || s.kind === 'pdf',
      });
    }
    for (const f of web?.facts ?? []) {
      if (f.sourceUrl) extra.push({ url: f.sourceUrl });
    }
    for (const e of research?.events ?? []) {
      if (e.infoUrl) extra.push({ url: e.infoUrl });
      if (e.ticketUrl) extra.push({ url: e.ticketUrl });
    }
    const live = await resolveLiveOpenUrlActions(actions, {
      extraCandidates: extra,
      userText: opts?.userText,
      city: research?.city ?? web?.city ?? null,
    });
    actions = live.actions;
    notes.push(...live.notes);
  } catch (err) {
    notes.push('live-deeplink-failed');
    if (__DEV__) console.warn('[actionButtonSync] liveDeepLink', err);
  }

  const researchBullets =
    research?.events.length
      ? research.events.slice(0, 3).map((e) => {
          const t = e.startTime ? `${e.startTime} · ` : '';
          return `${t}${e.title} @ ${e.venue}`;
        })
        : web?.facts.length
        ? web.facts
            .slice(0, 3)
            .map((f) => {
              const value = String(f.value ?? '').trim();
              const label = String(f.label ?? '').trim();
              if (!value || /ausgeschrieben/i.test(value)) return null;
              if (/[:：]\s*$/.test(label) && !/\d/.test(value)) return null;
              const bits = [label, value].filter(Boolean);
              if (f.time) bits.push(f.time);
              if (f.place) bits.push(f.place);
              const line = bits.join(' · ');
              if (
                /\b(höhe|stufen|eintritt|preis)\b/iu.test(line) &&
                !/\d/.test(line)
              ) {
                return null;
              }
              return line;
            })
            .filter((x): x is string => Boolean(x))
        : [];

  const bullets = clampVisualBullets(
    deriveMemoryBullets(speech, [...(response.visualBullets ?? []), ...researchBullets], {
      userText: opts?.userText,
      factBlock: web?.promptBlock ?? null,
    }),
    { userText: opts?.userText },
  );
  notes.push(`memory-bullets=${bullets.length}`);

  return {
    response: {
      ...response,
      speechText: speech,
      visualBullets: bullets,
      quickActions: stripUnbackedActions(actions),
      cardTitle:
        response.cardTitle ||
        (research
          ? 'Heute vor Ort'
          : web
            ? 'Recherche'
            : undefined),
    },
    maxActions,
    notes,
  };
}
