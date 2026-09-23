/**
 * Packliste Harden — Wetter + Ort + Timeline → Checkliste + Deep-Link.
 * SSOT: docs/rfc/agent-harden-contract.md
 */

import type { QuickAction } from '../../types/concierge';
import {
  buildPackListItems,
  looksLikePackListAsk,
  type PackListContext,
} from './packListBuilder';
import {
  draftPackPrefLearnedRule,
  looksLikePackPreference,
  mergePackPrefs,
  parsePackPrefsFromText,
  prefsFromLearnedRules,
} from './packListPrefs';
import { looksLikePackListEdit, parsePackListEdit } from './packListEdit';
import {
  detectLaundryFromEvidence,
  looksLikeConfirmLaundry,
  looksLikeRefuseLaundry,
} from './packListLaundry';
import {
  extractPackTripHints,
  ledgerPackBlob,
  looksLikePackContextFollowUp,
} from './packListTripHints';
import {
  guessTripAtMsFromText,
  looksLikeMultiPersonPack,
  parsePackPersonsFromText,
  toPersonRefs,
} from './packListPersons';
import {
  matchWalkItem,
  missingSpeech,
  nextOpenIndex,
  packRemindSpeech,
  packWalkCue,
  parsePackWalkTurn,
  type PackWalkItem,
} from './packListWalk';
import { upsertFutureStopSafe } from './planNowGuard';
import type { FuturePlanStop } from './futurePlanState';

export { looksLikePackListAsk } from './packListBuilder';

function dayKeyNow(): string {
  try {
    const { todayDateKey } = require('../../utils/dateKeys') as {
      todayDateKey: () => string;
    };
    return todayDateKey();
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function readTimelineBlob(): string {
  try {
    const { useFuturePlanStore } = require('./futurePlanState') as {
      useFuturePlanStore: {
        getState: () => {
          stops: Array<{ title?: string; notes?: string; groupLabel?: string }>;
        };
      };
    };
    return useFuturePlanStore
      .getState()
      .stops.map((s) => `${s.title || ''} ${s.notes || ''} ${s.groupLabel || ''}`)
      .join(' · ')
      .slice(0, 800);
  } catch {
    return '';
  }
}

async function resolveWeatherCtx(opts: {
  lat?: number | null;
  lng?: number | null;
}): Promise<{ tempC: number | null; rainLikely: boolean; sunnyOrWarm: boolean; note: string | null }> {
  try {
    const { ensureWeatherFresh } = await import('../../services/weatherService');
    const snap = await ensureWeatherFresh(
      'force',
      opts.lat != null && opts.lng != null
        ? { lat: opts.lat, lng: opts.lng }
        : null,
      { userAsked: true },
    );
    if (!snap) {
      return { tempC: null, rainLikely: false, sunnyOrWarm: false, note: null };
    }
    const tempC =
      typeof snap.currentTempC === 'number' && Number.isFinite(snap.currentTempC)
        ? snap.currentTempC
        : typeof snap.dayHighC === 'number'
          ? snap.dayHighC
          : null;
    const rainLikely =
      (snap.rainStartsInMin != null && snap.rainStartsInMin <= 180) ||
      (typeof snap.precipitationMm === 'number' && snap.precipitationMm > 0.1) ||
      /regen|schauer|nass/i.test(snap.summaryLine || '');
    const sunnyOrWarm =
      (tempC != null && tempC >= 22) ||
      /sonne|heiter|klar|warm|heiß|heiss/i.test(snap.summaryLine || '');
    return {
      tempC,
      rainLikely,
      sunnyOrWarm,
      note: snap.summaryLine || null,
    };
  } catch {
    return { tempC: null, rainLikely: false, sunnyOrWarm: false, note: null };
  }
}

function resolveLocationHint(
  userText: string,
  cityHint?: string | null,
): string | null {
  if (cityHint && cityHint.trim()) return cityHint.trim().slice(0, 40);
  const m = userText.match(
    /\b(?:in|nach|ab|für)\s+([A-ZÄÖÜ][\wÄÖÜäöüß.-]{2,})/u,
  );
  return m?.[1] || null;
}

function readTripDaysFromLedger(): number | null {
  try {
    const { useReisebueroStore } = require('../../reisebuero/store') as {
      useReisebueroStore: {
        getState: () => {
          trip: {
            ledger?: {
              stayDays?: { value?: number } | null;
              stayNights?: { value?: number } | null;
              dateStart?: { value?: string } | null;
              dateEnd?: { value?: string } | null;
            };
          };
        };
      };
    };
    const led = useReisebueroStore.getState().trip?.ledger;
    if (!led) return null;
    if (led.stayDays?.value && led.stayDays.value > 0) return led.stayDays.value;
    if (led.stayNights?.value && led.stayNights.value > 0) {
      return led.stayNights.value + 1;
    }
    const a = led.dateStart?.value;
    const b = led.dateEnd?.value;
    if (a && b && /^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b)) {
      const msA = Date.parse(`${a}T12:00:00`);
      const msB = Date.parse(`${b}T12:00:00`);
      if (Number.isFinite(msA) && Number.isFinite(msB) && msB >= msA) {
        return Math.min(31, Math.round((msB - msA) / 86_400_000) + 1);
      }
    }
  } catch {
    /* soft */
  }
  return null;
}

/** Kinderzahl + Soft-Alter aus Ledger (Infants → <1 Jahr). */
function readKidsFromLedger(): {
  childrenCount: number | null;
  childAgesYears: number[] | null;
} {
  try {
    const { useReisebueroStore } = require('../../reisebuero/store') as {
      useReisebueroStore: {
        getState: () => {
          trip: {
            ledger?: {
              children?: { value?: number } | null;
              infants?: { value?: number } | null;
              travelerAges?: { value?: number[] } | null;
            };
          };
        };
      };
    };
    const led = useReisebueroStore.getState().trip?.ledger;
    if (!led) return { childrenCount: null, childAgesYears: null };
    const infants = Math.max(0, led.infants?.value ?? 0);
    const childrenRaw = Math.max(0, led.children?.value ?? 0);
    const children = Math.max(childrenRaw, infants);
    const ages: number[] = [];
    for (let i = 0; i < infants; i++) ages.push(0.5);
    const fromLed = (led.travelerAges?.value || []).filter(
      (n) => Number.isFinite(n) && n >= 0 && n <= 17,
    );
    ages.push(...fromLed);
    if (children <= 0 && ages.length === 0) {
      return { childrenCount: null, childAgesYears: null };
    }
    return {
      childrenCount: children > 0 ? children : ages.length || null,
      childAgesYears: ages.length ? ages : null,
    };
  } catch {
    return { childrenCount: null, childAgesYears: null };
  }
}

function readTripStartMsFromLedger(): number | null {
  try {
    const { useReisebueroStore } = require('../../reisebuero/store') as {
      useReisebueroStore: {
        getState: () => {
          trip: {
            ledger?: {
              dateStart?: { value?: string } | null;
            };
          };
        };
      };
    };
    const a = useReisebueroStore.getState().trip?.ledger?.dateStart?.value;
    if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) {
      const ms = Date.parse(`${a}T12:00:00`);
      return Number.isFinite(ms) ? ms : null;
    }
  } catch {
    /* soft */
  }
  return null;
}

