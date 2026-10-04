/**
 * Nav-Start Speech — Struktur-Blaupause (stadt-agnostisch).
 *
 * Explizites „navigiere / bring mich“:
 * Call 1 — Zusage + navigiere dich zu [Ziel] (Karte parallel schon sichtbar)
 * Call 2 — nur Dauer („dauert etwa X Minuten“); Ankunftsuhr NUR wenn ETA > 60 Min
 *
 * Coach-Opening (Route ready): gleiche knappe Struktur, optional erster Blick.
 *
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an
 * den aktuellen Kontext und die aktuelle Stadt an.
 */

import { scrubRoboticNavSpeak, type SpatialRelation } from './spatialOrientation';
import { resolveNavDestSpeechName } from './navDestSpeechName';

export type NavTravelSpeechMode = 'foot' | 'bike' | 'drive';

export type ExplicitNavCommitSpeechInput = {
  destName: string;
  etaMin: number | null;
  mode?: NavTravelSpeechMode | null;
  /** HH:MM — nur bei ETA > 60 Min sprechen */
  arriveHm?: string | null;
  /** Call-1 Bridge schon gesprochen → nur Call-2 (Dauer) */
  bridgeAlreadySpoken?: boolean;
};

/** Zielname für Speech — Adresse/PLZ nie vorlesen. */
export function speechSafeNavDestName(destName: string): string {
  return resolveNavDestSpeechName({ query: destName, geoLabel: destName });
}

export type NavStartSpeechInput = {
  firstVisual: string | null;
  relation?: SpatialRelation | null;
  etaMin: number | null;
  pathHint?: string | null;
  destName?: string | null;
  mode?: NavTravelSpeechMode | null;
  arriveHm?: string | null;
};

function formatArriveHm(fromMs?: number | null): string | null {
  if (fromMs == null || !Number.isFinite(fromMs)) return null;
  try {
    return new Date(fromMs).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

/** Ankunftsuhr aus jetzt + ETA-Minuten. */
export function arriveHmFromEtaMin(etaMin: number | null | undefined): string | null {
  if (etaMin == null || !Number.isFinite(etaMin) || etaMin <= 0) return null;
  return formatArriveHm(Date.now() + Math.round(etaMin) * 60_000);
}

function travelVerb(mode: NavTravelSpeechMode | null | undefined): string {
  if (mode === 'bike') return 'radelst';
  if (mode === 'drive') return 'bist';
  return 'läufst';
}

/**
 * Call 1 — kurze Zusage inkl. Ziel (Say–Do nur wenn Nav wirklich startet).
 * Struktur: Alles klar → ich navigiere dich zu [Ziel].
 * Sofort nach Geocode/Namen — nicht auf volle Route warten.
 * Karte parallel (Fuß/Rad/ÖPNV); Timeline still (kein Speech über Plan).
 */
export function buildExplicitNavBridgeSpeech(destName: string): string {
  const name = speechSafeNavDestName(destName) || 'dein Ziel';
  return scrubRoboticNavSpeak(`Alles klar — ich navigiere dich zu ${name}.`);
}

/**
 * Call 2 — nur Dauer; Ankunft nur wenn länger als 60 Min.
 * Kein zweites „Alles klar“, kein Modus-Essay — Route ist schon auf der Karte.
 */
export function buildExplicitNavEtaSpeech(opts: {
  etaMin: number | null;
  mode?: NavTravelSpeechMode | null;
  arriveHm?: string | null;
}): string {
  const eta = opts.etaMin;
  if (eta == null || !Number.isFinite(eta) || eta <= 0) {
    return '';
  }
  const rounded = Math.max(1, Math.round(eta));
  void travelVerb(opts.mode);
  const arrive = (opts.arriveHm || '').trim();

  if (rounded > 60) {
    let dur: string;
    try {
      const { formatDurationMinutesDe } = require('./travelEta') as {
        formatDurationMinutesDe: (m: number, s?: 'short' | 'speech') => string;
      };
      dur = formatDurationMinutesDe(rounded, 'speech');
    } catch {
      const h = Math.floor(rounded / 60);
      const rest = rounded % 60;
      dur =
        rest === 0
          ? h === 1
            ? 'etwa 1 Stunde'
            : `etwa ${h} Stunden`
          : h === 1
            ? `etwa 1 Stunde ${rest} Minuten`
            : `etwa ${h} Stunden ${rest} Minuten`;
    }
    if (arrive) {
      return scrubRoboticNavSpeak(
        `Dauert etwa ${dur} — Ankunft gegen ${arrive}.`,
      );
    }
    return scrubRoboticNavSpeak(`Dauert etwa ${dur}.`);
  }

  return scrubRoboticNavSpeak(`Dauert etwa ${rounded} Minuten.`);
}

/** Call 1 (+ optional Call 2) für expliziten Nav-Start — kein Pack, keine Meta. */
export function buildExplicitNavCommitSpeech(
  opts: ExplicitNavCommitSpeechInput,
): string {
  const eta = buildExplicitNavEtaSpeech({
    etaMin: opts.etaMin,
    mode: opts.mode,
    arriveHm: opts.arriveHm,
  });
  if (opts.bridgeAlreadySpoken) return eta;
  return scrubRoboticNavSpeak(
    `${buildExplicitNavBridgeSpeech(opts.destName)} ${eta}`,
  );
}

/**
 * Coach-Opening nach Route-Ready — gleiche knappe Struktur wie Explicit-Nav.
 * firstVisual nur als optionaler Blick, nie Pack-/Meta-Gelaber.
 */
export function buildNavStartSpeech(opts: NavStartSpeechInput): string {
  const dest = (opts.destName || '').trim();
  const parts: string[] = [];

  if (dest) {
    parts.push(buildExplicitNavBridgeSpeech(dest));
  } else {
    parts.push('Alles klar — Navigation startet.');
  }

  const visual = (opts.firstVisual ?? '').trim();
  if (visual && visual.length < 90 && !/SICHTBARKEIT|PACK-DATENSATZ|TOPIC-LOCK/i.test(visual)) {
    parts.push(visual);
  }

  parts.push(
    buildExplicitNavEtaSpeech({
      etaMin: opts.etaMin,
      mode: opts.mode,
      arriveHm: opts.arriveHm,
    }),
  );

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
    return scrubRoboticNavSpeak(
      `Lauf geradeaus Richtung ${land} — danach geht's ${side}.`,
    );
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
    return scrubRoboticNavSpeak(`Erst geradeaus — bald ${side} abbiegen.`);
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
