/**
 * Call-1 Multi-Lane Research — parallele Worker/Suchen, dann kombinierter Pitch.
 * Stadt-/Marken-agnostisch: Struktur aus der Frage, kein Domänen-Hardcode.
 *
 * or_either: „Kino oder Theater + Genre“ → 2 Lanes → Top1 je Lane = Pitch-Optionen
 * fetch_then_spot: „X holen + schön sitzen / Blick“ → Fetch-Lane + Spot-Lane
 * outdoor_program_weather: Open-Air/Freiluft + Programm + Wetter heute/morgen + Jacke
 * Offene Fragen: Extra-Aufträge frei inventieren (Hard-Musts verschärfen, Wetter-Gate)
 */

import type { PitchKind } from '../pitch/types';
import type { Call1ProximityMode, Call1WorkItem, Call1WorkerId } from './call1TaskBrief';
import type { Call1Criterion } from '../pitch/call1Criteria';
import {
  inventOutdoorActivityFromText,
  isOutdoorWeatherSensitiveAsk,
} from './outdoorWeatherGate';

export type MultiLaneKind =
  | 'or_either'
  | 'fetch_then_spot'
  | 'outdoor_program_weather';

export type MultiLaneLane = {
  id: string;
  /** Kurzlabel für Speech/Brief — aus der Frage abgeleitet */
  label: string;
  pitchKind: PitchKind;
  mustLabels: string[];
  queryBoost: string;
  /** Cinema/Events-Programm-Filter (Genre) */
  programGenre?: string | null;
};

export type MultiLaneFollowOn = {
  mustLabels: string[];
  queryBoost: string;
  pitchKind: PitchKind;
  /** Fetch-Optionen nach Nähe zum Spot ranken (nicht nur GPS) */
  preferNearFollowOn: boolean;
  /** Schmackhaft machen in Speech */
  enjoyHint: string;
};

export type MultiLaneWeatherGate = {
  checkTonight: boolean;
  checkTomorrow: boolean;
  deferIfRainTonight: boolean;
  jacketIfColdDrop: boolean;
};

export type MultiLanePlan = {
  kind: MultiLaneKind;
  sharedMust: string[];
  lanes: MultiLaneLane[];
  followOn?: MultiLaneFollowOn | null;
  /** Öffnung still mitdenken (To-go) — User muss es nicht sagen */
  implyOpenNow: boolean;
  speechRail: 'dual_or_venues' | 'fetch_then_view' | 'outdoor_program_weather';
  weatherGate?: MultiLaneWeatherGate | null;
  /** Hard outdoor filter — Indoor-Kinos verboten */
  hardOutdoorOnly?: boolean;
};

const GENRE_RE =
  /\b(komödien?|comed(?:y|ies)|thriller|action|drama|horror|familie|kids|kinder|romance|romantisch|musical|dokumentation|doku)\b/iu;

const VIEW_SPOT_RE =
  /\b(hafen|hafenblic|aussicht|blick\s+auf|meerblick|elbblick|alsterblick|sonnenuntergang|sunset|schön\s+(?:sitzen|hinsetzen)|genießen|geniessen|bank\s+mit\s+blick)\b/iu;

const FETCH_RE =
  /\b(eis|eissalon|eisdiele|gelato|spaghettieis|to[\s-]?go|mitnehmen|holen|snack|imbiss|pizza|döner|doener|kaffee\s+to[\s-]?go|café\s+to[\s-]?go|cafe\s+to[\s-]?go)\b/iu;

const OR_PAIR_STOP =
  /^(ich|wir|du|man|heute|morgen|abend|mal|bitte|hier|dort|was|wer|wie|egal|lieber|vielleicht|irgendwie|irgendwo|ein|eine|einen|das|die|der|ins|zum|zur|auf|in|am|im)$/iu;

function extractGenre(text: string): string | null {
  const m = text.match(GENRE_RE);
  if (!m?.[1]) return null;
  const g = m[1].toLowerCase();
  if (/komöd|comed/.test(g)) return 'komödie';
  return g.replace(/en$/i, '').slice(0, 24);
}

function pitchKindForOrToken(token: string): PitchKind {
  const t = token.toLowerCase();
  if (/kino|cinema|film/.test(t)) return 'cinema';
  if (
    /restaurant|essen|café|cafe|bistro|pizza|imbiss|bar\b|food|eis|döner|doener/.test(
      t,
    )
  ) {
    return 'food';
  }
  return 'sight';
}