/** Soft: Aktivitäten am Ziel aus Web-Hinweisen (nur Keywords, keine Fake-Pflicht). */
async function researchActivityHints(opts: {
  userText: string;
  locationHint: string | null;
}): Promise<string[]> {
  const loc = opts.locationHint;
  if (!loc && !/\b(kreuzfahrt|strand|wandern|rad|spa)\b/iu.test(opts.userText)) {
    return [];
  }
  try {
    const { runWebResearch } = await import('../../services/research/webResearchService');
    const q = [
      'Aktivitäten',
      loc,
      /\bkreuzfahrt|mein\s+schiff\b/iu.test(opts.userText) ? 'Kreuzfahrt Bord Pool Spa' : '',
      'Strand Wandern Rad Museum Theater',
    ]
      .filter(Boolean)
      .join(' ');
    const web = await runWebResearch(q, { force: true });
    const blob = [
      web?.speechHint,
      ...(web?.facts ?? []).map((f) => `${f.label} ${f.value}`),
      ...(web?.sources ?? []).map((s) => s.title || ''),
    ]
      .filter(Boolean)
      .join(' · ')
      .toLowerCase();
    const hints: string[] = [];
    const add = (id: string, re: RegExp) => {
      if (re.test(blob) && !hints.includes(id)) hints.push(id);
    };
    add('swim', /\b(pool|strand|baden|beach|schwimmen)\b/);
    add('hike', /\b(wandern|berg|trail|hike)\b/);
    add('bike', /\b(rad|fahrrad|bike)\b/);
    add('spa', /\b(spa|sauna|wellness)\b/);
    add('city', /\b(museum|altstadt|sightseeing|stadtführung)\b/);
    add('formal', /\b(theater|konzert|gala|oper)\b/);
    add('sport', /\b(fitness|gym|sport)\b/);
    add('nightlife', /\b(club|party|nightlife)\b/);
    return hints.slice(0, 8);
  } catch {
    return [];
  }
}

