/**
 * Call-1 Task-Brief SSOT — Timing, Blocker, curated Context, WorkItems.
 * Call 1 = Legende; Worker führen nur den Brief aus.
 */

import type { Call1Criterion } from '../pitch/call1Criteria';
import {
  normalizeWorkerId,
  type Call1WorkerId,
  isPlaceFamilyWorker,
} from './call1CapabilityMap';
import type { ManagerAnalysis } from './types';
import type { TurnFrame, TurnWhen, TurnWorkTask } from './turnFrame';
import {
  buildOpenWorldContract,
  filterCuratedContextForWorkers,
  type Call1OpenWorldContract,
} from './call1OpenWorldContract';
import { looksLikeAyceQuery, normalizeAyceStt } from '../pitch/ayceIntent';
import { resolveMissionAskBack } from '../mission/resolveMissionAskBack';

export type Call1ProximityMode =
  | 'urgent_near'
  | 'here_now'
  | 'city_best'
  | 'later_free';

export type Call1ExecuteWhen = 'now' | 'later' | 'on_confirm';

export type Call1WorkItem = {
  id: string;
  worker: Call1WorkerId;
  brief: string;
  destCity?: string | null;
  proximity?: Call1ProximityMode;
  executeWhen: Call1ExecuteWhen;
  when?: TurnWhen | null;
  must?: Call1Criterion[];
  avoid?: string[];
  neededSlots?: string[];
  dependsOn?: string | null;
  blockedByAskBack?: boolean;
  wantBookingLink?: boolean;
};

export type Call1TaskBrief = {
  bridge: string | null;
  bridgeComplete: boolean;
  session: 'new' | 'followup';
  topicCut: boolean;
  curatedContext: string[];
  authorIntent: string;
  selfQuestions: string[];
  call2Tips: string[];
  askBack: string | null;
  goldPolicy: 'adapt';
  researchCity: string | null;
  proximity: Call1ProximityMode;
  work: Call1WorkItem[];
  /** Nur lauffähige Items (ohne Blocker, executeWhen beachtet) */
  runnableWork: Call1WorkItem[];
  /** Ideal Open-World Vertrag (searchPlan, stopPolicy, uiRequirements, …) */
  openWorld: Call1OpenWorldContract;
};

export function inferProximityMode(text: string): Call1ProximityMode {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (
    /\b(toilette|klo|wc|pipi|dringend|ganz\s+schnell|sofort\s+aufs?\s+klo|nächste\s+toilette|naechste\s+toilette)\b/iu.test(
      t,
    )
  ) {
    return 'urgent_near';
  }
  if (
    /\b(in\s+\d+\s+tagen|übermorgen|uebermorgen|nächste\s+woche|naechste\s+woche|irgendwohin|irgendwann)\b/iu.test(
      t,
    ) ||
    (/\bmorgen\b/iu.test(t) &&
      !/\bguten\s+morgen\b/iu.test(t) &&
      !/\bheut(?:e)?\s+morgen\b/iu.test(t) &&
      /\b(dahin|hin|hinfahren|hingehen|besuchen|einplanen)\b/iu.test(t))
  ) {
    return 'later_free';
  }
  if (
    /\b(alster|hamburg|berlin|münchen|muenchen|köln|koeln|bestes?|beste|city|in\s+der\s+stadt)\b/iu.test(
      t,
    ) ||
    /\b(an\s+der|auf\s+der)\s+(alster|elbe|ostsee|nordsee)\b/iu.test(t)
  ) {
    return 'city_best';
  }
  return 'here_now';
}

/**
 * Wann eine Aktion feuern darf — „morgen dahin“ ≠ Nav jetzt.
 */
export function inferExecuteWhen(
  text: string,
  worker: Call1WorkerId,
  when?: TurnWhen | null,
): Call1ExecuteWhen {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const laterDay =
    when?.kind === 'day' &&
    when.label &&
    /\b(morgen|übermorgen|uebermorgen)\b/iu.test(when.label);
  const laterInText =
    (/\bmorgen\b/iu.test(t) &&
      !/\bguten\s+morgen\b/iu.test(t) &&
      !/\bheut(?:e)?\s+morgen\b/iu.test(t)) ||
    /\b(übermorgen|uebermorgen|in\s+\d+\s+tagen|später|spaeter|nachher|nach\s+dem\s+essen)\b/iu.test(
      t,
    );

  if (worker === 'nav' || worker === 'transit' || worker === 'taxi') {
    if (
      /\b(stopp|stop|abbrechen|beenden)\b/iu.test(t) &&
      /\b(nav|navigation|route)\b/iu.test(t)
    ) {
      return 'now';
    }
    if (
      laterDay ||
      laterInText ||
      (/\b(dahin|hin|hinfahren)\b/iu.test(t) &&
        !/\b(jetzt|sofort|los|starten|navigation\s+starten)\b/iu.test(t))
    ) {
      if (!/\b(jetzt|sofort|gleich|navigation\s+starten|bring\s+mich)\b/iu.test(t)) {
        return 'later';
      }
    }
    if (/\b(jetzt|sofort|gleich|los|starten|bring\s+mich)\b/iu.test(t)) {
      return 'now';
    }
    if (laterDay || laterInText) return 'later';
  }

  if (worker === 'transit' || worker === 'taxi' || /\btaxi|uber|bolt\b/iu.test(t)) {
    if (/\b(später|spaeter|nachher|nach\s+dem|vormerken|vorbereiten)\b/iu.test(t)) {
      return 'later';
    }
    if (/\b(jetzt|sofort|gleich|bestell)\b/iu.test(t)) return 'now';
    if (laterDay || laterInText) return 'on_confirm';
  }

  if (isPlaceFamilyWorker(worker) && (laterDay || laterInText)) {
    // Recherche jetzt ok — Nav/Action später
    return 'now';
  }

  return 'now';
}

