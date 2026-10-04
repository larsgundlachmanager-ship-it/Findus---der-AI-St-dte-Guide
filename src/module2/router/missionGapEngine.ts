/**
 * Mission Gap-Engine — Lücken erkennen → Tasks vorschieben → Anker setzen.
 *
 * Presence: GPS≠Zielstadt → Anreise zuerst.
 * Surprise-Anchor: Ticket/Theater gebucht → Venue resolve → Anker → weiter.
 *
 * Struktur-Blaupause, kein Dialog-Skript. Kernel/TTS unberührt.
 */

import type { Call1WorkItem, Call1ProximityMode } from './call1TaskBrief';
import type { Call1WorkerId } from './call1CapabilityMap';

export type MissionGapPresence = {
  kind: 'presence';
  gpsCity: string;
  destCity: string;
  accessModes: Array<'flight' | 'train' | 'car' | 'unknown'>;
};

export type MissionGapSurpriseAnchor = {
  kind: 'surprise_anchor';
  venueHint: string;
  whenHint: string | null;
  evidence: string;
  showHint?: string | null;
};

export type MissionGap = MissionGapPresence | MissionGapSurpriseAnchor;

export type MissionAnchor = {
  name: string;
  lat?: number | null;
  lng?: number | null;
  whenMs?: number | null;
  cityId?: string | null;
  kind?: 'theater' | 'venue' | 'event' | string;
};

export type GapPlan = {
  gaps: MissionGap[];
  prepend: Call1WorkItem[];
  deferIds: string[];
  deriveFirst: string[];
  blockers: string[];
  setAnchor?: MissionAnchor | null;
  presence?: {
    gpsCity: string;
    destCity: string;
    accessLeg: 'needed' | 'already_there' | 'unknown';
  } | null;
};

const PROX: Call1ProximityMode = 'here_now';

function foldCity(s: string | null | undefined): string {
  try {
    const { foldCityKey } = require('../../services/navigation/landmarkAliases') as {
      foldCityKey: (x: string | null | undefined) => string;
    };
    return foldCityKey(s) || '';
  } catch {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '');
  }
}

function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  try {
    const { sameFoldedCity } = require('../planning/planDestinationCity') as {
      sameFoldedCity: (x?: string | null, y?: string | null) => boolean;
    };
    return sameFoldedCity(a, b);
  } catch {
    const fa = foldCity(a);
    const fb = foldCity(b);
    return Boolean(fa && fb && fa.length >= 3 && (fa === fb || fa.includes(fb) || fb.includes(fa)));
  }
}

function extractDestCity(text: string, researchCity?: string | null): string | null {
  const explicit = (researchCity || '').trim();
  if (explicit.length >= 2) return explicit;
  try {
    const { extractCityFromText } = require('../context/shortTermContext') as {
      extractCityFromText: (s: string) => string | null;
    };
    return extractCityFromText(text);
  } catch {
    const m = text.match(
      /\b(?:in|nach|nach\s+)\s*([A-ZÄÖÜ][\wÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-]+)?)/u,
    );
    return m?.[1] ?? null;
  }
}

function inferAccessModes(text: string): MissionGapPresence['accessModes'] {
  const t = text || '';
  const modes: MissionGapPresence['accessModes'] = [];
  if (/\b(flug|fliegen|flieger|airport|flughafen)\b/iu.test(t)) modes.push('flight');
  if (/\b(bahn|zug|ice|rail|öpnv|oepnv|db)\b/iu.test(t)) modes.push('train');
  if (/\b(auto|fahrer|mit\s+dem\s+wagen|mietwagen)\b/iu.test(t)) modes.push('car');
  if (!modes.length) modes.push('unknown');
  return modes;
}

