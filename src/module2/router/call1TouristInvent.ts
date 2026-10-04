/**
 * Call-1 Touristen-Invent — strukturelle Needs (Friction, eSIM, Gepäck, FX, Notfall, Reservierung).
 * Keine Themen-Whitelist: Need-Token + Worker-Toolbox.
 */

import type { Call1ProximityMode, Call1WorkItem } from './call1TaskBrief';

export type TouristInventKind =
  | 'emergency'
  | 'safety_lost'
  | 'friction'
  | 'sim_data'
  | 'luggage'
  | 'fx_cash'
  | 'booking_reserve'
  | 'tickets'
  | 'nightlife'
  | 'sports_fixture';

const FRICTION_RE =
  /\b(toilette|\bwc\b|geldautomat|\batm\b|trinkwasser|trinkbrunnen|steckdose|powerbank|handy\s*laden|adapter)\b/iu;

const SIM_RE =
  /\b(esim|e[\s-]?sim|roaming|daten\s+(?:im\s+)?ausland|sim[\s-]?karte|mobile\s+daten)\b/iu;

const LUGGAGE_RE =
  /\b(schließfach|schliessfach|gepäck(?:aufbewahrung|lager)?|gepaeck|koffer\s+(?:abstellen|lagern|parken)|bounce\b|luggage\s+storage)\b/iu;

const FX_RE =
  /\b(wechselstube|geldwechsel|devise|fremde\s+währung|fremde\s+waehrung|euro\s+wechseln|wechselkurs|bargeld\s+(?:holen|wechseln))\b/iu;

const SAFETY_RE =
  /\b(pass\s+weg|reisepass|portemonnaie|geklaut|gestohlen|konsulat|polizei|fundbüro|fundbuero|kreditkarte\s+block)\b/iu;

const EMERGENCY_RE =
  /\b(notfall|notruf|112|verletzt|verstaucht|gebrochen|zahnschmerz|notaufnahme|notdienst|allerg)\b/iu;

const BOOK_RE =
  /\b(reservier(?:en|ung)?|vorbestell(?:en|ung)?|tisch\s+(?:für|fuer)|ticket\s+buchen|online\s+buchen|eintrittskarte|museumsticket)\b/iu;

const TICKET_RE =
  /\b(hop[\s-]?on|hop[\s-]?off|tagesticket|tageskarte|wochenticket|nahverkehrsticket|öpnv[\s-]?ticket|oepnv[\s-]?ticket)\b/iu;

const FIXTURE_RE =
  /\b(wann\s+spielt|spielplan|heimspiel|gegen\s+wen|nächstes\s+spiel|naechstes\s+spiel|next\s+game|spielt\s+(?:heute|morgen|am)|ticket(?:s)?\s+(?:für|fuer)\s+(?:das\s+)?spiel)\b/iu;

export function classifyTouristInvent(text: string): TouristInventKind | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 5) return null;
  if (SAFETY_RE.test(t)) return 'safety_lost';
  if (EMERGENCY_RE.test(t)) return 'emergency';
  if (SIM_RE.test(t)) return 'sim_data';
  if (LUGGAGE_RE.test(t)) return 'luggage';
  if (FX_RE.test(t)) return 'fx_cash';
  if (FIXTURE_RE.test(t)) return 'sports_fixture';
  if (TICKET_RE.test(t)) return 'tickets';
  if (BOOK_RE.test(t)) return 'booking_reserve';
  if (FRICTION_RE.test(t)) return 'friction';
  try {
    const { looksLikeEveningPlanAsk } = require('./call1TouristConstraints') as {
      looksLikeEveningPlanAsk: (s: string) => boolean;
    };
    if (looksLikeEveningPlanAsk(t)) return 'nightlife';
  } catch {
    /* soft */
  }
  return null;
}

export function looksLikeTouristInventNeed(text: string): boolean {
  if (classifyTouristInvent(text) != null) return true;
  try {
    const {
      looksLikeAccessibilityAsk,
      looksLikeFamilyKidsAsk,
    } = require('./call1TouristConstraints') as {
      looksLikeAccessibilityAsk: (s: string) => boolean;
      looksLikeFamilyKidsAsk: (s: string) => boolean;
    };
    return looksLikeAccessibilityAsk(text) || looksLikeFamilyKidsAsk(text);
  } catch {
    return false;
  }
}

function constraintMustsFor(text: string) {
  try {
    const { touristConstraintCriteria } = require('./call1TouristConstraints') as {
      touristConstraintCriteria: (
        s: string,
      ) => import('../pitch/call1Criteria').Call1Criterion[];
    };
    return touristConstraintCriteria(text);
  } catch {
    return [] as import('../pitch/call1Criteria').Call1Criterion[];
  }
}

