/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/mission/missionChecklist.smoke.test.ts
 */
import {
  buildMissionChecklist,
  criticalUnresolvedFacts,
  normalizeMissionAmbiguity,
} from './buildMissionChecklist';
import {
  formatMissionChecklistForPrompt,
  hasCriticalBlocker,
  shouldEmitAskBack,
} from './missionContract';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// --- Ambiguity: Nusschale Venedig → Gondel, kein Ask-Back ---
{
  const { text, rewrites } = normalizeMissionAmbiguity(
    'In Venedig mit der Nusschale fahren — wie teuer ist das?',
  );
  assert(/gondel/i.test(text), `gondel rewrite, got: ${text}`);
  assert(
    rewrites.some((r) => /gondel/i.test(r)),
    'rewrite note',
  );
  const m = buildMissionChecklist({
    userText: 'In Venedig mit der Nusschale fahren — wie teuer ist das?',
  });
  assert(!m.askBack, `no askBack for nusschale, got: ${m.askBack}`);
  assert(
    m.must.some((x) => /gondel/i.test(x)) ||
      m.factsToProve.some((f) => /gondel/i.test(f.id + f.label + (f.value || ''))),
    `gondel in mission, must=${m.must.join(',')} facts=${m.factsToProve.map((f) => f.id).join(',')}`,
  );
  assert(
    m.anchor.kind === 'named_city' || m.anchor.name,
    'venedig anchor',
  );
}

// --- Papst: aktuell inferieren, kein „welchen Papst?“ ---
{
  const m = buildMissionChecklist({
    userText: 'Wie alt ist der Papst?',
  });
  assert(m.family === 'fact', `family fact, got ${m.family}`);
  assert(!m.askBack, 'no askBack papst');
  assert(
    m.rewrites.some((r) => /aktueller Papst/i.test(r)) ||
      m.factsToProve.some((f) => f.id === 'pope_current'),
    'aktueller Papst inferred',
  );
  assert(!shouldEmitAskBack(m), 'shouldEmitAskBack false');
}

// --- NL Hauptstadt + Boot → Amsterdam, kein Stadt-Ask ---
{
  const m = buildMissionChecklist({
    userText:
      'Ich möchte in die Hauptstadt der Niederlande und dort mit dem Boot fahren',
  });
  assert(!m.askBack, 'no askBack NL boot');
  assert(
    /amsterdam/i.test(m.normalizedQuery) ||
      /amsterdam/i.test(m.anchor.label || '') ||
      m.rewrites.some((r) => /Amsterdam/i.test(r)),
    `amsterdam inferred: ${m.normalizedQuery} / ${m.rewrites.join('|')}`,
  );
}

// --- Hotel Amsterdam Hbf ≤200 + Pool ---
{
  const m = buildMissionChecklist({
    userText:
      'Hotel in Amsterdam Nähe Hauptbahnhof unter 200 € mit Pool',
    order: {
      must: ['pool'],
      need: { prices: true, bookingLink: true, maps: true },
      search: {
        mode: 'hard',
        stages: ['pack', 'web', 'verify'],
        maxRadiusKm: 40,
        forbidSoftFill: true,
      },
    },
  });
  assert(m.family === 'hotel', `hotel family, got ${m.family}`);
  assert(m.forbidSoftFill, 'forbidSoftFill');
  assert(/amsterdam/i.test(m.anchor.name || m.anchor.label || ''), 'city');
  assert(
    m.factsToProve.some((f) => f.id === 'budget_max' && f.value === '200'),
    'budget 200',
  );
  assert(
    m.factsToProve.some((f) => f.id === 'amenity_pool'),
    'pool fact',
  );
  assert(
    m.factsToProve.some((f) => f.id === 'near_landmark'),
    'hbf landmark',
  );
  assert(
    m.factsToProve.some((f) => f.id === 'two_options'),
    'two options',
  );
  assert(!m.askBack, 'hotel no askBack');
  assert(m.stages.includes('stay22') || m.stages.includes('verify'), 'stages');
}

// --- Hamburg Towers Schedule checklist ---
{
  const m = buildMissionChecklist({
    userText:
      'Wann spielen die Hamburg Towers wieder in der Barclaycard Arena?',
  });
  assert(
    m.family === 'schedule' || m.family === 'event',
    `schedule family, got ${m.family}`,
  );
  for (const id of ['when', 'venue', 'ticket_price', 'booking_link']) {
    assert(
      m.factsToProve.some((f) => f.id === id),
      `missing fact ${id}`,
    );
  }
  assert(
    m.factsToProve.some((f) => f.id === 'opponent'),
    'opponent',
  );
  assert(!m.askBack, 'towers: search without askBack');
  assert(!hasCriticalBlocker(m), 'no critical blocker');
}

// --- Basketball: GPS-Anker, prefer free, kein „sei präziser“ ---
{
  const m = buildMissionChecklist({
    userText: 'Wo kann ich Basketball spielen?',
  });
  assert(m.family === 'amenity', `amenity court, got ${m.family}`);
  assert(m.anchor.kind === 'gps', `gps anchor, got ${m.anchor.kind}`);
  assert(
    m.factsToProve.some((f) => f.id === 'court_basketball'),
    'basketball court',
  );
  assert(
    m.factsToProve.some((f) => f.id === 'prefer_free'),
    'prefer free',
  );
  assert(
    m.factsToProve.some((f) => f.id === 'two_options'),
    'two options',
  );
  assert(!m.askBack, 'basketball no askBack');
  assert(criticalUnresolvedFacts(m).length === 0, 'no critical unresolved');
}

// --- Flughafen ohne Flugzeit → critical Ask-Back ---
{
  const m = buildMissionChecklist({
    userText: 'Wann muss ich am Flughafen sein?',
  });
  assert(m.family === 'flight', `flight, got ${m.family}`);
  assert(!!m.askBack, 'askBack required');
  assert(hasCriticalBlocker(m), 'critical blocker');
  assert(
    m.factsToProve.some((f) => f.id === 'flight_time' && f.critical),
    'flight_time critical',
  );
  assert(shouldEmitAskBack(m), 'shouldEmitAskBack');
}

// --- Bahn mit Ankunftsdeadline: suchen, nicht fragen ---
{
  const m = buildMissionChecklist({
    userText:
      'Morgen nach Berlin, ich will spätestens um 18 Uhr am Hauptbahnhof sein',
  });
  assert(m.family === 'transit', `transit, got ${m.family}`);
  assert(!m.askBack, 'transit with deadline: no askBack');
  assert(
    m.factsToProve.some((f) => f.id === 'arrival_deadline'),
    'arrival deadline fact',
  );
}

// --- Prompt format non-empty ---
{
  const m = buildMissionChecklist({
    userText: 'Spaghetti-Eis in der Nähe',
  });
  const p = formatMissionChecklistForPrompt(m);
  assert(/MISSION_CHECKLIST/.test(p), 'prompt header');
  assert(/family=/.test(p), 'family line');
}

console.log('missionChecklist.smoke.test.ts ok');
