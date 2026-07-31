/**
 * Sprachnachrichten-Planmodus — Diff, Confirm, Commit in Memory + Modul 5.
 */

import {
  startListening,
  stopListening,
  isCurrentlyListening,
} from '../sttService';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useOpenQuestionStore } from '../../store/useOpenQuestionStore';
import { useDayPlanStore } from '../../store/useDayPlanStore';
import {
  clockLabel,
  todayDateKey,
  uid,
  type DayPlanItem,
} from '../../types/dayPlan';
import { getVoiceSettingsForTour, speakAssistantText } from '../ttsService';
import {
  extractLongFormPlan,
  type LongFormPlanExtract,
} from './longFormPlanExtractor';
import { fillLogisticsGaps } from './smartLogistics';
import { syncLiveFlightIntoDayPlan } from './liveFlightPlan';
import { snapMsTo5Min } from './bufferMath';
import { applyDedupeToDay } from './dayPlanDedupe';
import { appendPlanInput } from './planInputLog';
import { buildPlanTalkAfterCommit } from './planTalkPolicy';
import { scheduleModule5FollowUp } from './module5Priority';
import { wrapPlainAsConcierge } from '../concierge/parseConciergeResponse';
import { toConciergeCardState } from '../concierge/presentConcierge';
import { useFinnusStore } from '../../store/useFinnusStore';

export type VoicePlanDiffItem = {
  id: string;
  kind:
    | 'city'
    | 'hotel'
    | 'checkin'
    | 'checkout'
    | 'deadline'
    | 'stop'
    | 'block'
    | 'todo'
    | 'pref';
  label: string;
  detail?: string;
  confidence: 'high' | 'uncertain';
  /** immer "new" vor Commit — Diff zeigt Extrakt vs. leer/unsicher */
  status: 'new' | 'uncertain';
};

export type VoicePlanDraft = {
  dateKey: string;
  transcript: string;
  extract: LongFormPlanExtract;
  source: 'gemini' | 'heuristic';
  items: VoicePlanDiffItem[];
  badgeNew: number;
  badgeUncertain: number;
  confirmSpeech: string;
};

function parseLocalOnDate(dateKey: string, hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = dateKey.split('-').map(Number);
  const dt = new Date(y!, (mo ?? 1) - 1, d ?? 1, Number(m[1]), Number(m[2]), 0, 0);
  return dt.getTime();
}

/** Soft-Zeiten → 5-Min-Raster; exakte Bahn/Flug-Minuten bleiben. */
function softOrExactMs(
  ms: number | null,
  hard: boolean,
): number | null {
  if (ms == null) return null;
  if (hard) return ms;
  return snapMsTo5Min(ms, 'nearest');
}

function windowToStartMs(dateKey: string, window: string | null): number | null {
  if (!window) return null;
  const map: Record<string, string> = {
    morning: '10:00',
    midday: '13:00',
    afternoon: '15:00',
    evening: '18:00',
  };
  const hhmm = map[window.toLowerCase()];
  return hhmm ? parseLocalOnDate(dateKey, hhmm) : null;
}

