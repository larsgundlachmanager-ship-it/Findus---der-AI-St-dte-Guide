/**
 * Live Kreuzfahrt-/Mein-Schiff-Programm-Evidence.
 * Nur belegte Zeiten/Häfen/Mahlzeiten — keine Fake-Clocks, kein Reederei-Hardtool.
 * SSOT: docs/rfc/agent-harden-contract.md
 */

import type { CruisePortCall } from './travelScheduleHarden';

export type CruiseMealSlot = {
  kind: 'breakfast' | 'lunch' | 'dinner';
  startHm: string | null;
  endHm: string | null;
  note?: string | null;
};

export type CruiseHighlight = {
  title: string;
  dayKey?: string | null;
  timeHm?: string | null;
  detail?: string | null;
};

export type CruiseLuggageLogistics = {
  /** Kofferabgabe am Bahnhof / ZOB belegt. */
  stationDropOff: boolean;
  /** Shuttle-Bus Bahnhof ↔ Terminal belegt. */
  stationShuttle: boolean;
  /** Rail&Cruise / Zug-zum-Schiff erwähnt. */
  railAndCruise: boolean;
  /** Kurze belegte Notiz für Speech/Timeline. */
  note: string | null;
};

export type CruiseProgramEvidence = {
  lineName: string | null;
  shipName: string | null;
  checkInStartHm: string | null;
  checkInEndHm: string | null;
  earlyCheckInMentioned: boolean;
  embarkLatestHm: string | null;
  sailDepartHm: string | null;
  shipArriveHm: string | null;
  embarkDate: string | null;
  disembarkDate: string | null;
  portCity: string | null;
  portCalls: CruisePortCall[];
  meals: CruiseMealSlot[];
  mealFlexNote: string | null;
  highlights: CruiseHighlight[];
  luggageLogistics: CruiseLuggageLogistics | null;
  sourceUrls: string[];
  evidenceNotes: string[];
  unresolvedHints: string[];
};

const PORT_ALIASES: Record<string, string> = {
  danzig: 'Gdynia (Danzig)',
  gdansk: 'Gdynia (Danzig)',
  gdańsk: 'Gdynia (Danzig)',
  gdingen: 'Gdynia (Danzig)',
  gdynia: 'Gdynia (Danzig)',
  kopenhagen: 'Kopenhagen',
  copenhagen: 'Kopenhagen',
  kiel: 'Kiel',
  hamburg: 'Hamburg',
  warnemünde: 'Warnemünde',
  warnemuende: 'Warnemünde',
  tallinn: 'Tallinn',
  helsinki: 'Helsinki',
  stockholm: 'Stockholm',
  oslo: 'Oslo',
  bergen: 'Bergen',
};

/** Orte, die oft genannt werden, aber keine Kreuzfahrt-Häfen sind. */
const NON_PORT_HINTS = new Set([
  'bordesholm',
  'prisdorf',
  'elmshorn',
  'neumünster',
  'neumuenster',
  'rendsburg',
]);

function clockFromBlob(blob: string): string | null {
  try {
    const { extractSpokenClock } = require('../../services/research/extractSpokenClock') as {
      extractSpokenClock: (s: string) => string | null;
    };
    return extractSpokenClock(blob);
  } catch {
    const m = blob.match(/\b(\d{1,2})[:.](\d{2})\b/);
    if (!m) return null;
    const h = Number(m[1]);
    if (h > 23) return null;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  }
}

function normalizePortName(raw: string): string | null {
  const name = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/[()]/g, ' ')
    .trim();
  if (name.length < 3 || name.length > 48) return null;
  const key = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  if (NON_PORT_HINTS.has(key.split(/\s+/)[0] || key)) return null;
  if (/kreuzfahrt|schiff|hotel|flug|seetag|anreise|ausschiff/i.test(name)) return null;
  for (const [alias, canon] of Object.entries(PORT_ALIASES)) {
    if (key === alias || key.includes(alias) || alias.includes(key)) return canon;
  }
  // Title-case soft
  return name.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
}

function addDaysIso(iso: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  try {
    const ms = Date.parse(`${iso}T12:00:00`) + days * 86_400_000;
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function parseDeDateNear(blob: string): string | null {
  const iso = blob.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1]!;
  const de = blob.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/);
  if (!de) return null;
  return `${de[3]}-${String(de[2]).padStart(2, '0')}-${String(de[1]).padStart(2, '0')}`;
}