function titleOrLabel(token: string): string {
  const t = token.replace(/[_-]+/g, ' ').trim();
  if (!t) return 'Option';
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * „A oder B“ / „entweder A oder B“ — Token dynamisch, kein Domänen-Paar-Hardcode.
 */
export function extractOrEitherTokens(
  text: string,
): { a: string; b: string } | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(
    /\b(?:entweder\s+)?(?:ins?\s+|zum\s+|zur\s+|ein(?:e|en)?\s+|die\s+|das\s+|den\s+)?([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,28})\s+oder\s+(?:ins?\s+|zum\s+|zur\s+|ein(?:e|en)?\s+|die\s+|das\s+|den\s+)?([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,28})\b/iu,
  );
  if (!m?.[1] || !m?.[2]) return null;
  const a = m[1].toLowerCase();
  const b = m[2].toLowerCase();
  if (OR_PAIR_STOP.test(a) || OR_PAIR_STOP.test(b)) return null;
  if (a === b) return null;
  // Braucht Find-/Wahl-Kontext oder zwei klare Venue-Typen
  const choiceCue =
    /\b(oder|entweder|egal\s+ob|lieber|wahl|option|geht\s+(?:beides|eins)|möcht|moecht|lust|bock|wo|hin)\b/iu.test(
      t,
    );
  if (!choiceCue) return null;
  return { a, b };
}

function extractNamedFetchToken(text: string): string | null {
  const m = text.match(
    /\b([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,24})\s+(?:eis|eissalon|eisdiele|gelato)\b/u,
  );
  if (m?.[1] && !/^(Das|Der|Die|Ein|Eine|Heute|Morgen)$/u.test(m[1])) {
    return m[1].toLowerCase();
  }
  const low = text.match(
    /\b([a-zäöüß][\wäöüß-]{2,24})\s+(?:eis|eissalon|eisdiele|gelato)\b/iu,
  );
  if (
    low?.[1] &&
    !/^(ein|eine|leckeres?|geiles?|gutes?|richtig|echt|hier|mein)\b/i.test(low[1])
  ) {
    return low[1].toLowerCase();
  }
  return null;
}

/**
 * Erkennt Multi-Lane-Pläne aus Umgangssprache.
 * null = einsträngiger Pitch reicht — Extra-Worker können trotzdem inventiert werden.
 */