/** Zielstadt ≠ GPS → Presence-Gap. */
export function detectPresenceGap(opts: {
  userText: string;
  gpsCity?: string | null;
  researchCity?: string | null;
  accessAlreadyResolved?: boolean;
}): MissionGapPresence | null {
  if (opts.accessAlreadyResolved) return null;
  const gps = (opts.gpsCity || '').trim();
  if (!gps) return null;
  const dest = extractDestCity(opts.userText, opts.researchCity);
  if (!dest) return null;
  if (sameCity(gps, dest)) return null;
  // Braucht Vor-Ort-Absicht oder Reise-Signal — nicht jede Stadt-Erwähnung
  const t = opts.userText || '';
  const wantsThere =
    /\b(in|nach)\s+/iu.test(t) ||
    /\b(theater|abendessen|essen|erkunden|plan|sightseeing|hotel|ticket|vorstellung|stück|stueck)\b/iu.test(
      t,
    );
  if (!wantsThere) return null;
  return {
    kind: 'presence',
    gpsCity: gps,
    destCity: dest,
    accessModes: inferAccessModes(t),
  };
}

const BOOKED_VENUE_RE =
  /\b(?:habe?\s+(?:schon\s+)?(?:karten|tickets?|eintrittskarten)|(?:schon\s+)?(?:gebucht|reserviert)|karten\s+f(?:ü|ue)r|tickets?\s+f(?:ü|ue)r|vorstellung|theaterst(?:ü|ue)ck|im\s+schauspielhaus|ins\s+theater)\b/iu;

const THEATER_VENUE_RE =
  /\b(theater|schauspielhaus|oper|ballett|musical|konzerthaus|kammerspiele)\b/iu;

/** „Karten für Hamlet im Schauspielhaus“ / Ticket gebucht. */
export function detectSurpriseAnchorGap(opts: {
  userText: string;
  existingAnchorName?: string | null;
}): MissionGapSurpriseAnchor | null {
  const t = (opts.userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (opts.existingAnchorName && THEATER_VENUE_RE.test(opts.existingAnchorName)) {
    return null;
  }
  const booked = BOOKED_VENUE_RE.test(t) || (THEATER_VENUE_RE.test(t) && /\b(karten|ticket|gebucht|stück|stueck|hamlet|vorstellung)\b/iu.test(t));
  if (!booked) return null;

  let venueHint =
    t.match(
      /\b(?:im|in\s+der|in\s+dem|ins)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-]*(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-]*){0,3})/u,
    )?.[1] || null;
  if (!venueHint && THEATER_VENUE_RE.test(t)) {
    venueHint =
      t.match(
        /\b((?:[A-ZÄÖÜ][\wÄÖÜäöüß\-]+\s+){0,2}(?:Theater|Schauspielhaus|Oper|Musical|Kammerspiele))\b/u,
      )?.[1] || 'Theater';
  }
  if (!venueHint) venueHint = 'Theater';

  const showHint =
    t.match(
      /\b(?:f(?:ü|ue)r|stück|stueck)\s+([A-ZÄÖÜ][\wÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-]+){0,3})/iu,
    )?.[1] ||
    t.match(/\b(Hamlet|Zauberflöte|Zauberfloete|Carmen|Figaro)\b/u)?.[1] ||
    null;

  const whenHint =
    t.match(/\b(?:um\s+)?(\d{1,2}(?::\d{2})?\s*uhr|\d{1,2}[:.]\d{2})\b/iu)?.[1] ||
    (/\b(heute|morgen|abend)\b/iu.test(t)
      ? t.match(/\b(heute|morgen|abend)\b/iu)?.[1] || null
      : null);

  return {
    kind: 'surprise_anchor',
    venueHint: venueHint.slice(0, 80),
    whenHint,
    evidence: booked ? 'booked_or_ticket_cue' : 'theater_cue',
    showHint: showHint?.slice(0, 80) || null,
  };
}

export function detectMissionGaps(opts: {
  userText: string;
  gpsCity?: string | null;
  researchCity?: string | null;
  accessAlreadyResolved?: boolean;
  existingAnchorName?: string | null;
}): MissionGap[] {
  const out: MissionGap[] = [];
  const presence = detectPresenceGap(opts);
  if (presence) out.push(presence);
  const surprise = detectSurpriseAnchorGap(opts);
  if (surprise) out.push(surprise);
  return out;
}

function workerForAccessModes(
  modes: MissionGapPresence['accessModes'],
): Call1WorkerId {
  if (modes.includes('flight') && !modes.includes('train')) return 'flight';
  if (modes.includes('train')) return 'transit';
  if (modes.includes('flight')) return 'flight';
  return 'reisebuero';
}