export function inventTouristFrictionWork(
  userText: string,
  proximity: Call1ProximityMode,
): Call1WorkItem[] {
  const kind = classifyTouristInvent(userText);
  const constraints = constraintMustsFor(userText);
  const out: Call1WorkItem[] = [];

  if (kind === 'nightlife') {
    out.push({
      id: 'tourist_nightlife_events',
      worker: 'events',
      brief:
        'Abendprogramm: laufende Events/Clubs/Kino — Top-2 mit Uhr, nichts Vergangenes',
      proximity,
      executeWhen: 'now',
      must: constraints.length ? constraints : undefined,
    });
    out.push({
      id: 'tourist_nightlife_weather',
      worker: 'weather',
      brief: 'Wetter heute Abend — Outdoor-Optionen nur wenn Fit',
      proximity,
      executeWhen: 'now',
      neededSlots: ['temp_c', 'sky', 'rain_timing'],
    });
    if (
      /\b(ticket|buchen|reserv|eintritt)\b/iu.test(userText) ||
      /\b(konzert|musical|theater|kino)\b/iu.test(userText)
    ) {
      out.push({
        id: 'tourist_nightlife_tickets',
        worker: 'deep_web',
        brief: 'Ticket/Buchungs-Link wenn buchbar',
        proximity,
        executeWhen: 'now',
        wantBookingLink: true,
      });
    }
    return out.slice(0, 5);
  }

  if (kind === 'sports_fixture') {
    out.push({
      id: 'tourist_fixture_events',
      worker: 'events',
      brief:
        'Spielplan/Fixture: nächstes Spiel Datum+Halle+Gegner wenn belegt — Answer-First',
      proximity,
      executeWhen: 'now',
    });
    out.push({
      id: 'tourist_fixture_tickets',
      worker: 'deep_web',
      brief: 'Ticket-URL zum genannten Spiel/Team — offizielle Seite / Partner',
      proximity,
      executeWhen: 'now',
      wantBookingLink: true,
    });
    return out;
  }

  if (kind === 'safety_lost') {
    out.push({
      id: 'tourist_safety_place',
      worker: 'pitch',
      brief:
        'Safety/Lost: Konsulat/Polizei/Fundbüro — nächste passende Anlaufstelle + Route + Durchwahl wenn belegt',
      proximity: 'here_now',
      executeWhen: 'now',
      must: constraints.length ? constraints : undefined,
    });
    out.push({
      id: 'tourist_safety_web',
      worker: 'deep_web',
      brief: 'Konsulat/Notruf/Behörden-Links belegen — Just-Do-It, kein Soft-Fill Heimatmuseum',
      proximity,
      executeWhen: 'now',
      wantBookingLink: false,
    });
    return out;
  }

  if (kind === 'emergency') {
    out.push({
      id: 'tourist_emergency_place',
      worker: 'pitch',
      brief:
        'Notfall/Care: nächste passende Anlaufstelle (Arzt/Apotheke/Klinik) + Route/Anruf',
      proximity: 'here_now',
      executeWhen: 'now',
      must: constraints.length ? constraints : undefined,
    });
    out.push({
      id: 'tourist_emergency_web',
      worker: 'deep_web',
      brief: 'Live-Beleg Notfall/Notruf — ehrliche Links',
      proximity,
      executeWhen: 'now',
      wantBookingLink: false,
    });
    return out;
  }

  if (kind === 'friction') {
    out.push({
      id: 'tourist_friction_pitch',
      worker: 'pitch',
      brief: 'Sofort-Friction: nächster Ort (Toilette/ATM/Wasser/Laden) + Route — Just-Do-It',
      proximity: 'here_now',
      executeWhen: 'now',
      must: constraints.length ? constraints : undefined,
    });
    return out;
  }

  if (kind === 'fx_cash') {
    out.push({
      id: 'tourist_fx_pitch',
      worker: 'pitch',
      brief: 'Wechselstube/Bargeld: nächste Optionen nah GPS + Distanz',
      proximity: 'here_now',
      executeWhen: 'now',
      must: [
        { key: 'wechselstube', role: 'must', weight: 22 },
        ...constraints,
      ],
    });
    out.push({
      id: 'tourist_fx_web',
      worker: 'deep_web',
      brief: 'Wechselstube/FX Beleg + ggf. Kurs-Hinweis — keine Fake-Kurse',
      proximity,
      executeWhen: 'now',
    });
    return out;
  }

  if (kind === 'sim_data') {
    out.push({
      id: 'tourist_sim_deep_web',
      worker: 'deep_web',
      brief: 'eSIM/Roaming: Partner-/Kauf-Link (nicht Handyladen als Default)',
      proximity,
      executeWhen: 'now',
      wantBookingLink: true,
    });
    return out;
  }

  if (kind === 'luggage') {
    out.push({
      id: 'tourist_luggage_web',
      worker: 'deep_web',
      brief: 'Gepäckaufbewahrung buchen — Partnerlink wenn belegt + lokale Option',
      proximity,
      executeWhen: 'now',
      wantBookingLink: true,
    });
    out.push({
      id: 'tourist_luggage_pitch',
      worker: 'pitch',
      brief: 'Lokale Schließfächer/Stationen parallel pitchen',
      proximity: 'here_now',
      executeWhen: 'now',
      must: [
        { key: 'schliessfach', role: 'soft', weight: 14 },
        ...constraints,
      ],
    });
    return out;
  }

  if (kind === 'tickets') {
    out.push({
      id: 'tourist_tickets_transit',
      worker: 'transit',
      brief: 'ÖPNV/Hop-on: Produkt + belegter Preis wenn möglich',
      proximity,
      executeWhen: 'now',
    });
    out.push({
      id: 'tourist_tickets_web',
      worker: 'deep_web',
      brief: 'Ticket Kauf-Link offizielle Seite / Partner',
      proximity,
      executeWhen: 'now',
      wantBookingLink: true,
    });
    return out;
  }

  if (kind === 'booking_reserve') {
    out.push({
      id: 'tourist_reserve_web',
      worker: 'deep_web',
      brief: 'Reservierung/Vorbestellung: Buchungs-URL Just-Do-It',
      proximity,
      executeWhen: 'now',
      wantBookingLink: true,
    });
    if (/\b(tisch|restaurant|essen|café|cafe|gastro)\b/iu.test(userText)) {
      out.push({
        id: 'tourist_reserve_dining',
        worker: 'dining',
        brief: 'Gastro-Ort für Reservierung hard-match / pitchen',
        proximity,
        executeWhen: 'now',
        must: constraints.length ? constraints : undefined,
      });
    } else if (/\b(museum|ticket|konzert|theater|kino|eintritt)\b/iu.test(userText)) {
      out.push({
        id: 'tourist_reserve_events',
        worker: 'events',
        brief: 'Event/Museum Ticket-Recherche parallel',
        proximity,
        executeWhen: 'now',
        must: constraints.length ? constraints : undefined,
      });
    } else {
      out.push({
        id: 'tourist_reserve_place',
        worker: 'pitch',
        brief: 'Ort für Reservierung/Vorbestellung finden',
        proximity,
        executeWhen: 'now',
        must: constraints.length ? constraints : undefined,
      });
    }
    return out;
  }

  // Nur Constraints (Barrierefrei / Kids) ohne andere Kind-Klasse
  if (constraints.length) {
    out.push({
      id: 'tourist_constraint_pitch',
      worker: 'pitch',
      brief: `Constraint-Pitch: ${constraints.map((c) => c.key).join(', ')} — Soft-Fill verboten`,
      proximity: 'here_now',
      executeWhen: 'now',
      must: constraints,
    });
    if (constraints.some((c) => /barrierefrei|rollstuhl/.test(c.key))) {
      out.push({
        id: 'tourist_constraint_web',
        worker: 'deep_web',
        brief: 'Barrierefreiheit belegen (Website/OSM) — keine Annahmen',
        proximity,
        executeWhen: 'now',
      });
    }
  }
  return out.slice(0, 5);
}