export function detectMultiLanePlan(userText: string): MultiLanePlan | null {
  const t = String(userText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length < 12) return null;

  const hasKino = /\b(kino|cinema|film(?:e|theater)?)\b/iu.test(t);
  const hasTheater =
    /\b(theater|theatre|schauspiel|musical|bühne|buehne|kabarett)\b/iu.test(t) &&
    !/\b(filmtheater)\b/iu.test(t);
  const orCue =
    /\b(oder|bzw\.?|beziehungsweise|entweder|egal\s+ob)\b/iu.test(t) ||
    (hasKino && hasTheater);
  const genre = extractGenre(t);

  // Oder-Wahl ZUERST — sonst frisst Outdoor „Strand oder Pool“
  if (hasKino && hasTheater && orCue) {
    const shared = genre ? [genre] : [];
    return {
      kind: 'or_either',
      sharedMust: shared,
      lanes: [
        {
          id: 'lane_cinema',
          label: 'Kino',
          pitchKind: 'cinema',
          mustLabels: [...shared, 'kino'],
          queryBoost: genre
            ? `Kino ${genre} Programm Komödie Comedy`
            : 'Kino Programm heute',
          programGenre: genre,
        },
        {
          id: 'lane_theatre',
          label: 'Theater',
          pitchKind: 'sight',
          mustLabels: [...shared, 'theater'],
          queryBoost: genre
            ? `Theater ${genre} Komödie Programm Vorstellung`
            : 'Theater Programm heute',
          programGenre: genre,
        },
      ],
      followOn: null,
      implyOpenNow: false,
      speechRail: 'dual_or_venues',
    };
  }

  const orPair = extractOrEitherTokens(t);
  if (orPair && orCue) {
    const shared = genre ? [genre] : [];
    const kindA = pitchKindForOrToken(orPair.a);
    const kindB = pitchKindForOrToken(orPair.b);
    return {
      kind: 'or_either',
      sharedMust: shared,
      lanes: [
        {
          id: `lane_${orPair.a.slice(0, 16)}`,
          label: titleOrLabel(orPair.a),
          pitchKind: kindA,
          mustLabels: [...shared, orPair.a],
          queryBoost: `${orPair.a}${genre ? ` ${genre}` : ''}`.trim(),
          programGenre: kindA === 'cinema' ? genre : null,
        },
        {
          id: `lane_${orPair.b.slice(0, 16)}`,
          label: titleOrLabel(orPair.b),
          pitchKind: kindB,
          mustLabels: [...shared, orPair.b],
          queryBoost: `${orPair.b}${genre ? ` ${genre}` : ''}`.trim(),
          programGenre: kindB === 'cinema' ? genre : null,
        },
      ],
      followOn: null,
      implyOpenNow: false,
      speechRail: 'dual_or_venues',
    };
  }

  // Outdoor: dynamisch inventiert (Yoga, Minigolf, Freilicht, …) — keine Themenliste
  const outdoorAct = inventOutdoorActivityFromText(t);
  if (outdoorAct && isOutdoorWeatherSensitiveAsk(t)) {
    return {
      kind: 'outdoor_program_weather',
      sharedMust: outdoorAct.mustLabels,
      lanes: [
        {
          id: `lane_${outdoorAct.kind}`,
          label: outdoorAct.label,
          pitchKind: outdoorAct.pitchKind,
          mustLabels: outdoorAct.mustLabels,
          queryBoost: outdoorAct.needsProgram
            ? `${outdoorAct.queryBoost} Programm heute`
            : `${outdoorAct.queryBoost} heute`,
          programGenre: null,
        },
      ],
      followOn: null,
      implyOpenNow: false,
      speechRail: 'outdoor_program_weather',
      hardOutdoorOnly: true,
      weatherGate: {
        checkTonight: true,
        checkTomorrow: true,
        deferIfRainTonight: true,
        jacketIfColdDrop: true,
      },
    };
  }

  const fetchCue = FETCH_RE.test(t);
  const spotCue = VIEW_SPOT_RE.test(t);
  const sequenceCue =
    /\b(und\s+dann|danach|anschließend|anschliessend|dann\s+ja|und\s+ja|mitnehmen.{0,40}(sitzen|genießen|geniessen|blick|hafen)|holen.{0,60}(blick|hafen|aussicht))\b/iu.test(
      t,
    ) ||
    (fetchCue && spotCue && /\b(und|dann)\b/iu.test(t));

  if (fetchCue && spotCue && sequenceCue) {
    const brand = extractNamedFetchToken(t);
    const fetchMust = [
      ...(brand ? [brand] : []),
      /\beis\b|gelato|eisdiele/i.test(t) ? 'eis' : 'to_go',
    ];
    const viewMust = /\bhafen/i.test(t)
      ? ['hafenblick', 'aussicht']
      : /\bsonnenuntergang|sunset/i.test(t)
        ? ['sonnenuntergang', 'aussicht']
        : ['aussicht'];
    return {
      kind: 'fetch_then_spot',
      sharedMust: [],
      lanes: [
        {
          id: 'lane_fetch',
          label: brand ? `${brand} Eis` : 'To-go / Eis',
          pitchKind: 'food',
          mustLabels: fetchMust,
          queryBoost: brand
            ? `${brand} Eisdiele Gelato to go`
            : /\beis\b/i.test(t)
              ? 'Eisdiele Gelato Eis to go'
              : 'Imbiss Takeaway to go',
        },
      ],
      followOn: {
        mustLabels: viewMust,
        queryBoost: /\bhafen/i.test(t)
          ? 'Hafen Aussicht Blick Sitzbank Promenade'
          : 'Aussicht Blick schön sitzen',
        pitchKind: 'sight',
        preferNearFollowOn: true,
        enjoyHint: /\bhafen/i.test(t)
          ? 'Blick auf den Hafen'
          : 'schöner Aussichtsplatz',
      },
      implyOpenNow: true,
      speechRail: 'fetch_then_view',
    };
  }

  return null;
}

/**
 * Freie Extra-Aufträge für offene Fragen (auch ohne vollständigen Multi-Lane-Plan).
 * Geschlossene Quiz-/Maßzahl-Fragen → leer (kein Hintergedanke).
 */
