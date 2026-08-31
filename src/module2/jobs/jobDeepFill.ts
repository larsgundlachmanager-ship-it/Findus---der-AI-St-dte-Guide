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
      case 'taxi_rideshare':
        return await fillTaxiRideshare(input);
      case 'shopping_errand':
      case 'luggage_practical':
      case 'mobility_rent':
      case 'parking_ev':
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
  const {
    detectCinemaPhase,
    researchCinemaAndShowtimes,
  } = await import('../../services/research/cinemaShowtimeResearch');
  const phase =
    (input.meta?.cinemaPhase as 'orient' | 'showtimes' | undefined) ??
    detectCinemaPhase(input.userText);
  // Orient-Turn: keine nachgeschobene Uhrzeiten-Speech (User wollte Orientierung)
  if (phase === 'orient' && !missing.has('showtimes_future')) {
    return {
      filled: false,
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: '',
        meta: { silent: true, cinema: true, cinemaPhase: 'orient' },
      },
    };
  }

  const research = await researchCinemaAndShowtimes({
    userText: input.userText,
    lat: input.lat,
    lng: input.lng,
    signal: input.signal,
    venuesOnly: false,
    phase,
    showtimeBudgetMs: phase === 'orient' ? 10_000 : 14_000,
  });

  const buttons: Module2ActionButton[] = [
    ...research.fastButtons,
    ...research.deferredButtons,
  ].slice(0, 4);

  const priceLines = research.showtimes
    .filter((s) => s.priceEur != null)
    .map((s) => `${s.filmTitle}: ca. ${s.priceEur} €`);
  // Nur im Showtimes-Turn laut nachliefern — Orient bleibt still (nur Card-Buttons)
  const spokenExtra =
    research.phase === 'showtimes'
      ? [
          research.showtimes.length
            ? `Nachgeliefert: ${research.showtimes
                .slice(0, 2)
                .map(
                  (s) =>
                    `${s.filmTitle} ${s.whenLabel}${s.priceEur != null ? ` · ${s.priceEur}€` : ''}`,
                )
                .join('; ')}.`
            : '',
          priceLines[0] ? `Ticket-Preis belegt: ${priceLines[0]}.` : '',
        ]
          .filter(Boolean)
          .join(' ')
      : '';

  return {
    filled:
      research.filmPicks.length > 0 ||
      research.showtimes.length > 0 ||
      buttons.length > 0,
    agentResult: {
      agent: 'deep_research',
      ok: true,
      draftText: research.promptBlock,
      bullets:
        research.phase === 'orient'
          ? research.filmPicks.slice(0, 2).map((f) =>
              f.genreHint ? `${f.title} · ${f.genreHint}` : f.title,
            )
          : research.showtimes.slice(0, 2).map((s) => {
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
        cinemaPhase: research.phase,
        filmPicks: research.filmPicks,
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
  const rawVenues = (input.meta?.venues as Array<{
    name: string;
    placeId?: string | null;
    lat?: number | null;
    lng?: number | null;
    websiteUrl?: string | null;
    stay?: unknown;
    bookUrl?: string | null;
    tags?: string[] | null;
    summary?: string | null;
  }>) ?? [];
  let venues = rawVenues;
  try {
    const { extractStayMustHaves, filterStayOptions } = require('../reboot/pipeline/stayMustHaves') as {
      extractStayMustHaves: (s: string) => Array<'pool' | 'sauna' | 'view'>;
      filterStayOptions: <T,>(v: T[], m: Array<'pool' | 'sauna' | 'view'>, n?: number) => T[];
    };
    venues = filterStayOptions(
      rawVenues,
      extractStayMustHaves(input.userText),
      2,
    );
  } catch {
    venues = rawVenues.slice(0, 2);
  }
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
  _missing: Set<string>,
): Promise<DeepFillResult> {
  try {
    const { wantsTransitTicketFare, researchTransitTicketFare } = await import(
      '../../services/transit/transitTicketResearch'
    );
    if (wantsTransitTicketFare(input.userText)) {
      const hit = await researchTransitTicketFare({
        userText: input.userText,
        lat: input.lat,
        lng: input.lng,
        cityHint: input.city,
      });
      const buttons: Module2ActionButton[] = hit.actions
        .filter((a) => a.type === 'OPEN_URL' && a.payload.url)
        .map((a, i) => ({
          id: `oepnv_tix_${i}`,
          label: a.label,
          payload: { kind: 'deep_link' as const, url: a.payload.url! },
        }));
      return {
        filled: true,
        agentResult: {
          agent: 'deep_research',
          ok: true,
          draftText: hit.speech,
          bullets: hit.bullets,
          buttons,
          meta: {
            transit: true,
            priceEur: hit.price,
            ticket_or_info_url: buttons.length > 0,
            ticketUrl:
              buttons[0]?.payload.kind === 'deep_link'
                ? buttons[0].payload.url
                : undefined,
            hasTicketBtn: buttons.length > 0,
            spokenExtra: hit.speech.slice(0, 400),
            silent: false,
          },
        },
      };
    }
  } catch {
    /* fall through */
  }
  try {
    const {
      wantsFerryOperatorSite,
      ferryTicketActionsFromResearch,
    } = await import('../../services/transit/ferryTicketResearch');
    if (wantsFerryOperatorSite(input.userText)) {
      const { runWebResearch } = await import(
        '../../services/research/webResearchService'
      );
      const web = await runWebResearch(input.userText, { force: true });
      const ferryActs = web
        ? ferryTicketActionsFromResearch({
            query: input.userText,
            sources: web.sources,
            facts: web.facts,
          })
        : [];
      const buttons: Module2ActionButton[] = ferryActs
        .filter((a) => a.type === 'OPEN_URL' && a.payload.url)
        .map((a, i) => ({
          id: `ferry_tix_${i}`,
          label: a.label,
          payload: { kind: 'deep_link' as const, url: a.payload.url! },
        }));
      const spoken = (web?.speechHint || '').trim();
      if (buttons.length || spoken || web?.facts?.length) {
        return {
          filled: true,
          agentResult: {
            agent: 'deep_research',
            ok: true,
            draftText: web?.promptBlock || spoken,
            bullets: (web?.facts ?? [])
              .slice(0, 3)
              .map((f) => [f.label, f.value].filter(Boolean).join(': '))
              .filter(Boolean),
            buttons,
            meta: {
              transit: true,
              ticket_or_info_url: buttons.length > 0,
              ticketUrl:
                buttons[0]?.payload.kind === 'deep_link'
                  ? buttons[0].payload.url
                  : undefined,
              spokenExtra: spoken.slice(0, 400) || undefined,
              silent: !spoken,
            },
          },
        };
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const { looksLikeTicketedPlaceAccess } = await import('./jobAnalogy');
    if (looksLikeTicketedPlaceAccess(input.userText)) {
      const { ticketedAccessActionsFromResearch } = await import(
        '../../services/transit/ticketedAccessResearch'
      );
      const { runWebResearch } = await import(
        '../../services/research/webResearchService'
      );
      const web = await runWebResearch(input.userText, { force: true });
      const accessActs = web
        ? ticketedAccessActionsFromResearch({
            query: input.userText,
            sources: web.sources,
            facts: web.facts,
          })
        : [];
      const accessButtons: Module2ActionButton[] = accessActs
        .filter((a) => a.type === 'OPEN_URL' && a.payload.url)
        .map((a, i) => ({
          id: `access_tix_${i}`,
          label: a.label,
          payload: { kind: 'deep_link' as const, url: a.payload.url! },
        }));
      const accessSpoken = (web?.speechHint || '').trim();
      if (accessButtons.length || accessSpoken || web?.facts?.length) {
        return {
          filled: true,
          agentResult: {
            agent: 'deep_research',
            ok: true,
            draftText: web?.promptBlock || accessSpoken,
            bullets: (web?.facts ?? [])
              .slice(0, 3)
              .map((f) => [f.label, f.value].filter(Boolean).join(': '))
              .filter(Boolean),
            buttons: accessButtons,
            meta: {
              transit: true,
              ticket_or_info_url: accessButtons.length > 0,
              ticketUrl:
                accessButtons[0]?.payload.kind === 'deep_link'
                  ? accessButtons[0].payload.url
                  : undefined,
              spokenExtra: accessSpoken.slice(0, 400) || undefined,
              silent: !accessSpoken,
            },
          },
        };
      }
    }
  } catch {
    /* fall through to disruption */
  }
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
  _missing: Set<string>,
): Promise<DeepFillResult> {
  try {
    const {
      isEventResearchQuery,
      researchTodaysEvents,
      synthesizeEventSpeech,
      eventResearchToActions,
    } = await import('../../services/concierge/eventResearchService');
    if (!isEventResearchQuery(input.userText)) {
      return fillKnowledgePitch(input, _missing);
    }
    const research = await researchTodaysEvents(input.userText);
    if (!research) {
      const city = (() => {
        try {
          const {
            resolveEventResearchCity,
          } = require('../../services/concierge/eventResearchService') as {
            resolveEventResearchCity: (t: string) => string;
          };
          return resolveEventResearchCity(input.userText);
        } catch {
          return 'der Umgebung';
        }
      })();
      const speech = `Die Live-Event-Suche für ${city} hakt gerade. Sag mir gern Live-Musik, Bar/Club oder Konzert — dann versuche ich es gezielter.`;
      return {
        filled: true,
        agentResult: {
          agent: 'deep_research',
          ok: true,
          draftText: speech,
          bullets: [],
          buttons: [],
          meta: { nightlife: true, silent: false, eventResearchFailed: true },
        },
      };
    }
    const speech = synthesizeEventSpeech(research);
    const qas = eventResearchToActions(research);
    const buttons: Module2ActionButton[] = [];
    for (let i = 0; i < qas.length && buttons.length < 4; i++) {
      const a = qas[i]!;
      if (
        a.type === 'START_NAVIGATION' &&
        typeof a.payload.destLat === 'number' &&
        typeof a.payload.destLng === 'number'
      ) {
        buttons.push({
          id: `nl_nav_${i}`,
          label: shortenActionLabel(a.label),
          payload: {
            kind: 'navigate',
            lat: a.payload.destLat,
            lng: a.payload.destLng,
            label: a.payload.destName || a.label,
          },
        });
      } else if (a.type === 'OPEN_URL' && a.payload.url) {
        buttons.push({
          id: `nl_url_${i}`,
          label: shortenActionLabel(a.label),
          payload: { kind: 'deep_link', url: a.payload.url },
        });
      }
    }
    if (!buttons.some((b) => b.payload.kind === 'deep_link' || b.payload.kind === 'navigate')) {
      /* Kein Maps-Namenssuche-Fallback */
    }
    // Card patchen falls Speech schon lief
    try {
      const { useFinnusStore } = await import('../../store/useFinnusStore');
      const card = useFinnusStore.getState().activeConciergeCard;
      if (card && buttons.length) {
        const { presentToUi } = await import('../pipeline/presentToUi');
        await presentToUi(speech || card.speechText, [
          ...(card.visualBullets ?? []),
          ...research.events.slice(0, 2).map((e) => `${e.title} @ ${e.venue}`),
        ], buttons, { userText: input.userText });
      }
    } catch {
      /* soft */
    }
    return {
      filled: Boolean(speech || buttons.length),
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: speech,
        bullets: research.events.slice(0, 3).map((e) => {
          const t = e.startTime ? `${e.startTime} · ` : '';
          return `${t}${e.title} @ ${e.venue}`;
        }),
        buttons,
        meta: {
          nightlife: true,
          venue_options: research.events.length > 0,
          ticket_or_info_url: buttons.some((b) => b.payload.kind === 'deep_link'),
          spokenExtra: speech.slice(0, 400) || undefined,
          silent: !speech,
        },
      },
    };
  } catch {
    return fillKnowledgePitch(input, _missing);
  }
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
    let rainVsOutdoor: 'indoor' | 'outdoor' | 'unknown' = 'unknown';
    try {
      const { rainVsOutdoorFromWeather } = require('../reboot/pipeline/thinkAheadCode') as {
        rainVsOutdoorFromWeather: (
          s: string | null | undefined,
        ) => 'indoor' | 'outdoor' | 'unknown';
      };
      rainVsOutdoor = rainVsOutdoorFromWeather(w?.summary);
    } catch {
      rainVsOutdoor = 'unknown';
    }
    return {
      filled: Boolean(line),
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: line,
        bullets: line ? [line.slice(0, 80)] : [],
        meta: {
          weather_or_outfit: true,
          rain_vs_outdoor: rainVsOutdoor,
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
  try {
    const { isPhoneChargeIntent, runPhoneChargeDiscovery } = await import(
      '../../services/navigation/phoneChargeDiscovery'
    );
    if (isPhoneChargeIntent(input.userText)) {
      try {
        const charge = await runPhoneChargeDiscovery({
          origin: { lat: input.lat, lng: input.lng },
        });
        const buttons: Module2ActionButton[] = charge.quickActions
          .slice(0, 2)
          .map((qa, i) => {
            if (
              qa.type === 'START_NAVIGATION' &&
              qa.payload.destLat != null &&
              qa.payload.destLng != null
            ) {
              return {
                id: `charge_nav_${i}`,
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
              id: `charge_${i}`,
              label: qa.label,
              payload: {
                kind: 'deep_link' as const,
                url: qa.payload.url ?? 'https://findus.local/pending',
              },
            };
          });
        return {
          filled: true,
          agentResult: {
            agent: 'deep_research',
            ok: true,
            draftText: charge.speech,
            bullets: (charge.visualBullets ?? []).slice(0, 2),
            buttons,
            meta: {
              emergencyHandled: true,
              chargeSurvival: true,
              spokenExtra: charge.speech.slice(0, 500),
              silent: false,
            },
          },
        };
      } catch {
        return {
          filled: true,
          agentResult: {
            agent: 'deep_research',
            ok: true,
            draftText:
              'Gerade kein glaubwürdiger Powerbank-Automat oder offenes Café zum Laden — kein Fake-Tipp. Tipp nochmal suchen, wenn GPS klar ist.',
            bullets: ['Kein belegter Lade-Spot'],
            buttons: [],
            meta: { emergencyHandled: true, chargeSurvival: true, silent: false },
          },
        };
      }
    }
  } catch {
    /* fall through to medical emergency */
  }

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

async function fillTaxiRideshare(
  input: DeepFillInput,
): Promise<DeepFillResult> {
  const { runTaxiRideshare } = await import('../agents/taxiRideshare');
  const result = await runTaxiRideshare({
    task: {
      id: 'taxi_fill',
      rawText: input.userText,
      rewrittenText: input.userText,
      intent: 'mobility',
      priority: 1,
      jobId: 'taxi_rideshare',
      city: input.city,
    },
    rucksack: input.rucksack,
  });
  if (!result?.ok) {
    return {
      filled: false,
      agentResult: {
        agent: 'deep_research',
        ok: true,
        draftText: '',
      },
    };
  }
  return { filled: true, agentResult: result };
}

async function fillPlacesGeneric(
  input: DeepFillInput,
  _missing: Set<string>,
  jobId: FindusJobId,
): Promise<DeepFillResult> {
  if (jobId === 'shopping_errand') {
    const { looksLikeMediaCatalogRequest, mediaCatalogSearchUrl } = await import(
      './jobAnalogy'
    );
    if (looksLikeMediaCatalogRequest(input.userText)) {
      const url = mediaCatalogSearchUrl(input.userText);
      return {
        filled: true,
        agentResult: {
          agent: 'deep_research',
          ok: true,
          draftText: '',
          buttons: [
            {
              id: 'media_catalog',
              label: shortenActionLabel('🎵 Playlist'),
              payload: { kind: 'deep_link', url },
            },
          ],
          meta: {
            ticket_or_info_url: true,
            silent: false,
          },
        },
      };
    }
  }
  const { searchPlacesByText } = await import(
    '../../services/navigation/googleMapsNav'
  );
  const query =
    jobId === 'parking_ev'
      ? 'Parkplatz Ladestation'
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
