/**
 * Kreuzfahrt-Schiff-Fit: Wünsche (Pool, Rutsche, Kids/Teens/Party/Rentner …)
 * → 1–2 passende Schiffe aus Soft-Fleet-Profil.
 * Keine Fake-Preise/Segeltermine — nur Struktur-Match + ehrliche Gaps.
 */

import type { MustHaveId, ReiseLedger } from '../types';

export type CruiseLineId = 'aida' | 'mein_schiff' | 'other';

export type CruiseShipProfile = {
  id: string;
  name: string;
  line: CruiseLineId;
  /** Soft fleet-profile tags (öffentlich vermarktet / typisch). */
  amenities: MustHaveId[];
  audiences: Array<'kids' | 'teens' | 'party' | 'seniors' | 'couples' | 'spa'>;
  note: string;
};

export type CruiseShipFit = {
  ship: CruiseShipProfile;
  score: number;
  matched: MustHaveId[];
  missed: MustHaveId[];
  why: string;
};

export type CruiseShipFitResult = {
  wants: MustHaveId[];
  audiences: Array<'kids' | 'teens' | 'party' | 'seniors' | 'couples' | 'spa'>;
  fits: CruiseShipFit[];
  gaps: string[];
};

/** Soft DE-Fleet-Profile — Amenity-Tags typisch laut Reederei-Marketing, keine Preise. */
export const CRUISE_SHIP_SOFT_FLEET: CruiseShipProfile[] = [
  {
    id: 'aida_nova',
    name: 'AIDAnova',
    line: 'aida',
    amenities: [
      'pool',
      'water_slide',
      'kids_club',
      'teens_club',
      'party',
      'spa',
      'sauna',
      'running_track',
      'culinary',
    ],
    audiences: ['kids', 'teens', 'party', 'couples'],
    note: 'Modern, Beach Club / Rutschen, Familie + Party',
  },
  {
    id: 'aida_cosmo',
    name: 'AIDAcosma',
    line: 'aida',
    amenities: [
      'pool',
      'water_slide',
      'kids_club',
      'teens_club',
      'party',
      'spa',
      'sauna',
      'running_track',
      'culinary',
    ],
    audiences: ['kids', 'teens', 'party'],
    note: 'Schwester zu nova — Action an Deck, Shows',
  },
  {
    id: 'aida_perla',
    name: 'AIDAperla',
    line: 'aida',
    amenities: ['pool', 'water_slide', 'kids_club', 'party', 'spa', 'sauna', 'running_track'],
    audiences: ['kids', 'party', 'couples'],
    note: 'Pool-/Family-Schwerpunkt',
  },
  {
    id: 'aida_bella',
    name: 'AIDAbella',
    line: 'aida',
    amenities: ['pool', 'kids_club', 'party', 'spa', 'sauna', 'running_track'],
    audiences: ['kids', 'party', 'couples'],
    note: 'Klassisches AIDA-Profil mit Pool und Shows',
  },
  {
    id: 'aida_sol',
    name: 'AIDAsol',
    line: 'aida',
    amenities: ['pool', 'kids_club', 'party', 'spa', 'sauna', 'running_track'],
    audiences: ['party', 'couples', 'kids'],
    note: 'Party-/Show-lastig, Pool an Bord',
  },
  {
    id: 'mein_schiff_3',
    name: 'Mein Schiff 3',
    line: 'mein_schiff',
    amenities: ['pool', 'spa', 'sauna', 'running_track', 'culinary', 'quiet', 'kids_club', 'seniors'],
    audiences: ['seniors', 'couples', 'spa', 'kids'],
    note: 'Etablierte Mein-Schiff-Generation — Spa, ruhiger als AIDA-Party',
  },
  {
    id: 'mein_schiff_4',
    name: 'Mein Schiff 4',
    line: 'mein_schiff',
    amenities: ['pool', 'spa', 'sauna', 'running_track', 'culinary', 'quiet', 'kids_club', 'seniors'],
    audiences: ['seniors', 'couples', 'spa'],
    note: 'Schwester zu 3 — Wellness/Kulinarik, anderes Routing als 7',
  },
  {
    id: 'mein_schiff_5',
    name: 'Mein Schiff 5',
    line: 'mein_schiff',
    amenities: [
      'pool',
      'water_slide',
      'kids_club',
      'spa',
      'sauna',
      'running_track',
      'culinary',
      'quiet',
    ],
    audiences: ['kids', 'couples', 'spa', 'seniors'],
    note: 'Mehr Family-Anlagen als ältere Nummern — anderes Angebot als 3',
  },
  {
    id: 'mein_schiff_7',
    name: 'Mein Schiff 7',
    line: 'mein_schiff',
    amenities: [
      'pool',
      'water_slide',
      'kids_club',
      'teens_club',
      'spa',
      'sauna',
      'running_track',
      'culinary',
      'quiet',
    ],
    audiences: ['kids', 'teens', 'couples', 'spa', 'seniors'],
    note: 'Neueres Mein Schiff — Spa + Family-Decks; anderes Angebot als 3',
  },
  {
    id: 'mein_schiff_relax',
    name: 'Mein Schiff Relax',
    line: 'mein_schiff',
    amenities: ['pool', 'spa', 'sauna', 'running_track', 'culinary', 'quiet', 'seniors'],
    audiences: ['seniors', 'couples', 'spa'],
    note: 'Ruhe, Spa, Premium-Tempo — wenig Party',
  },
  {
    id: 'mein_schiff_1',
    name: 'Mein Schiff 1',
    line: 'mein_schiff',
    amenities: ['pool', 'spa', 'sauna', 'running_track', 'culinary', 'quiet', 'kids_club', 'seniors'],
    audiences: ['seniors', 'couples', 'spa', 'kids'],
    note: 'Klassisches Mein-Schiff-Profil: Spa, Kulinarik, ruhiger',
  },
  {
    id: 'mein_schiff_2',
    name: 'Mein Schiff 2',
    line: 'mein_schiff',
    amenities: ['pool', 'spa', 'sauna', 'running_track', 'culinary', 'quiet', 'kids_club', 'seniors'],
    audiences: ['seniors', 'couples', 'spa'],
    note: 'Entspannt, Wellness, wenig Club-Nacht',
  },
  {
    id: 'mein_schiff_6',
    name: 'Mein Schiff 6',
    line: 'mein_schiff',
    amenities: [
      'pool',
      'water_slide',
      'kids_club',
      'spa',
      'sauna',
      'running_track',
      'culinary',
      'quiet',
    ],
    audiences: ['kids', 'couples', 'spa', 'seniors'],
    note: 'Spa + Family-Anlagen, ruhiger als AIDA-Party',
  },
];

