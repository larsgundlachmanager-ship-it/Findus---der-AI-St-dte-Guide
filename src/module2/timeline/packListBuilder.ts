/**
 * Packliste-Builder — reine Logik (Node-smoke-sicher).
 * Wetter + Dauer + Trip/Aktivitäten + Timeline → Items inkl. dynamischer Mengen.
 * Keine Stadt-Hardcodes, kein Speech-Skript.
 */

import type { PackListItem } from '../../store/usePackListStore';
import {
  applyPackListPrefs,
  mergePackPrefs,
  parsePackPrefsFromText,
  type PackGarmentCanon,
  type PackListPrefs,
} from './packListPrefs';
import { extractPackTripHints } from './packListTripHints';

export type PackListContext = {
  userText: string;
  /** z. B. „Kiel“ / GPS-Stadt */
  locationHint?: string | null;
  /** °C wenn belegt */
  tempC?: number | null;
  rainLikely?: boolean;
  sunnyOrWarm?: boolean;
  /** Timeline-/Plan-Titel zusammengeklebt */
  timelineBlob?: string | null;
  /** Belegte Reisetage (Nächte+1 oder explizit) */
  tripDays?: number | null;
  /** Extra Aktivitäten aus Research (nur Keywords/Labels) */
  activityHints?: string[] | null;
  /**
   * Waschmaschine vor Ort — nur mit Beleg (User/Hotel).
   * Ab 7 Tagen: unknown → nachfragen, nicht raten.
   */
  laundryAccess?: 'yes' | 'no' | 'unknown' | null;
  /** Kinderzahl wenn belegt (Ledger/User) */
  childrenCount?: number | null;
  /** Explizite Altersangaben in Jahren, wenn belegt */
  childAgesYears?: number[] | null;
  /** Persönliche Pack-Prefs (LearnedRule / User-Text) */
  packPrefs?: {
    avoid?: string[] | null;
    prefer?: string[] | null;
    notes?: string[] | null;
  } | null;
  /** Mehrere Personen (Mama für Papa+Kinder) — Items mit personId */
  persons?: Array<{
    id: string;
    name: string;
    role: 'self' | 'partner' | 'child' | 'other';
    ageAtTrip: number | null;
  }> | null;
};

export type PackListBuildResult = {
  items: PackListItem[];
  tripKinds: string[];
  activities: string[];
  tripDays: number | null;
  laundryAccess: 'yes' | 'no' | 'unknown';
  /** @deprecated nie User fragen — Research/UI statt Ask */
  askLaundry: boolean;
  evidenceNotes: string[];
};

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function pushItem(
  out: PackListItem[],
  seen: Set<string>,
  label: string,
  reason: string,
  category: PackListItem['category'],
  qty?: number | null,
  personId?: string | null,
): void {
  const bare = label.toLowerCase().replace(/^\d+×\s*/u, '');
  const key = `${personId || 'shared'}:${bare}`;
  if (seen.has(key)) return;
  seen.add(key);
  const q = qty != null && qty > 1 ? qty : null;
  out.push({
    id: uid(category),
    label: q ? `${q}× ${label}` : label,
    reason,
    done: false,
    qty: q,
    category,
    personId: personId ?? null,
  });
}

/** Kleidung/Hygiene etc. je Erwachsener; Kids bleiben personId. */
export function expandPackListByPersons(
  items: PackListItem[],
  persons: NonNullable<PackListContext['persons']>,
): PackListItem[] {
  if (!persons || persons.length < 2) {
    return items.map((it) => ({
      ...it,
      personId: it.personId ?? null,
    }));
  }
  const personal = new Set([
    'clothes',
    'swim',
    'sun',
    'cold',
    'rain',
    'formal',
    'hygiene',
  ]);
  const adults = persons.filter((p) => p.role !== 'child');
  const targets = adults.length > 0 ? adults : persons;
  const out: PackListItem[] = [];
  for (const it of items) {
    if (it.personId) {
      out.push(it);
      continue;
    }
    if (personal.has(it.category)) {
      for (const p of targets) {
        out.push({
          ...it,
          id: uid(it.category),
          personId: p.id,
          reason: it.reason.includes(p.name)
            ? it.reason
            : `${it.reason} · ${p.name}`,
        });
      }
    } else {
      out.push({ ...it, personId: null });
    }
  }
  return out;
}

export function looksLikePackListAsk(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // Follow-up: Waschmaschine-Antwort zur Packliste
  if (
    /\bwaschmaschine\b/iu.test(t) &&
    /\b(ja|nein|haben|gibt|vor\s+ort|hotel|unterkunft|packen|packliste)\b/iu.test(t)
  ) {
    return true;
  }
  return (
    /\b(packliste|packen|einpacken|mitnehmen\s+soll|was\s+(?:soll|muss)\s+ich\s+(?:ein)?pack|packing\s*list)\b/iu.test(
      t,
    ) ||
    (/\b(reisepass|badhose|sonnenbrille|sonnencreme|anzug)\b/iu.test(t) &&
      /\b(pack|mitnehm|liste|brauch|vergessen)\b/iu.test(t))
  );
}

/** User/Beleg: Waschmaschine vor Ort? */
export function detectLaundryAccess(text: string): 'yes' | 'no' | 'unknown' {
  const t = String(text || '').replace(/\s+/g, ' ');
  const laundry =
    /\b(waschmaschine|wäsche\s+waschen|waesche\s+waschen|waschsalon|laundry|washer)\b/iu.test(
      t,
    );
  if (!laundry && !/\b(wäsche|waesche)\b/iu.test(t)) return 'unknown';
  if (
    /\b(keine?\s+waschmaschine|kein\s+waschen|ohne\s+wasch|nicht\s+waschen|kein\s+waschsalon)\b/iu.test(
      t,
    ) ||
    (laundry && /\b(nein|kein|ohne|nicht)\b/iu.test(t))
  ) {
    return 'no';
  }
  if (
    /\b(waschmaschine\s+(?:ja|haben|gibt)|ja[,.]?\s+waschmaschine|haben\s+(?:eine?\s+)?waschmaschine|wäsche\s+(?:geht|möglich)|laundry\s+(?:yes|available))\b/iu.test(
      t,
    ) ||
    (laundry && /\b(ja|haben|gibt|vor\s+ort|im\s+hotel|in\s+der\s+unterkunft)\b/iu.test(t))
  ) {
    return 'yes';
  }
  // „Waschmaschine?“ allein = unknown (Frage)
  if (/\?\s*$/.test(t.trim()) && laundry) return 'unknown';
  return 'unknown';
}

