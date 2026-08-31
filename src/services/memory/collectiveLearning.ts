/**
 * Collective Learning — Crowd → alle User.
 *
 * 1) Recherche-Orte → community_discovered_places (active ab Trust/2 Confirms)
 * 2) Follow-ups / Fehler / Cohort-Stil → Signals; ab 3 Contributors → promoted
 * 3) Lokales Overlay + Prompt-Blöcke für Runtime
 */

import * as FileSystem from 'expo-file-system';
import { AppState, type NativeEventSubscription } from 'react-native';
import { env } from '../../config/env';
import { getCachedUserProfile } from '../userProfileService';
import { getOrCreateContributorHash } from './betaSituationQueue';
import type { LearnedRuleIntentFamily } from '../../types/learnedRules';

export type CollectiveSignalKind = 'followup' | 'error_avoid' | 'cohort_style';

export type DiscoveredPlace = {
  placeKey: string;
  cityHint: string | null;
  name: string;
  placeType: string;
  lat: number | null;
  lng: number | null;
  factText: string | null;
  sourceUrl: string | null;
  sourceTrust: number;
  status: 'pending' | 'active' | 'rejected';
};

export type PromotedLearning = {
  signalKey: string;
  signalKind: CollectiveSignalKind;
  intentFamily: string;
  payload: Record<string, unknown>;
  uniqueContributors: number;
};

const OVERLAY_PATH = `${FileSystem.documentDirectory}findus-community-places.json`;
const PROMOTED_PATH = `${FileSystem.documentDirectory}findus-collective-promoted.json`;
const META_PATH = `${FileSystem.documentDirectory}findus-collective-learning-meta.json`;

const AUTO_USERS = 3;

let cachedPlaces: DiscoveredPlace[] = [];
let cachedPromoted: PromotedLearning[] = [];
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let appSub: NativeEventSubscription | null = null;

function supabaseConfig(): { base: string; key: string } | null {
  const base = env.supabaseUrl()?.replace(/\/$/, '');
  const key = env.supabaseAnonKey();
  if (!base || !key || base.includes('your-project')) return null;
  return { base, key };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeKey(parts: string[]): string {
  return parts
    .map((p) =>
      p
        .toLowerCase()
        .replace(/[^a-z0-9äöüß_+-]+/giu, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 60),
    )
    .filter(Boolean)
    .join('::')
    .slice(0, 180);
}

export function placeKeyFromName(
  name: string,
  lat?: number | null,
  lng?: number | null,
): string {
  const n = name
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]+/giu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    return `${n}@${Math.round(lat * 100) / 100},${Math.round(lng * 100) / 100}`;
  }
  return n;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return fallback;
    return JSON.parse(await FileSystem.readAsStringAsync(path)) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(path, JSON.stringify(value));
  } catch {
    /* soft */
  }
}

export function getCachedCommunityPlacesSync(): DiscoveredPlace[] {
  return cachedPlaces.filter((p) => p.status === 'active');
}

export function getCachedPromotedLearningSync(): PromotedLearning[] {
  return cachedPromoted;
}

export async function hydrateCollectiveLearningCache(): Promise<void> {
  const places = await readJson<{ places?: DiscoveredPlace[] }>(OVERLAY_PATH, {});
  const promoted = await readJson<{ items?: PromotedLearning[] }>(PROMOTED_PATH, {});
  cachedPlaces = places.places ?? [];
  cachedPromoted = promoted.items ?? [];
}