const CRUISE_AMENITY_IDS: MustHaveId[] = [
  'party',
  'pool',
  'spa',
  'sauna',
  'kids_club',
  'teens_club',
  'water_slide',
  'paddle_board',
  'culinary',
  'running_track',
  'seniors',
  'quiet',
  'adult_only',
  'warm',
];

const AMENITY_LABEL: Partial<Record<MustHaveId, string>> = {
  party: 'Party',
  pool: 'Pool',
  spa: 'Spa',
  sauna: 'Sauna',
  kids_club: 'Kids-Club',
  teens_club: 'Teens',
  water_slide: 'Wasserrutsche',
  paddle_board: 'Paddel an Bord',
  culinary: 'Kulinarik',
  running_track: 'Laufbahn',
  seniors: 'Ruhe-/Senioren-Tempo',
  quiet: 'ruhig',
  adult_only: 'ohne Kids-Fokus',
  warm: 'warm',
};

export function looksLikeCruiseShipFitAsk(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const cruise =
    /\b(?:kreuzfahrt|mein(?:en|em|e)?\s+schiff|aida|adidia|aidia|aiida|welches\s+schiff|passendes\s+schiff)\b/iu.test(
      t,
    );
  if (!cruise) return false;
  return /\b(?:pool|rutsche|wasserrutsche|sauna|spa|laufbahn|joggen|party|feiern|kids|kinder|teens?|jugend|rentner|senior|familie|entspann|wellness|welches\s+schiff|schiff\s+mit)\b/iu.test(
    t,
  );
}

