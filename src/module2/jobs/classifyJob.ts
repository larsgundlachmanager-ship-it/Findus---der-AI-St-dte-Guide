/**
 * Job-Classifier — schnell, sync, vor LLM-Router (für Bridge + Fast Lane).
 * Struktur-Heuristik; LLM-Router darf Intent feinjustieren.
 */

import { getJobContract } from './contracts';
import type {
  CommitmentStage,
  FindusJobId,
  JobClassification,
} from './types';
import { wantsTaxiRide } from '../../services/mobility/taxiRideIntent';

function uniq(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const k = x.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
  }
  return out;
}

function extractMustHaves(text: string): string[] {
  const t = text.toLowerCase();
  const found: string[] = [];
  const pairs: Array<[RegExp, string]> = [
    [/\bpann(?:en)?fisch\b/u, 'Pannfisch'],
    [/\bmichel\b/u, 'Michel'],
    [/\bfischbrötchen|fischbroetchen\b/u, 'Fischbrötchen'],
    [/\bspaghetti[-\s]?eis\b/u, 'Spaghetti-Eis'],
    [/\bspeiseeis\b/u, 'Speiseeis'],
    [/\berdbeerbecher\b/u, 'Erdbeerbecher'],
    [/\beisbecher\b/u, 'Eisbecher'],
    [/\belbblick\b|\bblick\s+auf\s+die\s+elbe\b/u, 'Elbblick'],
    [/\brooftop\b/u, 'Rooftop'],
    [/\bpool\b/u, 'Pool'],
    [/\bsauna\b/u, 'Sauna'],
    [/\bmassagen?\b/u, 'Massage'],
    [/\ball[\s-]*inclusive\b|\ballinclusive\b/u, 'All-inclusive'],
    [/\bglutenfrei|zöliakie|zoeliakie\b/u, 'glutenfrei'],
    [/\bvegan\w*/u, 'vegan'],
    [/\bsteak|rumpsteak|ribeye|steakhouse\b/u, 'Steak'],
    [/\b(?:black\s+)?angus|agno|angos\b/u, 'Angus'],
    [/\bd[öo]ner|kebab|kebap\b/u, 'Döner'],
    [/\bwagyu\b/u, 'Wagyu'],
    [/\bkobe\b/u, 'Kobe'],
    [/\bfleckvieh|simmental\b/u, 'Fleckvieh'],
    [/\bzugrestaurant|speisewagen|dining[\s-]?car|bahnrestaurant|restaurant\s+im\s+zug\b/u, 'Zugrestaurant'],
    [/\basiatisch\w*|\basian\b|\bthai\b/u, 'asiatisch'],
    [/\bsushi\b/u, 'Sushi'],
    [/\bvegetar(?:isch|ier|ierin)?\b/u, 'vegetarisch'],
    [/\bhalal\b/u, 'Halal'],
    [/\bspider[-\s]?man\b/u, 'Spider-Man'],
    [/\btyrannosaurus|\bt[-\s]?rex\b|\bdinosaur/u, 'Dinosaurier'],
    [/\bpicasso\b/u, 'Picasso'],
    [/\bbarrierefrei|rollstuhl\b/u, 'barrierefrei'],
    [/\bkostenlos(?:er|em|en|es)?\s+park/u, 'kostenlos parken'],
    [/\bpizza\b/u, 'Pizza'],
    [/\bförde|foerde\b/u, 'Förde'],
    [/\bspikeball\b/u, 'Spikeball'],
    [/\bmeerblick|seeblick\b/u, 'Meerblick'],
    [/\bgünstigst|guenstigst|billigst\b/u, 'günstigste Option'],
  ];
  for (const [re, label] of pairs) {
    if (re.test(t)) found.push(label);
  }
  // Budget-Euro
  const budget = t.match(
    /(?:unter|max(?:imal)?|bis)\s*(\d{2,4})\s*(?:€|euro)/u,
  );
  if (budget) found.push(`Budget ${budget[1]}€`);
  try {
    const { extractCityFromText } = require('../context/shortTermContext') as {
      extractCityFromText: (s: string) => string | null;
    };
    const city = extractCityFromText(text);
    if (city) found.push(city);
  } catch {
    /* soft */
  }
  return uniq(found);
}