/** Recherche-Fund → Community (alle User nach Activate). */
export async function contributeDiscoveredPlace(input: {
  name: string;
  placeType?: string;
  cityHint?: string | null;
  lat?: number | null;
  lng?: number | null;
  factText?: string | null;
  sourceUrl?: string | null;
  sourceTrust?: number;
}): Promise<void> {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (name.length < 3) return;
  const cfg = supabaseConfig();
  const hash = await getOrCreateContributorHash();
  const place_key = placeKeyFromName(name, input.lat, input.lng);
  const trust = Math.max(0.1, Math.min(1, input.sourceTrust ?? 0.45));

  // Lokal sofort mergen (dieser User)
  const local: DiscoveredPlace = {
    placeKey: place_key,
    cityHint: input.cityHint ?? null,
    name,
    placeType: input.placeType ?? 'place',
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    factText: input.factText?.slice(0, 400) ?? null,
    sourceUrl: input.sourceUrl ?? null,
    sourceTrust: trust,
    status: trust >= 0.55 ? 'active' : 'pending',
  };
  const idx = cachedPlaces.findIndex((p) => p.placeKey === place_key);
  if (idx >= 0) cachedPlaces[idx] = { ...cachedPlaces[idx]!, ...local };
  else cachedPlaces.push(local);
  void writeJson(OVERLAY_PATH, { places: cachedPlaces.slice(0, 400) });

  if (!cfg) return;
  try {
    // Read-modify-write confirm_count
    const getRes = await fetch(
      `${cfg.base}/rest/v1/community_discovered_places?place_key=eq.${encodeURIComponent(place_key)}&select=place_key,contributor_hashes,confirm_count,source_trust,status`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
        },
      },
    );
    let confirm = 1;
    let hashes: string[] = [hash];
    let prevTrust = trust;
    if (getRes.ok) {
      const rows = (await getRes.json()) as Array<{
        contributor_hashes?: string[];
        confirm_count?: number;
        source_trust?: number;
      }>;
      const row = rows[0];
      if (row) {
        const prev = Array.isArray(row.contributor_hashes)
          ? row.contributor_hashes
          : [];
        if (!prev.includes(hash)) {
          hashes = [...prev, hash];
          confirm = (row.confirm_count ?? prev.length) + 1;
        } else {
          hashes = prev;
          confirm = row.confirm_count ?? prev.length;
        }
        prevTrust = Math.max(prevTrust, Number(row.source_trust) || 0);
      }
    }

    await fetch(
      `${cfg.base}/rest/v1/community_discovered_places?on_conflict=place_key`,
      {
        method: 'POST',
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          place_key,
          city_hint: input.cityHint ?? null,
          name,
          place_type: input.placeType ?? 'place',
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          fact_text: input.factText?.slice(0, 400) ?? null,
          source_url: input.sourceUrl ?? null,
          source_trust: Math.max(prevTrust, trust),
          contributor_hashes: hashes,
          confirm_count: confirm,
        }),
      },
    );
  } catch (err) {
    if (__DEV__) console.warn('[collective] place push', err);
  }
}

function guessPlaceType(blob: string): string {
  const t = blob.toLowerCase();
  if (/\b(restaurant|gastro|imbiss|pizzer|sushi|burger)\b/u.test(t)) {
    return 'restaurant';
  }
  if (/\b(café|cafe|kaffee|bäck|baeck|coffee)\b/u.test(t)) return 'cafe';
  if (/\b(hotel|pension|hostel|unterkunft)\b/u.test(t)) return 'hotel';
  if (/\b(museum|galerie|schloss|denkmal|kirche)\b/u.test(t)) return 'landmark';
  if (/\b(bar|club|kneipe|pub)\b/u.test(t)) return 'nightlife';
  if (/\b(kino|cinema|theater|konzert|venue)\b/u.test(t)) return 'venue';
  return 'place';
}

/**
 * Recherche-Ergebnis → Community-Overlay (für alle User nach Activate).
 * Ersetzt kein Agent-Stadt-Pack; ergänzt Runtime-Fakten-DB.
 */