/** Ab diesem Tagesschwellwert Waschmaschine nachfragen. */
export const PACK_LAUNDRY_ASK_MIN_DAYS = 7;

export type KidsAgeBand = 'baby' | 'toddler' | 'child' | 'teen';

export type KidsPackProfile = {
  present: boolean;
  count: number;
  bands: KidsAgeBand[];
  agesYears: number[];
};

function numWordKids(raw: string): number | null {
  const m = String(raw || '')
    .trim()
    .toLowerCase();
  if (/^\d+$/.test(m)) return Math.min(8, Number(m));
  const map: Record<string, number> = {
    ein: 1,
    eine: 1,
    zwei: 2,
    drei: 3,
    vier: 4,
    fünf: 5,
    fuenf: 5,
    sechs: 6,
  };
  return map[m] ?? null;
}

/** Kinderprofil aus Text + optional Ledger-Count/Alter. */
export function detectKidsPackProfile(opts: {
  userText: string;
  timelineBlob?: string | null;
  childrenCount?: number | null;
  childAgesYears?: number[] | null;
}): KidsPackProfile {
  const t = `${opts.userText || ''} ${opts.timelineBlob || ''}`;
  const ages: number[] = [...(opts.childAgesYears || [])].filter(
    (n) => Number.isFinite(n) && n >= 0 && n <= 17,
  );
  for (const m of t.matchAll(
    /\b(\d{1,2})\s*(?:jährige[rnrs]?|jaehrige[rnrs]?|jahre?\s+alt|years?\s*old)\b/giu,
  )) {
    const n = Number(m[1]);
    if (n >= 0 && n <= 17) ages.push(n);
  }
  // „2 und 8 Jahre“ / „3, 5 und 9 Jahre“
  for (const m of t.matchAll(
    /\b(\d{1,2}(?:\s*(?:und|[,/])\s*\d{1,2})+)\s*jahre?\b/giu,
  )) {
    for (const part of m[1]!.split(/\s*(?:und|[,/])\s*/u)) {
      const n = Number(part);
      if (n >= 0 && n <= 17) ages.push(n);
    }
  }
  for (const m of t.matchAll(/\b(\d{1,2})\s*monate?\b/giu)) {
    const months = Number(m[1]);
    if (months >= 0 && months < 24) ages.push(Math.max(0, months / 12));
  }

  let count =
    opts.childrenCount != null && opts.childrenCount > 0
      ? Math.min(8, Math.round(opts.childrenCount))
      : 0;
  const kidsCount = t.match(
    /\b(\d{1,2}|ein|eine|zwei|drei|vier|fünf|fuenf)\s+kinder(?:n)?\b/iu,
  );
  if (kidsCount) {
    const n = numWordKids(kidsCount[1]!);
    if (n) count = Math.max(count, n);
  }
  const presentHint =
    count > 0 ||
    ages.length > 0 ||
    /\b(baby|säugling|saeugling|kleinkind|kinderwagen|buggy|kindersitz|schulkind|teen(?:ager)?|kids.?club|mit\s+(?:kind|kids|baby)|familie\s+mit)\b/iu.test(
      t,
    );

  if (!presentHint && count <= 0 && ages.length === 0) {
    return { present: false, count: 0, bands: [], agesYears: [] };
  }

  if (count <= 0) count = Math.max(1, ages.length || 1);

  const bands = new Set<KidsAgeBand>();
  const pushBand = (a: number) => {
    if (a < 1) bands.add('baby');
    else if (a < 3) bands.add('toddler');
    else if (a < 12) bands.add('child');
    else bands.add('teen');
  };
  for (const a of ages) pushBand(a);

  if (bands.size === 0) {
    if (/\b(baby|säugling|saeugling|neugeboren)\b/iu.test(t)) bands.add('baby');
    if (/\b(kleinkind|toddler|windeln)\b/iu.test(t)) bands.add('toddler');
    if (/\b(schulkind|grundschule)\b/iu.test(t)) bands.add('child');
    if (/\b(teen(?:ager)?|jugendliche)\b/iu.test(t)) bands.add('teen');
    if (bands.size === 0) bands.add('child'); // Familie mit Kind, Alter unbekannt
  }

  return {
    present: true,
    count,
    bands: [...bands],
    agesYears: [...new Set(ages.map((a) => Math.round(a * 10) / 10))],
  };
}

/** Medikamenten-Hinweise nur bei Beleg (User nennt Allergie/Asthma/… oder Reise-Apotheke). */
export function detectMedNeeds(text: string): {
  travelKit: boolean;
  kidsFever: boolean;
  allergy: boolean;
  asthma: boolean;
  prescription: boolean;
  seaSick: boolean;
  insect: boolean;
} {
  const t = String(text || '');
  return {
    travelKit:
      /\b(medikament|apotheke|schmerz|ibuprofen|aspirin|reiseapotheke|pflaster)\b/iu.test(
        t,
      ),
    kidsFever:
      /\b(fiebersaft|fieberzäpfchen|fieberzaepfchen|kindermedikament|paracetamol\s+kind)\b/iu.test(
        t,
      ),
    allergy:
      /\b(allergie|antihistamin|epipen|notfallset\s+allerg)\b/iu.test(t),
    asthma: /\b(asthma|inhalator|salbutamol|asthmaspray)\b/iu.test(t),
    prescription:
      /\b(rezept|dauermedikation|blosser|blutdruck|insulin|pille\s+täglich)\b/iu.test(
        t,
      ),
    seaSick:
      /\b(übelkeit|uebelkeit|seekrank|reiseübelkeit|reiseuebelkeit|vomex)\b/iu.test(
        t,
      ),
    insect: /\b(mücke|muecke|stich|insektenstich|zeck)\b/iu.test(t),
  };
}

