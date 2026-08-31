/**
 * Offene Dialog-Zustände für Call-1 — Flags, keine Keyword-Weiche.
 */

export function collectCall1DialogFlags(): string[] {
  const flags: string[] = [];
  try {
    const { usePlanSessionStore } = require('../planning/planSessionState') as {
      usePlanSessionStore: {
        getState: () => {
          waitingConfirm: boolean;
          waitingLocation: boolean;
          waitingConflict: boolean;
          phase: string;
        };
      };
    };
    const s = usePlanSessionStore.getState();
    if (s.waitingLocation || s.phase === 'clarify_location') {
      flags.push(
        'FLAG: Plan wartet auf Ort/Ziel. Kurze Orts-Antwort = lane=plan und Plan fortsetzen. „Beides nicht / neu suchen / Zoo statt … / anderes Ziel“ = lane=plan, Plan anpassen. Wetter/Wissen/Nav-woanders = passende Lane, Plan-Session bleibt liegen und danach weiter.',
      );
    }
    if (s.waitingConfirm || s.phase === 'await_confirm') {
      flags.push(
        'FLAG: Plan wartet auf Bestätigung. Ja/passt = lane=plan. Ablehnen + Alternative = lane=plan und umbauen. Anderes Thema = passende Lane, Session bleibt.',
      );
    }
    if (s.waitingConflict || s.phase === 'await_conflict') {
      flags.push('FLAG: Plan-Konflikt offen — Auflösung = lane=plan.');
    }
  } catch {
    /* soft */
  }

  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => {
          pendingNavOffer: { name?: string } | null;
          pendingNavAlternatives: unknown[] | null;
          pendingAffiliateOffer: { label?: string } | null;
          activeConciergeCard: { cardTitle?: string } | null;
        };
      };
    };
    const st = useFinnusStore.getState();
    if (st.pendingNavOffer?.name) {
      flags.push(
        `FLAG: Nav-Angebot liegt (${st.pendingNavOffer.name}). Nacktes Ja/los/den ersten = lane=nav (dieses Ziel). „Ja, aber Bahn/Wecker/…“ = intents[] nav plus Rest. Neues Ziel („bring mich zum …“) = neues nav, Offer ignorieren.`,
      );
    }
    if (st.pendingAffiliateOffer) {
      flags.push(
        'FLAG: Buchungs-Angebot liegt. Nacktes Ja = chat und Angebot annehmen. Compound (Ja + Nav/Wecker) = intents[] nicht weglassen.',
      );
    }
    const rainCard = st.activeConciergeCard?.cardTitle === 'Wetter';
    if (rainCard) {
      flags.push(
        'FLAG: Wetterkarte offen. „Regen egal / weiter wie geplant“ = Karte darf weg, Lane folgt dem Rest des Satzes (Nav/Plan/Chat), kein Pflicht-Script.',
      );
    }
  } catch {
    /* soft */
  }

  try {
    const { useUserMemoryStore } = require('../../store/useUserMemoryStore') as {
      useUserMemoryStore: {
        getState: () => {
          pendingHotelConfirmId: string | null;
          awaitingHotelName: boolean;
          awaitingFlightDetails: boolean;
        };
      };
    };
    const mem = useUserMemoryStore.getState();
    if (mem.pendingHotelConfirmId || mem.awaitingHotelName) {
      flags.push(
        'FLAG: Hotel-Bestätigung offen. Ja/Nein/Name = Hotel setzen oder verwerfen, Rest des Satzes trotzdem (Nav/Plan). Nicht den ganzen Turn nur mit Hotel beenden.',
      );
    }
    if (mem.awaitingFlightDetails) {
      flags.push(
        'FLAG: Flugdetails erwartet (Nummer/Uhr). Reiner Code wie LH400 kann jobHint=flight_trip sein — nur wenn DIESE Äußerung der Flug ist, nicht wenn mitten in Nav/Plan etwas anderes gesagt wird.',
      );
    }
  } catch {
    /* soft */
  }

  try {
    const { shouldHintGpsAbsence, gpsAbsenceLastPlaceLabel } = require('../../services/location/gpsAbsence') as {
      shouldHintGpsAbsence: () => boolean;
      gpsAbsenceLastPlaceLabel: () => string | null;
    };
    if (shouldHintGpsAbsence()) {
      const where = gpsAbsenceLastPlaceLabel();
      flags.push(
        where
          ? `FLAG: Kein Live-GPS nach 2 Versuchen. Letzter bekannter Ort: ${where}. Wenn Nähe/„wo bin ich“/Pitch: kurz fragen ob noch dort — keine erfundene Stadt. Sonst ignorieren.`
          : 'FLAG: Kein Live-GPS nach 2 Versuchen. Nähe nicht erfinden. Kurz sagen, dass GPS fehlt, wenn der Satz Standort braucht.',
      );
    }
  } catch {
    /* soft */
  }

  try {
    const { consumeParkingJustSaved } = require('../../services/memory/sideChannelMemory') as {
      consumeParkingJustSaved: () => boolean;
    };
    if (consumeParkingJustSaved()) {
      flags.push(
        'FLAG: Parkplatz wurde in diesem Satz gespeichert. Kurz mitnehmen wenn passend — Navigation oder andere Aufträge im selben Satz nicht weglassen.',
      );
    }
  } catch {
    /* soft */
  }

  return flags;
}