/** Belegte Check-in-/Abfahrt-/Hafen-/Mahlzeit-Slots aus Research-Blob. */
export function extractCruiseProgramFromBlob(
  blob: string,
  opts?: { embarkDate?: string | null; voicePorts?: string[] | null },
): CruiseProgramEvidence {
  const t = String(blob || '').replace(/\s+/g, ' ').trim();
  const evidenceNotes: string[] = [];
  const unresolvedHints: string[] = [];
  const sourceUrls: string[] = [];

  const lineName = /\bmein\s+schiff\b/iu.test(t)
    ? 'Mein Schiff'
    : /\b(?:aida|adidia|aidia|aiida)\b/iu.test(t)
      ? 'AIDA'
      : /\bkreuzfahrt\b/iu.test(t)
        ? 'Kreuzfahrt'
        : null;
  const shipM =
    t.match(/\b(Mein\s+Schiff\s+(?:Relax|\d+|1|2|3|4|5|6|7))\b/iu) ||
    t.match(/\b(AIDA\s+(?:nova|perla|bella|stella|sol|luna|mar|aura|cosmo|diva))\b/iu);
  const shipName = shipM?.[1]?.replace(/\s+/g, ' ') || null;

  let checkInStartHm: string | null = null;
  let checkInEndHm: string | null = null;
  const earlyCheckInMentioned = /\bearly\s*check[\s-]?in\b/iu.test(t);

  // Offiziell DE-Hafen: 13:00–16:00 (meinschiff.com)
  const win = t.match(
    /(?:abfahrten\s+ab\s+deutschland|individuelle\s+an[\s-]?und\s+abreise|check[\s-]?in(?:\s+zeitfenster)?)[^.]{0,80}?(?:von\s+)?(\d{1,2}(?:[:.]\d{2})?)\s*(?:uhr)?\s*(?:bis|–|-|bis\s+um)\s*(\d{1,2}(?:[:.]\d{2})?)/iu,
  );
  if (win) {
    checkInStartHm = clockFromBlob(win[1]!);
    checkInEndHm = clockFromBlob(win[2]!);
    if (checkInStartHm && checkInEndHm) {
      evidenceNotes.push(`Check-in ${checkInStartHm}–${checkInEndHm} (belegt)`);
    }
  }
  if (!checkInStartHm) {
    const soft = t.match(
      /\bcheck[\s-]?in\b[^.]{0,60}?(?:von|ab|um)?\s*(\d{1,2}(?:[:.]\d{2})?)\s*(?:uhr)?(?:\s*(?:bis|–|-)\s*(\d{1,2}(?:[:.]\d{2})?))?/iu,
    );
    if (soft?.[1]) {
      checkInStartHm = clockFromBlob(soft[1]);
      if (soft[2]) checkInEndHm = clockFromBlob(soft[2]);
    }
  }

  let sailDepartHm: string | null = null;
  const sail = t.match(
    /\b(?:abfahrt|ablegen|abreise)\b[^.]{0,40}?(?:um\s*)?(\d{1,2}(?:[:.]\d{2})?)\s*(?:uhr)?/iu,
  );
  if (sail?.[1]) {
    sailDepartHm = clockFromBlob(sail[1]);
    if (sailDepartHm) evidenceNotes.push(`Abfahrt ${sailDepartHm} (belegt)`);
  }
  // "Kiel … ab 19:00" / "Abfahrt: 19:00 Uhr"
  if (!sailDepartHm) {
    const kielSail = t.match(
      /\bkiel\b[^.]{0,48}?\bab(?:fahrt|reise)?\b[^.]{0,12}?(\d{1,2}(?:[:.]\d{2})?)/iu,
    );
    if (kielSail?.[1]) sailDepartHm = clockFromBlob(kielSail[1]);
  }
  if (!sailDepartHm) {
    const bareSail = t.match(/\babfahrt\s*:?\s*(\d{1,2}(?:[:.]\d{2})?)/iu);
    if (bareSail?.[1]) sailDepartHm = clockFromBlob(bareSail[1]);
  }

  let embarkLatestHm: string | null = null;
  const allAboard = t.match(
    /\b(?:all[\s-]?aboard|einschiff(?:ung|en)?(?:svorgang)?|spätestens\s+an\s+bord)\b[^.]{0,100}?(?:bis\s+(?:etwa\s+)?)?(\d(?:[.,]\d+)?|\d{1,2})\s*(?:stunden|std\.?|h)\b/iu,
  );
  if (allAboard && sailDepartHm) {
    const hours = Number(String(allAboard[1]).replace(',', '.'));
    if (hours > 0 && hours < 12) {
      const [hh, mm] = sailDepartHm.split(':').map(Number);
      const total = (hh || 0) * 60 + (mm || 0) - Math.round(hours * 60);
      if (total >= 0) {
        embarkLatestHm = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
        evidenceNotes.push(`All-aboard ~${embarkLatestHm} (${hours}h vor Abfahrt)`);
      }
    }
  }
  // "Einschiffungsvorgang muss … bis etwa 3 Stunden vor der Abfahrt"
  if (!embarkLatestHm && sailDepartHm) {
    const threeH = t.match(
      /(\d(?:[.,]\d+)?|\d{1,2})\s*(?:stunden|std\.?)\s+vor\s+(?:der\s+)?abfahrt/iu,
    );
    if (threeH?.[1]) {
      const hours = Number(String(threeH[1]).replace(',', '.'));
      if (hours > 0 && hours < 12) {
        const [hh, mm] = sailDepartHm.split(':').map(Number);
        const total = (hh || 0) * 60 + (mm || 0) - Math.round(hours * 60);
        if (total >= 0) {
          embarkLatestHm = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
          evidenceNotes.push(`All-aboard ~${embarkLatestHm} (${hours}h vor Abfahrt)`);
        }
      }
    }
  }
  if (!embarkLatestHm) {
    const emb = t.match(
      /\b(?:einschiff(?:en)?|all[\s-]?aboard)\b[^.]{0,40}?(?:um\s*|bis\s*)?(\d{1,2}(?:[:.]\d{2})?)\s*(?:uhr)?/iu,
    );
    if (emb?.[1]) embarkLatestHm = clockFromBlob(emb[1]);
  }

  let shipArriveHm: string | null = null;
  const arrHome = t.match(
    /\b(?:ankunft|ausschiff)\b[^.]{0,48}?(?:kiel|hamburg|warnemünde)?[^.]{0,24}?(?:um\s*|ca\.?\s*)?(\d{1,2}(?:[:.]\d{2})?)\s*(?:uhr)?/iu,
  );
  if (arrHome?.[1] && /ausschiff|ankunft.{0,20}(kiel|hamburg)/iu.test(t)) {
    shipArriveHm = clockFromBlob(arrHome[1]);
  }
  // Prefer final-day "Kiel Ankunft 06:30"
  const kielArr = t.match(
    /\bkiel\b[^.]{0,30}?\b(?:ankunft|an)\b[^.]{0,20}?(\d{1,2}(?:[:.]\d{2})?)/iu,
  );
  if (kielArr?.[1]) shipArriveHm = clockFromBlob(kielArr[1]) || shipArriveHm;

  const embarkDate =
    opts?.embarkDate ||
    parseDeDateNear(t.match(/(?:reisezeitraum|ab|start)[^.]{0,40}/iu)?.[0] || '') ||
    null;
  let disembarkDate: string | null = null;
  const span = t.match(
    /\b(20\d{2}-\d{2}-\d{2})\s*[–\-bis]+\s*(20\d{2}-\d{2}-\d{2})\b/,
  );
  if (span) {
    disembarkDate = span[2]!;
  } else {
    const deSpan = t.match(
      /\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\s*[–\-bis]+\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/,
    );
    if (deSpan) {
      disembarkDate = `${deSpan[6]}-${String(deSpan[5]).padStart(2, '0')}-${String(deSpan[4]).padStart(2, '0')}`;
    }
  }

  let portCity: string | null = null;
  const embarkPort = t.match(
    /\b(?:ab(?:\/bis)?|starthafen|einschiff)\b[^.]{0,40}?\b(Kiel|Hamburg|Warnemünde|Warnemuende)\b/iu,
  );
  if (embarkPort?.[1]) {
    portCity = normalizePortName(embarkPort[1]) || embarkPort[1];
  }

  const portCalls: CruisePortCall[] = [];
  const portSeen = new Set<string>();

  // "Gdynia (Danzig) Ankunft 07:00 Abfahrt 19:00" / "Liegezeit: 07:00–18:00"
  const portRe =
    /\b((?:Gdynia|Gdingen|Danzig|Gda[nń]sk|Kopenhagen|Copenhagen|Tallinn|Helsinki|Stockholm|Oslo|Bergen|Warnemünde|Warnemuende|Hamburg)(?:\s*\([^)]{0,24}\))?)\b[^.]{0,48}?\b(?:ankunft|an|liegezeit)\b[^.]{0,16}?(\d{1,2}(?:[:.]\d{2})?)\s*(?:uhr)?[^.]{0,24}?\b(?:abfahrt|ab|ablegen)\b[^.]{0,12}?(\d{1,2}(?:[:.]\d{2})?)/giu;
  let m: RegExpExecArray | null;
  let portIdx = 0;
  while ((m = portRe.exec(t)) != null) {
    const portName = normalizePortName(m[1] || '');
    if (!portName) continue;
    if (portCity && portName === portCity) continue;
    const key = portName.toLowerCase();
    if (portSeen.has(key)) continue;
    portSeen.add(key);
    const arriveAt = clockFromBlob(m[2] || '');
    const departAt = clockFromBlob(m[3] || '');
    const dayKey =
      (embarkDate && addDaysIso(embarkDate, portIdx + 1)) ||
      embarkDate ||
      'unknown';
    if (dayKey !== 'unknown') {
      portCalls.push({
        dayKey,
        portName,
        arriveAt,
        departAt,
        shoreHint: null,
      });
      portIdx += 1;
      evidenceNotes.push(
        `${portName}${arriveAt ? ` an ${arriveAt}` : ''}${departAt ? ` ab ${departAt}` : ''}`.trim(),
      );
    }
  }

  // Compact: "Kopenhagen 08:00–17:00" / "Tallinn an 09:00 · ab 23:59"
  const compactRe =
    /\b((?:Gdynia|Gdingen|Danzig|Gda[nń]sk|Kopenhagen|Tallinn|Helsinki|Stockholm|Oslo|Bergen)(?:\s*\([^)]{0,24}\))?)\b(?:\s*[·•,/-]\s*[A-Za-zÄÖÜäöüß()]{2,24})?\s+(?:an\s+)?(\d{1,2}(?:[:.]\d{2})?)\s*(?:uhr)?\s*(?:[–\-·•]|bis|\s+ab\s+)\s*(?:ab\s+)?(\d{1,2}(?:[:.]\d{2})?)/giu;
  while ((m = compactRe.exec(t)) != null) {
    const portName = normalizePortName(m[1] || '');
    if (!portName || portSeen.has(portName.toLowerCase())) continue;
    portSeen.add(portName.toLowerCase());
    const arriveAt = clockFromBlob(m[2] || '');
    const departAt = clockFromBlob(m[3] || '');
    const dayKey =
      (embarkDate && addDaysIso(embarkDate, portIdx + 1)) || embarkDate || 'unknown';
    if (dayKey !== 'unknown') {
      portCalls.push({ dayKey, portName, arriveAt, departAt, shoreHint: null });
      portIdx += 1;
      evidenceNotes.push(
        `${portName}${arriveAt ? ` an ${arriveAt}` : ''}${departAt ? ` ab ${departAt}` : ''}`.trim(),
      );
    }
  }

  // Liegezeit-only: "Gdynia … Liegezeit: 07:00 Uhr – 18:00 Uhr"
  const liegeRe =
    /\b((?:Gdynia|Gdingen|Danzig|Gda[nń]sk|Kopenhagen|Tallinn|Helsinki)(?:\s*\([^)]{0,24}\))?)\b[^.]{0,60}?liegezeit\s*:?\s*(\d{1,2}(?:[:.]\d{2})?)\s*(?:uhr)?\s*[–\-bis]+\s*(\d{1,2}(?:[:.]\d{2})?)/giu;
  while ((m = liegeRe.exec(t)) != null) {
    const portName = normalizePortName(m[1] || '');
    if (!portName || portSeen.has(portName.toLowerCase())) continue;
    portSeen.add(portName.toLowerCase());
    const arriveAt = clockFromBlob(m[2] || '');
    const departAt = clockFromBlob(m[3] || '');
    const dayKey =
      (embarkDate && addDaysIso(embarkDate, portIdx + 1)) || embarkDate || 'unknown';
    if (dayKey !== 'unknown') {
      portCalls.push({ dayKey, portName, arriveAt, departAt, shoreHint: null });
      portIdx += 1;
      evidenceNotes.push(
        `${portName}${arriveAt ? ` an ${arriveAt}` : ''}${departAt ? ` ab ${departAt}` : ''}`.trim(),
      );
    }
  }

  // Voice ports ohne Research-Match → unresolved (kein Fake-Hafen)
  for (const raw of opts?.voicePorts || []) {
    const n = normalizePortName(raw);
    const key = String(raw || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (NON_PORT_HINTS.has(key.split(/\s+/)[0] || key)) {
      unresolvedHints.push(
        `${raw}: kein Kreuzfahrt-Hafen belegt — vermutlich Anreise/Umland`,
      );
      continue;
    }
    if (!n) continue;
    if (!portSeen.has(n.toLowerCase()) && !portCalls.some((p) => p.portName === n)) {
      unresolvedHints.push(`${n}: Hafenzeit noch nicht belegt`);
    }
  }

  const meals: CruiseMealSlot[] = [];
  let mealFlexNote: string | null = null;
  if (
    /\bflexible\s+genusszeiten|gastronomie\s+rund\s+um\s+die\s+uhr|24\s*h\b/iu.test(t)
  ) {
    mealFlexNote =
      'Genusszeiten flexibel / Gastronomie oft rund um die Uhr (belegt) — keine festen Meal-Clocks';
  }
  const mealKinds: Array<{ kind: CruiseMealSlot['kind']; re: RegExp }> = [
    {
      kind: 'breakfast',
      re: /\b(?:frühstück|fruehstueck|breakfast)\b[^.]{0,48}?((?:ab|um|von)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?(?:\s*(?:bis|–|-)\s*\d{1,2}(?:[:.]\d{2})?)?)/iu,
    },
    {
      kind: 'lunch',
      re: /\b(?:mittag(?:essen)?|lunch)\b[^.]{0,48}?((?:ab|um|von)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?(?:\s*(?:bis|–|-)\s*\d{1,2}(?:[:.]\d{2})?)?)/iu,
    },
    {
      kind: 'dinner',
      re: /\b(?:abendessen|dinner|abendbuffet)\b[^.]{0,48}?((?:ab|um|von)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?(?:\s*(?:bis|–|-)\s*\d{1,2}(?:[:.]\d{2})?)?)/iu,
    },
  ];
  for (const mk of mealKinds) {
    const mm = t.match(mk.re);
    if (!mm?.[1]) continue;
    const startHm = clockFromBlob(mm[1]);
    if (!startHm) continue;
    const endPart = mm[1].match(/(?:bis|–|-)\s*(\d{1,2}(?:[:.]\d{2})?)/iu);
    meals.push({
      kind: mk.kind,
      startHm,
      endHm: endPart?.[1] ? clockFromBlob(endPart[1]) : null,
    });
    evidenceNotes.push(
      `${mk.kind === 'breakfast' ? 'Frühstück' : mk.kind === 'lunch' ? 'Mittag' : 'Abendessen'} ${startHm} (belegt)`,
    );
  }

  const highlights: CruiseHighlight[] = [];
  if (/\bspa|sauna|wellness\b/iu.test(t)) {
    highlights.push({ title: 'Spa / Sauna', detail: 'an Bord (belegt)' });
  }
  if (/\bentertainment|shows?|theater|bordprogramm\b/iu.test(t)) {
    highlights.push({ title: 'Entertainment / Shows', detail: 'Bordprogramm (belegt)' });
  }
  if (/\bkinderbetreuung|kids?\s*club\b/iu.test(t)) {
    highlights.push({ title: 'Kinderbetreuung', detail: 'an Bord (belegt)' });
  }
  if (/\blandausflug|shore\s*excursion\b/iu.test(t)) {
    highlights.push({ title: 'Landausflüge', detail: 'buchbar (belegt)' });
  }

  // Bahn-Anreise: Gepäckabgabe am Bahnhof + Shuttle zum Terminal (nur belegt)
  const railAndCruise =
    /\brail\s*(?:&|und|\+|\/)?\s*cruise\b|\bzug\s+zum\s+schiff\b|\bbahn(?:anreise|ticket)\b.*\bschiff\b/iu.test(
      t,
    );
  const stationDropOff =
    /\b(?:gepäck|gepaeck|koffer)\s*(?:abgabe|abgeben|abgegeben|service)\b[^.]{0,80}\b(?:bahn(?:hof)?|hbf|hauptbahnhof|zob)\b|\b(?:bahn(?:hof)?|hbf|hauptbahnhof|zob)\b[^.]{0,80}\b(?:gepäck|gepaeck|koffer)\s*(?:abgabe|abgeben|abgegeben)\b/iu.test(
      t,
    );
  const stationShuttle =
    /\b(?:shuttle|busshuttle|transferbus|bus\s*shuttle)\b[^.]{0,90}\b(?:bahn(?:hof)?|hbf|hauptbahnhof|zob|schiff|terminal)\b|\b(?:bahn(?:hof)?|hbf|hauptbahnhof)\b[^.]{0,90}\b(?:shuttle|busshuttle|transferbus)\b/iu.test(
      t,
    );
  let luggageLogistics: CruiseLuggageLogistics | null = null;
  if (stationDropOff || stationShuttle || railAndCruise) {
    const bits: string[] = [];
    if (stationDropOff) bits.push('Gepäckabgabe am Bahnhof');
    if (stationShuttle) bits.push('Shuttle Bahnhof–Terminal');
    if (railAndCruise && !stationShuttle) {
      bits.push('Rail&Cruise — Shuttle oft inkl. (Details belegen)');
    } else if (railAndCruise) {
      bits.push('Rail&Cruise erwähnt');
    }
    const note = `${bits.join(' · ')} (belegt)`.slice(0, 160);
    luggageLogistics = {
      stationDropOff,
      stationShuttle,
      railAndCruise,
      note,
    };
    evidenceNotes.push(note);
  }

  // Vollpension erwähnt ohne Clocks
  if (
    !meals.length &&
    /\bvollpension|premium[\s-]?inklusiv|genussvielfalt\b/iu.test(t) &&
    !mealFlexNote
  ) {
    mealFlexNote = 'Vollpension / Premium-Inklusiv belegt — feste Meal-Uhrzeiten nicht ausgewiesen';
  }

  return {
    lineName,
    shipName,
    checkInStartHm,
    checkInEndHm,
    earlyCheckInMentioned,
    embarkLatestHm,
    sailDepartHm,
    shipArriveHm,
    embarkDate: embarkDate || opts?.embarkDate || null,
    disembarkDate,
    portCity,
    portCalls,
    meals,
    mealFlexNote,
    highlights: highlights.slice(0, 4),
    luggageLogistics,
    sourceUrls,
    evidenceNotes: evidenceNotes.slice(0, 8),
    unresolvedHints: unresolvedHints.slice(0, 4),
  };
}

