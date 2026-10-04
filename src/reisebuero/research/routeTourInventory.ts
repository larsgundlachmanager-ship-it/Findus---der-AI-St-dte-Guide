/**
 * Route-Tour Inventar: echte Etappen + Hütten/Camps entlang der Tour.
 *
 * 1) Grounded Korridor (Gemini + Search) — Städte/Trail-Abschnitte
 * 2) Places: Berghütten / Camping / Lodging an Etappen
 * 3) trailPathResearch am Start für belegte Wege (kein GPX-File-Parser)
 * 4) Seed-Fallback wenn Live dünn
 *
 * Nav bleibt punktweise (Einstieg/Hütte) — keine Fake-GPX-Linie.
 */

import type { ReiseLedger, StoryStop } from '../types';
import { SEED_PLACES, type SeedPlace, haversineKm } from './candidates';
import { parseProDiscoverJson, slugId, type ProDestCandidate } from './proEnrichParse';

export type TourStage = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'start' | 'stage' | 'hut' | 'end';
  why: string;
  kmFromPrev: number;
  source?: 'seed' | 'grounded' | 'hut_places' | 'trail';
  /** Belegter Trail-/Hütten-Name */
  evidenceName?: string | null;
  websiteUri?: string | null;
};

export type RouteTourPlan = {
  mode: 'hike' | 'bike' | 'camping';
  stages: TourStage[];
  lodgingSeeds: SeedPlace[];
  activities: string[];
  /** Live-Anreicherung gelaufen? */
  liveEnriched?: boolean;
  trailNotes?: string | null;
};

/** Bekannte Multi-Day-Korridore (Bootstrap). */
export const ROUTE_TOUR_CORRIDORS: readonly SeedPlace[] = [
  { id: 'oberstdorf', name: 'Oberstdorf', lat: 47.407, lng: 10.278, tags: ['hike', 'hut', 'alpen', 'train'], wiki: 'Oberstdorf' },
  { id: 'garmisch', name: 'Garmisch-Partenkirchen', lat: 47.4917, lng: 11.0955, tags: ['hike', 'hut', 'alpen', 'train'], wiki: 'Garmisch-Partenkirchen' },
  { id: 'mitternwald', name: 'Mittenwald', lat: 47.442, lng: 11.262, tags: ['hike', 'hut', 'alpen', 'train'], wiki: 'Mittenwald' },
  { id: 'berchtesgaden', name: 'Berchtesgaden', lat: 47.631, lng: 13.002, tags: ['hike', 'hut', 'alpen', 'train'], wiki: 'Berchtesgaden' },
  { id: 'mayrhofen', name: 'Mayrhofen', lat: 47.167, lng: 11.864, tags: ['hike', 'hut', 'alpen', 'fly'], wiki: 'Mayrhofen', iata: 'INN' },
  { id: 'chamonix', name: 'Chamonix', lat: 45.9237, lng: 6.8694, tags: ['hike', 'hut', 'alpen', 'fly'], wiki: 'Chamonix', iata: 'GVA' },
  { id: 'trier', name: 'Trier', lat: 49.7568, lng: 6.6413, tags: ['bike', 'wine', 'train'], wiki: 'Trier' },
  { id: 'cochem', name: 'Cochem', lat: 50.145, lng: 7.167, tags: ['bike', 'wine', 'train'], wiki: 'Cochem' },
  { id: 'koblenz', name: 'Koblenz', lat: 50.3569, lng: 7.589, tags: ['bike', 'train', 'rhein'], wiki: 'Koblenz' },
  { id: 'konstanz', name: 'Konstanz', lat: 47.66, lng: 9.175, tags: ['bike', 'train', 'see'], wiki: 'Konstanz' },
  { id: 'lindau', name: 'Lindau', lat: 47.546, lng: 9.684, tags: ['bike', 'train', 'see'], wiki: 'Lindau' },
];

export function tourMode(ledger: ReiseLedger): 'hike' | 'bike' | 'camping' {
  const m = ledger.mode?.value;
  if (m === 'bike') return 'bike';
  if (m === 'camping') return 'camping';
  return 'hike';
}