export function contributePlacesFromResearchResult(input: {
  query: string;
  city?: string | null;
  facts?: Array<{
    label: string;
    value: string;
    place?: string | null;
    sourceUrl?: string | null;
    confidence?: 'high' | 'medium' | 'low';
  }>;
  sources?: Array<{ url: string; title?: string }>;
  venues?: Array<{
    name: string;
    lat?: number | null;
    lng?: number | null;
    factText?: string | null;
    sourceUrl?: string | null;
    sourceTrust?: number;
    placeType?: string;
  }>;
}): void {
  const city = input.city?.trim() || null;
  const seen = new Set<string>();
  const push = (opts: {
    name: string;
    placeType?: string;
    lat?: number | null;
    lng?: number | null;
    factText?: string | null;
    sourceUrl?: string | null;
    sourceTrust?: number;
  }) => {
    const name = opts.name.replace(/\s+/g, ' ').trim();
    if (name.length < 3) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    void contributeDiscoveredPlace({
      name,
      placeType:
        opts.placeType ||
        guessPlaceType(`${input.query} ${name} ${opts.factText || ''}`),
      cityHint: city,
      lat: opts.lat,
      lng: opts.lng,
      factText: opts.factText,
      sourceUrl: opts.sourceUrl,
      sourceTrust: opts.sourceTrust,
    });
  };

  for (const f of input.facts ?? []) {
    const place = (f.place || '').trim();
    if (place) {
      const trust =
        f.confidence === 'high' ? 0.6 : f.confidence === 'medium' ? 0.48 : 0.35;
      push({
        name: place,
        factText: `${f.label}: ${f.value}`.slice(0, 400),
        sourceUrl: f.sourceUrl,
        sourceTrust: trust,
      });
    }
    // Label „Ort: X“ / Value sieht aus wie Venue-Name
    if (
      /^(ort|venue|location|restaurant|café|cafe|hotel)$/iu.test(f.label.trim()) &&
      f.value.trim().length >= 3
    ) {
      push({
        name: f.value.trim().slice(0, 80),
        factText: f.label,
        sourceUrl: f.sourceUrl,
        sourceTrust: f.confidence === 'high' ? 0.58 : 0.45,
      });
    }
  }

  for (const s of input.sources ?? []) {
    const title = (s.title || '').trim();
    if (
      title.length >= 4 &&
      /\b(restaurant|café|cafe|museum|hotel|bar|kino|venue|bistro)\b/iu.test(
        `${title} ${input.query}`,
      )
    ) {
      push({
        name: title.slice(0, 80),
        sourceUrl: s.url,
        sourceTrust: 0.42,
      });
    }
  }

  for (const v of input.venues ?? []) {
    push({
      name: v.name,
      placeType: v.placeType,
      lat: v.lat,
      lng: v.lng,
      factText: v.factText,
      sourceUrl: v.sourceUrl,
      sourceTrust: v.sourceTrust ?? 0.5,
    });
  }
}

/** Runtime-Prompt: aktive Community-Orte als Overlay (nicht offizielles Pack). */
export function communityDiscoveredPlacesPromptBlock(opts?: {
  cityHint?: string | null;
  limit?: number;
  kinds?: string[] | null;
}): string {
  const city = (opts?.cityHint || '').toLowerCase().trim();
  const kinds = opts?.kinds?.map((k) => k.toLowerCase()) ?? null;
  let places = getCachedCommunityPlacesSync();
  if (city) {
    places = places.filter(
      (p) =>
        !p.cityHint ||
        p.cityHint.toLowerCase().includes(city) ||
        city.includes(p.cityHint.toLowerCase()),
    );
  }
  if (kinds?.length) {
    places = places.filter((p) =>
      kinds.some((k) => p.placeType.toLowerCase().includes(k) || k === 'place'),
    );
  }
  places = places.slice(0, opts?.limit ?? 8);
  if (!places.length) return '';
  const lines = [
    '=== COMMUNITY-FAKTEN-OVERLAY (Crowd-Recherche → alle User) ===',
    'Ergänzt das Stadt-Pack zur Laufzeit. Keine erfundenen Details; nur nutzen wenn thematisch passt.',
    'Offizielles Pack-Upload bleibt Agent-Qualitätspfad — dies ist die geteilte Fakten-Schicht.',
  ];
  for (const p of places) {
    lines.push(
      `- ${p.name} (${p.placeType})` +
        (p.factText ? `: ${p.factText.slice(0, 120)}` : '') +
        (p.sourceUrl ? ` · ${p.sourceUrl}` : ''),
    );
  }
  return lines.join('\n');
}