function isLocalOnSiteTask(w: Call1WorkItem): boolean {
  return (
    w.worker === 'pitch' ||
    w.worker === 'dining' ||
    w.worker === 'plan' ||
    w.worker === 'tour' ||
    w.worker === 'events' ||
    w.worker === 'nav' ||
    w.worker === 'place' ||
    /essen|theater|abend|sightseeing|erkunden|pitch/i.test(w.brief)
  );
}

/** Presence → access_to_dest prepend, vor-Ort later. */
export function buildDestAccessWorkChain(opts: {
  gap: MissionGapPresence;
  proximity?: Call1ProximityMode;
}): Call1WorkItem[] {
  const worker = workerForAccessModes(opts.gap.accessModes);
  const modeLabel = opts.gap.accessModes.filter((m) => m !== 'unknown').join('/') || 'Anreise';
  return [
    {
      id: 'access_to_dest',
      worker,
      brief: `Presence-Gap: Anreise ${opts.gap.gpsCity} → ${opts.gap.destCity} (${modeLabel}) zuerst herleiten — vor Ort erst danach`,
      destCity: opts.gap.destCity,
      proximity: opts.proximity || PROX,
      executeWhen: 'now',
      must: undefined,
      neededSlots: opts.gap.accessModes.includes('unknown')
        ? ['access_mode']
        : undefined,
    },
  ];
}

/** Surprise-Anchor → resolve now, Folgetasks later. */
export function buildSurpriseAnchorWork(opts: {
  gap: MissionGapSurpriseAnchor;
  proximity?: Call1ProximityMode;
}): Call1WorkItem[] {
  const show = opts.gap.showHint ? ` Stück=${opts.gap.showHint}` : '';
  const when = opts.gap.whenHint ? ` Wann=${opts.gap.whenHint}` : '';
  return [
    {
      id: 'anchor_resolve',
      worker: 'events',
      brief: `Surprise-Anchor: Venue „${opts.gap.venueHint}“ resolve + Programm/Stück belegen${show}${when} — Timeline-Anker setzen, dann weiter`,
      proximity: opts.proximity || PROX,
      executeWhen: 'now',
      wantBookingLink: false,
    },
  ];
}

/**
 * Gaps → prepend + defer on-site / follow-on tasks.
 */
export function planFromGaps(opts: {
  gaps: MissionGap[];
  existingWork: Call1WorkItem[];
  proximity?: Call1ProximityMode;
}): GapPlan {
  const prepend: Call1WorkItem[] = [];
  const deferIds: string[] = [];
  const deriveFirst: string[] = [];
  const blockers: string[] = [];
  let setAnchor: MissionAnchor | null = null;
  let presence: GapPlan['presence'] = null;

  const presenceGap = opts.gaps.find((g): g is MissionGapPresence => g.kind === 'presence');
  const surpriseGap = opts.gaps.find(
    (g): g is MissionGapSurpriseAnchor => g.kind === 'surprise_anchor',
  );

  if (presenceGap) {
    presence = {
      gpsCity: presenceGap.gpsCity,
      destCity: presenceGap.destCity,
      accessLeg: 'needed',
    };
    prepend.push(
      ...buildDestAccessWorkChain({
        gap: presenceGap,
        proximity: opts.proximity,
      }),
    );
    deriveFirst.push(
      `Anreise ${presenceGap.gpsCity}→${presenceGap.destCity} aus Kontext/Modus herleiten`,
    );
    if (presenceGap.accessModes.includes('unknown')) {
      blockers.push('Anreise-Modus (Flug/Bahn/Auto) wenn nicht herleitbar');
    }
    for (const w of opts.existingWork) {
      if (isLocalOnSiteTask(w) && w.id !== 'access_to_dest') {
        deferIds.push(w.id);
      }
    }
  }

  if (surpriseGap) {
    prepend.push(
      ...buildSurpriseAnchorWork({
        gap: surpriseGap,
        proximity: opts.proximity,
      }),
    );
    setAnchor = {
      name: surpriseGap.venueHint,
      cityId: presenceGap?.destCity || null,
      kind: 'theater',
    };
    deriveFirst.push(
      `Venue „${surpriseGap.venueHint}“ geocoden/Pack/Web`,
      surpriseGap.showHint
        ? `Stück „${surpriseGap.showHint}“ belegen`
        : 'Programm/Stück belegen wenn Name fehlt',
    );
    if (!surpriseGap.venueHint || surpriseGap.venueHint === 'Theater') {
      if (!/\bschauspiel|oper|musical/i.test(surpriseGap.venueHint)) {
        /* named enough */
      }
    }
    for (const w of opts.existingWork) {
      if (
        (w.worker === 'dining' ||
          w.worker === 'pitch' ||
          w.worker === 'nav' ||
          /\bessen|danach|danach\s+essen|restaurant/i.test(w.brief)) &&
        w.id !== 'anchor_resolve'
      ) {
        if (!deferIds.includes(w.id)) deferIds.push(w.id);
      }
    }
  }

  return {
    gaps: opts.gaps,
    prepend,
    deferIds,
    deriveFirst,
    blockers,
    setAnchor,
    presence,
  };
}