/** Seed-Orte die als Etappen/Hütten-Regionen taugen. */
export function routeTourRegionPool(ledger: ReiseLedger): SeedPlace[] {
  const mode = tourMode(ledger);
  const hint = `${ledger.destinationHint?.value || ''} ${ledger.corridor?.value || ''} ${ledger.highlightWant?.value || ''}`.toLowerCase();
  const tagged = [
    ...ROUTE_TOUR_CORRIDORS.filter((p) => {
      if (mode === 'bike') return p.tags.includes('bike');
      if (mode === 'camping') return p.tags.includes('hike') || p.tags.includes('hut') || p.tags.includes('see');
      return p.tags.includes('hike') || p.tags.includes('hut') || p.tags.includes('alpen');
    }),
    ...SEED_PLACES.filter((p) => {
      if (mode === 'bike') return p.tags.includes('bike') || p.tags.includes('hike') || p.tags.includes('train');
      if (mode === 'camping') {
        return (
          p.tags.includes('camping') ||
          p.tags.includes('hike') ||
          p.tags.includes('sand') ||
          p.tags.includes('sea')
        );
      }
      return (
        p.tags.includes('hike') ||
        p.tags.includes('spa') ||
        p.tags.includes('train') ||
        /alpen|allgäu|allgaeu|schwarzwald|harz|sächs|saechs/i.test(p.name)
      );
    }),
  ];
  if (hint.length >= 3) {
    const named = [...ROUTE_TOUR_CORRIDORS, ...SEED_PLACES].filter(
      (p) =>
        hint.includes(p.name.toLowerCase().slice(0, 5)) ||
        p.tags.some((t) => hint.includes(t)),
    );
    if (named.length) return named;
  }
  return tagged.length ? tagged : SEED_PLACES.filter((p) => p.tags.includes('train')).slice(0, 6);
}

function stagesFromPicks(opts: {
  origin: { lat: number; lng: number; city: string };
  picks: SeedPlace[];
  mode: 'hike' | 'bike' | 'camping';
  source: TourStage['source'];
}): TourStage[] {
  const stages: TourStage[] = [
    {
      id: 'start',
      name: opts.origin.city,
      lat: opts.origin.lat,
      lng: opts.origin.lng,
      kind: 'start',
      why: 'Start',
      kmFromPrev: 0,
      source: 'seed',
    },
  ];
  let prev = opts.origin;
  for (let i = 0; i < opts.picks.length; i += 1) {
    const p = opts.picks[i]!;
    const km = Math.round(haversineKm(prev, p));
    const isLast = i === opts.picks.length - 1;
    stages.push({
      id: `stage-${p.id}`,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      kind: isLast ? 'end' : opts.mode === 'camping' || opts.mode === 'hike' ? 'hut' : 'stage',
      why:
        opts.mode === 'bike'
          ? `Rad-Etappe ~${km} km`
          : opts.mode === 'camping'
            ? `Camp/Hütte · ~${km} km`
            : `Wander-Etappe ~${km} km`,
      kmFromPrev: km,
      source: opts.source,
    });
    prev = p;
  }
  return stages;
}

/**
 * Sync Seed-Plan (Fallback / Smokes).
 */
export function buildRouteTourPlan(opts: {
  ledger: ReiseLedger;
  origin: { lat: number; lng: number; city: string };
  nights?: number | null;
}): RouteTourPlan {
  const mode = tourMode(opts.ledger);
  const pool = routeTourRegionPool(opts.ledger);
  const nights = Math.max(2, opts.nights ?? opts.ledger.stayNights?.value ?? 3);
  const stageCount = Math.min(5, Math.max(3, nights + 1));

  const ranked = [...pool].sort(
    (a, b) => haversineKm(opts.origin, a) - haversineKm(opts.origin, b),
  );
  const picks: SeedPlace[] = [];
  const usedMetro = new Set<string>();
  for (const p of ranked) {
    const key = p.name.split(/\s+/)[0]!.toLowerCase();
    if (usedMetro.has(key)) continue;
    usedMetro.add(key);
    picks.push(p);
    if (picks.length >= stageCount - 1) break;
  }
  while (picks.length < Math.min(2, pool.length) && pool[picks.length]) {
    picks.push(pool[picks.length]!);
  }

  const stages = stagesFromPicks({
    origin: opts.origin,
    picks,
    mode,
    source: 'seed',
  });
  const lodgingSeeds = picks.slice(0, Math.max(2, nights));
  const activities = stages.filter((s) => s.kind !== 'start').map((s) => s.why);

  return { mode, stages, lodgingSeeds, activities, liveEnriched: false };
}

