/**
 * Human Co-Pilot voice: casual German, landmark-first, no robotic nav jargon.
 * Yorro speaks like a friend walking next to you — never "in X Metern links".
 */

import { relativeBearingDeg, shortestAngleDelta } from './bearing';

export type RelativeSide = 'front' | 'left' | 'right' | 'behind';

export type SpatialRelation = {
  side: RelativeSide;
  /** Relative bearing: 0 = ahead, + = right, − = left. */
  bearingRelDeg: number;
  /** Casual German: "direkt vor dir", "auf der linken Seite", … */
  sidePhrase: string;
  shortPhrase: string;
};

/**
 * Classify from already-relative bearing (0 = ahead, + = right).
 * User-Winkel (Hosentaschen-Navi / Wegweiser):
 * ≤20° geradeaus · ≤60° leicht L/R · >60° L/R · ≥120° hinter dir.
 */
export function relateFromRelativeBearing(
  bearingRelDeg: number,
): SpatialRelation {
  const abs = Math.abs(bearingRelDeg);
  let side: RelativeSide;
  if (abs <= 20) side = 'front';
  else if (abs >= 120) side = 'behind';
  else if (bearingRelDeg > 0) side = 'right';
  else side = 'left';

  const sidePhrase =
    side === 'front'
      ? 'geradeaus vor dir'
      : side === 'behind'
        ? 'hinter dir'
        : side === 'right'
          ? abs <= 60
            ? 'leicht nach rechts'
            : 'nach rechts'
          : abs <= 60
            ? 'leicht nach links'
            : 'nach links';

  const shortPhrase =
    side === 'front'
      ? 'vorne'
      : side === 'behind'
        ? 'hinter dir'
        : side === 'right'
          ? abs <= 60
            ? 'leicht rechts'
            : 'rechts'
          : abs <= 60
            ? 'leicht links'
            : 'links';

  return { side, bearingRelDeg, sidePhrase, shortPhrase };
}

export function relateToHeading(
  headingDeg: number,
  targetBearingDeg: number,
): SpatialRelation {
  return relateFromRelativeBearing(
    relativeBearingDeg(headingDeg, targetBearingDeg),
  );
}

export function isInVisualField(
  headingDeg: number,
  targetBearingDeg: number,
  visualConeDeg = 55,
): boolean {
  return Math.abs(relativeBearingDeg(headingDeg, targetBearingDeg)) <= visualConeDeg;
}

export function isAheadOfMovement(
  movementBearingDeg: number | null | undefined,
  headingDeg: number | null | undefined,
  targetBearingDeg: number,
  halfConeDeg = 95,
): boolean {
  const ref =
    typeof movementBearingDeg === 'number' && Number.isFinite(movementBearingDeg)
      ? movementBearingDeg
      : typeof headingDeg === 'number' && Number.isFinite(headingDeg)
        ? headingDeg
        : null;
  if (ref == null) return true;
  return Math.abs(shortestAngleDelta(ref, targetBearingDeg)) <= halfConeDeg;
}

