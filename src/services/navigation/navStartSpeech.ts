/**
 * Nav-Start Speech — Struktur-Blaupause (stadt-agnostisch).
 *
 * Slot-Reihenfolge:
 * 1) Kurzer Start (ohne Zielnamen-Dump)
 * 2) Sofort erste visuelle Richtung / Facing / erste Abbiegung
 * 3) Knackige ETA in Minuten (nie Meter in der Speech)
 *
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an
 * den aktuellen Kontext und die aktuelle Stadt an.
 */

import { scrubRoboticNavSpeak, type SpatialRelation } from './spatialOrientation';

export type NavStartSpeechInput = {
  /** Sichtbarer Anker / erste Abbiege-Beschreibung (OSM/Shop/Kurve). */
  firstVisual: string | null;
  /** Relative Lage zum Blick (wenn Kompass da). */
  relation?: SpatialRelation | null;
  /** Committed Fuß/Rad-ETA in Minuten — nur nach echter Route. */
  etaMin: number | null;
  /** Optional: Straßen-/Allee-Hinweis ohne Zielnamen. */
  pathHint?: string | null;
};

const START_OPENERS = [
  'Alles klar — los.',
  'Okay — los.',
  'Gut, los.',
];

function pickOpener(): string {
  return START_OPENERS[Date.now() % START_OPENERS.length]!;
}

function softEtaLine(etaMin: number): string {
  const rounded = Math.max(1, Math.round(etaMin));
  if (rounded <= 2) return 'Gleich bist du da.';
  if (rounded <= 4) return 'Noch so zwei, drei Minuten.';
  if (rounded <= 7) return `Noch so ${rounded} Minuten.`;
  if (rounded <= 15) return `Dann noch rund ${rounded} Minuten.`;
  if (rounded < 60) {
    return `Dann noch etwa ${rounded} Minuten — wir nehmen’s ruhig.`;
  }
  try {
    const { formatDurationMinutesDe } = require('./travelEta') as {
      formatDurationMinutesDe: (m: number, s?: 'short' | 'speech') => string;
    };
    return `Dann noch ${formatDurationMinutesDe(rounded, 'speech')} — wir nehmen’s ruhig.`;
  } catch {
    const h = Math.floor(rounded / 60);
    const rest = rounded % 60;
    const label =
      rest === 0
        ? h === 1
          ? 'etwa 1 Stunde'
          : `etwa ${h} Stunden`
        : h === 1
          ? `etwa 1 Stunde ${rest} Minuten`
          : `etwa ${h} Stunden ${rest} Minuten`;
    return `Dann noch ${label} — wir nehmen’s ruhig.`;
  }
}

/**
 * Baut die Start-Ansage: Opener → visuelle Richtung → ETA.
 * Kein Stall-Hinweis („gleich wo's langgeht“), kein Dest-Namen-Dump als Opener.
 */
export function buildNavStartSpeech(opts: NavStartSpeechInput): string {
  const parts: string[] = [pickOpener()];

  const visual = (opts.firstVisual ?? '').trim();
  const pathHint = (opts.pathHint ?? '').trim();
  const rel = opts.relation;

  // pathHint war oft ein Straßenname — nur noch als visueller Anker ohne „Straße entlang“
  const hintLooksStreet =
    /\b(straße|strasse|weg|allee|gasse|platz|ring|damm|chaussee)\b/iu.test(pathHint);
  const safeHint = pathHint && !hintLooksStreet ? pathHint : '';

  if (visual) {
    parts.push(visual);
  } else if (rel) {
    if (rel.side === 'behind') {
      parts.push('Dreh dich kurz um — der Weg liegt hinter dir.');
    } else if (rel.side === 'left' || rel.side === 'right') {
      parts.push(
        safeHint
          ? `Schau ${rel.shortPhrase} Richtung ${safeHint} — da geht’s entlang.`
          : `Dreh dich leicht ${rel.shortPhrase} und lauf dann geradeaus.`,
      );
    } else {
      parts.push('Lauf einfach weiter, so wie du jetzt schaust.');
    }
  } else {
    parts.push('Schau kurz, wohin der Weg vor dir führt — genau da entlang.');
  }

  const eta = opts.etaMin;
  if (typeof eta === 'number' && Number.isFinite(eta) && eta >= 5) {
    parts.push(softEtaLine(eta));
  }

  return scrubRoboticNavSpeak(parts.join(' ').replace(/\s+/g, ' ').trim());
}

/**
 * Erste visuelle Richtung aus Turn + Landmark / Kurve / Facing.
 * Umgangssprachlich — wie neben jemandem herlaufen.
 */
export function buildFirstVisualDirection(opts: {
  turn: string | null;
  landmark: string | null;
  roadName: string | null;
  relation?: SpatialRelation | null;
  /** Distanz zur ersten Abbiegung in m (nur für „gleich“ vs. „hinten“). */
  distanceToFirstTurnM?: number | null;
}): string | null {
  const turn = (opts.turn ?? '').trim();
  const land = (opts.landmark ?? '').trim();
  const road = (opts.roadName ?? '').trim();
  const dist = opts.distanceToFirstTurnM;
  const near =
    typeof dist === 'number' && Number.isFinite(dist) && dist > 0 && dist < 45;

  if (turn === 'umdrehen' || turn.includes('umdreh')) {
    return scrubRoboticNavSpeak('Dreh dich um und geh die andere Richtung.');
  }

  if (land && turn && turn !== 'geradeaus') {
    const side = turn.includes('links')
      ? 'links'
      : turn.includes('rechts')
        ? 'rechts'
        : turn;
    if (near) {
      return scrubRoboticNavSpeak(
        `Gleich an ${land} vorbei — dort ${side} abbiegen.`,
      );
    }
    return scrubRoboticNavSpeak(`Lauf einfach geradeaus — auf ${land} zu.`);
  }

  if (turn && turn !== 'geradeaus') {
    const side = turn.includes('links')
      ? 'links'
      : turn.includes('rechts')
        ? 'rechts'
        : turn;
    void road;
    if (near) {
      return scrubRoboticNavSpeak(`Gleich ${side} abbiegen.`);
    }
    return scrubRoboticNavSpeak('Lauf einfach geradeaus.');
  }

  if (land) {
    return scrubRoboticNavSpeak(`Lauf einfach geradeaus — auf ${land} zu.`);
  }
  if (opts.relation?.side === 'behind') {
    return scrubRoboticNavSpeak('Dreh dich um — der Weg liegt hinter dir.');
  }
  if (opts.relation && opts.relation.side !== 'front') {
    return scrubRoboticNavSpeak(
      `Dreh dich ${opts.relation.shortPhrase} und lauf dann einfach geradeaus.`,
    );
  }
  return null;
}