function proToSeed(d: ProDestCandidate): SeedPlace | null {
  if (d.lat == null || d.lng == null || !Number.isFinite(d.lat) || !Number.isFinite(d.lng)) {
    return null;
  }
  return {
    id: `rt-${d.id}`,
    name: d.name,
    lat: d.lat,
    lng: d.lng,
    tags: [...new Set(['route_tour', 'grounded', ...d.tags])],
    wiki: d.wiki || d.name,
    iata: d.iata ?? undefined,
  };
}

/** Multi-Day Etappen-Orte via Search-Grounding. */
export async function discoverRouteStagesGrounded(
  ledger: ReiseLedger,
  origin: { lat: number; lng: number; city: string },
): Promise<{ picks: SeedPlace[]; notes: string }> {
  try {
    const { hasGeminiApiKey, generateGeminiText } = await import(
      '../../services/geminiService'
    );
    if (!hasGeminiApiKey()) return { picks: [], notes: '' };
    const { FINDUS_FEW_SHOT_DISCLAIMER } = await import(
      '../../services/concierge/findusResponsePolicy'
    );
    const mode = tourMode(ledger);
    const nights = ledger.stayNights?.value ?? ledger.stayDays?.value ?? 3;
    const named = (ledger.destinationHint?.value || '').trim();
    const corridor = (ledger.corridor?.value || '').trim();
    const prompt = [
      FINDUS_FEW_SHOT_DISCLAIMER,
      'Du planst eine Mehrtage-Tour (Wander/Rad/Camping) für Yorros Reisebüro.',
      'Nutze Google Search. Nur belegte Orte/Hüttenregionen/Etappenorte. Nichts erfinden.',
      `Modus: ${mode}. Nächte ca. ${nights}. Startnähe: ${origin.city} (${origin.lat.toFixed(2)},${origin.lng.toFixed(2)}).`,
      named ? `Ziel/Region: ${named}` : 'Ziel offen — wähle einen starken belegten Korridor.',
      corridor ? `Korridor: ${corridor}` : '',
      'Liefere 3–6 Etappen-Orte in sinnvoller Reihenfolge (Übernachtungsorte / Hüttenregionen / Rad-Städte).',
      'tags: hike|bike|hut|alpen|camping wenn passend.',
      'JSON: {"destinations":[{"name":"","lat":0,"lng":0,"iata":null,"wiki":"","tags":["hike","hut"],"whyFit":"Etappe/Hütte belegt"}],"notes":"1 Satz Trail/Korridor"}',
    ]
      .filter(Boolean)
      .join('\n');

    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      costModule: 'research',
      tier: 'lite',
      enableGoogleSearch: true,
      maxTokens: 1400,
      temperature: 0.2,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
    });
    const dests = parseProDiscoverJson(raw || '');
    const picks: SeedPlace[] = [];
    for (const d of dests) {
      let s = proToSeed(d);
      if (!s) {
        try {
          const { geocodePlaceName } = await import(
            '../../services/navigation/googleMapsNav'
          );
          const geo = await geocodePlaceName(d.name, { cityHint: d.name });
          if (geo) {
            s = {
              id: `rt-${slugId(d.name)}`,
              name: d.name,
              lat: geo.lat,
              lng: geo.lng,
              tags: [...new Set(['route_tour', 'grounded', ...d.tags])],
              wiki: d.wiki || d.name,
              iata: d.iata ?? undefined,
            };
          }
        } catch {
          /* soft */
        }
      }
      if (s) picks.push(s);
    }
    const notes = (raw || '').match(/"notes"\s*:\s*"([^"]{0,200})"/)?.[1] || '';
    return { picks: picks.slice(0, 6), notes };
  } catch {
    return { picks: [], notes: '' };
  }
}

