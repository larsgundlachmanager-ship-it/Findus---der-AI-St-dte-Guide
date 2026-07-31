/**
 * Lang-Form Sprachnachricht → striktes Plan-JSON (Modul 5).
 * Transkript kommt von STT (Whisper/Device) oder Gemini-Audio-Pfad.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { todayDateKey } from '../../types/dayPlan';

export type LongFormDeadlineKind = 'train' | 'flight' | 'reservation' | 'other';

export type LongFormDeadline = {
  kind: LongFormDeadlineKind;
  label: string;
  /** lokal HH:MM */
  timeLocal: string | null;
  /** YYYY-MM-DD wenn erkennbar, sonst null */
  dateKey: string | null;
  flightOrTrainCode: string | null;
  confidence: 'high' | 'uncertain';
};

export type LongFormStop = {
  label: string;
  timeLocal: string | null;
  notes: string | null;
  confidence: 'high' | 'uncertain';
};

/** Zeitblock ohne erfundenen Ort (Bummeln, Shoppen, Freizeit). */
export type LongFormBlock = {
  label: string;
  /** morning | midday | afternoon | evening | null */
  window: string | null;
  timeLocal: string | null;
  durationMin: number | null;
  confidence: 'high' | 'uncertain';
};

export type LongFormTodo = {
  label: string;
  confidence: 'high' | 'uncertain';
};

export type LongFormPreference = {
  key: string;
  value: string;
  confidence: 'high' | 'uncertain';
};

export type LongFormPlanExtract = {
  city: string | null;
  hotelName: string | null;
  checkInLocal: string | null;
  checkOutLocal: string | null;
  deadlines: LongFormDeadline[];
  stops: LongFormStop[];
  blocks: LongFormBlock[];
  todos: LongFormTodo[];
  preferences: LongFormPreference[];
  summary: string;
  confirmSpeech: string;
  clarifyingQuestion: string | null;
};

export type LongFormExtractResult = {
  extract: LongFormPlanExtract;
  source: 'gemini' | 'heuristic';
  rawModelText?: string;
};

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function conf(v: unknown): 'high' | 'uncertain' {
  return String(v).toLowerCase() === 'high' ? 'high' : 'uncertain';
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normalizeExtract(data: Record<string, unknown>): LongFormPlanExtract {
  const deadlinesRaw = Array.isArray(data.deadlines) ? data.deadlines : [];
  const stopsRaw = Array.isArray(data.stops) ? data.stops : [];
  const blocksRaw = Array.isArray(data.blocks) ? data.blocks : [];
  const todosRaw = Array.isArray(data.todos) ? data.todos : [];
  const prefsRaw = Array.isArray(data.preferences) ? data.preferences : [];

  const deadlines: LongFormDeadline[] = deadlinesRaw
    .map((d) => {
      if (!d || typeof d !== 'object') return null;
      const o = d as Record<string, unknown>;
      const label = strOrNull(o.label);
      if (!label) return null;
      const kindRaw = String(o.kind ?? 'other').toLowerCase();
      const kind: LongFormDeadlineKind =
        kindRaw === 'train' ||
        kindRaw === 'flight' ||
        kindRaw === 'reservation'
          ? kindRaw
          : 'other';
      return {
        kind,
        label,
        timeLocal: strOrNull(o.timeLocal),
        dateKey: strOrNull(o.dateKey),
        flightOrTrainCode: strOrNull(o.flightOrTrainCode),
        confidence: conf(o.confidence),
      };
    })
    .filter(Boolean) as LongFormDeadline[];

  const stops: LongFormStop[] = stopsRaw
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const o = s as Record<string, unknown>;
      const label = strOrNull(o.label);
      if (!label) return null;
      return {
        label,
        timeLocal: strOrNull(o.timeLocal),
        notes: strOrNull(o.notes),
        confidence: conf(o.confidence),
      };
    })
    .filter(Boolean) as LongFormStop[];

  const blocks: LongFormBlock[] = blocksRaw
    .map((b) => {
      if (!b || typeof b !== 'object') return null;
      const o = b as Record<string, unknown>;
      const label = strOrNull(o.label);
      if (!label) return null;
      const dur =
        typeof o.durationMin === 'number' && Number.isFinite(o.durationMin)
          ? Math.max(15, Math.round(Number(o.durationMin)))
          : strOrNull(o.durationMin) != null
            ? Math.max(15, Number(o.durationMin) || 60)
            : null;
      return {
        label,
        window: strOrNull(o.window),
        timeLocal: strOrNull(o.timeLocal),
        durationMin: dur,
        confidence: conf(o.confidence),
      };
    })
    .filter(Boolean) as LongFormBlock[];

  const todos: LongFormTodo[] = todosRaw
    .map((t) => {
      if (!t || typeof t !== 'object') return null;
      const o = t as Record<string, unknown>;
      const label = strOrNull(o.label);
      if (!label) return null;
      return { label, confidence: conf(o.confidence) };
    })
    .filter(Boolean) as LongFormTodo[];

  const preferences: LongFormPreference[] = prefsRaw
    .map((p) => {
      if (!p || typeof p !== 'object') return null;
      const o = p as Record<string, unknown>;
      const key = strOrNull(o.key);
      const value = strOrNull(o.value);
      if (!key || !value) return null;
      return { key, value, confidence: conf(o.confidence) };
    })
    .filter(Boolean) as LongFormPreference[];

  const summary =
    strOrNull(data.summary) ??
    ([
      data.city ? `Stadt ${data.city}` : null,
      data.hotelName ? `Hotel ${data.hotelName}` : null,
      deadlines.length ? `${deadlines.length} Deadline(s)` : null,
      stops.length ? `${stops.length} Stop(s)` : null,
      blocks.length ? `${blocks.length} Block(s)` : null,
      todos.length ? `${todos.length} To-do(s)` : null,
    ]
      .filter(Boolean)
      .join(' · ') ||
      'Sprachnachricht ausgewertet');

  const confirmSpeech =
    strOrNull(data.confirmSpeech) ??
    buildDefaultConfirmSpeech({
      city: strOrNull(data.city),
      hotelName: strOrNull(data.hotelName),
      deadlines,
      stops,
      blocks,
      todos,
      clarifyingQuestion: strOrNull(data.clarifyingQuestion),
    });

  return {
    city: strOrNull(data.city),
    hotelName: strOrNull(data.hotelName),
    checkInLocal: strOrNull(data.checkInLocal),
    checkOutLocal: strOrNull(data.checkOutLocal),
    deadlines,
    stops,
    blocks,
    todos,
    preferences,
    summary,
    confirmSpeech,
    clarifyingQuestion: strOrNull(data.clarifyingQuestion),
  };
}