function appendKidsPackItems(opts: {
  items: PackListItem[];
  seen: Set<string>;
  kids: KidsPackProfile;
  tripDays: number | null;
  warm: boolean;
  swim: boolean;
  flightOrCruise: boolean;
  timelineBlob?: string | null;
  userText: string;
  personId?: string | null;
  personName?: string | null;
}): void {
  const { items, seen, kids } = opts;
  if (!kids.present) return;
  const pid = opts.personId ?? null;
  const bands = new Set(kids.bands);
  const days = opts.tripDays != null && opts.tripDays > 0 ? opts.tripDays : null;
  const blob = `${opts.userText} ${opts.timelineBlob || ''}`;
  const who = opts.personName || null;
  const reasonBase = who
    ? kids.agesYears.length > 0
      ? `${who} (${kids.agesYears.map((a) => (a < 1 ? '<1' : `${Math.round(a)}`)).join('/')} J.)`
      : who
    : kids.agesYears.length > 0
      ? `Kinder (${kids.agesYears.map((a) => (a < 1 ? '<1' : `${Math.round(a)}`)).join('/')} J.)`
      : kids.count > 1
        ? `${kids.count} Kinder im Trip`
        : 'Kind im Trip belegt';

  pushItem(items, seen, 'Snacks / Beschäftigung für unterwegs', reasonBase, 'kids', null, pid);
  pushItem(
    items,
    seen,
    'Wechselkleidung fürs Kind',
    days ? `${reasonBase} · ${days} Tage` : reasonBase,
    'kids',
    days != null ? Math.min(6, Math.max(2, Math.ceil(days / 2))) : null,
    pid,
  );

  if (bands.has('baby')) {
    const diapers =
      days != null ? Math.min(40, Math.max(8, days * 6)) : null;
    pushItem(items, seen, 'Windeln', `${reasonBase} · Baby`, 'kids', diapers, pid);
    pushItem(items, seen, 'Feuchttücher', 'Baby', 'kids', null, pid);
    pushItem(items, seen, 'Fläschchen / Stillzubehör', 'Baby unterwegs', 'kids', null, pid);
    pushItem(items, seen, 'Wickelunterlage (klein)', 'Baby', 'kids', null, pid);
    pushItem(items, seen, 'Babycreme / Wundschutz', 'Baby', 'kids', null, pid);
  }

  if (bands.has('toddler')) {
    if (!bands.has('baby')) {
      pushItem(
        items,
        seen,
        'Windeln / Pull-ups',
        `${reasonBase} · Kleinkind`,
        'kids',
        days != null ? Math.min(30, Math.max(6, days * 4)) : null,
        pid,
      );
      pushItem(items, seen, 'Feuchttücher', 'Kleinkind', 'kids', null, pid);
    }
    pushItem(items, seen, 'Trinkbecher mit Deckel', 'Kleinkind unterwegs', 'kids', null, pid);
    pushItem(items, seen, 'Lieblingsspielzeug / Kuscheltier', 'Kleinkind', 'kids', null, pid);
  }

  if (bands.has('child')) {
    pushItem(items, seen, 'Buch / Spiel / Tablet-Beschäftigung', reasonBase, 'kids', null, pid);
    if (opts.flightOrCruise) {
      pushItem(
        items,
        seen,
        'Ohrstöpsel / Kopfhörer fürs Kind',
        'Flug/Schiff mit Kind',
        'kids',
        null,
        pid,
      );
    }
  }

  if (bands.has('teen')) {
    pushItem(items, seen, 'Kopfhörer / Ladekabel fürs Teen', reasonBase, 'kids', null, pid);
  }

  if (
    /\b(kinderwagen|buggy|wagen)\b/iu.test(blob) ||
    (bands.has('baby') && /\b(spazieren|stadt|strand)\b/iu.test(blob))
  ) {
    pushItem(
      items,
      seen,
      'Kinderwagen / Buggy (oder Leihe vor Ort klären)',
      'Baby/Kleinkind im Kontext',
      'kids',
      null,
      pid,
    );
  }
  if (
    /\b(kindersitz|babyschale|iso.?fix)\b/iu.test(blob) ||
    (opts.flightOrCruise && (bands.has('baby') || bands.has('toddler')))
  ) {
    pushItem(
      items,
      seen,
      'Kindersitz / Babyschale (falls Mietwagen)',
      'Kleinkind + Reise',
      'kids',
      null,
      pid,
    );
  }

  if (opts.warm || opts.swim) {
    pushItem(
      items,
      seen,
      'Kindersonnencreme (hoher LSF)',
      opts.warm ? 'Wärme + Kind' : 'Baden + Kind',
      'kids',
      null,
      pid,
    );
  }
  if (opts.swim) {
    pushItem(items, seen, 'Kinder-Badehose / Badeanzug', 'Schwimmen/Pool mit Kind', 'kids', null, pid);
    if (bands.has('baby') || bands.has('toddler')) {
      pushItem(items, seen, 'Schwimmwindel / UV-Anzug', 'Baby/Kleinkind im Wasser', 'kids', null, pid);
    }
  }
}

