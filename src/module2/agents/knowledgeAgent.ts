import type { Module2Agent } from './types';
import type { Module2ActionButton } from '../types';
import { agentPromptLaws } from '../laws/lawLayers';
import {
  generateGeminiText,
  hasGeminiApiKey,
} from '../../services/geminiService';
import { resolveWorkingPlace } from '../context/placeContext';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';
import { anchorCoords } from '../rucksack/rucksackStore';
import {
  buildMapsVenuePitch,
  detectMapsPitchKind,
} from '../../services/research/venueMapsPitch';
import {
  discoverVenueOffers,
  shouldDiscoverVenueOffers,
  FINDUS_VENUE_OFFERS_BLOCK,
} from '../../services/research/venueOfferDiscovery';
import {
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_MAPS_PITCH_BLOCK,
} from '../../services/concierge/findusResponsePolicy';
import {
  formatPackFactsForAgent,
  lookupPackFactsForSubject,
} from './packFactLookup';
import { assessPlaceVisibility } from '../../services/navigation/placeVisibility';
import { searchPlacesByText } from '../../services/navigation/googleMapsNav';
import {
  isCinemaMovieQuery,
  researchCinemaAndShowtimes,
} from '../../services/research/cinemaShowtimeResearch';
import {
  isSupermarketOfferQuery,
  researchSupermarketProspect,
} from '../../services/research/supermarketProspectResearch';
import {
  isTrailPathQuery,
  researchTrailPaths,
} from '../../services/research/trailPathResearch';
import {
  isActivitySportQuery,
  researchActivitySport,
} from '../../services/research/activitySportResearch';
import {
  detectAmenityKind,
  researchAmenityNav,
} from './amenityNavFacts';
import {
  isComboClusterQuery,
  researchComboCluster,
} from './comboClusterFacts';
import {
  getForegroundSaidFacts,
} from '../../services/memory/conversationThreads';

function isMuseumOrSight(subject: string, text: string): boolean {
  return /\b(museum|galerie|ausstellung|denkmal|schloss|kirche|dom|plaza|aussicht|sehenswürdig|attraktion|theater|oper|philharmon|konzert|hafen|dungeon|turm|arena|michel|plattform|observation|cathedral)\b/i.test(
    `${subject} ${text}`,
  );
}

/** Alias → kanonischer Suchname (nur Disambiguierung, keine Offer-Scripts). */
function canonicalizeSubject(raw: string): string {
  const t = raw.trim();
  if (/\belphi\b|\belbphil|\belphi[-\s]?harmonie/i.test(t)) {
    return 'Elbphilharmonie Hamburg';
  }
  return t;
}

function formatCinemaDist(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} Meter`;
  return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} Kilometer`;
}