export function buildDefaultConfirmSpeech(parts: {
  city: string | null;
  hotelName: string | null;
  deadlines: LongFormDeadline[];
  stops: LongFormStop[];
  blocks?: LongFormBlock[];
  todos: LongFormTodo[];
  clarifyingQuestion: string | null;
}): string {
  const bits: string[] = [];
  const n =
    parts.deadlines.length +
    parts.stops.length +
    parts.todos.length +
    (parts.blocks?.length ?? 0);
  if (n > 0) {
    bits.push(
      `Ich habe ${n === 1 ? 'einen Punkt' : `${n} Punkte`} aus deiner Sprachnachricht vorbereitet.`,
    );
  } else {
    bits.push('Ich habe deine Sprachnachricht gehört.');
  }
  if (parts.hotelName) bits.push(`Hotel: ${parts.hotelName}.`);
  if (parts.city) bits.push(`Stadt: ${parts.city}.`);
  const uncertain =
    [
      ...parts.deadlines,
      ...parts.stops,
      ...parts.todos,
      ...(parts.blocks ?? []),
    ].find((x) => x.confidence === 'uncertain') ?? null;
  if (parts.clarifyingQuestion) {
    bits.push(parts.clarifyingQuestion);
  } else if (uncertain && 'timeLocal' in uncertain && !uncertain.timeLocal) {
    bits.push(`Um wie viel Uhr genau wolltest du zu „${uncertain.label}"?`);
  } else if (uncertain) {
    bits.push(`Stimmt „${uncertain.label}" so?`);
  } else {
    bits.push('Alles klar — passt das so?');
  }
  return bits.join(' ');
}