/** Strip robotic / cardinal / meter-count jargon from any cue. */
export function scrubRoboticNavSpeak(text: string): string {
  return text
    .replace(/\b\d{1,3}\s*°/g, '')
    // Pack-Teaser: „Wenn du von Süden kommst…“ — Himmelsrichtung für Fußgänger unbrauchbar
    .replace(
      /\bwenn\s+du\s+von\s+(?:norden|süden|osten|westen|nordwest(?:en)?|nordost(?:en)?|südwest(?:en)?|südost(?:en)?)\s+kommst[,:]?\s*/giu,
      '',
    )
    .replace(
      /\b(norden|süden|osten|westen|nordwest|nordost|südwest|südost|north|south|east|west|northwest|northeast)\b/giu,
      '',
    )
    .replace(/\bin\s+\d+\s*(m|meter|metern)\b/giu, 'gleich')
    .replace(/\bnach\s+\d+\s*(m|meter|metern)\b/giu, 'gleich')
    .replace(/\b\d+\s*(m|meter|metern)\s+(links|rechts|geradeaus)\b/giu, '$2')
    .replace(/\b(polyline|waypoint|bearing|heading)\b/giu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Landmark first, action second — max ~2 short sentences.
 */
export function buildLandmarkFirstCue(opts: {
  landmark: string;
  relation: SpatialRelation;
  turn?: string | null;
  roadName?: string | null;
  justPassed?: string | null;
  visualKind?: 'fork' | 'alley' | 'complex' | null;
}): string {
  const land = opts.landmark.trim();
  if (opts.justPassed) {
    const passed = opts.justPassed.trim();
    return scrubRoboticNavSpeak(
      `Hey, warte kurz — du bist gerade an ${passed} vorbeigelaufen! ` +
        `Dreh dich um und geh zurück zu ${land} — ${opts.relation.sidePhrase}.`,
    );
  }

  const turn = (opts.turn ?? '').trim();
  const isTurn = turn && turn !== 'geradeaus';
  // Landmarke schlägt Straße — Parameter bleibt für Call-Sites, wird nicht vorgelesen
  void opts.roadName;

  if (opts.relation.side === 'behind') {
    return scrubRoboticNavSpeak(
      `Dreh dich mal kurz — siehst du ${land}? Genau da wollen wir hin.`,
    );
  }

  if (isTurn) {
    const kind = opts.visualKind;
    if (kind === 'fork') {
      return scrubRoboticNavSpeak(
        `An ${land} teilt sich der Weg — nimm ${turn}.`,
      );
    }
    if (kind === 'alley') {
      return scrubRoboticNavSpeak(
        `Hinter ${land} durch die schmale Gasse ${turn}.`,
      );
    }
    const alley =
      turn.includes('links') || turn.includes('rechts')
        ? ` Da musst du ${turn} durch.`
        : '';
    return scrubRoboticNavSpeak(
      `Hinter ${land} biegen wir gleich ${turn} ab.${alley}`,
    );
  }

  // Straight: visual confirmation style
  if (opts.relation.side === 'right' || opts.relation.side === 'left') {
    return scrubRoboticNavSpeak(
      `${land.charAt(0).toUpperCase()}${land.slice(1)} ${opts.relation.sidePhrase} lassen wir im Blick — du läufst genau richtig.`,
    );
  }

  return scrubRoboticNavSpeak(
    `Siehst du ${land} ${opts.relation.sidePhrase}? Genau in die Richtung gehen wir.`,
  );
}

/** Course correction — genau eine Ansage; danach stiller Auto-Reroute (kein Zurücklaufen-Skript). */
export function buildWrongWayCue(opts: {
  landmark: string | null;
  relation?: SpatialRelation | null;
  backtrackM?: number | null;
}): string {
  // Struktur: kurz anerkennen → neue Route kommt. Kein „lauf zurück“-Befehl.
  const land = opts.landmark?.trim() || null;
  void opts.relation;
  void opts.backtrackM;

  const text = land
    ? `Kurz falsch — ich berechne eine neue Route von hier, Richtung ${land}.`
    : `Kurz falsch — ich berechne jetzt eine neue Route von hier.`;

  return text.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Predictive turn-by-turn. Landmark-Zeilen bleiben live (OSM-Namen).
 * Ohne Landmark: geschlossenes Vokabular ohne Meterzahl → Cartesia-Cache.
 */
export function buildPredictiveTurnCue(opts: {
  turn: string;
  distanceM: number;
  landmark?: string | null;
  roadName?: string | null;
  lookSide?: string | null;
  visualKind?: 'fork' | 'alley' | 'complex' | null;
}): string {
  void opts.distanceM;
  const turn = opts.turn.trim() || 'geradeaus';
  const look = (opts.lookSide ?? '').trim();
  const land = opts.landmark?.trim();
  void opts.roadName;
  const kind = opts.visualKind ?? null;

  if (kind === 'fork' && turn !== 'geradeaus') {
    if (land) {
      return scrubRoboticNavSpeak(
        `Gabelung an ${land} — nimm ${turn}.`,
      );
    }
    return scrubRoboticNavSpeak(
      `Gleich teilt sich der Weg — nimm ${turn}.`,
    );
  }
  if (kind === 'alley' && turn !== 'geradeaus') {
    return scrubRoboticNavSpeak(
      land
        ? `Durch die schmale Gasse ${turn}, an ${land}.`
        : `Gleich durch die schmale Gasse ${turn}.`,
    );
  }
  if (kind === 'complex' && turn !== 'geradeaus' && !land) {
    return scrubRoboticNavSpeak(
      `Unübersichtliche Kreuzung — ${turn} halten.`,
    );
  }

  if (land && turn !== 'geradeaus') {
    const open = look
      ? `Schau nach ${look}. `
      : turn.includes('links')
        ? 'Schau nach links. '
        : turn.includes('rechts')
          ? 'Schau nach rechts. '
          : 'Schau nach vorne. ';
    return scrubRoboticNavSpeak(
      `${open}An ${land} ${turn} abbiegen.`.replace(/\s+/g, ' ').trim(),
    );
  }
  if (land) {
    return scrubRoboticNavSpeak(
      `Weiter geradeaus — halte ${land} im Blick.`,
    );
  }
  try {
    const { navTurnPhrase } = require('../tts/offlinePhraseBank') as {
      navTurnPhrase: (t: string, look?: string | null) => string;
    };
    return scrubRoboticNavSpeak(navTurnPhrase(turn, look || null));
  } catch {
    const open = look
      ? `Schau nach ${look}. `
      : turn.includes('links')
        ? 'Schau nach links. '
        : turn.includes('rechts')
          ? 'Schau nach rechts. '
          : 'Schau nach vorne. ';
    if (turn !== 'geradeaus') {
      return scrubRoboticNavSpeak(`${open}Gleich ${turn} abbiegen.`);
    }
    return scrubRoboticNavSpeak(`${open}Weiter geradeaus — du bist richtig.`);
  }
}

/** Start of route — friend walking next to you (Struktur → navStartSpeech). */
export function buildInitialOrientationCue(opts: {
  landmark: string | null;
  relation: SpatialRelation | null;
  destinationName: string;
  contextHint?: string | null;
  etaMin?: number | null;
  firstVisual?: string | null;
  pathHint?: string | null;
}): string {
  // destinationName bleibt für Call-Sites; Opener dump’t ihn bewusst nicht.
  void opts.destinationName;
  void opts.contextHint;
  try {
    const { buildNavStartSpeech, buildFirstVisualDirection } = require('./navStartSpeech') as {
      buildNavStartSpeech: (o: {
        firstVisual: string | null;
        relation?: SpatialRelation | null;
        etaMin: number | null;
        pathHint?: string | null;
      }) => string;
      buildFirstVisualDirection: (o: {
        turn: string | null;
        landmark: string | null;
        roadName: string | null;
        relation?: SpatialRelation | null;
      }) => string | null;
    };
    const firstVisual =
      (opts.firstVisual ?? '').trim() ||
      buildFirstVisualDirection({
        turn: null,
        landmark: opts.landmark,
        roadName: null,
        relation: opts.relation,
      });
    return buildNavStartSpeech({
      firstVisual,
      relation: opts.relation,
      etaMin: opts.etaMin ?? null,
      pathHint: opts.pathHint ?? null,
    });
  } catch {
    const land = opts.landmark?.trim();
    const rel = opts.relation;
    if (land && rel) {
      return scrubRoboticNavSpeak(
        `Alles klar, lass uns losgehen. Siehst du ${land} ${rel.sidePhrase}? Genau dahin.`,
      );
    }
    return scrubRoboticNavSpeak(
      'Alles klar, lass uns losgehen. Schau kurz, wohin der Weg vor dir führt.',
    );
  }
}

/** Near destination — visuelle Anker bevorzugen, wenn belegt. */
export function buildArrivalSoonCue(
  destinationName: string,
  relation: SpatialRelation,
  opts?: { visualSign?: string | null },
): string {
  const sign = (opts?.visualSign ?? '').trim();
  if (sign) {
    return scrubRoboticNavSpeak(
      `Gleich da — ${relation.shortPhrase} großes Schild mit Aufschrift „${sign}".`,
    );
  }
  const dest = destinationName.trim();
  if (dest) {
    return scrubRoboticNavSpeak(
      `Gleich bist du da — ${dest} liegt ${relation.sidePhrase}.`,
    );
  }
  return scrubRoboticNavSpeak(
    `Gleich bist du da — Ziel liegt ${relation.sidePhrase}.`,
  );
}

/** Explicit arrival — speak before stopping nav. */
export function buildArrivedCue(destinationName: string): string {
  return scrubRoboticNavSpeak(
    `Du hast ${destinationName} erreicht. Navigation aus.`,
  );
}

/** ETA pacing — gerundete Buckets, damit Cartesia denselben WAV trifft. */
export function buildPacingCue(etaMin: number): string {
  try {
    const { pacingPhrase } = require('../tts/offlinePhraseBank') as {
      pacingPhrase: (m: number) => string;
    };
    return scrubRoboticNavSpeak(pacingPhrase(etaMin));
  } catch {
    if (etaMin <= 3) return 'Gleich da — noch ein kurzes Stück.';
    return `Noch so ca. ${Math.round(etaMin)} Minuten.`;
  }
}

/** Straight-on confirmation without landmark. */
export function buildStraightCue(): string {
  return 'Weiter geradeaus — du bist genau richtig.';
}

/** Turn without landmark — visual only, no street names (Feedback: zu viele Straßen). */
export function buildTurnWithoutLandmark(
  turn: string,
  _roadName?: string | null,
): string {
  void _roadName;
  return scrubRoboticNavSpeak(
    `Gleich ${turn} halten — schau nach einer klaren Abzweigung oder Gasse.`,
  );
}

/**
 * Hybrid-Offline Status — Struktur-Blaupause, Wortlaut variiert.
 * Slot: offline bemerken → was noch geht (vorbereitet) → optional ÖPNV-Live-Hinweis.
 */
export function buildNavOfflineStatusCue(opts: {
  hasTransit: boolean;
  preparedSpeakCount: number;
}): string {
  const n = Math.max(0, opts.preparedSpeakCount);
  const preparedBit =
    n > 0
      ? `Die nächsten Ansagen habe ich schon vorbereitet — die laufen weiter.`
      : `Was ich vor dem Netzverlust vorbereitet habe, kann ich noch abspielen.`;
  if (opts.hasTransit) {
    const variants = [
      `Kurz Bescheid: ich bin gerade offline. ${preparedBit} Live-Fahrplan und Verspätungen fehlen mir jetzt — sobald du wieder Netz hast, aktualisiere ich.`,
      `Ich häng gerade ohne Netz. Navigation mit dem Vorbereiteten geht weiter, aber ÖPNV-Live-Daten fehlen. Internet wieder da — dann update ich live.`,
      `Offline-Modus: Route und vorbereitete Ansagen laufen. Für Live-Verbindungen brauche ich kurz wieder Netz.`,
    ];
    return variants[Date.now() % variants.length]!;
  }
  const variants = [
    `Kurz Bescheid: ich bin gerade offline. ${preparedBit} Neue Route kann ich ohne Netz nicht rechnen.`,
    `Ich bin gerade ohne Verbindung. Alles was ich schon vorbereitet habe, spiele ich weiter — frisches Routing erst wieder mit Netz.`,
    `Offline: vorbereitete Wegpunkte und Ansagen laufen weiter. Sobald du wieder online bist, kann ich neu routen.`,
  ];
  return variants[Date.now() % variants.length]!;
}

/**
 * Offline + Abweichen: keine Neuberechnung möglich.
 * Slot: Situation → Grenze → Handlung (zurück / Netz).
 */
export function buildNavOfflineRerouteBlockedCue(): string {
  const variants = [
    `Du bist von der Route runter — und ich bin offline, deshalb kann ich keine neue Route rechnen. Am besten kurz zurück auf den Weg, oder wieder Internet herstellen.`,
    `Falsche Abbiegung, und ohne Netz bekomme ich keine neue Linie hin. Lauf am besten zurück auf die vorbereitete Route, oder hol kurz Netz.`,
    `Ich sehe, du gehst woanders — offline kann ich nicht neu routen. Zurück auf die geladene Route, oder wieder online gehen.`,
  ];
  return variants[Date.now() % variants.length]!;
}