/** Taxi zum Flughafen ohne Flug/Ziel → Blocker.
 * Compound Flug+Taxi im Satz: nicht blocken — Task-Kette (Flug→Leave-by→Taxi) behält Task 2.
 */
export function detectTaxiAirportBlocker(text: string): {
  blocked: boolean;
  askBack: string | null;
} {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const taxi =
    /\b(taxi|uber|bolt|cabify)\b/iu.test(t) &&
    /\b(bestell|vorbestell|holen|brauchen|möcht|moecht|kannst\s+du)\b/iu.test(t);
  if (!taxi) return { blocked: false, askBack: null };
  const toAirport = /\b(flughafen|airport|zum\s+flug|zum\s+flieger)\b/iu.test(t);
  if (!toAirport) return { blocked: false, askBack: null };
  // Flug im selben Satz → Leave-by-Kette statt Soft-Block (Taxi-Task bleibt queued)
  if (/\b(flug|fliegen|flieger|abflug|boarding)\b/iu.test(t)) {
    return { blocked: false, askBack: null };
  }
  const hasFlightHint =
    /\b(flug\s*[A-Z]{1,3}\s?\d{2,4}|flugnummer|um\s+\d{1,2}(?::\d{2})?\s*uhr|abflug|terminal)\b/iu.test(
      t,
    ) || /\b(ham|txl|ber|muc|cgn|fra|str|dus|haj|bre|nrw)\b/iu.test(t);
  if (hasFlightHint) return { blocked: false, askBack: null };
  return {
    blocked: true,
    askBack:
      'Welcher Flug bzw. welche Abflugzeit — dann rechne ich Leave-by und das Taxi.',
  };
}

/** Sofort-Nav bei „morgen dahin“? */
export function isPrematureNavStart(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (/\b(jetzt|sofort|gleich|navigation\s+starten|bring\s+mich\s+jetzt)\b/iu.test(t)) {
    return false;
  }
  if (/\b(stopp|stop)\s+(die\s+)?(nav|navigation|route)\b/iu.test(t)) return false;
  const later =
    (/\bmorgen\b/iu.test(t) &&
      !/\bguten\s+morgen\b/iu.test(t) &&
      !/\bheut(?:e)?\s+morgen\b/iu.test(t)) ||
    /\b(übermorgen|uebermorgen|in\s+\d+\s+tagen)\b/iu.test(t);
  const goThere = /\b(dahin|hinfahren|hingehen|hin\s+fahren|route|navigation)\b/iu.test(
    t,
  );
  return later && goThere;
}

/** Kombi: Timer + Wetter o. ä. in einem Satz. */
export function detectComboIntents(text: string): {
  wantsTimer: boolean;
  wantsWeather: boolean;
  wantsReminder: boolean;
} {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return {
    wantsTimer:
      /\b(timer|countdown|erinner\w*\s+(mich\s+)?in\s+\d+|wecker)\b/iu.test(t) ||
      /\bin\s+\d+\s*(min|minute|minuten|sek|sekunden)\b/iu.test(t),
    wantsWeather: /\b(wetter|regnet|regen|temperatur|wie\s+warm|bewölkt|bewoelkt)\b/iu.test(
      t,
    ),
    wantsReminder: /\b(erinner|reminder|denk\s+dran)\b/iu.test(t),
  };
}

export function inferSelfQuestions(text: string): string[] {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  if (/\bferien|schulferien|sommerferien\b/iu.test(t)) {
    out.push('Welche Ferientermine gelten für die genannte Region?');
  }
  if (/\btennis|turnier|konzert|spiel|festival\b/iu.test(t)) {
    out.push('Welche Events passen zum Zeitraum und Ort?');
  }
  if (/\b(elbe|ostsee|nordsee|alster)\b/iu.test(t)) {
    out.push('Welche Orte an diesem Gewässer passen zur Absicht?');
  }
  if (/\b(flug|fliegen|flieger|charter|insel)\b/iu.test(t)) {
    out.push('Welche Flug-/Charter-/Fähr-Optionen gibt es inkl. Preis und Link?');
  }
  if (/\b(turm|was\s+sehe\s+ich|wo\s+bin\s+ich)\b/iu.test(t)) {
    out.push('Welcher POI liegt in Blickrichtung am GPS?');
  }
  if (out.length === 0 && t.length > 40) {
    out.push('Welche Fakten/Orte brauche ich, um DIESE Frage zu beantworten?');
  }
  return out.slice(0, 6);
}

function turnTaskToWorkItem(
  task: TurnWorkTask,
  userText: string,
  proximity: Call1ProximityMode,
): Call1WorkItem {
  const worker = normalizeWorkerId(task.worker) ?? 'chat';
  const inferred = inferExecuteWhen(userText, worker, task.when ?? null);
  const executeWhen =
    task.executeWhen === 'now' ||
    task.executeWhen === 'later' ||
    task.executeWhen === 'on_confirm'
      ? task.executeWhen
      : inferred;
  return {
    id: task.id,
    worker,
    brief: task.brief,
    destCity: task.destCity ?? null,
    proximity,
    executeWhen,
    when: task.when ?? null,
    must: (task.mustHaves ?? []).map((k) => ({
      key: k,
      role: 'must' as const,
      weight: 20,
    })),
    dependsOn: task.dependsOn ?? null,
    blockedByAskBack: false,
    wantBookingLink: /\b(buch|ticket|flug|charter)\b/iu.test(task.brief),
  };
}