/** Work mergen: prepend vorne, defer → later + dependsOn. */
export function applyGapPlan(
  work: Call1WorkItem[],
  plan: GapPlan,
): Call1WorkItem[] {
  if (!plan.prepend.length && !plan.deferIds.length) return work;

  const primaryPrependId = plan.prepend[0]?.id || null;
  const byId = new Map(work.map((w) => [w.id, { ...w }]));

  for (const id of plan.deferIds) {
    const cur = byId.get(id);
    if (!cur) continue;
    cur.executeWhen = 'later';
    if (primaryPrependId && cur.id !== primaryPrependId) {
      // Presence zuerst, sonst Anchor
      if (plan.prepend.some((p) => p.id === 'access_to_dest')) {
        cur.dependsOn = cur.dependsOn || 'access_to_dest';
      } else if (plan.prepend.some((p) => p.id === 'anchor_resolve')) {
        cur.dependsOn = cur.dependsOn || 'anchor_resolve';
      }
    }
    byId.set(id, cur);
  }

  // Dining nach Anchor: dependsOn anchor_resolve (auch wenn Presence davor)
  if (plan.prepend.some((p) => p.id === 'anchor_resolve')) {
    for (const [id, cur] of byId) {
      if (
        (cur.worker === 'dining' ||
          cur.worker === 'pitch' ||
          /\bessen|danach/i.test(cur.brief)) &&
        id !== 'anchor_resolve'
      ) {
        cur.executeWhen = 'later';
        cur.dependsOn = 'anchor_resolve';
        // Wenn auch Presence: Kette access → anchor → dining
        if (plan.prepend.some((p) => p.id === 'access_to_dest')) {
          const anchor = plan.prepend.find((p) => p.id === 'anchor_resolve');
          if (anchor) anchor.dependsOn = anchor.dependsOn || 'access_to_dest';
        }
        byId.set(id, cur);
      }
    }
  }

  const rest = [...byId.values()];
  const existingIds = new Set(rest.map((w) => w.id));
  const head = plan.prepend.filter((p) => !existingIds.has(p.id));
  // Anchor depends on access if both
  if (
    head.some((p) => p.id === 'access_to_dest') &&
    head.some((p) => p.id === 'anchor_resolve')
  ) {
    for (const p of head) {
      if (p.id === 'anchor_resolve') p.dependsOn = 'access_to_dest';
    }
  }
  return [...head, ...rest].slice(0, 8);
}

/** Presence-Gap aktiv → Explore/Pitch-Drift blocken. */
export function blocksExploreDriftForPresenceGap(opts: {
  userText: string;
  gpsCity?: string | null;
  researchCity?: string | null;
  accessResolved?: boolean;
}): boolean {
  if (opts.accessResolved) return false;
  return Boolean(detectPresenceGap(opts));
}

/** Offener Surprise-Anchor: Pitch nicht vom GPS-Heimat starten. */
export function hasOpenSurpriseAnchor(opts: {
  userText?: string;
  anchorName?: string | null;
}): boolean {
  if (opts.anchorName) return true;
  return Boolean(detectSurpriseAnchorGap({ userText: opts.userText || '' }));
}