export function detectCruiseAudiences(
  text: string,
): Array<'kids' | 'teens' | 'party' | 'seniors' | 'couples' | 'spa'> {
  const t = String(text || '');
  const out: Array<'kids' | 'teens' | 'party' | 'seniors' | 'couples' | 'spa'> = [];
  if (/\b(?:für\s+kinder|mit\s+kindern|kids|familie|kinderclub)\b/iu.test(t)) out.push('kids');
  if (/\b(?:teens?|jugendliche|für\s+teens)\b/iu.test(t)) out.push('teens');
  if (/\b(?:party|feiern|nightlife|club)\b/iu.test(t)) out.push('party');
  if (/\b(?:rentner|senior|ruhestand|best[\s-]?ager|für\s+(?:ältere|aeltere))\b/iu.test(t)) {
    out.push('seniors');
  }
  if (/\b(?:paar|zu\s+zweit|honeymoon|romantisch)\b/iu.test(t)) out.push('couples');
  if (/\b(?:spa|wellness|sauna|entspann)\b/iu.test(t)) out.push('spa');
  return [...new Set(out)];
}

export function cruiseWantsFromLedger(ledger: ReiseLedger): MustHaveId[] {
  const raw = [
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
    ...(ledger.niceHaves?.value ?? []),
  ];
  const set = new Set<MustHaveId>();
  for (const id of raw) {
    if (CRUISE_AMENITY_IDS.includes(id)) set.add(id);
  }
  // Audience soft-boosts from purpose / children
  const purpose = String(ledger.purpose?.value || '').toLowerCase();
  if (/ruhestand|senior|rentner|relax/.test(purpose)) {
    set.add('seniors');
    set.add('quiet');
  }
  if (/party|männer|maenner|jungs/.test(purpose)) set.add('party');
  if ((ledger.children?.value ?? 0) > 0) set.add('kids_club');
  return [...set];
}