type PackTurn = {
  ok: boolean;
  speech: string;
  bullets: string[];
  actions: QuickAction[];
  listId?: string;
};

function readNextDeparture(): { atMs: number; label: string } | null {
  try {
    const { useFuturePlanStore } = require('./futurePlanState') as {
      useFuturePlanStore: {
        getState: () => {
          stops: Array<{
            title?: string;
            transport?: string;
            plannedStartMs?: number;
          }>;
        };
      };
    };
    const now = Date.now() + 5 * 60_000;
    const hits = useFuturePlanStore
      .getState()
      .stops.filter((s) => {
        const ms = s.plannedStartMs;
        if (ms == null || ms < now) return false;
        const blob = `${s.title || ''} ${s.transport || ''}`.toLowerCase();
        return /\b(bahn|zug|ice|re\b|rb\b|flug|bus|abfahrt|boarding)\b/.test(blob);
      })
      .sort((a, b) => (a.plannedStartMs || 0) - (b.plannedStartMs || 0));
    const top = hits[0];
    if (!top?.plannedStartMs) return null;
    const blob = `${top.title || ''} ${top.transport || ''}`.toLowerCase();
    const label = /\bflug|boarding\b/.test(blob)
      ? 'deinen Flug'
      : /\bbus\b/.test(blob)
        ? 'deinen Bus'
        : 'deine Bahn';
    return { atMs: top.plannedStartMs, label };
  } catch {
    return null;
  }
}

async function schedulePackRemind(opts: {
  listId: string;
  itemId: string;
  itemLabel: string;
  leadMin: number;
}): Promise<string> {
  const dep = readNextDeparture();
  if (!dep) {
    return `${opts.itemLabel} ist wichtig. Sobald eine Abfahrt in der Timeline steht, erinnere ich dich ${opts.leadMin} Minuten vorher.`;
  }
  const fireAt = dep.atMs - opts.leadMin * 60_000;
  const speech = packRemindSpeech({
    itemLabel: opts.itemLabel,
    departLabel: dep.label,
    leadMin: opts.leadMin,
  });
  if (fireAt < Date.now() + 20_000) {
    return `Die Abfahrt ist schon zu nah. ${speech}`;
  }
  try {
    const { useLogisticsTriggerStore } = await import(
      '../../store/useLogisticsTriggerStore'
    );
    useLogisticsTriggerStore.getState().upsertTimeReminder({
      eventId: `packremind_${opts.listId}_${opts.itemId}`,
      title: `${opts.itemLabel} noch einpacken`,
      detail: speech,
      fireAtMs: fireAt,
      alertLevel: 'voice',
    });
    const ev = useLogisticsTriggerStore
      .getState()
      .events.find((e) => e.id === `packremind_${opts.listId}_${opts.itemId}`);
    if (ev) {
      useLogisticsTriggerStore.getState().upsertEvent({
        ...ev,
        meta: {
          ...(ev.meta ?? {}),
          packRemind: true,
          packListId: opts.listId,
          packItemId: opts.itemId,
        },
      });
    }
  } catch {
    /* soft */
  }
  const when = new Date(fireAt);
  const clock = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  return `${opts.itemLabel} ist priorisiert. Um ${clock} — ${opts.leadMin} Minuten vor ${dep.label} — erinnere ich dich, falls es noch offen ist.`;
}

