/**
 * Auftrag-Gedächtnis — Wunsch + offene Tasks + Kontext sticky pro Root.
 *
 * Struktur-Blaupause (kein Dialog-Skript): Call-1/Author-Intent sieht denselben Block.
 * Herleiten vor Nachfragen; stillNeed nur echte Blocker.
 */

import type { FollowThroughGoal, FollowThroughKind } from './missionFollowThrough';

export type AuftragMemory = {
  /** Ausgangswunsch des Users (Root) */
  wish: string;
  /** Offene Tasks in logischer Reihenfolge (kurz) */
  openTasks: string[];
  /** Schon bekannter Kontext / Slots */
  known: string[];
  /** Noch nötig — nur Blocker, sonst leer */
  stillNeed: string[];
  /** Zuerst selbst aus Kontext/GPS/Board herleiten */
  deriveFirst: string[];
  updatedAtMs: number;
  /** Presence-Gap GPS≠Zielstadt */
  presence?: {
    gpsCity: string;
    destCity: string;
    accessLeg: 'needed' | 'already_there' | 'unknown';
  } | null;
  /** Surprise-/Plan-Anker (Theater etc.) */
  anchor?: {
    name: string;
    lat?: number | null;
    lng?: number | null;
    whenMs?: number | null;
    cityId?: string | null;
    kind?: string;
  } | null;
  /** Aktive Gaps (kurz) */
  gaps?: Array<{ kind: string; summary: string }> | null;
};

export type WorkHint = {
  id: string;
  brief: string;
  executeWhen?: 'now' | 'later' | 'on_confirm' | string | null;
  dependsOn?: string | null;
};