function appendMedPackItems(opts: {
  items: PackListItem[];
  seen: Set<string>;
  userText: string;
  timelineBlob?: string | null;
  kids: KidsPackProfile;
  cruise: boolean;
  outdoor: boolean;
  softTravelKit: boolean;
}): void {
  const { items, seen } = opts;
  const blob = `${opts.userText} ${opts.timelineBlob || ''}`;
  const med = detectMedNeeds(blob);

  if (opts.softTravelKit || med.travelKit) {
    pushItem(
      items,
      seen,
      'Schmerzmittel / Pflaster (falls nötig)',
      med.travelKit ? 'Reise-Apotheke im Kontext' : 'Reise-Basis',
      'meds',
    );
  }
  if (med.allergy) {
    pushItem(
      items,
      seen,
      'Antihistaminikum / Allergie-Notfallset',
      'Allergie belegt',
      'meds',
    );
  }
  if (med.asthma) {
    pushItem(
      items,
      seen,
      'Inhalator / Asthmaspray',
      'Asthma belegt',
      'meds',
    );
  }
  if (med.prescription) {
    pushItem(
      items,
      seen,
      'Dauermedikation + Rezept/Bescheinigung',
      'Dauermedikation belegt',
      'meds',
    );
  }
  if (med.seaSick || opts.cruise) {
    pushItem(
      items,
      seen,
      'Mittel gegen Seekrankheit / Übelkeit',
      opts.cruise && !med.seaSick
        ? 'Kreuzfahrt — Soft-Tipp'
        : 'Übelkeit/Seekrankheit belegt',
      'meds',
    );
  }
  if (med.insect || opts.outdoor) {
    pushItem(
      items,
      seen,
      'Stichsalbe / Insektenschutz',
      med.insect ? 'Insekten/Zecken belegt' : 'Outdoor im Plan',
      'meds',
    );
  }

  const youngKids =
    opts.kids.present &&
    (opts.kids.bands.includes('baby') || opts.kids.bands.includes('toddler'));
  if (opts.kids.present && (med.kidsFever || youngKids)) {
    pushItem(
      items,
      seen,
      'Fieberthermometer',
      youngKids ? 'Kleines Kind unterwegs' : 'Kindermedikamente im Kontext',
      'meds',
    );
  }
  if (med.kidsFever || (youngKids && med.travelKit)) {
    pushItem(
      items,
      seen,
      'Fiebersaft / Fieberzäpfchen (kindgerecht)',
      med.kidsFever
        ? 'Kindermedikamente belegt'
        : 'Baby/Kleinkind + Reise-Apotheke',
      'meds',
    );
  }
}

/** Trip-Art aus Text + Timeline (stadt-agnostisch). */
export function detectPackTripKinds(
  userText: string,
  timelineBlob?: string | null,
): string[] {
  const blob = `${userText} ${timelineBlob || ''}`.toLowerCase();
  const kinds: string[] = [];
  if (/\b(kreuzfahrt|mein(?:en|em|e)?\s+schiff|aida|einschiff|bord)\b/i.test(blob)) {
    kinds.push('cruise');
  }
  if (
    /\b(strand|beach|baden|pool|schwimm|badhose|badeanzug|meer|ostsee|nordsee)\b/i.test(
      blob,
    )
  ) {
    kinds.push('swim');
  }
  if (/\b(flug|fliegen|flughafen|boarding)\b/i.test(blob)) kinds.push('flight');
  if (/\b(bahn|zug|flix\s*bus|fernbus)\b/i.test(blob)) kinds.push('surface');
  if (
    /\b(anzug|smoking|hochzeit|gala|theaterpremiere|business|bewerbung|formell|dresscode)\b/i.test(
      blob,
    )
  ) {
    kinds.push('formal');
  }
  if (/\b(berg|wandern|ski|schnee|hike)\b/i.test(blob)) kinds.push('outdoor_cold');
  if (/\b(rad|fahrrad|bike|e-?bike)\b/i.test(blob)) kinds.push('bike');
  if (/\b(spa|sauna|wellness)\b/i.test(blob)) kinds.push('spa');
  if (/\b(fitness|gym|sport|joggen|laufen)\b/i.test(blob)) kinds.push('sport');
  if (/\b(ausland|pass\b|reisepass|grenz|non-?schengen)\b/i.test(blob)) {
    kinds.push('docs_travel');
  }
  if (kinds.includes('cruise') || kinds.includes('flight')) {
    if (!kinds.includes('docs_travel')) kinds.push('docs_travel');
  }
  return kinds;
}

/** Aktivitäten aus Timeline/Research-Keywords. */
export function detectPackActivities(
  userText: string,
  timelineBlob?: string | null,
  activityHints?: string[] | null,
): string[] {
  const blob = `${userText} ${timelineBlob || ''} ${(activityHints || []).join(' ')}`.toLowerCase();
  const out: string[] = [];
  const add = (id: string, re: RegExp) => {
    if (re.test(blob) && !out.includes(id)) out.push(id);
  };
  add('swim', /\b(pool|strand|baden|schwimmen|beach)\b/);
  add('hike', /\b(wandern|berg|trail|hike)\b/);
  add('bike', /\b(rad|fahrrad|bike|e-?bike)\b/);
  add('spa', /\b(spa|sauna|wellness)\b/);
  add('sport', /\b(fitness|gym|joggen|sportkurs)\b/);
  add('city', /\b(stadtführung|sightseeing|altstadt|museum|galerie)\b/);
  add('nightlife', /\b(club|party|bar.?abend|disco)\b/);
  add(
    'formal',
    /\b(theater|konzert|gala|hochzeit|trauung|anzug|dresscode|wedding)\b/,
  );
  add(
    'sport_daily',
    /\b(jeden\s+tag|täglich|taeglich).{0,20}(tennis|padel|sport)|(tennis|padel).{0,20}(jeden\s+tag|täglich)/,
  );
  add('wedding', /\b(hochzeit|trauung|wedding)\b/);
  add('beach_day', /\b(strandtag|sonneliege|meer)\b/);
  add(
    'kids',
    /\b(kinder|kids.?club|familie\s+mit\s+kind|mit\s+(?:den\s+)?kids|baby|kleinkind|schulkind|teen)\b/,
  );
  for (const h of activityHints || []) {
    const s = String(h || '')
      .toLowerCase()
      .trim()
      .slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 12);
}