export function inventOpenResearchExtras(
  userText: string,
  proximity: Call1ProximityMode,
): Call1WorkItem[] {
  const t = String(userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];

  try {
    const {
      isClosedFactAsk,
      inventIntentForesightWork,
    } = require('./call1IntentForesight') as {
      isClosedFactAsk: (s: string) => boolean;
      inventIntentForesightWork: (
        s: string,
        p: Call1ProximityMode,
      ) => Call1WorkItem[];
    };
    if (isClosedFactAsk(t)) return [];
    const foresight = inventIntentForesightWork(t, proximity);
    if (foresight.length) {
      // Foresight deckt Slot-Wetter / Aktivität+Wetter / Badetag — Outdoor-Invent nur ergänzen
      const out = [...foresight];
      const existing = new Set(out.map((w) => w.id));
      const outdoorAct = inventOutdoorActivityFromText(t);
      if (
        outdoorAct &&
        isOutdoorWeatherSensitiveAsk(t) &&
        !out.some((w) => w.id === 'foresight_activity_pitch')
      ) {
        const item: Call1WorkItem = {
          id: 'invent_outdoor_activity',
          worker: outdoorAct.pitchKind === 'cinema' ? 'events' : 'pitch',
          brief: `Inventur: ${outdoorAct.label} outdoor — Indoor weglassen`,
          proximity,
          executeWhen: 'now',
          must: outdoorAct.mustLabels.map((key) => ({
            key,
            role: 'must' as const,
            weight: 26,
          })),
        };
        if (!existing.has(item.id)) out.push(item);
      }
      return out.slice(0, 6);
    }
  } catch {
    /* soft — weiter mit Legacy-Invent */
  }

  const out: Call1WorkItem[] = [];
  const outdoor =
    isOutdoorWeatherSensitiveAsk(t) ||
    inventOutdoorActivityFromText(t) != null ||
    (/\b(heute\s+abend|heute\s+nacht|abends|nachmittag)\b/iu.test(t) &&
      /\b(draußen|draussen|terrasse|biergarten|festival|konzert|picknick|picnic)\b/iu.test(
        t,
      ));
  if (outdoor || detectMultiLanePlan(t)?.weatherGate) {
    out.push({
      id: 'invent_weather_tonight',
      worker: 'weather',
      brief: 'Wetter heute Abend: Regenrisiko + Temperatur für Outdoor',
      proximity,
      executeWhen: 'now',
      neededSlots: ['temp_c', 'sky', 'rain_timing', 'night_low_c'],
    });
    out.push({
      id: 'invent_weather_tomorrow',
      worker: 'weather',
      brief: 'Wetter morgen Abend: besser als heute? Regen/Trocken',
      proximity,
      executeWhen: 'now',
      neededSlots: ['tomorrow_summary', 'rain_timing'],
    });
  }
  if (isOutdoorWeatherSensitiveAsk(t) || inventOutdoorActivityFromText(t)) {
    const act = inventOutdoorActivityFromText(t);
    out.push({
      id: 'invent_outdoor_activity',
      worker: act?.pitchKind === 'cinema' ? 'events' : 'pitch',
      brief: act
        ? `Inventur: ${act.label} outdoor suchen — Indoor weglassen`
        : 'Outdoor-Aktivität live suchen — Indoor weglassen',
      proximity,
      executeWhen: 'now',
      must: (act?.mustLabels ?? ['outdoor']).map((key) => ({
        key,
        role: 'must' as const,
        weight: 26,
      })),
    });
    out.push({
      id: 'invent_deep_web_outdoor',
      worker: 'deep_web',
      brief: `Live-Web: ${act?.label ?? 'Outdoor'} Beleg/Programm in der Nähe`,
      proximity,
      executeWhen: 'now',
    });
  }
  // Picknick: Parks + Wetter + optional Sport-Fläche
  try {
    const { looksLikePicnicQuery } = require('../pitch/picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    if (looksLikePicnicQuery(t)) {
      out.push({
        id: 'invent_picnic_parks',
        worker: 'pitch',
        brief:
          'Picknick-Parks nah GPS — Sitz/Schatten; Soft: Sportfläche wenn Prefs',
        proximity: 'here_now',
        executeWhen: 'now',
        must: [{ key: 'picknick', role: 'must', weight: 24 }],
      });
      if (!out.some((w) => w.worker === 'weather')) {
        out.push({
          id: 'invent_picnic_weather',
          worker: 'weather',
          brief: 'Wetter Nachmittag: Regenfenster → früher vorschlagen',
          proximity: 'here_now',
          executeWhen: 'now',
          neededSlots: ['temp_c', 'sky', 'rain_timing'],
        });
      }
    }
  } catch {
    /* soft */
  }
  try {
    const {
      looksLikeSituationProblem,
      extractQuestMustKeys,
    } = require('./missionFollowThrough') as {
      looksLikeSituationProblem: (s: string) => boolean;
      extractQuestMustKeys: (s: string) => string[];
    };
    if (looksLikeSituationProblem(t)) {
      const keys = extractQuestMustKeys(t);
      if (!out.some((w) => w.worker === 'pitch')) {
        out.push({
          id: 'invent_situation_pitch',
          worker: 'pitch',
          brief: `Alltagsproblem lösen: ${t.slice(0, 80)} — nur passende Hilfe, kein Soft-Fill`,
          proximity: 'here_now',
          executeWhen: 'now',
          must: keys.map((key) => ({
            key,
            role: 'must' as const,
            weight: 22,
          })),
        });
      } else {
        const pitch = out.find((w) => w.worker === 'pitch');
        if (pitch && keys.length) {
          const seen = new Set((pitch.must ?? []).map((m) => m.key.toLowerCase()));
          pitch.must = [
            ...(pitch.must ?? []),
            ...keys
              .filter((k) => !seen.has(k))
              .map((key) => ({ key, role: 'must' as const, weight: 22 })),
          ];
        }
      }
      if (!out.some((w) => w.worker === 'deep_web')) {
        out.push({
          id: 'invent_situation_web',
          worker: 'deep_web',
          brief: 'Live-Web: Hilfe/Beleg zum Alltagsproblem — nichts erfinden',
          proximity,
          executeWhen: 'now',
        });
      }
    }
  } catch {
    /* soft */
  }
  return out.slice(0, 5);
}

