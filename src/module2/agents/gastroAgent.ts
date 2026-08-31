import type { Module2Agent } from './types';
import type { Module2ActionButton } from '../types';
import { agentPromptLaws } from '../laws/lawLayers';
import { anchorCoords } from '../rucksack/rucksackStore';
import { getShortTerm, setLastPlaceName } from '../context/shortTermContext';
import { resolveWorkingPlace } from '../context/placeContext';
import {
  extractNamedVenueMealIntent,
} from './localDiningCatalog';
import { searchPlacesByText } from '../../services/navigation/googleMapsNav';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';
import { addPlanStop } from '../timeline/planLiveEdits';
import { applyDiningDeparturePlan } from '../timeline/planMealDeparture';
import {
  parsePartySize,
  parseTimeHm,
  parseDateIso,
  parseReservationOccasion,
  withReservationPrefill,
  buildReservationMailtoDraft,
} from '../../services/reservation/reservationPrefill';
import { getCachedUserProfile } from '../../services/userProfileService';
import { getReservationContact } from '../../types/userProfile';
import { shouldHandoffToPitchModule } from '../pitch/shouldHandoffPitch';
import { researchPitchAsAgentResult } from '../pitch/pitchFactLane';

/** Kurzer Button-Name — lange Zusätze strippen, Stadt/Rechtsform egal. */
function shortVenueLabel(name: string, max = 24): string {
  let n = name
    .replace(
      /\b(burger\s*service|restaurant|service|gmbh|ltd|inc|bar|grill|kitchen|café|cafe|bistro|lounge)\b/gi,
      '',
    )
    .replace(/\s*[-–|].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n || n.length < 3) {
    n = name.split(/\s+/).slice(0, 2).join(' ');
  }
  return shortenActionLabel(n, max);
}