function ensureComboWork(
  work: Call1WorkItem[],
  userText: string,
  proximity: Call1ProximityMode,
): Call1WorkItem[] {
  const combo = detectComboIntents(userText);
  const out = [...work];
  const has = (w: Call1WorkerId) => out.some((x) => x.worker === w);
  if (combo.wantsTimer && !has('timer_alarm')) {
    out.push({
      id: 'combo_timer',
      worker: 'timer_alarm',
      brief: 'Timer/Erinnerung aus dem Satz setzen',
      proximity,
      executeWhen: 'now',
    });
  }
  if (combo.wantsWeather && !has('weather')) {
    out.push({
      id: 'combo_weather',
      worker: 'weather',
      brief: 'Wetter-Slots zur Frage liefern',
      proximity,
      executeWhen: 'now',
      neededSlots: ['temp_c', 'sky', 'rain_timing'],
    });
  }
  if (combo.wantsReminder && !combo.wantsTimer && !has('timeline_reminder')) {
    out.push({
      id: 'combo_reminder',
      worker: 'timeline_reminder',
      brief: 'Erinnerung notieren',
      proximity,
      executeWhen: 'now',
    });
  }
  try {
    const { wantsMemoryRecall } = require('./call1MemoryRecallWorker') as {
      wantsMemoryRecall: (s: string) => boolean;
    };
    if (wantsMemoryRecall(userText) && !has('memory_recall')) {
      out.push({
        id: 'combo_memory_recall',
        worker: 'memory_recall',
        brief: 'memory_recall: Besuch/Ort aus Visit-Log erinnern',
        proximity,
        executeWhen: 'now',
      });
    }
  } catch {
    /* soft */
  }
  try {
    const { wantsDeepWebBooking } = require('./call1DeepWebWorker') as {
      wantsDeepWebBooking: (s: string) => boolean;
    };
    if (wantsDeepWebBooking(userText) && !has('deep_web')) {
      out.push({
        id: 'combo_deep_web',
        worker: 'deep_web',
        brief: 'deep_web: Optionen + wantBookingLink aus Live-Web',
        proximity,
        executeWhen: 'now',
        wantBookingLink: true,
      });
    }
  } catch {
    /* soft */
  }
  try {
    const { wantsIdentifyNearby } = require('./call1IdentifyNearbyWorker') as {
      wantsIdentifyNearby: (s: string) => boolean;
    };
    if (wantsIdentifyNearby(userText) && !has('identify_nearby')) {
      out.push({
        id: 'combo_identify_nearby',
        worker: 'identify_nearby',
        brief: 'identify_nearby: GPS+Facing Pack-Match',
        proximity: 'here_now',
        executeWhen: 'now',
      });
    }
  } catch {
    /* soft */
  }
  try {
    const { wantsMapPin } = require('./call1MapPinWorker') as {
      wantsMapPin: (s: string) => boolean;
    };
    if (wantsMapPin(userText) && !has('map_pin')) {
      out.push({
        id: 'combo_map_pin',
        worker: 'map_pin',
        brief: 'map_pin: Ort auf Karte zeigen',
        proximity,
        executeWhen: 'now',
      });
    }
  } catch {
    /* soft */
  }
  try {
    const {
      wantsVoiceSettings,
      wantsDeviceTravelMode,
    } = require('./call1VoiceDeviceWorker') as {
      wantsVoiceSettings: (s: string) => boolean;
      wantsDeviceTravelMode: (s: string) => boolean;
    };
    if (wantsVoiceSettings(userText) && !has('voice_settings')) {
      out.push({
        id: 'combo_voice_settings',
        worker: 'voice_settings',
        brief: 'voice_settings: Stimme umstellen',
        proximity,
        executeWhen: 'now',
      });
    }
    if (wantsDeviceTravelMode(userText) && !has('device_action')) {
      out.push({
        id: 'combo_device_action',
        worker: 'device_action',
        brief: 'device_action: Travel-Mode aus Voice',
        proximity,
        executeWhen: 'now',
      });
    }
  } catch {
    /* soft */
  }
  // Multi-Lane: parallele Worker (Kino|Theater, Fetch→Spot, Outdoor+Wetter, …)
  try {
    const {
      detectMultiLanePlan,
      multiLaneWorkItems,
      inventOpenResearchExtras,
    } = require('./call1MultiLane') as {
      detectMultiLanePlan: (
        s: string,
      ) => import('./call1MultiLane').MultiLanePlan | null;
      multiLaneWorkItems: (
        p: import('./call1MultiLane').MultiLanePlan,
        prox: Call1ProximityMode,
      ) => Call1WorkItem[];
      inventOpenResearchExtras: (
        s: string,
        prox: Call1ProximityMode,
      ) => Call1WorkItem[];
    };
    const plan = detectMultiLanePlan(userText);
    const existing = new Set(out.map((x) => x.id));
    if (plan) {
      for (const item of multiLaneWorkItems(plan, proximity)) {
        if (!existing.has(item.id)) {
          out.push(item);
          existing.add(item.id);
        }
      }
      if (!out.some((x) => x.worker === 'pitch' || isPlaceFamilyWorker(x.worker))) {
        out.push({
          id: 'ml_ensure_pitch',
          worker: 'pitch',
          brief: 'Multi-Lane Pitch zusammenführen',
          proximity,
          executeWhen: 'now',
        });
      }
    }
    // Offene Fragen: Extra-Aufträge auch ohne/mit Plan inventieren
    for (const item of inventOpenResearchExtras(userText, proximity)) {
      if (!existing.has(item.id) && !out.some((x) => x.id === item.id)) {
        out.push(item);
        existing.add(item.id);
      }
    }
  } catch {
    /* soft */
  }
  // Touristen-Invent: Friction / eSIM / Gepäck / FX / Notfall / Tickets / Reservierung
  try {
    const { inventTouristFrictionWork } = require('./call1TouristInvent') as {
      inventTouristFrictionWork: (
        s: string,
        prox: Call1ProximityMode,
      ) => Call1WorkItem[];
    };
    const existing = new Set(out.map((x) => x.id));
    for (const item of inventTouristFrictionWork(userText, proximity)) {
      if (existing.has(item.id)) continue;
      if (
        item.worker === 'deep_web' &&
        out.some((x) => x.worker === 'deep_web')
      ) {
        // Booking-Flag hochziehen
        out.forEach((x) => {
          if (x.worker === 'deep_web' && item.wantBookingLink) {
            x.wantBookingLink = true;
          }
        });
        continue;
      }
      if (
        (item.worker === 'pitch' || item.worker === 'dining') &&
        out.some((x) => isPlaceFamilyWorker(x.worker) || x.worker === 'pitch')
      ) {
        const target = out.find(
          (x) =>
            isPlaceFamilyWorker(x.worker) ||
            x.worker === 'pitch' ||
            x.worker === 'dining',
        );
        if (target && item.must?.length) {
          const seen = new Set(
            (target.must ?? []).map((m) => m.key.toLowerCase()),
          );
          target.must = [
            ...(target.must ?? []),
            ...item.must.filter((m) => {
              const k = m.key.toLowerCase();
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            }),
          ];
          if (/constraint|barriere|reserv/i.test(item.brief)) {
            target.brief = `${target.brief} | ${item.brief}`.slice(0, 220);
          }
        }
        continue;
      }
      out.push(item);
      existing.add(item.id);
    }
  } catch {
    /* soft */
  }
  // Follow-Through: Taxi-Flughafen / Tisch-Reservierung / offener Sport — Root sticky
  try {
    const { inventFollowThroughWork } = require('./missionFollowThrough') as {
      inventFollowThroughWork: (
        s: string,
        prox: Call1ProximityMode,
      ) => Call1WorkItem[];
    };
    const existing = new Set(out.map((x) => x.id));
    for (const item of inventFollowThroughWork(userText, proximity)) {
      if (existing.has(item.id)) continue;
      if (
        item.worker === 'deep_web' &&
        out.some((x) => x.worker === 'deep_web')
      ) {
        out.forEach((x) => {
          if (x.worker === 'deep_web' && item.wantBookingLink) {
            x.wantBookingLink = true;
          }
        });
        continue;
      }
      out.push(item);
      existing.add(item.id);
    }
  } catch {
    /* soft */
  }
  return out.slice(0, 8);
}

