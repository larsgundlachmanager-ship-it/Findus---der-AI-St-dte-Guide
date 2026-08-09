/**
 * Job → Deep-Research-Nachzug — Completeness erzwingt fehlende Fakten/Buttons.
 * Stadt-agnostisch; Agents liefern Fakten, keine Scripts.
 */

import type { AgentResult, Module2ActionButton } from '../types';
import type { RucksackState } from '../rucksack/rucksackStore';
import type {
  CompletenessReport,
  FindusJobId,
  JobClassification,
  JobFactKey,
} from './types';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';

export type DeepFillInput = {
  classification: JobClassification;
  report: CompletenessReport;
  userText: string;
  rucksack: RucksackState;
  alreadySaid: string;
  city?: string | null;
  lat: number;
  lng: number;
  /** Primär-Meta vom Fast-Agent */
  meta?: Record<string, unknown> | null;
  signal?: AbortSignal;
};

export type DeepFillResult = {
  agentResult: AgentResult;
  /** true wenn etwas Nutzbares nachgeliefert wurde */
  filled: boolean;
};

function missingSet(report: CompletenessReport): Set<string> {
  return new Set(report.missing.map((m) => String(m.key)));
}

function needs(
  missing: Set<string>,
  keys: Array<JobFactKey | string>,
): boolean {
  return keys.some((k) => missing.has(k));
}

/**
 * Erzwingt Nachrecherche für fehlende Contract-Fakten des aktuellen Jobs.
 */
export async function runJobDeepFill(
  input: DeepFillInput,
): Promise<DeepFillResult> {
  const { classification, report } = input;
  if (report.ok && report.missing.every((m) => m.lane === 'slow' && m.severity === 'should')) {
    // trotzdem Slow nachziehen wenn pending Actions
    if (!report.pendingActionHints.length) {
      return {
        agentResult: {
          agent: 'deep_research',
          ok: true,
          draftText: '',
          meta: { silent: true, reason: 'complete' },
        },
        filled: false,
      };
    }
  }

  const missing = missingSet(report);
  const jobId = classification.jobId;

  try {
    switch (jobId) {
      case 'tonight_live':
        return await fillCinema(input, missing);
      case 'dining_open':
      case 'dining_hard_match':
        return await fillGastro(input, missing);
      case 'stay_search':
        return await fillStay(input, missing);
      case 'transit_live':
        return await fillTransit(input, missing);
      case 'activity_sport':
        return await fillActivity(input, missing);
      case 'museum_theme':
      case 'sight_recommend':
      case 'poi_identify':
        return await fillKnowledgePitch(input, missing);
      case 'nightlife_vibe':
        return await fillNightlife(input, missing);
      case 'weather_outfit':
        return await fillWeather(input, missing);
      case 'emergency_care':
      case 'safety_lost':
      case 'friction_now':
        return await fillEmergency(input, missing);
      case 'fact_number':
        return await fillFact(input, missing);
      case 'day_plan_budget':
        return await fillDayPlan(input, missing);
      case 'shopping_errand':
      case 'luggage_practical':
      case 'mobility_rent':
      case 'parking_ev':
      case 'taxi_rideshare':
      case 'nav_route':
        return await fillPlacesGeneric(input, missing, jobId);
      default:
        return await fillPlacesGeneric(input, missing, jobId);
    }
  } catch {
    return {
      agentResult: {
        agent: 'deep_research',
        ok: false,
        draftText: '',
        error: { code: 'deep_fill_fail', message: 'deep fill failed' },
      },
      filled: false,
    };
  }
}