function detectCommitment(text: string, jobId: FindusJobId): CommitmentStage {
  const t = text.toLowerCase();
  if (
    jobId === 'emergency_care' ||
    jobId === 'safety_lost' ||
    jobId === 'friction_now' ||
    /\b(sofort|schnell|akut|notfall|dringend|verletzt)\b/u.test(t)
  ) {
    return 'urgent';
  }
  if (
    /\b(ich\s+will|ich\s+möchte|ich\s+moechte|lass\s+uns|bring\s+mich|navigier(?:e|en|t)?|fahr\s+mich|geh(?:en)?\s+wir)\b/u.test(
      t,
    ) ||
    /\b(schon\s+entschieden|auf\s+jeden\s+fall\s+(?:dahin|hin))\b/u.test(t)
  ) {
    return 'committed';
  }
  return getJobContract(jobId).commitmentDefault;
}

type Hit = { jobId: FindusJobId; score: number };

function scoreJobs(text: string): Hit[] {
  const t = text.toLowerCase();
  const hits: Hit[] = [];

  const add = (jobId: FindusJobId, score: number) => {
    if (score <= 0) return;
    hits.push({ jobId, score });
  };

  // Emergency first
  if (
    /\b(notfall|notruf|112|verletzt|verstaucht|gebrochen|zahnschmerz(?:en)?|zahnarzt|notdienst|allerg|apotheke|notaufnahme|krücken|kruecken|insulin)\b/u.test(
      t,
    ) ||
    /\b(fu[sß]|knöchel|knoechel|bein|arm).{0,20}\b(gebrochen|verstaucht|weh)\b/u.test(
      t,
    ) ||
    /\bakute\s+zahn/u.test(t)
  ) {
    add('emergency_care', 12);
  }
  if (
    /\b(pass\s+weg|reisepass|portemonnaie|geklaut|gestohlen|konsulat|polizei|fundbüro|fundbuero|kreditkarte\s+block)\b/u.test(
      t,
    )
  ) {
    add('safety_lost', 11);
  }
  if (
    /\b(toilette|toiletten|\bwc\b|geldautomat|\batm\b|trinkwasser|handyakku|akku|laden\s+sofort|sofort\s+laden|adapter|öffentliche\s+toilette|powerbank|steckdose|handy\s*laden)\b/u.test(
      t,
    )
  ) {
    add('friction_now', 9);
  }

  // Tonight live / cinema
  if (
    /\b(kino|cinema|filmtheater|kinoprogramm|vorstellung|leinwand|kinoticket)\b/u.test(
      t,
    ) ||
    (/\bfilm\b/u.test(t) &&
      /\b(schauen|laufen|ticket|heute|abend)\b/u.test(t)) ||
    /\b(spätvorstellung|spaetvorstellung)\b/u.test(t)
  ) {
    add('tonight_live', 13);
  }
  if (
    /\b(theater|konzert|oper|ballett|varieté|variete|cabaret)\b/u.test(t) &&
    /\b(heute|abend|ticket|aufführung|auffuehrung|läuft|laeuft)\b/u.test(t)
  ) {
    add('tonight_live', 10);
  }

  // Nightlife / Events / Party — inkl. „Was geht heute Abend?“
  // Himmel/Astronomie (Sternschnuppen, Finsternis) ist KEIN lokales Nightlife.
  const celestial =
    /\b(sonnenfinsternis|mondfinsternis|sternschnuppe|sternstunde|meteor|perseiden|leoniden|geminiden|nordlicht|polarlicht|aurora|vollmond|supermond|komet|eclipse|planetenparade)\b/u.test(
      t,
    );
  if (
    !celestial &&
    !/\b(bring\s+mich|navigier(?:e|en|t)?|führ\s+mich|fuehr\s+mich|route\s+zu)\b/u.test(
      t,
    ) &&
    !/\btennis\w*\b/u.test(t) &&
    !(
      /\b(anziehen|outfit|kleidung)\b/u.test(t) &&
      !/\b(party|club|rooftop|disco|feiern|kino|film)\b/u.test(t)
    ) &&
    (/\b(club|techno|rooftop[-\s]?party|disco|nachtleben|feiern\s+gehen|karaoke|speakeasy|jazz[-\s]?bar|party\s+machen|was\s+geht.{0,20}party|heute\s+abend.{0,30}party)\b/u.test(
      t,
    ) ||
      (/\bparty\b/u.test(t) &&
        /\b(heute|abend|kiel|stadt|nacht)\b/u.test(t)) ||
      /\b(was\s+(heute\s+)?geht|was\s+geht\s+heute|was\s+ist\s+(heute\s+)?los|heute\s+abend|heut\s+abend|ausgehen|events?|veranstaltungen?)\b/u.test(
        t,
      ))
  ) {
    add('nightlife_vibe', 12);
  }

  // Dining hard match vs open — „günstigste“ allein ist KEIN Gastro-Signal (sonst Hotel-Diebstahl)
  const stayish =
    /\b(hotel|hostel|airbnb|übernacht|uebernacht|unterkunft|glamping|campingplatz|kapselhotel|pension)\b/u.test(
      t,
    );
  const mustHaves = extractMustHaves(text);
  // Nur echte Dish-/View-Constraints → dining_hard_match.
  // Städte, Budget, Hotel-Amenities und weiche Diät (vegetarisch) zählen nicht.
  const dishMustHaves = mustHaves.filter((m) =>
    /^(Pannfisch|Fischbrötchen|Spaghetti-Eis|Speiseeis|Erdbeerbecher|Eisbecher|Steak|Döner|Sushi|asiatisch|Elbblick|Meerblick|Rooftop|glutenfrei|Halal|vegan|Angus|Wagyu|Kobe|Fleckvieh|Zugrestaurant)$/iu.test(
      m.trim(),
    ),
  );
  const hardFood =
    !stayish &&
    (/\b(pannfisch|fischbrötchen|fischbroetchen|elbblick|glutenfrei|zöliakie|zoeliakie|halal|vegan\s+restaurant|sternrestaurant|kaminfeuer|speisekarte|spaghetti[-\s]?eis|speiseeis|erdbeerbecher|zugrestaurant|speisewagen|dining[\s-]?car|bahnrestaurant|(?:black\s+)?angus|wagyu|kobe|fleckvieh)\b/u.test(
      t,
    ) ||
    (/\b(restaurant|essen|mittag|abendessen|fischrestaurant|eisdiele|eiscafe|eiscafé|gelato|steak)\b/u.test(t) &&
      dishMustHaves.length >= 1) ||
    (/\b(restaurant|essen|mittag|abendessen|eis)\b/u.test(t) &&
      dishMustHaves.length >= 2));
  if (hardFood) add('dining_hard_match', 12);
  else if (
    !stayish &&
    /\b(essen|restaurant|frühstück|fruehstueck|brunch|burger|sushi|hunger|café|cafe|imbiss|streetfood|eisdiele|eiscafe|eiscafé|gelato|vegetar|steak|vegan|asiatisch|angus|wagyu|zugrestaurant|speisewagen)\b/u.test(
      t,
    )
  ) {
    add('dining_open', 8);
  }

  // Stay
  if (stayish) {
    add('stay_search', 14);
  }
  if (
    /\b(schließfach|schliessfach|bounce|gepäck|gepaeck|backpack|einschlie[sß]en|aufbewahr)\b/u.test(
      t,
    )
  ) {
    add('luggage_practical', 9);
  }

  const taxiRide = wantsTaxiRide(text);
  // Zugrestaurant / Speisewagen = Gastro, kein ÖPNV
  const trainDining =
    /\b(zugrestaurant|zug[\s-]?restaurant|bahnrestaurant|speisewagen|dining[\s-]?car|restaurantwagen|restaurant\s+im\s+zug)\b/u.test(
      t,
    );
  // Transit / nav — Taxi/Uber zum Bahnhof ist KEIN ÖPNV
  const transitMode =
    !taxiRide &&
    !trainDining &&
    (/\b(u[-\s]?bahn|s[-\s]?bahn|tagesticket|fähre|faehre|fährtickets?|faehrtickets?|letzter\s+zug|gleis|nachtbus|öpnv|oepnv|hvv|verbindung|überlandbus|ueberlandbus|tram|hop[-\s]?on|nacht(?:s)?\s+(?:noch\s+)?(?:ein\s+)?bus|fährt\s+(?:hier\s+)?nacht|bus\s+nacht|zug\s+ab|abfahrt)\b/u.test(
      t,
    ) ||
      /\böffentlich\w*\s+verkehr/u.test(t) ||
      /\bverkehrsmittel/u.test(t) ||
      /\bmit\s+(?:dem\s+)?(?:bus|zug|bahn|öpnv|oepnv)\b/u.test(t) ||
      (/\b(bus|zug|bahn)\b/u.test(t) &&
        /\b(nacht|fährt|faehrt|ticket|haltestelle|linie)\b/u.test(t)));
  if (transitMode) {
    add('transit_live', 16);
  }
  if (
    !taxiRide &&
    /\b(e[-\s]?scooter|leihfahrrad|mietwagen|mietauto)\b/u.test(t) &&
    !/\bpark/u.test(t)
  ) {
    add('mobility_rent', 8);
  }
  if (taxiRide) add('taxi_rideshare', 16);
  try {
    const { wantsTransitTicketFare } = require('../../services/transit/transitTicketFareParse') as {
      wantsTransitTicketFare: (s: string) => boolean;
    };
    if (!taxiRide && wantsTransitTicketFare(text)) add('transit_live', 16);
  } catch {
    /* soft */
  }
  try {
    const { analogJobHints } = require('./jobAnalogy') as {
      analogJobHints: (s: string) => Array<{
        jobId: FindusJobId;
        score: number;
        shape: string;
      }>;
    };
    for (const h of analogJobHints(text)) {
      if (h.shape === 'ticketed_place_access' && taxiRide) continue;
      add(h.jobId, h.score);
    }
  } catch {
    /* soft */
  }
  try {
    const { looksLikeStreetAddress, extractStreetAddressFromUtterance } = require('../../services/navigation/streetAddressQuery') as {
      looksLikeStreetAddress: (s: string) => boolean;
      extractStreetAddressFromUtterance: (s: string) => string | null;
    };
    const { looksLikeSpokenCityCorrection } = require('../../services/navigation/navDestCityCorrection') as {
      looksLikeSpokenCityCorrection: (s: string) => boolean;
    };
    if (
      !taxiRide &&
      !stayish &&
      !transitMode &&
      !/\b(budget|plane\s+mir|\d{1,4}\s*(?:€|euro))\b/u.test(t) &&
      (looksLikeStreetAddress(t) ||
        extractStreetAddressFromUtterance(t) ||
        looksLikeSpokenCityCorrection(t))
    ) {
      add('nav_route', 15);
    }
  } catch {
    /* soft */
  }
  // Parken nur wenn nicht Tour/Explore („am Ende Parkplatz“) und nicht Multi-Kombi
  const tourish =
    /\b(noch\s+nicht\s+gesehen|eine\s+stunde|tour|umlaufen|erkunden|route\s+mit)\b/u.test(
      t,
    );
  const comboTriple =
    /\b(parken|parkplatz)\b/u.test(t) &&
    /\b(pizza|essen|takeaway)\b/u.test(t) &&
    /\b(förde|foerde|sonnenuntergang|aussicht)\b/u.test(t);
  if (comboTriple) add('day_plan_budget', 16);
  if (
    !tourish &&
    !comboTriple &&
    /\b(parkhaus|parken|parkplatz|ladestationen?|e[-\s]?auto|tankstelle|günstig\s+parken|parkticket)\b/u.test(
      t,
    )
  ) {
    add('parking_ev', 9);
  }
  if (
    (() => {
      try {
        const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
          isExplicitNavIntent: (s: string) => boolean;
        };
        return isExplicitNavIntent(t);
      } catch {
        return /\b(bring\s+mich|navigier(?:e|en|t)?|navi(?:gation)?\s+(?:zu|nach|zum|zur)|führ\s+mich|fuehr\s+mich|route\s+zu|wie\s+komme\s+ich|am\s+schnellsten\s+zum)\b/u.test(
          t,
        );
      }
    })()
  ) {
    // Explizite Nav schlägt Sport-/Nightlife-Job (sonst landet „Tennisclub navigieren“ falsch).
    // ÖPNV-Modus bleibt Transit — „wie komme ich mit dem Bus“ ist keine Fuß-Nav.
    if (!taxiRide && !transitMode) {
      const navBoost =
        /\b(tennis|club|café|cafe|restaurant|hotel|museum|apotheke|supermarkt)\b/u.test(
          t,
        ) || /\btennisclub\b/u.test(t)
          ? 14
          : 13;
      add('nav_route', navBoost);
    }
  }

  // Activity
  if (
    /\b(spikeball|bouldern|bungee|surfschule|surf[-\s]?kurs|surfen|surfspot|kitesurf|wasserski|wakeboard|sup\b|stand[-\s]?up|wandern|joggen|inline|beachvolleyball|klettern|paragliding|rafting|tauchen|golf|tennis|paintball)\b/u.test(
      t,
    ) &&
    !(() => {
      try {
        const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
          isExplicitNavIntent: (s: string) => boolean;
        };
        return isExplicitNavIntent(t);
      } catch {
        return /\b(bring\s+mich|navigier(?:e|en|t)?|führ\s+mich|fuehr\s+mich|route\s+zu)\b/u.test(
          t,
        );
      }
    })()
  ) {
    add('activity_sport', 10);
  }

  // Museum theme
  if (
    /\b(museum|museen|ausstellung|picasso|dinosaur|t[-\s]?rex|tyrannosaurus|illusionen|aquarium|zoo|freien?\s+eintritt)\b/u.test(
      t,
    )
  ) {
    add('museum_theme', 8);
  }

  // Sight / identify
  if (
    /\b(was\s+ist\s+das|was\s+für\s+ein\s+gebäude|goldene\s+kuppel|wie\s+alt\s+ist\s+die\s+brücke|wie\s+alt\s+ist)\b/u.test(
      t,
    ) ||
    /\b(wo\s+bin\s+ich|wo\s+stehe\s+ich|was\s+ist\s+das\s+hier)\b/u.test(t)
  ) {
    add('poi_identify', 16);
  } else if (
    /\b(warum|wieso|weshalb).{0,40}\b(geschlossen|abgerissen|saniert|schwimmbad|halle)\b/u.test(
      t,
    ) ||
    /\b(geschlossen|saniert).{0,40}\b(warum|wieso|weshalb)\b/u.test(t)
  ) {
    add('poi_identify', 11);
  }
  if (
    /\b(sehenswürdigkeit|must[-\s]?see|noch\s+nicht\s+gesehen|aussichtspunkt|drei\s+stunden\s+luft|free[-\s]?walking|eine\s+stunde|umlaufen|wo\s+kannst\s+du\s+mich\s+hinschicken|strand|baden|ins\s+wasser)\b/u.test(
      t,
    ) ||
    (tourish &&
      /\b(gesehen|sehen|ort|hafen|theater|museum)\b/u.test(t))
  ) {
    add('sight_recommend', 12);
  }

  // Shopping / Supermarkt — Navigation/Errand; Prospekt hat eigenen Knowledge-Pfad
  if (
    (/\b(souvenir|briefmarke|briefmarken|briefkasten|einkauf|shoppingmall|flohmarkt|sim[-\s]?karte|waschsalon|wäsche\s+waschen|kleidung\s+waschen|waschen|regenschirm|copyshop|aldi|lidl|rewe|edeka|kaufland|supermarkt|netto\b|penny)\b/u.test(
      t,
    ) ||
      /\b(?:nächste[rn]?\s+)?(?:aldi|lidl)\b/u.test(t)) &&
    !/\b(angebot|prospekt|aktionspreis|handzettel|werbebeilage|mango|spritz|prospekt)\b/u.test(
      t,
    )
  ) {
    add('shopping_errand', 10);
  }

  // Parkticket-Aussage → Care / parking (nicht nur „Parkhaus suchen“)
  if (
    /\bparkticket\b/u.test(t) ||
    (/\bparkplatz\b/u.test(t) &&
      /\b(?:das\s+ist|mein|bis\s+\d{1,2}[:.]\d{2}|speicher|merk)\b/u.test(t))
  ) {
    add('parking_ev', 12);
  }

  // Weather / outfit — Plan/Dresscode mitdenken (secondary oft day_plan / nightlife)
  if (
    /\b(anziehen|outfit|kleidung|jacke|pulli|was\s+soll\s+ich\s+an|sonnenuntergang.{0,30}wetter)\b/u.test(
      t,
    ) ||
    (/\b(wetter|regen|windig|grad)\b/u.test(t) &&
      !/\b(spikeball|strand|baden)\b/u.test(t))
  ) {
    add('weather_outfit', 9);
  }

  // Multi-Constraint Kombi (Parken + Essen + Aussicht) → Combo-Cluster / Pitch, KEIN Tagesplan
  // (bewusst kein day_plan_budget — siehe Plan Modul5)

  // Day plan
  if (
    /\b(tagesplan|plane\s+mir|budget\s+für\s+heute|kompletten\s+tag|indoor[-\s]?aktivit|danach\s+(?:ins|in\s+ein|zum)|danach\s+(?:ein\s+)?café|danach\s+(?:ein\s+)?cafe|einplanen|eintragen)\b/u.test(
      t,
    ) ||
    (/\b(?:und\s+)?danach\b/u.test(t) &&
      /\b(museum|essen|café|cafe|kino|bar)\b/u.test(t))
  ) {
    add('day_plan_budget', 11);
  }
  try {
    const { looksLikeArriveByAppointment } = require('../kernel/utteranceFamily') as {
      looksLikeArriveByAppointment: (s: string) => boolean;
    };
    if (looksLikeArriveByAppointment(text)) {
      add('day_plan_budget', 14);
    }
  } catch {
    /* soft */
  }

  // Fact number / Quick-Lookup (wann/was + Himmel)
  if (
    /\b(wie\s+(?:breit|hoch|alt|tief|viele|viel)|einwohner|punkte\s+bekomm|wie\s+viele\s+(?:schiffe|boote|stufen|brücken|bruecken)|wann\s+(?:ist\s+)?(?:der\s+)?sonnenuntergang|sonnenuntergang\s+exakt|exakt\s+sonnenuntergang|hitzerekord|bürgermeister|buergermeister|sonnenfinsternis|mondfinsternis|sternschnuppe|meteor(?:iten)?(?:schauer)?|perseiden|nordlicht|polarlicht|aurora|vollmond|supermond|komet|eclipse|planetenparade)\b/u.test(
      t,
    ) ||
    (/\b(gewonnen|erste\s+runde|turnier)\b/u.test(t) &&
      /\b(punkt|score|krieg)\b/u.test(t)) ||
    (/\b((?:wann|was|wer)\s+(?:ist|war|sind|wird|gibt|heißt|heisst|passiert)|was\s+bedeutet)\b/u.test(
      t,
    ) &&
      !/\b(restaurant|essen|navigier|führ\s+mich|fuehr\s+mich|plane\s+mir|party|club)\b/u.test(
        t,
      ))
  ) {
    add('fact_number', 14);
  }

  // Smalltalk / Companion (emotional, Persönlichkeit) — vor Travel-Fallback
  if (
    /\b(brauch(?:e)?\s+(?:mal\s+)?(?:deinen?\s+)?rat|rat\s+brauch|red(?:e)?\s+(?:mal\s+)?mit\s+mir|hör\s+(?:mir\s+)?zu|hoer\s+(?:mir\s+)?zu|geht\s+mir\s+(?:nicht\s+)?gut|bin\s+(?:traurig|gestresst|überfordert|ueberfordert|einsam)|fühl\s+mich|fuehl\s+mich|sei\s+(?:mal\s+)?für\s+mich\s+da|fuer\s+mich\s+da)\b/u.test(
      t,
    ) &&
    !/\b(restaurant|pizza|eis|navig|führ\s+mich|fuehr\s+mich|hotel|museum)\b/u.test(
      t,
    )
  ) {
    add('smalltalk_general', 16);
  }

  // Smalltalk fallback signals
  if (
    /\b(hallo|moin|wie\s+geht|danke|langeweile|erzähl\s+einen\s+witz)\b/u.test(
      t,
    ) &&
    hits.length === 0
  ) {
    add('smalltalk_general', 5);
  }

  try {
    const { orchestrateUtterance } = require('../reboot/pipeline/orchestrateSlots') as {
      orchestrateUtterance: (s: string) => {
        weaveDayPlan: boolean;
        jobs: FindusJobId[];
        slots: unknown[];
      };
    };
    const { childJobsBesidesPlan } = require('../reboot/pipeline/dispatchJobs') as {
      childJobsBesidesPlan: (jobs: FindusJobId[]) => FindusJobId[];
    };
    const orch = orchestrateUtterance(text);
    const compoundWeave =
      orch.weaveDayPlan &&
      orch.slots.length >= 4 &&
      childJobsBesidesPlan(orch.jobs).length >= 3;
    if (compoundWeave) {
      add('day_plan_budget', 20);
    }
  } catch {
    /* soft */
  }

  return hits.sort((a, b) => b.score - a.score);
}