export function multiLaneAuthorIntent(plan: MultiLanePlan): string {
  if (plan.kind === 'outdoor_program_weather') {
    const label = plan.lanes[0]?.label ?? 'Outdoor';
    return [
      `${label}: nur passende Outdoor-Venues (kein Indoor-Soft-Fill)`,
      'Angebot/Programm recherchieren',
      'Wetter heute Abend + morgen Abend parallel',
      'Regen heute → Vorschlag morgen wenn besser; Jacke bei Kälte-Abfall',
      'Speech: Ort → was heute geht → Wetter-Fit; sonst morgen + Prognose',
    ].join('. ');
  }
  if (plan.kind === 'or_either') {
    const genre = plan.sharedMust[0];
    const a = plan.lanes[0]?.label ?? 'Option A';
    const b = plan.lanes[1]?.label ?? 'Option B';
    return [
      `Zwei parallele Recherchen: ${a} und ${b}`,
      genre ? `gemeinsamer Filter: ${genre}` : null,
      'Je Lane Programm + Bewertung ranken → Top-1 wird Pitch-Option',
      'Speech: zwei klare Optionen zur Wahl, Belege im Satz',
    ]
      .filter(Boolean)
      .join('. ');
  }
  const fetch = plan.lanes[0]?.label ?? 'Fetch';
  const spot = plan.followOn?.enjoyHint ?? 'Spot';
  return [
    `Zwei Recherchen: (1) ${fetch} (2) ${spot}`,
    plan.followOn?.preferNearFollowOn
      ? 'Fetch-Optionen nah am Spot ranken (Spot wichtiger als reine GPS-Nähe)'
      : null,
    plan.implyOpenNow ? 'Öffnung still prüfen (To-go jetzt)' : null,
    `Speech: zuerst 2 ${fetch}-Optionen, Dauer zum Spot, Spot schmackhaft`,
    'Nach Wahl: Multi-Stop Nav Fetch → Spot, Speisekarte wenn URL',
  ]
    .filter(Boolean)
    .join('. ');
}