/**
 * Reisetage aus Text: „7 Nächte“, „5 Tage“, ISO-Spanne, „Wochenende“.
 * Default null = Mengen-Fallback 3 Tage wenn Trip-Kind da.
 */
export function inferTripDays(text: string, timelineBlob?: string | null): number | null {
  const t = String(text || '');
  const nights = t.match(/\b(\d{1,2})\s*(?:nächte|naechte|nights?)\b/iu);
  if (nights) {
    const n = Number(nights[1]);
    if (n >= 1 && n <= 30) return n + 1; // Nächte → Tage
  }
  const days = t.match(/\b(\d{1,2})\s*(?:tage|days?)\b/iu);
  if (days) {
    const n = Number(days[1]);
    if (n >= 1 && n <= 31) return n;
  }
  const week = t.match(/\b(\d{1,2})\s*wochen?\b/iu);
  if (week) {
    const n = Number(week[1]);
    if (n >= 1 && n <= 4) return n * 7;
  }
  if (/\bwochenende\b/iu.test(t)) return 3;
  const span = t.match(
    /\b(20\d{2}-\d{2}-\d{2})\s*[–\-bis]+\s*(20\d{2}-\d{2}-\d{2})\b/,
  );
  if (span) {
    const a = Date.parse(`${span[1]}T12:00:00`);
    const b = Date.parse(`${span[2]}T12:00:00`);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
      return Math.min(31, Math.round((b - a) / 86_400_000) + 1);
    }
  }
  // Timeline: unique dayKeys in ISO
  const tl = String(timelineBlob || '');
  const keys = [...tl.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => m[1]!);
  if (keys.length >= 2) {
    const uniq = [...new Set(keys)].sort();
    const a = Date.parse(`${uniq[0]}T12:00:00`);
    const b = Date.parse(`${uniq[uniq.length - 1]}T12:00:00`);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
      return Math.min(31, Math.round((b - a) / 86_400_000) + 1);
    }
  }
  if (keys.length === 1) return 1;
  return null;
}

/** Kleidungs-Mengen: Tage → Shirts / Hosen / Unterwäsche / Socken. */
export function clothingQuantities(opts: {
  tripDays: number;
  warm: boolean;
  cool: boolean;
  active: boolean;
  /** Belegte Waschmaschine → spürbar weniger Wechselwäsche */
  laundry?: boolean;
}): {
  tshirts: number;
  pants: number;
  shorts: number;
  underwear: number;
  socks: number;
} {
  const d = Math.max(1, Math.min(31, Math.round(opts.tripDays)));
  const laundry = opts.laundry === true;
  // Ohne Wäsche: 1 Shirt/Tag + 1 Puffer; mit Waschmaschine: ~alle 2–3 Tage + 1
  let tshirts = laundry
    ? Math.min(8, Math.max(3, Math.ceil(d / 2.5) + 1))
    : Math.min(10, d + 1);
  let pants = Math.max(1, Math.ceil(d / 2));
  if (opts.cool || opts.active) {
    pants = Math.max(pants, Math.min(d, Math.ceil(d * 0.75)));
  }
  if (laundry) pants = Math.max(2, Math.min(pants, Math.ceil(d / 3) + 1));
  pants = Math.min(8, pants);
  const shorts =
    opts.warm && !opts.cool
      ? laundry
        ? Math.min(4, Math.max(1, Math.ceil(d / 3)))
        : Math.min(6, Math.max(1, Math.ceil(d / 2)))
      : 0;
  const underwear = laundry
    ? Math.min(8, Math.max(3, Math.ceil(d / 2) + 1))
    : Math.min(12, d + 1);
  const socks = laundry
    ? Math.min(8, Math.max(3, Math.ceil(d / 2) + 1))
    : Math.min(12, d + 1);
  return { tshirts, pants, shorts, underwear, socks };
}