function shortTaskLabel(w: WorkHint): string {
  const when =
    w.executeWhen === 'later'
      ? 'später'
      : w.executeWhen === 'on_confirm'
        ? 'nach Bestätigung'
        : 'jetzt';
  const brief = (w.brief || w.id || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return `${w.id}(${when}): ${brief}`;
}

function knownFromSlots(
  kind: FollowThroughKind,
  slots: FollowThroughGoal['slots'],
): string[] {
  const out: string[] = [];
  if (slots.flightTime) out.push(`Abflugzeit=${slots.flightTime}`);
  if (slots.luggage && slots.luggage !== 'unknown') {
    out.push(`Gepäck=${slots.luggage}`);
  }
  if (slots.originCity) out.push(`Abflugstadt=${slots.originCity}`);
  if (slots.gpsCity) out.push(`GPS-Stadt=${slots.gpsCity}`);
  if (slots.accessLeg && slots.accessLeg !== 'unknown') {
    out.push(`Anreise=${slots.accessLeg}`);
  }
  if (slots.cuisineOrVenue) out.push(`Richtung=${slots.cuisineOrVenue}`);
  if (slots.sportToken) out.push(`Sport=${slots.sportToken}`);
  if (slots.questHints) out.push(`Hints=${slots.questHints.slice(0, 80)}`);
  if (kind === 'taxi_airport' && !slots.flightTime) {
    /* still open — not known */
  }
  return out;
}

function stillNeedFromGoal(
  kind: FollowThroughKind,
  slots: FollowThroughGoal['slots'],
  needBookingLink: boolean,
  work: WorkHint[],
): string[] {
  const out: string[] = [];
  if (kind === 'taxi_airport') {
    if (!slots.flightTime) out.push('Abflugzeit oder Flugnummer');
    if (!slots.luggage || slots.luggage === 'unknown') {
      out.push('Gepäck Hand vs Aufgabe (Live-Chips)');
    }
    if (
      slots.originCity &&
      slots.gpsCity &&
      slots.originCity !== slots.gpsCity &&
      (!slots.accessLeg || slots.accessLeg === 'needed' || slots.accessLeg === 'unknown')
    ) {
      out.push('Anreise zum Abflugort (schon da / Bahn / Hotel)');
    }
  }
  if (kind === 'table_reserve' && !slots.cuisineOrVenue) {
    out.push('wo/was essen (Richtung)');
  }
  if (kind === 'open_quest' && !slots.questHints) {
    out.push('kritischer Slot nur wenn ohne Kontext nicht lösbar');
  }
  if (needBookingLink && work.some((w) => w.id.includes('taxi') || w.id.includes('reserve') || w.id.includes('transfer'))) {
    out.push('Buchungs-/Deep-Link belegen oder Lücke ehrlich');
  }
  return out;
}

function deriveFirstForKind(kind: FollowThroughKind, slots: FollowThroughGoal['slots']): string[] {
  if (kind === 'taxi_airport') {
    return [
      'Startflughafen selbst herleiten (nächster/relevant) — User darf korrigieren',
      slots.flightTime
        ? 'Abflugtafel auf Uhr matchen, Leave-by rückwärts, Timeline'
        : 'Sobald Uhr da: Board matchen + Leave-by, nicht nochmal nach Dest fragen',
      'Taxi-Deep-Link Prefill (Start, Flughafen, Abholzeit=Leave-by) — nicht nachfragen ob bestellen',
    ];
  }
  if (kind === 'table_reserve') {
    return [
      'Venue aus Kontext/Pitch wählen',
      'Reservierungs-URL Just-Do-It — Prefill portalabhängig still',
    ];
  }
  if (kind === 'open_sport') {
    return ['2–3 Optionen vor Ort aus Pack/Nearby — kein Quiz'];
  }
  return [
    'Musts aus Satz + Sticky-Kontext herleiten',
    'Nur echte Blocker fragen — nie Ambiguity-Meta',
  ];
}

/** Baut frischen Auftrag-Block aus Root + inventierter Work. */
export function buildAuftragMemory(opts: {
  kind: FollowThroughKind;
  rootLabel: string;
  slots: FollowThroughGoal['slots'];
  work: WorkHint[];
  needBookingLink: boolean;
  prev?: AuftragMemory | null;
  presence?: AuftragMemory['presence'];
  anchor?: AuftragMemory['anchor'];
  gaps?: AuftragMemory['gaps'];
}): AuftragMemory {
  const wish =
    (opts.rootLabel || '').replace(/\s+/g, ' ').trim().slice(0, 180) ||
    opts.prev?.wish ||
    'offener Auftrag';
  const openTasks = opts.work.map(shortTaskLabel).slice(0, 6);
  const known = knownFromSlots(opts.kind, opts.slots);
  // Vorher Bekanntes behalten wenn Slot-String fehlt (z. B. Thread-Bits)
  if (opts.prev?.known?.length) {
    for (const k of opts.prev.known) {
      if (!known.some((x) => x.slice(0, 24) === k.slice(0, 24))) {
        if (/^(Thread|User)=/i.test(k)) known.push(k.slice(0, 100));
      }
    }
  }
  if (opts.presence) {
    known.push(`Presence=${opts.presence.gpsCity}→${opts.presence.destCity}`);
  }
  if (opts.anchor?.name) {
    known.push(`Anchor=${opts.anchor.name}`);
  }
  const stillNeed = stillNeedFromGoal(
    opts.kind,
    opts.slots,
    opts.needBookingLink,
    opts.work,
  );
  if (opts.presence?.accessLeg === 'needed') {
    stillNeed.unshift('Anreise in Zielstadt (Modus herleiten)');
  }
  const deriveFirst = [
    ...deriveFirstForKind(opts.kind, opts.slots),
    ...(opts.prev?.deriveFirst || []).filter((d) => /Anreise|Venue|Stück/i.test(d)),
  ];
  return {
    wish,
    openTasks,
    known: known.slice(0, 12),
    stillNeed: stillNeed.slice(0, 6),
    deriveFirst: deriveFirst.slice(0, 6),
    updatedAtMs: Date.now(),
    presence: opts.presence !== undefined ? opts.presence : opts.prev?.presence ?? null,
    anchor: opts.anchor !== undefined ? opts.anchor : opts.prev?.anchor ?? null,
    gaps: opts.gaps !== undefined ? opts.gaps : opts.prev?.gaps ?? null,
  };
}

/** Kompakter Sticky-Block für Author-Intent / Call-1 — Struktur, kein Wortlaut-Skript. */
export function formatAuftragStickyBlock(
  kind: FollowThroughKind | string,
  mem: AuftragMemory | null | undefined,
): string {
  if (!mem?.wish) return '';
  const gapBits =
    mem.gaps?.map((g) => `${g.kind}(${g.summary})`).join('+') || null;
  const parts = [
    `Sticky-Auftrag[${kind}]`,
    `Wunsch=${mem.wish}`,
    gapBits ? `Gap=${gapBits}` : null,
    mem.presence
      ? `Presence=${mem.presence.gpsCity}→${mem.presence.destCity}/${mem.presence.accessLeg}`
      : null,
    mem.anchor?.name ? `Anchor=${mem.anchor.name}` : null,
    mem.openTasks.length
      ? `OffeneTasks=${mem.openTasks.join(' | ')}`
      : 'OffeneTasks=—',
    mem.known.length ? `Bekannt=${mem.known.join('; ')}` : 'Bekannt=—',
    mem.stillNeed.length
      ? `NochBlocker=${mem.stillNeed.join('; ')}`
      : 'NochBlocker=keine — selbst fertigmachen',
    mem.deriveFirst.length
      ? `HerleitenZuerst=${mem.deriveFirst.join('; ')}`
      : null,
    'Root behalten bis Tasks+Musts sitzen; Kontext aus Sticky nutzen, nicht neu fragen',
  ];
  return parts.filter(Boolean).join(' · ').slice(0, 1000);
}

/** Thread-Bit an known hängen (Follow-up „um 18 Uhr“). */
export function appendAuftragKnownBit(
  mem: AuftragMemory | null | undefined,
  bit: string | null | undefined,
): AuftragMemory | null {
  if (!mem) return null;
  const b = (bit || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!b) return mem;
  if (mem.known.some((k) => k.includes(b.slice(0, 32)))) return mem;
  return {
    ...mem,
    known: [...mem.known, `Thread=${b}`].slice(0, 10),
    updatedAtMs: Date.now(),
  };
}

/** Session-Root aus Auftrag-Wunsch spiegeln (Kurzzeitgedächtnis). */
export function mirrorAuftragWishToSessionRoot(wish: string | null | undefined): void {
  const w = (wish || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  if (!w) return;
  try {
    const { noteSessionRootGoal, appendSessionThreadSpine } = require('../context/shortTermContext') as {
      noteSessionRootGoal: (g: string | null) => void;
      appendSessionThreadSpine: (b: string | null) => void;
    };
    noteSessionRootGoal(w);
    appendSessionThreadSpine('auftrag_sticky');
  } catch {
    /* soft */
  }
}
