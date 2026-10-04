/**
 * Mission-Vertrag SSOT — Phase 0/1.
 *
 * Call-1 schreibt den Auftrag (Familie, Anker, factsToProve).
 * Backend sucht/prüft; Ask-Back nur bei echten Blockern.
 * Kein Intent-Käfig, kein Soft-Fill gegen harte Musts.
 */

export type MissionFamily =
  | 'place'
  | 'amenity'
  | 'activity'
  | 'hotel'
  | 'event'
  | 'schedule'
  | 'transit'
  | 'flight'
  | 'fact'
  | 'rental';

export type MissionStage =
  | 'pack'
  | 'neighbor'
  | 'metro'
  | 'web'
  | 'places'
  | 'osm'
  | 'stay22'
  | 'events'
  | 'transit'
  | 'verify';

export type MissionFactStatus =
  | 'pending'
  | 'inferred'
  | 'proven'
  | 'failed';

export type MissionFactSource =
  | 'user'
  | 'order'
  | 'infer'
  | 'context'
  | 'gps';

/** Ein Belegpunkt auf dem Mission-Board. */
export type MissionChecklistItem = {
  id: string;
  label: string;
  /**
   * true = ohne diesen Punkt ist sinnvolle Suche unmöglich → Ask-Back erlaubt.
   * Nice-to-have / live-nachziehbar = false → trotzdem suchen.
   */
  critical: boolean;
  status: MissionFactStatus;
  value?: string | null;
  source?: MissionFactSource;
};

export type MissionAnchorKind =
  | 'named_city'
  | 'named_place'
  | 'gps'
  | 'sticky'
  | 'landmark';

export type MissionAnchor = {
  kind: MissionAnchorKind;
  label: string | null;
  name?: string | null;
};

/** Kanonischer Such-/Recherche-Auftrag. */
export type MissionChecklist = {
  family: MissionFamily;
  userText: string;
  /** Ambiguity-normalisierte Query für Suche / Prompt */
  normalizedQuery: string;
  anchor: MissionAnchor;
  must: string[];
  avoid: string[];
  nice: string[];
  factsToProve: MissionChecklistItem[];
  stages: MissionStage[];
  forbidSoftFill: boolean;
  /** Nur gesetzt wenn critical unresolved + nicht inferierbar */
  askBack: string | null;
  /** Angewandte stillen Umschreibungen (Debug / Prompt) */
  rewrites: string[];
};

/** Default-Stufen für Place/Activity/Hotel-Finden. */
export const MISSION_DEFAULT_STAGES: MissionStage[] = [
  'pack',
  'neighbor',
  'metro',
  'places',
  'osm',
  'web',
  'verify',
];

export const MISSION_HOTEL_STAGES: MissionStage[] = [
  'pack',
  'stay22',
  'places',
  'web',
  'verify',
];

export const MISSION_SCHEDULE_STAGES: MissionStage[] = [
  'pack',
  'events',
  'web',
  'verify',
];

export const MISSION_TRANSIT_STAGES: MissionStage[] = [
  'transit',
  'web',
  'verify',
];

export const MISSION_FLIGHT_STAGES: MissionStage[] = [
  'pack',
  'web',
  'verify',
];

export const MISSION_FACT_STAGES: MissionStage[] = ['pack', 'web', 'verify'];

/**
 * Ask-Back-Policy (Lock):
 * Nur wenn mindestens ein critical Fact noch pending und ohne Wert ist.
 * Kleine Lücken / Ambiguität → inferieren + suchen, nie nachfragen.
 */
export function hasCriticalBlocker(
  checklist: Pick<MissionChecklist, 'factsToProve'>,
): boolean {
  return (checklist.factsToProve || []).some(
    (f) =>
      f.critical &&
      f.status === 'pending' &&
      !(f.value && String(f.value).trim()),
  );
}

export function firstCriticalBlocker(
  checklist: Pick<MissionChecklist, 'factsToProve'>,
): MissionChecklistItem | null {
  return (
    (checklist.factsToProve || []).find(
      (f) =>
        f.critical &&
        f.status === 'pending' &&
        !(f.value && String(f.value).trim()),
    ) ?? null
  );
}

export function shouldEmitAskBack(
  checklist: Pick<MissionChecklist, 'factsToProve' | 'askBack'>,
): boolean {
  return hasCriticalBlocker(checklist);
}

export function markMissionFact(
  checklist: MissionChecklist,
  id: string,
  patch: Partial<
    Pick<MissionChecklistItem, 'status' | 'value' | 'source' | 'label'>
  >,
): MissionChecklist {
  const factsToProve = checklist.factsToProve.map((f) =>
    f.id === id ? { ...f, ...patch } : f,
  );
  const next: MissionChecklist = {
    ...checklist,
    factsToProve,
    askBack: null,
  };
  if (hasCriticalBlocker(next)) {
    const blocker = firstCriticalBlocker(next);
    next.askBack = blocker
      ? askBackCopyForFact(blocker)
      : checklist.askBack;
  } else {
    next.askBack = null;
  }
  return next;
}

export function askBackCopyForFact(fact: MissionChecklistItem): string {
  switch (fact.id) {
    case 'flight_time':
    case 'flight_departure':
      return 'Wann fliegst du — dann sag ich dir, wann du am Flughafen sein musst?';
    case 'arrival_deadline':
      return 'Bis wann solltest du spätestens ankommen?';
    case 'travel_dates':
      return 'Für welche Nächte soll ich das Hotel prüfen?';
    case 'dest_unclear':
      return 'Wohin genau soll die Suche gehen?';
    default:
      return `Mir fehlt noch: ${fact.label}. Kurz nachreichen?`;
  }
}

export function formatMissionChecklistForPrompt(
  m: MissionChecklist | null | undefined,
): string {
  if (!m) return '';
  const facts = m.factsToProve
    .map((f) => {
      const flag = f.critical ? 'CRIT' : 'nice';
      const val = f.value ? `=${f.value}` : '';
      return `${f.id}:${f.status}${val}(${flag})`;
    })
    .join(', ');
  return [
    'MISSION_CHECKLIST:',
    `family=${m.family}`,
    `anchor=${m.anchor.kind}:${m.anchor.label ?? m.anchor.name ?? '—'}`,
    `normalized=${m.normalizedQuery.slice(0, 160)}`,
    `must=[${m.must.join(', ')}]`,
    `avoid=[${m.avoid.join(', ')}]`,
    `nice=[${m.nice.join(', ')}]`,
    `stages=${m.stages.join('→')}`,
    `forbidSoftFill=${m.forbidSoftFill}`,
    `facts=[${facts}]`,
    `askBack=${m.askBack ?? '—'}`,
    m.rewrites.length ? `rewrites=${m.rewrites.join(' | ')}` : '',
    'Ask-Back NUR bei critical pending. Sonst suchen/inferieren.',
  ]
    .filter(Boolean)
    .join('\n');
}