function parseClockToMs(text: string): number | null {
  const m =
    text.match(/\bum\s+(\d{1,2})(?:[.:](\d{2}))?\s*(?:uhr)?\b/i) ||
    text.match(/\b(\d{1,2})[.:](\d{2})\s*uhr\b/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] != null ? Number(m[2]) : 0;
  if (!Number.isFinite(h) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, min, 0, 0);
  if (d.getTime() < Date.now() - 30 * 60_000) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

function isEveningMealUtterance(text: string): boolean {
  return /\b(heute\s+abend|heut\s+abend|abendessen|zum\s+abend|heute\s+mittag)\b/i.test(
    text,
  );
}

export const GASTRO_API_FILTERS = {
  min_rating: 3.5,
  open_now: true,
} as const;

export const gastroAgent: Module2Agent = {
  id: 'gastro',
  intents: ['gastro'],
  async run({ task, rucksack }) {
    void agentPromptLaws('gastro');
    const a = anchorCoords(rucksack);
    const place = resolveWorkingPlace(
      task.rewrittenText,
      rucksack.cityHint,
      task.city,
    );
    const namedVenue = extractNamedVenueMealIntent(
      task.rewrittenText,
      getShortTerm().lastPlaceName,
    );

    // Speisekarte: Gerichte zum gewählten Ort — keine Nearby-Restaurant-Suche
    const {
      detectMenuAdvisorIntent,
      extractVenueNameForMenu,
      adviseMenuDishes,
    } = await import('../../services/research/menuTranslateService');
    const menuVenue =
      extractVenueNameForMenu(
        task.rewrittenText,
        getShortTerm().lastPlaceName,
      ) ||
      namedVenue ||
      getShortTerm().lastPlaceName;
    if (
      detectMenuAdvisorIntent(
        task.rewrittenText,
        Boolean(menuVenue || getShortTerm().lastPlaceName),
      ) &&
      (menuVenue ||
        /https?:\/\//i.test(task.rewrittenText) ||
        getShortTerm().lastMenuUrl)
    ) {
      const advice = await adviseMenuDishes(
        menuVenue && !/https?:\/\//i.test(task.rewrittenText)
          ? `${task.rewrittenText} (Restaurant: ${menuVenue})`
          : task.rewrittenText,
      );
      if (advice.handled && advice.reply) {
        if (advice.placeName) setLastPlaceName(advice.placeName);
        const buttons: Module2ActionButton[] = [];
        if (advice.menuUrl) {
          buttons.push({
            id: 'menu_advise',
            label: shortenActionLabel(
              `${shortVenueLabel(advice.placeName || menuVenue || 'Karte', 12)} → Speisekarte`,
            ),
            payload: {
              kind: 'deep_link',
              url: advice.menuUrl,
              destName: advice.placeName || menuVenue || undefined,
            },
          });
        }
        return {
          agent: 'gastro',
          ok: true,
          draftText: [
            'FAKTEN Speisekarten-Empfehlung (nicht wörtlich vorlesen):',
            advice.reply,
            'FLOW: Konkrete Gerichte mit Nummern nennen wenn belegt. Prefs spiegeln. Keine anderen Restaurants. Speisekarte-Button.',
          ].join('\n'),
          bullets: (advice.bullets ?? []).slice(0, 3),
          buttons: buttons.slice(0, 4),
          money: [],
          meta: {
            city: place.city,
            speechPlace: place.speechPlace,
            menuAdvisor: true,
            placeName: advice.placeName ?? menuVenue,
            menuUrl: advice.menuUrl,
            venues: advice.placeName
              ? [
                  {
                    name: advice.placeName,
                    websiteUrl: advice.menuUrl,
                    menuUrl: advice.menuUrl,
                  },
                ]
              : [],
          },
        };
      }
    }

    const wantsReserve =
      /\b(reservier|tisch\s+(?:anfrag|buch|vorbereiten)|platz\s+reserv)\b/i.test(
        task.rewrittenText,
      );
    const wantsCall =
      /\b(anrufen|anruf\b|telefon(?:nummer)?|nummer\s+(?:raus|her)\s*suchen)\b/i.test(
        task.rewrittenText,
      );
    const planAtMs = parseClockToMs(task.rewrittenText);
    const wantsPlanMeal =
      planAtMs != null ||
      (isEveningMealUtterance(task.rewrittenText) &&
        /\b(gehen|hingehen|essen|zu\s+\w)/i.test(task.rewrittenText));

    // Tisch / Anruf / fester Termin → Kontakt + Plan, kein Hotel/Stay22
    if (wantsReserve || wantsCall || (wantsPlanMeal && (namedVenue || getShortTerm().lastPlaceName))) {
      const venueName =
        namedVenue ||
        getShortTerm().lastPlaceName ||
        task.subject ||
        'Restaurant';
      try {
        // Pack-first: benannter Gastro-Ort aus Offline-Katalog
        const { lookupPackFactsForSubject } = await import('./packFactLookup');
        const packHit = await lookupPackFactsForSubject({
          subject: venueName,
          cityHint: place.city,
          lat: a.lat,
          lng: a.lng,
        });
        const packNameOk =
          packHit &&
          packHit.score >= 50 &&
          packHit.poi.name.toLowerCase().includes(
            venueName.toLowerCase().slice(0, 6),
          );
        let hit: {
          name: string;
          lat: number;
          lng: number;
          phoneNumber?: string | null;
          websiteUri?: string | null;
          placeId?: string;
          openNow?: boolean;
        } | null = packNameOk
          ? {
              name: packHit!.poi.name,
              lat: packHit!.poi.lat,
              lng: packHit!.poi.lng,
              placeId: `pack:${packHit!.poi.spot_key || packHit!.poi.id}`,
              openNow: true,
            }
          : null;
        if (!hit) {
          const hits = await searchPlacesByText({
            query: `${venueName} ${place.city ?? ''}`.trim(),
            lat: a.lat,
            lng: a.lng,
            radiusM: 12_000,
          });
          hit =
            hits.find((h) =>
              h.name.toLowerCase().includes(venueName.toLowerCase().slice(0, 8)),
            ) ?? hits[0] ?? null;
        }
        if (!hit) {
          return {
            agent: 'gastro',
            ok: true,
            draftText: [
              'FAKTEN Gastro Kontakt (nicht wörtlich vorlesen):',
              `Gesucht: ${venueName}`,
              'Treffer: keiner',
              'FLOW: ehrlich knapp — Namen nochmal erfragen oder letzte Empfehlung referenzieren. Kein Hotel/Stay22.',
            ].join('\n'),
            bullets: [],
            buttons: [],
          };
        }

        setLastPlaceName(hit.name);

        const phone = hit.phoneNumber?.trim() || null;
        const web = hit.websiteUri?.trim() || null;
        const profile = getCachedUserProfile();
        const contact = getReservationContact(profile);
        const party = parsePartySize(task.rewrittenText) ?? 2;
        const timeHm = parseTimeHm(task.rewrittenText);
        const dateIso =
          parseDateIso(task.rewrittenText) ||
          (/\bheute\b/i.test(task.rewrittenText)
            ? new Date().toISOString().slice(0, 10)
            : null);
        const occasion = parseReservationOccasion(task.rewrittenText);
        const missingWhen =
          wantsReserve && (!dateIso || !timeHm)
            ? [
                !dateIso ? 'Datum' : null,
                !timeHm ? 'Uhrzeit' : null,
              ].filter(Boolean)
            : [];

        // Prefill nur wenn wir Datum haben — sonst kein Fake-„heute“
        const rawReserve =
          web ||
          `https://www.google.com/search?q=${encodeURIComponent(`${hit.name} Tisch reservieren`)}`;
        const reserveUrl = withReservationPrefill(rawReserve, {
          partySize: party,
          dateIso: dateIso,
          timeHm,
          guestName: contact.fullName || null,
          guestEmail: contact.email || null,
          guestPhone: contact.phoneNumber || null,
          notes: occasion,
        });

        let departureSpeech: string[] = [];
        const leaveButtons: Module2ActionButton[] = [];

        if (wantsPlanMeal || (wantsReserve && (planAtMs != null || timeHm))) {
          const startMs =
            planAtMs ??
            (() => {
              if (timeHm) {
                const [hh, mm] = timeHm.split(':').map(Number);
                const d = new Date();
                d.setSeconds(0, 0);
                d.setHours(hh || 19, mm || 0, 0, 0);
                if (d.getTime() < Date.now() - 30 * 60_000) {
                  d.setDate(d.getDate() + 1);
                }
                return d.getTime();
              }
              const d = new Date();
              d.setSeconds(0, 0);
              if (d.getHours() < 18) d.setHours(19, 0, 0, 0);
              else d.setHours(d.getHours() + 1, 0, 0, 0);
              return d.getTime();
            })();
          const endMs = startMs + 90 * 60_000;
          const mealStop = addPlanStop({
            title: `Essen: ${hit.name}`,
            lat: hit.lat,
            lng: hit.lng,
            plannedStartMs: startMs,
            plannedEndMs: endMs,
            kind: 'stop',
            hardAnchor: planAtMs != null || timeHm != null,
            notes: [
              planAtMs != null || timeHm
                ? 'Uhrzeit vom User'
                : 'Abendessen · Uhrzeit flexibel',
              occasion,
            ]
              .filter(Boolean)
              .join(' · '),
            bufferMin: 5,
          });
          // Abfahrt: Leave-by + Modus-Wahl + Reminder (Timeline öffnet schon)
          if (hit.lat != null && hit.lng != null) {
            const dep = applyDiningDeparturePlan({
              stopId: mealStop.id,
              venueTitle: hit.name,
              destLat: hit.lat,
              destLng: hit.lng,
              appointmentMs: startMs,
            });
            departureSpeech = dep.speechFacts;
            leaveButtons.push(...dep.buttons);
          }
        }

        const buttons: Module2ActionButton[] = [];
        // Kette: Partner/Web → Anrufen → Mail → Nav. Kein Timeline-Button (öffnet schon).
        if (web || wantsReserve) {
          buttons.push({
            id: 'reserve_web',
            label: shortenActionLabel(
              web ? '🌐 Reservieren' : '🔍 Reservieren',
            ),
            payload: {
              kind: 'deep_link',
              url: reserveUrl,
              destName: hit.name,
            },
          });
        }
        if (phone) {
          buttons.push({
            id: 'dial',
            label: shortenActionLabel('📞 Anrufen'),
            payload: { kind: 'dial', phone },
          });
        }
        if (wantsReserve) {
          const mailtoUrl = buildReservationMailtoDraft({
            restaurantEmail: null,
            restaurantName: hit.name,
            guestName: contact.fullName || '',
            guestEmail: contact.email || '',
            guestPhone: contact.phoneNumber || null,
            partySize: party,
            timeHm,
            dateIso,
            notes: occasion,
          });
          buttons.push({
            id: 'reserve_mail',
            label: shortenActionLabel('✉️ Mail-Entwurf'),
            payload: { kind: 'deep_link', url: mailtoUrl },
          });
        }
        // Modus-Wahl (Fuß/Rad) vor Nav, wenn Platz
        for (const lb of leaveButtons) {
          if (buttons.length >= 4) break;
          buttons.push(lb);
        }
        if (buttons.length < 4) {
          buttons.push({
            id: 'nav',
            label: shortenActionLabel(`📍 ${shortVenueLabel(hit.name)}`),
            payload: {
              kind: 'navigate',
              lat: hit.lat,
              lng: hit.lng,
              label: hit.name,
            },
          });
        }
        let draft: string;
        if (wantsCall) {
          draft = [
            'FAKTEN Gastro Kontakt (nicht wörtlich vorlesen):',
            `Venue: ${hit.name}`,
            phone ? `Telefon: ${phone}` : 'Telefon: unbekannt',
            web ? `Web: ${web}` : 'Web: unbekannt',
            'FLOW: User will anrufen → Nummer nennen wenn belegt + auf Anrufen-Button verweisen. Keine Hotel-/Stay22-Ablenkung. Wenn keine Nummer: Web-Button als Alternative, ehrlich knapp.',
          ].join('\n');
        } else if (wantsReserve) {
          draft = [
            'FAKTEN Gastro Reservierung (nicht wörtlich vorlesen):',
            `Venue: ${hit.name}`,
            phone ? `Telefon: ${phone}` : 'Telefon: unbekannt',
            web ? `Web: ${web}` : 'Web: Suche-Link vorbereitet',
            `Personen: ${party}`,
            dateIso ? `Datum: ${dateIso}` : 'Datum: fehlt',
            timeHm ? `Uhrzeit: ${timeHm}` : 'Uhrzeit: fehlt',
            occasion ? `Anlass/Notiz: ${occasion}` : null,
            contact.fullName ? `Gast: ${contact.fullName}` : null,
            departureSpeech.length
              ? `ABFAHRT:\n${departureSpeech.join('\n')}`
              : null,
            'Kette: 1) Partner/Web mit Prefill (viele Sites ignorieren Params — User prüft/ergänzt) 2) Anrufen 3) Mail-Entwurf (vorausgefüllt, User tippt Rest.-Adresse wenn nötig). Nie heimlich absenden. Kein Browser-Roboter der Widget-Formulare tippt.',
            missingWhen.length
              ? `FLOW: Einmal knapp nachfragen: ${missingWhen.join(' und ')} — parallel schon Web/Anruf/Mail-Buttons anbieten. Profil-Daten (Name/Mail/Tel) nutzen, nicht nochmal erfragen.`
              : 'FLOW: Just-Do-It → Web vorausgefüllt + Anrufen + Mail-Entwurf. Abfahrt/Leave-by kurz nennen + Modus-Buttons. Anlass in Notiz. Kein Stay22 für Restaurant-Tisch. Timeline öffnet selbst — keinen Timeline-Button.',
          ]
            .filter(Boolean)
            .join('\n');
        } else {
          const whenLabel =
            planAtMs != null
              ? `Uhrzeit ${new Date(planAtMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
              : 'Abend-Slot ohne feste Uhrzeit';
          draft = [
            'FAKTEN Gastro Plan-Eintrag (nicht wörtlich vorlesen):',
            `Venue: ${hit.name}`,
            `Timeline: eingetragen (${whenLabel})`,
            occasion ? `Anlass/Notiz: ${occasion}` : null,
            departureSpeech.length
              ? `ABFAHRT:\n${departureSpeech.join('\n')}`
              : null,
            phone ? `Telefon: ${phone}` : 'Telefon: unbekannt',
            'FLOW: Bestätigen dass Essen in Timeline steht → Leave-by/Modus kurz nennen → optional Anrufen/Web. Kein Stay22. Navigation nur wenn User „jetzt hin“ sagt. Kein Timeline-Button.',
          ]
            .filter(Boolean)
            .join('\n');
        }

        return {
          agent: 'gastro',
          ok: true,
          draftText: draft,
          bullets: [
            hit.name,
            phone ? `Tel ${phone}` : 'Tel noch offen',
            wantsPlanMeal ? 'In Timeline' : 'Kontakt',
          ].filter(Boolean),
          buttons: buttons.slice(0, 4),
          meta: {
            city: place.city,
            venue: hit.name,
            phone,
            wantsReserve,
            wantsCall,
            planned: wantsPlanMeal,
          },
        };
      } catch {
        return {
          agent: 'gastro',
          ok: true,
          draftText: [
            'FAKTEN Gastro Kontakt (nicht wörtlich vorlesen):',
            `Gesucht: ${venueName}`,
            'Status: Suche fehlgeschlagen',
            'FLOW: kurz entschuldigen → erneut versuchen anbieten. Kein Hotel/Stay22.',
          ].join('\n'),
          bullets: [],
          buttons: [],
        };
      }
    }

    // Offene 2er-Auswahl → Pitch-Modul (nie Legacy Medaillen-Guide)
    if (
      shouldHandoffToPitchModule(task.rewrittenText) ||
      task.jobId === 'dining_open' ||
      task.jobId === 'dining_hard_match' ||
      /\b(hunger|restaurant|essen\s+gehen|empfehl|wo\s+(kann|soll)\s+(man\s+)?essen)\b/i.test(
        task.rewrittenText,
      )
    ) {
      return researchPitchAsAgentResult({
        userText: task.rewrittenText,
        requestId: `gastro_${task.id ?? Date.now()}`,
      });
    }

    return {
      agent: 'gastro',
      ok: true,
      draftText: [
        'FAKTEN Gastro (nicht wörtlich vorlesen):',
        'Keine klare Auswahl-Anfrage — kurz nach Ort/Küche/Slot fragen oder Pitch-Modul nutzen.',
        'FLOW: eine gezielte Rückfrage ODER Auswahl-Pitch.',
      ].join('\n'),
      bullets: [],
      buttons: [],
      meta: { needsClarify: true },
    };
  },
};
