/**
 * Timeline-Visualik: Tone (gelb/rot/grün), Transport-Emote, Key-Times, Pfeile.
 */

import type { DayPlanItem } from '../../types/dayPlan';
import { effectiveTimes } from './planVsActual';

/** Optionale Wünsche (Blau) — soft Suggestions ohne Pflicht. */
export function isWishItem(item: DayPlanItem): boolean {
  if (item.hardDeadline) return false;
  if (item.meta?.userRequested === true) return false;
  if (item.meta?.wish === true) return true;
  if (item.meta?.findusSuggestion === true && !item.timed) return true;
  if (item.kind === 'todo' && item.meta?.findusSuggestion === true) return true;
  const t = `${item.title} ${item.notes ?? ''}`.toLowerCase();
  return /\b(wunsch|optional|könnte|koennte|vielleicht|nice.to.have|wenn\s+zeit)\b/i.test(
    t,
  );
}

export type TimelineTone =
  | 'default'
  | 'uncertain'
  | 'conflict'
  | 'trigger'
  | 'wish';

export type TimelineVisual = {
  tone: TimelineTone;
  /** Hintergrund / Rand der Karte */
  cardBg: string;
  borderColor: string;
  railColor: string;
  /** 🚶 🚆 🚕 … */
  modeEmoji: string;
  /** Wichtige Uhrzeit fett */
  boldTime: boolean;
  /** Pfeil-Marker (→) auf Key/Trigger */
  showArrow: boolean;
  arrowLabel: string | null;
  badgeLabel: string | null;
  hint: string | null;
};

const COLORS = {
  uncertainBg: 'rgba(232,145,58,0.18)',
  uncertainBorder: '#E8913A',
  conflictBg: 'rgba(217,107,92,0.2)',
  conflictBorder: '#D96B5C',
  triggerBg: 'rgba(61,207,122,0.18)',
  triggerBorder: '#3DCF7A',
  wishBg: 'rgba(61,124,255,0.16)',
  wishBorder: '#3D7CFF',
  defaultBorder: 'rgba(244,239,230,0.12)',
  defaultRail: '#C4A35A',
};

export function transportEmojiForItem(item: DayPlanItem): string {
  const blob = `${item.kind} ${item.title} ${item.notes ?? ''} ${item.placeName ?? ''}`.toLowerCase();
  if (item.kind === 'flight' || /\bflug|airport|flughafen\b/i.test(blob)) return '✈️';
  if (item.kind === 'taxi' || /\btaxi|uber|bolt\b/i.test(blob)) return '🚕';
  if (/\brad|fahrrad|bike\b/i.test(blob)) return '🚴';
  if (
    item.kind === 'transit' ||
    /\b(ice|ic\b|re\s?\d|rb\s?\d|zug|bahn|s-bahn|öpnv|u-bahn|bus)\b/i.test(blob)
  ) {
    return '🚆';
  }
  if (item.kind === 'nav' || /\bfuß|laufen|zu\s+fuß|walk|unterwegs\b/i.test(blob)) {
    return '🚶';
  }
  if (item.kind === 'parking' || /\bpark|auto\b/i.test(blob)) return '🅿️';
  if (item.kind === 'meal' || item.kind === 'breakfast') return '🍽️';
  if (
    item.kind === 'hotel' ||
    item.kind === 'checkin' ||
    item.kind === 'checkout' ||
    item.kind === 'pack'
  ) {
    return '🏨';
  }
  if (item.kind === 'weather') return '🌧️';
  if (item.kind === 'wake') return '⏰';
  if (item.kind === 'sunset') return '🌅';
  if (item.kind === 'todo') return '☑️';
  if (item.kind === 'buffer') return '⏱️';
  return '📍';
}

function isTriggerItem(item: DayPlanItem): boolean {
  if (item.kind === 'wake') return true;
  const t = `${item.title} ${item.notes ?? ''}`.toLowerCase();
  return (
    /\b(aufbruch|bescheid|erinner|wecker|leave|los\s*geh|trigger|bescheid\s+geben|parkticket\s+prüfen)\b/i.test(
      t,
    ) ||
    (item.kind === 'buffer' &&
      /\b(puffer|sicherheit|flughafen|bahnhof|ticket)\b/i.test(t) &&
      !item.hardDeadline)
  );
}

function isUncertainItem(item: DayPlanItem): boolean {
  const conf = item.meta?.confidence;
  if (conf === 'uncertain') return true;
  if (item.timed && item.startMs == null) return true;
  const t = `${item.title} ${item.notes ?? ''}`.toLowerCase();
  return /\b(unsicher|ungeklärt|noch\s+klären|\?\s*$|ohne\s+uhr)\b/i.test(t);
}

function gapMinutes(aEnd: number | null, bStart: number | null): number | null {
  if (aEnd == null || bStart == null) return null;
  return Math.round((bStart - aEnd) / 60_000);
}

/**
 * Konflikt: zu wenig Luft vor harter Deadline / Überlappung / Verspätung knallt.
 */
