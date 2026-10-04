/**
 * Phase 4 — Mission Verify-Pass + whyChosen.
 *
 * Nach Pool/Hard-Match: Must-Facts der Mission gegen Kandidaten prüfen.
 * Soft-Fill fliegt raus; Top-2 bekommen belegte whyChosen für Call-2.
 */

import { buildMissionChecklist } from './buildMissionChecklist';
import type { MissionChecklist, MissionChecklistItem } from './missionContract';
import type { PitchCandidate, PitchRequest } from '../pitch/types';

export type WhyChosenFact = {
  id: string;
  label: string;
  /** Kurzer Beleg-String für Speech/Prompt — nie erfunden */
  evidence: string;
};

export type MissionVerifyPassResult = {
  survivors: PitchCandidate[];
  /** name → whyChosen */
  whyByName: Record<string, WhyChosenFact[]>;
  checklist: MissionChecklistItem[];
  softFail: boolean;
  reason: string | null;
};

function blobOf(c: PitchCandidate): string {
  return `${c.name} ${(c.softTags ?? []).join(' ')} ${(c.hardEvidence ?? []).join(' ')} ${(c.hookNotes ?? []).join(' ')} ${c.address ?? ''} ${c.source}`
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function distLabel(c: PitchCandidate): string | null {
  const m = c.distFromAnchorM;
  if (m == null || !Number.isFinite(m) || m <= 0) return null;
  if (m < 1000) return `${Math.round(m)} m entfernt`;
  return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1).replace('.', ',')} km entfernt`;
}

function ratingLabel(c: PitchCandidate): string | null {
  const r = c.rating;
  if (r == null || !Number.isFinite(r)) return null;
  if (r >= 4.5) return 'top bewertet';
  if (r >= 4.0) return 'gut bewertet';
  if (r >= 3.5) return 'okay bewertet';
  return null;
}

function priceLabel(c: PitchCandidate): string | null {
  if (c.dishPriceHint?.trim()) return c.dishPriceHint.trim().slice(0, 48);
  if (c.priceTotalEur != null && Number.isFinite(c.priceTotalEur)) {
    return `${Math.round(c.priceTotalEur)} € live`;
  }
  if (c.pricePerNightEur != null && Number.isFinite(c.pricePerNightEur)) {
    return `ab ${Math.round(c.pricePerNightEur)} €/Nacht`;
  }
  return null;
}

function extractBudgetMax(req: PitchRequest, mission: MissionChecklist): number | null {
  const fromFact = mission.factsToProve.find((f) => f.id === 'budget_max');
  if (fromFact?.value && /^\d+$/.test(fromFact.value)) return Number(fromFact.value);
  const blob = `${req.title} ${req.context} ${req.wishes.map((w) => w.text).join(' ')}`;
  const m = blob.match(
    /\b(?:unter|max(?:imal)?\.?|bis\s+zu|höchstens|hoechstens)\s*(\d{2,5})\s*(?:€|euro)?\b/iu,
  );
  return m?.[1] ? Number(m[1]) : null;
}

type HardCheck = {
  id: string;
  label: string;
  /** true = Kandidat muss passen oder fliegt bei forbidSoftFill */
  hard: boolean;
  test: (c: PitchCandidate, blob: string) => { ok: boolean; evidence?: string };
};

function buildHardChecks(
  req: PitchRequest,
  mission: MissionChecklist,
): HardCheck[] {
  const checks: HardCheck[] = [];
  const musts = [
    ...mission.must,
    ...req.wishes.filter((w) => w.hardness === 'must').map((w) => w.text),
  ];
  const avoids = [
    ...mission.avoid,
    ...(req.prefs.avoidCategories ?? []),
  ];

  if (req.kind === 'hotel' || mission.family === 'hotel') {
    checks.push({
      id: 'is_hotel',
      label: 'Hotel/Unterkunft',
      hard: true,
      test: (c, blob) => {
        const ok =
          c.source === 'stay22' ||
          /\b(hotel|hostel|pension|apartment|apart|resort|inn|suite|unterkunft)\b/i.test(
            blob,
          ) ||
          req.kind === 'hotel';
        return { ok, evidence: ok ? 'Unterkunft' : undefined };
      },
    });
  }

  const city =
    mission.anchor.name ||
    req.cityHint?.trim() ||
    null;
  if (city && city.length >= 2 && !/^hier$/i.test(city)) {
    checks.push({
      id: 'in_city',
      label: `In/bei ${city}`,
      hard: req.kind === 'hotel' || mission.family === 'hotel',
      test: (c, blob) => {
        const ok =
          blob.includes(city.toLowerCase()) ||
          (c.address || '').toLowerCase().includes(city.toLowerCase()) ||
          // Stay22/Places in city_best oft ohne Stadt im Namen — cityHint reicht als Anker
          (req.searchMode === 'city_best' && Boolean(req.cityHint));
        return {
          ok,
          evidence: ok ? city : undefined,
        };
      },
    });
  }

  const budget = extractBudgetMax(req, mission);
  if (budget != null) {
    checks.push({
      id: 'budget_max',
      label: `≤ ${budget} €`,
      hard: true,
      test: (c) => {
        const price =
          c.priceTotalEur ??
          (c.pricePerNightEur != null && c.nights
            ? c.pricePerNightEur * c.nights
            : c.pricePerNightEur);
        if (price == null || !Number.isFinite(price)) {
          // Kein Live-Preis → nicht hard-wipe (noch nicht belegt), aber auch kein why
          return { ok: true };
        }
        const ok = price <= budget * 1.05;
        return {
          ok,
          evidence: ok ? `${Math.round(price)} € ≤ ${budget} €` : undefined,
        };
      },
    });
  }

  if (
    musts.some((m) => /pool|schwimmbad/i.test(m)) ||
    mission.factsToProve.some((f) => f.id === 'amenity_pool')
  ) {
    checks.push({
      id: 'amenity_pool',
      label: 'Pool',
      hard: true,
      test: (_c, blob) => {
        const ok = /\b(pool|schwimmbad|swimming\s*pool|innenpool|outdoor\s*pool)\b/i.test(
          blob,
        );
        return { ok, evidence: ok ? 'Pool belegt' : undefined };
      },
    });
  }

  if (
    musts.some((m) => /tischtennis|table.?tennis|ping.?pong/i.test(m)) ||
    mission.factsToProve.some(
      (f) => f.id === 'amenity_table_tennis' || f.id === 'table_tennis',
    )
  ) {
    checks.push({
      id: 'table_tennis',
      label: 'Tischtennis',
      hard: true,
      test: (_c, blob) => {
        const ok = /tischtennis|table.?tennis|ping.?pong/i.test(blob);
        return { ok, evidence: ok ? 'Tischtennis belegt' : undefined };
      },
    });
  }

  if (
    musts.some((m) => /basketball/i.test(m)) ||
    mission.factsToProve.some((f) => f.id === 'court_basketball')
  ) {
    checks.push({
      id: 'court_basketball',
      label: 'Basketballplatz',
      hard: true,
      test: (_c, blob) => {
        const ok = /basketball|sport|pitch|court|platz/i.test(blob);
        return { ok, evidence: ok ? 'Basketball/Sportplatz' : undefined };
      },
    });
  }

  if (
    musts.some((m) => /trinkwasser|drinking/i.test(m)) ||
    mission.factsToProve.some((f) => f.id === 'drinking_water')
  ) {
    checks.push({
      id: 'drinking_water',
      label: 'Trinkwasser',
      hard: true,
      test: (_c, blob) => {
        const ok = /trinkwasser|drinking|brunnen|wasser/i.test(blob);
        return { ok, evidence: ok ? 'Trinkwasser' : undefined };
      },
    });
  }

  if (
    musts.some((m) => /all_you_can_eat|ayce|buffet|schlemmer/i.test(m)) ||
    mission.factsToProve.some((f) => f.id === 'ayce_evidence')
  ) {
    checks.push({
      id: 'ayce_evidence',
      label: 'All-you-can-eat',
      hard: true,
      test: (_c, blob) => {
        const hits = [
          /all\s*you\s*can\s*eat/,
          /\bayce\b/,
          /schlemmer/,
          /buffet/,
          /flatrate/,
          /rodiz/,
        ].filter((re) => re.test(blob)).length;
        return {
          ok: hits >= 1,
          evidence: hits >= 1 ? 'AYCE-Beleg' : undefined,
        };
      },
    });
  }

  if (avoids.some((a) => /asian|asiatisch/i.test(a))) {
    checks.push({
      id: 'avoid_asian',
      label: 'Kein asiatisch',
      hard: true,
      test: (_c, blob) => {
        const asian =
          /\b(asia|asiatisch|sushi|thai|chines|japan|vietnam|korea|ramen|pho|dim\s*sum)\b/i.test(
            blob,
          );
        return {
          ok: !asian,
          evidence: !asian ? 'nicht asiatisch' : undefined,
        };
      },
    });
  }

  // Dish musts (generic)
  for (const w of req.wishes) {
    if (w.hardness !== 'must' || w.kind !== 'dish') continue;
    const dish = w.text.trim();
    if (dish.length < 3) continue;
    const id = `dish_${dish.toLowerCase().replace(/\s+/g, '_').slice(0, 24)}`;
    checks.push({
      id,
      label: dish,
      hard: true,
      test: (_c, blob) => {
        const token = dish.toLowerCase().slice(0, 12);
        const ok = blob.includes(token) || new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(blob);
        return { ok, evidence: ok ? dish : undefined };
      },
    });
  }

  return checks;
}

function softWhy(c: PitchCandidate, req: PitchRequest): WhyChosenFact[] {
  const out: WhyChosenFact[] = [];
  const rating = ratingLabel(c);
  if (rating) {
    out.push({ id: 'rating', label: 'Bewertung', evidence: rating });
  }
  if (req.searchMode === 'here_now' || req.searchMode === 'on_route') {
    const d = distLabel(c);
    if (d) out.push({ id: 'distance', label: 'Nähe', evidence: d });
  }
  const price = priceLabel(c);
  if (price) out.push({ id: 'price', label: 'Preis', evidence: price });
  const review = (c.hookNotes ?? []).find((n) => String(n).trim().length >= 20);
  if (review) {
    out.push({
      id: 'review',
      label: 'Review',
      evidence: review.replace(/\s+/g, ' ').trim().slice(0, 100),
    });
  }
  if (c.openNow === true) {
    out.push({ id: 'open_now', label: 'Offen', evidence: 'jetzt offen' });
  }
  return out.slice(0, 4);
}

/**
 * Verify-Pass: hard Musts prüfen, whyChosen bauen, Soft-Fill wipen.
 */
export function verifyMissionPass(opts: {
  req: PitchRequest;
  candidates: PitchCandidate[];
  mission?: MissionChecklist | null;
  /** nach Hard-Match softFail Flag */
  priorSoftFail?: boolean;
}): MissionVerifyPassResult {
  const mission =
    opts.mission ??
    buildMissionChecklist({
      userText: `${opts.req.title} ${opts.req.context}`,
      mustHaves: opts.req.call1MustHaves ?? opts.req.wishes.map((w) => w.text),
      avoid: opts.req.prefs.avoidCategories ?? [],
      researchCity: opts.req.cityHint ?? null,
      order: {
        must: opts.req.call1MustHaves ?? [],
        avoid: opts.req.prefs.avoidCategories ?? [],
        search: {
          mode: opts.req.forbidSoftFill ? 'hard' : 'normal',
          stages: (opts.req.searchStages as Array<
            'pack' | 'neighbor' | 'metro' | 'web' | 'verify'
          >) ?? ['pack', 'web', 'verify'],
          maxRadiusKm: opts.req.maxRadiusKm ?? 40,
          forbidSoftFill: Boolean(opts.req.forbidSoftFill),
        },
        need: opts.req.orderNeed ?? { maps: true },
        ui: opts.req.orderUi ?? {},
        bulletBudget: opts.req.bulletBudget ?? {
          max: 3,
          maxLines: 2,
          maxChars: 72,
        },
      },
    });

  const checks = buildHardChecks(opts.req, mission);
  const hardChecks = checks.filter((c) => c.hard);
  const forbid = Boolean(opts.req.forbidSoftFill) || mission.forbidSoftFill;
  const whyByName: Record<string, WhyChosenFact[]> = {};
  const survivors: PitchCandidate[] = [];
  const factStatus = new Map<string, MissionChecklistItem>();

  for (const f of mission.factsToProve) {
    factStatus.set(f.id, { ...f });
  }

  for (const c of opts.candidates) {
    const blob = blobOf(c);
    const why: WhyChosenFact[] = [];
    let hardFail = false;

    for (const check of hardChecks) {
      const r = check.test(c, blob);
      if (!r.ok) {
        if (forbid) {
          hardFail = true;
          break;
        }
        // ohne forbidSoftFill: soft behalten, aber kein why für den Fail
        continue;
      }
      if (r.evidence) {
        why.push({
          id: check.id,
          label: check.label,
          evidence: r.evidence,
        });
        const prev = factStatus.get(check.id);
        if (prev) {
          factStatus.set(check.id, {
            ...prev,
            status: 'proven',
            value: r.evidence,
            source: 'infer',
          });
        }
      }
    }

    if (hardFail) continue;

    // Nice / soft why
    for (const w of softWhy(c, opts.req)) {
      if (!why.some((x) => x.id === w.id)) why.push(w);
    }

    survivors.push(c);
    whyByName[c.name] = why.slice(0, 5);
  }

  // Wenn forbidSoftFill und niemand alle hard Musts hat → empty
  let softFail = Boolean(opts.priorSoftFail);
  let reason: string | null = null;
  if (forbid && hardChecks.length && opts.candidates.length && !survivors.length) {
    softFail = true;
    reason =
      'Musts nicht belegt — kein Soft-Fill. Suche erweitern oder Filter lockern.';
    for (const check of hardChecks) {
      const prev = factStatus.get(check.id);
      if (prev && prev.status === 'pending') {
        factStatus.set(check.id, { ...prev, status: 'failed' });
      }
    }
  } else if (!survivors.length && opts.candidates.length) {
    softFail = true;
    reason = reason || 'Kein Kandidat nach Verify.';
  }

  return {
    survivors,
    whyByName,
    checklist: [...factStatus.values()],
    softFail,
    reason,
  };
}

/** whyChosen als Prompt-Zeile. */
export function formatWhyChosenForPrompt(
  why: WhyChosenFact[] | undefined,
): string {
  if (!why?.length) return '';
  return why.map((w) => `${w.label}: ${w.evidence}`).join(' · ');
}
