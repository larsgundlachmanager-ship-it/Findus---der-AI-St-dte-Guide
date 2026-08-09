/**
 * Modul 2 Pipeline — LLM-Intent + Agenten + LLM-Synthese.
 */

import type { PipelineTask, PipelineTurnInput, PipelineTurnResult } from '../types';
import { readRucksackSync } from '../rucksack/rucksackStore';
import { isRucksackOffline, offlineLogicFallback } from '../safety/offlineGate';
import { rewriteQuery } from './queryRewriter';
import { routeIntentWithLlm } from './llmIntentRouter';
import { bridgingLineForIntent } from './taskSplitter';
import { runOrchestrator } from './orchestrator';
import { runLogicNode } from './logicNode';
import { synthesizeWithLlm } from './llmSynthesis';
import { synthesizeOutput } from './synthesis';
import { enqueueSpeech } from '../speech/speechQueue';
import { useFinnusStore } from '../../store/useFinnusStore';
import type { QuickAction } from '../../types/concierge';
import { clampVisualBullets } from '../../services/concierge/parseConciergeResponse';
import {
  noteUserUtterance,
  getShortTerm,
  setLastPlaceName,
  setLastTopic,
} from '../context/shortTermContext';
import {
  loadConversationThreads,
  routeConversationTopic,
  commitThreadTurn,
  threadPlaceHint,
  threadTopicHint,
  type TopicRouteDecision,
} from '../../services/memory/conversationThreads';