export function buildPackListItems(ctx: PackListContext): PackListBuildResult {
  const t = String(ctx.userText || '');
  const kinds = detectPackTripKinds(t, ctx.timelineBlob);
  const activities = [
    ...detectPackActivities(t, ctx.timelineBlob, ctx.activityHints),
  ];
  const items: PackListItem[] = [];
  const seen = new Set<string>();
  const evidenceNotes: string[] = [];

  let tripDays =
    ctx.tripDays != null && ctx.tripDays > 0
      ? ctx.tripDays
      : inferTripDays(t, ctx.timelineBlob);
  if (
    tripDays == null &&
    (kinds.length > 0 || looksLikePackListAsk(t))
  ) {
    // Soft-Fallback nur mit Trip-Signal — ehrlich als Schätzung markieren
    tripDays = kinds.includes('cruise') ? 7 : 3;
    evidenceNotes.push(`Dauer geschätzt ${tripDays} Tage (keine genaue Angabe)`);
  } else if (tripDays != null) {
    evidenceNotes.push(`${tripDays} Reisetage`);
  }

  const laundryFromText = detectLaundryAccess(t);
  const laundryAccess: 'yes' | 'no' | 'unknown' =
    ctx.laundryAccess === 'yes' || ctx.laundryAccess === 'no'
      ? ctx.laundryAccess
      : laundryFromText;
  // Nie den User fragen — Yorro recherchiert oder UI-Reiter
  const askLaundry = false;
  if (laundryAccess === 'yes') {
    evidenceNotes.push('Waschmaschine vor Ort (belegt) → weniger Wechselwäsche');
  } else if (laundryAccess === 'no') {
    evidenceNotes.push('Keine Waschmaschine / nicht waschen → volle Wechselwäsche');
  }

  const temp = ctx.tempC;
  const rain = ctx.rainLikely === true;
  const warm =
    ctx.sunnyOrWarm === true ||
    (temp != null && temp >= 22) ||
    kinds.includes('swim') ||
    kinds.includes('cruise') ||
    activities.includes('swim') ||
    activities.includes('beach_day');
  const cool = temp != null && temp <= 14;
  const chilly = temp != null && temp <= 18;
  const active =
    kinds.includes('outdoor_cold') ||
    kinds.includes('bike') ||
    kinds.includes('sport') ||
    activities.includes('hike') ||
    activities.includes('bike') ||
    activities.includes('sport');

  if (ctx.locationHint) evidenceNotes.push(`Ort ${ctx.locationHint}`);
  if (temp != null) evidenceNotes.push(`Wetter ca. ${Math.round(temp)}°`);
  if (rain) evidenceNotes.push('Regen möglich');
  if (kinds.length) evidenceNotes.push(`Trip: ${kinds.join(', ')}`);
  if (activities.length) {
    evidenceNotes.push(`Aktivitäten: ${activities.slice(0, 4).join(', ')}`);
  }

  // —— Dokumente ——
  if (kinds.includes('docs_travel') || /\breisepass|ausweis|pass\b/iu.test(t)) {
    pushItem(
      items,
      seen,
      'Reisepass / Ausweis',
      kinds.includes('cruise') || kinds.includes('flight')
        ? 'Reise/Flug/Kreuzfahrt — Ausweis belegt nötig'
        : 'Ausweis/Pass im Kontext',
      'docs',
    );
  }
  if (kinds.includes('flight') || kinds.includes('cruise')) {
    pushItem(
      items,
      seen,
      'Buchungsbestätigung / Schiffspass (digital oder Druck)',
      'Buchungsbeleg für Check-in',
      'docs',
    );
  }
  if (kinds.includes('flight')) {
    pushItem(items, seen, 'Bordkarte (App oder Druck)', 'Flug', 'docs');
  }

  // —— Dynamische Kleidung ——
  if (tripDays != null && tripDays >= 1) {
    const q = clothingQuantities({
      tripDays,
      warm,
      cool: cool || chilly,
      active,
      laundry: laundryAccess === 'yes',
    });
    const qtyReason =
      laundryAccess === 'yes'
        ? `${tripDays} Tage + Waschmaschine belegt`
        : `${tripDays} Tage → ${q.tshirts} Stück (1/Tag + Puffer)`;
    pushItem(
      items,
      seen,
      'T-Shirt / Oberteil',
      qtyReason,
      'clothes',
      q.tshirts,
    );
    pushItem(
      items,
      seen,
      'Lange Hose',
      laundryAccess === 'yes'
        ? `${tripDays} Tage + Waschmaschine → ${q.pants}`
        : `${tripDays} Tage → ${q.pants} Stück`,
      'clothes',
      q.pants,
    );
    if (q.shorts > 0) {
      pushItem(
        items,
        seen,
        'Kurze Hose',
        `Warmwetter · ${tripDays} Tage → ${q.shorts}`,
        'clothes',
        q.shorts,
      );
    }
    pushItem(
      items,
      seen,
      'Unterwäsche',
      `${tripDays} Tage → ${q.underwear}`,
      'clothes',
      q.underwear,
    );
    pushItem(
      items,
      seen,
      'Socken',
      `${tripDays} Tage → ${q.socks}`,
      'clothes',
      q.socks,
    );
    if (tripDays >= 3) {
      pushItem(
        items,
        seen,
        'Schlafanzug / bequeme Schlafkleidung',
        `${tripDays} Nächte unterwegs`,
        'clothes',
      );
    }
    if (laundryAccess === 'yes') {
      pushItem(
        items,
        seen,
        'Waschmittel (klein) / Wäschesack',
        'Waschmaschine vor Ort belegt',
        'misc',
      );
    }
  } else if (warm && !cool && !kinds.includes('formal')) {
    pushItem(items, seen, 'Kurze Hose / leichte Kleidung', 'Warmwetter', 'misc');
  }

  // —— Schwimmen / Sonne ——
  if (
    kinds.includes('swim') ||
    kinds.includes('cruise') ||
    activities.includes('swim') ||
    activities.includes('beach_day') ||
    warm
  ) {
    pushItem(
      items,
      seen,
      'Badehose / Badeanzug',
      kinds.includes('cruise') || activities.includes('swim')
        ? 'Pool/Strand/Schiff im Plan'
        : `Warm (${temp != null ? Math.round(temp) + '°' : 'Wetter'})`,
      'swim',
    );
  }
  if (
    warm ||
    kinds.includes('swim') ||
    kinds.includes('cruise') ||
    activities.includes('beach_day')
  ) {
    pushItem(
      items,
      seen,
      'Sonnencreme',
      warm ? 'Wärme/Sonne belegt' : 'Outdoor/Schiff',
      'sun',
    );
    pushItem(
      items,
      seen,
      'Sonnenbrille',
      warm ? 'Wärme/Sonne belegt' : 'Outdoor/Schiff',
      'sun',
    );
    pushItem(items, seen, 'Kopfbedeckung / Cap', 'Sonne/Outdoor', 'sun');
  }

  // —— Kälte / Regen ——
  if (
    (cool || chilly || kinds.includes('outdoor_cold') || rain) &&
    !seen.has('lange hose')
  ) {
    pushItem(
      items,
      seen,
      'Lange Hose',
      cool || chilly
        ? `Kühl (${temp != null ? Math.round(temp) + '°' : 'Wetter'})`
        : 'Outdoor/Regen',
      'cold',
    );
  }
  if (cool || rain || kinds.includes('outdoor_cold')) {
    pushItem(
      items,
      seen,
      rain ? 'Regenjacke' : 'Warme Jacke',
      rain
        ? 'Regen möglich'
        : `Kühl (${temp != null ? Math.round(temp) + '°' : ''})`.trim(),
      rain ? 'rain' : 'cold',
    );
  }
  if (rain) {
    pushItem(items, seen, 'Regenschirm', 'Regen möglich', 'rain');
  }

  // —— Formal ——
  if (
    kinds.includes('formal') ||
    activities.includes('formal') ||
    /\banzug\b/iu.test(t)
  ) {
    pushItem(
      items,
      seen,
      'Anzug / formelle Kleidung',
      'Formeller Anlass im Kontext',
      'formal',
    );
    pushItem(items, seen, 'Formelle Schuhe', 'Zum Anzug', 'formal');
  }

  // —— Aktivitäts-Extras (Research/Timeline) ——
  if (activities.includes('hike') || kinds.includes('outdoor_cold')) {
    pushItem(items, seen, 'Feste Schuhe / Wanderschuhe', 'Wandern/Outdoor', 'activity');
    pushItem(items, seen, 'Kleine Trinkflasche', 'Outdoor', 'activity');
  }
  if (activities.includes('bike') || kinds.includes('bike')) {
    pushItem(items, seen, 'Radhose / bequeme Sportkleidung', 'Radtour', 'activity');
    pushItem(items, seen, 'Fahrradhelm (falls eigener)', 'Radtour', 'activity');
  }
  if (activities.includes('spa') || kinds.includes('spa')) {
    pushItem(items, seen, 'Bademantel optional / Flip-Flops', 'Spa/Sauna', 'activity');
  }
  if (activities.includes('sport') || kinds.includes('sport')) {
    if (!activities.includes('sport_daily')) {
      pushItem(items, seen, 'Sportschuhe + Sportshirt', 'Sport/Fitness', 'activity');
    }
  }
  if (activities.includes('sport_daily')) {
    const sportQty =
      tripDays != null ? Math.min(14, Math.max(2, tripDays)) : null;
    pushItem(
      items,
      seen,
      'Sportshirt / Sport-Oberteil',
      'Sport täglich',
      'activity',
      sportQty,
    );
    pushItem(
      items,
      seen,
      'Sporthose',
      'Sport täglich',
      'activity',
      sportQty != null ? Math.max(2, Math.ceil(sportQty / 2)) : null,
    );
    pushItem(items, seen, 'Sportschuhe', 'Sport täglich', 'activity');
  }
  if (activities.includes('city')) {
    pushItem(items, seen, 'Bequeme Stadtschuhe', 'Sightseeing/Stadt', 'activity');
  }
  if (activities.includes('nightlife')) {
    pushItem(items, seen, 'Abend-Outfit', 'Nightlife im Plan', 'activity');
  }

  // Trip-Hints (Ledger-Hochzeit, Follow-up Tennis, …)
  const tripHints = extractPackTripHints({
    userText: t,
    ledgerBlob: `${ctx.timelineBlob || ''} ${(ctx.activityHints || []).join(' ')}`,
    tripDays,
  });
  for (const a of tripHints.activities) {
    if (!activities.includes(a)) activities.push(a);
  }
  for (const ex of tripHints.extras) {
    const before = items.length;
    pushItem(
      items,
      seen,
      ex.label,
      ex.reason,
      ex.category,
      ex.qty ?? null,
    );
    if (ex.priority === 'high') {
      const bare = ex.label.toLowerCase();
      for (const it of items) {
        if (it.label.toLowerCase().includes(bare.slice(0, 12)) || bare.includes(it.label.toLowerCase().replace(/^\d+×\s*/u, '').slice(0, 12))) {
          it.priority = 'high';
        }
      }
      if (items.length > before) {
        items[items.length - 1]!.priority = 'high';
      }
    }
  }
  if (tripHints.activities.includes('wedding') || tripHints.activities.includes('formal')) {
    for (const it of items) {
      if (/anzug|formelle\s+schuhe/i.test(it.label)) it.priority = 'high';
    }
  }
  for (const n of tripHints.notes.slice(0, 2)) evidenceNotes.push(n);
  // —— Kinder (altersfein, nur mit Beleg) ——
  const personList = (ctx.persons || []).filter(Boolean);
  const childPersons = personList.filter((p) => p.role === 'child');
  const agesFromPersons = childPersons
    .map((p) => p.ageAtTrip)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const kids = detectKidsPackProfile({
    userText: t,
    timelineBlob: ctx.timelineBlob,
    childrenCount:
      childPersons.length > 0
        ? childPersons.length
        : ctx.childrenCount,
    childAgesYears:
      agesFromPersons.length > 0
        ? agesFromPersons
        : ctx.childAgesYears,
  });
  if (kids.present && !activities.includes('kids')) {
    activities.push('kids');
  }
  if (kids.present) {
    evidenceNotes.push(
      kids.agesYears.length
        ? `Kinder Altersbänder: ${kids.bands.join(', ')}`
        : `Kinder (${kids.count})`,
    );
  }
  const swimLikely =
    kinds.includes('swim') ||
    kinds.includes('cruise') ||
    activities.includes('swim') ||
    activities.includes('beach_day') ||
    warm;
  if (childPersons.length > 0) {
    for (const child of childPersons) {
      const one = detectKidsPackProfile({
        userText: t,
        timelineBlob: ctx.timelineBlob,
        childrenCount: 1,
        childAgesYears:
          child.ageAtTrip != null ? [child.ageAtTrip] : [],
      });
      // Ohne Alter: Band „child“, damit Basis-Kids-Items kommen
      const profile =
        one.present
          ? one
          : {
              present: true as const,
              count: 1,
              bands: ['child' as const],
              agesYears: [] as number[],
            };
      appendKidsPackItems({
        items,
        seen,
        kids: profile,
        tripDays,
        warm,
        swim: swimLikely,
        flightOrCruise: kinds.includes('flight') || kinds.includes('cruise'),
        timelineBlob: ctx.timelineBlob,
        userText: t,
        personId: child.id,
        personName: child.name,
      });
    }
  } else {
    appendKidsPackItems({
      items,
      seen,
      kids,
      tripDays,
      warm,
      swim: swimLikely,
      flightOrCruise: kinds.includes('flight') || kinds.includes('cruise'),
      timelineBlob: ctx.timelineBlob,
      userText: t,
    });
  }

  // —— Medikamente (fein nur bei Beleg; Soft-Kit bei Trip-Pack) ——
  const softBase =
    looksLikePackListAsk(t) ||
    kinds.includes('cruise') ||
    kinds.includes('flight') ||
    (tripDays != null && tripDays >= 2);
  appendMedPackItems({
    items,
    seen,
    userText: t,
    timelineBlob: ctx.timelineBlob,
    kids,
    cruise: kinds.includes('cruise'),
    outdoor:
      kinds.includes('outdoor_cold') ||
      activities.includes('hike') ||
      activities.includes('bike'),
    softTravelKit: softBase,
  });

  // —— Basis Hygiene / Tech ——
  if (softBase) {
    pushItem(items, seen, 'Zahnbürste / Zahnpasta', 'Reise-Basis', 'hygiene');
    pushItem(items, seen, 'Duschgel / Deo', 'Reise-Basis', 'hygiene');
    pushItem(items, seen, 'Handy-Ladekabel / Adapter', 'Reise-Basis', 'tech');
    pushItem(items, seen, 'Powerbank', 'Reise-Basis', 'tech');
  }

  // —— Schuhe Default ——
  if (tripDays != null && tripDays >= 2 && !seen.has('bequeme stadtschuhe')) {
    pushItem(items, seen, 'Bequeme Alltagsschuhe', 'Reise-Basis', 'clothes');
  }

  // —— Persönliche Prefs (LearnedRule / „nie Pulli“) ——
  const fromText = parsePackPrefsFromText(t);
  const fromCtx: PackListPrefs = {
    avoid: (ctx.packPrefs?.avoid || []).filter(Boolean) as PackGarmentCanon[],
    prefer: (ctx.packPrefs?.prefer || []).filter(Boolean) as PackGarmentCanon[],
    notes: [...(ctx.packPrefs?.notes || [])],
  };
  const prefs = mergePackPrefs(fromCtx, fromText);
  let finalItems = items;
  if (prefs.avoid.length || prefs.prefer.length) {
    const applied = applyPackListPrefs(items, prefs);
    finalItems = applied.items;
    if (applied.removed.length) {
      evidenceNotes.push(`Prefs weg: ${applied.removed.slice(0, 3).join(', ')}`);
    }
    if (applied.added.length) {
      evidenceNotes.push(`Prefs dazu: ${applied.added.slice(0, 3).join(', ')}`);
    }
    for (const n of prefs.notes.slice(0, 2)) evidenceNotes.push(n);
  }

  if (personList.length >= 2) {
    finalItems = expandPackListByPersons(finalItems, personList);
    evidenceNotes.push(
      `Personen: ${personList.map((p) => p.name).slice(0, 6).join(', ')}`,
    );
  }

  return {
    items: finalItems,
    tripKinds: kinds,
    activities,
    tripDays,
    laundryAccess,
    askLaundry,
    evidenceNotes,
  };
}