/** Live Hütten/Camps nahe einer Etappe (Places). */
export async function discoverHutsNearStage(opts: {
  lat: number;
  lng: number;
  mode: 'hike' | 'bike' | 'camping';
  stageName: string;
}): Promise<TourStage[]> {
  const out: TourStage[] = [];
  try {
    const { searchPlacesByText, searchPlacesNearbyForType } = await import(
      '../../services/navigation/googleMapsNav'
    );
    const queries =
      opts.mode === 'bike'
        ? [`pension ${opts.stageName}`, `hotel ${opts.stageName} radweg`]
        : opts.mode === 'camping'
          ? [`campingplatz ${opts.stageName}`, `campground near ${opts.stageName}`]
          : [
              `Berghütte ${opts.stageName}`,
              `alpine hut ${opts.stageName}`,
              `Hütte Übernachtung ${opts.stageName}`,
            ];
    const places: Array<{
      name: string;
      lat: number;
      lng: number;
      websiteUri?: string | null;
    }> = [];
    for (const q of queries.slice(0, 2)) {
      const hits = await searchPlacesByText({
        query: q,
        lat: opts.lat,
        lng: opts.lng,
        radiusM: 25_000,
      });
      for (const h of hits.slice(0, 4)) {
        if (h.lat == null || h.lng == null) continue;
        if (/bahnhof|parkplatz|restaurant|pizzeria/i.test(h.name || '')) continue;
        places.push({
          name: h.name,
          lat: h.lat,
          lng: h.lng,
          websiteUri: h.websiteUri ?? null,
        });
      }
    }
    if (opts.mode === 'camping') {
      try {
        const near = await searchPlacesNearbyForType({
          lat: opts.lat,
          lng: opts.lng,
          radiusM: 20_000,
          includedType: 'campground',
        });
        for (const h of near.slice(0, 3)) {
          places.push({
            name: h.name,
            lat: h.lat,
            lng: h.lng,
            websiteUri: h.websiteUri ?? null,
          });
        }
      } catch {
        /* soft */
      }
    }
    // Dedup + nearest
    const seen = new Set<string>();
    const ranked = places
      .filter((p) => {
        const k = p.name.toLowerCase().slice(0, 24);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((p) => ({
        ...p,
        km: haversineKm({ lat: opts.lat, lng: opts.lng }, p),
      }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 2);

    for (const p of ranked) {
      out.push({
        id: `hut-${slugId(p.name)}`,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        kind: 'hut',
        why: `${Math.round(p.km)} km bei ${opts.stageName}`,
        kmFromPrev: Math.round(p.km),
        source: 'hut_places',
        evidenceName: p.name,
        websiteUri: p.websiteUri ?? null,
      });
    }
  } catch {
    /* soft */
  }
  return out;
}

/**
 * Live-Plan: Grounded Etappen + Hütten-Places + Trail-Hints am Start.
 */
export async function buildRouteTourPlanLive(opts: {
  ledger: ReiseLedger;
  origin: { lat: number; lng: number; city: string };
  nights?: number | null;
  timedOut?: () => boolean;
}): Promise<RouteTourPlan> {
  const base = buildRouteTourPlan(opts);
  if (opts.timedOut?.()) return base;

  let picks: SeedPlace[] = [];
  let notes = '';
  try {
    const disc = await discoverRouteStagesGrounded(opts.ledger, opts.origin);
    picks = disc.picks;
    notes = disc.notes;
  } catch {
    picks = [];
  }

  const mode = base.mode;
  const nights = Math.max(2, opts.nights ?? opts.ledger.stayNights?.value ?? 3);
  if (picks.length < 2) {
    picks = routeTourRegionPool(opts.ledger).slice(0, nights + 1);
  } else {
    picks = picks.slice(0, Math.min(6, nights + 2));
  }

  let stages = stagesFromPicks({
    origin: opts.origin,
    picks,
    mode,
    source: picks.some((p) => p.tags.includes('grounded')) ? 'grounded' : 'seed',
  });

  // Hütten/Camps an Zwischen-Etappen (nicht Start)
  if (!opts.timedOut?.()) {
    const mid = stages.filter((s) => s.kind === 'stage' || s.kind === 'hut' || s.kind === 'end').slice(0, 3);
    const hutBatches = await Promise.all(
      mid.map((s) =>
        discoverHutsNearStage({
          lat: s.lat,
          lng: s.lng,
          mode,
          stageName: s.name,
        }),
      ),
    );
    const hutStages = hutBatches.flat().slice(0, 4);
    if (hutStages.length) {
      // Insert huts after matching stage by proximity
      const enriched: TourStage[] = [];
      for (const s of stages) {
        enriched.push(s);
        if (s.kind === 'start') continue;
        const nearHut = hutStages
          .filter((h) => haversineKm(s, h) < 35)
          .sort((a, b) => haversineKm(s, a) - haversineKm(s, b))[0];
        if (nearHut && !enriched.some((e) => e.id === nearHut.id)) {
          enriched.push({
            ...nearHut,
            kmFromPrev: Math.round(haversineKm(s, nearHut)),
            why: `Hütte/Camp bei ${s.name} · ${nearHut.why}`,
          });
        }
      }
      stages = enriched;
    }
  }

  // Trail-Research am Start (belegte Wege — Punkte, kein GPX)
  let trailNotes: string | null = notes || null;
  if (!opts.timedOut?.() && (mode === 'hike' || mode === 'bike')) {
    try {
      const { researchTrailPaths } = await import(
        '../../services/research/trailPathResearch'
      );
      const userText =
        mode === 'bike'
          ? `Fahrradweg Mehrtagestour ${opts.ledger.destinationHint?.value || ''}`.trim()
          : `Wanderweg Hütte Mehrtagestour ${opts.ledger.destinationHint?.value || ''}`.trim();
      const trails = await researchTrailPaths({
        userText,
        lat: opts.origin.lat,
        lng: opts.origin.lng,
        cityHint: opts.origin.city,
      });
      if (trails.trails?.length) {
        trailNotes = [trailNotes, trails.promptBlock?.slice(0, 160)].filter(Boolean).join(' · ');
        const t0 = trails.trails[0]!;
        // Trail-Einstieg als frühe Stage wenn sinnvoll nah
        if (t0.lat && t0.lng && haversineKm(opts.origin, t0) < 80) {
          stages.splice(1, 0, {
            id: `trail-${slugId(t0.name)}`,
            name: t0.name,
            lat: t0.lat,
            lng: t0.lng,
            kind: 'stage',
            why: `Trail-Einstieg · ${Math.round(haversineKm(opts.origin, t0))} km`,
            kmFromPrev: Math.round(haversineKm(opts.origin, t0)),
            source: 'trail',
            evidenceName: t0.name,
            websiteUri: t0.websiteUri,
          });
        }
      }
    } catch {
      /* soft — day-trail API optional */
    }
  }

  const lodgingSeeds: SeedPlace[] = stages
    .filter((s) => s.kind === 'hut' || s.kind === 'stage' || s.kind === 'end')
    .slice(0, Math.max(2, nights))
    .map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      tags: [
        'route_tour',
        mode,
        ...(s.source === 'hut_places' ? ['hut'] : []),
        ...(s.source === 'grounded' ? ['grounded'] : []),
        ...(s.source === 'trail' ? ['trail'] : []),
      ],
      wiki: s.name,
    }));

  // Recompute km chain
  for (let i = 1; i < stages.length; i += 1) {
    stages[i] = {
      ...stages[i]!,
      kmFromPrev: Math.round(
        haversineKm(
          { lat: stages[i - 1]!.lat, lng: stages[i - 1]!.lng },
          stages[i]!,
        ),
      ),
    };
  }

  const activities = stages
    .filter((s) => s.kind !== 'start')
    .map((s) => (s.evidenceName ? `${s.name} (${s.evidenceName})` : s.why));

  return {
    mode,
    stages,
    lodgingSeeds: lodgingSeeds.length ? lodgingSeeds : base.lodgingSeeds,
    activities,
    liveEnriched: true,
    trailNotes,
  };
}

export function routeTourStops(plan: RouteTourPlan): StoryStop[] {
  return plan.stages.map((s) => ({
    id: s.id,
    title: s.name,
    why: s.why,
    lat: s.lat,
    lng: s.lng,
    kind: s.kind === 'start' ? 'origin' : s.kind === 'end' ? 'poi' : 'stay',
  }));
}

/** Prefers lodging seeds that sit on the tour corridor. */
export function biasPoolForRouteTour(
  pool: SeedPlace[],
  plan: RouteTourPlan,
): SeedPlace[] {
  const ids = new Set(plan.lodgingSeeds.map((s) => s.id));
  const names = new Set(plan.lodgingSeeds.map((s) => s.name.toLowerCase()));
  const hot = pool.filter((p) => ids.has(p.id) || names.has(p.name.toLowerCase()));
  const rest = pool.filter((p) => !hot.some((h) => h.id === p.id));
  const extras = plan.lodgingSeeds.filter((s) => !pool.some((p) => p.id === s.id));
  return [...extras, ...hot, ...rest];
}