export async function runModule2Pipeline(
  input: PipelineTurnInput,
): Promise<PipelineTurnResult> {
  const turnId = input.turnId;
  const signal = input.signal;

  if (isRucksackOffline()) {
    const logic = offlineLogicFallback();
    const synthesis = synthesizeOutput(logic);
    presentToUi(synthesis.fullDraftForUi, synthesis.bullets, synthesis.buttons);
    enqueueSpeech({
      kind: 'main',
      text: synthesis.spokenChunks.join(' '),
      turnId,
    });
    return {
      turnId,
      tasks: [],
      bridgingText: null,
      logic,
      synthesis,
      deepResearchQueued: false,
    };
  }

  await loadConversationThreads();
  noteUserUtterance(input.userText);
  const short = getShortTerm();
  const placeFromThread = threadPlaceHint();
  const topicFromThread = threadTopicHint();

  const { rewritten } = rewriteQuery(input.userText, {
    lastPlaceName: placeFromThread || short.lastPlaceName,
    lastTopic: topicFromThread || short.lastTopic,
  });
  noteUserUtterance(rewritten);

  const rucksack = readRucksackSync();

  // Job-Contract sync (vor Router) — Bridge + Fast/Slow-Lane
  const {
    classifyJob,
    shouldPreferJobOverRouter,
    bridgeLineForJob,
    judgeJobCompleteness,
    pendingButtonsFromReport,
  } = await import('../jobs');
  const { shouldForceDeepFill, runJobDeepFill } = await import(
    '../jobs/jobDeepFill'
  );
  const jobClass = classifyJob(rewritten);

  // Topic früh (vor Bridge) — Follow-ups am selben Ort bekommen keine neue Bridge
  let topicDecision: TopicRouteDecision | null = null;
  try {
    topicDecision = routeConversationTopic({
      userText: rewritten,
      intent: jobClass.contract.agentIntent,
      subject: null,
      cityHint: short.lastMentionedCity,
    });
  } catch {
    topicDecision = null;
  }

  const { buildManagerTurn, shouldSuppressBridge } = await import(
    '../reboot/managerTurn'
  );
  let manager = buildManagerTurn({
    jobClass,
    topic: topicDecision,
    userText: rewritten,
    earlyBridgeLine: null,
  });

  // Sofort-Bridge BEVOR der LLM-Router denkt (kann 10–30 s dauern)
  let earlyBridgeSpoken = false;
  let earlyBridgeLine: string | null = null;
  const suppressEarlyBridge = shouldSuppressBridge({
    topicMode: topicDecision?.mode,
    jobId: jobClass.jobId,
    userText: rewritten,
  });
  try {
    const {
      speakLatencyFloskelFireAndForget,
      hadRecentLatencyAck,
      shouldSpeakLatencyFloskel,
    } = await import('../../services/speech/floskelEngine');
    if (!suppressEarlyBridge && shouldSpeakLatencyFloskel(rewritten)) {
      // Job-Bridge in derselben Speech-Queue (kein paralleles system-TTS,
      // das Main mitten in „circa …“ flushen kann)
      if (jobClass.confidence >= 0.5) {
        earlyBridgeLine = bridgeLineForJob(jobClass, rewritten).trim() || null;
        if (earlyBridgeLine) {
          enqueueSpeech({
            kind: 'bridging',
            text: earlyBridgeLine,
            turnId,
          });
          earlyBridgeSpoken = true;
        }
      }
      if (!earlyBridgeSpoken) {
        speakLatencyFloskelFireAndForget(rewritten);
        earlyBridgeSpoken = hadRecentLatencyAck(8_000);
      }
    }
  } catch {
    /* soft */
  }
  manager = buildManagerTurn({
    jobClass,
    topic: topicDecision,
    userText: rewritten,
    earlyBridgeLine,
  });

  // LLM versteht die Absicht — kein Regex-Primary; Pack-Stadt irrelevant
  let route = await routeIntentWithLlm({
    userText: rewritten,
    liveLocationLabel: rucksack.cityHint,
    lastCity: short.lastMentionedCity,
    signal,
  });

  // Launch-Jobs: Contract schlägt weichen Router
  if (shouldPreferJobOverRouter(jobClass)) {
    route = {
      ...route,
      intent: jobClass.contract.agentIntent,
      bridgingLine:
        earlyBridgeLine ||
        bridgeLineForJob(jobClass, rewritten) ||
        route.bridgingLine,
    };
  } else if (earlyBridgeLine) {
    route = { ...route, bridgingLine: earlyBridgeLine };
  }

  // Kino/Film → knowledge Just-Do-It (nie mobility→falscher See / nie leere Timeline)
  try {
    const { isCinemaMovieQuery } = await import(
      '../../services/research/cinemaShowtimeResearch'
    );
    if (isCinemaMovieQuery(rewritten)) {
      const cityGuess =
        rewritten.match(
          /\b(?:in|nach|bei)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,})/u,
        )?.[1] ?? route.city;
      route = {
        ...route,
        intent: 'knowledge',
        city: cityGuess || route.city,
        subject: route.subject || 'Kino',
        bridgingLine:
          route.bridgingLine ||
          bridgingLineForIntent('knowledge'),
      };
    }
  } catch {
    /* soft */
  }

  // Supermarkt-Prospekt / Angebote → knowledge Just-Do-It
  try {
    const { isSupermarketOfferQuery } = await import(
      '../../services/research/supermarketProspectResearch'
    );
    if (isSupermarketOfferQuery(rewritten)) {
      route = {
        ...route,
        intent: 'knowledge',
        subject: route.subject || 'Angebot',
        bridgingLine:
          earlyBridgeLine ||
          route.bridgingLine ||
          bridgingLineForIntent('knowledge'),
      };
    }
  } catch {
    /* soft */
  }

  // Spikeball / Sport-Aktivität → knowledge (Fit + Parken/Alternative)
  try {
    const { isActivitySportQuery } = await import(
      '../../services/research/activitySportResearch'
    );
    if (isActivitySportQuery(rewritten)) {
      route = {
        ...route,
        intent: 'knowledge',
        subject: route.subject || 'Aktivität',
        bridgingLine:
          earlyBridgeLine ||
          route.bridgingLine ||
          bridgingLineForIntent('knowledge'),
      };
    }
  } catch {
    /* soft */
  }

  // Wanderweg / Fahrradweg → knowledge Just-Do-It (Vorschlag + Nav zum Einstieg)
  try {
    const { isTrailPathQuery, detectTrailPathKind } = await import(
      '../../services/research/trailPathResearch'
    );
    if (isTrailPathQuery(rewritten)) {
      const kind = detectTrailPathKind(rewritten);
      const cityGuess =
        rewritten.match(
          /\b(?:in|nach|bei)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,})/u,
        )?.[1] ?? route.city;
      route = {
        ...route,
        intent: 'knowledge',
        city: cityGuess || route.city,
        subject:
          route.subject ||
          (kind === 'bike' ? 'Fahrradweg' : 'Wanderweg'),
        bridgingLine:
          route.bridgingLine ||
          bridgingLineForIntent('knowledge'),
      };
    }
  } catch {
    /* soft */
  }

  // Speisekarten-Advisor → immer gastro (nicht knowledge/Stadtplan)
  try {
    const { detectMenuAdvisorIntent } = await import(
      '../../services/research/menuTranslateService'
    );
    if (
      detectMenuAdvisorIntent(
        rewritten,
        Boolean(short.lastPlaceName || short.lastMenuUrl),
      )
    ) {
      route = {
        ...route,
        intent: 'gastro',
        subject: short.lastPlaceName || route.subject,
        bridgingLine:
          route.bridgingLine ||
          bridgingLineForIntent('gastro'),
      };
    }
  } catch {
    /* soft */
  }

  // Compound: Essen + Erkunden / Sunset+Dinner → knowledge (kein Planungs-Engine)
  const wantsExplore =
    /\b(stadt\s*erkunden|erkunden|bummel|sehenswürdig|sightseeing|tagesplan|tour\s+machen|was\s+kann\s+man)\b/i.test(
      rewritten,
    );
  const wantsMeal =
    /frühstück|fruehstueck|essen|hunger|restaurant|brunch|leckeres/i.test(
      rewritten,
    );
  const wantsSunset = /\b(sonnenuntergang|sunset)\b/i.test(rewritten);
  const wantsEveningPlan =
    wantsSunset && wantsMeal ||
    (wantsExplore && wantsMeal) ||
    (wantsSunset && wantsExplore);
  if (
    wantsEveningPlan &&
    !/mehr\s+zur\s+(geschichte|historie)|erzähl\s+mir\s+mehr|was\s+du\s+noch\s+nicht\s+gesagt/i.test(
      rewritten,
    ) &&
    (route.intent === 'gastro' ||
      route.intent === 'knowledge' ||
      route.intent === 'smalltalk' ||
      route.intent === 'planning')
  ) {
    route = {
      ...route,
      intent: 'knowledge',
      bridgingLine:
        route.bridgingLine ||
        bridgingLineForIntent('knowledge'),
    };
  }

  // Tischreservierung / Restaurant-Anruf ≠ Hotel-Booking (Stay22-Fehlleitung)
  const restaurantReserveOrCall =
    (/\b(tisch|reservier|speisekarte)\b/i.test(rewritten) ||
      (/\b(anrufen|telefon)\b/i.test(rewritten) &&
        /\b(restaurant|burger|pizza|café|cafe|tisch|essen|wirt)\b/i.test(
          rewritten,
        ))) &&
    !/\b(hotel|zimmer|übernacht|uebernacht|ferienwohnung|unterkunft)\b/i.test(
      rewritten,
    );
  if (route.intent === 'booking' && restaurantReserveOrCall) {
    route = {
      ...route,
      intent: 'gastro',
      bridgingLine:
        route.bridgingLine || bridgingLineForIntent('gastro'),
    };
  }
  // Essen/Burger klar → gastro — aber NICHT wenn Multi-Stop-Abendplan
  if (
    (route.intent === 'booking' || route.intent === 'planning') &&
    /\b(burger|pizza|restaurant|frühstück|fruehstueck|abendessen|hunger)\b/i.test(
      rewritten,
    ) &&
    !wantsEveningPlan &&
    !/\b(ganzen tag|tagesplan|sonnenuntergang|sunset|erkunden|plan)\b/i.test(
      rewritten,
    )
  ) {
    route = {
      ...route,
      intent: 'gastro',
      bridgingLine:
        route.bridgingLine || bridgingLineForIntent('gastro'),
    };
  }

  // Hotelzimmer / Übernachtung klar → booking (auch wenn „reservier“ vorkommt)
  if (
    route.intent === 'gastro' &&
    /\b(hotel|zimmer|übernacht|uebernacht|ferienwohnung|unterkunft)\b/i.test(
      rewritten,
    ) &&
    !/\b(restaurant|burger|pizza|tisch\s+im\s+restaurant)\b/i.test(rewritten)
  ) {
    route = {
      ...route,
      intent: 'booking',
      bridgingLine:
        route.bridgingLine || bridgingLineForIntent('booking'),
    };
  }

  // Follow-up „kann ich da anrufen?“ nach Gastro → gastro (lastPlaceName)
  if (
    /\b(anrufen|telefonnummer|tisch\s+reserv|reservier)\b/i.test(rewritten) &&
    short.lastPlaceName &&
    route.intent !== 'emergency' &&
    route.intent !== 'booking' &&
    !/\b(hotel|zimmer|übernacht|uebernacht)\b/i.test(rewritten)
  ) {
    const looksHotelCall =
      /\b(hotel|rezeption|zimmer)\b/i.test(rewritten) ||
      /\bhotel\b/i.test(short.lastPlaceName);
    if (!looksHotelCall) {
      route = {
        ...route,
        intent: 'gastro',
        subject: route.subject || short.lastPlaceName,
        bridgingLine:
          route.bridgingLine || bridgingLineForIntent('gastro'),
      };
    }
  }

  // Live-Plan-Edits / Bezug auf bestehende Timeline → knowledge (UI-Kalender)
  let looksLikePlanEdit =
    /\b(lösch|loesch|entferne|streich|verschieb|hinzufüg|hinzufueg|ergänz|ergaenz|fortbewegung|verkehrsmittel)\b/i.test(
      rewritten,
    ) ||
    (/\b(umstell|wechsel)\b/i.test(rewritten) &&
      /\b(fahrrad|zu\s*fu[ßs]|bus|bahn|öpnv|auto|taxi)\b/i.test(rewritten)) ||
    (/\b(termin|stopp|eintrag|punkt)\b/i.test(rewritten) &&
      /\b(später|spaeter|früher|frueher|verschieb|lösch|loesch|eingetragen|im\s+plan)\b/i.test(
        rewritten,
      )) ||
    /\b(eingetragen|schon\s+drin|im\s+plan|in\s+der\s+timeline)\b/i.test(
      rewritten,
    );
  if (!looksLikePlanEdit) {
    try {
      const {
        utteranceLikelyRefersToExistingPlan,
      } = require('../timeline/planStopResolve') as {
        utteranceLikelyRefersToExistingPlan: (t: string) => boolean;
      };
      looksLikePlanEdit = utteranceLikelyRefersToExistingPlan(rewritten);
    } catch {
      /* soft */
    }
  }
  if (looksLikePlanEdit && route.intent !== 'emergency') {
    route = {
      ...route,
      intent: 'knowledge',
      bridgingLine:
        route.bridgingLine || bridgingLineForIntent('knowledge'),
    };
  }

  // Legacy planning intent → knowledge
  if (route.intent === 'planning') {
    route = {
      ...route,
      intent: 'knowledge',
      bridgingLine:
        route.bridgingLine || bridgingLineForIntent('knowledge'),
    };
  }

  if (route.city) {
    noteUserUtterance(`in ${route.city}`);
  }

  const task: PipelineTask = {
    id: `task_0_${route.intent}`,
    rawText: input.userText,
    rewrittenText: rewritten,
    intent: route.intent,
    priority: route.intent === 'emergency' ? 0 : 1,
    subject: route.subject,
    // null = „hier“ / GPS — nie Pack-Stadt einsetzen
    city: route.city ?? short.lastMentionedCity,
    jobId: jobClass.jobId,
    commitment: jobClass.commitment,
    mustHaves: jobClass.mustHaves,
  };

  // Sticky Subject aus Thread (kein zweiter Topic-Route — vermeidet Doppel-Threads)
  try {
    if (
      topicDecision &&
      (topicDecision.mode === 'resume' || topicDecision.mode === 'continue')
    ) {
      const place =
        topicDecision.thread.entities.subject ||
        topicDecision.thread.entities.place ||
        topicDecision.thread.entities.destination ||
        null;
      if (place && !route.subject) {
        route = { ...route, subject: place };
        task.subject = place;
      }
    }
  } catch {
    /* keep early topicDecision */
  }

  manager = buildManagerTurn({
    jobClass,
    topic: topicDecision,
    userText: rewritten,
    earlyBridgeLine,
  });

  const bridgingText = manager.bridgeOneLiner || '';
  // Schnelle Nav-Starts: kein Bridging — sonst doppelt / verzögert
  // Ausnahme: Kino/Film — „führ mich“ darf Bridge nicht killen
  const isCinemaNav =
    jobClass.jobId === 'tonight_live' ||
    /\b(kino|cinema|filmtheater|vorstellung|kinoprogramm)\b/i.test(rewritten) ||
    (/\bfilm\b/i.test(rewritten) &&
      /\b(schauen|laufen|ticket|kino)\b/i.test(rewritten));
  const skipBridge =
    earlyBridgeSpoken ||
    !bridgingText.trim() ||
    shouldSuppressBridge({
      topicMode: topicDecision?.mode,
      jobId: jobClass.jobId,
      userText: rewritten,
    }) ||
    ((route.intent === 'mobility' ||
      /\b(navigier|route\s+starten|führ\s+mich|fuehr\s+mich|bring\s+mich\s+zu)\b/i.test(
        rewritten,
      )) &&
      !isCinemaNav);
  if (!skipBridge && bridgingText.trim()) {
    enqueueSpeech({ kind: 'bridging', text: bridgingText, turnId });
  }

  // Kombi: Sekundär-Jobs parallel (z. B. Nightlife + Outfit)
  const { getJobContract } = await import('../jobs/contracts');
  const secondaryTasks = jobClass.secondaryJobIds.slice(0, 2).map((jid, i) => {
    const c = getJobContract(jid);
    return {
      id: `task_sec_${i}_${jid}`,
      rawText: input.userText,
      rewrittenText: rewritten,
      intent: c.agentIntent,
      priority: 2 + i,
      subject: route.subject,
      city: task.city,
      jobId: jid,
      commitment: jobClass.commitment,
      mustHaves: jobClass.mustHaves,
    };
  });

  const { fastResults, deepPromise } = await runOrchestrator({
    tasks: [task, ...secondaryTasks],
    rucksack,
    signal,
  });

  if (signal?.aborted) {
    return {
      turnId,
      tasks: [task],
      bridgingText,
      logic: {
        spokenDraft: '',
        bullets: [],
        buttons: [],
        moneyEur: [],
        warnings: ['aborted'],
      },
      synthesis: {
        spokenChunks: [],
        bullets: [],
        buttons: [],
        fullDraftForUi: '',
      },
      deepResearchQueued: false,
    };
  }

  const logic = runLogicNode({
    results: fastResults,
    futurePlan: rucksack.futurePlan,
  });

  const emergencyBypass = fastResults.some(
    (r) => r.meta?.bypass === true && r.meta?.emergencyHandled,
  );
  const cinemaBypass = fastResults.some((r) => r.meta?.cinema === true);
  const prospectBypass = fastResults.some(
    (r) => r.meta?.supermarketProspect === true,
  );

  // Notfall / Kino / Prospekt: deterministische Fakten behalten — kein LLM-Weichspüler
  const synthesis =
    emergencyBypass || cinemaBypass || prospectBypass
      ? synthesizeOutput(logic)
      : await synthesizeWithLlm({
          userText: rewritten,
          logic,
          intent: route.intent,
          subject: route.subject,
          city: task.city,
          bridgingText,
          topicMode: topicDecision?.mode ?? null,
          speechBudgetChars: jobClass.contract.speechBudgetChars,
          jobId: jobClass.jobId,
          mustHaves: jobClass.mustHaves,
          commitment: jobClass.commitment,
          signal,
        });

  const primaryMeta =
    fastResults.find((r) => r.ok && r.meta)?.meta ??
    fastResults.find((r) => r.ok)?.meta ??
    null;
  const completeness = judgeJobCompleteness({
    classification: jobClass,
    speech: synthesis.fullDraftForUi,
    bullets: synthesis.bullets,
    buttons: synthesis.buttons,
    meta: primaryMeta,
    logic,
  });
  const pendingBtns = completeness.pendingActionHints.length
    ? pendingButtonsFromReport(completeness)
    : [];
  const uiButtons =
    pendingBtns.length > 0
      ? [...synthesis.buttons, ...pendingBtns].slice(0, 4)
      : synthesis.buttons;

  presentToUi(
    synthesis.fullDraftForUi,
    synthesis.bullets,
    uiButtons,
    rewritten,
  );

  enqueueSpeech({
    kind: 'main',
    text: synthesis.spokenChunks.join(' '),
    turnId,
  });

  setLastTopic(topicDecision?.thread.label ?? rewritten.slice(0, 80));
  if (route.subject) setLastPlaceName(route.subject);
  try {
    commitThreadTurn({
      userText: rewritten,
      assistantSpeech: synthesis.fullDraftForUi,
      intent: route.intent,
      subject: route.subject,
      cityHint: task.city,
      saidFactLines: [
        ...synthesis.bullets,
        ...(typeof primaryMeta?.destName === 'string'
          ? [primaryMeta.destName]
          : []),
      ],
    });
  } catch {
    /* soft */
  }

  let deepResearchQueued = false;
  let deepFollow = deepPromise;

  // Completeness erzwingt Nachrecherche (alle 22 Jobs)
  if (!deepFollow && shouldForceDeepFill(completeness)) {
    const { anchorCoords } = await import('../rucksack/rucksackStore');
    const a = anchorCoords(rucksack);
    deepFollow = runJobDeepFill({
      classification: jobClass,
      report: completeness,
      userText: rewritten,
      rucksack,
      alreadySaid: synthesis.fullDraftForUi,
      city: task.city,
      lat: a.lat,
      lng: a.lng,
      meta: primaryMeta,
      signal,
    }).then((r) => r.agentResult);
  }

  // Gastro Fast-Lane → Speisekarte/Preise parallel nachladen (Schweigen wenn nichts Neues)
  if (!deepFollow && route.intent === 'gastro') {
    const gastro = fastResults.find((r) => r.agent === 'gastro' && r.ok);
    const menuAdvisor = Boolean(
      (gastro?.meta as { menuAdvisor?: boolean } | undefined)?.menuAdvisor,
    );
    const venues = (gastro?.meta as { venues?: Array<{
      name: string;
      websiteUrl?: string | null;
      menuUrl?: string | null;
    }> } | undefined)?.venues;
    // Speisekarten-Advisor hat Gerichte schon — kein Nearby-Deep-Nachschub
    if (venues?.length && !menuAdvisor) {
      const { runGastroMenuDeepResearch } = await import(
        '../agents/gastroMenuDeepResearch'
      );
      deepFollow = runGastroMenuDeepResearch({
        userText: rewritten,
        venues,
        alreadySaid: synthesis.fullDraftForUi,
        signal,
      });
    }
  }

  // Hotels / Museen → Maps-Pitch Deep (Reviews + Flair; Hotel: Stay22 nachschärfen)
  if (
    !deepFollow &&
    (route.intent === 'booking' || route.intent === 'knowledge')
  ) {
    const hit = fastResults.find(
      (r) =>
        r.ok && (r.agent === 'booking' || r.agent === 'knowledge'),
    );
    const meta = hit?.meta as
      | {
          mapsPitch?: boolean;
          pitchKind?: string;
          city?: string;
          checkin?: string;
          checkout?: string;
          adults?: number;
          deferTickets?: boolean;
          hasTicketBtn?: boolean;
          subject?: string;
          cinema?: boolean;
          deferCinemaLinks?: boolean;
          cinemaUserText?: string;
          cinemaLat?: number;
          cinemaLng?: number;
          venues?: Array<{
            name: string;
            placeId?: string | null;
            lat?: number | null;
            lng?: number | null;
            websiteUrl?: string | null;
            stay?: unknown;
            role?: string;
            bookUrl?: string | null;
          }>;
        }
      | undefined;
    if (meta?.venues?.length && meta.mapsPitch) {
      const { runMapsPitchDeepResearch } = await import(
        '../agents/mapsPitchDeepResearch'
      );
      const { anchorCoords } = await import('../rucksack/rucksackStore');
      deepFollow = runMapsPitchDeepResearch({
        userText: rewritten,
        kind: (meta.pitchKind as 'hotel' | 'museum' | 'attraction' | 'restaurant' | 'generic') ||
          (route.intent === 'booking' ? 'hotel' : 'museum'),
        city: meta.city ?? task.city,
        venues: meta.venues.map((v) => ({
          name: v.name,
          placeId: v.placeId,
          lat: v.lat,
          lng: v.lng,
          websiteUrl: v.websiteUrl,
          stay: v.stay as import('../../services/concierge/hotelAvailabilityService').HotelLiveStay | null,
          role: v.role as 'günstigste' | 'qualität' | 'empfehlung' | undefined,
          bookUrl: v.bookUrl,
        })),
        alreadySaid: synthesis.fullDraftForUi,
        anchor: anchorCoords(rucksack),
        checkin: meta.checkin,
        checkout: meta.checkout,
        adults: meta.adults,
        signal,
      });
    }

    // Sight/Turm/Kirche: Ticket-Button still nachreichen (Ziel ~30 s), ohne Extra-Speech
    if (
      route.intent === 'knowledge' &&
      meta?.deferTickets &&
      !meta.hasTicketBtn
    ) {
      const subjectName =
        meta.subject ||
        meta.venues?.[0]?.name ||
        route.subject ||
        'Ort';
      const cityName = meta.city ?? task.city ?? null;
      const websiteUrl = meta.venues?.[0]?.websiteUrl ?? null;
      const cardIdAtSpeak =
        useFinnusStore.getState().activeConciergeCard?.id ?? null;
      void (async () => {
        try {
          // Kurz warten: Speech + UI stehen, dann Ticket-Recherche
          await new Promise((r) => setTimeout(r, 8_000));
          if (signal?.aborted) return;
          const { discoverVenueOffers } = await import(
            '../../services/research/venueOfferDiscovery'
          );
          const offers = await discoverVenueOffers({
            subject: subjectName,
            city: cityName,
            userText: `${rewritten} Tickets Eintritt Aussicht`,
            websiteUrl,
            signal,
          });
          if (!offers?.buttons?.length) return;
          const ticketBtns = offers.buttons.filter(
            (b) =>
              b.payload.kind === 'deep_link' &&
              /ticket|🎟️|🎫|eintritt|touren buchen/i.test(b.label),
          );
          const toMerge = (ticketBtns.length ? ticketBtns : offers.buttons)
            .filter((b) => b.payload.kind === 'deep_link')
            .slice(0, 2);
          if (!toMerge.length) return;

          const card = useFinnusStore.getState().activeConciergeCard;
          if (!card) return;
          // Nur mergen wenn noch dieselbe Antwort-Karte (oder keine ID-Match möglich)
          if (cardIdAtSpeak && card.id !== cardIdAtSpeak) return;
          const existing = card.quickActions ?? [];
          if (
            existing.some(
              (a) =>
                a.type === 'OPEN_URL' &&
                /ticket|🎟️|🎫|eintritt/i.test(a.label ?? ''),
            )
          ) {
            return;
          }
          const merged = [...existing];
          for (const b of toMerge) {
            const url =
              b.payload.kind === 'deep_link'
                ? String(b.payload.url ?? '')
                : '';
            if (!url) continue;
            if (
              merged.some(
                (a) =>
                  a.type === 'OPEN_URL' &&
                  String(a.payload?.url ?? '') === url,
              )
            ) {
              continue;
            }
            merged.push({
              type: 'OPEN_URL',
              label: b.label,
              payload: { url },
            });
          }
          useFinnusStore.getState().setActiveConciergeCard({
            ...card,
            quickActions: merged.slice(0, 4),
          });
        } catch {
          /* soft */
        }
      })();
    }

    // Kino: Spielzeiten/Ticket-Links nachreichen (ohne Extra-Speech)
    if (meta?.cinema && meta.deferCinemaLinks) {
      const cardIdAtSpeak =
        useFinnusStore.getState().activeConciergeCard?.id ?? null;
      const cinemaText = meta.cinemaUserText || rewritten;
      const lat =
        typeof meta.cinemaLat === 'number' ? meta.cinemaLat : null;
      const lng =
        typeof meta.cinemaLng === 'number' ? meta.cinemaLng : null;
      void (async () => {
        try {
          if (lat == null || lng == null) return;
          const { researchCinemaAndShowtimes } = await import(
            '../../services/research/cinemaShowtimeResearch'
          );
          const full = await researchCinemaAndShowtimes({
            userText: cinemaText,
            lat,
            lng,
            signal,
            venuesOnly: false,
            showtimeBudgetMs: 25_000,
          });
          if (signal?.aborted) return;
          const toMerge = full.deferredButtons
            .filter((b) => b.payload.kind === 'deep_link')
            .slice(0, 2);
          if (!toMerge.length) return;
          const card = useFinnusStore.getState().activeConciergeCard;
          if (!card) return;
          if (cardIdAtSpeak && card.id !== cardIdAtSpeak) return;
          const existing = card.quickActions ?? [];
          const merged = [...existing];
          for (const b of toMerge) {
            const url =
              b.payload.kind === 'deep_link'
                ? String(b.payload.url ?? '')
                : '';
            if (!url) continue;
            if (
              merged.some(
                (a) =>
                  a.type === 'OPEN_URL' &&
                  String(a.payload?.url ?? '') === url,
              )
            ) {
              continue;
            }
            merged.push({
              type: 'OPEN_URL',
              label: b.label,
              payload: { url },
            });
          }
          const bullets = [...(card.visualBullets ?? [])];
          for (const s of full.showtimes.slice(0, 2)) {
            const line = `${s.cinemaName}: ${s.whenLabel}`;
            if (!bullets.includes(line) && bullets.length < 3) {
              bullets.push(line);
            }
          }
          useFinnusStore.getState().setActiveConciergeCard({
            ...card,
            visualBullets: bullets.slice(0, 3),
            quickActions: merged.slice(0, 4),
          });
        } catch {
          /* soft */
        }
      })();
    }

    // Supermarkt: Prospekt-Angebote nachreichen
    const metaRec = (meta ?? {}) as Record<string, unknown>;
    if (metaRec.supermarketProspect && metaRec.deferProspectOffers) {
      const cardIdAtSpeak =
        useFinnusStore.getState().activeConciergeCard?.id ?? null;
      const prospectText = metaRec.prospectUserText || rewritten;
      const lat =
        typeof metaRec.prospectLat === 'number' ? metaRec.prospectLat : null;
      const lng =
        typeof metaRec.prospectLng === 'number' ? metaRec.prospectLng : null;
      void (async () => {
        try {
          if (lat == null || lng == null) return;
          const { researchSupermarketProspect } = await import(
            '../../services/research/supermarketProspectResearch'
          );
          const full = await researchSupermarketProspect({
            userText: String(prospectText),
            lat,
            lng,
            signal,
            offerBudgetMs: 28_000,
          });
          if (signal?.aborted) return;
          const card = useFinnusStore.getState().activeConciergeCard;
          if (!card) return;
          if (cardIdAtSpeak && card.id !== cardIdAtSpeak) return;
          const existing = card.quickActions ?? [];
          const merged = [...existing];
          for (const b of full.buttons) {
            if (b.payload.kind !== 'deep_link') continue;
            const url = String(b.payload.url ?? '');
            if (!url) continue;
            if (
              merged.some(
                (a) =>
                  a.type === 'OPEN_URL' &&
                  String(a.payload?.url ?? '') === url,
              )
            ) {
              continue;
            }
            merged.push({
              type: 'OPEN_URL',
              label: b.label,
              payload: { url },
            });
          }
          const bullets = [...(card.visualBullets ?? [])];
          for (const o of full.offers.slice(0, 3)) {
            const line = `${o.productLabel}${
              o.priceLabel ? ` · ${o.priceLabel}` : ''
            }`;
            if (!bullets.includes(line) && bullets.length < 3) {
              bullets.push(line);
            }
          }
          useFinnusStore.getState().setActiveConciergeCard({
            ...card,
            visualBullets: bullets.slice(0, 3),
            quickActions: merged.slice(0, 4),
          });
        } catch {
          /* soft */
        }
      })();
    }
  }

  if (deepFollow) {
    deepResearchQueued = true;
    void deepFollow.then(async (deep) => {
      if (signal?.aborted || !deep.ok) return;
      const silent = Boolean(
        (deep.meta as { silent?: boolean } | undefined)?.silent,
      );
      const text = (deep.draftText ?? '').trim();
      const deepButtons = deep.buttons ?? [];

      // Nur Buttons (z. B. 2. Speisekarte) — ohne Extra-Speech mergen
      if ((silent || !text) && deepButtons.length) {
        try {
          const card = useFinnusStore.getState().activeConciergeCard;
          if (card) {
            const existing = card.quickActions ?? [];
            const merged = [...existing];
            for (const b of deepButtons) {
              const url =
                b.payload && 'url' in b.payload
                  ? String((b.payload as { url?: string }).url ?? '')
                  : '';
              if (
                url &&
                merged.some(
                  (a) =>
                    a.type === 'OPEN_URL' &&
                    String(a.payload?.url ?? '') === url,
                )
              ) {
                continue;
              }
              merged.push({
                type: 'OPEN_URL',
                label: b.label,
                payload: { url: url || undefined, textPrompt: b.label },
              } as QuickAction);
            }
            useFinnusStore.getState().setActiveConciergeCard({
              ...card,
              quickActions: merged.slice(0, 4),
            });
          }
        } catch {
          /* soft */
        }
        return;
      }
      if (silent || !text) return;

      // Deep-Research-Fakten noch einmal menschlich kurz machen
      let spoken =
        typeof (deep.meta as { spokenExtra?: string } | undefined)?.spokenExtra ===
        'string'
          ? String(
              (deep.meta as { spokenExtra?: string }).spokenExtra,
            ).trim() || text
          : text;
      try {
        const { synthesizeWithLlm } = await import('./llmSynthesis');
        const syn = await synthesizeWithLlm({
          userText: rewritten,
          logic: {
            spokenDraft: text,
            bullets: deep.bullets ?? [],
            buttons: deep.buttons ?? [],
            moneyEur: [],
            warnings: [],
          },
          intent: 'gastro',
          subject: route.subject,
          city: task.city,
          bridgingText: null,
          signal,
        });
        spoken = syn.fullDraftForUi.trim() || text;
        if (syn.buttons?.length) {
          presentToUi(spoken, syn.bullets, syn.buttons);
        }
      } catch {
        /* Roh-Fakten humanisieren */
      }
      try {
        const { humanizeAgentDraft } = await import(
          '../speech/draftToHumanSpeech'
        );
        spoken = humanizeAgentDraft(spoken, { maxChars: 900 }) || spoken;
      } catch {
        /* soft */
      }
      if (!spoken.trim()) return;
      enqueueSpeech({
        kind: 'deep_research',
        text: spoken,
        turnId,
      });
    });
  }

  return {
    turnId,
    tasks: [task],
    bridgingText,
    logic: { ...logic, spokenDraft: synthesis.fullDraftForUi },
    synthesis: { ...synthesis, buttons: uiButtons },
    deepResearchQueued,
    jobId: jobClass.jobId,
    jobCompletenessOk: completeness.ok,
  };
}