export function buildVoicePlanDiff(
  transcript: string,
  extract: LongFormPlanExtract,
  source: 'gemini' | 'heuristic',
  dateKey = todayDateKey(),
): VoicePlanDraft {
  const items: VoicePlanDiffItem[] = [];
  if (extract.city) {
    items.push({
      id: uid('city'),
      kind: 'city',
      label: `Stadt: ${extract.city}`,
      confidence: 'high',
      status: 'new',
    });
  }
  if (extract.hotelName) {
    items.push({
      id: uid('hotel'),
      kind: 'hotel',
      label: `Hotel: ${extract.hotelName}`,
      confidence: 'high',
      status: 'new',
    });
  }
  if (extract.checkInLocal) {
    items.push({
      id: uid('cin'),
      kind: 'checkin',
      label: `Check-in ${extract.checkInLocal}`,
      confidence: 'high',
      status: 'new',
    });
  }
  if (extract.checkOutLocal) {
    items.push({
      id: uid('cout'),
      kind: 'checkout',
      label: `Checkout ${extract.checkOutLocal}`,
      confidence: 'high',
      status: 'new',
    });
  }
  for (const d of extract.deadlines) {
    items.push({
      id: uid('dl'),
      kind: 'deadline',
      label: d.label,
      detail: [d.timeLocal, d.flightOrTrainCode].filter(Boolean).join(' · ') || undefined,
      confidence: d.confidence,
      status: d.confidence === 'uncertain' ? 'uncertain' : 'new',
    });
  }
  for (const s of extract.stops) {
    items.push({
      id: uid('st'),
      kind: 'stop',
      label: s.label,
      detail: s.timeLocal ?? s.notes ?? undefined,
      confidence: s.confidence,
      status: s.confidence === 'uncertain' ? 'uncertain' : 'new',
    });
  }
  for (const b of extract.blocks ?? []) {
    items.push({
      id: uid('bl'),
      kind: 'block',
      label: b.label,
      detail: [b.window, b.timeLocal, b.durationMin != null ? `${b.durationMin} Min` : null]
        .filter(Boolean)
        .join(' · ') || undefined,
      confidence: b.confidence,
      status: b.confidence === 'uncertain' ? 'uncertain' : 'new',
    });
  }
  for (const t of extract.todos) {
    items.push({
      id: uid('td'),
      kind: 'todo',
      label: t.label,
      confidence: t.confidence,
      status: t.confidence === 'uncertain' ? 'uncertain' : 'new',
    });
  }
  for (const p of extract.preferences) {
    items.push({
      id: uid('pf'),
      kind: 'pref',
      label: `${p.key}: ${p.value}`,
      confidence: p.confidence,
      status: p.confidence === 'uncertain' ? 'uncertain' : 'new',
    });
  }

  const badgeUncertain = items.filter((i) => i.confidence === 'uncertain').length;
  const badgeNew = items.filter((i) => i.confidence === 'high').length;

  return {
    dateKey,
    transcript,
    extract,
    source,
    items,
    badgeNew,
    badgeUncertain,
    confirmSpeech: extract.confirmSpeech,
  };
}

/**
 * STT-Transkript → Draft-Diff (noch nicht speichern).
 */
export async function processVoicePlanTranscript(
  transcript: string,
  opts?: { dateKey?: string },
): Promise<VoicePlanDraft | null> {
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (text.length < 8) return null;
  const dateKey = opts?.dateKey ?? todayDateKey();
  const { extract, source } = await extractLongFormPlan(text, { dateKey });
  return buildVoicePlanDiff(text, extract, source, dateKey);
}

export type DictationPhase = 'idle' | 'recording' | 'processing';

/** Start Lang-Form Aufnahme (Toggle). */
export async function startVoicePlanDictation(
  onPartial?: (text: string) => void,
): Promise<{ ok: boolean; reason?: string }> {
  if (isCurrentlyListening()) {
    await stopListening({ tailMs: 0, finalizeMs: 200 });
  }
  const r = await startListening(onPartial, { replaceActive: true });
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true };
}

/** Stop Aufnahme → Transkript. */
export async function stopVoicePlanDictation(): Promise<string> {
  return stopListening({ tailMs: 800, finalizeMs: 2200 });
}

/**
 * Nach User-Bestätigung: Memory + DayPlan schreiben + TTS.
 */