async function fillCinema(
  input: DeepFillInput,
  missing: Set<string>,
): Promise<DeepFillResult> {
  const { researchCinemaAndShowtimes } = await import(
    '../../services/research/cinemaShowtimeResearch'
  );
  const research = await researchCinemaAndShowtimes({
    userText: input.userText,
    lat: input.lat,
    lng: input.lng,
    signal: input.signal,
    venuesOnly: false,
    showtimeBudgetMs: 14_000,
  });

  const buttons: Module2ActionButton[] = [
    ...research.fastButtons,
    ...research.deferredButtons,
  ].slice(0, 4);

  const priceLines = research.showtimes
    .filter((s) => s.priceEur != null)
    .map((s) => `${s.filmTitle}: ca. ${s.priceEur} €`);
  const spokenExtra = [
    research.showtimes.length
      ? `Nachgeliefert: ${research.showtimes
          .slice(0, 2)
          .map((s) => `${s.filmTitle} ${s.whenLabel}${s.priceEur != null ? ` · ${s.priceEur}€` : ''}`)
          .join('; ')}.`
      : '',
    priceLines[0] ? `Ticket-Preis belegt: ${priceLines[0]}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    filled: research.showtimes.length > 0 || buttons.length > 0,
    agentResult: {
      agent: 'deep_research',
      ok: true,
      draftText: research.promptBlock,
      bullets: research.showtimes.slice(0, 2).map((s) => {
        const price =
          s.priceEur != null ? ` · ${s.priceEur}€` : '';
        return `${s.cinemaName}: ${s.whenLabel}${price}`;
      }),
      buttons,
      money: research.showtimes
        .filter((s) => s.priceEur != null)
        .slice(0, 2)
        .map((s) => ({
          amount: s.priceEur!,
          currency: 'EUR',
          amountEur: s.priceEur!,
        })),
      meta: {
        cinema: true,
        showtimes: research.showtimes,
        hasTicketBtn: buttons.some((b) => /🎫|ticket/i.test(b.label)),
        spokenExtra: spokenExtra || undefined,
        silent: !spokenExtra,
        hoursChecked: true,
      },
    },
  };
}

async function fillGastro(
  input: DeepFillInput,
  missing: Set<string>,
): Promise<DeepFillResult> {
  const venues = (input.meta?.venues as Array<{
    name: string;
    websiteUrl?: string | null;
    menuUrl?: string | null;
  }>) ?? [];
  if (!venues.length) {
    return {
      filled: false,
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: '',
        meta: { silent: true, reason: 'no_venues' },
      },
    };
  }
  const { runGastroMenuDeepResearch } = await import(
    '../agents/gastroMenuDeepResearch'
  );
  const deep = await runGastroMenuDeepResearch({
    userText: input.userText,
    venues,
    alreadySaid: input.alreadySaid,
    signal: input.signal,
  });
  return { filled: deep.ok && Boolean(deep.draftText || deep.buttons?.length), agentResult: deep };
}

async function fillStay(
  input: DeepFillInput,
  missing: Set<string>,
): Promise<DeepFillResult> {
  // Stay: Maps-Pitch / Stay22-Links nachschärfen wenn Venues da
  const venues = (input.meta?.venues as Array<{
    name: string;
    placeId?: string | null;
    lat?: number | null;
    lng?: number | null;
    websiteUrl?: string | null;
    stay?: unknown;
    bookUrl?: string | null;
  }>) ?? [];
  if (!venues.length) {
    return {
      filled: false,
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: '',
        meta: { silent: true },
      },
    };
  }
  const { runMapsPitchDeepResearch } = await import(
    '../agents/mapsPitchDeepResearch'
  );
  const deep = await runMapsPitchDeepResearch({
    userText: input.userText,
    kind: 'hotel',
    city: (input.meta?.city as string) ?? input.city,
    venues: venues.map((v) => ({
      name: v.name,
      placeId: v.placeId,
      lat: v.lat,
      lng: v.lng,
      websiteUrl: v.websiteUrl,
      stay: v.stay as never,
      bookUrl: v.bookUrl,
    })),
    checkin: input.meta?.checkin as string | undefined,
    checkout: input.meta?.checkout as string | undefined,
    adults: (input.meta?.adults as number) ?? 1,
    alreadySaid: input.alreadySaid,
    anchor: { lat: input.lat, lng: input.lng },
    signal: input.signal,
  });
  return { filled: deep.ok, agentResult: deep };
}

async function fillTransit(
  input: DeepFillInput,
  missing: Set<string>,
): Promise<DeepFillResult> {
  const { researchTransitDisruption } = await import(
    '../../services/research/transitDisruptionResearch'
  );
  const hit = await researchTransitDisruption({
    userText: input.userText,
    lat: input.lat,
    lng: input.lng,
    cityHint: input.city,
    signal: input.signal,
  });
  return {
    filled: hit.hasDisruption || hit.alternativeOffered || Boolean(hit.spokenDraft),
    agentResult: {
      agent: 'deep_research',
      ok: true,
      draftText: hit.promptBlock,
      bullets: hit.bullets,
      buttons: hit.buttons,
      meta: {
        transit: true,
        alternative: hit.alternativeOffered,
        spokenExtra: hit.spokenDraft,
        silent: !hit.spokenDraft,
      },
    },
  };
}

async function fillActivity(
  input: DeepFillInput,
  _missing: Set<string>,
): Promise<DeepFillResult> {
  const { researchActivitySport } = await import(
    '../../services/research/activitySportResearch'
  );
  const research = await researchActivitySport({
    userText: input.userText,
    lat: input.lat,
    lng: input.lng,
    cityHint: input.city,
    signal: input.signal,
  });
  return {
    filled: research.activityFit,
    agentResult: {
      agent: 'deep_research',
      ok: true,
      draftText: research.promptBlock,
      bullets: research.bullets,
      buttons: research.buttons,
      meta: {
        activityFit: research.activityFit,
        alternative: research.alternativeOffered,
        spokenExtra: research.spokenDraft,
        silent: false,
      },
    },
  };
}

async function fillKnowledgePitch(
  input: DeepFillInput,
  missing: Set<string>,
): Promise<DeepFillResult> {
  if (
    !needs(missing, [
      'ticket_or_info_url',
      'price_eur',
      'venue_options',
      'hard_match_evidence',
    ])
  ) {
    return {
      filled: false,
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: '',
        meta: { silent: true },
      },
    };
  }
  const { runOpenWebAgent } = await import(
    '../../services/research/webAgent/runOpenWebAgent'
  );
  try {
    const web = await runOpenWebAgent(input.userText);
    if (!web) {
      return {
        filled: false,
        agentResult: {
          agent: 'deep_research',
          ok: true,
          draftText: '',
          meta: { silent: true },
        },
      };
    }
    const buttons: Module2ActionButton[] = [];
    for (const s of (web.sources ?? []).slice(0, 2)) {
      const href = typeof s === 'string' ? s : (s as { url?: string }).url;
      const label =
        typeof s === 'string'
          ? '🌐 Mehr'
          : (s as { title?: string }).title || '🌐 Mehr';
      if (href && /^https?:\/\//i.test(href)) {
        buttons.push({
          id: `web_${buttons.length}`,
          label: shortenActionLabel(label),
          payload: { kind: 'deep_link', url: href },
        });
      }
    }
    const spoken = (web.speechHint || '').trim();
    return {
      filled: Boolean(spoken || buttons.length || web.facts?.length),
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: web.promptBlock || spoken,
        bullets: (web.facts ?? [])
          .slice(0, 3)
          .map((f) => {
            if (typeof f === 'string') return f;
            const o = f as { label?: string; value?: string };
            const line = [o.label, o.value].filter(Boolean).join(': ');
            return line.slice(0, 80);
          })
          .filter(Boolean),
        buttons,
        meta: {
          spokenExtra: spoken.slice(0, 400) || undefined,
          silent: !spoken,
          ticket_or_info_url: buttons.length > 0,
          number_answer: /\d/.test(spoken),
        },
      },
    };
  } catch {
    return {
      filled: false,
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: '',
        meta: { silent: true },
      },
    };
  }
}

async function fillNightlife(
  input: DeepFillInput,
  missing: Set<string>,
): Promise<DeepFillResult> {
  return fillKnowledgePitch(input, missing);
}

async function fillWeather(
  input: DeepFillInput,
  _missing: Set<string>,
): Promise<DeepFillResult> {
  try {
    const { refreshRucksackWeather } = await import(
      '../rucksack/rucksackWriters'
    );
    await refreshRucksackWeather();
    const w = input.rucksack.weather;
    const line = w?.summary
      ? `Wetter-Update: ${w.summary}${
          w.tempC != null ? ` · ${Math.round(w.tempC)}°` : ''
        }`
      : '';
    return {
      filled: Boolean(line),
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: line,
        bullets: line ? [line.slice(0, 80)] : [],
        meta: {
          weather_or_outfit: true,
          spokenExtra: line || undefined,
          silent: !line,
        },
      },
    };
  } catch {
    return {
      filled: false,
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: '',
        meta: { silent: true },
      },
    };
  }
}

async function fillEmergency(
  input: DeepFillInput,
  _missing: Set<string>,
): Promise<DeepFillResult> {
  const { handleEmergencyConcierge } = await import(
    '../../services/concierge/emergencyConcierge'
  );
  const em = await handleEmergencyConcierge(input.userText, {
    lat: input.lat,
    lng: input.lng,
  });
  const speech = em.concierge?.speechText || em.reply || '';
  const buttons: Module2ActionButton[] =
    em.concierge?.quickActions?.slice(0, 4).map((qa, i) => {
      if (qa.type === 'DIAL_PHONE' && qa.payload.phoneNumber) {
        return {
          id: `em_dial_${i}`,
          label: qa.label,
          payload: { kind: 'dial' as const, phone: qa.payload.phoneNumber },
        };
      }
      if (
        qa.type === 'START_NAVIGATION' &&
        qa.payload.destLat != null &&
        qa.payload.destLng != null
      ) {
        return {
          id: `em_nav_${i}`,
          label: qa.label,
          payload: {
            kind: 'navigate' as const,
            lat: qa.payload.destLat,
            lng: qa.payload.destLng,
            label: qa.payload.destName ?? qa.label,
            keepCard: true,
          },
        };
      }
      return {
        id: `em_${i}`,
        label: qa.label,
        payload: {
          kind: 'deep_link' as const,
          url: qa.payload.url ?? 'https://findus.local/pending',
        },
      };
    }) ?? [];

  return {
    filled: em.handled,
    agentResult: {
      agent: 'deep_research',
      ok: true,
      draftText: speech,
      bullets: (em.concierge?.visualBullets ?? []).slice(0, 3),
      buttons,
      meta: {
        emergencyHandled: em.handled,
        hoursChecked: em.meta?.hoursChecked,
        openNow: em.meta?.openNow,
        spokenExtra: speech.slice(0, 500),
        silent: false,
      },
    },
  };
}

async function fillFact(
  input: DeepFillInput,
  _missing: Set<string>,
): Promise<DeepFillResult> {
  return fillKnowledgePitch(input, new Set(['number_answer', 'ticket_or_info_url']));
}

async function fillDayPlan(
  input: DeepFillInput,
  missing: Set<string>,
): Promise<DeepFillResult> {
  return fillKnowledgePitch(input, missing);
}

async function fillPlacesGeneric(
  input: DeepFillInput,
  _missing: Set<string>,
  jobId: FindusJobId,
): Promise<DeepFillResult> {
  const { searchPlacesByText } = await import(
    '../../services/navigation/googleMapsNav'
  );
  const query =
    jobId === 'parking_ev'
      ? 'Parkplatz Ladestation'
      : jobId === 'taxi_rideshare'
        ? 'Taxi'
        : jobId === 'mobility_rent'
          ? 'E-Scooter Verleih'
          : jobId === 'luggage_practical'
            ? 'Schließfach Gepäck'
            : jobId === 'shopping_errand'
              ? input.userText.slice(0, 80)
              : input.userText.slice(0, 80);
  const hits = await searchPlacesByText({
    query,
    lat: input.lat,
    lng: input.lng,
    radiusM: 8_000,
  });
  const top = hits[0];
  if (!top) {
    return {
      filled: false,
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: '',
        meta: { silent: true },
      },
    };
  }
  const buttons: Module2ActionButton[] = [
    {
      id: 'gen_nav',
      label: shortenActionLabel(`📍 ${top.name}`),
      payload: {
        kind: 'navigate',
        lat: top.lat,
        lng: top.lng,
        label: top.name,
      },
    },
  ];
  if (top.websiteUri) {
    buttons.push({
      id: 'gen_web',
      label: shortenActionLabel('🌐 Web'),
      payload: { kind: 'deep_link', url: top.websiteUri },
    });
  }
  return {
    filled: true,
    agentResult: {
      agent: 'deep_research',
      ok: true,
      draftText: `Nächster Treffer: ${top.name}.`,
      bullets: [top.name],
      buttons,
      meta: {
        concrete_place: true,
        spokenExtra: `Nächster sinnvoller Spot: ${top.name}.`,
        silent: false,
      },
    },
  };
}

/** Ob Completeness einen Forced-Deep-Fill rechtfertigt. */
export function shouldForceDeepFill(report: CompletenessReport): boolean {
  if (!report.missing.length) return false;
  return report.missing.some(
    (m) =>
      m.severity === 'must' ||
      m.lane === 'slow' ||
      report.pendingActionHints.length > 0,
  );
}