export function matchCruiseShips(opts: {
  wants: MustHaveId[];
  audiences?: Array<'kids' | 'teens' | 'party' | 'seniors' | 'couples' | 'spa'>;
  lineBias?: CruiseLineId | null;
  limit?: number;
}): CruiseShipFitResult {
  const wants = [...new Set(opts.wants.filter((w) => CRUISE_AMENITY_IDS.includes(w)))];
  const audiences = opts.audiences ?? [];
  const gaps: string[] = [];
  if (!wants.length && !audiences.length) {
    return {
      wants,
      audiences,
      fits: [],
      gaps: ['Noch kein klarer Schiff-Wunsch (Pool, Kids, Party, Ruhe …)'],
    };
  }

  const scored: CruiseShipFit[] = [];
  for (const ship of CRUISE_SHIP_SOFT_FLEET) {
    if (opts.lineBias && opts.lineBias !== 'other' && ship.line !== opts.lineBias) continue;
    const matched = wants.filter((w) => ship.amenities.includes(w));
    const missed = wants.filter((w) => !ship.amenities.includes(w));
    let score = matched.length * 3 - missed.length;
    for (const a of audiences) {
      if (ship.audiences.includes(a)) score += 2;
      else if (a === 'party' && ship.audiences.includes('seniors')) score -= 1;
      else if (a === 'seniors' && ship.audiences.includes('party') && !ship.audiences.includes('seniors')) {
        score -= 1;
      }
    }
    // Party vs quiet conflict
    if (wants.includes('party') && ship.amenities.includes('quiet') && !ship.amenities.includes('party')) {
      score -= 2;
    }
    if (wants.includes('seniors') && ship.amenities.includes('party') && !ship.amenities.includes('seniors')) {
      score -= 1;
    }
    if (score <= 0 && matched.length === 0 && !audiences.some((a) => ship.audiences.includes(a))) {
      continue;
    }
    const whyBits = [
      ...matched.map((m) => AMENITY_LABEL[m] || m),
      ...audiences.filter((a) => ship.audiences.includes(a)),
    ].slice(0, 4);
    scored.push({
      ship,
      score,
      matched,
      missed,
      why: whyBits.length ? whyBits.join(', ') : ship.note,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.ship.name.localeCompare(b.ship.name));
  const fits = scored.filter((f) => f.score > 0).slice(0, opts.limit ?? 2);
  if (!fits.length) {
    gaps.push('Kein Soft-Fleet-Treffer — Reederei-Suche mit deinen Wünschen öffnen');
  } else if (wants.length && fits[0]!.missed.length) {
    gaps.push(
      `Noch offen: ${fits[0]!.missed
        .slice(0, 2)
        .map((m) => AMENITY_LABEL[m] || m)
        .join(', ')}`,
    );
  }

  return { wants, audiences, fits, gaps: gaps.slice(0, 2) };
}

export function lineBiasFromText(text: string): CruiseLineId | null {
  if (/\bmein(?:en|em|e)?\s+schiff\b/iu.test(text)) return 'mein_schiff';
  if (/\b(?:aida|adidia|aidia|aiida)\b/iu.test(text)) return 'aida';
  return null;
}

/**
 * Konkretes Schiff aus Text: „Mein Schiff 7“, „Mein Schiff Relax“, „AIDAnova“.
 * Nummern unterscheiden Angebote (3 ≠ 7).
 */
export function extractCruiseShipName(text: string): string | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const mein = t.match(/\bmein(?:en|em|e)?\s+schiff\s+(relax|[1-7])\b/iu);
  if (mein?.[1]) {
    const n = mein[1].toLowerCase() === 'relax' ? 'Relax' : mein[1];
    return `Mein Schiff ${n}`;
  }
  const aidaWord = t.match(
    /\b(aida(?:nova|cosma|perla|bella|stella|sol|luna|mar|aura|diva|blu))\b/iu,
  );
  if (aidaWord?.[1]) {
    const raw = aidaWord[1].replace(/^aida/i, 'AIDA');
    return raw.replace(/^AIDA([a-z])/i, (_m, c: string) => `AIDA${c.toLowerCase()}`);
  }
  const aidaSpace = t.match(
    /\baida\s+(nova|cosmo|cosma|perla|bella|stella|sol|luna|mar|aura|diva|blu)\b/iu,
  );
  if (aidaSpace?.[1]) {
    const part = aidaSpace[1].toLowerCase() === 'cosmo' ? 'cosma' : aidaSpace[1].toLowerCase();
    return `AIDA${part}`;
  }
  return null;
}

export function normalizeCruiseShipKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Soft-Fleet-Eintrag zum genannten Schiff — sonst null. */
export function findCruiseShipProfile(name: string | null | undefined): CruiseShipProfile | null {
  if (!name) return null;
  const key = normalizeCruiseShipKey(name);
  return (
    CRUISE_SHIP_SOFT_FLEET.find((s) => normalizeCruiseShipKey(s.name) === key) ||
    CRUISE_SHIP_SOFT_FLEET.find((s) => key.includes(normalizeCruiseShipKey(s.name))) ||
    null
  );
}

export function weaveCruiseShipFitSpeech(result: CruiseShipFitResult): string {
  if (!result.fits.length) {
    return 'Für deine Wünsche hab ich noch kein klares Schiff-Match — sag Pool, Rutsche, Kids, Teens, Party oder ruhiger Rentner-Vibe, dann eng ich die Flotte ein.';
  }
  const top = result.fits[0]!;
  const second = result.fits[1];
  const wishBit = result.wants
    .slice(0, 3)
    .map((w) => AMENITY_LABEL[w] || w)
    .join(', ');
  const head = wishBit
    ? `Zu ${wishBit} passen am besten ${top.ship.name}`
    : `Am besten passt ${top.ship.name}`;
  const alt = second ? ` — und als Alternative ${second.ship.name}` : '';
  const gap = result.gaps[0] ? ` ${result.gaps[0]}.` : '';
  return `${head}${alt} (${top.ship.note}). Segeltermine und Preise nur belegt über die Suche.${gap}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 480);
}

/** Kurzer Pitch nur mit Schiffsnamen — für Reisebüro-Ask nach Wünschen. */
export function weaveCruiseShipFitRecommendAsk(result: CruiseShipFitResult): string | null {
  if (!result.fits.length) return null;
  const names = result.fits
    .slice(0, 2)
    .map((f) => f.ship.name)
    .join(' oder ');
  const why = result.fits[0]?.why || result.fits[0]?.ship.note || '';
  return `Am besten würden ${names} zu deinen Wünschen passen${why ? ` (${why})` : ''}. Welches davon, oder hast du ein anderes Schiff im Kopf?`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

export function cruiseShipFitBullets(result: CruiseShipFitResult): string[] {
  const out: string[] = [];
  for (const f of result.fits.slice(0, 2)) {
    out.push(`${f.ship.name}: ${f.why}`.slice(0, 52));
  }
  if (result.gaps[0] && out.length < 3) out.push(result.gaps[0].slice(0, 48));
  return out.slice(0, 3);
}

export function matchCruiseShipsFromLedger(
  ledger: ReiseLedger,
  opts?: { userText?: string | null },
): CruiseShipFitResult {
  const text = String(opts?.userText || '');
  const named =
    ledger.cruiseShipName?.value ||
    extractCruiseShipName(text) ||
    null;
  const wants = cruiseWantsFromLedger(ledger);
  const audiences = detectCruiseAudiences(text);
  // Audience → soft amenity if not already
  if (audiences.includes('kids') && !wants.includes('kids_club')) wants.push('kids_club');
  if (audiences.includes('teens') && !wants.includes('teens_club')) wants.push('teens_club');
  if (audiences.includes('party') && !wants.includes('party')) wants.push('party');
  if (audiences.includes('seniors')) {
    if (!wants.includes('seniors')) wants.push('seniors');
    if (!wants.includes('quiet')) wants.push('quiet');
  }
  if (audiences.includes('spa')) {
    if (!wants.includes('spa')) wants.push('spa');
  }

  const linePref = ledger.cruiseLinePref?.value;
  const lineBias: CruiseLineId | null =
    linePref === 'aida' || linePref === 'mein_schiff'
      ? linePref
      : lineBiasFromText(text);

  // Konkretes Schiff genannt → dieses Angebot hart vorne (3 ≠ 7)
  const profile = findCruiseShipProfile(named);
  if (profile) {
    const matched = wants.filter((w) => profile.amenities.includes(w));
    const missed = wants.filter((w) => !profile.amenities.includes(w));
    return {
      wants,
      audiences,
      fits: [
        {
          ship: profile,
          score: 100,
          matched,
          missed,
          why: matched.length
            ? matched.map((m) => AMENITY_LABEL[m] || m).join(', ')
            : profile.note,
        },
      ],
      gaps: missed.length
        ? [
            `Genannt: ${profile.name} — noch offen: ${missed
              .slice(0, 2)
              .map((m) => AMENITY_LABEL[m] || m)
              .join(', ')}`,
          ]
        : [],
    };
  }

  return matchCruiseShips({
    wants,
    audiences,
    lineBias,
    limit: 2,
  });
}