/**
 * Mengen neu berechnen bei Waschmaschine ja/nein — Done/Prio/Later bleiben.
 */
export function reapplyLaundryQuantities(
  items: PackListItem[],
  opts: {
    tripDays: number;
    laundry: boolean;
    warm?: boolean;
    cool?: boolean;
    active?: boolean;
  },
): PackListItem[] {
  const d = Math.max(1, Math.min(31, Math.round(opts.tripDays)));
  const q = clothingQuantities({
    tripDays: d,
    warm: opts.warm === true,
    cool: opts.cool === true,
    active: opts.active === true,
    laundry: opts.laundry,
  });
  const reason = opts.laundry
    ? `${d} Tage + Waschmaschine`
    : `${d} Tage → volle Wechselwäsche`;

  const patchQty = (
    it: PackListItem,
    bareLabel: string,
    qty: number,
  ): PackListItem => ({
    ...it,
    qty,
    label: qty > 1 ? `${qty}× ${bareLabel}` : bareLabel,
    reason,
  });

  let out = items.map((it) => {
    const bare = it.label.replace(/^\d+×\s*/u, '');
    if (/t-shirt|oberteil/i.test(bare)) {
      return patchQty(it, bare.replace(/^\d+×\s*/u, '') || 'T-Shirt / Oberteil', q.tshirts);
    }
    if (/^lange hose$/i.test(bare) || (/lange hose/i.test(bare) && it.category === 'clothes')) {
      return patchQty(it, 'Lange Hose', q.pants);
    }
    if (/kurze hose|shorts/i.test(bare) && q.shorts > 0) {
      return patchQty(it, 'Kurze Hose', q.shorts);
    }
    if (/unterwäsche|unterhose/i.test(bare)) {
      return patchQty(it, 'Unterwäsche', q.underwear);
    }
    if (/^socken$/i.test(bare)) {
      return patchQty(it, 'Socken', q.socks);
    }
    return it;
  });

  // Kurze Hose entfernen wenn nicht warm
  if (q.shorts <= 0) {
    out = out.filter((it) => !/kurze hose|shorts/i.test(it.label));
  }

  const hasDetergent = out.some((it) => /waschmittel|wäsch/i.test(it.label));
  if (opts.laundry && !hasDetergent) {
    out = [
      ...out,
      {
        id: `misc_${Math.random().toString(36).slice(2, 8)}`,
        label: 'Waschmittel (klein) / Wäschesack',
        reason: 'Waschmaschine vor Ort',
        done: false,
        category: 'misc',
      },
    ];
  }
  if (!opts.laundry) {
    out = out.filter((it) => !/waschmittel|wäsch/i.test(it.label));
  }
  return out;
}