export function voicePortHintsFromText(text: string): string[] {
  const t = String(text || '');
  const out: string[] = [];
  const push = (p: string) => {
    const name = (p || '').trim();
    if (!name || /kreuzfahrt|schiff|kiel|bahn|zug|timeline|kalender/i.test(name)) return;
    if (!out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  };
  // Kein \\b vor ü/ä — JS-Word-Boundary bricht an Umlauten.
  const chain = t.match(
    /(?:^|[^\p{L}\p{N}])(?:über|ueber|via|zwischenhalt(?:e)?|häfen|haefen|hafenliste)\s+([A-ZÄÖÜa-zäöüß,\sund.-]{4,80})/iu,
  );
  if (chain?.[1]) {
    for (const part of chain[1].split(/\s*(?:,|\/|und|&)\s*/i)) {
      const m = part.match(/([A-ZÄÖÜ][\wÄÖÜäöüß.-]{2,})/u);
      if (m?.[1]) push(m[1]);
    }
  }
  const re =
    /(?:^|[^\p{L}\p{N}])(?:über|ueber|via|zwischenhalt|hafen|in)\s+([A-ZÄÖÜ][\wÄÖÜäöüß.-]{2,})/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) != null) {
    push(m[1] || '');
  }
  return out.slice(0, 8);
}