const cohortSessionKeys = new Set<string>();

/** Einmal pro Session/Family: Cohort-Stil signalisieren. */
export function maybeContributeCohortStyle(opts: {
  intentFamily: LearnedRuleIntentFamily | string;
  answerStyle?: string | null;
}): void {
  const profile = getCachedUserProfile();
  const style = opts.answerStyle || profile?.answerStyle || 'short';
  const sessionKey = `${opts.intentFamily}::${style}`;
  if (cohortSessionKeys.has(sessionKey)) return;
  cohortSessionKeys.add(sessionKey);
  // Struktur-Hint, kein festes Skript
  const styleHint =
    style === 'detailed'
      ? 'Länge eher ausführlich: klare Antwort vorne, Begründung, Tipps hinten; Buttons just-do-it'
      : 'Länge eher knapp: klare Antwort vorne, ein Hook, Tipps hinten; Buttons just-do-it';
  void contributeCohortStyleSignal({
    intentFamily: opts.intentFamily,
    styleHint,
  });
}

async function pushSignal(opts: {
  kind: CollectiveSignalKind;
  intentFamily: LearnedRuleIntentFamily | string;
  signalKey: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const cfg = supabaseConfig();
  if (!cfg) return;
  const hash = await getOrCreateContributorHash();
  try {
    await fetch(`${cfg.base}/rest/v1/community_learning_signals`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({
        signal_id: newId('cls'),
        contributor_hash: hash,
        signal_kind: opts.kind,
        intent_family: opts.intentFamily,
        signal_key: opts.signalKey,
        payload: opts.payload,
      }),
    });
  } catch (err) {
    if (__DEV__) console.warn('[collective] signal push', err);
  }
}

/** 3× gleiche Rückfrage-Kategorie → später proaktiv für alle. */
export async function contributeFollowUpSignal(opts: {
  intentFamily: LearnedRuleIntentFamily | string;
  slot:
    | 'times_hours'
    | 'prices'
    | 'menu'
    | 'booking_url'
    | 'tickets'
    | 'route_button'
    | 'website'
    | 'alternatives'
    | 'duration';
  /** Feineres Thema, z. B. popcorn — steckt im Signal-Key. */
  topic?: string | null;
  userText?: string;
}): Promise<void> {
  const topic = (opts.topic || '').trim().toLowerCase().slice(0, 40);
  const key = normalizeKey(
    topic
      ? ['followup', opts.intentFamily, opts.slot, topic]
      : ['followup', opts.intentFamily, opts.slot],
  );
  await pushSignal({
    kind: 'followup',
    intentFamily: opts.intentFamily,
    signalKey: key,
    payload: {
      slot: opts.slot,
      topic: topic || null,
      sample: (opts.userText || '').slice(0, 80),
    },
  });
}

/** 3× gleicher Fehler/Korrektur → Avoid für alle. */
export async function contributeErrorAvoidSignal(opts: {
  intentFamily: LearnedRuleIntentFamily | string;
  avoid: string[];
  expect?: string[];
  summary: string;
}): Promise<void> {
  const avoid = [...opts.avoid].map((a) => a.toLowerCase()).sort();
  if (!avoid.length && !opts.summary.trim()) return;
  const key = normalizeKey([
    'error_avoid',
    opts.intentFamily,
    avoid.join('+') || 'x',
    opts.summary.slice(0, 40),
  ]);
  await pushSignal({
    kind: 'error_avoid',
    intentFamily: opts.intentFamily,
    signalKey: key,
    payload: {
      avoid,
      expect: opts.expect ?? [],
      summary: opts.summary.slice(0, 160),
      autoUsers: AUTO_USERS,
    },
  });
}