async function researchLaundryAccess(opts: {
  userText: string;
  locationHint: string | null;
  timelineBlob: string;
}): Promise<'yes' | 'no' | 'unknown'> {
  const fromUser = (() => {
    try {
      const { detectLaundryAccess } = require('./packListBuilder') as {
        detectLaundryAccess: (t: string) => 'yes' | 'no' | 'unknown';
      };
      return detectLaundryAccess(opts.userText);
    } catch {
      return 'unknown' as const;
    }
  })();
  if (fromUser === 'yes' || fromUser === 'no') return fromUser;

  let lodgingName: string | null = null;
  let lodgingKind: string | null = null;
  try {
    const { useReisebueroStore } = require('../../reisebuero/store') as {
      useReisebueroStore: {
        getState: () => {
          trip: {
            ledger?: {
              lodgingKind?: { value?: string } | null;
              lodgingOpen?: { value?: string } | null;
              destinationHint?: { value?: string } | null;
            };
            options?: Array<{ stayName?: string | null; title?: string | null }>;
          };
        };
      };
    };
    const trip = useReisebueroStore.getState().trip;
    lodgingKind = trip?.ledger?.lodgingKind?.value || null;
    lodgingName =
      trip?.options?.find((o) => o.stayName)?.stayName ||
      trip?.ledger?.lodgingOpen?.value ||
      null;
  } catch {
    /* soft */
  }

  const hotelFromTl =
    opts.timelineBlob.match(
      /\b(?:Hotel|Apartment|Ferienwohnung|Unterkunft)\s+([A-ZÄÖÜ][\wÄÖÜäöüß.'-]{2,}(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß.'-]{1,}){0,3})/u,
    )?.[1] || null;
  const stay = lodgingName || hotelFromTl;
  const cruise =
    /\b(kreuzfahrt|mein\s+schiff|cruise)\b/iu.test(
      `${opts.userText} ${opts.timelineBlob}`,
    ) || /kabine|schiff/i.test(lodgingKind || '');

  // Kreuzfahrt: Wäsche an Bord üblich — soft yes mit Beleg-Wort
  if (cruise && !stay) {
    return 'yes';
  }

  if (!stay && !opts.locationHint && !lodgingKind) {
    return 'unknown';
  }

  try {
    const { runWebResearch } = await import(
      '../../services/research/webResearchService'
    );
    const q = [
      stay || lodgingKind || 'Unterkunft',
      opts.locationHint || '',
      'Waschmaschine laundry facilities guest laundry',
    ]
      .filter(Boolean)
      .join(' ');
    const web = await runWebResearch(q, { force: true });
    const blob = [
      web?.speechHint,
      ...(web?.facts ?? []).map((f) => `${f.label} ${f.value}`),
      ...(web?.sources ?? []).map((s) => `${s.title || ''} ${s.snippet || ''}`),
      opts.timelineBlob,
    ]
      .filter(Boolean)
      .join(' · ');
    const hit = detectLaundryFromEvidence(blob);
    if (hit !== 'unknown') return hit;
  } catch {
    /* soft */
  }
  return detectLaundryFromEvidence(
    `${opts.timelineBlob} ${lodgingKind || ''} ${stay || ''}`,
  );
}

async function tryPackWalkTurn(text: string): Promise<PackTurn | null> {
  const { usePackListStore } = await import('../../store/usePackListStore');
  const store = usePackListStore.getState();
  const walking = store.isWalkActive();
  const cmd = parsePackWalkTurn(text, { walking });
  if (!cmd) return null;
  const list = store.getActiveList();
  if (!list) {
    return {
      ok: false,
      speech:
        'Es gibt noch keine gespeicherte Packliste. Sag, wofür ich eine neue bauen soll, dann gehen wir sie zusammen durch.',
      bullets: [],
      actions: [],
    };
  }
  const items = list.items as PackWalkItem[];
  const cursor = list.walkCursor ?? 0;
  const openOverlay = () => store.openOverlay(list.id);

  const cueFrom = (from: number): string => {
    const live =
      usePackListStore.getState().getList(list.id)?.items ?? list.items;
    const idx = nextOpenIndex(live, from);
    if (idx < 0) {
      store.setWalk(list.id, false, 0);
      return 'Die Packliste ist durch.';
    }
    store.setWalk(list.id, true, idx);
    return packWalkCue(live[idx]!);
  };

  if (cmd.type === 'stop') {
    store.setWalk(list.id, false, cursor);
    return {
      ok: true,
      listId: list.id,
      speech: 'Alles klar, wir pausieren die Packliste. Sie bleibt gespeichert.',
      bullets: [],
      actions: [],
    };
  }

  if (cmd.type === 'missing') {
    openOverlay();
    const open = list.items.filter((i) => !i.done);
    return {
      ok: true,
      listId: list.id,
      speech: missingSpeech(items),
      bullets: open.slice(0, 4).map((i) => i.label),
      actions: [],
    };
  }

  if (cmd.type === 'start') {
    const idx = nextOpenIndex(list.items, 0);
    store.setWalk(list.id, true, Math.max(0, idx));
    openOverlay();
    const openN = list.items.filter((i) => !i.done).length;
    const first = idx >= 0 ? packWalkCue(list.items[idx]!) : 'Nichts mehr offen.';
    return {
      ok: true,
      listId: list.id,
      speech: `Ich geh die Packliste mit dir durch. ${openN} Punkte sind noch offen. ${first}`,
      bullets: idx >= 0 ? [list.items[idx]!.label] : [],
      actions: [],
    };
  }

  const target = matchWalkItem(
    items,
    'query' in cmd ? cmd.query : null,
    cursor,
  );
  if (!target && cmd.type !== 'next') {
    return {
      ok: true,
      listId: list.id,
      speech: 'Diesen Punkt finde ich auf der Liste nicht. Sag, was noch fehlt, oder wir machen beim nächsten offenen weiter.',
      bullets: [],
      actions: [],
    };
  }

  if (cmd.type === 'later' && target) {
    store.patchItem(list.id, target.id, { later: true, done: false });
    const idx = list.items.findIndex((i) => i.id === target.id);
    openOverlay();
    return {
      ok: true,
      listId: list.id,
      speech: `${target.label} schieben wir auf später. ${cueFrom(idx + 1)}`,
      bullets: [target.label],
      actions: [],
    };
  }

  if (cmd.type === 'enough' && target) {
    store.patchItem(list.id, target.id, {
      qty: cmd.qty,
      done: true,
      later: false,
      label: `${cmd.qty}× ${target.label.replace(/^\d+×\s*/u, '')}`,
    });
    const idx = list.items.findIndex((i) => i.id === target.id);
    openOverlay();
    return {
      ok: true,
      listId: list.id,
      speech: `${cmd.qty} reichen bei ${target.label.replace(/^\d+×\s*/u, '')} — hab ich so gelassen. ${cueFrom(idx + 1)}`,
      bullets: [`${cmd.qty}× ${target.label}`],
      actions: [],
    };
  }

  if (cmd.type === 'priority' && target) {
    store.patchItem(list.id, target.id, { priority: 'high', later: false });
    const remind = await schedulePackRemind({
      listId: list.id,
      itemId: target.id,
      itemLabel: target.label.replace(/^\d+×\s*/u, ''),
      leadMin: cmd.leadMin,
    });
    const idx = list.items.findIndex((i) => i.id === target.id);
    openOverlay();
    return {
      ok: true,
      listId: list.id,
      speech: `${remind} ${cueFrom(idx + 1)}`,
      bullets: [target.label],
      actions: [],
    };
  }

  if (cmd.type === 'done' && target) {
    store.patchItem(list.id, target.id, { done: true, later: false });
    const idx = list.items.findIndex((i) => i.id === target.id);
    openOverlay();
    return {
      ok: true,
      listId: list.id,
      speech: `${target.label} ist erledigt. ${cueFrom(idx + 1)}`,
      bullets: [target.label],
      actions: [],
    };
  }

  if (cmd.type === 'next') {
    const idx = list.items.findIndex((i) => i.id === target?.id);
    openOverlay();
    return {
      ok: true,
      listId: list.id,
      speech: cueFrom((idx >= 0 ? idx : cursor) + 1),
      bullets: [],
      actions: [],
    };
  }

  return null;
}