/** Offline-/Fallback-Heuristik wenn Gemini fehlt. */
export function heuristicLongFormExtract(transcript: string): LongFormPlanExtract {
  const t = transcript.replace(/\s+/g, ' ').trim();
  const deadlines: LongFormDeadline[] = [];
  const stops: LongFormStop[] = [];
  const blocks: LongFormBlock[] = [];
  const todos: LongFormTodo[] = [];
  const preferences: LongFormPreference[] = [];

  const clock = t.match(
    /\b(?:um\s+)?(\d{1,2})[:.](\d{2})\s*(?:uhr)?\b/iu,
  );
  const train = t.match(/\b(ICE|IC|RE|RB)\s*(\d{1,5})?\b/i);
  const flight = t.match(/\b(LH|EW|FR|BA|AF)\s?(\d{2,4})\b/i);
  if (train && clock) {
    deadlines.push({
      kind: 'train',
      label: `${train[0].toUpperCase()} ${clock[1]}:${clock[2]}`,
      timeLocal: `${clock[1]!.padStart(2, '0')}:${clock[2]}`,
      dateKey: todayDateKey(),
      flightOrTrainCode: train[0].replace(/\s+/g, '').toUpperCase(),
      confidence: 'uncertain',
    });
  } else if (flight && clock) {
    deadlines.push({
      kind: 'flight',
      label: `Flug ${flight[0].toUpperCase()} ${clock[1]}:${clock[2]}`,
      timeLocal: `${clock[1]!.padStart(2, '0')}:${clock[2]}`,
      dateKey: todayDateKey(),
      flightOrTrainCode: flight[0].replace(/\s+/g, '').toUpperCase(),
      confidence: 'uncertain',
    });
  }

  const hotel = t.match(
    /\b(?:hotel|hostel|pension)\s+([A-ZÄÖÜ][\wÄÖÜäöüß'&\-]+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß'&\-]+){0,3})/u,
  );
  const city = t.match(
    /\b(?:in|nach)\s+([A-ZÄÖÜ][a-zäöüß\-]+(?:\s+[A-ZÄÖÜ][a-zäöüß\-]+)?)\b/u,
  );

  if (/\bdeutschlandticket|d-?ticket\b/iu.test(t)) {
    preferences.push({
      key: 'transit_pass',
      value: 'Deutschlandticket',
      confidence: 'high',
    });
  }
  if (/\b(fahrrad|rad|bike)\b/iu.test(t)) {
    preferences.push({
      key: 'transport_mode',
      value: 'bike',
      confidence: 'uncertain',
    });
  }
  if (/\b(bummeln|spazieren|flanieren)\b/iu.test(t)) {
    blocks.push({
      label: 'Bummeln',
      window: /\bnachmittag/i.test(t)
        ? 'afternoon'
        : /\bvormittag|morgen\b/i.test(t)
          ? 'morning'
          : /\babend\b/i.test(t)
            ? 'evening'
            : null,
      timeLocal: null,
      durationMin: 60,
      confidence: 'high',
    });
  }
  if (/\b(shoppen|einkaufen|shopping)\b/iu.test(t)) {
    blocks.push({
      label: 'Shoppen',
      window: /\bnachmittag/i.test(t) ? 'afternoon' : null,
      timeLocal: null,
      durationMin: 90,
      confidence: 'uncertain',
    });
  }
  if (/\b(gutschein|muss\s+noch)\b/iu.test(t)) {
    todos.push({
      label: t.match(/\b(gutschein[^.]{0,40})\b/iu)?.[0] ?? 'Offener Punkt',
      confidence: 'uncertain',
    });
  }

  const clarifying =
    /\b(laden|abflug|fliegen)\b/iu.test(t) && !flight
      ? 'Hast du eine Flugnummer für mich?'
      : /\bshoppen|einkaufen\b/iu.test(t)
        ? 'Hast du was Spezielles im Kopf, wo und wann du shoppen möchtest?'
        : deadlines.some((d) => !d.timeLocal) || stops.some((s) => !s.timeLocal)
          ? 'Um wie viel Uhr genau war der Termin?'
          : null;

  return normalizeExtract({
    city: city?.[1] ?? null,
    hotelName: hotel?.[1] ?? null,
    checkInLocal: null,
    checkOutLocal: null,
    deadlines,
    stops,
    blocks,
    todos,
    preferences,
    summary: t.slice(0, 160),
    confirmSpeech: null,
    clarifyingQuestion: clarifying,
  });
}