/** User-Typ / Cohort will bei Familie X so antworten. */
export async function contributeCohortStyleSignal(opts: {
  intentFamily: LearnedRuleIntentFamily | string;
  styleHint: string;
}): Promise<void> {
  const profile = getCachedUserProfile();
  const cohort = [
    profile?.voiceId || 'default',
    profile?.answerStyle || '',
  ]
    .filter(Boolean)
    .join('|')
    .slice(0, 80);
  if (!cohort || opts.styleHint.length < 8) return;
  const key = normalizeKey(['cohort', opts.intentFamily, cohort, opts.styleHint.slice(0, 40)]);
  await pushSignal({
    kind: 'cohort_style',
    intentFamily: opts.intentFamily,
    signalKey: key,
    payload: {
      cohort,
      styleHint: opts.styleHint.slice(0, 200),
    },
  });
}

export async function pullCollectiveLearning(opts?: {
  cityHint?: string | null;
}): Promise<{ places: number; promoted: number }> {
  const cfg = supabaseConfig();
  if (!cfg) return { places: 0, promoted: 0 };
  let placesN = 0;
  let promotedN = 0;

  try {
    let url =
      `${cfg.base}/rest/v1/community_discovered_places?select=place_key,city_hint,name,place_type,lat,lng,fact_text,source_url,source_trust,status&status=eq.active&order=updated_at.desc&limit=200`;
    const city = opts?.cityHint?.trim();
    if (city) {
      url += `&or=(city_hint.ilike.*${encodeURIComponent(city)}*,city_hint.is.null)`;
    }
    const res = await fetch(url, {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
      },
    });
    if (res.ok) {
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const mapped: DiscoveredPlace[] = rows.map((r) => ({
        placeKey: String(r.place_key),
        cityHint: (r.city_hint as string) || null,
        name: String(r.name),
        placeType: String(r.place_type || 'place'),
        lat: typeof r.lat === 'number' ? r.lat : null,
        lng: typeof r.lng === 'number' ? r.lng : null,
        factText: (r.fact_text as string) || null,
        sourceUrl: (r.source_url as string) || null,
        sourceTrust: Number(r.source_trust) || 0.4,
        status: 'active',
      }));
      // Merge by key
      const map = new Map(cachedPlaces.map((p) => [p.placeKey, p]));
      for (const p of mapped) map.set(p.placeKey, p);
      cachedPlaces = [...map.values()].slice(0, 400);
      placesN = mapped.length;
      await writeJson(OVERLAY_PATH, { places: cachedPlaces });
    }
  } catch (err) {
    if (__DEV__) console.warn('[collective] places pull', err);
  }

  try {
    const res = await fetch(
      `${cfg.base}/rest/v1/community_learning_promoted?select=signal_key,signal_kind,intent_family,payload,unique_contributors&order=updated_at.desc&limit=120`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
        },
      },
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      cachedPromoted = rows.map((r) => ({
        signalKey: String(r.signal_key),
        signalKind: r.signal_kind as CollectiveSignalKind,
        intentFamily: String(r.intent_family || 'general'),
        payload:
          r.payload && typeof r.payload === 'object'
            ? (r.payload as Record<string, unknown>)
            : {},
        uniqueContributors: Number(r.unique_contributors) || 0,
      }));
      promotedN = cachedPromoted.length;
      await writeJson(PROMOTED_PATH, { items: cachedPromoted });
    }
  } catch (err) {
    if (__DEV__) console.warn('[collective] promoted pull', err);
  }

  await writeJson(META_PATH, { lastPullAtMs: Date.now() });
  return { places: placesN, promoted: promotedN };
}