export async function tryPackListToTimeline(opts: {
  userText: string;
  lat?: number | null;
  lng?: number | null;
  cityHint?: string | null;
}): Promise<{
  ok: boolean;
  speech: string;
  bullets: string[];
  actions: QuickAction[];
  listId?: string;
} | null> {
  const text = String(opts.userText || '').trim();
  const walkHit = await tryPackWalkTurn(text);
  if (walkHit) return walkHit;

  // Waschmaschine ja/nein → Mengen neu, ohne User zu befragen
  if (looksLikeRefuseLaundry(text) || looksLikeConfirmLaundry(text)) {
    const { usePackListStore } = await import('../../store/usePackListStore');
    const store = usePackListStore.getState();
    const list = store.getActiveList();
    if (!list) {
      return {
        ok: false,
        speech: 'Erst brauch ich eine Packliste — dann stell ich die Waschmaschine um.',
        bullets: [],
        actions: [],
      };
    }
    const laundry = looksLikeConfirmLaundry(text) ? 'yes' : 'no';
    store.setLaundryAccess(list.id, laundry);
    store.openOverlay(list.id);
    const shirts = usePackListStore
      .getState()
      .getList(list.id)
      ?.items.find((i) => /t-shirt|oberteil/i.test(i.label));
    return {
      ok: true,
      listId: list.id,
      speech:
        laundry === 'yes'
          ? `Alles klar — mit Waschmaschine rechne ich weniger Wechselwäsche${shirts?.qty ? ` (${shirts.qty}× Shirts)` : ''}.`
          : `Alles klar — ohne Waschen volle Wechselwäsche${shirts?.qty ? ` (${shirts.qty}× Shirts)` : ''}.`,
      bullets: shirts ? [shirts.label] : [],
      actions: [
        {
          type: 'OPEN_PACK_LIST',
          label: '📋 Packliste öffnen',
          payload: { packListId: list.id },
        },
      ],
    };
  }

  // Follow-up: „jeden Tag Tennis“ / „Hochzeit → Anzug“ auf bestehende Liste
  if (looksLikePackContextFollowUp(text)) {
    const { usePackListStore } = await import('../../store/usePackListStore');
    const store = usePackListStore.getState();
    const list = store.getActiveList();
    const walking = store.isWalkActive();
    const armed =
      walking ||
      /\bpackliste\b/iu.test(text) ||
      Boolean(list && Date.now() - list.createdAtMs < 7 * 24 * 3600_000);
    if (list && armed) {
      const hints = extractPackTripHints({
        userText: text,
        ledgerBlob: ledgerPackBlob(
          (() => {
            try {
              const { useReisebueroStore } = require('../../reisebuero/store') as {
                useReisebueroStore: {
                  getState: () => {
                    trip: { ledger?: Parameters<typeof ledgerPackBlob>[0] };
                  };
                };
              };
              return useReisebueroStore.getState().trip?.ledger ?? null;
            } catch {
              return null;
            }
          })(),
        ),
        tripDays: list.tripDays,
      });
      if (hints.extras.length) {
        store.addItems(
          list.id,
          hints.extras.map((ex) => ({
            id: `hint_${Math.random().toString(36).slice(2, 8)}`,
            label:
              ex.qty != null && ex.qty > 1 ? `${ex.qty}× ${ex.label}` : ex.label,
            reason: ex.reason,
            done: false,
            qty: ex.qty ?? null,
            priority: ex.priority ?? null,
            category: ex.category,
          })),
        );
        store.openOverlay(list.id);
        return {
          ok: true,
          listId: list.id,
          speech: `Passt — ${hints.notes.join('; ') || 'nachgezogen'}. Hab ich auf die Packliste gesetzt.`,
          bullets: hints.extras.slice(0, 4).map((e) => e.label),
          actions: [
            {
              type: 'OPEN_PACK_LIST',
              label: '📋 Packliste öffnen',
              payload: { packListId: list.id },
            },
          ],
        };
      }
    }
  }

  if (!looksLikePackListAsk(text) && !looksLikePackListEdit(text)) return null;

  const edit = parsePackListEdit(text);
  if (edit) {
    const { usePackListStore } = await import('../../store/usePackListStore');
    const store = usePackListStore.getState();
    const list = store.getActiveList();
    if (!list) {
      return {
        ok: false,
        speech:
          'Es gibt noch keine gespeicherte Packliste. Sag einfach, wofür ich eine neue bauen soll.',
        bullets: [],
        actions: [],
      };
    }
    if (edit.kind === 'add') {
      store.addItems(
        list.id,
        edit.labels.map((label) => ({
          id: `add_${Math.random().toString(36).slice(2, 8)}`,
          label,
          reason: 'Von dir ergänzt',
          done: false,
          category: 'misc' as const,
        })),
      );
    } else if (edit.kind === 'remove') {
      const removed = store.removeMatching(list.id, edit.query);
      store.openOverlay(list.id);
      return {
        ok: true,
        listId: list.id,
        speech: removed.length
          ? `Weg von der Packliste: ${removed.slice(0, 3).join(', ')}.`
          : `„${edit.query}“ stand nicht auf der Packliste.`,
        bullets: removed.slice(0, 4),
        actions: [
          {
            type: 'OPEN_PACK_LIST',
            label: '📋 Packliste öffnen',
            payload: { packListId: list.id },
          },
        ],
      };
    } else {
      const hit = store.setItemDone(list.id, edit.query, edit.done);
      store.openOverlay(list.id);
      return {
        ok: true,
        listId: list.id,
        speech: hit
          ? edit.done
            ? `Abgehakt: ${hit}.`
            : `Wieder offen: ${hit}.`
          : `„${edit.query}“ hab ich auf der Liste nicht gefunden.`,
        bullets: hit ? [hit] : [],
        actions: [
          {
            type: 'OPEN_PACK_LIST',
            label: '📋 Packliste öffnen',
            payload: { packListId: list.id },
          },
        ],
      };
    }
    store.openOverlay(list.id);
    const fresh = usePackListStore.getState().getList(list.id);
    return {
      ok: true,
      listId: list.id,
      speech: `Drauf: ${edit.labels.join(', ')}. Die Packliste bleibt gespeichert.`,
      bullets: edit.labels,
      actions: [
        {
          type: 'OPEN_PACK_LIST',
          label: '📋 Packliste öffnen',
          payload: { packListId: list.id },
        },
        ...(fresh?.items.slice(-2) ?? []).map((it) => ({
          type: 'TOGGLE_PACK_ITEM' as const,
          label: `☐ ${it.label}`.slice(0, 36),
          payload: { packListId: list.id, packItemId: it.id },
        })),
      ],
    };
  }

  if (!looksLikePackListAsk(text)) return null;

  const weather = await resolveWeatherCtx({
    lat: opts.lat,
    lng: opts.lng,
  });
  const locationHint = resolveLocationHint(text, opts.cityHint);
  const timelineBlob = [
    readTimelineBlob(),
    (() => {
      try {
        const { useReisebueroStore } = require('../../reisebuero/store') as {
          useReisebueroStore: {
            getState: () => {
              trip: { ledger?: Parameters<typeof ledgerPackBlob>[0] };
            };
          };
        };
        return ledgerPackBlob(useReisebueroStore.getState().trip?.ledger ?? null);
      } catch {
        return '';
      }
    })(),
  ]
    .filter(Boolean)
    .join(' · ');
  const ledgerDays = readTripDaysFromLedger();
  const kidsLed = readKidsFromLedger();
  const activityHints = await researchActivityHints({
    userText: text,
    locationHint,
  });

  let learnedPack = { avoid: [] as string[], prefer: [] as string[], notes: [] as string[] };
  try {
    const { getLearnedRules } = await import('../../services/memory/correctionLearning');
    learnedPack = prefsFromLearnedRules(getLearnedRules());
  } catch {
    /* soft */
  }
  const textPrefs = parsePackPrefsFromText(text);
  const packPrefs = mergePackPrefs(learnedPack as never, textPrefs);

  // Prefs aus diesem Turn dauerhaft lernen („nie Pulli“)
  if (looksLikePackPreference(text) && (textPrefs.avoid.length || textPrefs.prefer.length)) {
    try {
      const draft = draftPackPrefLearnedRule(textPrefs);
      if (draft) {
        const { upsertLearnedRule } = await import('../../services/memory/correctionLearning');
        void upsertLearnedRule(draft);
      }
    } catch {
      /* soft */
    }
  }

  const laundryResearched = await researchLaundryAccess({
    userText: text,
    locationHint,
    timelineBlob,
  });

  const { usePackListStore, packListDeepLink } = await import(
    '../../store/usePackListStore'
  );
  const store = usePackListStore.getState();
  const tripAtMs =
    guessTripAtMsFromText(text) ||
    readTripStartMsFromLedger() ||
    null;
  let personRefs: ReturnType<typeof toPersonRefs> = [];
  if (looksLikeMultiPersonPack(text) || /\b(kind|kinder|papa|mama)\b/iu.test(text)) {
    const parsed = parsePackPersonsFromText(text, {
      nowMs: Date.now(),
      existing: store.travelers,
    });
    if (parsed.length) {
      store.upsertTravelers(parsed);
      personRefs = toPersonRefs(parsed, tripAtMs);
    }
  }

  const agesFromPersons = personRefs
    .filter((p) => p.role === 'child' && p.ageAtTrip != null)
    .map((p) => p.ageAtTrip as number);
  const ctx: PackListContext = {
    userText: text,
    locationHint,
    tempC: weather.tempC,
    rainLikely: weather.rainLikely,
    sunnyOrWarm: weather.sunnyOrWarm,
    timelineBlob,
    tripDays: ledgerDays,
    activityHints,
    childrenCount:
      personRefs.filter((p) => p.role === 'child').length ||
      kidsLed.childrenCount,
    childAgesYears:
      agesFromPersons.length > 0
        ? agesFromPersons
        : kidsLed.childAgesYears,
    packPrefs,
    laundryAccess: laundryResearched,
    persons: personRefs.length ? personRefs : null,
  };
  const built = buildPackListItems(ctx);
  if (!built.items.length) {
    return {
      ok: false,
      speech:
        'Für eine Packliste brauch ich noch etwas Kontext — Ziel, Dauer, Wetter oder ob Strand/Kreuzfahrt/Flug ansteht.',
      bullets: [],
      actions: [],
    };
  }

  const listId = `pack_${Date.now().toString(36)}`;
  const personTitle =
    personRefs.length >= 2
      ? ` · ${personRefs.map((p) => p.name).slice(0, 4).join(', ')}`
      : '';
  const title = locationHint
    ? `Packliste · ${locationHint}${personTitle}`
    : built.tripKinds.includes('cruise')
      ? `Packliste · Kreuzfahrt${personTitle}`
      : `Packliste${personTitle}`;

  store.upsertList({
    id: listId,
    title,
    createdAtMs: Date.now(),
    destHint: locationHint,
    weatherNote: weather.note,
    items: built.items,
    laundryAccess: built.laundryAccess,
    tripDays: built.tripDays,
    persons: personRefs.length ? personRefs : null,
    climate: {
      warm:
        weather.sunnyOrWarm ||
        (weather.tempC != null && weather.tempC >= 22) ||
        built.tripKinds.includes('cruise') ||
        built.tripKinds.includes('swim'),
      cool: weather.tempC != null && weather.tempC <= 14,
      active:
        built.activities.includes('hike') ||
        built.activities.includes('bike') ||
        built.activities.includes('sport'),
    },
  });

  const deep = packListDeepLink(listId);
  const actions: QuickAction[] = [
    {
      type: 'OPEN_PACK_LIST',
      label: '📋 Packliste öffnen',
      payload: { packListId: listId, url: deep },
    },
  ];

  for (const it of built.items.filter((i) => i.qty && i.qty > 1).slice(0, 2)) {
    if (actions.length >= 5) break;
    actions.push({
      type: 'TOGGLE_PACK_ITEM',
      label: `☐ ${it.label}`.slice(0, 36),
      payload: { packListId: listId, packItemId: it.id },
    });
  }
  for (const it of built.items.slice(0, 3)) {
    if (actions.length >= 5) break;
    if (actions.some((a) => a.payload.packItemId === it.id)) continue;
    actions.push({
      type: 'TOGGLE_PACK_ITEM',
      label: `☐ ${it.label}`.slice(0, 36),
      payload: { packListId: listId, packItemId: it.id },
    });
  }

  const dayKey = dayKeyNow();
  try {
    const ms = Date.parse(`${dayKey}T09:00:00`);
    if (Number.isFinite(ms)) {
      const stop: FuturePlanStop = {
        id: `packlist_${listId}`,
        title: title.slice(0, 48),
        plannedStartMs: ms,
        plannedEndMs: ms + 20 * 60_000,
        bufferMin: 5,
        transport: 'walk',
        kind: 'stop',
        emoji: '🧳',
        groupId: listId,
        groupLabel: 'Packliste',
        notes: `${built.items.length} Punkte · ${built.tripDays ?? '?'} Tage · ${deep}`,
        websiteUrl: deep,
        planPriority: 4,
        userFixedTime: false,
      };
      upsertFutureStopSafe(stop);
    }
  } catch {
    /* soft */
  }

  try {
    usePackListStore.getState().openOverlay(listId);
  } catch {
    /* soft */
  }

  const qtyBits = built.items
    .filter((i) => i.qty && i.qty > 1)
    .slice(0, 3)
    .map((i) => i.label);
  const evidence = built.evidenceNotes.slice(0, 3).join(' · ');
  const laundryAskSpeech =
    built.laundryAccess === 'yes'
      ? ' Waschmaschine ist belegt — Shirts und Unterwäsche habe ich runtergerechnet. Im Reiter kannst du das umstellen.'
      : built.laundryAccess === 'no'
        ? ' Ohne Waschen rechne ich volle Wechselwäsche. Im Reiter kannst du Waschmaschine anmachen.'
        : ' Ob Waschmaschine: wenn die Unterkunft bekannt ist, schau ich das selbst nach — sonst stellst du es oben in der Packliste um.';
  const kidsN = built.items.filter((i) => i.category === 'kids').length;
  const medsN = built.items.filter((i) => i.category === 'meds').length;
  const prefBits = built.evidenceNotes.filter((n) => /prefs|nie |immer /i.test(n)).slice(0, 2);
  const packPrefsSpeech = prefBits.length
    ? ` Persönliche Prefs sind drin (${prefBits.join('; ')}).`
    : '';
  const kidsMedSpeech =
    kidsN > 0 || medsN > 0
      ? ` ${kidsN > 0 ? 'Kinder-Liste ist altersfein mit drin' : ''}${kidsN > 0 && medsN > 0 ? ', ' : ''}${medsN > 0 ? 'Medikamente nur wo belegt' : ''}.`
      : '';
  const personSpeech =
    personRefs.length >= 2
      ? ` Reiter für ${personRefs.map((p) => p.name).slice(0, 4).join(', ')}${
          personRefs.some((p) => p.ageAtTrip != null)
            ? ` — Alter zum Reisetermin mitgerechnet`
            : ''
        }.`
      : '';
  return {
    ok: true,
    listId,
    speech: `Packliste steht — ${built.items.length} Punkte${built.tripDays ? ` für ${built.tripDays} Tage` : ''}${evidence ? ` (${evidence})` : ''}. Mengen für Shirts und Hosen sind mitgerechnet.${laundryAskSpeech}${kidsMedSpeech}${personSpeech}${packPrefsSpeech} Öffnen und abhaken.`,
    bullets: [
      ...qtyBits,
      built.laundryAccess === 'yes'
        ? 'Waschmaschine: ja'
        : built.laundryAccess === 'no'
          ? 'Waschmaschine: nein'
          : '',
      ...built.items
        .filter((i) => i.category === 'kids' || i.category === 'meds')
        .slice(0, 2)
        .map((i) => i.label),
      ...built.items.slice(0, 2).map((i) => i.label),
      evidence,
    ]
      .filter(Boolean)
      .slice(0, 5),
    actions: actions.slice(0, 5),
  };
}
