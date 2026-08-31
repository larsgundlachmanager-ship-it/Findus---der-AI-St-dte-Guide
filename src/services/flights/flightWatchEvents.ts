/**
 * Live-Watch Sprache + Leave-Shift — pure, ohne RN.
 * Wortlaut = Fallback-Blaupause, keine Orts-Skripte.
 */

import type { QuickAction } from '../../types/concierge';
import { lookupAirlineHotline } from './airlineHotline';

const ASK_SEARCH_RE =
  /\bsoll\s+ich\b.*\b(suchen|ersatz|alternativ|heraus)\b|\bsobald\s+du\s+willst\b/iu;

export function watchClock(d: Date | number | null | undefined): string {
  if (d == null) return '—';
  const dt = typeof d === 'number' ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return '—';
  return `${dt.getHours().toString().padStart(2, '0')}:${dt
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

export function flightLooksCancelled(flight: {
  cancelled?: boolean;
  status?: string | null;
}): boolean {
  if (flight.cancelled) return true;
  return /cancel/i.test(flight.status ?? '');
}

/**
 * Timeline immer nachziehen. Neue Los-Zeit nur sagen, wenn sie noch hilft:
 * noch nicht los, neue Zeit in der Zukunft, und spürbar später.
 */
export type FlightWatchPhase = 'remote' | 'landside' | 'airside' | 'airborne' | 'landed';

export function inferFlightWatchPhase(opts: {
  untilMs: number;
  distM: number | null;
  nearAirport: boolean;
  leavePassed: boolean;
  departed: boolean;
  arrived: boolean;
}): FlightWatchPhase {
  if (opts.arrived) return 'landed';
  if (opts.departed) return 'airborne';
  if (opts.distM != null && opts.distM <= 700 && opts.untilMs <= 90 * 60_000) {
    return 'airside';
  }
  if (opts.nearAirport && opts.untilMs <= 40 * 60_000) return 'airside';
  if (opts.leavePassed || opts.nearAirport) return 'landside';
  return 'remote';
}

export function shouldSpeakWatchGate(phase: FlightWatchPhase): boolean {
  return phase === 'airside';
}

export function shouldSpeakWatchTerminal(phase: FlightWatchPhase): boolean {
  return phase === 'landside';
}

export function shouldSpeakWatchBag(phase: FlightWatchPhase): boolean {
  return phase === 'landed';
}

/** FIDS/Aero laggt oft ein paar Minuten hinter actual_out. */
export const PRE_DEPARTURE_GRACE_MS = 8 * 60_000;

export type FlightBoardKind =
  | 'scheduled'
  | 'boarding'
  | 'last_call'
  | 'departed'
  | 'cancelled'
  | 'unknown';

export function classifyBoardStatus(
  status: string | null | undefined,
): FlightBoardKind {
  const s = (status ?? '').trim();
  if (!s) return 'unknown';
  if (/cancel|gestrichen|annul/i.test(s)) return 'cancelled';
  if (/last\s*call|letzter\s*aufruf|final\s*call|gate\s*closing/i.test(s)) {
    return 'last_call';
  }
  if (/board|einsteig|gate\s*open/i.test(s)) return 'boarding';
  if (
    /depart|airborne|taxi|gate\s*closed|abgeflogen|departed/i.test(s)
  ) {
    return 'departed';
  }
  return /sched|on\s*time|delay|verspät/i.test(s) ? 'scheduled' : 'unknown';
}

/**
 * Verspätung/Gate/Boarding nur solange der Abflug noch vor dem User liegt.
 * Screenshot-Fall: +20 Min, Abflug 11:16, App auf um 11:51 → tot.
 */
export function isPreDepartureAlertLive(opts: {
  nowMs: number;
  liveDepMs: number | null;
  actualOut?: boolean;
  cancelled?: boolean;
  status?: string | null;
}): boolean {
  if (opts.cancelled) return false;
  if (opts.actualOut) return false;
  const board = classifyBoardStatus(opts.status);
  if (board === 'departed' || board === 'cancelled') return false;
  if (opts.liveDepMs == null || !Number.isFinite(opts.liveDepMs)) return false;
  return opts.liveDepMs + PRE_DEPARTURE_GRACE_MS > opts.nowMs;
}

export function shouldSpeakWatchDelay(
  phase: FlightWatchPhase,
  untilMs: number,
): boolean {
  if (phase === 'landed' || phase === 'airborne') return false;
  if (untilMs < -PRE_DEPARTURE_GRACE_MS) return false;
  if (phase === 'airside' || phase === 'landside') return true;
  return untilMs <= 24 * 3600_000;
}

/** Gate-Push auch landside / kurz vor Abflug — nicht erst airside. */
export function shouldPushWatchGate(
  phase: FlightWatchPhase,
  untilMs: number,
): boolean {
  if (phase === 'landed' || phase === 'airborne') return false;
  if (untilMs < -PRE_DEPARTURE_GRACE_MS) return false;
  if (phase === 'airside' || phase === 'landside') return true;
  return untilMs <= 2 * 3600_000;
}

export function shouldAnnounceBoarding(opts: {
  boardKind: FlightBoardKind;
  untilMs: number;
  boardingWindowMs: number;
  phase: FlightWatchPhase;
  announcedBoarding: boolean;
  announcedLastCall: boolean;
}): boolean {
  if (opts.phase === 'landed' || opts.phase === 'airborne') return false;
  if (opts.untilMs < -PRE_DEPARTURE_GRACE_MS) return false;
  if (opts.boardKind === 'last_call') return !opts.announcedLastCall;
  if (opts.announcedBoarding) return false;
  if (opts.boardKind === 'boarding') return true;
  if (opts.untilMs <= 0 || opts.untilMs > opts.boardingWindowMs) return false;
  return (
    opts.phase === 'landside' ||
    opts.phase === 'airside' ||
    opts.untilMs <= 45 * 60_000
  );
}

/**
 * OS-Push für Boarding nur in der Zukunft planen.
 * Liegt der Slot in der Vergangenheit (App erst nach Abflug auf), nicht nachträglich knallen —
 * der Live-Tick übernimmt Boarding, solange der Flug noch nicht weg ist.
 */
export function shouldScheduleBoardingPush(opts: {
  nowMs: number;
  liveDepMs: number | null;
  actualOut?: boolean;
  cancelled?: boolean;
  announcedBoarding: boolean;
  boardingWindowMin: number;
}): number | null {
  if (opts.announcedBoarding || opts.cancelled) return null;
  if (
    !isPreDepartureAlertLive({
      nowMs: opts.nowMs,
      liveDepMs: opts.liveDepMs,
      actualOut: opts.actualOut,
      cancelled: opts.cancelled,
    })
  ) {
    return null;
  }
  if (opts.liveDepMs == null || !Number.isFinite(opts.liveDepMs)) return null;
  const fireAt = opts.liveDepMs - opts.boardingWindowMin * 60_000;
  if (fireAt <= opts.nowMs + 15_000) return null;
  return fireAt;
}

export function buildBoardingWatchSpeech(opts: {
  ident: string;
  gate: string | null;
  lastCall: boolean;
}): string {
  const ident = opts.ident.replace(/\s+/g, '');
  const gate = opts.gate ? ` Gate ${opts.gate}` : '';
  if (opts.lastCall) {
    return `${ident}: letzter Aufruf${gate ? ` — lauf zu${gate}` : '. Lauf jetzt zum Gate'}.`;
  }
  return `${ident}: Boarding hat begonnen${gate ? ` — lauf jetzt zu${gate}` : '. Lauf jetzt zum Gate'}.`;
}

export function buildTrainArrivingSpeech(opts: {
  title: string;
  kind: 'train' | 'bus';
  platform?: string | null;
}): string {
  const vehicle = opts.kind === 'bus' ? 'Bus' : 'Zug';
  const plat = opts.platform?.trim()
    ? ` Gleis ${opts.platform.trim()}.`
    : '';
  return `${opts.title}: ${vehicle} fährt in einer Minute ein.${plat}`;
}

export function buildTransitDelaySpeech(opts: {
  title: string;
  delayMin: number;
  platform?: string | null;
}): string {
  const delay = Math.round(opts.delayMin);
  const plat = opts.platform?.trim()
    ? ` Gleis ${opts.platform.trim()}.`
    : '';
  return `${opts.title} hat rund ${delay} Minuten Verspätung.${plat}`;
}

export function buildTerminalWatchSpeech(opts: {
  ident: string;
  terminal: string;
  prevTerminal: string | null;
}): string {
  const ident = opts.ident.replace(/\s+/g, '');
  if (opts.prevTerminal && opts.prevTerminal !== opts.terminal) {
    return `Terminal-Wechsel bei ${ident}: jetzt Terminal ${opts.terminal}.`;
  }
  return `${ident} checkt in Terminal ${opts.terminal} ein.`;
}

export function shouldSpeakLeaveShift(opts: {
  prevLeaveMs: number | null;
  nextLeaveMs: number;
  nowMs: number;
}): boolean {
  if (!Number.isFinite(opts.nextLeaveMs)) return false;
  if (opts.nextLeaveMs <= opts.nowMs + 8 * 60_000) return false;
  if (opts.prevLeaveMs == null) return false;
  if (opts.nowMs >= opts.prevLeaveMs - 2 * 60_000) return false;
  return opts.nextLeaveMs - opts.prevLeaveMs >= 12 * 60_000;
}

export function buildGateWatchSpeech(opts: {
  ident: string;
  gate: string;
  prevGate: string | null;
}): string {
  const ident = opts.ident.replace(/\s+/g, '');
  if (opts.prevGate && opts.prevGate !== opts.gate) {
    return `Gate-Wechsel bei ${ident}: statt ${opts.prevGate} jetzt Gate ${opts.gate}.`;
  }
  return `Dein Gate steht — ${opts.gate}.`;
}

export function buildBagWatchSpeech(opts: {
  destLabel: string;
  bag: string;
}): string {
  return `In ${opts.destLabel} kommt das Gepäck auf Band ${opts.bag}.`;
}

export function buildDelayWatchSpeech(opts: {
  ident: string;
  delayMin: number;
  depMs: number | null;
  leaveMs?: number | null;
  speakLeave: boolean;
}): string {
  const ident = opts.ident.replace(/\s+/g, '');
  const dep = watchClock(opts.depMs);
  const delay = Math.round(opts.delayMin);
  const core = `${ident} hat rund ${delay} Minuten Verspätung — Abflug eher ${dep}.`;
  if (opts.speakLeave && opts.leaveMs != null) {
    return `${core} Los verschiebt sich auf ${watchClock(opts.leaveMs)} — steht so im Plan.`;
  }
  return core;
}

export function buildCancelWatchSpeech(opts: {
  ident: string;
  destLabel: string;
  altIdent?: string | null;
  altClock?: string | null;
  airlineName?: string | null;
}): { speech: string; bullets: string[] } {
  const ident = opts.ident.replace(/\s+/g, '');
  const alt =
    opts.altIdent && opts.altClock
      ? ` Nächster sinnvoller: ${opts.altIdent} um ${opts.altClock}.`
      : ' Auf der Strecke liegt gerade kein Ersatz — Suche und Hotline sind am Button.';
  const phone = opts.airlineName
    ? ` ${opts.airlineName} erreichst du direkt.`
    : '';
  const speech = `${ident} nach ${opts.destLabel} fällt aus.${alt}${phone}`;
  const bullets = [
    `${ident} ausgefallen`,
    opts.altIdent && opts.altClock
      ? `${opts.altIdent} ${opts.altClock}`
      : 'Kein Ersatz heute',
    opts.airlineName ? opts.airlineName : 'Airline',
  ].slice(0, 3);
  return { speech, bullets };
}

export function cancelSpeechAsksPermission(speech: string): boolean {
  return ASK_SEARCH_RE.test(speech);
}

export function buildCancelWatchActions(opts: {
  cancelledIdent: string;
  altIdent?: string | null;
  altClock?: string | null;
  kiwiUrl?: string | null;
}): QuickAction[] {
  const actions: QuickAction[] = [];
  if (opts.altIdent && opts.altClock) {
    actions.push({
      type: 'SHOW_MORE',
      label: `${opts.altIdent} ${opts.altClock}`.slice(0, 22),
      payload: {
        textPrompt: `Nimm Flug ${opts.altIdent} um ${opts.altClock}`,
      },
    });
  }
  const hotline = lookupAirlineHotline(opts.cancelledIdent);
  if (hotline) {
    actions.push({
      type: 'DIAL_PHONE',
      label: `📞 ${hotline.name}`,
      payload: { phoneNumber: hotline.e164 },
    });
  }
  if (opts.kiwiUrl) {
    actions.push({
      type: 'OPEN_URL',
      label: 'Flüge ansehen',
      payload: { url: opts.kiwiUrl },
    });
  }
  return actions.slice(0, 5);
}