/**
 * Klassifiziert User-Text → Job + Must-Haves + Commitment.
 */
export function classifyJob(userText: string): JobClassification {
  const text = userText.replace(/\s+/g, ' ').trim();
  const ranked = scoreJobs(text);
  const top = ranked[0];
  const jobId: FindusJobId = top?.jobId ?? 'sight_recommend';
  const contract = getJobContract(jobId);
  const mustHaves = extractMustHaves(text);
  const secondaryJobIds = ranked
    .slice(1)
    .filter((h) => h.score >= 7 && h.jobId !== jobId)
    .slice(0, 2)
    .map((h) => h.jobId);

  if (
    (jobId === 'weather_outfit' || secondaryJobIds.includes('weather_outfit')) &&
    /\b(wie\s+lange|fahrzeit|da\s+hin|wie\s+weit)\b/iu.test(text)
  ) {
    if (!secondaryJobIds.includes('nav_route') && jobId !== 'nav_route') {
      secondaryJobIds.push('nav_route');
    }
  }
  if (
    jobId === 'nightlife_vibe' &&
    /\b(anziehen|outfit|frieren|jacke)\b/iu.test(text)
  ) {
    if (!secondaryJobIds.includes('weather_outfit')) {
      secondaryJobIds.unshift('weather_outfit');
    }
  }
  // „Was anziehen?“ + Party/Abend → Dresscode mitdenken. Stadtbummel/Wetter allein bleibt Outfit.
  if (
    jobId === 'weather_outfit' &&
    /\b(anziehen|outfit|was\s+soll\s+ich\s+an)\b/iu.test(text) &&
    /\b(party|club|feiern|rooftop|disco|nightlife|heute\s+abend)\b/iu.test(text)
  ) {
    if (!secondaryJobIds.includes('nightlife_vibe')) {
      secondaryJobIds.push('nightlife_vibe');
    }
  }
  if (
    jobId === 'dining_hard_match' &&
    /\b(sonnenuntergang|sunset)\b/iu.test(text)
  ) {
    if (!secondaryJobIds.includes('weather_outfit')) {
      secondaryJobIds.push('weather_outfit');
    }
  }

  try {
    const { orchestrateUtterance } = require('../reboot/pipeline/orchestrateSlots') as {
      orchestrateUtterance: (s: string) => {
        weaveDayPlan: boolean;
        jobs: FindusJobId[];
        slots: unknown[];
      };
    };
    const { dispatchJobsForUtterance, childJobsBesidesPlan } = require('../reboot/pipeline/dispatchJobs') as {
      dispatchJobsForUtterance: (s: string) => FindusJobId[];
      childJobsBesidesPlan: (jobs: FindusJobId[]) => FindusJobId[];
    };
    const orch = orchestrateUtterance(text);
    const compoundWeave =
      orch.weaveDayPlan &&
      orch.slots.length >= 4 &&
      childJobsBesidesPlan(orch.jobs).length >= 3;
    if (compoundWeave) {
      for (const j of dispatchJobsForUtterance(text)) {
        if (j !== jobId && !secondaryJobIds.includes(j)) {
          secondaryJobIds.push(j);
        }
      }
    }
  } catch {
    /* soft */
  }

  const confidence = top
    ? Math.min(0.95, 0.45 + top.score * 0.05)
    : 0.35;

  return {
    jobId,
    contract,
    commitment: detectCommitment(text, jobId),
    mustHaves,
    confidence,
    secondaryJobIds: uniq(secondaryJobIds) as FindusJobId[],
  };
}

/** Map Job → AgentIntent (für Task), ggf. Router-Override. */
export function agentIntentForJob(jobId: FindusJobId): ReturnType<
  typeof getJobContract
>['agentIntent'] {
  return getJobContract(jobId).agentIntent;
}

/**
 * Wenn Heuristik stark ist: Intent vom Job bevorzugen (Launch-Jobs).
 */
export function shouldPreferJobOverRouter(
  classification: JobClassification,
): boolean {
  if (classification.confidence < 0.7) return false;
  const launch: FindusJobId[] = [
    'tonight_live',
    'dining_hard_match',
    'emergency_care',
    'activity_sport',
    'fact_number',
    'stay_search',
    'transit_live',
    'taxi_rideshare',
    'friction_now',
    'safety_lost',
  ];
  return launch.includes(classification.jobId);
}