const SYSTEM = [
  'Du bist longFormPlanExtractor für Findus (Reise-Begleiter).',
  'Aufgabe: unstrukturierte deutsche Sprachnachricht → EIN striktes JSON-Objekt.',
  'Kein Markdown, keine Erklärung außerhalb JSON.',
  'confidence=high nur wenn klar gesagt; sonst uncertain.',
  'ERFINDE KEINE Orte/Sehenswürdigkeiten, die nicht im Transkript vorkommen.',
  'Trenne klar: deadlines vs stops vs blocks vs todos — nicht vermischen.',
  'Prefill clarifyingQuestion wenn Ort/Zeit/Flugnummer fehlt (siehe Regeln).',
].join(' ');

function buildPrompt(transcript: string, dateKey: string, nowIso: string): string {
  return [
    `Heute dateKey=${dateKey}, jetzt=${nowIso}.`,
    'Schema:',
    '{',
    '  "city": string|null,',
    '  "hotelName": string|null,',
    '  "checkInLocal": "HH:MM"|null,',
    '  "checkOutLocal": "HH:MM"|null,',
    '  "deadlines": [{ "kind":"train"|"flight"|"reservation"|"other", "label":string, "timeLocal":"HH:MM"|null, "dateKey":"YYYY-MM-DD"|null, "flightOrTrainCode":string|null, "confidence":"high"|"uncertain" }],',
    '  "stops": [{ "label":string, "timeLocal":"HH:MM"|null, "notes":string|null, "confidence":"high"|"uncertain" }],',
    '  "blocks": [{ "label":string, "window":"morning"|"midday"|"afternoon"|"evening"|null, "timeLocal":"HH:MM"|null, "durationMin":number|null, "confidence":"high"|"uncertain" }],',
    '  "todos": [{ "label":string, "confidence":"high"|"uncertain" }],',
    '  "preferences": [{ "key":string, "value":string, "confidence":"high"|"uncertain" }],',
    '  "summary": string,',
    '  "confirmSpeech": string,',
    '  "clarifyingQuestion": string|null',
    '}',
    'Regeln:',
    '- Nur Punkte, die der User WIRKLICH genannt hat. Keine Halluzinationen.',
    '- deadlines: Zug/Flug/harte Termine inkl. Uhrzeit wenn genannt; Flug ohne Nummer → clarifyingQuestion nach Flugnummer.',
    '- stops: konkrete Orte (Museum, Café-Name, Strandabschnitt) — NUR wenn genannt.',
    '- blocks: Aktivitäten OHNE festen Ort: Bummeln, Shoppen, Freizeit — als Zeitblock, KEIN Fake-Ort.',
    '- todos: schwebende Punkte (Gutschein, „muss noch…“) ohne Block-Dauer.',
    '- Shoppen/nachmittags ohne Ort → clarifyingQuestion: wo und wann genau?',
    '- Essen gehen → clarifyingQuestion darf Reservierung/Speisekarte anbieten.',
    '- „Jetzt gleich hin“ → clarifyingQuestion: Weg bekannt oder Kompass starten?',
    '- confirmSpeech: kurz, du-Form; wenn alles klar → mit „Alles klar“ beginnen.',
    '- dateKey default = heute wenn User „heute“ meint.',
    `Transkript: „${transcript.slice(0, 3500)}“`,
  ].join('\n');
}

/**
 * Haupt-API: Transkript → strukturierter Plan-Extrakt.
 */
export async function extractLongFormPlan(
  transcript: string,
  opts?: { dateKey?: string; signal?: AbortSignal },
): Promise<LongFormExtractResult> {
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (text.length < 8) {
    return {
      source: 'heuristic',
      extract: heuristicLongFormExtract(text || 'leer'),
    };
  }

  const dateKey = opts?.dateKey ?? todayDateKey();
  if (!hasGeminiApiKey()) {
    return { source: 'heuristic', extract: heuristicLongFormExtract(text) };
  }

  try {
    const raw = await generateGeminiText(buildPrompt(text, dateKey, new Date().toISOString()), {
      systemInstruction: SYSTEM,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
      task: 'intent',
      maxTokens: 1200,
      temperature: 0.15,
      signal: opts?.signal,
    });
    const data = extractJsonObject(raw);
    if (!data) {
      return {
        source: 'heuristic',
        extract: heuristicLongFormExtract(text),
        rawModelText: raw,
      };
    }
    return {
      source: 'gemini',
      extract: normalizeExtract(data),
      rawModelText: raw,
    };
  } catch {
    return { source: 'heuristic', extract: heuristicLongFormExtract(text) };
  }
}