export const knowledgeAgent: Module2Agent = {
  id: 'knowledge',
  intents: ['knowledge'],
  async run({ task, rucksack, signal }) {
    void agentPromptLaws('knowledge');

    // Findus-Punkte / Runden — Zahl zuerst, Glückwunsch in Bridge (nicht hier)
    if (
      /\b(punkte|punktzahl)\b/i.test(task.rewrittenText) &&
      /\b(runde|gewonnen|turnier|spiel)\b/i.test(task.rewrittenText)
    ) {
      const round =
        /\berste\s+runde\b/i.test(task.rewrittenText) ||
        /\b1\.\s*runde\b/i.test(task.rewrittenText)
          ? 1
          : /\bzweite\s+runde\b/i.test(task.rewrittenText)
            ? 2
            : null;
      // SSOT-Beispiel in Concierge-Guards: 1. Runde → 110 Pkt (Regel-Fakt, nicht erfunden pro Stadt)
      const points = round === 1 ? 110 : round === 2 ? 80 : null;
      if (points != null) {
        return {
          agent: 'knowledge',
          ok: true,
          draftText:
            `Zahl zuerst: ${points} Punkte für die ${round}. Runde. ` +
            `Kurz den Erfolg anerkennen, dann die Regel nennen — keine Recherche-Meta.`,
          bullets: [
            `${round}. Runde · ${points} Pkt`,
            'Regel aus Findus-Punktelogik',
          ],
          buttons: [],
          meta: {
            number_answer: true,
            points,
            round,
            concrete_place: false,
          },
        };
      }
    }

    // Supermarkt-Prospekt / Angebote — Just-Do-It (Bier im Angebot etc.)
    if (isSupermarketOfferQuery(task.rewrittenText)) {
      const a = anchorCoords(rucksack);
      const place = resolveWorkingPlace(
        task.rewrittenText,
        rucksack.cityHint,
        task.city,
      );
      try {
        const research = await researchSupermarketProspect({
          userText: task.rewrittenText,
          lat: a.lat,
          lng: a.lng,
          signal,
          offerBudgetMs: 10_000,
        });

        const store = research.venue?.name || research.chainHint || 'Supermarkt';
        const dist =
          research.venue != null
            ? research.venue.distanceM < 1000
              ? `${Math.max(50, Math.round(research.venue.distanceM / 50) * 50)} m`
              : `${(research.venue.distanceM / 1000).toFixed(1)} km`
            : null;

        const bullets: string[] = [];
        if (research.venue) {
          bullets.push(
            dist ? `${store} · ${dist}` : store,
          );
        }
        for (const o of research.offers.slice(0, 3)) {
          if (bullets.length >= 3) break;
          const price = o.priceLabel ? ` · ${o.priceLabel}` : '';
          const pack = o.detail ? ` (${o.detail})` : '';
          bullets.push(`${o.productLabel}${pack}${price}`);
        }
        if (!bullets.length) {
          bullets.push(
            research.offersPending
              ? 'Prospekt wird geprüft'
              : 'Keine Prospekt-Treffer belegt',
          );
        }

        const spokenParts: string[] = [];
        const focus = research.productHint;
        if (research.offers.length) {
          const top = research.offers.slice(0, 2).map((o) => {
            const price = o.priceLabel ? ` für ${o.priceLabel}` : '';
            const pack = o.detail ? ` (${o.detail})` : '';
            return `${o.productLabel}${pack}${price}`;
          });
          spokenParts.push(
            focus
              ? `Zum ${focus}-Angebot: ${top.join('; ')}.`
              : `Aktuell im Prospekt: ${top.join('; ')}.`,
          );
          if (research.offers[0]?.validityLabel) {
            spokenParts.push(
              `Gültig ${research.offers[0].validityLabel}.`,
            );
          }
        } else if (research.offersPending) {
          spokenParts.push(
            focus
              ? `Ich check den Prospekt zu ${focus} — Markt ist klar, Angebote kommen gleich nach.`
              : 'Ich schau im aktuellen Prospekt nach — Moment, ich leg dir die Treffer nach.',
          );
        } else {
          spokenParts.push(
            focus
              ? `Zu ${focus} finde ich im aktuellen Prospekt gerade keinen belegten Preis — ehrlich so.`
              : 'Im aktuellen Prospekt hab ich gerade keine belastbaren Treffer.',
          );
        }
        if (research.venue) {
          spokenParts.push(
            dist
              ? `Markt: ${store} (${dist}).`
              : `Markt: ${store}.`,
          );
        }
        if (research.buttons.some((b) => b.id.startsWith('prospect'))) {
          spokenParts.push('Prospekt liegt als Button bereit.');
        }

        return {
          agent: 'knowledge',
          ok: true,
          draftText: spokenParts.join(' ').slice(0, 1200),
          bullets: bullets.slice(0, 3),
          buttons: research.buttons.slice(0, 4),
          meta: {
            supermarketProspect: true,
            deferProspectOffers: research.offersPending === true,
            prospectUserText: task.rewrittenText,
            prospectLat: a.lat,
            prospectLng: a.lng,
            subject: focus || store,
            city: research.cityHint ?? place.city ?? place.speechPlace,
            prospectPromptBlock: research.promptBlock,
            offers: research.offers,
          },
        };
      } catch (err) {
        console.warn('[knowledge] supermarket prospect failed:', err);
      }
    }

    // Amenity / Aldi-Lidl — Pack+OSM, 1 Treffer → Auto-Nav Speech
    const amenityKind = detectAmenityKind(task.rewrittenText);
    if (
      amenityKind &&
      (task.jobId === 'shopping_errand' ||
        task.jobId === 'friction_now' ||
        task.jobId === 'nav_route' ||
        /\b(aldi|lidl|supermarkt)\b/i.test(task.rewrittenText))
    ) {
      const a = anchorCoords(rucksack);
      try {
        return await researchAmenityNav({
          userText: task.rewrittenText,
          lat: a.lat,
          lng: a.lng,
          kind: amenityKind,
        });
      } catch (err) {
        console.warn('[knowledge] amenity nav failed:', err);
      }
    }

    // Multi-Constraint Kombi (Parken × Pizza × Aussicht)
    if (
      isComboClusterQuery(task.rewrittenText) ||
      (task.jobId === 'day_plan_budget' &&
        /\b(parken|pizza|förde|foerde)\b/i.test(task.rewrittenText))
    ) {
      const a = anchorCoords(rucksack);
      const comboPlace = resolveWorkingPlace(
        task.rewrittenText,
        rucksack.cityHint,
        task.city,
      );
      try {
        return await researchComboCluster({
          userText: task.rewrittenText,
          lat: a.lat,
          lng: a.lng,
          cityHint: comboPlace.city ?? comboPlace.speechPlace ?? task.city,
        });
      } catch (err) {
        console.warn('[knowledge] combo cluster failed:', err);
      }
    }

    // Kino/Film: Just-Do-It — Kinos + Spielzeiten, keine Timeline / kein See-Nav
    if (isCinemaMovieQuery(task.rewrittenText)) {
      const a = anchorCoords(rucksack);
      const place = resolveWorkingPlace(
        task.rewrittenText,
        rucksack.cityHint,
        task.city,
      );
      try {
        // Kinos sofort; Spielzeiten max ~6s — Rest als Buttons nachreichen
        const research = await researchCinemaAndShowtimes({
          userText: task.rewrittenText,
          lat: a.lat,
          lng: a.lng,
          signal,
          venuesOnly: false,
          showtimeBudgetMs: 6_000,
        });

        const bullets: string[] = [];
        for (const v of research.venues.slice(0, 2)) {
          bullets.push(`${v.name} · ${formatCinemaDist(v.distanceM)}`);
        }
        for (const s of research.showtimes.slice(0, 2)) {
          if (bullets.length >= 3) break;
          const price =
            s.priceEur != null ? ` · ${s.priceEur}€` : '';
          bullets.push(`${s.cinemaName}: ${s.whenLabel}${price}`);
        }
        if (!bullets.length) {
          bullets.push('Kinos in der Umgebung werden geprüft');
        }

        const buttons: Module2ActionButton[] = [...research.fastButtons];
        for (const b of research.deferredButtons) {
          if (buttons.length >= 4) break;
          if (buttons.some((x) => x.id === b.id || x.label === b.label)) {
            continue;
          }
          buttons.push(b);
        }

        const film =
          research.filmHint ||
          research.showtimes[0]?.filmTitle ||
          'der Film';
        const needsDefer =
          research.showtimesPending ||
          (research.showtimes.length === 0 && research.venues.length > 0);

        const optionBits = research.venues.slice(0, 2).map((v) => {
          const far =
            v.distanceM >= 8_000
              ? ` — circa ${formatCinemaDist(v.distanceM)}`
              : ` (${formatCinemaDist(v.distanceM)})`;
          return `${v.name}${far}`;
        });
        const timeBits = research.showtimes.slice(0, 2).map(
          (s) => `${s.cinemaName}: ${s.whenLabel}`,
        );

        // Sprechbarer Draft (keine Prompt-Meta-Labels)
        const spokenParts: string[] = [];
        if (optionBits.length) {
          spokenParts.push(
            `${film}: am nächsten ${
              optionBits.length > 1 ? 'liegen' : 'liegt'
            } ${optionBits.join(' und ')}.`,
          );
        } else {
          spokenParts.push(
            `Zum Film „${film}“ finde ich gerade kein Kino in Reichweite — ich prüfe die Region weiter.`,
          );
        }
        if (timeBits.length) {
          spokenParts.push(`Spielzeiten: ${timeBits.join('; ')}.`);
        } else if (needsDefer) {
          spokenParts.push(
            'Zeiten und Ticket-Links leg ich dir gleich auf die Buttons nach.',
          );
        } else {
          spokenParts.push(
            'Belegte Startzeiten hab ich gerade nicht — Programm-Links liegen bereit, sobald da.',
          );
        }
        spokenParts.push(
          'Route zu den Kinos ist bereit — Programm und Tickets über die Buttons.',
        );

        const draft = spokenParts.join(' ');

        return {
          agent: 'knowledge',
          ok: true,
          draftText: draft.slice(0, 1200),
          bullets: bullets.slice(0, 3),
          buttons: buttons.slice(0, 4),
          meta: {
            cinema: true,
            deferCinemaLinks: needsDefer,
            cinemaUserText: task.rewrittenText,
            cinemaLat: a.lat,
            cinemaLng: a.lng,
            subject: film,
            city: research.cityHint ?? place.city ?? place.speechPlace,
            cinemaPromptBlock: research.promptBlock,
            showtimes: research.showtimes ?? [],
            priceEur: research.showtimes.find((s) => s.priceEur != null)
              ?.priceEur,
            hasTicketBtn: (buttons ?? []).some(
              (b) =>
                b.payload?.kind === 'deep_link' &&
                /ticket|kino|cinema|eventim|reservix|Trailer|▶/i.test(
                  String(
                    (b.payload as { url?: string }).url ?? b.label ?? '',
                  ),
                ),
            ),
            venues: research.venues.slice(0, 3).map((v) => ({
              name: v.name,
              websiteUrl: v.websiteUri,
              lat: v.lat,
              lng: v.lng,
            })),
          },
        };
      } catch {
        /* fall through to normal knowledge */
      }
    }

    // Sport / Spikeball / Boulder: Fit + Parken/Alternative
    if (isActivitySportQuery(task.rewrittenText)) {
      const a = anchorCoords(rucksack);
      const place = resolveWorkingPlace(
        task.rewrittenText,
        rucksack.cityHint,
        task.city,
      );
      try {
        const research = await researchActivitySport({
          userText: task.rewrittenText,
          lat: a.lat,
          lng: a.lng,
          cityHint: place.city ?? place.speechPlace ?? rucksack.cityHint,
          signal,
        });
        return {
          agent: 'knowledge',
          ok: true,
          draftText: [
            research.spokenDraft,
            research.promptBlock,
          ].join('\n\n'),
          bullets: research.bullets.slice(0, 3),
          buttons: research.buttons.slice(0, 4),
          meta: {
            activitySport: true,
            activityFit: research.activityFit,
            alternative: research.alternativeOffered,
            alternative_offered: research.alternativeOffered,
            concrete_place: Boolean(research.primary),
            activityKind: research.kind,
            namedPlace: research.namedPlace,
            wantsFreeParking: research.wantsFreeParking,
            subject: research.primary?.name || research.kind,
            placeName: research.primary?.name,
            placeLat: research.primary?.lat,
            placeLng: research.primary?.lng,
            city: place.city ?? place.speechPlace,
            venues: [research.primary, research.alternative, research.parking]
              .filter(Boolean)
              .map((v) => ({
                name: v!.name,
                websiteUrl: v!.websiteUri,
                lat: v!.lat,
                lng: v!.lng,
                role: v!.role,
              })),
          },
        };
      } catch {
        /* fall through */
      }
    }

    // Wanderweg / Fahrradweg: Vorschlag + Nav zum Einstieg
    if (isTrailPathQuery(task.rewrittenText)) {
      const a = anchorCoords(rucksack);
      const place = resolveWorkingPlace(
        task.rewrittenText,
        rucksack.cityHint,
        task.city,
      );
      try {
        const research = await researchTrailPaths({
          userText: task.rewrittenText,
          lat: a.lat,
          lng: a.lng,
          cityHint: place.city ?? place.speechPlace ?? rucksack.cityHint,
          signal,
        });
        return {
          agent: 'knowledge',
          ok: true,
          draftText: research.promptBlock,
          bullets: research.bullets.slice(0, 3),
          buttons: research.buttons.slice(0, 4),
          meta: {
            trailPath: true,
            trailKind: research.kind,
            subject:
              research.trails[0]?.name ||
              (research.kind === 'bike' ? 'Fahrradweg' : 'Wanderweg'),
            city: research.cityHint ?? place.city ?? place.speechPlace,
            placeLat: research.trails[0]?.lat ?? null,
            placeLng: research.trails[0]?.lng ?? null,
            preferBike: research.kind === 'bike',
            venues: research.trails.slice(0, 3).map((t) => ({
              name: t.name,
              websiteUrl: t.websiteUri,
              lat: t.lat,
              lng: t.lng,
            })),
            trailPromptBlock: research.promptBlock,
            spokenFallback: research.spokenDraft,
            outdoorBudgetM: research.budget?.totalDistanceM ?? null,
            outdoorOneWayM: research.budget?.oneWayTargetM ?? null,
          },
        };
      } catch {
        /* fall through to normal knowledge */
      }
    }

    const place = resolveWorkingPlace(
      task.rewrittenText,
      rucksack.cityHint,
      task.city,
    );
    const city = place.speechPlace;
    const a = anchorCoords(rucksack);
    let subject =
      task.subject?.trim() ||
      task.rewrittenText
        .replace(/^(kannst du mir |erzähl mir |mehr zu |was ist )/i, '')
        .trim() ||
      'dieser Ort';
    subject = canonicalizeSubject(subject);

    // 1) Pack/SQLite zuerst — stabile Fakten; Live-Hints nur als Suchauftrag
    let packBlock = '';
    try {
      const packHit = await lookupPackFactsForSubject({
        subject: `${subject} ${task.rewrittenText || ''}`.trim(),
        cityHint: place.city ?? city,
        lat: a.lat,
        lng: a.lng,
      });
      if (
        packHit &&
        (packHit.facts.length > 0 ||
          packHit.liveHints.length > 0 ||
          packHit.offlineQaBlock)
      ) {
        // Already-said Facts aus Thread ausblenden (Story-Follow-up)
        const said = getForegroundSaidFacts();
        if (said.length && packHit.facts.length) {
          const fresh = packHit.facts.filter((f) => {
            const key = f.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
            return !said.some((s) => key.includes(s) || s.includes(key.slice(0, 40)));
          });
          packBlock = formatPackFactsForAgent({
            ...packHit,
            facts:
              fresh.length > 0
                ? fresh
                : [
                    'ALREADY-SAID: Die wichtigsten Fakten zu diesem Ort wurden schon genannt — beantworte nur die neue Frage mit noch nicht Gesagtem oder ehrlicher Lücke.',
                    ...packHit.facts.slice(0, 3),
                  ],
          });
        } else {
          packBlock = formatPackFactsForAgent(packHit);
        }
        if (packHit.poi?.name) {
          // Sticky subject für Follow-ups
          task.subject = task.subject || packHit.poi.name;
        }
      }
    } catch {
      /* soft */
    }

    const wantsPitch = isMuseumOrSight(subject, task.rewrittenText);
    const wantsOffers = shouldDiscoverVenueOffers(subject, task.rewrittenText);

    let draft = packBlock;
    let pitchPlaceWebsite: string | null = null;
    let placeLat: number | null = null;
    let placeLng: number | null = null;

    // GPS-Sichtbarkeit: nur dann „vor dir / riesig“ wenn plausibel
    try {
      const hits = await searchPlacesByText({
        query: `${subject} ${place.city ?? city}`.trim(),
        lat: a.lat,
        lng: a.lng,
        radiusM: 12_000,
      });
      const hit = hits[0];
      if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) {
        placeLat = hit.lat;
        placeLng = hit.lng;
        if (!pitchPlaceWebsite && hit.websiteUri) {
          pitchPlaceWebsite = hit.websiteUri;
        }
      }
    } catch {
      /* soft */
    }

    // 2) Live Maps/Offers nur wenn Pack dünn ist ODER User Live-Infos braucht
    const packThin = !packBlock || packBlock.length < 120;
    const wantsLive =
      packThin ||
      wantsOffers ||
      wantsPitch ||
      /\b(speisekarte|preis|öffnungs|oeffnungs|heute|ticket|event|tour|aktuell|live|hoch|höhe|stufen|aussicht)\b/i.test(
        task.rewrittenText,
      );

    if (wantsPitch && wantsLive) {
      try {
        const pitch = await buildMapsVenuePitch({
          kind: detectMapsPitchKind(`${subject} ${task.rewrittenText}`),
          query: `${subject} ${place.city ?? city}`,
          lat: a.lat,
          lng: a.lng,
          userText: task.rewrittenText,
          signal,
        });
        const pitchPart = pitch.speechFacts
          ? [
              pitch.speechFacts,
              'FLOW: Maps-Pitch + Historie-Kern mischen — visuell → Flair/Reviews → heute.',
              pitch.spokenPitch,
            ].join('\n')
          : pitch.spokenPitch;
        pitchPlaceWebsite = pitch.place?.websiteUri ?? pitchPlaceWebsite;
        if (
          pitch.place &&
          pitch.place.lat != null &&
          pitch.place.lng != null &&
          Number.isFinite(pitch.place.lat) &&
          Number.isFinite(pitch.place.lng)
        ) {
          placeLat = pitch.place.lat;
          placeLng = pitch.place.lng;
        }
        draft = packBlock
          ? `${packBlock}\n\nLIVE-ANREICHERUNG:\n${pitchPart}`
          : pitchPart;
      } catch {
        /* keep packBlock */
      }
    }

    // Sichtbarkeit nach Ort-GPS neu bewerten
    const visibilityFinal = assessPlaceVisibility({
      userLat: a.lat,
      userLng: a.lng,
      placeLat,
      placeLng,
      placeName: subject,
      extraHints: task.rewrittenText,
    });

    draft = draft
      ? `${visibilityFinal.promptLine}\n${draft}`
      : visibilityFinal.promptLine;

    // Weltweite Offer-Discovery (Theater/Hafen/Dungeon/Konzert…) — kein Venue-Hardcode
    let offerButtons: Module2ActionButton[] = [];
    if (wantsLive && (wantsOffers || wantsPitch || packThin)) {
      try {
        const offers = await discoverVenueOffers({
          subject,
          city: place.city ?? city,
          userText: task.rewrittenText,
          websiteUrl: pitchPlaceWebsite,
          signal,
        });
        if (offers) {
          draft = draft
            ? `${draft}\n\n${offers.promptBlock}`
            : offers.promptBlock;
          offerButtons = offers.buttons;
        }
      } catch {
        /* soft */
      }
    }

    if (
      (packThin || wantsLive) &&
      (!draft || draft.replace(visibilityFinal.promptLine, '').trim().length < 120) &&
      hasGeminiApiKey()
    ) {
      try {
        const hist = await generateGeminiText(
          `${FINDUS_MAPS_PITCH_BLOCK}\n${FINDUS_VENUE_OFFERS_BLOCK}\n${FINDUS_FEW_SHOT_DISCLAIMER}\n` +
            `Ort/Kontext: ${city}\nThema: ${subject}\nUser-Frage: ${task.rewrittenText}\n` +
            `${visibilityFinal.promptLine}\n\n` +
            (packBlock
              ? `${packBlock}\n\nErgänze nur was im Pack fehlt. Preise/Events/Speisekarten live suchen, nie erfinden.\n\n`
              : 'Kein Pack-Treffer — recherchiere live. Nichts erfinden.\n\n') +
            `FLOW: ${
              visibilityFinal.likelyVisible
                ? 'visuell ankommen → '
                : 'Fakten zuerst (kein „vor dir“-Visual) → '
            }Historie-Kern → heutige Nutzung → Highlight` +
            (wantsPitch ? ' → Review-Flair wenn sinnvoll' : '') +
            ` → was man HIER machen kann (Programm/Tour/Ticket) wenn belegt.\n` +
            `Stichpunkte später mit Ziffern (Höhe m, Stufen) — nie „ausgeschrieben“.\n` +
            `Länge ca. 900–1600 Zeichen. Keine URLs, keine Adressen.`,
          {
            useFindusSystem: true,
            enableGoogleSearch: true,
            maxTokens: 900,
            temperature: 0.65,
            allowProEscalate: false,
            signal,
          },
        );
        draft = draft && draft.length > 120 ? `${draft}\n\n${hist}` : hist;
      } catch {
        /* soft */
      }
    }

    if (!draft || draft.length < 80) {
      draft = [
        `FAKTEN Knowledge (nicht wörtlich vorlesen):`,
        `Thema: ${subject}`,
        place.city ? `Ort-Kontext: ${place.city}` : 'Ort-Kontext: hier vor Ort',
        visibilityFinal.promptLine,
        `FLOW: ${visibilityFinal.likelyVisible ? 'visuell ankommen → ' : ''}Historie-Kern → heutige Nutzung → Highlight.`,
        `Status: Live-Recherche knapp — ehrlich halten, nichts erfinden.`,
      ].join('\n');
    }

    if (draft.length > 3000) draft = draft.slice(0, 3000);

    const buttons: Module2ActionButton[] = [
      {
        id: 'more_history',
        label: shortenActionLabel('📖 Noch mehr'),
        payload: {
          kind: 'ui',
          action: 'more_history',
          data: { topic: subject },
        },
      },
    ];

    // Offer-Buttons zuerst (Tickets / Programm), dann Website falls nicht schon drin
    for (const b of offerButtons) {
      if (buttons.length >= 4) break;
      if (buttons.some((x) => x.id === b.id || x.label === b.label)) continue;
      buttons.push(b);
    }

    if (
      pitchPlaceWebsite &&
      buttons.length < 4 &&
      !buttons.some(
        (b) =>
          b.payload.kind === 'deep_link' &&
          b.payload.url === pitchPlaceWebsite,
      )
    ) {
      buttons.push({
        id: 'venue_web',
        label: shortenActionLabel(`${subject} → Web`),
        payload: { kind: 'deep_link', url: pitchPlaceWebsite },
      });
    }

    const hasTicketBtn = buttons.some(
      (b) =>
        /ticket|eintritt|🎟️|🎫/i.test(b.label) ||
        (b.payload.kind === 'deep_link' &&
          /ticket|book|eintritt/i.test(String(b.payload.url ?? ''))),
    );

    return {
      agent: 'knowledge',
      ok: true,
      draftText: draft,
      bullets: [],
      buttons: buttons.slice(0, 4),
      meta: {
        subject,
        city,
        draftChars: draft.length,
        mapsPitch: wantsPitch,
        venueOffers: wantsOffers,
        deferTickets: wantsPitch || wantsOffers,
        hasTicketBtn,
        placeLat,
        placeLng,
        likelyVisible: visibilityFinal.likelyVisible,
        pitchKind: detectMapsPitchKind(`${subject} museum`),
        needsEventLinks:
          wantsOffers ||
          /\b(party|konzert|heute\s+abend|nightlife|club)\b/i.test(
            task.rewrittenText,
          ),
        ticket_or_info_url: !hasTicketBtn && (wantsPitch || wantsOffers),
        venues: [
          {
            name: subject,
            websiteUrl: pitchPlaceWebsite,
            lat: placeLat,
            lng: placeLng,
          },
        ],
      },
    };
  },
};