/**
 * Work mit dependsOn topologisch ordnen; Blocker markieren/entfernen.
 */
export function sanitizeWorkItems(
  work: Call1WorkItem[],
  opts: {
    userText: string;
    askBack: string | null;
    taxiBlocked: boolean;
  },
): { work: Call1WorkItem[]; runnable: Call1WorkItem[] } {
  let items = work.map((w) => ({ ...w }));

  if (opts.taxiBlocked) {
    items = items.filter((w) => {
      if (w.worker === 'transit' || w.worker === 'nav') {
        return !/\btaxi|uber|flughafen|airport\b/iu.test(w.brief);
      }
      return true;
    });
  }

  // Premature nav: nav later markieren statt feuern
  if (isPrematureNavStart(opts.userText)) {
    items = items.map((w) =>
      w.worker === 'nav' || w.worker === 'transit'
        ? { ...w, executeWhen: 'later' as const }
        : w,
    );
  }

  if (opts.askBack) {
    items = items.map((w) => {
      if (w.blockedByAskBack) return w;
      // Schon als later gequeued (Task-Loop) — nicht auf on_confirm umbiegen
      if (w.executeWhen === 'later' && w.dependsOn) return w;
      if (/\btaxi|uber|bestell\b/iu.test(w.brief)) {
        return {
          ...w,
          blockedByAskBack: true,
          executeWhen: 'on_confirm' as const,
        };
      }
      return w;
    });
  }

  const byId = new Map(items.map((w) => [w.id, w]));
  const sorted: Call1WorkItem[] = [];
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (sorted.some((x) => x.id === id)) return;
    if (visiting.has(id)) return;
    visiting.add(id);
    const node = byId.get(id);
    if (!node) return;
    if (node.dependsOn && byId.has(node.dependsOn)) visit(node.dependsOn);
    sorted.push(node);
    visiting.delete(id);
  };
  for (const w of items) visit(w.id);

  const runnable = sorted.filter(
    (w) =>
      !w.blockedByAskBack &&
      w.executeWhen === 'now' &&
      (!w.dependsOn ||
        sorted.some(
          (d) =>
            d.id === w.dependsOn &&
            !d.blockedByAskBack &&
            d.executeWhen === 'now',
        ) ||
        !byId.has(w.dependsOn || '')),
  );

  return { work: sorted, runnable };
}