/** Prompt-Block: proaktive Slots + Avoids + Cohort (Struktur, Wortlaut frei). */
export function collectiveLearningPromptBlock(opts?: {
  intentFamily?: string | null;
}): string {
  const fam = (opts?.intentFamily || '').toLowerCase();
  const items = cachedPromoted.filter((p) => {
    // Ohne Filter / general → alle Familien (Kino oft als general geroutet)
    if (!fam || fam === 'general') return true;
    return p.intentFamily === fam || p.intentFamily === 'general';
  });
  if (!items.length && !cachedPlaces.some((p) => p.status === 'active')) {
    return '';
  }

  const lines: string[] = [
    '=== COLLECTIVE LEARNING (Crowd → alle User, Struktur-Blaupause) ===',
    'Dies sind nur abstrakte Struktur-Hints. Nie exakten Wortlaut übernehmen.',
    'Keine Preise/Fakten erfinden — nur mitliefern wenn Recherche/Quellen sie belegen.',
  ];

  const followups = items.filter((i) => i.signalKind === 'followup').slice(0, 6);
  if (followups.length) {
    lines.push('PROAKTIV MITBEANTWORTEN (oft nachgefragt, ohne zu warten):');
    for (const f of followups) {
      const slot = String(f.payload.slot ?? '');
      const topic = String(f.payload.topic ?? '').trim();
      const sample = String(f.payload.sample ?? '').trim().slice(0, 60);
      lines.push(
        `- Intent ${f.intentFamily}: Slot „${slot}“` +
          (topic ? ` / Thema „${topic}“` : '') +
          ` mitliefern wenn belegt (${f.uniqueContributors}+ User)` +
          (sample ? ` — Beispiel-Nachfrage: „${sample}“` : '') +
          '.',
      );
    }
  }

  const avoids = items.filter((i) => i.signalKind === 'error_avoid').slice(0, 6);
  if (avoids.length) {
    lines.push('NICHT MEHR MACHEN (Crowd-Korrektur ≥3 User):');
    for (const a of avoids) {
      const avoid = Array.isArray(a.payload.avoid)
        ? (a.payload.avoid as string[]).join(', ')
        : '';
      const summary = String(a.payload.summary ?? '').slice(0, 100);
      lines.push(
        `- ${a.intentFamily}: avoid [${avoid}]${summary ? ` — ${summary}` : ''}`,
      );
    }
  }

  const profile = getCachedUserProfile();
  const myCohort = [profile?.voiceId || '', profile?.answerStyle || '']
    .filter(Boolean)
    .join('|');
  const cohorts = items
    .filter((i) => i.signalKind === 'cohort_style')
    .filter((i) => {
      const c = String(i.payload.cohort ?? '');
      return !myCohort || !c || c.includes(myCohort.split('|')[0]!) || c === myCohort;
    })
    .slice(0, 4);
  if (cohorts.length) {
    lines.push('ANTWORT-STIL für ähnliche User-Typen (Struktur, Wortlaut frei):');
    for (const c of cohorts) {
      lines.push(
        `- ${c.intentFamily} / ${String(c.payload.cohort ?? '').slice(0, 40)}: ${String(c.payload.styleHint ?? '').slice(0, 120)}`,
      );
    }
  }

  const places = getCachedCommunityPlacesSync().slice(0, 8);
  if (places.length) {
    lines.push('COMMUNITY-ORTE (Recherche anderer User, nur nutzen wenn thematisch passt):');
    for (const p of places) {
      lines.push(
        `- ${p.name}${p.placeType ? ` (${p.placeType})` : ''}${p.factText ? `: ${p.factText.slice(0, 100)}` : ''}`,
      );
    }
  }

  return lines.join('\n');
}

/** Heuristik: User-Text = typische Rückfrage-Slots. */
export function detectFollowUpSlots(userText: string): Array<
  | 'times_hours'
  | 'prices'
  | 'menu'
  | 'booking_url'
  | 'tickets'
  | 'route_button'
  | 'website'
  | 'alternatives'
  | 'duration'
