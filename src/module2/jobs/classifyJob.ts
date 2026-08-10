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
    [/\bpannfisch\b/u, 'Pannfisch'],
    [/\bfischbrötchen|fischbroetchen\b/u, 'Fischbrötchen'],
    [/\belbblick\b|\bblick\s+auf\s+die\s+elbe\b/u, 'Elbblick'],
    [/\brooftop\b/u, 'Rooftop'],
    [/\bpool\b/u, 'Pool'],
    [/\bsauna\b/u, 'Sauna'],
    [/\bglutenfrei|zöliakie|zoeliakie\b/u, 'glutenfrei'],
    [/\bvegan\b/u, 'vegan'],
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
  ];
  for (const [re, label] of pairs) {
    if (re.test(t)) found.push(label);
  }
  // Budget-Euro
  const budget = t.match(
    /(?:unter|max(?:imal)?|bis)\s*(\d{2,4})\s*(?:€|euro)/u,
  );
  if (budget) found.push(`Budget ${budget[1]}€`);
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
    /\b(ich\s+will|ich\s+möchte|ich\s+moechte|lass\s+uns|bring\s+mich|navigier|fahr\s+mich|geh(?:en)?\s+wir)\b/u.test(
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
    add('tonight_live', 11);
  }
  if (
    /\b(theater|konzert|oper|ballett|varieté|variete|cabaret)\b/u.test(t) &&
    /\b(heute|abend|ticket|aufführung|auffuehrung|läuft|laeuft)\b/u.test(t)
  ) {
    add('tonight_live', 10);
  }

  // Nightlife / Party (schlägt „Konzert heute“ wenn Party-Wort da)
  if (
    /\b(club|techno|rooftop[-\s]?party|disco|nachtleben|feiern\s+gehen|karaoke|speakeasy|jazz[-\s]?bar|party\s+machen|was\s+geht.{0,20}party|heute\s+abend.{0,30}party)\b/u.test(
      t,
    ) ||
    (/\bparty\b/u.test(t) &&
      /\b(heute|abend|kiel|stadt|nacht)\b/u.test(t))
  ) {
    add('nightlife_vibe', 12);
  }

  // Dining hard match vs open
  const hardFood =
    /\b(pannfisch|fischbrötchen|fischbroetchen|elbblick|glutenfrei|zöliakie|zoeliakie|halal|vegan\s+restaurant|sternrestaurant|kaminfeuer|speisekarte|günstigste[sn]?)\b/u.test(
      t,
    ) ||
    (/\b(restaurant|essen|mittag|abendessen|fischrestaurant)\b/u.test(t) &&
      extractMustHaves(text).length >= 1 &&
      /\b(speisekarte|karte\s+zeigen|vegetar|pool|elbblick|fisch)\b/u.test(t)) ||
    (/\b(restaurant|essen|mittag|abendessen)\b/u.test(t) &&
      extractMustHaves(text).length >= 2);
  if (hardFood) add('dining_hard_match', 12);
  else if (
    /\b(essen|restaurant|frühstück|fruehstueck|brunch|burger|sushi|hunger|café|cafe|imbiss|streetfood|eisdiele|vegetar)\b/u.test(
      t,
    )
  ) {
    add('dining_open', 8);
  }

  // Stay
  if (
    /\b(hotel|hostel|airbnb|übernacht|uebernacht|unterkunft|glamping|campingplatz|kapselhotel)\b/u.test(
      t,
    )
  ) {
    add('stay_search', 10);
  }
  if (
    /\b(schließfach|schliessfach|bounce|gepäck|gepaeck|backpack|einschlie[sß]en|aufbewahr)\b/u.test(
      t,
    )
  ) {
    add('luggage_practical', 9);
  }

  // Transit / nav
  if (
    /\b(u[-\s]?bahn|s[-\s]?bahn|tagesticket|fähre|faehre|letzter\s+zug|gleis|nachtbus|öpnv|oepnv|hvv|verbindung|überlandbus|ueberlandbus|tram|hop[-\s]?on|nacht(?:s)?\s+(?:noch\s+)?(?:ein\s+)?bus|fährt\s+(?:hier\s+)?nacht|bus\s+nacht|zug\s+ab|abfahrt)\b/u.test(
      t,
    ) ||
    /\böffentlich\w*\s+verkehr/u.test(t) ||
    /\bverkehrsmittel/u.test(t) ||
    /\bmit\s+(?:dem\s+)?(?:bus|zug|bahn|öpnv|oepnv)\b/u.test(t) ||
    (/\b(bus|zug|bahn)\b/u.test(t) &&
      /\b(nacht|fährt|faehrt|ticket|haltestelle|linie)\b/u.test(t))
  ) {
    add('transit_live', 11);
  }
  if (
    /\b(e[-\s]?scooter|leihfahrrad|mietwagen|mietauto|bolt\b|uber\b)\b/u.test(t) &&
    !/\btaxi\b/u.test(t) &&
    !/\bpark/u.test(t)
  ) {
    add('mobility_rent', 8);
  }
  if (/\b(taxi|taxistand)\b/u.test(t)) add('taxi_rideshare', 8);
  // Parken nur wenn nicht Tour/Explore („am Ende Parkplatz“) und nicht Multi-Kombi
  const tourish =
    /\b(noch\s+nicht\s+gesehen|eine\s+stunde|tour|umlaufen|erkunden|route\s+mit)\b/u.test(
      t,
    );
  const comboTriple =
    /\b(parken|parkplatz)\b/u.test(t) &&
    /\b(pizza|essen|takeaway)\b/u.test(t) &&
    /\b(förde|foerde|sonnenuntergang|aussicht)\b/u.test(t);
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
    /\b(bring\s+mich|navigier|führ\s+mich|fuehr\s+mich|route\s+zu|wie\s+komme\s+ich|am\s+schnellsten\s+zum)\b/u.test(
      t,
    )
  ) {
    // Explizite Nav schlägt Sport-Job (sonst landet „Tennisclub navigieren“ in Knowledge)
    const navBoost =
      /\b(tennis|club|café|cafe|restaurant|hotel|museum|apotheke|supermarkt)\b/u.test(
        t,
      )
        ? 12
        : 7;
    add('nav_route', navBoost);
  }

  // Activity
  if (
    /\b(spikeball|bouldern|bungee|surf(?:en|kurs)?|kitesurf|sup\b|stand[-\s]?up|wandern|joggen|inline|beachvolleyball|klettern|paragliding|rafting|tauchen|golf|tennis|paintball)\b/u.test(
      t,
    ) &&
    !/\b(bring\s+mich|navigier|führ\s+mich|fuehr\s+mich|route\s+zu)\b/u.test(t)
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
    /\b(warum|wieso|weshalb).{0,40}\b(geschlossen|abgerissen|saniert|schwimmbad|halle)\b/u.test(
      t,
    ) ||
    /\b(geschlossen|saniert).{0,40}\b(warum|wieso|weshalb)\b/u.test(t)
  ) {
    add('poi_identify', 11);
  }
  if (
    /\b(sehenswürdigkeit|must[-\s]?see|noch\s+nicht\s+gesehen|aussichtspunkt|drei\s+stunden\s+luft|free[-\s]?walking|eine\s+stunde|umlaufen|wo\s+kannst\s+du\s+mich\s+hinschicken)\b/u.test(
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

  // Multi-Constraint Kombi (Parken + Essen + Aussicht) → Tagesplan-Job als Cluster-Träger
  if (
    (/\b(parken|parkplatz)\b/u.test(t) &&
      /\b(pizza|essen|takeaway|imbiss)\b/u.test(t) &&
      /\b(förde|foerde|sonnenuntergang|aussicht|strand|elbe)\b/u.test(t)) ||
    (/\b(kostenlos\s+parken|gratis\s+parken)\b/u.test(t) &&
      /\b(und|sowie|plus)\b/u.test(t) &&
      /\b(pizza|essen|förde|foerde|sunset)\b/u.test(t))
  ) {
    add('day_plan_budget', 14);
  }

  // Day plan
  if (
    /\b(tagesplan|plane\s+mir|budget\s+für\s+heute|kompletten\s+tag|indoor[-\s]?aktivit|danach\s+(?:ins|in\s+ein|zum)|danach\s+(?:ein\s+)?café|danach\s+(?:ein\s+)?cafe)\b/u.test(
      t,
    ) ||
    (/\b(?:und\s+)?danach\b/u.test(t) &&
      /\b(museum|essen|café|cafe|kino|bar)\b/u.test(t))
  ) {
    add('day_plan_budget', 11);
  }

  // Fact number
  if (
    /\b(wie\s+(?:breit|hoch|alt|tief|viele|viel)|einwohner|punkte\s+bekomm|wie\s+viele\s+(?:schiffe|boote|stufen|brücken|bruecken)|sonnenuntergang(?:\s+exakt)?|exakt\s+sonnenuntergang|hitzerekord|bürgermeister|buergermeister)\b/u.test(
      t,
    ) ||
    (/\b(gewonnen|erste\s+runde|turnier)\b/u.test(t) &&
      /\b(punkt|score|krieg)\b/u.test(t))
  ) {
    add('fact_number', 10);
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

  // Kombi: Outfit + Nightlife oft parallel
  if (
    jobId === 'nightlife_vibe' &&
    /\b(anziehen|outfit|frieren|jacke)\b/iu.test(text)
  ) {
    if (!secondaryJobIds.includes('weather_outfit')) {
      secondaryJobIds.unshift('weather_outfit');
    }
  }
  // „Was anziehen?“ allein → Manager soll Plan/Abend mitdenken (Hint in Synthese)
  if (
    jobId === 'weather_outfit' &&
    /\b(anziehen|outfit|was\s+soll\s+ich\s+an)\b/iu.test(text)
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
    'friction_now',
    'safety_lost',
  ];
  return launch.includes(classification.jobId);
}