export async function commitVoicePlanDraft(
  draft: VoicePlanDraft,
): Promise<{ ok: boolean; summary: string }> {
  const { extract, transcript, dateKey } = draft;
  const mem = useUserMemoryStore.getState();

  mem.setTravelItinerary({
    rawText: transcript,
    summary: extract.summary,
    uploadedAt: new Date().toISOString(),
    structured: {
      city: extract.city,
      hotelName: extract.hotelName,
      checkInLocal: extract.checkInLocal,
      checkOutLocal: extract.checkOutLocal,
      deadlines: extract.deadlines,
      stops: extract.stops,
      blocks: extract.blocks ?? [],
      todos: extract.todos,
      preferences: extract.preferences,
    },
  });

  if (extract.hotelName) {
    const cityId =
      extract.city?.trim().toLowerCase() ??
      (() => {
        try {
          const { getCachedUserProfile } = require('../userProfileService') as {
            getCachedUserProfile: () => { cityId?: string | null } | null;
          };
          return getCachedUserProfile()?.cityId ?? undefined;
        } catch {
          return undefined;
        }
      })();
    const ent = mem.addOrUpdateEntity({
      type: 'hotel',
      name: extract.hotelName,
      isConfirmed: true,
      cityId: cityId ?? undefined,
      notes: [
        extract.checkInLocal ? `Check-in ${extract.checkInLocal}` : null,
        extract.checkOutLocal ? `Checkout ${extract.checkOutLocal}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    });
    mem.confirmEntity(ent.id);
  }

  if (extract.preferences.length) {
    useOpenQuestionStore.getState().mergeFromPass1({
      subQuestions: [],
      facts: extract.preferences.map((p) => ({
        key: p.key,
        value: p.value,
      })),
      topicSummary: extract.summary,
      sourceTurn: transcript.slice(0, 200),
    });
  }

  const store = useDayPlanStore.getState();
  store.ensureDay(dateKey);

  for (const d of extract.deadlines) {
    const dk = d.dateKey ?? dateKey;
    const hard = d.kind === 'flight' || d.kind === 'train';
    const startMs = softOrExactMs(parseLocalOnDate(dk, d.timeLocal), hard);
    store.upsertItem(dk, {
      id: uid('vdl'),
      kind: d.kind === 'flight' ? 'flight' : d.kind === 'train' ? 'transit' : 'custom',
      title: d.label,
      startMs,
      endMs: startMs != null ? startMs + 10 * 60_000 : null,
      timed: startMs != null,
      status: 'planned',
      hardDeadline: true,
      source: 'voice',
      sortOrder: 200,
      notes: d.flightOrTrainCode ?? undefined,
      meta: { voice: true, code: d.flightOrTrainCode, confidence: d.confidence },
    } satisfies DayPlanItem);
  }

  for (const s of extract.stops) {
    const startMs = softOrExactMs(parseLocalOnDate(dateKey, s.timeLocal), false);
    store.upsertItem(dateKey, {
      id: uid('vst'),
      kind: 'activity',
      title: s.label,
      startMs,
      endMs: startMs != null ? startMs + 60 * 60_000 : null,
      timed: startMs != null,
      status: 'planned',
      source: 'voice',
      sortOrder: 300,
      notes: s.notes ?? undefined,
      placeName: s.label,
      meta: {
        voice: true,
        confidence: s.confidence,
        userRequested: true,
      },
    });
  }

  for (const b of extract.blocks ?? []) {
    const startMs = softOrExactMs(
      parseLocalOnDate(dateKey, b.timeLocal) ??
        windowToStartMs(dateKey, b.window),
      false,
    );
    const dur = b.durationMin ?? 60;
    store.upsertItem(dateKey, {
      id: uid('vbl'),
      kind: 'activity',
      title: b.label,
      startMs,
      endMs: startMs != null ? startMs + dur * 60_000 : null,
      timed: startMs != null,
      status: 'planned',
      source: 'voice',
      sortOrder: 350,
      durationMin: dur,
      notes: b.window ? `Zeitfenster: ${b.window}` : 'Zeitblock',
      meta: {
        voice: true,
        confidence: b.confidence,
        userRequested: true,
        timeBlock: true,
        window: b.window,
      },
    });
  }

  for (const t of extract.todos) {
    store.upsertItem(dateKey, {
      id: uid('vtd'),
      kind: 'todo',
      title: t.label,
      startMs: null,
      endMs: null,
      timed: false,
      status: 'planned',
      source: 'voice',
      carryOver: true,
      sortOrder: 900,
      meta: { voice: true, confidence: t.confidence, userRequested: true },
    });
  }

  if (extract.checkInLocal) {
    const startMs = softOrExactMs(
      parseLocalOnDate(dateKey, extract.checkInLocal),
      false,
    );
    if (startMs) {
      store.upsertItem(dateKey, {
        id: uid('vcin'),
        kind: 'checkin',
        title: `Check-in${extract.hotelName ? ` ${extract.hotelName}` : ''}`,
        startMs,
        endMs: startMs + 30 * 60_000,
        timed: true,
        status: 'planned',
        source: 'voice',
        sortOrder: 20,
        placeName: extract.hotelName ?? undefined,
      });
    }
  }
  if (extract.checkOutLocal) {
    const startMs = softOrExactMs(
      parseLocalOnDate(dateKey, extract.checkOutLocal),
      false,
    );
    if (startMs) {
      store.upsertItem(dateKey, {
        id: uid('vcout'),
        kind: 'checkout',
        title: `Checkout${extract.hotelName ? ` ${extract.hotelName}` : ''}`,
        startMs,
        endMs: startMs + 15 * 60_000,
        timed: true,
        status: 'planned',
        source: 'voice',
        sortOrder: 40,
        placeName: extract.hotelName ?? undefined,
      });
    }
  }

  // Kein ingestModule2IntoDayPlan hier — Extrakt ist SSOT (sonst Doppel-Einträge)
  fillLogisticsGaps(dateKey);

  applyDedupeToDay(
    dateKey,
    (dk, items) => store.replaceItems(dk, items),
    () => store.getDay(dateKey).items,
  );

  const flightCode = extract.deadlines.find((d) => d.kind === 'flight')?.flightOrTrainCode;
  if (flightCode) {
    void syncLiveFlightIntoDayPlan({
      userText: `${flightCode} ${transcript}`,
      dateKey,
    }).catch(() => undefined);
  }

  void appendPlanInput({
    dateKey,
    source: 'voice',
    transcript,
    summary: extract.summary,
    extractSummary: extract.confirmSpeech.slice(0, 240),
    itemLabels: [
      ...extract.deadlines.map((d) => d.label),
      ...extract.stops.map((s) => s.label),
      ...(extract.blocks ?? []).map((b) => b.label),
      ...extract.todos.map((t) => t.label),
    ],
  });

  store.addChange(dateKey, {
    summary: `Sprachnachricht: ${draft.badgeNew} neu, ${draft.badgeUncertain} unsicher`,
    reason: extract.summary,
    significant: true,
  });

  const talk = buildPlanTalkAfterCommit({
    extract,
    transcript,
    walkMinToNext: null,
    goNow: /\b(jetzt\s+gleich|sofort\s+hin|kompass)\b/iu.test(transcript),
  });

  try {
    const voice = await getVoiceSettingsForTour();
    if (talk.actions.length) {
      useFinnusStore.getState().setActiveConciergeCard(
        toConciergeCardState(
          wrapPlainAsConcierge(talk.speech, {
            cardTitle: 'Planung',
            visualBullets: [talk.kind],
            quickActions: talk.actions,
          }),
        ),
      );
    }
    await speakAssistantText(talk.speech, voice);
    if (talk.kind !== 'all_clear' && talk.actions.length) {
      scheduleModule5FollowUp({
        speech: talk.speech,
        actions: talk.actions,
      });
    }
  } catch {
    /* soft */
  }

  return {
    ok: true,
    summary: `${draft.badgeNew} Punkte übernommen${
      draft.badgeUncertain ? `, ${draft.badgeUncertain} unsicher` : ''
    }`,
  };
}

export function formatVoiceDraftBadges(draft: VoicePlanDraft): string {
  const parts: string[] = [];
  if (draft.badgeNew) parts.push(`${draft.badgeNew} neu`);
  if (draft.badgeUncertain) parts.push(`${draft.badgeUncertain} unsicher`);
  return parts.join(' · ') || 'leer';
}

export function previewClockFromDiff(item: VoicePlanDiffItem): string | null {
  const m = item.detail?.match(/\b(\d{1,2}:\d{2})\b/);
  if (m) return m[1]!;
  const fromLabel = item.label.match(/\b(\d{1,2}:\d{2})\b/);
  return fromLabel?.[1] ?? null;
}

/** Debug/UI helper */
export function describeDraftItemTime(item: VoicePlanDiffItem): string {
  const c = previewClockFromDiff(item);
  return c ? clockLabel(parseLocalOnDate(todayDateKey(), c) ?? Date.now()) : 'ohne Uhr';
}