/** Call-1 Work-Items — parallele Lanes (max 6 insgesamt mit anderen). */
export function multiLaneWorkItems(
  plan: MultiLanePlan,
  proximity: Call1ProximityMode,
): Call1WorkItem[] {
  const out: Call1WorkItem[] = [];
  for (const lane of plan.lanes) {
    const worker: Call1WorkerId =
      lane.pitchKind === 'cinema'
        ? 'events'
        : lane.pitchKind === 'food'
          ? 'dining'
          : 'pitch';
    const must: Call1Criterion[] = lane.mustLabels.map((k) => ({
      key: k,
      role: 'must' as const,
      weight: 22,
    }));
    out.push({
      id: `ml_${lane.id}`,
      worker,
      brief: [
        `Multi-Lane ${plan.kind}: ${lane.label}`,
        lane.queryBoost,
        lane.programGenre ? `Genre=${lane.programGenre}` : null,
        `Musts: ${lane.mustLabels.join(',')}`,
      ]
        .filter(Boolean)
        .join(' — ')
        .slice(0, 220),
      proximity,
      executeWhen: 'now',
      must,
    });
  }
  if (plan.followOn) {
    const must: Call1Criterion[] = plan.followOn.mustLabels.map((k) => ({
      key: k,
      role: 'must' as const,
      weight: 22,
    }));
    out.push({
      id: 'ml_follow_on_spot',
      worker: 'pitch',
      brief: [
        `Multi-Lane Spot: ${plan.followOn.enjoyHint}`,
        plan.followOn.queryBoost,
        `Musts: ${plan.followOn.mustLabels.join(',')}`,
        plan.followOn.preferNearFollowOn ? 'Pair mit Fetch-Lane' : null,
      ]
        .filter(Boolean)
        .join(' — ')
        .slice(0, 220),
      proximity,
      executeWhen: 'now',
      must,
    });
  }
  if (plan.weatherGate?.checkTonight) {
    out.push({
      id: 'ml_weather_tonight',
      worker: 'weather',
      brief: 'Wetter heute Abend Outdoor: Regen + Temperatur',
      proximity,
      executeWhen: 'now',
      neededSlots: ['temp_c', 'sky', 'rain_timing', 'night_low_c'],
    });
  }
  if (plan.weatherGate?.checkTomorrow) {
    out.push({
      id: 'ml_weather_tomorrow',
      worker: 'weather',
      brief: 'Wetter morgen Abend: Regenrisiko vs. heute',
      proximity,
      executeWhen: 'now',
      neededSlots: ['tomorrow_summary', 'rain_timing'],
    });
  }
  out.push({
    id: 'ml_compose_pitch',
    worker: 'pitch',
    brief: multiLaneAuthorIntent(plan).slice(0, 220),
    proximity,
    executeWhen: 'now',
    dependsOn: out[0]?.id,
  });
  return out.slice(0, 6);
}

export function multiLaneSpeechRailBlock(plan: MultiLanePlan): string {
  if (plan.speechRail === 'outdoor_program_weather') {
    return `MULTI-LANE OUTDOOR + WETTER (Struktur, Wortlaut frei — Kino, Theater, Minigolf, Golf, …):
- Zuerst: Outdoor-Venue + was heute geht (Film/Programm/Anlage).
- Dann: Wetter heute Abend ehrlich (Regen? kalt?).
- Regen heute + morgen besser → auf morgen verschieben + Prognose wenn belegt.
- Kälte-Abfall nachts → Jacken-Hinweis (nur mit belegter Temp).
- Nie Indoor als Outdoor verkaufen. Nichts erfinden.`;
  }
  if (plan.speechRail === 'dual_or_venues') {
    return `MULTI-LANE ODER-WAHL (Struktur, Wortlaut frei):
- Zwei parallele Recherchen gelaufen (z. B. Kino vs Theater).
- Option 1 = Top der ersten Lane (Programm + Bewertung), Option 2 = Top der zweiten.
- Speech: beide Optionen klar, Genre-Beleg wenn da, kurze Wahlfrage.
- Kein Soft-Fill mit falschem Genre.`;
  }
  return `MULTI-LANE FETCH→SPOT (Struktur, Wortlaut frei):
- Zuerst 2 Fetch-Optionen (Eis/To-go) pitchen — Öffnung still mitgedacht.
- Bezug: Fuß-/Fahrdauer Fetch → Spot (${plan.followOn?.enjoyHint ?? 'Aussicht'}).
- Spot am Ende schmackhaft machen (Blick/Atmosphäre) — Ort nennen.
- Nach User-Wahl: Nav zum Fetch, Spot schon als nächster Stopp; Speisekarte-Link wenn URL.
- Fetch möglichst nah am Spot ranken, nicht nur nah am User.`;
}