export function detectConflict(
  item: DayPlanItem,
  all: DayPlanItem[],
  now = Date.now(),
): { conflict: boolean; reason: string | null } {
  const eff = effectiveTimes(item);
  const blob = `${item.title} ${item.notes ?? ''}`.toLowerCase();

  if (/\b(konflikt|kollidiert|zu\s+wenig\s+puffer|knapp)\b/i.test(blob)) {
    return { conflict: true, reason: 'Konflikt / knapper Puffer' };
  }

  if (item.hardDeadline && eff.startMs != null) {
    const minsLeft = Math.round((eff.startMs - now) / 60_000);
    const need = item.bufferMin ?? 10;
    if (minsLeft >= 0 && minsLeft < need) {
      return {
        conflict: true,
        reason: `Nur noch ${minsLeft} Min bis Deadline (Puffer ${need})`,
      };
    }
    if (eff.delayMs != null && eff.delayMs > 5 * 60_000) {
      return {
        conflict: true,
        reason: `Verzug gefährdet Deadline (+${Math.round(eff.delayMs / 60_000)} Min)`,
      };
    }
    if (eff.startMs < now && item.status !== 'done') {
      return { conflict: true, reason: 'Deadline bereits überschritten' };
    }
  }

  // Gap zum nächsten harten Event
  if (eff.endMs != null || eff.startMs != null) {
    const from = eff.endMs ?? eff.startMs!;
    const nextHard = all
      .filter(
        (x) =>
          x.id !== item.id &&
          x.hardDeadline &&
          (x.actualStartMs ?? x.startMs) != null &&
          (x.actualStartMs ?? x.startMs)! > from,
      )
      .sort(
        (a, b) =>
          (a.actualStartMs ?? a.startMs)! - (b.actualStartMs ?? b.startMs)!,
      )[0];
    if (nextHard) {
      const nextStart = nextHard.actualStartMs ?? nextHard.startMs!;
      const gap = gapMinutes(from, nextStart);
      const need = nextHard.bufferMin ?? item.bufferMin ?? 10;
      if (gap != null && gap < need) {
        return {
          conflict: true,
          reason: `Nur ${gap} Min bis „${nextHard.title}" (mind. ${need})`,
        };
      }
    }
  }

  // Überlappung mit anderem timed Item
  if (eff.startMs != null && eff.endMs != null) {
    for (const other of all) {
      if (other.id === item.id) continue;
      const o = effectiveTimes(other);
      if (o.startMs == null || o.endMs == null) continue;
      const overlaps = eff.startMs < o.endMs && eff.endMs > o.startMs;
      if (overlaps && (item.hardDeadline || other.hardDeadline)) {
        return {
          conflict: true,
          reason: `Überlappt mit „${other.title}"`,
        };
      }
    }
  }

  return { conflict: false, reason: null };
}

export function classifyTimelineItem(
  item: DayPlanItem,
  all: DayPlanItem[],
  now = Date.now(),
): TimelineVisual {
  const modeEmoji = transportEmojiForItem(item);
  const conflict = detectConflict(item, all, now);
  const trigger = isTriggerItem(item);
  const uncertain = isUncertainItem(item);
  const eff = effectiveTimes(item);

  const boldTime =
    !!item.hardDeadline ||
    trigger ||
    item.kind === 'flight' ||
    item.kind === 'transit' ||
    /ankunft|abflug|abfahrt|aufbruch/i.test(item.title);

  // Priorität: Konflikt > Trigger > Unsicher > Wunsch (blau) > Default
  if (conflict.conflict) {
    return {
      tone: 'conflict',
      cardBg: COLORS.conflictBg,
      borderColor: COLORS.conflictBorder,
      railColor: COLORS.conflictBorder,
      modeEmoji,
      boldTime: true,
      showArrow: true,
      arrowLabel: '⚠',
      badgeLabel: 'Knapp',
      hint: conflict.reason,
    };
  }

  if (trigger) {
    return {
      tone: 'trigger',
      cardBg: COLORS.triggerBg,
      borderColor: COLORS.triggerBorder,
      railColor: COLORS.triggerBorder,
      modeEmoji,
      boldTime: true,
      showArrow: true,
      arrowLabel: '→',
      badgeLabel: 'Bescheid',
      hint: 'Findus meldet sich rechtzeitig',
    };
  }

  if (uncertain) {
    return {
      tone: 'uncertain',
      cardBg: COLORS.uncertainBg,
      borderColor: COLORS.uncertainBorder,
      railColor: COLORS.uncertainBorder,
      modeEmoji,
      boldTime: false,
      showArrow: false,
      arrowLabel: null,
      badgeLabel: 'Unsicher',
      hint: 'Uhrzeit oder Details noch klären',
    };
  }

  if (isWishItem(item)) {
    return {
      tone: 'wish',
      cardBg: COLORS.wishBg,
      borderColor: COLORS.wishBorder,
      railColor: COLORS.wishBorder,
      modeEmoji,
      boldTime: false,
      showArrow: false,
      arrowLabel: null,
      badgeLabel: 'Wunsch',
      hint: 'Schön wenn’s klappt — muss nicht',
    };
  }

  return {
    tone: 'default',
    cardBg: 'transparent',
    borderColor: COLORS.defaultBorder,
    railColor: item.hardDeadline ? COLORS.conflictBorder : COLORS.defaultRail,
    modeEmoji,
    boldTime: boldTime || eff.isActual,
    showArrow: boldTime,
    arrowLabel: boldTime ? '→' : null,
    badgeLabel: null,
    hint: null,
  };
}

export const TIMELINE_LEGEND = [
  { tone: 'trigger' as const, label: 'Grün · Trigger', color: COLORS.triggerBorder },
  { tone: 'wish' as const, label: 'Blau · Wunsch', color: COLORS.wishBorder },
  { tone: 'uncertain' as const, label: 'Gelb · Unsicher', color: COLORS.uncertainBorder },
  { tone: 'conflict' as const, label: 'Rot · Konflikt', color: COLORS.conflictBorder },
];
