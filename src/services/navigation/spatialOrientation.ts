/**
 * Human Co-Pilot voice: casual German, landmark-first, no robotic nav jargon.
 * Findus speaks like a friend walking next to you — never "in X Metern links".
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

  if (opts.relation.side === 'behind') {
    return scrubRoboticNavSpeak(
      `Dreh dich mal kurz — siehst du ${land}? Genau da wollen wir hin.`,
    );
  }

  if (isTurn) {
    // "Hinter der Sparkasse biegen wir gleich rechts ab…"
    const alley = opts.roadName
      ? ` Da geht's in die ${opts.roadName}.`
      : turn.includes('links') || turn.includes('rechts')
        ? ` Da ist so eine Abzweigung — da musst du ${turn} durch.`
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

/** Course correction — genau eine klare Ansage wohin; nie abgebrochenes „geh…“. */
export function buildWrongWayCue(opts: {
  landmark: string | null;
  relation?: SpatialRelation | null;
  backtrackM?: number | null;
}): string {
  const land = opts.landmark?.trim() || null;
  const rel = opts.relation ?? null;
  const meters =
    typeof opts.backtrackM === 'number' && opts.backtrackM >= 8
      ? Math.round(opts.backtrackM / 5) * 5
      : null;
  const meterBit = meters != null ? `etwa ${meters} Meter ` : '';

  let text: string;
  if (land && rel) {
    if (rel.side === 'behind') {
      text =
        `Oh, da bist du knapp vorbeigelaufen — dreh dich um und geh ${meterBit}` +
        `zurück zu ${land}, der liegt hinter dir.`;
    } else if (rel.side === 'left') {
      text =
        `Oh, da bist du knapp vorbeigelaufen — geh ${meterBit}` +
        `zurück und dann links zu ${land}. Da bist du wieder auf der Route.`;
    } else if (rel.side === 'right') {
      text =
        `Oh, da bist du knapp vorbeigelaufen — geh ${meterBit}` +
        `zurück und dann rechts zu ${land}. Da bist du wieder auf der Route.`;
    } else {
      text =
        `Oh, da bist du knapp vorbeigelaufen — geh ${meterBit}` +
        `zurück Richtung ${land}, der liegt vor dir. Da wieder rein auf die Route.`;
    }
  } else if (land) {
    text =
      `Oh, da bist du knapp vorbeigelaufen — dreh dich um und geh ${meterBit}` +
      `zurück zu ${land}.`;
  } else {
    text =
      `Oh, da bist du knapp vorbeigelaufen — dreh dich um und geh ${meterBit}` +
      `denselben Weg zurück, bis wir wieder auf der Route sind.`;
  }

  // Kein scrubRoboticNavSpeak hier — der frisst sonst Meter-/Richtungs-Infos
  return text.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Predictive turn-by-turn: distance + direction + optional visual anchor.
 * Keeps meter counts intentionally (unlike scrubRoboticNavSpeak).
 */
export function buildPredictiveTurnCue(opts: {
  turn: string;
  distanceM: number;
  landmark?: string | null;
  roadName?: string | null;
  lookSide?: string | null;
}): string {
  const dist = Math.max(5, Math.round(opts.distanceM / 5) * 5);
  const turn = opts.turn.trim() || 'geradeaus';
  const look = (opts.lookSide ?? '').trim();
  const land = opts.landmark?.trim();
  const road = opts.roadName?.trim();

  const open = look
    ? `Schau nach ${look}. `
    : turn.includes('links')
      ? 'Schau nach links. '
      : turn.includes('rechts')
        ? 'Schau nach rechts. '
        : 'Schau nach vorne. ';

  if (land && turn !== 'geradeaus') {
    return `${open}In ${dist} Metern an ${land} ${turn} abbiegen.`.replace(
      /\s{2,}/g,
      ' ',
    );
  }
  if (road && turn !== 'geradeaus') {
    return `${open}In ${dist} Metern ${turn} abbiegen — Richtung ${road}.`;
  }
  if (turn !== 'geradeaus') {
    return `${open}In ${dist} Metern ${turn} abbiegen.`;
  }
  if (land) {
    return `${open}Weiter geradeaus — halte ${land} im Blick.`;
  }
  return `${open}Weiter geradeaus — du bist richtig.`;
}

/** Start of route — friend walking next to you. */
export function buildInitialOrientationCue(opts: {
  landmark: string | null;
  relation: SpatialRelation | null;
  destinationName: string;
  contextHint?: string | null;
}): string {
  const dest = opts.destinationName.trim();
  if (opts.landmark && opts.relation) {
    const land = opts.landmark.trim();
    if (opts.relation.side === 'left' || opts.relation.side === 'right') {
      return scrubRoboticNavSpeak(
        `Alles klar, wir laufen jetzt los Richtung ${dest}. ` +
          `Dreh dich mal kurz nach ${opts.relation.shortPhrase} — siehst du ${land}? Genau in die Richtung gehen wir.`,
      );
    }
    return scrubRoboticNavSpeak(
      `Alles klar, wir laufen jetzt los. Siehst du ${land} ${opts.relation.sidePhrase}? Genau dahin — zu ${dest}.`,
    );
  }
  return scrubRoboticNavSpeak(
    `Alles klar, wir laufen jetzt los zu ${dest}. Schau dich kurz um, ich sag dir gleich wo's langgeht.`,
  );
}

/** Near destination. */
export function buildArrivalSoonCue(
  destinationName: string,
  relation: SpatialRelation,
): string {
  return scrubRoboticNavSpeak(
    `Gleich bist du da — ${destinationName} liegt ${relation.sidePhrase}.`,
  );
}

/** Explicit arrival — speak before stopping nav. */
export function buildArrivedCue(destinationName: string): string {
  return scrubRoboticNavSpeak(
    `Du hast ${destinationName} erreicht. Navigation aus.`,
  );
}

/** ETA pacing — human, not "ETA 4 minutes". */
export function buildPacingCue(etaMin: number): string {
  if (etaMin <= 3) {
    return 'Gleich da — noch ein kurzes Stück.';
  }
  if (etaMin <= 8) {
    return `Du kannst ganz entspannt machen — noch so ca. ${etaMin} Minuten.`;
  }
  return `Noch etwa ${etaMin} Minuten, alles easy.`;
}

/** Straight-on confirmation without landmark. */
export function buildStraightCue(): string {
  return 'Weiter geradeaus — du bist genau richtig.';
}

/** Turn without landmark — still visual, never meter counts. */
export function buildTurnWithoutLandmark(
  turn: string,
  roadName: string | null,
): string {
  if (roadName) {
    return scrubRoboticNavSpeak(
      `Gleich ${turn} — schau nach der Einmündung zur ${roadName}.`,
    );
  }
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