> {
  const t = userText.toLowerCase();
  const out: Array<
    | 'times_hours'
    | 'prices'
    | 'menu'
    | 'booking_url'
    | 'tickets'
    | 'route_button'
    | 'website'
    | 'alternatives'
    | 'duration'
  > = [];
  if (/\b(öffnung|oeffnung|wie\s+lange\s+auf|noch\s+offen|uhrzeit|wann\s+hat)\b/u.test(t)) {
    out.push('times_hours');
  }
  if (/\b(preis|kostet|teuer|euro|€|popcorn|nachos|snack)\b/u.test(t)) {
    out.push('prices');
  }
  if (/\b(speisekarte|menü|menu|essen\s+die|gericht)\b/u.test(t)) out.push('menu');
  if (/\b(buch|reserv|ticket|eintritt)\b/u.test(t)) {
    out.push('booking_url');
    out.push('tickets');
  }
  if (/\b(route|weg|navig|führ\s+mich|bring\s+mich)\b/u.test(t)) out.push('route_button');
  if (/\b(website|homepage|link|seite)\b/u.test(t)) out.push('website');
  if (/\b(alternative|anders|stattdessen|oder\s+was)\b/u.test(t)) out.push('alternatives');
  if (/\b(dauer|wie\s+lang|minuten|stunden)\b/u.test(t)) out.push('duration');
  return out;
}

/** Feines Thema aus Rückfrage (für Signal-Key + Prompt). */
export function detectFollowUpTopic(userText: string): string | null {
  const t = userText.toLowerCase();
  if (/\bpopcorn\b/u.test(t)) return 'popcorn';
  if (/\bnachos\b/u.test(t)) return 'nachos';
  if (/\b(snack|snacks|getränk|getraenk|cola|softdrink)\b/u.test(t)) {
    return 'snacks';
  }
  if (/\b(parkgebühr|parken|parkhaus)\b/u.test(t)) return 'parking';
  if (/\b(eintritt|ticketpreis|kinoticket)\b/u.test(t)) return 'ticket_price';
  return null;
}

/** Ob Crowd bei Intent/Thema Preise (z. B. Popcorn) proaktiv will. */
export function hasPromotedFollowUpSlot(opts: {
  intentFamily?: string | null;
  slot: string;
  topic?: string | null;
}): boolean {
  const fam = (opts.intentFamily || '').toLowerCase();
  const topic = (opts.topic || '').toLowerCase();
  return cachedPromoted.some((p) => {
    if (p.signalKind !== 'followup') return false;
    const sameCinemaCluster = (a: string, b: string): boolean => {
      const cluster = (x: string) =>
        x === 'cinema' || x === 'theater' || x === 'events';
      if (cluster(a) && cluster(b)) return true;
      return a === b;
    };
    if (
      fam &&
      fam !== 'general' &&
      p.intentFamily !== fam &&
      p.intentFamily !== 'general' &&
      !sameCinemaCluster(fam, p.intentFamily)
    ) {
      return false;
    }
    if (String(p.payload.slot ?? '') !== opts.slot) return false;
    if (topic) {
      const pt = String(p.payload.topic ?? '').toLowerCase();
      const sample = String(p.payload.sample ?? '').toLowerCase();
      return pt === topic || sample.includes(topic);
    }
    return true;
  });
}

export function startCollectiveLearningMonitor(): () => void {
  if (started) return () => undefined;
  started = true;
  void hydrateCollectiveLearningCache().then(() => {
    const city = getCachedUserProfile()?.cityName ?? null;
    void pullCollectiveLearning({ cityHint: city });
  });

  // Selten reicht: Payload klein (~promoted + Orte), Traffic/Akku schonen.
  // Frischer Catch ohnehin bei App-Start und Foreground.
  timer = setInterval(() => {
    const city = getCachedUserProfile()?.cityName ?? null;
    void pullCollectiveLearning({ cityHint: city });
  }, 24 * 60 * 60_000);

  appSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') {
      const city = getCachedUserProfile()?.cityName ?? null;
      void pullCollectiveLearning({ cityHint: city });
    }
  });

  return () => {
    started = false;
    if (timer) clearInterval(timer);
    timer = null;
    appSub?.remove();
    appSub = null;
  };
}