export function touristInventAuthorIntent(userText: string): string {
  const kind = classifyTouristInvent(userText);
  try {
    const {
      touristConstraintAuthorIntent,
      eveningPlanAuthorIntent,
    } = require('./call1TouristConstraints') as {
      touristConstraintAuthorIntent: (s: string) => string;
      eveningPlanAuthorIntent: (s: string) => string;
    };
    const parts = [
      kind === 'nightlife' ? eveningPlanAuthorIntent(userText) : null,
      kind === 'sports_fixture'
        ? 'Spielplan: Datum+Halle+Gegner zuerst; Ticket-Link Just-Do-It wenn belegt'
        : null,
      kind === 'safety_lost'
        ? 'Pass/Diebstahl/Konsulat: konkrete Anlaufstelle + Route/Anruf + Link — kein Soft-Fill'
        : null,
      kind === 'sim_data'
        ? 'eSIM/Daten: Partner-Kauf-Link Just-Do-It — nicht Handyladen als Default'
        : null,
      kind === 'luggage'
        ? 'Gepäck: Buchungs-Link + lokale Station; Problem+Lösung in einer Antwort'
        : null,
      kind === 'booking_reserve'
        ? 'Reservierung: Ort hard-match + Buchungs-URL, keine Permission-Frage'
        : null,
      kind === 'tickets'
        ? 'Ticket: Produkt + Preis wenn belegt + Kauf-Link'
        : null,
      kind === 'fx_cash'
        ? 'Wechselstube/Bargeld: konkrete Orte + Distanz'
        : null,
      touristConstraintAuthorIntent(userText),
    ].filter(Boolean);
    return parts.join('. ');
  } catch {
    return '';
  }
}