/** Live-Web: Mein Schiff / AIDA / Kreuzfahrt-Programm belegen. */
export async function researchCruiseProgramEvidence(opts: {
  userText: string;
  embarkDate?: string | null;
  portCity?: string | null;
  voicePorts?: string[] | null;
}): Promise<CruiseProgramEvidence> {
  const empty = extractCruiseProgramFromBlob('', {
    embarkDate: opts.embarkDate,
    voicePorts: opts.voicePorts,
  });
  const ports = (opts.voicePorts || voicePortHintsFromText(opts.userText)).join(' ');
  const isMeinSchiff = /\bmein(?:en|em|e)?\s+schiff\b/iu.test(opts.userText);
  const isAida = /\b(?:aida|adidia|aidia|aiida)\b/iu.test(opts.userText);
  const lineLabel = isMeinSchiff ? 'Mein Schiff' : isAida ? 'AIDA' : 'Kreuzfahrt';
  const officialSite = isMeinSchiff
    ? 'meinschiff.com official'
    : isAida
      ? 'aida.de official Check-in Bordprogramm'
      : 'official Check-in Bordprogramm';
  try {
    const { runWebResearch } = await import('../../services/research/webResearchService');
    const q = [
      lineLabel,
      opts.portCity && opts.portCity !== 'Hafen' ? `ab ${opts.portCity}` : '',
      ports,
      opts.embarkDate || '',
      'Route Check-in Einschiffen Abfahrt Ankunft Liegezeiten Bordprogramm Frühstück',
      'Gepäckabgabe Bahnhof Shuttle Bus Rail Cruise Transfer Terminal',
      officialSite,
    ]
      .filter(Boolean)
      .join(' ');
    const web = await runWebResearch(q, { force: true });
    const blob = [
      web?.speechHint,
      ...(web?.facts ?? []).map((f) => `${f.label} ${f.value}`),
      ...(web?.sources ?? []).map((s) => `${s.title || ''} ${s.url || ''}`),
    ]
      .filter(Boolean)
      .join(' · ');
    const parsed = extractCruiseProgramFromBlob(
      [lineLabel, blob].filter(Boolean).join(' · '),
      {
        embarkDate: opts.embarkDate,
        voicePorts: opts.voicePorts || voicePortHintsFromText(opts.userText),
      },
    );
    if (!parsed.lineName) parsed.lineName = lineLabel === 'Kreuzfahrt' ? null : lineLabel;
    if (!parsed.shipName && parsed.lineName) parsed.shipName = parsed.lineName;
    const urls = (web?.sources ?? [])
      .map((s) => s.url)
      .filter((u): u is string => Boolean(u))
      .filter((u) =>
        /mein\s*schiff|aida\.de|aida\.cruises|tui|kreuzfahrt|cruise|ahoi|seereisen|check[\s-]?in/i.test(
          u,
        ),
      );
    // Official check-in page soft-fill if DE window missing but meinschiff mentioned
    if (
      !parsed.checkInStartHm &&
      /\bmein\s+schiff|meinschiff\.com\b/iu.test(blob) &&
      /\bdeutschland|kiel|hamburg\b/iu.test(`${opts.portCity || ''} ${blob}`)
    ) {
      // Only when official page is among sources — hard evidence
      const official = urls.some((u) => /meinschiff\.com\/.*check-in/i.test(u));
      if (official || /13:00.+16:00|13\.00.+16\.00/i.test(blob)) {
        parsed.checkInStartHm = parsed.checkInStartHm || '13:00';
        parsed.checkInEndHm = parsed.checkInEndHm || '16:00';
        parsed.evidenceNotes.unshift('Check-in 13:00–16:00 DE (Mein Schiff belegt)');
      }
    }
    parsed.sourceUrls = [
      ...new Set([
        ...urls,
        ...((web?.sources ?? []).map((s) => s.url).filter(Boolean) as string[]),
      ]),
    ].slice(0, 4);
    if (!parsed.portCity && opts.portCity && opts.portCity !== 'Hafen') {
      parsed.portCity = opts.portCity;
    }
    return parsed;
  } catch {
    return {
      ...empty,
      lineName: lineLabel === 'Kreuzfahrt' ? null : lineLabel,
      unresolvedHints: ['Programm-Recherche gerade nicht erreichbar'],
    };
  }
}