function buildCuratedContext(
  analysis: ManagerAnalysis,
  userText: string,
): string[] {
  const out: string[] = [];
  const intent = (analysis.authorIntent || analysis.intentSummary || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (intent) out.push(`Absicht: ${intent.slice(0, 160)}`);
  const city =
    analysis.cityScope?.researchCity ||
    analysis.frame?.destCity ||
    analysis.cityScope?.cityId ||
    null;
  if (city) out.push(`Research-Stadt: ${city}`);
  const subject = (analysis.subject || '').trim();
  if (subject) out.push(`Thema: ${subject.slice(0, 80)}`);
  const refs = analysis.frame?.referents ?? [];
  for (const r of refs.slice(0, 3)) {
    if (r?.name) out.push(`Bezug: ${r.name}${r.role ? ` (${r.role})` : ''}`);
  }
  if (/\bgestern\b/iu.test(userText)) {
    out.push('Follow-up: gestriger Besuch / Recall');
  }
  const must = analysis.mustHaves ?? analysis.frame?.mustHaves ?? [];
  if (must.length) out.push(`Musts: ${must.slice(0, 5).join(', ')}`);
  return out.slice(0, 8);
}

/**
 * Kanonischer Brief aus ManagerAnalysis + UserText.
 */
export function buildCall1TaskBrief(opts: {
  analysis: ManagerAnalysis;
  userText: string;
  call2Tips?: string[] | null;
}): Call1TaskBrief {
  const { analysis } = opts;
  const userText = normalizeAyceStt(opts.userText || '');
  const proximity = inferProximityMode(userText);
  const taxi = detectTaxiAirportBlocker(userText);
  const topicCut =
    analysis.topicScope?.mode === 'new' ||
    analysis.session === 'new' ||
    Boolean(analysis.topicScope && analysis.topicScope.turnsForCall2 === 0);

  const frame = analysis.frame;
  let work: Call1WorkItem[] = (frame?.tasks ?? []).map((t) =>
    turnTaskToWorkItem(t, userText, proximity),
  );
  work = ensureComboWork(work, userText, proximity);

  // Novel / Specialty → deep_web Pflicht wenn noch nicht geplant
  const openWorldPreview = buildOpenWorldContract({
    userText,
    authorIntent: analysis.authorIntent || analysis.intentSummary,
    bridge: analysis.bridge,
    mustHaves: analysis.mustHaves ?? analysis.frame?.mustHaves ?? null,
  });
  if (
    openWorldPreview.novelRequiresDeepWeb &&
    !work.some((w) => w.worker === 'deep_web' || w.worker === 'fact')
  ) {
    work.push({
      id: 'ow_deep_web',
      worker: 'deep_web',
      brief: 'Web/Belege bis Evidenz (Open-World Novel/Specialty)',
      proximity,
      executeWhen: 'now',
      wantBookingLink: openWorldPreview.uiRequirements.needBookingLink,
    });
  }

  // Hotel heute / Taxi / Pauschal-Schnell als Toolbox-Komposition
  if (
    /\b(hotel|übernacht|uebernacht|zimmer\s+für\s+heute)\b/iu.test(userText) &&
    !work.some((w) => w.worker === 'hotel' || isPlaceFamilyWorker(w.worker))
  ) {
    work.push({
      id: 'ow_hotel',
      worker: 'hotel',
      brief: 'Hotel heute / schnell — Links+Maps, kein Wizard',
      proximity,
      executeWhen: 'now',
      wantBookingLink: true,
    });
  }
  // Phase 5a: Amenity/Open-Need/Erlebnis → Pitch-Worker
  try {
    const { isAmenityPlaceFindQuery } = require('../mission/amenityPlaceFind') as {
      isAmenityPlaceFindQuery: (s: string) => boolean;
    };
    const { isOpenNeedQuery, isOpenExperienceQuery } = require('../mission/openPlaceFind') as {
      isOpenNeedQuery: (s: string) => boolean;
      isOpenExperienceQuery: (s: string) => boolean;
    };
    if (
      (isAmenityPlaceFindQuery(userText) ||
        isOpenNeedQuery(userText) ||
        isOpenExperienceQuery(userText)) &&
      !work.some((w) => isPlaceFamilyWorker(w.worker) || w.worker === 'pitch')
    ) {
      work.push({
        id: 'ow_open_need_pitch',
        worker: 'pitch',
        brief: isOpenExperienceQuery(userText)
          ? 'Erlebnis/Thema suchen — Pack nur mit Attraction-Beleg, sonst Places/Web, Top-2'
          : 'Open-Need Ort suchen — Places/Harvest bis Evidenz, Top-2 Pitch',
        proximity,
        executeWhen: 'now',
      });
    }
  } catch {
    /* soft */
  }
  // Fakt-Fragen ohne Worker → fact (Papst-Alter & Co.) — Call-2 braucht Belege
  if (
    openWorldPreview.answerSlot === 'fact' &&
    !work.some((w) => w.worker === 'fact' || w.worker === 'deep_web' || w.worker === 'chat')
  ) {
    work.push({
      id: 'ow_fact',
      worker: 'fact',
      brief: 'Fakt/Beleg live recherchieren — Datensatz leer ok, Web Pflicht',
      proximity,
      executeWhen: 'now',
    });
  }
  if (
    /\b(taxi|uber|bolt)\b/iu.test(userText) &&
    !taxi.blocked &&
    !work.some((w) => w.worker === 'taxi' || w.worker === 'transit')
  ) {
    work.push({
      id: 'ow_taxi',
      worker: 'taxi',
      brief: 'Taxi/Uber Just-Do-It Deep-Link',
      proximity,
      executeWhen: inferExecuteWhen(userText, 'taxi'),
    });
  }
  if (
    /\b(pauschal|package|all[\s-]?inclusive\s+reise)\b/iu.test(userText) &&
    !/\breise\s+planen|kurztrip|flug\s*\+\s*hotel\b/iu.test(userText) &&
    !work.some((w) => w.worker === 'package_quick' || w.worker === 'reisebuero')
  ) {
    work.push({
      id: 'ow_package',
      worker: 'package_quick',
      brief: 'Pauschal/Stay Schnelllinks — kein Reisebüro-Interview',
      proximity,
      executeWhen: 'now',
      wantBookingLink: true,
    });
  }

  // Flug→Leave-by→Taxi: Task 2 immer in work[] (nie droppen); runnable erst wenn Abflugzeit da
  if (
    /\b(flug|fliegen|flieger|abflug)\b/iu.test(userText) &&
    /\btaxi|uber\b/iu.test(userText)
  ) {
    const hasFlight = work.some((w) => w.worker === 'flight');
    const hasTransit = work.some(
      (w) => w.worker === 'transit' || w.worker === 'nav' || w.worker === 'taxi',
    );
    const flightId =
      work.find((w) => w.worker === 'flight')?.id ?? 'chain_flight';
    const leaveByReady =
      /\b(?:um\s+)?\d{1,2}(?::\d{2})?\s*uhr\b/iu.test(userText) ||
      /\bflug\s*[A-Z]{1,3}\s?\d{2,4}\b/iu.test(userText) ||
      /\b(abflug|terminal)\b/iu.test(userText);
    const taxiWhen = leaveByReady ? ('now' as const) : ('later' as const);
    if (!hasFlight) {
      work.unshift({
        id: 'chain_flight',
        worker: 'flight',
        brief:
          'Task 1: Flug matchen → Leave-by → wann am Terminal — noch kein Taxi',
        proximity,
        executeWhen: 'now',
        wantBookingLink: false,
      });
    }
    if (!hasTransit) {
      work.push({
        id: 'chain_taxi',
        worker: 'transit',
        brief:
          'Task 2 nach Leave-by: Taxi/Uber Deep-Link mit Abholzeit = Leave-by — Just-Do-It, nicht vergessen',
        proximity,
        executeWhen: taxiWhen,
        dependsOn: flightId,
        wantBookingLink: true,
      });
    } else {
      work = work.map((w) =>
        w.worker === 'transit' ||
        w.worker === 'taxi' ||
        (w.worker === 'nav' && /\btaxi/i.test(w.brief))
          ? {
              ...w,
              dependsOn: w.dependsOn || flightId,
              executeWhen: taxiWhen,
              wantBookingLink: true,
              brief: /Deep-Link|Leave-by|Task 2/i.test(w.brief)
                ? w.brief
                : `${w.brief} — Task 2 nach Leave-by: Deep-Link Just-Do-It`.slice(
                    0,
                    220,
                  ),
            }
          : w,
      );
    }
  }

  // Reisebegleiter: Timeline-Anker + Pack-als-Cache Intent (vor authorIntent)
  let foresightAddon = '';
  let foresightAsk: string | null = null;
  try {
    const {
      detectTimelineForesight,
      foresightAskBack,
      picnicForesightAuthorIntent,
      packAsCacheAuthorIntent,
    } = require('./travelCompanionForesight') as {
      detectTimelineForesight: (o: {
        userText: string;
        stops?: unknown;
      }) => { askBackHint: string | null; authorIntentAddon: string } | null;
      foresightAskBack: (
        h: { askBackHint: string | null } | null,
      ) => string | null;
      picnicForesightAuthorIntent: (s: string) => string;
      packAsCacheAuthorIntent: () => string;
    };
    const { useFuturePlanStore } = require('../timeline/futurePlanState') as {
      useFuturePlanStore: {
        getState: () => { plan: { stops?: unknown[] } | null };
      };
    };
    const stops = useFuturePlanStore.getState().plan?.stops ?? [];
    const hit = detectTimelineForesight({ userText, stops });
    foresightAsk = foresightAskBack(hit);
    if (hit?.authorIntentAddon) foresightAddon = hit.authorIntentAddon;
    try {
      const { looksLikePicnicQuery } = require('../pitch/picnicIntent') as {
        looksLikePicnicQuery: (s: string) => boolean;
      };
      if (looksLikePicnicQuery(userText)) {
        foresightAddon = [foresightAddon, picnicForesightAuthorIntent(userText)]
          .filter(Boolean)
          .join('. ');
      }
    } catch {
      /* soft */
    }
    if (!foresightAddon) foresightAddon = packAsCacheAuthorIntent();
  } catch {
    /* soft */
  }
  try {
    const {
      intentForesightAuthorIntent,
      isClosedFactAsk,
    } = require('./call1IntentForesight') as {
      intentForesightAuthorIntent: (s: string) => string;
      isClosedFactAsk: (s: string) => boolean;
    };
    if (isClosedFactAsk(userText)) {
      foresightAddon = [
        foresightAddon,
        'Geschlossene Faktfrage: direkte Antwort + STOP — kein Ort-Pitch, kein Extra-Invent',
      ]
        .filter(Boolean)
        .join('. ');
    } else {
      const intentFs = intentForesightAuthorIntent(userText);
      if (intentFs) {
        foresightAddon = [foresightAddon, intentFs].filter(Boolean).join('. ');
      }
    }
  } catch {
    /* soft */
  }
  try {
    const { touristInventAuthorIntent } = require('./call1TouristInvent') as {
      touristInventAuthorIntent: (s: string) => string;
    };
    const ti = touristInventAuthorIntent(userText);
    if (ti) {
      foresightAddon = [foresightAddon, ti].filter(Boolean).join('. ');
    }
  } catch {
    /* soft */
  }
  try {
    const {
      syncFollowThroughGoal,
      followThroughAuthorIntent,
      controlDistanceAuthorIntent,
      openWorldAgentAuthorIntent,
      getFollowThroughGoal,
      looksLikeOpenQuest,
    } = require('./missionFollowThrough') as {
      syncFollowThroughGoal: (s: string) => unknown;
      followThroughAuthorIntent: (g: unknown) => string;
      controlDistanceAuthorIntent: (o: {
        needBookingLink?: boolean;
        criticalPending?: boolean;
      }) => string;
      openWorldAgentAuthorIntent: () => string;
      getFollowThroughGoal: () => unknown;
      looksLikeOpenQuest: (s: string) => boolean;
    };
    syncFollowThroughGoal(userText);
    const ft = followThroughAuthorIntent(getFollowThroughGoal());
    if (ft) {
      foresightAddon = [foresightAddon, ft].filter(Boolean).join('. ');
    } else if (openWorldPreview.uiRequirements.needBookingLink) {
      foresightAddon = [
        foresightAddon,
        controlDistanceAuthorIntent({
          needBookingLink: true,
          criticalPending: Boolean(taxi.askBack || analysis.askBack),
        }),
      ]
        .filter(Boolean)
        .join('. ');
    }
    if (
      (looksLikeOpenQuest(userText) || getFollowThroughGoal()) &&
      !/Open-World:/i.test(foresightAddon || '')
    ) {
      foresightAddon = [foresightAddon, openWorldAgentAuthorIntent()]
        .filter(Boolean)
        .join('. ');
    }
  } catch {
    /* soft */
  }

  let authorIntent = [
    (analysis.authorIntent || analysis.intentSummary || '')
      .replace(/\s+/g, ' ')
      .trim(),
    foresightAddon,
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 720);

  const researchCity =
    analysis.cityScope?.researchCity ||
    analysis.frame?.destCity ||
    analysis.cityScope?.cityId ||
    null;

  const openWorld = buildOpenWorldContract({
    userText,
    authorIntent,
    bridge: analysis.bridge,
    mustHaves: [
      ...(analysis.mustHaves ?? analysis.frame?.mustHaves ?? []),
      ...openWorldPreview.must,
    ],
    avoid: openWorldPreview.avoid,
    order: analysis.order ?? null,
    researchCity,
  });

  // Phase 3: Ask-Back nur Taxi-Blocker ODER Mission critical — nie Ambiguity/Permission
  const resolvedAsk = resolveMissionAskBack({
    userText,
    mission: openWorld.mission,
    taxiBlocked: taxi.blocked,
    taxiAskBack: taxi.askBack,
    llmAskBack: analysis.askBack || null,
  });
  let askBack = resolvedAsk.askBack;
  if (foresightAsk && !askBack && !taxi.blocked) {
    askBack = foresightAsk;
  }

  // Medical/Verletzung/Zahn: nie „Für wen?“ — Person/Symptom reicht
  try {
    const { detectEmergencyIntent } = require('../../services/concierge/emergencyConcierge') as {
      detectEmergencyIntent: (t: string) => string | null;
    };
    if (askBack && detectEmergencyIntent(userText)) {
      askBack = null;
    }
  } catch {
    /* soft */
  }
  if (
    askBack &&
    /für\s+wen/iu.test(askBack) &&
    /\b(freundin|freund|sohn|tochter|kind|partnerin|partner|mann|frau|mutter|vater|gebrochen|zahnschmerz|zahnweh|verstaucht)\b/iu.test(
      userText,
    )
  ) {
    askBack = null;
  }

  // Dining/Museum lösbar → nie Permission (Belt, falls LLM durchrutscht)
  if (
    askBack &&
    !taxi.blocked &&
    (looksLikeAyceQuery(userText) ||
      /\b(museum|hop[\s-]?on|speisekarte|ticket|basketball|tischtennis)\b/iu.test(
        userText,
      ))
  ) {
    if (!openWorld.mission.askBack) askBack = null;
  }

  const { work: sorted0, runnable: runnable0 } = sanitizeWorkItems(work, {
    userText,
    askBack,
    taxiBlocked: taxi.blocked,
  });

  // Gap-Engine: Presence / Surprise-Anchor → Tasks vorschieben
  let sorted = sorted0;
  let runnable = runnable0;
  let gapIntentAddon = '';
  try {
    const { applyMissionGapsToWork } = require('./applyMissionGaps') as {
      applyMissionGapsToWork: (o: {
        userText: string;
        work: Call1WorkItem[];
        proximity?: Call1ProximityMode;
        researchCity?: string | null;
        existingAnchorName?: string | null;
      }) => {
        work: Call1WorkItem[];
        plan: {
          deriveFirst: string[];
          presence?: unknown;
          setAnchor?: { name: string } | null;
          gaps: Array<{ kind: string }>;
        };
      };
    };
    const { getFollowThroughGoal } = require('./missionFollowThrough') as {
      getFollowThroughGoal: () => {
        auftrag?: { anchor?: { name?: string } | null } | null;
      } | null;
    };
    const g0 = getFollowThroughGoal();
    const gapped = applyMissionGapsToWork({
      userText,
      work: sorted,
      proximity,
      researchCity:
        analysis.cityScope?.researchCity ||
        analysis.frame?.destCity ||
        null,
      existingAnchorName: g0?.auftrag?.anchor?.name ?? null,
    });
    sorted = gapped.work;
    if (gapped.plan.gaps.length) {
      gapIntentAddon = [
        'Gap-Engine aktiv',
        gapped.plan.gaps.map((g) => g.kind).join('+'),
        gapped.plan.deriveFirst.slice(0, 2).join('; '),
        gapped.plan.setAnchor?.name
          ? `Anchor=${gapped.plan.setAnchor.name}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    // Auftrag Sticky mit Presence/Anchor mergen (wenn Root da)
    try {
      const {
        getFollowThroughGoal: getFt,
        syncFollowThroughGoal,
      } = require('./missionFollowThrough') as {
        getFollowThroughGoal: () => {
          kind: string;
          rootLabel: string;
          slots: unknown;
          needBookingLink: boolean;
          auftrag?: unknown;
          startedAtMs: number;
        } | null;
        syncFollowThroughGoal: (s: string) => unknown;
      };
      const {
        buildAuftragMemory,
        mirrorAuftragWishToSessionRoot,
      } = require('./missionAuftragMemory') as {
        buildAuftragMemory: (o: Record<string, unknown>) => {
          wish: string;
        };
        mirrorAuftragWishToSessionRoot: (w: string) => void;
      };
      syncFollowThroughGoal(userText);
      const ft = getFt();
      if (ft && gapped.plan.gaps.length) {
        const mem = buildAuftragMemory({
          kind: ft.kind,
          rootLabel: ft.rootLabel,
          slots: ft.slots,
          work: sorted,
          needBookingLink: ft.needBookingLink,
          prev: ft.auftrag,
          presence: gapped.plan.presence ?? null,
          anchor: gapped.plan.setAnchor ?? null,
          gaps: gapped.plan.gaps.map((g) => ({
            kind: g.kind,
            summary:
              g.kind === 'presence'
                ? 'GPS≠Zielstadt'
                : g.kind === 'surprise_anchor'
                  ? 'Ticket/Theater-Anker'
                  : g.kind,
          })),
        });
        const { upsertFollowThroughAuftrag } = require('./missionFollowThrough') as {
          upsertFollowThroughAuftrag?: (m: unknown) => void;
        };
        if (typeof upsertFollowThroughAuftrag === 'function') {
          upsertFollowThroughAuftrag(mem);
        }
        mirrorAuftragWishToSessionRoot(mem.wish);
      }
    } catch {
      /* soft */
    }
  } catch {
    /* soft */
  }

  // Task-Loop: Ziel → invent → herleiten → nur Blocker → später nachlegen
  try {
    const { runMissionTaskLoop } = require('./missionTaskLoop') as {
      runMissionTaskLoop: (o: {
        userText: string;
        wish?: string | null;
        work: Call1WorkItem[];
        auftrag?: unknown;
        existingAskBack?: string | null;
        flightTime?: string | null;
        luggage?: string | null;
        accessLeg?: string | null;
      }) => {
        work: Call1WorkItem[];
        askBack: string | null;
        loopIntent: string;
        wish: string;
      };
    };
    const { getFollowThroughGoal } = require('./missionFollowThrough') as {
      getFollowThroughGoal: () => {
        rootLabel?: string;
        auftrag?: unknown;
        slots?: {
          flightTime?: string | null;
          luggage?: string | null;
          accessLeg?: string | null;
        };
      } | null;
    };
    const g = getFollowThroughGoal();
    const wishFromAuftrag =
      (g?.auftrag as { wish?: string } | null | undefined)?.wish ||
      g?.rootLabel ||
      authorIntent.slice(0, 160);
    const loop = runMissionTaskLoop({
      userText,
      wish: wishFromAuftrag,
      work: sorted,
      auftrag: g?.auftrag ?? null,
      existingAskBack: askBack,
      flightTime: g?.slots?.flightTime ?? null,
      luggage: g?.slots?.luggage ?? null,
      accessLeg: g?.slots?.accessLeg ?? null,
    });
    sorted = loop.work;
    // Loop-Ask nur wenn noch kein Ask und echter Blocker (Taxi-ohne-Flug bleibt existing)
    if (loop.askBack && !askBack) {
      askBack = loop.askBack;
    }
    if (loop.loopIntent && !/Task-Loop:/i.test(authorIntent)) {
      authorIntent = [authorIntent, loop.loopIntent, gapIntentAddon]
        .filter(Boolean)
        .join('. ')
        .slice(0, 900);
    } else if (gapIntentAddon && !/Gap-Engine/i.test(authorIntent)) {
      authorIntent = [authorIntent, gapIntentAddon]
        .filter(Boolean)
        .join('. ')
        .slice(0, 900);
    }
    const sanitized = sanitizeWorkItems(sorted, {
      userText,
      askBack,
      taxiBlocked: taxi.blocked,
    });
    sorted = sanitized.work;
    runnable = sanitized.runnable;
  } catch {
    /* soft */
  }

  const selfQuestions =
    inferSelfQuestions(userText).length > 0
      ? inferSelfQuestions(userText)
      : (frame?.thinkAhead ?? []).slice(0, 4);

  const curatedRaw = buildCuratedContext(analysis, userText);
  const curatedContext = filterCuratedContextForWorkers(curatedRaw, userText);

  let bridgeCompleteFlag =
    Boolean(analysis.bridgeComplete) || Boolean(askBack);
  try {
    const { resolveBridgeCompleteFlag } = require('./call1BridgeCompleteGate') as {
      resolveBridgeCompleteFlag: (o: {
        userText: string;
        claimedComplete: boolean;
        askBack: string | null;
        runnableWorkCount: number;
        novelRequiresDeepWeb?: boolean;
      }) => boolean;
    };
    bridgeCompleteFlag = resolveBridgeCompleteFlag({
      userText,
      claimedComplete: bridgeCompleteFlag,
      askBack,
      runnableWorkCount: runnable.length,
      novelRequiresDeepWeb: openWorld.novelRequiresDeepWeb,
    });
  } catch {
    // Fallback: nie skippen wenn Work läuft
    if (runnable.length > 0) bridgeCompleteFlag = false;
  }

  return {
    bridge: analysis.bridge ?? null,
    bridgeComplete: bridgeCompleteFlag,
    session: topicCut ? 'new' : 'followup',
    topicCut,
    curatedContext,
    authorIntent,
    selfQuestions,
    call2Tips: (opts.call2Tips ?? []).slice(0, 6),
    askBack,
    goldPolicy: 'adapt',
    researchCity,
    proximity,
    work: sorted,
    runnableWork: runnable,
    openWorld: {
      ...openWorld,
      bridgeIntentMirror: (analysis.bridge || '').trim().slice(0, 280) || null,
      authorIntent,
      // Mission.askBack mit finaler Resolution syncen
      mission: {
        ...openWorld.mission,
        askBack,
      },
    },
  };
}

/** Frame-Tasks nach Brief-Timing härten (in-place friendly). */
export function applyBriefTimingToFrame(
  frame: TurnFrame | null | undefined,
  userText: string,
): TurnFrame | null {
  if (!frame) return null;
  if (!isPrematureNavStart(userText)) return frame;
  const tasks = frame.tasks.map((t) => {
    if (t.worker !== 'nav' && t.worker !== 'transit') return t;
    return {
      ...t,
      brief: `${t.brief} [executeWhen=later — nicht jetzt starten]`.slice(0, 220),
    };
  });
  return { ...frame, tasks };
}
