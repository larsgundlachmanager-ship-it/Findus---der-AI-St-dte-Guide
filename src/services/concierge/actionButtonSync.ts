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
  // „in/bei/zur/zum/im X“ + Capitalized multi-word
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
  return [...new Set(places)].slice(0, 6);
}

function speechMentionsAction(speech: string, a: QuickAction): boolean {
  if (a.type === 'START_NAVIGATION') {
    const name = String(a.payload.destName || a.label || '');
    return namesAlign(speech, name);
  }
  if (a.type === 'OPEN_URL') {
    return speechJustifiesOpenUrl(speech, a.label, namesAlign);
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
      ? 4
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
    const syncedFromResearch = base.filter((a) => speechMentionsAction(speech, a));
    // Also keep Gemini actions that align
    const syncedFromGemini = actions.filter((a) => speechMentionsAction(speech, a));
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
    const base = webResearchToActions(web).filter((a) =>
      a.type !== 'OPEN_URL' ? true : speechMentionsAction(speech, a),
    );
    const merged: QuickAction[] = [];
    const seen = new Set<string>();
    for (const a of [...base, ...actions]) {
      if (a.type === 'OPEN_URL' && !speechMentionsAction(speech, a)) continue;
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
      if (a.type === 'OPEN_URL') return speechMentionsAction(speech, a);
      if (a.type !== 'START_NAVIGATION') return true;
      if (!mentioned.length) return true;
      const name = String(a.payload.destName || a.label);
      return mentioned.some((m) => namesAlign(m, name)) || namesAlign(speech, name);
    });
  }

  // Ensure at least one nav per mentioned researched venue (up to 2)
  if (research?.events.length) {
    for (const e of research.events.slice(0, 2)) {
      if (!namesAlign(speech, e.venue) && !namesAlign(speech, e.title)) continue;
      const has = actions.some(
        (a) =>
          a.type === 'START_NAVIGATION' && namesAlign(a.payload.destName || a.label, e.venue),
      );
      if (!has) {
        actions.unshift({
          type: 'START_NAVIGATION',
          label: shortenActionLabel(`📍 ${e.venue}`),
          payload: { destName: e.venue, targetPoiId: -1 },
        });
        notes.push(`added-nav:${e.venue}`);
      }
      if (e.infoUrl && !actions.some((a) => a.type === 'OPEN_URL' && a.payload.url === e.infoUrl)) {
        if (
          actions.length < maxActions &&
          speechJustifiesOpenUrl(
            speech,
            e.hasPdf ? '📄 PDF / Programm' : `Webseite: ${e.venue}`,
            namesAlign,
          )
        ) {
          actions.push({
            type: 'OPEN_URL',
            label: e.hasPdf
              ? '📄 PDF / Programm'
              : websiteActionLabel(e.venue, e.infoUrl),
            payload: { url: e.infoUrl },
          });
          notes.push('added-pdf-info');
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
        payload: { url: pdfEvent.infoUrl },
      });
      notes.push('extra-mile-pdf-button');
    }
  }

  actions = await ensureNavCoords(actions);
  actions = actions.map((a) => ({
    ...a,
    label: shortenActionLabel(a.label || a.type),
  }));
  actions = actions.slice(0, maxActions);

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