function presentToUi(
  speech: string,
  bullets: string[],
  buttons: { id: string; label: string; payload: unknown }[],
  userText?: string,
): void {
  try {
    const store = useFinnusStore.getState();
    store.addChatMessage({ role: 'assistant', content: speech });
    const quickActions: QuickAction[] = buttons.map((b) => {
      const p = b.payload as {
        kind: string;
        url?: string;
        phone?: string;
        lat?: number;
        lng?: number;
        label?: string;
        destName?: string;
        action?: string;
        data?: {
          city?: string;
          topic?: string;
          dest?: string;
          destination?: string;
          url?: string;
          checkin?: string;
          checkout?: string;
          adults?: number;
          dateIso?: string;
          destName?: string;
          wakeMode?: 'replace' | 'add';
          replaceWakeAtMs?: number;
          /** Venue-offer follow-up */
          prompt?: string;
          offerTitle?: string;
          whenLabel?: string;
          summary?: string;
          infoUrl?: string;
          ticketUrl?: string;
        };
      };
      if (p.kind === 'deep_link' && p.url) {
        const isPending = /findus\.local\/pending/i.test(p.url);
        return {
          type: 'OPEN_URL',
          label: b.label,
          pending: isPending || undefined,
          payload: {
            url: isPending ? 'https://findus.local/pending' : p.url,
            destName: p.destName?.trim() || undefined,
          },
        };
      }
      if (p.kind === 'dial' && p.phone) {
        return {
          type: 'DIAL_PHONE',
          label: b.label || '📞 Anrufen',
          payload: { phoneNumber: p.phone },
        };
      }
      if (p.kind === 'navigate' && p.lat != null && p.lng != null) {
        const navP = p as {
          kind: string;
          lat: number;
          lng: number;
          label?: string;
          keepCard?: boolean;
          skipClosingGate?: boolean;
          preferBike?: boolean;
        };
        return {
          type: 'START_NAVIGATION',
          label: b.label,
          payload: {
            destLat: navP.lat,
            destLng: navP.lng,
            destName: navP.label ?? 'Ziel',
            ...(navP.keepCard === true ? { keepCard: true } : {}),
            ...(navP.skipClosingGate === true
              ? { skipClosingGate: true }
              : {}),
            ...(navP.preferBike === true ? { preferBike: true } : {}),
          },
        };
      }
      const action = String(p.action ?? b.id);
      const data = p.data ?? {};
      if (action === 'book_stay22' || action === 'BOOK_STAY22') {
        return {
          type: 'BOOK_STAY22',
          label: b.label,
          payload: {
            url: data.url ?? p.url,
            destination: data.destination ?? data.city ?? data.dest,
          },
        };
      }
      if (action === 'book_bounce' || action === 'BOOK_BOUNCE_LUGGAGE') {
        return {
          type: 'BOOK_BOUNCE_LUGGAGE',
          label: b.label,
          payload: { url: data.url ?? p.url },
        };
      }
      if (action === 'set_wake_alarm' || action === 'SET_WAKE_ALARM') {
        const wm = data.wakeMode;
        return {
          type: 'SET_WAKE_ALARM',
          label: b.label,
          payload: {
            dateIso: data.dateIso,
            destName: data.destName ?? data.destination,
            wakeMode: wm === 'replace' || wm === 'add' ? wm : undefined,
            replaceWakeAtMs:
              typeof data.replaceWakeAtMs === 'number'
                ? data.replaceWakeAtMs
                : undefined,
          },
        };
      }
      if (action === 'open_settings') {
        return {
          type: 'SHOW_MORE',
          label: b.label,
          payload: { textPrompt: '__OPEN_APP_SETTINGS__' },
        };
      }
      if (action === 'set_voice') {
        const voiceName = String(
          (data as { name?: string; voiceId?: string })?.name ??
            (data as { voiceId?: string })?.voiceId ??
            '',
        ).trim();
        return {
          type: 'SHOW_MORE',
          label: b.label,
          payload: {
            textPrompt: voiceName
              ? `Stimme von ${voiceName}`
              : 'Stimme ändern',
          },
        };
      }
      if (action === 'show_future_plan') {
        try {
          const { requestOpenPlanCalendar } = require('../timeline/planCalendarUiStore') as {
            requestOpenPlanCalendar: () => void;
          };
          requestOpenPlanCalendar();
        } catch {
          /* soft */
        }
        return {
          type: 'SHOW_MORE',
          label: b.label,
          payload: { textPrompt: 'Zeig mir meinen Tagesplan' },
        };
      }
      if (action === 'plan_confirm') {
        return {
          type: 'SHOW_MORE',
          label: b.label,
          payload: { textPrompt: 'Plan bestätigen und übernehmen' },
        };
      }
      if (action === 'plan_reject') {
        return {
          type: 'SHOW_MORE',
          label: b.label,
          payload: { textPrompt: 'Vorschlag ablehnen — andere Optionen bitte' },
        };
      }
      if (action === 'plan_accept') {
        return {
          type: 'SHOW_MORE',
          label: b.label,
          payload: { textPrompt: 'Vorschlag bestätigen' },
        };
      }
      if (action === 'start_journey_nav') {
        try {
          const { takeRememberedJourney } = require('../../services/navigation/journeyStartCache') as {
            takeRememberedJourney: () => {
              itinerary: import('../../services/transit/journeyPlanner').JourneyItinerary;
              destName: string;
              destLat: number;
              destLng: number;
            } | null;
          };
          const { startJourneyNavigation } = require('../../services/navigation/startJourneyNavigation') as {
            startJourneyNavigation: (o: {
              itinerary: import('../../services/transit/journeyPlanner').JourneyItinerary;
              destName: string;
              destLat: number;
              destLng: number;
            }) => Promise<{ ok: boolean; reply: string }>;
          };
          const remembered = takeRememberedJourney();
          if (remembered) {
            void startJourneyNavigation(remembered).then(() => {
              try {
                const { requestClosePlanCalendar } = require('../timeline/planCalendarUiStore') as {
                  requestClosePlanCalendar: () => void;
                };
                requestClosePlanCalendar();
              } catch {
                /* soft */
              }
            });
          }
        } catch {
          /* soft */
        }
        const destHint =
          typeof data === 'object' && data && 'dest' in data
            ? String((data as { dest?: string }).dest ?? '')
            : '';
        return {
          type: 'SHOW_MORE',
          label: b.label,
          payload: {
            textPrompt: destHint
              ? `Starte die ÖPNV-Navigation nach ${destHint}`
              : 'Starte die ÖPNV-Navigation',
          },
        };
      }
      if (action === 'set_dining_leave_mode') {
        try {
          const { switchDiningLeaveMode } = require('../timeline/planMealDeparture') as {
            switchDiningLeaveMode: (o: {
              stopId: string;
              transport: 'walk' | 'bike' | 'transit' | 'car' | 'taxi' | 'flight' | 'unknown';
              venueTitle: string;
              destLat: number;
              destLng: number;
              appointmentMs: number;
            }) => boolean;
          };
          const d = data as Record<string, unknown>;
          const transport = String(d.transport ?? 'walk') as
            | 'walk'
            | 'bike'
            | 'transit';
          switchDiningLeaveMode({
            stopId: String(d.stopId ?? ''),
            transport,
            venueTitle: String(d.venueTitle ?? 'Restaurant'),
            destLat: Number(d.destLat),
            destLng: Number(d.destLng),
            appointmentMs: Number(d.appointmentMs),
          });
        } catch {
          /* soft */
        }
        return {
          type: 'SHOW_MORE',
          label: b.label,
          payload: { textPrompt: `Abfahrt ${b.label}` },
        };
      }
      if (action === 'plan_pick' || action === 'plan_advance') {
        try {
          const ui = require('../timeline/planCalendarUiStore') as {
            requestOpenPlanCalendar: () => void;
            usePlanCalendarUiStore: {
              getState: () => {
                pendingChoice: {
                  options: { id: string; title: string }[];
                } | null;
                setShortAnswers: (
                  a: {
                    id: string;
                    label: string;
                    action:
                      | 'plan_pick'
                      | 'plan_advance'
                      | 'plan_confirm'
                      | 'plan_accept'
                      | 'plan_reject'
                      | 'prompt';
                    pick?: string;
                    prompt?: string;
                  }[],
                ) => void;
              };
            };
          };
          ui.requestOpenPlanCalendar();
          const pick =
            typeof data === 'object' && data && 'pick' in data
              ? String((data as { pick?: string }).pick ?? '')
              : '';
          const destName =
            typeof data === 'object' && data && 'destName' in data
              ? String((data as { destName?: string }).destName ?? '')
              : '';
          if (action === 'plan_pick') {
            ui.usePlanCalendarUiStore.getState().setShortAnswers([
              {
                id: b.id,
                label: b.label,
                action: 'plan_pick',
                pick: pick || undefined,
                prompt: destName || pick || undefined,
              },
            ]);
          }
        } catch {
          /* soft */
        }
      }
      const pickDest =
        action === 'plan_pick'
          ? (() => {
              const dest =
                (data && typeof data === 'object' && 'destName' in data
                  ? String((data as { destName?: string }).destName ?? '')
                  : '') ||
                (data && typeof data === 'object' && 'pick' in data
                  ? String((data as { pick?: string }).pick ?? '')
                  : '') ||
                '';
              if (dest) return `Ich wähle ${dest}`;
              // Fallback: pending choice by pick id
              try {
                const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
                  usePlanCalendarUiStore: {
                    getState: () => {
                      pendingChoice: {
                        options: { id: string; title: string }[];
                      } | null;
                    };
                  };
                };
                const pending = usePlanCalendarUiStore.getState().pendingChoice;
                const pickId =
                  data && typeof data === 'object' && 'pick' in data
                    ? String((data as { pick?: string }).pick ?? '')
                    : '';
                const opt = pending?.options.find((o) => o.id === pickId);
                if (opt) return `Ich wähle ${opt.title}`;
              } catch {
                /* soft */
              }
              return 'Ich wähle die erste Option';
            })()
          : null;
      const prompt =
        pickDest
          ? pickDest
          : typeof data?.prompt === 'string' && data.prompt.trim()
            ? String(data.prompt)
          : action === 'choose_venue' && (data?.destName || data?.dest)
          ? (() => {
              const dest = String(data.destName ?? data.dest);
              setLastPlaceName(dest);
              return `Ich wähle ${dest} für heute Abend. Trag den Stopp in die Timeline ein — Navigation noch NICHT starten. Speisekarte und Anrufen anbieten.`;
            })()
          : action === 'choose_venue_now' && (data?.destName || data?.dest)
            ? (() => {
                const dest = String(data.destName ?? data.dest);
                setLastPlaceName(dest);
                return `Ich will jetzt zu ${dest}. Trag es in die Timeline und starte die Navigation.`;
              })()
          : action === 'suggest_food'
          ? 'Wo kann ich heute Abend gut essen gehen?'
          : action === 'suggest_food_city' && data?.city
            ? `Welche Restaurants kannst du mir in ${data.city} empfehlen?`
            : action === 'ask_history'
              ? 'Erzähl mir etwas Spannendes über einen Ort hier in der Nähe.'
              : action === 'ask_city' && data?.city
                ? `Was kann ich in ${data.city} machen?`
                : action === 'ask_transit' && data?.dest
                  ? `Suche JETZT die konkrete ÖPNV-Verbindung zu ${data.dest}: nächste Abfahrt mit Haltestelle, Linie, Dauer, Ankunft und Schritte. Keine Rückfrage ob du suchen sollst.`
                  : action === 'more_history'
                    ? data?.topic
                      ? `Erzähl mir noch mehr zu ${data.topic}.`
                      : 'Erzähl mir noch mehr zur Geschichte.'
                    : action === 'more_offer'
                      ? typeof data?.prompt === 'string' && data.prompt.trim()
                        ? String(data.prompt)
                        : data?.offerTitle
                          ? `Erzähl mir mehr zu „${data.offerTitle}“${data.topic ? ` bei ${data.topic}` : ''}. Was ist das genau, und wo kann ich Tickets buchen?`
                          : 'Erzähl mir mehr zu diesem Angebot und wo ich Tickets bekomme.'
                      : action === 'find_indoor'
                        ? 'Wo kann ich warm rein und etwas trinken?'
                        : action;
      return {
        type: 'SHOW_MORE',
        label: b.label,
        payload: { textPrompt: prompt },
      };
    });

    // Gastro-Kontakt (Anruf/Tisch): Stay22 nie — hilft nicht zum Telefonieren
    const isGastroContact =
      quickActions.some((a) => a.type === 'DIAL_PHONE') ||
      buttons.some((b) => b.id === 'dial' || b.id === 'reserve_web');
    const actionsForUi = isGastroContact
      ? quickActions.filter((a) => a.type !== 'BOOK_STAY22')
      : quickActions;

    const cardId = `m2_${Date.now()}`;
    let finalActions = actionsForUi;
    try {
      const {
        applyActionBoardToResponse,
        startActionBoardDeep,
      } = require('../../services/actionBoard') as typeof import('../../services/actionBoard');
      const boarded = applyActionBoardToResponse(
        {
          speechText: speech,
          visualBullets: bullets,
          quickActions: actionsForUi,
        },
        { cardId, startDeep: false },
      );
      finalActions = boarded.response.quickActions;
      store.setActiveConciergeCard({
        id: cardId,
        createdAtMs: Date.now(),
        speechText: speech,
        visualBullets: clampVisualBullets(bullets),
        quickActions: finalActions,
        cardTitle: 'Findus',
      });
      if (boarded.deepJobs.length > 0) {
        startActionBoardDeep({ jobs: boarded.deepJobs, cardId });
      }
    } catch {
      store.setActiveConciergeCard({
        id: cardId,
        createdAtMs: Date.now(),
        speechText: speech,
        visualBullets: clampVisualBullets(bullets),
        quickActions: finalActions,
        cardTitle: 'Findus',
      });
    }
    // Action-Buttons auch im Planungsmodus — Timeline-Button weglassen (schon offen)
    try {
      const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
        usePlanCalendarUiStore: {
          getState: () => { setMirroredActions: (a: QuickAction[]) => void };
        };
      };
      usePlanCalendarUiStore.getState().setMirroredActions(
        finalActions.filter(
          (a) =>
            !(
              a.type === 'SHOW_MORE' &&
              /timeline|tagesplan/i.test(`${a.label} ${a.payload?.textPrompt ?? ''}`)
            ),
        ),
      );
    } catch {
      /* soft */
    }

    // Say–Do: explizites „navigiere mich“ / Speech-Commit → Kompass sofort (wie Concierge-Pfad)
    void (async () => {
      try {
        const { autoStartNavigationIfCommitted } = require('../../services/concierge/presentConcierge') as {
          autoStartNavigationIfCommitted: (
            r: {
              speechText: string;
              visualBullets: string[];
              quickActions: QuickAction[];
            },
            o?: { userText?: string },
          ) => Promise<boolean>;
        };
        const started = await autoStartNavigationIfCommitted(
          {
            speechText: speech,
            visualBullets: bullets,
            quickActions: finalActions,
          },
          { userText },
        );
        if (started) {
          useFinnusStore.getState().patchNavigation({
            navActive: true,
            navVisible: true,
          });
        }
      } catch {
        /* soft */
      }
    })();
  } catch {
    /* UI optional */
  }
}
